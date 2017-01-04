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

import org.apache.hadoop.yarn.webapp.SubView;
import org.apache.hadoop.yarn.webapp.view.HtmlBlock;
import org.apache.hadoop.yarn.webapp.hamlet.Hamlet.DIV;
/**
 * This class visualizes the Plan(s)
 */
public class AtlasPage extends RmView {

  static class AtlasBlock extends HtmlBlock {
    @Override
    public void render(Block html) {
      html.script().$type("text/javascript").$src("/static/atlas/thirdParty/d3.v3.js")._();
      html.script().$type("text/javascript").$src("/static/atlas/thirdParty/highcharts.src.js")._();
      html.script().$type("text/javascript").$src("/static/atlas/thirdParty/highcharts-more.src.js")._();
      html.script().$type("text/javascript").$src("/static/atlas/thirdParty/exporting.src.js")._();
      html.script().$type("text/javascript").$src("/static/atlas/thirdParty/grouped-categories.js")._();
      html.link().$rel("stylesheet").$href("/static/atlas/thirdParty/vis.min.css")._();
      html.script().$type("text/javascript").$src("/static/atlas/thirdParty/vis.min.js")._();
      html.link().$rel("stylesheet").$href("/static/atlas/thirdParty/jquery.switchButton.css")._();
      html.script().$type("text/javascript").$src("/static/atlas/thirdParty/jquery.switchButton.js")._();

      // home made script(s)
      html.script().$type("text/javascript").$src("/static/atlas/js/atlas.js")._();      

      // general_container has everything, including buttons, chart and timeline
      DIV generalContainer = html.div().$id("general_container")._("");

      // group nodes by rack/partition button
      DIV groupBy = html.div().$id("groupByDiv").$style("float: left;")._("Group nodes by:");
      html.div().$id("groupBy").$class("switch-wrapper")._();
      groupBy._();
      // collapse none/all button
      DIV collapseAll = html.div().$id("collapseAllDiv").$style("float: right;")._("Collapse racks/partitions:");
      html.div().$id("collapseAll").$class("switch-wrapper")._();
      collapseAll._();

      // chart_container is for chart only
      html.div().$id("chart_container").$style("min-width: 400px; margin: 0 auto")._();
      generalContainer._();

      DIV startShowAtlasData =
          html.div().$id("justToContainSomeScript")._("");
      html.script()._("atlasPageEntryPoint();")._();
      startShowAtlasData._();
    }
  }

  @Override
  protected Class<? extends SubView> content() {
    return AtlasBlock.class;
  }
}
