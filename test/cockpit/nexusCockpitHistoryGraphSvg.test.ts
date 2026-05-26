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
          selected: true,
          tooltip: "Merge change\nDevNexus · merge00",
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
      nodeRadius: 4,
    });
    expect(model.nodes.map((node) => node.x)).toEqual([28, 44]);
    expect(model.hitTargets[0]).toMatchObject({
      id: "history:primary:merge",
      selected: true,
      x: 0,
      y: 0,
      width: 148,
      height: 30,
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
    expect(rendered).toContain('class="dn-git-row-hit selected"');
    expect(rendered).toContain('class="dn-git-node selected"');
    expect(rendered).toContain('data-select-id="history:primary:merge"');
    expect(rendered).toContain('data-dn-tooltip-mode="always"');
    expect(rendered).toContain('r="4"');
    expect(rendered).toContain('stroke-width="1"');
    expect(rendered).toContain('fill="var(--dn-branch-0)"');
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

  it("renders selected detail bands across expanded graph gaps", () => {
    const graph = {
      rows: [
        { lane: 0, index: 0, selectId: "history:primary:head" },
        {
          lane: 1,
          index: 1,
          selectId: "history:primary:selected",
          selected: true,
        },
        { lane: 0, index: 11, selectId: "history:primary:base" },
      ],
      paths: [],
    };

    const model = buildNexusCockpitHistoryGraphSvgModel(graph, {
      rowHeight: 26,
    });
    const rendered = renderNexusCockpitHistoryGraphSvg(graph, {
      rowHeight: 26,
    });

    expect(model.detailBands).toEqual([
      {
        y: 52,
        height: 234,
        dividerY: 286,
      },
    ]);
    expect(rendered).toContain(
      '<rect class="dn-git-detail-band" x="0" y="52" width="148" height="234" />',
    );
    expect(rendered).toContain(
      '<path class="dn-git-detail-band-divider" d="M 0 286 H 148" />',
    );
  });

  it("keeps shallow lane-change curves from looping backward", () => {
    const model = buildNexusCockpitHistoryGraphSvgModel({
      maxLane: 12,
      rows: [
        { lane: 8, index: 23, selectId: "history:primary:from" },
        { lane: 5, index: 24, selectId: "history:primary:to" },
      ],
      paths: [
        {
          colorLane: 5,
          points: [
            { lane: 8, index: 23 },
            { lane: 8, index: 23.45 },
            { lane: 12, index: 23.85 },
            { lane: 5, index: 23.95 },
            { lane: 5, index: 24 },
          ],
        },
      ],
    });

    expect(model.routes[0]?.d).toBe(
      "M 156 705 V 718.5 C 156 728.1, 220 720.9, 220 730.5 C 220 732.9, 108 731.1, 108 733.5 V 735",
    );
    expect(maxCurveDeltaY(model.routes[0]?.d ?? "")).toBeLessThanOrEqual(30);
  });

  it("curves lane changes without a flat horizontal corridor", () => {
    const model = buildNexusCockpitHistoryGraphSvgModel({
      maxLane: 4,
      rows: [
        { lane: 0, index: 0, selectId: "history:primary:from" },
        { lane: 4, index: 1, selectId: "history:primary:to" },
      ],
      paths: [
        {
          colorLane: 1,
          points: [
            { lane: 0, index: 0 },
            { lane: 4, index: 0.4 },
          ],
        },
      ],
    });

    expect(model.routes[0]?.d).toBe(
      "M 28 15 C 28 24.6, 92 17.4, 92 27",
    );
  });

  it("keeps lane changes inside a single row span", () => {
    const model = buildNexusCockpitHistoryGraphSvgModel({
      maxLane: 2,
      rows: [
        { lane: 0, index: 0, selectId: "history:primary:from" },
        { lane: 0, index: 1, selectId: "history:primary:via" },
        { lane: 2, index: 2, selectId: "history:primary:to" },
      ],
      paths: [
        {
          colorLane: 1,
          points: [
            { lane: 0, index: 0 },
            { lane: 0, index: 1 },
            { lane: 2, index: 2 },
          ],
        },
      ],
    });

    expect(model.routes[0]?.d).toBe(
      "M 28 15 V 45 C 28 69, 60 51, 60 75",
    );
    expect(maxCurveDeltaY(model.routes[0]?.d ?? "")).toBeLessThanOrEqual(30);
  });
});

function maxCurveDeltaY(path: string): number {
  const commandPattern =
    /(M\s*[\d.-]+\s+([\d.-]+))|(V\s*([\d.-]+))|(C\s*[\d.-]+\s+[\d.-]+,\s*[\d.-]+\s+[\d.-]+,\s*[\d.-]+\s+([\d.-]+))/g;
  let currentY = 0;
  let max = 0;
  let match: RegExpExecArray | null;
  while ((match = commandPattern.exec(path)) !== null) {
    if (match[2] !== undefined) {
      currentY = Number(match[2]);
    } else if (match[4] !== undefined) {
      currentY = Number(match[4]);
    } else if (match[6] !== undefined) {
      const nextY = Number(match[6]);
      max = Math.max(max, Math.abs(nextY - currentY));
      currentY = nextY;
    }
  }
  return max;
}
