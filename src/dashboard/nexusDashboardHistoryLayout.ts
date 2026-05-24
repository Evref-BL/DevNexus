export type NexusDashboardHistoryEventClass =
  | "write"
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

export interface NexusDashboardWriteEvent {
  readonly id: string;
  readonly parentIds: readonly string[];
  readonly subject?: string;
}

export interface NexusDashboardHistoryMarker {
  readonly id: string;
  readonly eventClass: Exclude<NexusDashboardHistoryEventClass, "write">;
  readonly targetWriteEventId: string;
  readonly label: string;
  readonly tone?: NexusDashboardHistoryMarkerTone;
}

export interface NexusDashboardHistoryLayoutInput {
  readonly writeEvents: readonly NexusDashboardWriteEvent[];
  readonly markers?: readonly NexusDashboardHistoryMarker[];
}

export interface NexusDashboardHistoryPoint {
  readonly lane: number;
  readonly row: number;
}

export interface NexusDashboardHistoryNode {
  readonly id: string;
  readonly eventClass: "write";
  readonly writeEventId: string;
  readonly row: number;
  readonly lane: number;
  readonly colorIndex: number;
}

export interface NexusDashboardHistoryTrack {
  readonly id: string;
  readonly colorIndex: number;
}

export interface NexusDashboardHistorySegment {
  readonly id: string;
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
  readonly writeEventId: string;
  readonly markerIds: readonly string[];
}

export interface NexusDashboardHistoryLayout {
  readonly nodes: readonly NexusDashboardHistoryNode[];
  readonly tracks: readonly NexusDashboardHistoryTrack[];
  readonly segments: readonly NexusDashboardHistorySegment[];
  readonly markers: readonly NexusDashboardPlacedHistoryMarker[];
  readonly detailRows: readonly NexusDashboardHistoryDetailRow[];
  readonly maxNodeLane: number;
  readonly maxRouteLane: number;
  readonly truncatedParentIds: readonly string[];
}

interface ActiveHistoryRoute {
  readonly targetEventId: string;
  readonly trackId: string;
  readonly colorIndex: number;
  readonly points: NexusDashboardHistoryPoint[];
}

export function buildWriteHistoryLayout(
  input: NexusDashboardHistoryLayoutInput,
): NexusDashboardHistoryLayout {
  const writeEvents = input.writeEvents ?? [];
  const knownIds = new Set(writeEvents.map((event) => event.id));
  const active: Array<ActiveHistoryRoute | null> = [];
  const nodes: NexusDashboardHistoryNode[] = [];
  const segments: NexusDashboardHistorySegment[] = [];
  const tracks = new Map<string, NexusDashboardHistoryTrack>();
  const truncatedParentIds: string[] = [];

  for (const event of writeEvents) {
    const row = nodes.length;
    let lane = active.findIndex((entry) => entry?.targetEventId === event.id);
    let incoming: ActiveHistoryRoute | null = null;
    if (lane < 0) {
      lane = firstOpenHistoryLane(active);
    } else {
      incoming = active[lane];
      active[lane] = null;
      addHistoryRoutePoint(incoming, lane, row);
      if (incoming) {
        segments.push(historySegmentFromRoute(incoming, segments.length));
        rememberHistoryTrack(tracks, incoming.trackId, incoming.colorIndex);
      }
    }

    const colorIndex = incoming?.colorIndex ?? lane;
    nodes.push({
      id: event.id,
      eventClass: "write",
      writeEventId: event.id,
      row,
      lane,
      colorIndex,
    });

    for (let parentIndex = 0; parentIndex < event.parentIds.length; parentIndex++) {
      const parentId = event.parentIds[parentIndex];
      if (!knownIds.has(parentId)) {
        truncatedParentIds.push(parentId);
        continue;
      }

      const existingLane = active.findIndex(
        (entry) => entry?.targetEventId === parentId,
      );
      if (existingLane >= 0) {
        const existing = active[existingLane];
        addHistoryRoutePoint(existing, existingLane, row + 0.85);
        const route = createHistoryRoute(
          parentId,
          parentIndex === 0 ? colorIndex : existing?.colorIndex ?? existingLane,
          lane,
          row,
        );
        addHistoryLaneTransition(route, existingLane, row + 0.85);
        segments.push(historySegmentFromRoute(route, segments.length));
        rememberHistoryTrack(tracks, route.trackId, route.colorIndex);
        continue;
      }

      const preferredLane =
        parentIndex === 0 && !active[lane] ? lane : firstOpenHistoryLane(active);
      const route = createHistoryRoute(
        parentId,
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

  const markerTargets = new Map(nodes.map((node) => [node.writeEventId, node]));
  const markers = (input.markers ?? [])
    .map((marker) => {
      const target = markerTargets.get(marker.targetWriteEventId);
      if (!target) return null;
      return { ...marker, row: target.row, lane: target.lane };
    })
    .filter((marker): marker is NexusDashboardPlacedHistoryMarker =>
      marker !== null,
    );
  const detailRows = [...new Set(markers.map((marker) => marker.targetWriteEventId))]
    .map((writeEventId) => ({
      writeEventId,
      markerIds: markers
        .filter((marker) => marker.targetWriteEventId === writeEventId)
        .map((marker) => marker.id),
    }));
  const maxNodeLane = Math.max(0, ...nodes.map((node) => node.lane));
  const maxRouteLane = Math.max(
    maxNodeLane,
    ...segments.flatMap((segment) => segment.points.map((point) => point.lane)),
  );

  return {
    nodes,
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
    createHistoryRoute,
    historySegmentFromRoute,
    rememberHistoryTrack,
    addHistoryRoutePoint,
    addHistoryLaneTransition,
    compactHistoryActiveLanes,
    buildWriteHistoryLayout,
  ]
    .map((fn) => fn.toString())
    .join("\n\n");
}

function createHistoryRoute(
  targetEventId: string,
  colorIndex: number,
  lane: number,
  row: number,
): ActiveHistoryRoute {
  return {
    targetEventId,
    trackId: `track:${targetEventId}:${colorIndex}`,
    colorIndex,
    points: [{ lane, row }],
  };
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
    trackId: route.trackId,
    colorIndex: route.colorIndex,
    fromLane: first.lane,
    toLane: last.lane,
    fromRow: first.row,
    toRow: last.row,
    points,
  };
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
  let write = 0;
  for (let read = 0; read < active.length; read++) {
    const entry = active[read];
    if (!entry) continue;
    if (read !== write) {
      addHistoryRoutePoint(entry, read, row + 0.45);
      addHistoryLaneTransition(entry, write, row + 0.95);
      active[write] = entry;
      active[read] = null;
    }
    write++;
  }
  active.length = write;
}

function firstOpenHistoryLane(
  active: Array<ActiveHistoryRoute | null>,
): number {
  const index = active.findIndex((value) => !value);
  return index >= 0 ? index : active.length;
}
