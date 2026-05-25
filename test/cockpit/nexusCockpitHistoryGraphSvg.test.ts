import { describe, expect, it } from "vitest";

import {
  buildNexusCockpitHistoryGraphSvgModel,
  renderNexusCockpitHistoryGraphSvg,
} from "../../src/cockpit/client/history/nexusCockpitHistoryGraphSvg.js";

describe("nexus cockpit history graph SVG", () => {
  it("renders event nodes and monotone routed tracks from graph geometry", () => {
    const graph = {
      maxLane: 1,
      rows: [
        {
          lane: 0,
          index: 0,
          colorLane: 0,
          selectId: "history:primary:merge",
          commit: {
            hash: "merge",
            shortHash: "merge00",
            subject: "Merge change",
          },
        },
        {
          lane: 1,
          index: 1,
          colorLane: 1,
          selectId: "history:primary:feature",
          commit: {
            hash: "feature",
            shortHash: "feature",
            subject: "Feature change",
          },
        },
      ],
      paths: [
        {
          colorLane: 1,
          fromLane: 0,
          toLane: 1,
          fromIndex: 0,
          toIndex: 1,
          points: [
            { lane: 0, index: 0 },
            { lane: 0, index: 0.85 },
            { lane: 1, index: 1 },
          ],
        },
      ],
    };

    const model = buildNexusCockpitHistoryGraphSvgModel(graph);
    const rendered = renderNexusCockpitHistoryGraphSvg(graph);

    expect(model).toMatchObject({
      rowCount: 2,
      laneCount: 2,
      width: 148,
      height: 60,
    });
    expect(model.routes[0]?.points.map((point) => point.index)).toEqual([
      0,
      0.85,
      1,
    ]);
    expect(model.routes[0]?.d).toContain("C");
    expect(rendered).toContain('data-history-row-count="2"');
    expect(rendered).toContain('data-history-lane-count="2"');
    expect(rendered).toContain('data-history-event-class="source-change"');
    expect(rendered).toContain(
      'data-history-event-id="history:primary:merge"',
    );
  });

  it("keeps boundary continuations within the loaded row height", () => {
    const model = buildNexusCockpitHistoryGraphSvgModel({
      rows: [
        { lane: 0, index: 0, selectId: "history:primary:head" },
        { lane: 0, index: 1, selectId: "history:primary:base" },
      ],
      paths: [
        {
          fromLane: 0,
          toLane: 0,
          fromIndex: 0,
          toIndex: 1.5,
          points: [
            { lane: 0, index: 0 },
            { lane: 0, index: 1.5 },
          ],
        },
      ],
    });

    expect(model).toMatchObject({
      rowCount: 2,
      height: 60,
    });
  });
});
