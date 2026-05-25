export type NexusDashboardHistoryEventClass =
  | "source-change"
  | "decision"
  | "review"
  | "publication"
  | "diagnostic";

export type NexusDashboardHistoryMarkerTone =
  | "good"
  | "active"
  | "warn"
  | "danger"
  | "neutral";

export interface NexusDashboardHistoryEvent {
  readonly id: string;
  readonly parentIds: readonly string[];
  readonly subject?: string;
}

export interface NexusDashboardHistoryMarker {
  readonly id: string;
  readonly eventClass: Exclude<NexusDashboardHistoryEventClass, "source-change">;
  readonly targetEventId: string;
  readonly label: string;
  readonly tone?: NexusDashboardHistoryMarkerTone;
}

export interface NexusDashboardHistoryLayoutInput {
  readonly events: readonly NexusDashboardHistoryEvent[];
  readonly markers?: readonly NexusDashboardHistoryMarker[];
}

export interface NexusDashboardHistoryPoint {
  readonly lane: number;
  readonly row: number;
}

export interface NexusDashboardHistoryNode {
  readonly id: string;
  readonly eventClass: "source-change";
  readonly eventId: string;
  readonly row: number;
  readonly lane: number;
  readonly colorIndex: number;
}

export interface NexusDashboardHistoryTrack {
  readonly id: string;
  readonly colorIndex: number;
}

export type NexusDashboardHistoryEdgeKind = "parent";

export interface NexusDashboardHistoryEdge {
  readonly id: string;
  readonly kind: NexusDashboardHistoryEdgeKind;
  readonly fromEventId: string;
  readonly toEventId: string;
}

export interface NexusDashboardHistorySegment {
  readonly id: string;
  readonly edgeId?: string;
  readonly targetEventId: string;
  readonly truncated?: boolean;
  readonly trackId: string;
  readonly colorIndex: number;
  readonly fromLane: number;
  readonly toLane: number;
  readonly fromRow: number;
  readonly toRow: number;
  readonly points: readonly NexusDashboardHistoryPoint[];
}

export interface NexusDashboardPlacedHistoryMarker
  extends NexusDashboardHistoryMarker {
  readonly row: number;
  readonly lane: number;
}

export interface NexusDashboardHistoryDetailRow {
  readonly eventId: string;
  readonly markerIds: readonly string[];
}

export interface NexusDashboardHistoryLayout {
  readonly nodes: readonly NexusDashboardHistoryNode[];
  readonly edges: readonly NexusDashboardHistoryEdge[];
  readonly tracks: readonly NexusDashboardHistoryTrack[];
  readonly segments: readonly NexusDashboardHistorySegment[];
  readonly markers: readonly NexusDashboardPlacedHistoryMarker[];
  readonly detailRows: readonly NexusDashboardHistoryDetailRow[];
  readonly maxNodeLane: number;
  readonly maxRouteLane: number;
  readonly truncatedParentIds: readonly string[];
}

export interface NexusDashboardHistoryInvariantViolation {
  readonly code: string;
  readonly message: string;
}

interface ActiveHistoryRoute {
  readonly edgeId?: string;
  readonly targetEventId: string;
  readonly trackId: string;
  readonly colorIndex: number;
  readonly truncated: boolean;
  readonly points: NexusDashboardHistoryPoint[];
}

export function buildNexusDashboardHistoryLayout(
  input: NexusDashboardHistoryLayoutInput,
): NexusDashboardHistoryLayout {
  const events = input.events ?? [];
  const knownIds = new Set(events.map((event) => event.id));
  const active: Array<ActiveHistoryRoute | null> = [];
  const nodes: NexusDashboardHistoryNode[] = [];
  const edges: NexusDashboardHistoryEdge[] = [];
  const segments: NexusDashboardHistorySegment[] = [];
  const tracks = new Map<string, NexusDashboardHistoryTrack>();
  const truncatedParentIds: string[] = [];

  for (const event of events) {
    const row = nodes.length;
    const incomingRoutes = active
      .map((route, lane) =>
        route?.targetEventId === event.id ? { lane, route } : null,
      )
      .filter(
        (route): route is { lane: number; route: ActiveHistoryRoute } =>
          route !== null,
      );
    let lane = incomingRoutes[0]?.lane ?? -1;
    let incoming: ActiveHistoryRoute | null = null;
    if (incomingRoutes.length === 0) {
      lane = firstOpenHistoryLane(active);
    } else {
      incoming = incomingRoutes[0]?.route ?? null;
      for (const route of incomingRoutes) active[route.lane] = null;
      for (const route of incomingRoutes) {
        closeHistoryRouteAtEvent(route.route, route.lane, lane, row);
        segments.push(historySegmentFromRoute(route.route, segments.length));
        rememberHistoryTrack(tracks, route.route.trackId, route.route.colorIndex);
      }
    }

    const colorIndex = incoming?.colorIndex ?? lane;
    nodes.push({
      id: event.id,
      eventClass: "source-change",
      eventId: event.id,
      row,
      lane,
      colorIndex,
    });

    for (let parentIndex = 0; parentIndex < event.parentIds.length; parentIndex++) {
      const parentId = event.parentIds[parentIndex];
      if (!knownIds.has(parentId)) {
        truncatedParentIds.push(parentId);
        const preferredLane =
          parentIndex === 0 ? lane : firstOpenHistoryLane(active);
        const route = createHistoryRoute(
          parentId,
          undefined,
          parentIndex === 0 ? colorIndex : preferredLane,
          lane,
          row,
          true,
        );
        if (preferredLane !== lane) {
          addHistoryLaneTransition(route, preferredLane, row + 0.85);
        }
        addHistoryRoutePoint(
          route,
          preferredLane,
          Math.max(row + 0.5, events.length - 0.5),
        );
        segments.push(historySegmentFromRoute(route, segments.length));
        rememberHistoryTrack(tracks, route.trackId, route.colorIndex);
        continue;
      }

      const edgeId = historyEdgeId(event.id, parentId, parentIndex);
      edges.push({
        id: edgeId,
        kind: "parent",
        fromEventId: event.id,
        toEventId: parentId,
      });

      const preferredLane =
        parentIndex === 0 && !active[lane] ? lane : firstOpenHistoryLane(active);
      const route = createHistoryRoute(
        parentId,
        edgeId,
        parentIndex === 0 ? colorIndex : preferredLane,
        lane,
        row,
      );
      if (preferredLane !== lane) {
        addHistoryLaneTransition(route, preferredLane, row + 0.85);
      }
      active[preferredLane] = route;
    }

    compactHistoryActiveLanes(active, row);
  }

  const markerTargets = new Map(nodes.map((node) => [node.eventId, node]));
  const markers = (input.markers ?? [])
    .map((marker) => {
      const target = markerTargets.get(marker.targetEventId);
      if (!target) return null;
      return { ...marker, row: target.row, lane: target.lane };
    })
    .filter((marker): marker is NexusDashboardPlacedHistoryMarker =>
      marker !== null,
    );
  const detailRows = [...new Set(markers.map((marker) => marker.targetEventId))]
    .map((eventId) => ({
      eventId,
      markerIds: markers
        .filter((marker) => marker.targetEventId === eventId)
        .map((marker) => marker.id),
    }));
  const maxNodeLane = Math.max(0, ...nodes.map((node) => node.lane));
  const maxRouteLane = Math.max(
    maxNodeLane,
    ...segments.flatMap((segment) => segment.points.map((point) => point.lane)),
  );

  return {
    nodes,
    edges,
    tracks: [...tracks.values()],
    segments,
    markers,
    detailRows,
    maxNodeLane,
    maxRouteLane,
    truncatedParentIds,
  };
}

export function renderNexusDashboardHistoryLayoutClientSource(): string {
  return [
    firstOpenHistoryLane,
    historyEdgeId,
    createHistoryRoute,
    closeHistoryRouteAtEvent,
    historySegmentFromRoute,
    rememberHistoryTrack,
    addHistoryRoutePoint,
    addHistoryLaneTransition,
    compactHistoryActiveLanes,
    buildNexusDashboardHistoryLayout,
  ]
    .map((fn) => fn.toString())
    .join("\n\n");
}

export function validateNexusDashboardHistoryLayout(
  layout: NexusDashboardHistoryLayout,
): NexusDashboardHistoryInvariantViolation[] {
  const violations: NexusDashboardHistoryInvariantViolation[] = [];
  const nodeByEventId = new Map(
    layout.nodes.map((node) => [node.eventId, node]),
  );
  const nodeSlots = new Set<string>();

  layout.nodes.forEach((node, index) => {
    if (node.eventClass !== "source-change") {
      violations.push({
        code: "node.eventClass",
        message: `History node ${node.id} is not a source-change event.`,
      });
    }
    if (!Number.isInteger(node.row) || node.row !== index) {
      violations.push({
        code: "node.row",
        message: `Event ${node.eventId} is not on its instant slice.`,
      });
    }
    if (!Number.isInteger(node.lane) || node.lane < 0) {
      violations.push({
        code: "node.lane",
        message: `Event ${node.eventId} has an invalid lane.`,
      });
    }
    const slot = `${node.row}:${node.lane}`;
    if (nodeSlots.has(slot)) {
      violations.push({
        code: "node.slot",
        message: `Multiple events occupy row ${node.row}, lane ${node.lane}.`,
      });
    }
    nodeSlots.add(slot);
  });

  for (const edge of layout.edges) {
    const from = nodeByEventId.get(edge.fromEventId);
    const to = nodeByEventId.get(edge.toEventId);
    if (!from || !to) {
      violations.push({
        code: "edge.endpoint",
        message: `History edge ${edge.id} has a missing endpoint.`,
      });
      continue;
    }
    if (from.row > to.row) {
      violations.push({
        code: "edge.time",
        message: `History edge ${edge.id} points backward in time.`,
      });
    }
  }

  for (const segment of layout.segments) {
    if (!nodeByEventId.has(segment.targetEventId)) {
      if (!segment.truncated) {
        violations.push({
          code: "segment.target",
          message: `History segment ${segment.id} targets an unknown event.`,
        });
      }
    }
    if (segment.points.length < 2) {
      violations.push({
        code: "segment.points",
        message: `History segment ${segment.id} has too few route points.`,
      });
      continue;
    }
    const first = segment.points[0]!;
    const last = segment.points[segment.points.length - 1]!;
    if (first.lane !== segment.fromLane || first.row !== segment.fromRow) {
      violations.push({
        code: "segment.start",
        message: `History segment ${segment.id} does not start on its first point.`,
      });
    }
    if (last.lane !== segment.toLane || last.row !== segment.toRow) {
      violations.push({
        code: "segment.end",
        message: `History segment ${segment.id} does not end on its last point.`,
      });
    }
    for (let index = 1; index < segment.points.length; index++) {
      const previous = segment.points[index - 1]!;
      const current = segment.points[index]!;
      if (current.row < previous.row) {
        violations.push({
          code: "segment.time",
          message: `History segment ${segment.id} is not monotone in time.`,
        });
      }
      if (current.lane < 0 || previous.lane < 0) {
        violations.push({
          code: "segment.lane",
          message: `History segment ${segment.id} uses an invalid lane.`,
        });
      }
    }
  }

  for (const marker of layout.markers) {
    const target = nodeByEventId.get(marker.targetEventId);
    if (!target) {
      violations.push({
        code: "marker.target",
        message: `History marker ${marker.id} targets an unknown event.`,
      });
      continue;
    }
    if (marker.row !== target.row || marker.lane !== target.lane) {
      violations.push({
        code: "marker.anchor",
        message: `History marker ${marker.id} is not anchored to its event.`,
      });
    }
  }

  const maxNodeLane = Math.max(0, ...layout.nodes.map((node) => node.lane));
  const maxRouteLane = Math.max(
    maxNodeLane,
    ...layout.segments.flatMap((segment) =>
      segment.points.map((point) => point.lane),
    ),
  );
  if (layout.maxNodeLane !== maxNodeLane) {
    violations.push({
      code: "maxNodeLane",
      message: "History maxNodeLane does not match the event lanes.",
    });
  }
  if (layout.maxRouteLane !== maxRouteLane) {
    violations.push({
      code: "maxRouteLane",
      message: "History maxRouteLane does not match the routed lanes.",
    });
  }

  return violations;
}

function createHistoryRoute(
  targetEventId: string,
  edgeId: string | undefined,
  colorIndex: number,
  lane: number,
  row: number,
  truncated = false,
): ActiveHistoryRoute {
  return {
    edgeId,
    targetEventId,
    trackId: `track:${targetEventId}:${colorIndex}`,
    colorIndex,
    truncated,
    points: [{ lane, row }],
  };
}

function closeHistoryRouteAtEvent(
  route: ActiveHistoryRoute,
  routeLane: number,
  eventLane: number,
  row: number,
): void {
  if (routeLane === eventLane) {
    addHistoryRoutePoint(route, eventLane, row);
    return;
  }
  const last = route.points[route.points.length - 1];
  const approachRow = Math.max(last?.row ?? row, row - 0.55);
  addHistoryRoutePoint(route, routeLane, approachRow);
  addHistoryLaneTransition(route, eventLane, Math.max(approachRow, row - 0.05));
  addHistoryRoutePoint(route, eventLane, row);
}

function historySegmentFromRoute(
  route: ActiveHistoryRoute,
  segmentIndex: number,
): NexusDashboardHistorySegment {
  const points = route.points.map((point) => ({
    lane: point.lane,
    row: point.row,
  }));
  const first = points[0] ?? { lane: 0, row: 0 };
  const last = points[points.length - 1] ?? first;
  return {
    id: `segment:${segmentIndex}`,
    edgeId: route.edgeId,
    targetEventId: route.targetEventId,
    truncated: route.truncated || undefined,
    trackId: route.trackId,
    colorIndex: route.colorIndex,
    fromLane: first.lane,
    toLane: last.lane,
    fromRow: first.row,
    toRow: last.row,
    points,
  };
}

function historyEdgeId(
  fromEventId: string,
  toEventId: string,
  parentIndex: number,
): string {
  return `edge:${fromEventId}->${toEventId}:${parentIndex}`;
}

function rememberHistoryTrack(
  tracks: Map<string, NexusDashboardHistoryTrack>,
  id: string,
  colorIndex: number,
): void {
  if (tracks.has(id)) return;
  tracks.set(id, { id, colorIndex });
}

function addHistoryRoutePoint(
  route: ActiveHistoryRoute | null | undefined,
  lane: number,
  row: number,
): void {
  if (!route) return;
  const last = route.points[route.points.length - 1];
  if (last && last.lane === lane && last.row === row) return;
  route.points.push({ lane, row });
}

function addHistoryLaneTransition(
  route: ActiveHistoryRoute | null | undefined,
  lane: number,
  row: number,
): void {
  if (!route) return;
  const last = route.points[route.points.length - 1];
  if (!last || last.lane === lane) {
    addHistoryRoutePoint(route, lane, row);
    return;
  }
  const anchorRow = Math.max(last.row, row - 0.4);
  addHistoryRoutePoint(route, last.lane, anchorRow);
  addHistoryRoutePoint(route, lane, row);
}

function compactHistoryActiveLanes(
  active: Array<ActiveHistoryRoute | null>,
  row: number,
): void {
  let nextLane = 0;
  for (let read = 0; read < active.length; read++) {
    const entry = active[read];
    if (!entry) continue;
    if (read !== nextLane) {
      addHistoryRoutePoint(entry, read, row + 0.45);
      addHistoryLaneTransition(entry, nextLane, row + 0.95);
      active[nextLane] = entry;
      active[read] = null;
    }
    nextLane++;
  }
  active.length = nextLane;
}

function firstOpenHistoryLane(
  active: Array<ActiveHistoryRoute | null>,
): number {
  const index = active.findIndex((value) => !value);
  return index >= 0 ? index : active.length;
}
