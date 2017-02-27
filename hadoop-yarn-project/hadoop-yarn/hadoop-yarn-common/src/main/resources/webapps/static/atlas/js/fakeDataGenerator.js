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

// a fake data generator for atlas.  It's a combination of captured data
// and functions that add to the captured data and serve it to atlas.

var capturedData = {"nodes":[{"rack":"/r0","nodeId":"rr329.narwhal.pdl.cmu.edu:52702"},{"rack":"/r0","nodeId":"rr369.narwhal.pdl.cmu.edu:54246"},{"rack":"/r1","nodeId":"rr266.narwhal.pdl.cmu.edu:53903"},{"rack":"/r1","nodeId":"rr319.narwhal.pdl.cmu.edu:49253"},{"rack":"/r1","nodeId":"rr134.narwhal.pdl.cmu.edu:39776"},{"rack":"/r0","nodeId":"rr263.narwhal.pdl.cmu.edu:44088"},{"rack":"/r0","nodeId":"rr288.narwhal.pdl.cmu.edu:52770"},{"rack":"/r1","nodeId":"rr356.narwhal.pdl.cmu.edu:39321"}],
"apps":[
{"appName":"6_9_120_120_110_110_0_0_362","applicationId":"application_1454444273400_0010","reservationId":"reservation_1454444273400_0011","startTime": 1454523171378, "finishTime":0,"state":"RUNNING","ranNodes":["rr288.narwhal.pdl.cmu.edu:52770"],"containers":[{"node":"rr288.narwhal.pdl.cmu.edu:52770","creationTime":1454523100000 /*71546*/,"finishTime":0}]},
// {"appName":"6_9_121_121_111_111_0_0_363","applicationId":"application_1454444273400_0011","reservationId":"reservation_1454444273400_0010","startTime":1454523175187,"finishTime":0,"state":"RUNNING","ranNodes":["rr369.narwhal.pdl.cmu.edu:54246"],"containers":[{"node":"rr369.narwhal.pdl.cmu.edu:54246","creationTime":1454523176010,"finishTime":0}]},
{"appName":"6_9_120_120_110_110_0_0_360","applicationId":"application_1454444273400_0012","reservationId":"reservation_1454444273400_0012","startTime":1454523175240,"finishTime":0,"state":"RUNNING","ranNodes":["rr263.narwhal.pdl.cmu.edu:44088","rr134.narwhal.pdl.cmu.edu:39776","rr356.narwhal.pdl.cmu.edu:39321"],"containers":[{"node":"rr263.narwhal.pdl.cmu.edu:44088","creationTime":1454523176015,"finishTime":0},{"node":"rr134.narwhal.pdl.cmu.edu:39776","creationTime":1454523295106,"finishTime":0},{"node":"rr356.narwhal.pdl.cmu.edu:39321","creationTime":1454523295107,"finishTime":0}]},
// {"appName":"fake_1","applicationId":"application_fake_1","reservationId":"reservation_fake_1","startTime":1454524371378, "finishTime":0,"state":"RUNNING","ranNodes":["rr329.narwhal.pdl.cmu.edu:52770"],"containers":[{"node":"rr329.narwhal.pdl.cmu.edu:52770","creationTime":1454524371378,"finishTime":0}]},
// {"appName":"fake_2","applicationId":"application_fake_2","reservationId":"reservation_fake_2","startTime":1454524175187,"finishTime":0,"state":"RUNNING","ranNodes":["rr369.narwhal.pdl.cmu.edu:54246"],"containers":[{"node":"rr369.narwhal.pdl.cmu.edu:54246","creationTime":1454524176010,"finishTime":0}]},
{"appName":"fake_3","applicationId":"application_fake_3","reservationId":"reservation_fake_3","startTime":1454524175240,"finishTime":0,"state":"RUNNING","ranNodes":["rr319.narwhal.pdl.cmu.edu:44088","rr266.narwhal.pdl.cmu.edu:39776", /*"rr263.narwhal.pdl.cmu.edu:39321"*/],"containers":[{"node":"rr319.narwhal.pdl.cmu.edu:44088","creationTime":1454524176015,"finishTime":0},{"node":"rr266.narwhal.pdl.cmu.edu:39776","creationTime":1454524295106,"finishTime":0}/* ,{"node":"rr263.narwhal.pdl.cmu.edu:39321","creationTime":1454524295107,"finishTime":0}*/]}
]};

var testPartition = true;
var useCapturedData = true;
var nRefresh = 0;
var partitionPool = null;
var partitionPoolUsage = null;
var maxNumPartitions = 3;
var interval = 0;
var addMoreNodes = true;  // set to true if adding more nodes
var nExtraNodes = 20;  // number of fake nodes to add

function addNodes() {
  addMoreNodes = false;
  for (var i = 0; i < nExtraNodes; i++) {
    var rackId = '/R' + (Math.floor(i / 8) + 100);
    var nodeId = 'rr' + String(1000 + i);
    capturedData.nodes.push({rack: rackId, nodeId: nodeId});
  }
}

var nodesFromCapturedData = null;
function getNodesFromCapturedData() {
  if (addMoreNodes) {
    addNodes();
  }

  if (!testPartition) {
    return capturedData.nodes;
  }

  var n;
  if (partitionPool === null) {
    // init.  All nodes goes into partition p0
    partitionPool = {};
    partitionUsage = {};
    partitionPool.p0 = [];
    for (n in capturedData.nodes) {
      var nodeId = capturedData.nodes[n].nodeId.split('.')[0];
      partitionPool.p0.push(nodeId);
      partitionUsage.p0 = 0;
    }
  } else {
    splitPartition();
  }

  var nodes = [];
  for (n in capturedData.nodes) {
    var node = capturedData.nodes[n];
    node.partition = nodeToPartition(node.nodeId.split('.')[0]);
    nodes.push(node);
  }

  nodesFromCapturedData = nodes;
  return nodes;
}

function getFakeData(callServerOnlyOnce) {
  var nodes = getNodesFromCapturedData();
  var upper = callServerOnlyOnce ? 6 : nRefresh;
  var apps = getAppsFromCapturedData().slice(0, upper);

  // prepare for the next time when data is served
  nRefresh++;
  if (nRefresh % 10 === 0) {
    addOneNode(0);  // add a node into app 0
  }
  if (nRefresh === 5) {
    finishOneApp(2);  // finish the app but will start later
  }
  if (nRefresh === 7) {
    restartOneApp(2);  // restart preempted job
  }
  if (nRefresh === 10) {
    finishOneApp(2);  // finish the app but will start later
  }
  if (nRefresh === 14) {
    restartOneApp(2);  // restart preempted job
  }

  return {nodes: nodes, apps: apps};
}

function makeOneAllocation(inApp, maxStartTime) {
  // pending allocation starts about 15 minutes after last job start
  var startTime = inApp.startTime + 30 * minute + Math.random() * 10 * minute;
  var finishTime = startTime + 10 * minute + Math.random() * 10 * minute;

  var partitions = {};
  for (i = 0; i < 1; i++) {  // second one must be different from first one
    var p = 'p' + parseInt(Math.random() * 10) % Object.keys(partitionPool).length;
    var remaining = partitionPool[p].length - partitionUsage[p];
    var usage = Math.floor(Math.random() * 10) % 2 + 1;  // get 1 or 2
    usage = Math.min(remaining, usage);
    // usage = Math.floor(remaining / 2);  // get half of remaining nodes
    if (usage > 0) {
      // console.log(p, inApp.applicationId, usage, startTime, finishTime);

      partitionUsage[p] += usage;
      partitions[p] = usage;
    }
  }

  var oneAllocation = null;
  if (Object.keys(partitions).length > 0) {
    oneAllocation = {startTime: startTime,
                     finishTime: finishTime,
                     partitions: partitions
                    };
  }
  return oneAllocation;
}

var totalPendingAlloc = {};
function addPendingAllocations(inApp) {
  if (!useCapturedData) {
    return;
  }

  if (capturedPendingAlloc !== null &&
      inApp.applicationId in capturedPendingAlloc) {
    inApp.pending_future_allocations =
      capturedPendingAlloc[inApp.applicationId];
    return;
  }

  var maxStartTime = 0;
  for (var a in capturedData.apps) {
    maxStartTime = Math.max(capturedData.apps[a].startTime, maxStartTime);
  }

  var pendingAllocations = [];
  for (var i = 0; i < 2; i++) {
    var oneAllocation = makeOneAllocation(inApp, maxStartTime);
    if (oneAllocation !== null) {
      pendingAllocations.push(oneAllocation);
    }
  }
  if (pendingAllocations.length > 0) {
    inApp.pending_future_allocations = pendingAllocations;
  }

  totalPendingAlloc[inApp.applicationId] = pendingAllocations;
}

var split = false;
function splitPartition() {
  if (!split) {
    return;
  }

  if (++interval % 2 !== 0) {
    return;
  }

  if (Object.keys(partitionPool).length >= maxNumPartitions) {
    return;
  }
  
  var nextId = 'p' + Object.keys(partitionPool).length;
  for (var p in partitionPool) {
    var nodes = partitionPool[p];
    if (nodes.length > 1) {
      var middle = Math.floor(nodes.length / 2);
      var first = nodes.slice(0, middle);
      var second = nodes.slice(middle, nodes.length);
      partitionPool[nextId] = second;
      partitionPool[p] = first;
      partitionUsage[p] = 0;

      /*
      var i;
      var s = 'first part ' + p;
      for (i in first) {
        s += ' ' + first[i];
      }
      console.log(s);
      s = 'second part ' + nextId;
      for (i in second) {
        s += ' ' + second[i];
      }
      console.log(s);
      */
      break;
    }
  }
}

function nodeToPartition(nodeId) {
  for (var p in partitionPool) {
    for (var n in partitionPool[p]) {
      if (partitionPool[p][n] === nodeId) {
        return p;
      }
    }
  }
  console.log('not found', nodeId);
  return null;
}

var appsFromCapturedData = null;
var maxAppFinishTime = 0;
function getAppsFromCapturedData() {
  if (appsFromCapturedData !== null) {
    return appsFromCapturedData;
  }

  var minute = 1000 * 60;
  for (var i in capturedData.apps) {
    var app = capturedData.apps[i];
    var now = new Date().getTime();
    app.startTime = now - (15 * minute + Math.random() * 5 * minute);
    if (i % 2 === 0) {
      app.finishTime = now + 5 * minute + Math.random() *  minute;
      if (app.finishTime > maxAppFinishTime) {
        maxAppFinishTime = app.finishTime;
      }
        
      if (Number(i) === 0) {
        app.tooltip_info = {
          jobType: 3,
          priority: 50,
          deadline: app.finishTime + 20 * minute
        };
      }
    } else {
      app.tooltip_info = {
        jobType: 5,
        priority: 1000,
      };
    }

    if ('containers' in app) {
      for (var j in app.containers) {
        var container = app.containers[j];
        var offset = (Number(j) === 0) ? 0 : Math.random() * 3 * minute;
        container.creationTime = app.startTime - offset;
      }
    }
  }

  appsFromCapturedData = capturedData.apps;
  return capturedData.apps;
}

var freeNodeArray = ['rr329.narwhal.pdl.cmu.edu:52702',
                     'rr369.narwhal.pdl.cmu.edu:54246'];
function addOneNode(appIdx) {
  if (freeNodeArray.length === 0) {
    return;
  }
  var node = freeNodeArray.pop();
  var app = appsFromCapturedData[appIdx];
  app.ranNodes.push(node);
  var container = {node: node,
                   creationTime: app.containers[0].creationTime + minute,
                   finishTime: 0
                  };
  app.containers.push(container);
}

var nodesAvailable = [];
function restartOneApp(appIdx) {
  var app = appsFromCapturedData[appIdx];
  // console.log('restart app', app.applicationId);

  if (nodesAvailable.length === 0) {
    nodesAvailable = nodesFromCapturedData;
  }

  var newNodes = [];
  var n;
  for (n in app.ranNodes) {
    if (Math.floor(Math.random() * 2) === 0) {
      // console.log('reuse', app.ranNodes[n])
      newNodes.push(app.ranNodes[n]);
    } else {
      var newNode = nodesAvailable.pop();
      // console.log('add new', newNode.nodeId)
      newNodes.push(newNode.nodeId);
    }
  }

  app.ranNodes = newNodes;
  for (n in newNodes) {
    app.containers[n] = {node: newNodes[n].nodeId,
                         creationTime: new Date().getTime(),
                         finishTime: 0};
  }

  app.startTime = new Date().getTime();
  app.finishTime = new Date().getTime() + 5 * 60 * 1000;
  app.state = 'RUNNING';
}

function finishOneApp(appIdx) {
  var app = appsFromCapturedData[appIdx];
  // console.log('finish app', app.applicationId);
  app.state = 'FINISHED';
  // We should set finishTime to non-zero here.
}

var capturedPendingAlloc = null;
/*
var capturedPendingAlloc = {
  "application_1454444273400_0010": [
    {
      "startTime": 1454525151007.5278,
      "finishTime": 1454525867753.382,
      "partitions": {
        "p0": 2
      }
    },
    {
      "startTime": 1454525532349.2495,
      "finishTime": 1454526276763.5457,
      "partitions": {
        "p0": 1
      }
    }
  ],
  "application_1454444273400_0012": [
    {
      "startTime": 1454525119854.5408,
      "finishTime": 1454526208104.6157,
      "partitions": {
        "p0": 2
      }
    },
    {
      "startTime": 1454525148163.9954,
      "finishTime": 1454525827734.5745,
      "partitions": {
        "p0": 1
      }
    }
  ],
  "application_fake_3": [
    {
      "startTime": 1454525561778.3042,
      "finishTime": 1454526497734.2585,
      "partitions": {
        "p0": 2
      }
    },
    {
      "startTime": 1454525199678.9346,
      "finishTime": 1454526025819.7651,
      "partitions": {
        "p0": 1
      }
    }
  ]
}
*/
