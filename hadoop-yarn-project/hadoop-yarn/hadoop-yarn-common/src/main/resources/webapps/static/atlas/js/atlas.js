/**
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

var chart = null;
var chartTitle = null;
var chartProps = {}; // plotBands/Lines, groupedCategories, nCategories, etc
var chartHeight = 0;
var windowChartWidthDiff = 0;

// apps are indexed by application id.
// the structure maintains the state of the apps across refresh.
// app's state: new, updated, unchanged (since last refresh)
// an app has an index to the series array for the chart
var apps = {};
var series = [];

var groupCollection = null;
var groups = null;  // sorted racks or partitions
var nodesProcessed = false;
var nodeCollection = {};  // node id -> app usage, state, categoriesIdx, etc
var rackCollection = {};  // rack id -> nodes, expanding state, etc
var racks = [];  // sorted short rack id
function rackInfo(rackId) {
  this.id = rackId;
}
rackInfo.prototype.kind = function() {
  return 'rack';
};
rackInfo.prototype.seriesId = function() {
  return 'Atlas_rack_' + this.id;
};
rackInfo.prototype.seriesColor = function() {
  return 'rgba(255, 165, 0, 0.3)';
};

var appSeriesPrefix = 'Atlas_app_';
var fakeSeriesId = 'atlas_fake_series';

// "now line" related
var mayStartNowLine = false;
var currentTimeUsed = false;
var timeInCurrentLoop = null;

// timeline related
var timelineBox = null;
var timeline = null;

// "collapse all racks" button
var allExpanded = true;  // reflect the collapse/expand all button
var collapseAllButton = null;
var justResetCollapseAllButton = false;  // reset button without any action

// variables for debugging
var catchServerData = false;
var errorMsgToDump = '';
var callServerOnlyOnce = false;

///// top level functions /////

function atlasPageEntryPoint() {
  document.title = 'Application Atlas';  // title for browser tab

  // setInterval first waits for the interval, then executes the code inside.
  // To make the data appear faster, run one interation outside first.
  getDataFromServer();

  if (callServerOnlyOnce) {
    // when debugging, we don't want to see repeated error msgs from the
    // same bug.  so just stop calling server.
    return;
  }

  var counter = 0;
  setInterval(function () {
    if (counter++ % 10 === 0) {
      console.log('refresh', counter);  // don't print too many 'refresh'
    }
    getDataFromServer();
  }, 1000 * 3);
}

function getDataFromServer() {
  // if the html page includes script capturedData, getFakeData() function
  // is defined and callable for faked testing data.
  if (typeof getFakeData !== 'undefined') {
    processData(getFakeData(callServerOnlyOnce));
    return;
  }

  var dataLink = '/cluster/atlasData/';
  d3.json(dataLink, function(error, data) {
    if (error !== null) {
      console.log('failed server request.  will retry', error.statusText);
      return;
    }

    processData(data);
  });
}

function processData(data) {
  var inApps = [];
  var inNodes = [];

  // If the app doesn't have the finish time, the finish time is the uniform
  // current time of the data fetching loop.  This current time is also used
  // to draw the "now" line.
  timeInCurrentLoop = new Date().getTime();
  currentTimeUsed = false;

  if (catchServerData) {
    catchServerData = false;
    dumpData(data);
  }
  $.each(data, function(key, list) {
    if (key === 'nodes') {
      inNodes = data.nodes;
    } else if (key === 'apps') {
      inApps = data.apps;
    }
  });

  processNodes(inNodes);
  processApps(inApps);

  // update chart if already exists
  if (chart !== null) {
    updateChart();
  } else {
    makeChart();
  }
}

function makeChart() {
  addCollapseAllButton();

  // When the window width changes, chart's width will not change automatically,
  // because it's in a table cell in yarn's html page.
  // We need to find the size diff between window and container, and
  // resize the chart using the new  window size minus diff.
  windowChartWidthDiff = window.innerWidth - $('#chart_container').width();

  $(window).resize(function() {
    if (chart !== null) {
      chart.setSize(window.innerWidth - windowChartWidthDiff, chartHeight, false);
      positionTimeline();
    }
  });

  chartProps = makeCategories();

  Highcharts.setOptions({
    global : {
      useUTC : false
    }
  });

  for (var appId in apps) {
    var appSeries = makeSeriesForOneApp(appId);
    if (appSeries.data.length !== 0) {
      series.push(appSeries);
      chartProps.haveData = true;
    }
  }

  if (!chartProps.haveData) {
    series.push(makeFakeSeries());
  }

  chart = new Highcharts.Chart({
    chart: {
      height: chartHeight,
      renderTo: 'chart_container',  // parent is on html page
      type: 'columnrange',
      inverted: true
    },
    title: {
      text: chartTitle
    },

    xAxis: {
      min: 0,
      max: chartProps.nCategories - 1,
      gridLineWidth: 0,
      plotBands: chartProps.plotBands,
      plotLines: chartProps.plotLines,
      categories: chartProps.groupedCategories,
      labels: {
        style: {
          color: 'red'
        }
      }
    },

    yAxis: {
      gridLineWidth: 0,
      type: 'datetime',
      title: {
        text: null
      },
      labels: {
        enabled: false
      },
    },

    legend: {
      enabled: false,
    },

    tooltip: {
      style: {fontSize: '13pt', lineHeight: '20%'},
      formatter: function() {
        return makeTooltip(this.series);
      }
    },

    plotOptions: {
      columnrange: {
        stacking: 'normal'
      },
      series: {
        pointPadding: 0,
        groupPadding: 0
      }
    },

    series: series
  });

  addRackButtons();
  processTimeline();
}

function updateChart(categoriesChanged) {
  var needRedraw = false;
  var layoutChanged = false;

  var rack, rackId;
  if (categoriesChanged !== undefined) {
    var bandIds = [];
    var lineIds = [];
    var b, l;

    newProps = makeCategories();
    layoutChanged = true;
    needRedraw = true;

    chart.setSize($('#chart_container').width(), chartHeight, false);

    // must copy the band/line ids before removing.  highchart just
    // uses MY bands and lines.  So if I loop through the bands, I'm
    // doing removal on the dame data structure.
    for (b in chartProps.plotBands) {
      bandIds.push(chartProps.plotBands[b].id);
    }
    for (b in bandIds) {
      chart.xAxis[0].removePlotBand(bandIds[b]);
    }
    for (b in newProps.plotBands) {
      chart.xAxis[0].addPlotBand(newProps.plotBands[b]);
    }
    for (l in chartProps.plotLines) {
      lineIds.push(chartProps.plotLines[l].id);
    }
    for (l in lineIds) {
      chart.xAxis[0].removePlotLine(lineIds[l]);
    }
    for (l in newProps.plotLines) {
      chart.xAxis[0].addPlotLine(newProps.plotLines[l]);
    }

    for (rackId in groupCollection) {  // can be rack or partition
      rack = groupCollection[rackId];
      if (chart.get(rack.seriesId()) !== null) {
        chart.get(rack.seriesId()).remove(false);
      }
      if (chart.get(rack.seriesId('future')) !== null) {
        chart.get(rack.seriesId('future')).remove(false);
      }

      rack.button.remove();  // remove the old buttons
      rack.button = null;
    }

    chart.xAxis[0].setCategories(newProps.groupedCategories, false);
    chart.xAxis[0].setExtremes(newProps.xMin, newProps.xMax);
    newProps.haveData = chartProps.haveData;  // app data accumulate
    chartProps = newProps;
  }

  // add rack series.
  // If categories changed, code above should have removed old ones already.
  for (rackId in groupCollection) {
    rack = groupCollection[rackId];
    if (rack.expanded) {
      continue;
    }

    var rackSeries = makeSeriesForOneRack(rackId);
    if (rackSeries === null) {  // rack data unchanged since last update
      continue;
    }

    needRedraw = true;
    if (rackSeries.data.length !== 0) {
      chartProps.haveData = true;
    }
    if (chart.get(rack.seriesId()) === null) {
      chart.addSeries(rackSeries, false);
    } else {
      chart.get(rack.seriesId()).setData(rackSeries.data, false);
    }
  }

  // renew apps for uncollapsed nodes
  for (var appId in apps) {
    var app = apps[appId];
    var seriesId = apps[appId].seriesId;
    if (app.state == 'new' || app.state == 'updated' || layoutChanged) {
      needRedraw = true;
      var appSeries = makeSeriesForOneApp(appId);
      if (appSeries.data.length !== 0) {
        chartProps.haveData = true;
      }
      if (chart.get(seriesId) === null) {
        chart.addSeries(appSeries, false);
      } else {
        chart.get(seriesId).setData(appSeries.data, false);
      }
    }
  }

  // leave fake series there but update it to fit the new categrories
  if (chart.get(fakeSeriesId) !== null && layoutChanged){
    chart.get(fakeSeriesId).setData(makeFakeSeries(), false);
  }

  if (needRedraw) {
    chart.redraw();
  }
  updateNowLine();
  if (layoutChanged) {
    addRackButtons();
  }

  // this should be done after the allocation partitions is put in
  processTimeline();
}

///// incoming data processing /////

function intervalsOverlap(d1, d2) {
  return (d1[0] < d2[1] && d2[0] < d1[1]) ? true : false;
}

function updateAppState(inApp, nodesOccupied, pendingAllocations, finished) {
  var id = inApp.applicationId;
  // app has already finished when first seen.  ignore.
  if (!(id in apps) && finished) return;

  if (id in apps && finished) {
    apps[id].state = 'finished';
    apps[id].serverState = 'FINISHED';
    return;
  }

  if (!(id in apps)) {  // make new app entry
    apps[id] = {};
    apps[id].state = 'new';
    apps[id].nodesOccupied = {};
    apps[id].nodeUseHistory = {};  // preexempted nodes history
    apps[id].seriesId = appSeriesPrefix + id;
    apps[id].color = null;
  } else {
    apps[id].state = 'unchanged';
  }

  apps[id].startTime = inApp.startTime;
  apps[id].finishTime = (inApp.finishTime === 0) ?
    timeInCurrentLoop : inApp.finishTime;
  apps[id].serverState = inApp.state;
  apps[id].nContainers = Object.keys(nodesOccupied).length;
  apps[id].estimatedFinishTime = inApp.finishTime;
  apps[id].pendingAllocFinishTime = 0;
  apps[id].pendingAllocContainers = 0;

  // If tooltip info exists
  if ('tooltip_info' in inApp) {
    for (var k in inApp.tooltip_info) {
      apps[id][k] = inApp.tooltip_info[k];
    }
  }

  // xxx need rework the state keeping now app's container set can add
  // AND subtract
  apps[id].state = 'updated';

  var newList = {};
  $.each(nodesOccupied, function(n, duration) {
    newList[n] = [duration[0], duration[1]];
    if (n in apps[id].nodesOccupied) {
      // there is a record that the node has been used by the app.
      // if the duration on record is pretty much the same duration,
      // (with some extension in the new duration), delete the old
      // record.  Otherwise it's the case where the app was preempted
      // and now restarted.  Then don't delete so the duration can go
      // nodeUseHistory
      // ppp
      if (intervalsOverlap(duration, apps[id].nodesOccupied[n])) {
        delete apps[id].nodesOccupied[n];
      }
    }
  });

  // leftover in app's nodesOccupied go to node use history
  for (var n in apps[id].nodesOccupied) {
    var duration = apps[id].nodesOccupied[n];
    if (n in apps[id].nodeUseHistory) {
      apps[id].nodeUseHistory[n].push([duration[0], duration[1]]);
    } else {
      apps[id].nodeUseHistory[n] = [[duration[0], duration[1]]];
    }
  }
  apps[id].nodesOccupied = newList;
}

function processApps(inApps) {
  $.each(inApps, function(index, inApp) {
    var finishedApp = false;
    var nodesOccupied = {};  // node -> [startTime, finishTime]
    var pendingAllocations = [];
    var finishTime = 0;

    // loop through the nodes used by the app
    for (var ranNodeIdx in inApp.ranNodes) {
      var startTime = Number(inApp.startTime);
      var nodeId = inApp.ranNodes[ranNodeIdx].split('.')[0];

      if (inApp.state === 'FINISHED') {
        // App is finished. We only know the app's creation time
        // on each node if the client gets the app info when it's running.
        // So if an app has already finished when the client is started,
        // we simply don't show the app because the start time on individual
        // nodes is not provided for finished apps by the server.
        if (!(inApp.applicationId in apps)) {
          return true;
        }

        finishTime = Number(inApp.finishTime);
        if (finishTime === 0) {
          finishTime = timeInCurrentLoop;
          currentTimeUsed = true;
          console.log('finished current time', timeInCurrentLoop);
        }
        finishedApp = true;
      } else if (inApp.state === 'RUNNING') {
        var container = inApp.containers[ranNodeIdx];
        startTime = inApp.containers[ranNodeIdx].creationTime;
        finishTime = timeInCurrentLoop;
        // console.log('running current time', timeInCurrentLoop);
        currentTimeUsed = true;
      } else {
        console.log('invalid app state:', inApp.applicationId. inApp.state);
        return true;
      }

      nodesOccupied[nodeId] = [startTime, finishTime];
    }

    // ppp
    /*
    if (useCapturedData) {
      addPendingAllocations(inApp);  // no op if not using captured data
    }
    */

    if ('pending_future_allocations' in inApp) {
      pendingAllocations = inApp.pending_future_allocations;
    }

    // update app state and save the current dataset for the app
    updateAppState(inApp, nodesOccupied, pendingAllocations, finishedApp);
  });
}

// Nodes from the server have rack property.  So groupCollection structure
// is also made here.
function processNodes(inNodes) {
  if (nodesProcessed) {
    return;  // don't need re-process racks because they don't change
  }

  $.each(inNodes, function(index, inNode) {
    var nodeId = inNode.nodeId.split('.')[0];
    var rackId = inNode.rack.substr(1);

      var node = {};
      node.fullId = inNode.nodeId;
      node.categoryIdx = -1;  // node's chart category index, -1 -> rack collapsed
      node.data = [];  // [start, finish] pairs chronologically ordered
      node.state = 'unchanged';  // will be updated with app data
      nodeCollection[nodeId] = node;

      // rackInfo is derived from node. a previous node may have built the rack
      if (rackId in rackCollection) {
        rackCollection[rackId].nodes.push(nodeId);  // add node into rackInfo
      } else {
        var rack = new rackInfo(rackId);
        rackCollection[rackId] = rack;

        rack.fullId = inNode.rack;
        rack.nodes = [nodeId];
        rack.button = null;
        rack.categoryIdx = -1;
        rack.expanded = true;
      }
  });

  // racks and the nodes on each rack are sorted alphabetically
  racks = Object.keys(rackCollection).sort();
  for (var r in racks) {
    rackCollection[racks[r]].nodes.sort();
  }

  groupCollection = rackCollection;
  groups = racks;

  nodesProcessed = true;
}

///// data related chart ops /////

function makeCollapsedGroupSeries(type, group, data) {
  var dataSet = [];
  var b = group.categoryIdx + 0.5;
  var nNodes = group.nodes.length;
  for (var i = 0; i < data.length; i++) {
    var h = b - Number(data[i].value) / Number(nNodes);
    // console.log('height', h, b, data[i].value);

    if (i > 0) { // not the first interval
      if (data[i].from === data[i-1].to) {
        dataSet.pop();  // merge two intervals into one polygon
      } else {
        dataSet.push([null, null]);  // add a separator
        dataSet.push([b, data[i].from]);
      }
    } else {
      dataSet.push([b, data[i].from]);
    }
    dataSet.push([h, data[i].from]);
    dataSet.push([h, data[i].to]);
    dataSet.push([b, data[i].to]);
  }

  var groupSeries = {
    type: 'polygon',
    showInLegend: false,
    id: group.seriesId(type),
    name: group.seriesId(type),
    // enableMouseTracking: false,
    shadow: true,
    color: group.seriesColor(type),
    data: dataSet
  };

  return (dataSet.length === 0) ? null: groupSeries;
}

function makeSeriesForOneRack(rackId) {
  var rack = groupCollection[rackId];
  var data = [];

  for (var appId in apps) {
    var app = apps[appId];
    for (var n in rack.nodes) {
      var nodeId = rack.nodes[n];
      if (nodeId in app.nodesOccupied) {
        var duration = app.nodesOccupied[nodeId];
        data = buildRackUsage(data, duration[0], duration[1], 1);
      }
    }
  }

  return makeCollapsedGroupSeries(rack.kind(), rack, data);
}

function buildRackUsage(inData, start, finish, value) {
  var data = inData;
  var newInterval = null;
  var interval = null;
  var i = 0;
  var startIdx = -1;
  var endIdx = -1;

  // if not testing data, trim the time to accuracy of a second.
  // small variations in job start time make too many unnecessary intervals
  /*
  var startTime = (start > 1000000) ? start - start % 1000 : start;
  var finishTime = (finish > 1000000) ? finish - finish % 1000 : finish;
  */
  var startTime = start;
  var finishTime = finish;

  /*
  var startTime = start;
  var finishTime = finish;
  */

  // each rack data point is to/from/value.  to/from is time interval.
  // value is how many nodes are occupied in the interval.
  // we will increment the value of the intervals that are
  // in startTime/finishTime range and insert intervals to fill the gaps.

  // first, search for intervals that will be affected.
  // start/endIdx are the indices of the resulting range.
  for (i = data.length - 1; i >= 0; i--) {
    interval = data[i];
    // startTime is just before the resulting startIdx or on the interval
    if (startTime < interval.from) {
      startIdx = i;
      continue;
    }
    if(startTime >= interval.from && startTime < interval.to) {
      startIdx = i;
      break;
    }
    if (startTime >= interval.to) {
      break;
    }
  }
  for (i = 0; i < data.length; i++) {
    interval = data[i];
    // finishTime is just after the resulting endIdx or on the interval
    if (finishTime > interval.to) {
      endIdx = i;
      continue;
    }
    if (finishTime > interval.from && finishTime <= interval.to) {
      endIdx = i;
      break;
    }
    if (finishTime <= interval.from) {
      break;
    }
  }
  // end condition: startIdx = -1 if new range is at the end.
  // endIdx = -1 if new range is at the beginning.
  // both = -1 if data is empty.
  // console.log('range affected', startTime, finishTime, startIdx, endIdx);

  if (startIdx === -1 || endIdx === -1) {
    newInterval = {from: startTime,
                   to: finishTime,
                   value: value};
    data.splice(((endIdx !== -1) ? endIdx + 1 : 0), 0, newInterval);
    // console.log('simple insert');
    return data;
  }

  // when start/finish time is in an interval, split
  interval = data[startIdx];
  var tmp = Object.assign({}, interval);
  if (startTime > interval.from) {
    // split interval into two.  First part is not in start/finish range
    newInterval = {from: startTime,
                   to: interval.to,
                   value: interval.value};
    data.splice(++startIdx, 0, newInterval);
    endIdx++;  // shift end index as well
    interval.to = startTime;
    // console.log('split start piece', tmp, interval, newInterval);
  }

  interval = data[endIdx];
  tmp = Object.assign({}, interval);
  if (finishTime < interval.to) {
    newInterval = {from: finishTime,
                   to: interval.to,
                   value: interval.value};
    data.splice(endIdx + 1, 0, newInterval);
    interval.to = finishTime;
    // console.log('split end piece at endIdx', tmp, data[endIdx], data[endIdx+1]);
  }

  // slice data into three parts: before, range, after
  var before = data.slice(0, startIdx);  // may result empty array
  var range = data.slice(startIdx, endIdx + 1);  // may be empty
  var after = data.slice(endIdx + 1, data.length);  // may be empty

  // add 1 to exiting intervals and fill the gap between and on either end
  // of the range.  loop backward to avoid index shifting
  for (i = range.length - 1; i >= 0; i--) {
    // console.log('before increment', i, range[i]);
    range[i].value += value;

    if (i === range.length - 1 && finishTime > range[i].to) {
      newInterval = {from: range[i].to,
                     to: finishTime,
                     value: value};
      range.push(newInterval);  // add at the end
      // console.log('push', i, newInterval);
    }
    if (i > 0 && range[i - 1].to < range[i].from) {  // fill gap in between
      newInterval = {from: range[i - 1].to,
                     to: range[i].from,
                     value: value};
      range.splice(i, 0, newInterval);
      // console.log('fill gap', i, newInterval);
    }
    if (i === 0 && startTime < range[i].from) {
      newInterval = {from: startTime,
                     to: range[i].from,
                     value: value};
      range.unshift(newInterval);  // insert at the beginning
      // console.log('unshift', i, newInterval);
    }
  }
  if (range.length === 0) {  // start/finish range falls in a gap
    newInterval = {from: startTime,
                   to: finishTime,
                   value: value};
    range.push(newInterval);
    // console.log('only one', newInterval);
  }

  // merge two touching intervals with same value.  This can happen
  // ONLY at either end of the range
  if (before.length !== 0 &&
      before[before.length - 1].to === range[0].from &&
      before[before.length - 1].value === range[0].value) {
    // console.log('merge first', before[before.length - 1], range[0]);
    range[0].from = before[before.length - 1].from;
    before.pop();
  }
  if (after.length !== 0 &&
      after[0].from === range[range.length - 1].to &&
      after[0].value === range[range.length - 1].value) {
    // console.log('merge last', range[range.length - 1], after[0]);
    after[0].from = range[range.length - 1].from;
    range.pop();
  }

  data = before.concat(range, after);
  return data;
}  // buildRackUsage()


function makeSeriesForOneApp(appId) {
  var dataSet = [];

  $.each(apps[appId].nodesOccupied, function(n, duration) {
    if (nodeCollection[n].categoryIdx !== -1) {  // node is in collapsed group
      dataSet.push({x: nodeCollection[n].categoryIdx,
                    low: duration[0],
                    high: duration[1]});
    }
  });
  $.each(apps[appId].nodeUseHistory, function(n, history) {
    if (nodeCollection[n].categoryIdx !== -1) {
      for (var i in history) {
        dataSet.push({x: nodeCollection[n].categoryIdx,
                      low: history[i][0],
                      high: history[i][1]});
      }
    }
  });
  // sort data on time axis to please highchart
  dataSet.sort(function(a,b) {
    return (a.x > b.x) ? 1 : ((b.x > a.x) ? -1 : 0);
  });

  var appSeries = {
    type: 'columnrange',
    id: apps[appId].seriesId,
    name: appId,
    data: dataSet
  };

  // no category touched by app. it can happen with rack collapse
  return appSeries;  // data can be emtpy, like []
}

///// chart formatting ops (categories, tooltips, etc) /////

function updateNowLine() {
  if (!mayStartNowLine) {
    return;
  }
  chart.yAxis[0].removePlotLine('current_time');  // may not exist yet
  var current = (currentTimeUsed)? timeInCurrentLoop: new Date().getTime();
  chart.yAxis[0].addPlotLine({
    label: {text: 'now', style: {color: 'blue', fontWeight: 'bold'}},
    value: current,
    width: 2,
    color: 'red',
    zIndex: 50,
    id: 'current_time'
  });
}

function addCollapseAllButton() {
  // container div is on the html page sent by yarn
  collapseAllButton = $('<input id="collapseAllButton" type="checkbox" value="0">');
  collapseAllButton.appendTo($('#collapseAll'));
  $('#collapseAllButton').switchButton({
    width: 35,
    height: 22,
    button_width: 26,
    on_label: 'all',
    off_label: 'none'
  }).change(function() {
    allExpanded = !this.checked;
    if (justResetCollapseAllButton) {
      return;
    }
    for (var g in groupCollection) {
      groupCollection[g].expanded = !this.checked;
    }
    updateChart('categoriesChanged');
  });
}

function addRackButtons() {
  var nodeLabelX = 0;  // x for expand button, align with node label
  var x, y;

  // xxx Since there is no api to find the labels, I use a dirty way.
  // All labels are children of an element of xaxis-labels class.

  // The first loop is to find the x of a node label.  Needed to
  // place expand buttons which align with node labels.
  $('.highcharts-xaxis-labels').children().each(function(i, label) {
    if (label.textContent in nodeCollection) {  // label is rack
      nodeLabelX = $(label).offset().left;
      return false;  // done with loop once a noce label is seen
    }
  });

  $('.highcharts-xaxis-labels').children().each(function(i, label) {
    if (label.textContent in groupCollection) {  // only care about rack label
      var rackId = label.textContent;
      var rack = groupCollection[rackId];
      if (rack.expanded) {
        var collapseButton = $('<input type="button" value="-" />');
        rack.button = collapseButton;
        collapseButton.appendTo($('body'));
        // position the button below rack name and center it
        var labelW = $(label)[0].getBoundingClientRect().width;
        var buttonW = collapseButton[0].getBoundingClientRect().width;
        x = $(label).offset().left + (labelW - buttonW) / 2;
        y = $(label).offset().top + 20;
        collapseButton.css({left: x, top: y, position: 'absolute'});
        collapseButton.on('click',function() {
          // catchServerData = true;  // side effect for debugging
          rack.expanded = false;
          justResetCollapseAllButton = true;
          collapseAllButton.switchButton({checked: false});
          justResetCollapseAllButton = false;
          updateChart('categoriesChanged');
        });
      } else {  // rack is collapsed
        y = $(label).offset().top + 20;
        x = nodeLabelX;
        // when all groups are collapsed, nodeLabelX is zero.
        // then place the button to the right of rack label
        if (x === 0) {
          x = $(label).offset().left + 15;
        }
        var expandButton = $('<input type="button" value="+" />');
        rack.button = expandButton;
        expandButton.appendTo($('body'));
        expandButton.css({left: x, top: y, position: 'absolute'});
        expandButton.on('click',function() {
          // catchServerData = true;  // side effect for debugging
          rack.expanded = true;
          justResetCollapseAllButton = true;
          collapseAllButton.switchButton({checked: false});
          justResetCollapseAllButton = false;
          updateChart('categoriesChanged');
        });
      }
      // buttons on hadoop pages have no border.  add one
      rack.button.css({"border-color": "black",
                       "border-radius": "5px",
                       "border-width":"1px",
                       "border-style":"solid"});


    }
  });
}

// when there is no apps, we need a fake series to show the nodes
function makeFakeSeries() {
  var fakeData = [];
  $.each(groups, function(r, rackId) {
    var rack = groupCollection[rackId];
    if (rack.expanded) {
      for (var n in rack.nodes) {
        fakeData.push([null, null]);
      }
    } else {
      fakeData.push([null, null]);
    }
  });
  var fakeSeries = {
    showInLegend:false,
    enableMouseTracking:false,
    color: '#ddd',
    name: fakeSeriesId,
    id: fakeSeriesId,
    data: fakeData
  };
  return fakeSeries;
}

function addPlotBandAndLine(plotBands, plotLines, isRackBoundary) {
  var newBand = {};
  var newLine = {};

  newBand.from = -0.5;
  if (plotBands.length > 0) {
    newBand.from = plotBands[plotBands.length - 1].to;
  } else {
    plotLines.push({value: -0.5,
                    width: 1,
                    color: 'black',
                    id: 'line_' + plotLines.length.toString(),
                    zIndex: 5
                   });
  }

  newLine.value = plotLines[plotLines.length - 1].value + 1.0;
  newLine.width = isRackBoundary ? 2 : 1;
  newLine.color = 'black';
  newLine.id = 'line_' + plotLines.length.toString();  // needed for removal
  newLine.zIndex = 5;
  plotLines.push(newLine);

  newBand.to = newBand.from + 1.0;
  newBand.id = 'band_' + plotBands.length.toString();  // needed for removal
  newBand.color = '#ddd';
  plotBands.push(newBand);
}

// make categories, plotBands and plotLines
function makeCategories() {
  var categoryIdx = 0;
  var plotBands = [];  // reset with category changes
  var plotLines = [];
  var groupedNodes = [];
  var allCollapsed = true;

  for (var r = 0; r < groups.length; r++) {
    var rackId = groups[r];
    var rack = groupCollection[rackId];
    var group = {};
    groupedNodes.push(group);
    group.name = rackId;

    var n;
    var isRackBoundary = false;
    if (rack.expanded) {
      allCollapsed = false;
      group.categories = rack.nodes;
      for (n = 0; n < rack.nodes.length; n++) {
        nodeCollection[rack.nodes[n]].categoryIdx = categoryIdx++;
        isRackBoundary = false;
        if (n + 1 === rack.nodes.length && r + 1 !== groups.length) {
          isRackBoundary = true;
        }
        addPlotBandAndLine(plotBands, plotLines, isRackBoundary);
        // console.log('category', categoryIdx, rack.nodes[n]);
      }
    } else {
      group.categories = ' ';
      for (n in rack.nodes) {
        nodeCollection[rack.nodes[n]].categoryIdx = -1;
      }
      rack.categoryIdx = categoryIdx++;
      if (r + 1 !== groups.length) {
        isRackBoundary = true;
      }
      addPlotBandAndLine(plotBands, plotLines, isRackBoundary);
      // console.log('category', categoryIdx, rackId);
    }
  }

  // The groupedCategory package does something strange so that the
  // bands are narrower when all groups are collapsed.  Now give more space
  var factor = (allCollapsed) ? 120 : 30;
  chartHeight = categoryIdx * factor;

  return {plotBands: plotBands,
          plotLines: plotLines,
          groupedCategories: groupedNodes,
          xMin: 0,
          xMax: categoryIdx - 1,
          nCategories: categoryIdx};
}

function makeTooltip(series) {
  var tooltip = 'Application: ' + series.name + '<br>';
  var app = apps[series.name];
  var nContainers = app.nContainers;
  var finishTime = app.finishTime;
  var containerType = 'Running';
  var now = new Date().getTime();
  var elapsedTime = (app.appServerState === 'FINISHED') ?
    intervalToHms(finishTime - app.startTime) :
    intervalToHms(now - app.startTime);

  if ('jobType' in app) {
    tooltip += 'Job Type: ' + app.jobType + '<br>';
  }
  if ('priority' in app) {
    tooltip += 'Priority: ' + app.priority + '<br>';
  }
  tooltip += 'Number of ' + containerType + ' Containers: ' + nContainers + '<br>';
  tooltip += 'Start Time: ' + timestampToDate(app.startTime) + '<br>';
  tooltip += 'Elapsed Time: ' + elapsedTime + '<br>';
  var duration = intervalToHms(finishTime - app.startTime);
  tooltip += 'Expected Runtime: ' + duration + '<br>';
  if ('deadline' in app) {
    tooltip += 'Deadline: ' + timestampToDate(app.deadline) + '<br>';
  }
  return tooltip;
}

///// timeline ops /////

// Called after chart creation/update
function processTimeline() {
  if (timeline === null && chartProps.haveData) {
    createTimeline()
  }

  if (timeline === null) {  // still have no timeline
    return;
  }

  var min = chart.yAxis[0].getExtremes().min;
  var max = chart.yAxis[0].getExtremes().max;
  timeline.setWindow(min, max);

  positionTimeline()

  mayStartNowLine = true;
  updateNowLine();
}

function onSelect(info) {
  if (!info.byUser) return;
  chart.yAxis[0].setExtremes(info.start, info.end);
  // chart.yAxis[0].setExtremes(null, null);  // resume auto setting min/max
}

function onDoubleClick(info) {
  chart.yAxis[0].setExtremes(null, null);  // resume auto setting min/max
}

function createTimeline() {
  // create container for timeline
  timelineBox = $('<div>').appendTo($('#general_container'));
  timelineBox.attr('id', 'timelinebox');
  timelineBox.css('background', 'rgba(255, 255, 255, 0.9)');
  timelineBox.css('font-weight', 'bold');

  // increase the height of parent div to contain timeline
  var content = $('#general_container');
  var height = content.height() + 100;
  content.height(height);

  // add hook for timeline repositioning after scroll
  $(window).scroll(function(){
    positionTimeline();
  });

  // add hook for click (select) and double click (go to default)
  var firstClickOnTimeline = true;
  timelineBox.on('click', function(e) {
    // only show help message on the first click
    if (!firstClickOnTimeline) {
      return;
    }
    firstClickOnTimeline = false;

    var wrapper = $(this).parent();
    var parentOffset = wrapper.offset();
    var relX = e.pageX - parentOffset.left + wrapper.scrollLeft();
    var relY = e.pageY - parentOffset.top + wrapper.scrollTop();

    var reminderBox = $('<div>').attr('id', 'reminder');
    var reminderText = $('<p>Double click timeline for auto-scaling.</p>');
    reminderText.appendTo(reminderBox);
    reminderBox.appendTo($('#general_container'));
    reminderBox.css({
      position: 'absolute',
      'border-style': 'solid',
      'border-color': 'grey',
      'border-width': '1px',
      'background-color': '#F9E79F',
      left: relX,
      top: relY
    });
    setTimeout(function() {
      reminderBox.remove();
    }, 5000);
  });

  var min = chart.yAxis[0].getExtremes().min;
  var max = chart.yAxis[0].getExtremes().max;

  // Configuration for the Timeline
  var options = {start: min, end: max,
                 clickToUse: true,
                 showCurrentTime: false,
                 margin: {axis: 0}};

  // Create a Timeline
  timeline = new vis.Timeline(timelineBox[0], null, options);
  timeline.on('rangechanged', onSelect);
  timeline.on('doubleClick', onDoubleClick);

  // buttons to select view window
  var view_window = $('<input />',{
    type: "radio",
    id: "timeline_window_all",
    name: "timeline_window",
    value : "all"
  });
  view_window.prop('checked', true).appendTo(timelineBox).after("all");
  $('<input />',{
    type: "radio",
    id: "timeline_window_week",
    name: "timeline_window",
    value : "week"
  }).appendTo(timelineBox).after("week");
  $('<input />',{
    type: "radio",
    id: "timeline_window_day",
    name: "timeline_window",
    value : "day"
  }).appendTo(timelineBox).after("day");
  $('<input />',{
    type: "radio",
    id: "timeline_window_hour",
    name: "timeline_window",
    value : "hour"
  }).appendTo(timelineBox).after("hour");
  $('input:radio[name="timeline_window"]').change(function() {
    var value = $(this).val();
    console.log('radio button', value);
  });
}

function elt(id) {
    return document.getElementById(id);
}

function positionTimeline() {
  if (elt('timelinebox') === null || elt('highcharts-0') === null) {
    return;
  }

  var marginLeft = chart.plotBox.x;
  timelineBox.css('left', marginLeft + $('#chart_container').offset().left);
  timelineBox.css('position', 'fixed');
  var width = $(chart.container).width() - chart.marginRight - marginLeft;
  timelineBox.width(width);

  var $chart = elt('highcharts-0');
  var $fixed = elt('timelinebox');
  var chartBottom = $chart.getBoundingClientRect().bottom;

  var HEIGHT = $('#highcharts-0').height();
  var FIXED_HEIGHT = $('#timelinebox').height();

  // timeline box has no height before it's actualy placed.  so give it one.
  if (FIXED_HEIGHT === 0) {
    FIXED_HEIGHT = 90;
  }

  var marginLeft = chart.plotBox.x;
  timelineBox.css('left', marginLeft + $('#chart_container').offset().left);
  if (chartBottom + 30 < window.innerHeight) {
    $fixed.style.top = chartBottom + 'px';
  } else {
    $fixed.style.top = (window.innerHeight - FIXED_HEIGHT - 10) + 'px';
  }

  // the window can be too 'high' after rack collapse that the user see
  // a blank window (the interesting part is invisible as the upper portion).
  // thrink the size of container so that the window shrinks. too.
  var content = $('#general_container');
  content.height(chartHeight + 130);
}

///// helper functions /////

var minute = 1000 * 60;

// dump data (whatever) into json format and create a download link
// how to use: add "catchServerData = true" in a button click event
// hanler, e.g. expand/shrink button for racks.  Then at the next
// data loop, the data will be dumped ONCE.
var downloadLink = null;
function dumpData(inData) {
  var date = new Date();
  var hours = date.getHours();
  var minutes = "0" + date.getMinutes();
  var seconds = "0" + date.getSeconds();
  var formattedTime = hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);
  var header = formattedTime + ': ' + errorMsgToDump;
  errorMsgToDump = '';
  var text = header + '\n' + JSON.stringify(inData, null, 2);
  var data = new Blob([text], {type: 'text/plain'});
  var fileName = 'capturedData-' + formattedTime + '.txt';

  if (downloadLink !== null) {
    // destroy old link and data
    window.URL.revokeObjectURL(downloadLink.href);
    downloadLink.parentNode.removeChild(downloadLink);
  }

  var hrefStr = '<a download="' + fileName + '" id="downloadlink">Download captured data</a>';
  $(hrefStr).prependTo($('#general_container'));  // parent is on html page
  downloadLink = document.getElementById('downloadlink');
  downloadLink.href = window.URL.createObjectURL(data);
  downloadLink.style.display = 'block';
}

function intervalToHms(d) {
  d = Number(d / 1000);
  var h = Math.floor(d / 3600);
  var m = Math.floor(d % 3600 / 60);
  var s = Math.floor(d % 3600 % 60);
  return ((h > 0 ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s);
}

function timestampToDate(d) {
  var a = new Date(d);
  var year = a.getFullYear();
  var month = a.getMonth() + 1;
  var date = a.getDate();
  var ymd = year + '-' + (month < 10 ? '0' : '') + month + '-' +
    (date < 10 ? '0' : '') + date;
  var h = a.getHours();
  var m = a.getMinutes();
  var s = a.getSeconds();
  var hms = intervalToHms((((h * 60) + m) * 60 + s) * 1000);
  var time = ymd + ' ' + hms;
  return time;
}
