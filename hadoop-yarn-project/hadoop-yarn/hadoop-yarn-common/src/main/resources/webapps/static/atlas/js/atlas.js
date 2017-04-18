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
var chartProps = {}; // plotBands/Lines, groupedCategories, nCategories, etc
var chartHeight = 0;
var windowChartWidthDiff = 0;
var chartMinMax = [null, null];  // let chart decide, or set by timeline

// apps are indexed by application id.
// the structure maintains the state of the apps across refresh.
// app's state: new, updated, unchanged (since last refresh)
// an app has an index to the series array for the chart
var apps = {};
var series = [];

var nodesProcessed = false;
var nodeCollection = {};  // node id -> app usage, state, categoriesIdx, etc
function nodeInfo(fullId) {
  this.fullId = fullId;
  this.id = fullId.split('.')[0];  // e.g. get node4 in node4.example.com
  this.categoryIdx = -1;
  // [start, finish, load, appSet] chronologically ordered intervals
  this.appUsage = [];
}

var rackCollection = {};  // rack id -> nodes, expanding state, etc
var racks = [];  // sorted short rack id
function rackInfo(rackId) {
  this.id = rackId;
}
rackInfo.prototype.seriesId = function() {
  return 'Atlas_rack_' + this.id;
};
rackInfo.prototype.seriesColor = function() {
  return 'rgba(255, 165, 0, 0.3)';
};
rackInfo.prototype.changeExpandState = function(expand) {
  // if the new state agrees with the current state, do nothing
  if (this.expanded? expand : !expand) {
    return;
  }
  this.expanded = expand;
  numCollapsedRacks += expand? -1 : 1;
};
rackInfo.prototype.flipExpandState = function() {
  this.changeExpandState(!this.expanded);
};

// vertical spacing
var bandHeight = 20;
var chartHeightPadding = 40;
var collapsedRackMultiple = 3;  // multiple of node band for a collapsed rack
var timelineHeight = 130;

// When a node is used by multiple apps at the same time,
// they show up on the bar like zebra stripes. each app has a small slice
// of its color and the pattern repeats to cover the interval.  The
// following controls the width of each slice.
var pixelsPerSlice = 10;  // width of a slice
var intervalPerSlice = 0;  // how much time elapsed withing the slice

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
var collapseAllButton = null;
var numCollapsedRacks = 0;
var changeCollapseAllButtonWithAction = true;

// variables for debugging
var catchServerData = false;
var errorMsgToDump = '';
var callServerOnlyOnce = true;

///// top level functions /////

function atlasPageEntryPoint() {
  document.title = 'Application Atlas';  // title for browser tab

  // setInterval first waits for the interval, then executes the code inside.
  // To make the data appear faster, run one interation outside first.
  console.log('start to call server');
  getDataFromServer();

  if (callServerOnlyOnce) {
    // when debugging, we don't want to see repeated error msgs from the
    // same bug.  so just call server once.
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

  // If the app doesn't have the finish time, the finish time is now.  To keep
  // current time uniform for different apps and nodes so that the "now" line
  // fits well, we keep one copy of the current time for every use case in
  // refresh cycle. currentTimeUsed becomes true, if the uniform time is used
  // in the current loop so that "now" line will use the uniform time, too.
  timeInCurrentLoop = new Date().getTime();
  currentTimeUsed = false;  // will become true if used in the current loop

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

  buildNodesUsage();  // scan uncollapsed nodes to handle overlapping app usage
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
      text: null
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
        borderWidth: 0,
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

function updateChart(cause) {
  var needRedraw = false;
  var layoutChanged = false;
  var min = chart.yAxis[0].getExtremes().min;
  var max = chart.yAxis[0].getExtremes().max;

  var rack, rackId;
  if (cause === 'categoriesChanged') {
    // this update is caused by rack collapse/expand
    var bandIds = [];
    var lineIds = [];
    var b, l;

    newProps = makeCategories();
    layoutChanged = true;
    needRedraw = true;

    chart.setSize($('#chart_container').width(), chartHeight, false);

    // Remove all existing bands and lines before adding new ones.
    // Must copy the band/line ids before removing.  highchart directly
    // removes from MY data structures.  So must keep the ids separately.
    for (b in chartProps.plotBands) {
      bandIds.push(chartProps.plotBands[b].id);
    }
    for (b in bandIds) {
      chart.xAxis[0].removePlotBand(bandIds[b]);
    }
    for (b in newProps.plotBands) {
      chart.xAxis[0].addPlotBand(newProps.plotBands[b]);  // check after rack expand/collapse
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

    for (rackId in rackCollection) {
      rack = rackCollection[rackId];
      if (chart.get(rack.seriesId()) !== null) {
        chart.get(rack.seriesId()).remove(false);
      }

      if (rack.button !== null) {
        rack.button.remove();  // remove the old buttons
        rack.button = null;
      }
    }

    chart.xAxis[0].setCategories(newProps.groupedCategories, false);
    chart.xAxis[0].setExtremes(newProps.xMin, newProps.xMax);
    newProps.haveData = chartProps.haveData;  // app data accumulate
    chartProps = newProps;
  }

  // add rack series. If categories have changed, code above should have
  // removed all existing rack series' already.
  for (rackId in rackCollection) {
    rack = rackCollection[rackId];
    if (rack.expanded) {  // no rack series for expanded racks
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
  buildNodesUsage();
  for (var appId in apps) {
    var app = apps[appId];
    var seriesId = apps[appId].seriesId;
    if (app.haveNewData || layoutChanged || cause === 'timescaleChanged') {
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

  // chart time window: if not set by timeline, highchart decides by default.
  // With rack collapse/expend, highchart's redraw may shift its viewing
  // time window.  To keep the window stable, we record the current time
  // window and set it.  If the update is caused by data refresh, then we
  // set the default back to "let highchart decide".
  if (chartMinMax[0] === null) {  // time window not set by timeline
    if (cause !== undefined) {  // not caused by data refresh
      chart.yAxis[0].setExtremes(min, max);  // set to saved size
    } else {  // caused by data refresh
      chart.yAxis[0].setExtremes(null, null);  // let highchart decide
    }
  }
  if (needRedraw) {
    chart.redraw();
  }
  if (layoutChanged) {
    addRackButtons();
  }

  processTimeline();  // "now" line is handled, too
}

///// incoming data processing /////

function intervalsOverlap(d1, d2) {
  return (d1[0] < d2[1] && d2[0] < d1[1]) ? true : false;
}

// update app state and save the current dataset for the app.
// Note: finished app has an empty list of nodesInUse argument.
function updateAppState(inApp, nodesInUse, finished) {
  var id = inApp.applicationId;
  if (id in apps && apps[id].finished) {
    // now we know the app is finished from previous rounds
    return;
  }

  if (!(id in apps)) {  // make new app entry
    apps[id] = {};
    apps[id].nodesInUse = {};
    apps[id].seriesId = appSeriesPrefix + id;
    apps[id].color = null;
  }
  var app = apps[id];

  app.finished = finished;
  app.haveNewData = true;
  app.startTime = inApp.startTime;
  var finishTime = Number(inApp.finishTime);
  if (finishTime === 0) {
    app.finishTime = timeInCurrentLoop;
    currentTimeUsed = true;
  }
  app.serverState = inApp.state;
  app.nContainers = Object.keys(nodesInUse).length;

  // go through the nodes used and record the duration of their use.
  // If a node is already on record, only change its finishTime.
  // xxx need to consider multiple apps on the same node.
  $.each(nodesInUse, function(n, duration) {
    if (n in app.nodesInUse) {
      // xxx add two asserts: start time remains same and there is only one
      // time section
      app.nodesInUse[n][1] = duration[1];
    } else {
      app.nodesInUse[n] = [duration[0], duration[1]];
    }
  });
}

function processApps(inApps) {
  $.each(inApps, function(index, inApp) {
    var finishedApp = false;
    var nodesInUse = {};  // node -> [startTime, finishTime]
    var finishTime = 0;

    if (inApp.state === 'FINISHED') {
      // If an app has already finished when Atlas is started,
      // we don't show the app because the server doesn't provide
      // containers for a finished and we don't have interesting info to show
      if (!(inApp.applicationId in apps)) {
        return true;
      }
      finishedApp = true;
    } else if (inApp.state !== 'RUNNING') {
      // xxx pop up error then continue
      console.log('invalid app state:', inApp.applicationId. inApp.state);
      return true;  // still continue processing apps
    } else {
      $.each(inApp.containers, function(c, container) {
        startTime = container.creationTime;
        finishTime = timeInCurrentLoop;
        currentTimeUsed = true;
        var nodeId = (new nodeInfo(container.node)).id;
        nodesInUse[nodeId] = [startTime, finishTime];
      });
    }

    updateAppState(inApp, nodesInUse, finishedApp);
  });
}

// Nodes from the server have rack property.  So rackCollection structure
// is also made here.
function processNodes(inNodes) {
  if (nodesProcessed) {
    return;  // don't need re-process racks because they don't change
  }

  $.each(inNodes, function(index, inNode) {
    var node = new nodeInfo(inNode.nodeId);
    var rackId = inNode.rack;
    if (rackId === undefined || $.trim(rackId) === '') {
        rackId = 'undefined';  // no rack or rack name as white spaces
    } else if (inNode.rack[0] === '/') {  // common leading char in rack name string
      rackId = rackId.substr(1);  // xxx rethink
    }
    nodeCollection[node.id] = node;

    // rackInfo is derived from node. a previous node may have built the rack
    if (rackId in rackCollection) {
      rackCollection[rackId].nodes.push(node.id);  // add node into rackInfo
    } else {
      var rack = new rackInfo(rackId);
      rackCollection[rackId] = rack;

      rack.fullId = inNode.rack;
      rack.nodes = [node.id];
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

  nodesProcessed = true;
}

///// data related chart ops /////

// mainly deal with overlapping usage of apps on a node.
// for each node, find apps using it and cut usage into intervals each
// of which is shared by the same set of apps.
function buildNodesUsage() {
  var timeWindowMin = 0;
  var timeWindowMax = 0;
  var haveNewData = false;

  for (var appId in apps) {
    haveNewData |= apps[appId].haveNewData;
  }
  if (!haveNewData) {  // nothing has changed
    return;
  }

  $.each(nodeCollection, function(n, node) {
    if (node.categoryIdx === -1) {
      return true;  // on a collapsed rack
    }

    // build usage of all apps on one node
    var data = [];

    $.each(apps, function(appId, app) {
      var duration = app.nodesInUse[n];
      if (duration !== undefined) {
        data = accumulateUsage(data, appId, duration[0], duration[1]);
        timeWindowMin = (timeWindowMin === 0) ? duration[0] :
          Math.min(duration[0], timeWindowMin);
        timeWindowMax = Math.max(duration[1], timeWindowMax);
      }
    });
    node.appUsage = data;

    // if an app has new data, all apps sharing the interval has new data
    $.each(apps, function(appId, app) {
      for (var d in data) {
        if (appId in data[d].sharerSet) {
          for (var a in data[d].sharerSet) {
            app.haveNewData |= apps[a].haveNewData;
          }
        }
      }
    });
  });

  // use chart's two ends to compute time interval per slice.
  // if chart is not created yet, then use current app's durations to estimate
  if (chart !== null) {
    timeWindowMin =  chart.yAxis[0].getExtremes().min;
    timeWindowMax =  chart.yAxis[0].getExtremes().max;
  }
  intervalPerSlice = (timeWindowMax - timeWindowMin) /
    $('#chart_container').width() * pixelsPerSlice;
  console.log('per slice in node usage', intervalPerSlice);
}

function makeSeriesForOneRack(rackId) {
  var rack = rackCollection[rackId];
  var data = [];

  for (var appId in apps) {
    var app = apps[appId];
    for (var n in rack.nodes) {
      var nodeId = rack.nodes[n];
      if (nodeId in app.nodesInUse) {
        var duration = app.nodesInUse[nodeId];
        data = accumulateUsage(data, nodeId, duration[0], duration[1]);
      }
    }
  }

  var dataSet = [];
  var b = rack.categoryIdx + 0.5;
  var nNodes = rack.nodes.length;
  for (var i = 0; i < data.length; i++) {
    var nUsed = Object.keys(data[i].sharerSet).length;
    var h = b - Number(nUsed) / Number(nNodes) * collapsedRackMultiple;
    // console.log('height', h, b, nNodes);

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

  var rackSeries = {
    type: 'polygon',
    showInLegend: false,
    id: rack.seriesId(),
    name: rack.seriesId(),
    shadow: true,
    color: rack.seriesColor(),
    data: dataSet
  };

  return (dataSet.length === 0) ? null: rackSeries;
}

// Can be used to build usage for a rack (how many nodes are sharing each
// time interval, or for a node (what apps are sharing the node).
function accumulateUsage(inData, sharerId, start, finish) {
  var data = inData;
  var newInterval = null;
  var interval = null;
  var i = 0;
  var startIdx = -1;
  var endIdx = -1;

  var startTime = start;
  var finishTime = finish;

  // the resulting data interval is {from, too, sharerSet}
  // sharerSet can be a set of nodes or apps, depending who's calling.

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

  var newSharerSet = {};
  newSharerSet[sharerId] = ' ';

  if (startIdx === -1 || endIdx === -1) {
    newInterval = {from: startTime,
                   to: finishTime,
                   sharerSet: newSharerSet};
    data.splice(((endIdx !== -1) ? endIdx + 1 : 0), 0, newInterval);
    // console.log('simple insert');
    return data;
  }

  // when start/finish time is in an interval, split
  interval = data[startIdx];
  if (startTime > interval.from) {
    // split interval into two.  First part is not in start/finish range
    // also need to duplicate sharerSet for the new interval
    newInterval = {from: startTime,
                   to: interval.to,
                   sharerSet: Object.assign({}, interval.sharerSet)};
    data.splice(++startIdx, 0, newInterval);
    endIdx++;  // shift end index as well
    interval.to = startTime;
    // console.log('split start piece', interval, newInterval);
  }

  interval = data[endIdx];
  if (finishTime < interval.to) {
    newInterval = {from: finishTime,
                   to: interval.to,
                   sharerSet: Object.assign({}, interval.sharerSet)};
    data.splice(endIdx + 1, 0, newInterval);
    interval.to = finishTime;
    // console.log('split end piece at endIdx', data[endIdx], data[endIdx+1]);
  }

  // slice data into three parts: before, range, after
  var before = data.slice(0, startIdx);  // may result empty array
  var range = data.slice(startIdx, endIdx + 1);  // may be empty
  var after = data.slice(endIdx + 1, data.length);  // may be empty

  // add 1 to exiting intervals and fill the gap between and on either end
  // of the range.  loop backward to avoid index shifting
  for (i = range.length - 1; i >= 0; i--) {
    // console.log('before increment', i, range[i]);
    range[i].sharerSet[sharerId] = ' ';  // add sharer, value not important

    if (i === range.length - 1 && finishTime > range[i].to) {
      newInterval = {from: range[i].to,
                     to: finishTime,
                     sharerSet: newSharerSet};
      range.push(newInterval);  // add at the end
      // console.log('push', i, newInterval);
    }
    if (i > 0 && range[i - 1].to < range[i].from) {  // fill gap in between
      newInterval = {from: range[i - 1].to,
                     to: range[i].from,
                     sharerSet: newSharerSet};
      range.splice(i, 0, newInterval);
      // console.log('fill gap', i, newInterval);
    }
    if (i === 0 && startTime < range[i].from) {
      newInterval = {from: startTime,
                     to: range[i].from,
                     sharerSet: newSharerSet};
      range.unshift(newInterval);  // insert at the beginning
      // console.log('unshift', i, newInterval);
    }
  }
  if (range.length === 0) {  // start/finish range falls in a gap
    newInterval = {from: startTime,
                   to: finishTime,
                   sharerSet: newSharerSet};
    range.push(newInterval);
    // console.log('only one', newInterval);
  }

  // xxx make sure my understanding of my own code is correct
  console.assert(range[0].from === startTime &&
         range[range.length - 1].to === finishTime, 'range assumption broken');

  // merge two touching intervals that have the same value and same appset.
  // This can happen ONLY at either end of the range
  if (before.length !== 0 &&
      before[before.length - 1].to === range[0].from &&
      dictionariesEqual(before[before.length - 1].sharerSet, range[0].sharerSet)) {
    // console.log('merge first', before[before.length - 1], range[0]);
    range[0].from = before[before.length - 1].from;
    before.pop();
  }
  if (after.length !== 0 &&
      after[0].from === range[range.length - 1].to &&
      dictionariesEqual(after[0].sharerSet, range[range.length - 1].sharerSet)) {
    // console.log('merge last', range[range.length - 1], after[0]);
    after[0].from = range[range.length - 1].from;
    range.pop();
  }

  data = before.concat(range, after);
  return data;
}  // buildRackUsage()

function makeSeriesForOneApp(appId) {
  var dataSet = [];

  // go through all nodes in use for the app
  $.each(apps[appId].nodesInUse, function(n, duration) {
    if (nodeCollection[n].categoryIdx === -1) {
      return true;
    }

    // go through each duration segment on the node
    $.each(nodeCollection[n].appUsage, function(d, duration) {
      if (!(appId in duration.sharerSet)) {  // not used by the app
        return true;
      }

      // present app slices sorted on appId, for consistent color patterns
      var orderInSet = Object.keys(duration.sharerSet).sort().indexOf(appId);

      var nAppsSharing = Object.keys(duration.sharerSet).length;
      var stride = (nAppsSharing === 1) ? (duration.to - duration.from) :
        (intervalPerSlice * nAppsSharing);
      var strideCount = 0;

      while (true) {
        var currentPos = duration.from + stride * strideCount +
          intervalPerSlice * orderInSet;
        var currentPosEnd = (nAppsSharing === 1) ? duration.to :
          Math.min(currentPos + intervalPerSlice, duration.to);

        if (currentPos >= duration.to) {
          break;
        }

        var slice = {x: nodeCollection[n].categoryIdx,
                     low: currentPos,
                     high: currentPosEnd};
        dataSet.push(slice);
        strideCount++;
      }
    });
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
  apps[appId].haveNewData = false;

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
    if (changeCollapseAllButtonWithAction) {
      for (var g in rackCollection) {
        rackCollection[g].changeExpandState(!this.checked);
      }
      updateChart('categoriesChanged');
    }
  });
}

function addRackButtons() {
  var nodeLabelX = 0;  // x for expand button, align with node label
  var x, y;

  // xxx Since there is no api to find the labels, I use a dirty way.
  // All labels are children of an element of xaxis-labels class.
  // -- czang@cmu.edu

  // The first loop is to find the x of a node label.  Needed to
  // place expand buttons which align with node labels.
  $('.highcharts-xaxis-labels').children().each(function(i, label) {
    if (label.textContent in nodeCollection) {  // label is rack
      nodeLabelX = $(label).offset().left;
      return false;  // done with loop once a noce label is seen
    }
  });

  $('.highcharts-xaxis-labels').children().each(function(i, label) {
    if (label.textContent in rackCollection) {  // only care about rack label
      var rackId = label.textContent;
      var rack = rackCollection[rackId];

      // if the rack is too small, there is no space for the expand button
      if (rack.nodes.length < collapsedRackMultiple && rack.expanded) {
        rack.button = null;
        return true;
      }

      var button = rack.expanded ? $('<input type="button" value="-" />') : $('<input type="button" value="+" />');
      rack.button = button;
      button.appendTo($('body'));
      // buttons on hadoop pages have no border.  add one
      button.css({'border-color': 'black',
                  'border-radius': '5px',
                  'border-width': '1px',
                  'font-family': 'monospace',
                  'border-style': 'solid'});

      // position the button below rack name and center it
      var labelW = $(label)[0].getBoundingClientRect().width;
      var buttonW = button[0].getBoundingClientRect().width;
      x = $(label).offset().left + (labelW - buttonW) / 2;
      y = $(label).offset().top + 15;
      button.css({left: x, top: y, position: 'absolute'});

      button.on('click', function() {
        rack.flipExpandState();
        updateChart('categoriesChanged');

        // change collaps-all button's state when all racks are collapsed.
        // but we don't want the handler to do any real work because it's
        // done here.
        changeCollapseAllButtonWithAction = false;
        collapseAllButton.switchButton({checked: (numCollapsedRacks === racks.length)});
        changeCollapseAllButtonWithAction = true;
      });
    }
  });
}

// when there is no apps, we need a fake series to show the nodes
function makeFakeSeries() {
  var fakeData = [];
  $.each(racks, function(r, rackId) {
    var rack = rackCollection[rackId];
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

function addPlotBandAndLine(plotBands, plotLines, isRackBoundary, isRack) {
  var newBand = {};
  var newLine = {};
  var spacing = isRack? 1.0 * collapsedRackMultiple : 1.0;

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

  newLine.value = plotLines[plotLines.length - 1].value + spacing;
  newLine.width = isRackBoundary? 2 : 1;
  newLine.color = 'black';
  newLine.id = 'line_' + plotLines.length.toString();  // needed for removal
  newLine.zIndex = 5;
  plotLines.push(newLine);

  newBand.to = newBand.from + spacing;
  newBand.id = 'band_' + plotBands.length.toString();  // needed for removal
  newBand.color = isRack? '#dde' : '#ddd';  // rack is purple and node grey
  plotBands.push(newBand);
}

// make categories, plotBands and plotLines
function makeCategories() {
  var categoryIdx = 0;
  var plotBands = [];  // reset with category changes
  var plotLines = [];
  var groupedNodes = [];
  var allCollapsed = true;

  for (var r = 0; r < racks.length; r++) {
    var rackId = racks[r];
    var rack = rackCollection[rackId];
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
        if (n + 1 === rack.nodes.length && r + 1 !== racks.length) {
          isRackBoundary = true;
        }
        addPlotBandAndLine(plotBands, plotLines, isRackBoundary, false /* isTrack */);
        // console.log('category', categoryIdx, rack.nodes[n]);
      }
    } else {
      // for a collapsed rack, use more vertical space by givng it multiple
      // bands (see collapsedRackMultiple).
      // To fool the grouped-category module, give each band a name that's
      // just blanks.  The number of blanks should be different so that they can
      // be identified in grouped-category.  See comment by czang in that
      // module.
      group.categories = [];
      var spaces = '';
      for (var i = 0; i < collapsedRackMultiple; i++) {
        group.categories.push(spaces);
        spaces = spaces + ' ';
      }

      for (n in rack.nodes) {
        nodeCollection[rack.nodes[n]].categoryIdx = -1;
      }
      rack.categoryIdx = categoryIdx + collapsedRackMultiple - 1;
      categoryIdx += collapsedRackMultiple;
      if (r + 1 !== racks.length) {
        isRackBoundary = true;
      }
      addPlotBandAndLine(plotBands, plotLines, true, true);
      // console.log('category', categoryIdx, rackId);
    }
  }

  chartHeight = categoryIdx * bandHeight + chartHeightPadding;

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
    makeTimeline();
  }
  if (timeline === null) {  // no timeline => never having data
    return;
  }

  var min = chart.yAxis[0].getExtremes().min;
  var max = chart.yAxis[0].getExtremes().max;
  timeline.setWindow(min, max);

  positionTimeline();

  mayStartNowLine = true;  // now line exists only with timeline
  updateNowLine();
}

// when timeline changes, the multi-app nodes may need to redraw
// when the timescale changes too much (more than 10%)
function considerUpdate(timescaleMin, timescaleMax) {
  var newInterval = (timescaleMax - timescaleMin) /
    $('#chart_container').width() * pixelsPerSlice;
  if (Math.abs(newInterval - intervalPerSlice) / intervalPerSlice > 0.1) {
    intervalPerSlice = newInterval;
    updateChart('timescaleChanged');
  }
}

function onSelect(info) {
  if (!info.byUser) return;

  // if simplying using the start/end points given by timeline, the
  // re-scaled chart may be off-center or even out of the viewing window.
  // here we distinguish the scale change (vs sliding change) and try to
  // scale both ends of the chart evenly.

  var timeWindowMin =  chart.yAxis[0].getExtremes().min;
  var timeWindowMax =  chart.yAxis[0].getExtremes().max;
  var oldInterval = timeWindowMax - timeWindowMin;
  var newInterval = info.end - info.start;
  var scaleChange = (oldInterval - newInterval) / oldInterval;

  if (Math.abs(scaleChange) > 0.1) {  // scale change, not sliding change
    timeWindowMin += (oldInterval - newInterval) / 2;
    timeWindowMax -= (oldInterval - newInterval) / 2;
  } else {
    timeWindowMin = info.start;
    timeWindowMax = info.end;
  }

  chart.yAxis[0].setExtremes(timeWindowMin, timeWindowMax);
  considerUpdate(timeWindowMin, timeWindowMax);
}

function onDoubleClick(info) {
  chartMinMax = [null, null];
  chart.yAxis[0].setExtremes(null, null);  // resume auto setting min/max
  considerUpdate(chart.yAxis[0].getExtremes().min,
                 chart.yAxis[0].getExtremes().max);
}

function makeTimeline() {
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
    type: 'radio',
    id: 'timeline_window_all',
    name: 'timeline_window',
    value : 'all'
  });
  view_window.prop('checked', true).appendTo(timelineBox).after('all');
  $('<input />',{
    type: 'radio',
    id: 'timeline_window_week',
    name: 'timeline_window',
    value : 'week'
  }).appendTo(timelineBox).after('week');
  $('<input />',{
    type: 'radio',
    id: 'timeline_window_day',
    name: 'timeline_window',
    value : 'day'
  }).appendTo(timelineBox).after('day');
  $('<input />',{
    type: 'radio',
    id: 'timeline_window_hour',
    name: 'timeline_window',
    value : 'hour'
  }).appendTo(timelineBox).after('hour');
  $('input:radio[name="timeline_window"]').change(function() {
    var value = $(this).val();
    console.log('radio button', value);
  });
}

function positionTimeline() {
  if (timeline === null) {
    return;
  }

  // issues here:
  // 1. timeline should be closely placed at the bottom of the chart
  // 2. when the window height is reduced or the window is scrolling,
  // timeline always stays in the view port (sticky)
  // 3. the left/right ends of the timeline should align with the data part
  // of the chart.

  var marginLeft = chart.plotBox.x;
  timelineBox.css('left', marginLeft + $('#chart_container').offset().left);
  timelineBox.css('position', 'fixed');
  var width = $(chart.container).width() - chart.marginRight - marginLeft;
  timelineBox.width(width);

  var $chartHtml = document.getElementsByClassName('highcharts-container')[0];
  var $timelineHtml = document.getElementById('timelinebox');
  var chartBottom = $chartHtml.getBoundingClientRect().bottom;

  var chartHeight = $($chartHtml).height();
  var timelineHeight = $($timelineHtml).height();

  // timeline box has no height before it's actualy placed.  so give it one.
  timelineHeight = (timelineHeight === 0) ? 90 : timelineHeight;

  timelineBox.css('left', marginLeft + $('#chart_container').offset().left);
  if (chartBottom + 30 < window.innerHeight) {
    $timelineHtml.style.top = chartBottom + 'px';
  } else {
    $timelineHtml.style.top = (window.innerHeight - timelineHeight - 10) + 'px';
  }

  // the window can be too 'high' after rack collapse that the user see
  // a blank window (the interesting part is invisible as the upper portion).
  // thrink the size of container so that the window shrinks. too.
  var content = $('#general_container');
  content.height(chartHeight + timelineHeight);
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
  var minutes = '0' + date.getMinutes();
  var seconds = '0' + date.getSeconds();
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
  return ((h > 0 ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s);
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

function dictionariesEqual(d1, d2) {
  return (JSON.stringify(d1) === JSON.stringify(d2));
}
