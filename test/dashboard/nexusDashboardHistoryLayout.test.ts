import { describe, expect, it } from "vitest";

import {
  buildWriteHistoryLayout,
  validateWriteHistoryLayout,
  type NexusDashboardHistoryMarker,
  type NexusDashboardWriteEvent,
} from "../../src/dashboard/nexusDashboardHistoryLayout.js";

describe("nexus dashboard history layout", () => {
  it("models commits as primary write events with local cross-lane routing", () => {
    const layout = buildWriteHistoryLayout({
      writeEvents: mergeFixture(),
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
    expect(layout.edges.map((edge) => [edge.fromWriteEventId, edge.toWriteEventId]))
      .toEqual([
        ["merge", "main2"],
        ["merge", "feature"],
        ["main2", "main1"],
        ["main1", "base"],
        ["feature", "base"],
      ]);
    expect(validateWriteHistoryLayout(layout)).toEqual([]);
    expect(merge).toMatchObject({ eventClass: "write", lane: 0, row: 0 });
    expect(feature).toMatchObject({ eventClass: "write", lane: 1, row: 3 });
    expect(delayedCrossLaneSegments).toEqual([]);
  });

  it("keeps write-event lanes separate from route lanes during compaction", () => {
    const layout = buildWriteHistoryLayout({
      writeEvents: compactionFixture(),
    });
    const sideB = layout.nodes.find((node) => node.id === "sideB");

    expect(sideB?.lane).toBe(1);
    expect(layout.maxNodeLane).toBe(1);
    expect(layout.maxRouteLane).toBe(2);
    expect(validateWriteHistoryLayout(layout)).toEqual([]);
  });

  it("reuses lanes for non-overlapping side-branch write events", () => {
    const layout = buildWriteHistoryLayout({
      writeEvents: laneReuseFixture(),
    });
    const sideA = layout.nodes.find((node) => node.id === "sideA");
    const sideB = layout.nodes.find((node) => node.id === "sideB");

    expect(sideA?.lane).toBe(1);
    expect(sideB?.lane).toBe(1);
    expect(layout.maxNodeLane).toBe(1);
    expect(validateWriteHistoryLayout(layout)).toEqual([]);
  });

  it("continues truncated parent tracks without inventing write-event rows", () => {
    const layout = buildWriteHistoryLayout({
      writeEvents: [
        writeEvent("head", ["parent-outside-window"]),
      ],
    });

    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toEqual([]);
    expect(layout.segments).toEqual([
      expect.objectContaining({
        targetWriteEventId: "parent-outside-window",
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
    expect(validateWriteHistoryLayout(layout)).toEqual([]);
  });

  it("connects a loaded branch head whose parent is outside the history window", () => {
    const layout = buildWriteHistoryLayout({
      writeEvents: [
        writeEvent("merge", ["base"]),
        writeEvent("side", ["parent-outside-window"]),
        writeEvent("base", []),
      ],
    });
    const side = layout.nodes.find((node) => node.writeEventId === "side");
    const connectedSegments = layout.segments.filter((segment) =>
      segment.points.some(
        (point) => point.row === side?.row && point.lane === side?.lane,
      ),
    );

    expect(side).toMatchObject({ row: 1, lane: 1 });
    expect(connectedSegments).toEqual([
      expect.objectContaining({
        targetWriteEventId: "parent-outside-window",
        truncated: true,
      }),
    ]);
    expect(validateWriteHistoryLayout(layout)).toEqual([]);
  });

  it("attaches decision events as markers and detail rows", () => {
    const markers: NexusDashboardHistoryMarker[] = [
      {
        id: "approval-1",
        eventClass: "decision",
        targetWriteEventId: "merge",
        label: "Approved",
        tone: "good",
      },
    ];
    const layout = buildWriteHistoryLayout({
      writeEvents: mergeFixture(),
      markers,
    });

    expect(layout.markers).toEqual([
      expect.objectContaining({
        id: "approval-1",
        row: 0,
        lane: 0,
        targetWriteEventId: "merge",
      }),
    ]);
    expect(layout.detailRows).toEqual([
      expect.objectContaining({
        writeEventId: "merge",
        markerIds: ["approval-1"],
      }),
    ]);
    expect(validateWriteHistoryLayout(layout)).toEqual([]);
  });

  it("is stable across refreshes for the same write-event graph", () => {
    const first = buildWriteHistoryLayout({ writeEvents: mergeFixture() });
    const second = buildWriteHistoryLayout({ writeEvents: mergeFixture() });

    expect(second).toEqual(first);
  });
});

function mergeFixture(): NexusDashboardWriteEvent[] {
  return [
    writeEvent("merge", ["main2", "feature"]),
    writeEvent("main2", ["main1"]),
    writeEvent("main1", ["base"]),
    writeEvent("feature", ["base"]),
    writeEvent("base", []),
  ];
}

function laneReuseFixture(): NexusDashboardWriteEvent[] {
  return [
    writeEvent("mergeB", ["main3", "sideB"]),
    writeEvent("sideB", ["main3"]),
    writeEvent("main3", ["mergeA"]),
    writeEvent("mergeA", ["main2", "sideA"]),
    writeEvent("sideA", ["main2"]),
    writeEvent("main2", ["main1"]),
    writeEvent("main1", []),
  ];
}

function compactionFixture(): NexusDashboardWriteEvent[] {
  return [
    writeEvent("top", ["main3", "sideA"]),
    writeEvent("main3", ["main2", "sideB"]),
    writeEvent("sideA", ["main2"]),
    writeEvent("sideB", ["main2"]),
    writeEvent("main2", ["main1"]),
    writeEvent("main1", []),
  ];
}

function writeEvent(
  id: string,
  parentIds: string[],
): NexusDashboardWriteEvent {
  return {
    id,
    parentIds,
    subject: id,
  };
}
