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
      // xxx For testing/debugging, use the source directly from my desktop.  Will be integrated into yarn jar file
      html.script().$type("text/javascript").$src("http://everest.pdl.cmu.edu/hadoop/third_party/d3.v3.js")._();
      html.script().$type("text/javascript").$src("http://everest.pdl.cmu.edu/hadoop/third_party/highcharts.src.js")._();
      html.script().$type("text/javascript").$src("http://everest.pdl.cmu.edu/hadoop/third_party/highcharts-more.src.js")._();
      html.script().$type("text/javascript").$src("http://everest.pdl.cmu.edu/hadoop/third_party/exporting.src.js")._();
      html.script().$type("text/javascript").$src("http://everest.pdl.cmu.edu/hadoop/third_party/customEvents.js")._();
      html.script().$type("text/javascript").$src("http://everest.pdl.cmu.edu/hadoop/third_party/grouped-categories.js")._();
      html.link().$rel("stylesheet").$href("http://everest.pdl.cmu.edu/hadoop/third_party/vis.min.css")._();
      html.script().$type("text/javascript").$src("http://everest.pdl.cmu.edu/hadoop/third_party/vis.min.js")._();
      html.link().$rel("stylesheet").$href("http://everest.pdl.cmu.edu/hadoop/third_party/jquery.switchButton.css")._();
      html.script().$type("text/javascript").$src("http://everest.pdl.cmu.edu/hadoop/third_party/jquery.switchButton.js")._();

      // home made script(s)
      html.script().$type("text/javascript").$src("http://everest.pdl.cmu.edu/hadoop/home_made/atlas.js")._();

      // general_container has everything, including buttons, chart and timeline
      DIV generalContainer = html.div().$id("general_container")._("");

      // collapse none/all button
      DIV collapseAll = html.div().$id("collapseAllDiv").$style("float: right; margin-right: 20px")._("Collapse racks:");
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
