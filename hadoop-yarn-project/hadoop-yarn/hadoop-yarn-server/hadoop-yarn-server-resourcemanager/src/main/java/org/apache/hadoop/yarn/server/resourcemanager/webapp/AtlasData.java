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

package org.apache.hadoop.yarn.server.resourcemanager.webapp;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonArray;
import com.google.gson.JsonPrimitive;

import java.io.FileWriter;
import java.io.IOException;
import java.util.Collection;
import java.util.concurrent.ConcurrentMap;

import org.apache.hadoop.yarn.server.resourcemanager.ResourceManager;

import com.google.inject.Inject;
import org.apache.hadoop.yarn.webapp.view.TextView;
import org.apache.hadoop.yarn.api.records.ApplicationId;
import org.apache.hadoop.yarn.api.records.NodeId;
import org.apache.hadoop.yarn.server.resourcemanager.rmapp.RMApp;
import org.apache.hadoop.yarn.server.resourcemanager.rmnode.RMNode;
import org.apache.hadoop.yarn.server.resourcemanager.scheduler.ResourceScheduler;
import org.apache.hadoop.yarn.server.resourcemanager.webapp.dao.NodeInfo;

import org.apache.hadoop.yarn.server.resourcemanager.scheduler.common.fica.FiCaSchedulerApp;
import org.apache.hadoop.yarn.server.resourcemanager.scheduler.AbstractYarnScheduler;
import org.apache.hadoop.yarn.server.resourcemanager.scheduler.common.fica.FiCaSchedulerNode;
import org.apache.hadoop.yarn.server.resourcemanager.rmcontainer.RMContainer;
import org.apache.hadoop.yarn.server.resourcemanager.rmapp.RMAppState;

/**
 * This class send a json of reservations to the browser
 */
public class AtlasData extends TextView {
  final String NODATA = "{\"config\":{\"min\":\"0\",\"max\":\"0\",\"step\":\"0\",\"user\":\"\"},\"graph\":[]}";
  final ResourceManager rm;
  final ConcurrentMap<ApplicationId, RMApp> apps;

  @Inject
  AtlasData(ViewContext ctx, String contentType, ResourceManager rm) {
    super(ctx, contentType);
    this.rm = rm;
    apps = rm.getRMContext().getRMApps();
  }

  @Override
  public void render() {
    Gson serial = new Gson();
    JsonArray nodes = new JsonArray();
    JsonArray applications = new JsonArray();

    try {
      String base_path = System.getenv("HADOOP_HOME");
      FileWriter dump = new FileWriter(base_path + "/czangdump.txt", true);

      ResourceScheduler sched = rm.getResourceScheduler();
      Collection<RMNode> rmNodes = this.rm.getRMContext().getRMNodes().values();
      for (RMNode ni : rmNodes) {
        NodeInfo info = new NodeInfo(ni, sched);
        dump.write(info.getRack() + " " + info.getNodeId() + "\n");

        JsonObject nodeInfo = new JsonObject();
        nodeInfo.addProperty("rack", info.getRack());
        nodeInfo.addProperty("nodeId", info.getNodeId());
        nodes.add(nodeInfo);
      }

      for (RMApp app : apps.values()) {
        dump.write(app.getName() + ":\n");

        JsonObject applicationInfo = new JsonObject();
        applicationInfo.addProperty("appName", app.getName());
        applicationInfo.addProperty("applicationId", app.getApplicationId().toString());
        applicationInfo.addProperty("startTime", app.getStartTime());
        applicationInfo.addProperty("finishTime", app.getFinishTime());
        applicationInfo.addProperty("state", app.getState().toString());

        dump.write("startTime: " + app.getStartTime() + "\n");
        JsonArray ranNodes = new JsonArray();
        JsonArray containersToClient = new JsonArray();

        if (app.getState() == RMAppState.RUNNING) {
          @SuppressWarnings("unchecked")
          AbstractYarnScheduler<FiCaSchedulerApp, FiCaSchedulerNode> rs = (AbstractYarnScheduler<FiCaSchedulerApp, FiCaSchedulerNode>) rm
              .getResourceScheduler();
          Collection<RMContainer> containers = rs.getApplicationAttempt(app.getCurrentAppAttempt().getAppAttemptId())
              .getLiveContainers();
          dump.write("# of containers " + containers.size() + "\n");

          for (RMContainer container : containers) {
            NodeId nodeId = container.getAllocatedNode();
            dump.write("allocated node: " + nodeId.toString() + "\n");

            ranNodes.add(new JsonPrimitive(nodeId.toString()));

            // XXXxxx??? newly added container info is a superset of ranNodes.  But don't change for now.
            JsonObject containerInfo = new JsonObject();
            containerInfo.addProperty("node", nodeId.toString());
            long creationTime = container.getCreationTime();
            containerInfo.addProperty("creationTime", creationTime);
            containerInfo.addProperty("finishTime", container.getFinishTime());
            containersToClient.add(containerInfo);

            dump.write("creationTime: " + creationTime + " on node " + nodeId.getHost() + "\n");
          }
        } else if (app.getState() == RMAppState.FINISHED) {
          for (NodeId nodeId : app.getRanNodes()) {
            ranNodes.add(new JsonPrimitive(nodeId.toString()));
          }
        } else {
          continue; // do nothing for other app states for now
        }
        applicationInfo.add("ranNodes", ranNodes);
        applicationInfo.add("containers", containersToClient);
        applications.add(applicationInfo);
      }

      JsonObject nodesAndApps = new JsonObject();
      nodesAndApps.add("nodes", nodes);
      nodesAndApps.add("apps", applications);

      putWithoutEscapeHtml(serial.toJson(nodesAndApps));

      dump.write("final redering: " + serial.toJson(nodesAndApps) + "\n");
      dump.write("The end\n");
      dump.close();
      return;

    } catch (IOException e) {
      LOG.error("[TETRIS] Failed to write to dump file");
      putWithoutEscapeHtml(NODATA);
      return;
    }
  }
}
