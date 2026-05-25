import { describe, expect, it } from "vitest";

import {
  buildNexusDashboardHistoryLayout,
  validateNexusDashboardHistoryLayout,
  type NexusDashboardHistoryMarker,
  type NexusDashboardHistoryEvent,
} from "../../src/dashboard/nexusDashboardHistoryLayout.js";

describe("nexus dashboard history layout", () => {
  it("models commits as primary events with local cross-lane routing", () => {
    const layout = buildNexusDashboardHistoryLayout({
      events: mergeFixture(),
    });

    const merge = layout.nodes.find((node) => node.id === "merge");
    const feature = layout.nodes.find((node) => node.id === "feature");
    const delayedCrossLaneSegments = layout.segments.filter((segment) => {
      if (segment.fromLane === segment.toLane) return false;
      const firstCrossLanePoint = segment.points.find(
        (point) => point.lane !== segment.fromLane,
      );
      return firstCrossLanePoint
        ? Math.abs(firstCrossLanePoint.row - segment.fromRow) > 1.5
        : false;
    });

    expect(layout.nodes).toHaveLength(5);
    expect(layout.edges.map((edge) => [edge.fromEventId, edge.toEventId]))
      .toEqual([
        ["merge", "main2"],
        ["merge", "feature"],
        ["main2", "main1"],
        ["main1", "base"],
        ["feature", "base"],
      ]);
    expect(validateNexusDashboardHistoryLayout(layout)).toEqual([]);
    expect(merge).toMatchObject({ eventClass: "source-change", lane: 0, row: 0 });
    expect(feature).toMatchObject({ eventClass: "source-change", lane: 1, row: 3 });
    expect(delayedCrossLaneSegments).toEqual([]);
  });

  it("keeps event lanes separate from route lanes during compaction", () => {
    const layout = buildNexusDashboardHistoryLayout({
      events: compactionFixture(),
    });
    const sideB = layout.nodes.find((node) => node.id === "sideB");

    expect(sideB?.lane).toBe(1);
    expect(layout.maxNodeLane).toBe(1);
    expect(layout.maxRouteLane).toBe(2);
    expect(validateNexusDashboardHistoryLayout(layout)).toEqual([]);
  });

  it("reuses lanes for non-overlapping side-branch events", () => {
    const layout = buildNexusDashboardHistoryLayout({
      events: laneReuseFixture(),
    });
    const sideA = layout.nodes.find((node) => node.id === "sideA");
    const sideB = layout.nodes.find((node) => node.id === "sideB");

    expect(sideA?.lane).toBe(1);
    expect(sideB?.lane).toBe(1);
    expect(layout.maxNodeLane).toBe(1);
    expect(validateNexusDashboardHistoryLayout(layout)).toEqual([]);
  });

  it("continues truncated parent tracks without inventing event rows", () => {
    const layout = buildNexusDashboardHistoryLayout({
      events: [
        historyEvent("head", ["parent-outside-window"]),
      ],
    });

    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toEqual([]);
    expect(layout.segments).toEqual([
      expect.objectContaining({
        targetEventId: "parent-outside-window",
        truncated: true,
        fromLane: 0,
        toLane: 0,
        fromRow: 0,
        toRow: 0.5,
        points: [
          { lane: 0, row: 0 },
          { lane: 0, row: 0.5 },
        ],
      }),
    ]);
    expect(layout.truncatedParentIds).toEqual(["parent-outside-window"]);
    expect(validateNexusDashboardHistoryLayout(layout)).toEqual([]);
  });

  it("connects a loaded branch head whose parent is outside the history window", () => {
    const layout = buildNexusDashboardHistoryLayout({
      events: [
        historyEvent("merge", ["base"]),
        historyEvent("side", ["parent-outside-window"]),
        historyEvent("base", []),
      ],
    });
    const side = layout.nodes.find((node) => node.eventId === "side");
    const connectedSegments = layout.segments.filter((segment) =>
      segment.points.some(
        (point) => point.row === side?.row && point.lane === side?.lane,
      ),
    );

    expect(side).toMatchObject({ row: 1, lane: 1 });
    expect(connectedSegments).toEqual([
      expect.objectContaining({
        targetEventId: "parent-outside-window",
        truncated: true,
      }),
    ]);
    expect(validateNexusDashboardHistoryLayout(layout)).toEqual([]);
  });

  it("attaches decision events as markers and detail rows", () => {
    const markers: NexusDashboardHistoryMarker[] = [
      {
        id: "approval-1",
        eventClass: "decision",
        targetEventId: "merge",
        label: "Approved",
        tone: "good",
      },
    ];
    const layout = buildNexusDashboardHistoryLayout({
      events: mergeFixture(),
      markers,
    });

    expect(layout.markers).toEqual([
      expect.objectContaining({
        id: "approval-1",
        row: 0,
        lane: 0,
        targetEventId: "merge",
      }),
    ]);
    expect(layout.detailRows).toEqual([
      expect.objectContaining({
        eventId: "merge",
        markerIds: ["approval-1"],
      }),
    ]);
    expect(validateNexusDashboardHistoryLayout(layout)).toEqual([]);
  });

  it("is stable across refreshes for the same event graph", () => {
    const first = buildNexusDashboardHistoryLayout({ events: mergeFixture() });
    const second = buildNexusDashboardHistoryLayout({ events: mergeFixture() });

    expect(second).toEqual(first);
  });
});

function mergeFixture(): NexusDashboardHistoryEvent[] {
  return [
    historyEvent("merge", ["main2", "feature"]),
    historyEvent("main2", ["main1"]),
    historyEvent("main1", ["base"]),
    historyEvent("feature", ["base"]),
    historyEvent("base", []),
  ];
}

function laneReuseFixture(): NexusDashboardHistoryEvent[] {
  return [
    historyEvent("mergeB", ["main3", "sideB"]),
    historyEvent("sideB", ["main3"]),
    historyEvent("main3", ["mergeA"]),
    historyEvent("mergeA", ["main2", "sideA"]),
    historyEvent("sideA", ["main2"]),
    historyEvent("main2", ["main1"]),
    historyEvent("main1", []),
  ];
}

function compactionFixture(): NexusDashboardHistoryEvent[] {
  return [
    historyEvent("top", ["main3", "sideA"]),
    historyEvent("main3", ["main2", "sideB"]),
    historyEvent("sideA", ["main2"]),
    historyEvent("sideB", ["main2"]),
    historyEvent("main2", ["main1"]),
    historyEvent("main1", []),
  ];
}

function historyEvent(
  id: string,
  parentIds: string[],
): NexusDashboardHistoryEvent {
  return {
    id,
    parentIds,
    subject: id,
  };
}
