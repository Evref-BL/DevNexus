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

interface HistoryEventGraph {
  readonly records: HistoryEventRecord[];
  readonly edges: NexusDashboardHistoryEdge[];
  readonly truncatedParentIds: string[];
}

interface HistoryEventRecord {
  readonly event: NexusDashboardHistoryEvent;
  readonly row: number;
  readonly parents: HistoryParentLink[];
  readonly childRows: number[];
  readonly reservations: Array<HistoryLaneReservation | undefined>;
  parentCursor: number;
  lane: number;
  colorIndex: number;
  nextFreeLane: number;
  trackIndex?: number;
}

interface HistoryParentLink {
  readonly parentId: string;
  readonly parentIndex: number;
  readonly parentRow: number | null;
  readonly edgeId?: string;
  readonly truncated: boolean;
}

interface HistoryLaneReservation {
  readonly targetRow: number | null;
  readonly trackIndex: number;
}

interface HistoryRouteTrack {
  readonly id: string;
  readonly colorIndex: number;
  readonly pieces: HistoryRoutePiece[];
  endRow: number;
}

interface HistoryRoutePiece {
  readonly edgeId?: string;
  readonly targetEventId: string;
  readonly truncated: boolean;
  readonly p1: NexusDashboardHistoryPoint;
  readonly p2: NexusDashboardHistoryPoint;
}

export function buildNexusDashboardHistoryLayout(
  input: NexusDashboardHistoryLayoutInput,
): NexusDashboardHistoryLayout {
  const eventGraph = buildHistoryEventGraph(input.events ?? []);
  const tracks = layoutHistoryTracks(eventGraph.records);
  const nodes = eventGraph.records.map((record) => ({
    id: record.event.id,
    eventClass: "source-change" as const,
    eventId: record.event.id,
    row: record.row,
    lane: record.lane,
    colorIndex: record.colorIndex,
  }));
  const segments = historySegmentsFromTracks(tracks);
  const visibleTracks = tracks
    .filter((track) => track.pieces.length > 0)
    .map((track) => ({ id: track.id, colorIndex: track.colorIndex }));
  const markers = historyMarkersForNodes(input.markers ?? [], nodes);
  const detailRows = historyDetailRows(markers);
  const maxNodeLane = Math.max(0, ...nodes.map((node) => node.lane));
  const maxRouteLane = Math.max(
    maxNodeLane,
    ...segments.flatMap((segment) => segment.points.map((point) => point.lane)),
  );

  return {
    nodes,
    edges: eventGraph.edges,
    tracks: visibleTracks,
    segments,
    markers,
    detailRows,
    maxNodeLane,
    maxRouteLane,
    truncatedParentIds: eventGraph.truncatedParentIds,
  };
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

function buildHistoryEventGraph(
  events: readonly NexusDashboardHistoryEvent[],
): HistoryEventGraph {
  const rowByEventId = new Map(
    events.map((event, row) => [event.id, row]),
  );
  const records = events.map((event, row) => ({
    event,
    row,
    parents: [] as HistoryParentLink[],
    childRows: [] as number[],
    parentCursor: 0,
    lane: 0,
    colorIndex: 0,
    reservations: [] as Array<HistoryLaneReservation | undefined>,
    nextFreeLane: 0,
  }));
  const edges: NexusDashboardHistoryEdge[] = [];
  const truncatedParentIds: string[] = [];

  for (const record of records) {
    record.event.parentIds.forEach((parentId, parentIndex) => {
      const parentRow = rowByEventId.get(parentId);
      const edgeId =
        parentRow === undefined
          ? undefined
          : historyEdgeId(record.event.id, parentId, parentIndex);
      if (parentRow === undefined) {
        truncatedParentIds.push(parentId);
      } else {
        edges.push({
          id: edgeId!,
          kind: "parent",
          fromEventId: record.event.id,
          toEventId: parentId,
        });
        records[parentRow]?.childRows.push(record.row);
      }
      record.parents.push({
        parentId,
        parentIndex,
        parentRow: parentRow ?? null,
        ...(edgeId ? { edgeId } : {}),
        truncated: parentRow === undefined,
      });
    });
  }

  return { records, edges, truncatedParentIds };
}

function historyMarkersForNodes(
  markers: readonly NexusDashboardHistoryMarker[],
  nodes: readonly NexusDashboardHistoryNode[],
): NexusDashboardPlacedHistoryMarker[] {
  const nodeByEventId = new Map(nodes.map((node) => [node.eventId, node]));
  return markers
    .map((marker) => {
      const target = nodeByEventId.get(marker.targetEventId);
      if (!target) return null;
      return { ...marker, row: target.row, lane: target.lane };
    })
    .filter((marker): marker is NexusDashboardPlacedHistoryMarker =>
      marker !== null,
    );
}

function historyDetailRows(
  markers: readonly NexusDashboardPlacedHistoryMarker[],
): NexusDashboardHistoryDetailRow[] {
  return [...new Set(markers.map((marker) => marker.targetEventId))]
    .map((eventId) => ({
      eventId,
      markerIds: markers
        .filter((marker) => marker.targetEventId === eventId)
        .map((marker) => marker.id),
    }));
}

function layoutHistoryTracks(
  records: readonly HistoryEventRecord[],
): HistoryRouteTrack[] {
  const tracks: HistoryRouteTrack[] = [];
  const paletteEndRows: number[] = [];
  let row = 0;
  while (row < records.length) {
    const record = records[row]!;
    if (nextParentLink(record) || record.trackIndex === undefined) {
      routeHistoryFromRow(row, records, tracks, paletteEndRows);
    } else {
      row++;
    }
  }
  return tracks;
}

function routeHistoryFromRow(
  row: number,
  records: readonly HistoryEventRecord[],
  tracks: HistoryRouteTrack[],
  paletteEndRows: number[],
): void {
  const record = records[row];
  if (!record) return;
  const parent = nextParentLink(record);
  if (
    parent &&
    canRouteMergeParentOntoExistingTrack(record, parent, records)
  ) {
    routeMergeParentOntoExistingTrack(row, records, tracks, record, parent);
    return;
  }

  routePrimaryHistoryLineage(row, records, tracks, paletteEndRows, record);
}

function canRouteMergeParentOntoExistingTrack(
  record: HistoryEventRecord,
  parent: HistoryParentLink,
  records: readonly HistoryEventRecord[],
): boolean {
  if (record.parents.length < 2 || record.trackIndex === undefined) return false;
  if (parent.parentRow === null) return false;
  return records[parent.parentRow]?.trackIndex !== undefined;
}

function routeMergeParentOntoExistingTrack(
  startRow: number,
  records: readonly HistoryEventRecord[],
  tracks: readonly HistoryRouteTrack[],
  record: HistoryEventRecord,
  parent: HistoryParentLink,
): void {
  if (parent.parentRow === null) return;
  const parentTrackIndex = records[parent.parentRow]?.trackIndex;
  const parentTrack =
    parentTrackIndex === undefined ? undefined : tracks[parentTrackIndex];
  if (!parentTrack || parentTrackIndex === undefined) return;

  let lastPoint = historyEventPoint(record);
  for (let row = startRow + 1; row < records.length; row++) {
    const current = records[row]!;
    const existingPoint = matchingHistoryReservationPoint(
      current,
      parent.parentRow,
      parentTrackIndex,
    );
    const foundParentTrack = existingPoint !== null;
    const currentPoint = existingPoint ?? openHistoryLanePoint(current);
    appendHistoryRoutePiece(parentTrack, lastPoint, currentPoint, parent);
    reserveHistoryLanePoint(
      current,
      currentPoint.lane,
      parent.parentRow,
      parentTrackIndex,
    );
    lastPoint = currentPoint;
    if (foundParentTrack) {
      record.parentCursor++;
      break;
    }
  }
}

function routePrimaryHistoryLineage(
  startRow: number,
  records: readonly HistoryEventRecord[],
  tracks: HistoryRouteTrack[],
  paletteEndRows: number[],
  startRecord: HistoryEventRecord,
): void {
  const colorIndex = chooseHistoryPaletteSlot(startRow, paletteEndRows);
  const track = createHistoryRouteTrack(tracks.length, colorIndex);
  const trackIndex = tracks.length;
  tracks.push(track);

  let record = startRecord;
  let parent = nextParentLink(record);
  let lastPoint =
    record.trackIndex === undefined
      ? openHistoryLanePoint(record)
      : historyEventPoint(record);
  const startingParentCursor = record.parentCursor;

  claimHistoryEventTrack(record, trackIndex, colorIndex, lastPoint.lane);
  reserveHistoryLanePoint(record, lastPoint.lane, record.row, trackIndex);

  for (let row = startRow + 1; row < records.length; row++) {
    if (!parent) break;
    const current = records[row]!;
    const currentPoint =
      parent.parentRow === current.row && current.trackIndex !== undefined
        ? historyEventPoint(current)
        : openHistoryLanePoint(
            current,
            row === startRow + 1 && startingParentCursor > 0
              ? lastPoint.lane
              : 0,
          );

    appendHistoryRoutePiece(track, lastPoint, currentPoint, parent);
    reserveHistoryLanePoint(
      current,
      currentPoint.lane,
      parent.parentRow,
      trackIndex,
    );
    lastPoint = currentPoint;

    if (parent.parentRow === current.row) {
      record.parentCursor++;
      const parentAlreadyTracked = current.trackIndex !== undefined;
      claimHistoryEventTrack(current, trackIndex, colorIndex, currentPoint.lane);
      record = current;
      parent = nextParentLink(record);
      if (!parent || parentAlreadyTracked) break;
    }
  }

  if (parent?.truncated) {
    const bottomRow = Math.max(lastPoint.row + 0.5, records.length - 0.5);
    if (bottomRow > lastPoint.row) {
      const bottomPoint = { lane: lastPoint.lane, row: bottomRow };
      appendHistoryRoutePiece(track, lastPoint, bottomPoint, parent);
      lastPoint = bottomPoint;
    }
    record.parentCursor++;
  }

  track.endRow = Math.max(startRow, Math.ceil(lastPoint.row));
  paletteEndRows[track.colorIndex] = track.endRow;
}

function nextParentLink(record: HistoryEventRecord): HistoryParentLink | null {
  return record.parents[record.parentCursor] ?? null;
}

function createHistoryRouteTrack(
  index: number,
  colorIndex: number,
): HistoryRouteTrack {
  return {
    id: `track:${index}`,
    colorIndex,
    pieces: [],
    endRow: 0,
  };
}

function claimHistoryEventTrack(
  record: HistoryEventRecord,
  trackIndex: number,
  colorIndex: number,
  lane: number,
): void {
  if (record.trackIndex !== undefined) return;
  record.trackIndex = trackIndex;
  record.colorIndex = colorIndex;
  record.lane = lane;
}

function historyEventPoint(
  record: HistoryEventRecord,
): NexusDashboardHistoryPoint {
  return { lane: record.lane, row: record.row };
}

function openHistoryLanePoint(
  record: HistoryEventRecord,
  minLane = 0,
): NexusDashboardHistoryPoint {
  let lane = Math.max(record.nextFreeLane, minLane);
  while (record.reservations[lane]) lane++;
  return { lane, row: record.row };
}

function matchingHistoryReservationPoint(
  record: HistoryEventRecord,
  targetRow: number | null,
  trackIndex: number,
): NexusDashboardHistoryPoint | null {
  const lane = record.reservations.findIndex(
    (reservation) =>
      reservation?.targetRow === targetRow &&
      reservation.trackIndex === trackIndex,
  );
  return lane >= 0 ? { lane, row: record.row } : null;
}

function reserveHistoryLanePoint(
  record: HistoryEventRecord,
  lane: number,
  targetRow: number | null,
  trackIndex: number,
): void {
  record.reservations[lane] = { targetRow, trackIndex };
  while (record.reservations[record.nextFreeLane]) record.nextFreeLane++;
}

function appendHistoryRoutePiece(
  track: HistoryRouteTrack,
  p1: NexusDashboardHistoryPoint,
  p2: NexusDashboardHistoryPoint,
  parent: HistoryParentLink,
): void {
  if (p1.lane === p2.lane && p1.row === p2.row) return;
  track.pieces.push({
    ...(parent.edgeId ? { edgeId: parent.edgeId } : {}),
    targetEventId: parent.parentId,
    truncated: parent.truncated,
    p1,
    p2,
  });
}

function chooseHistoryPaletteSlot(
  startRow: number,
  paletteEndRows: readonly number[],
): number {
  for (let index = 0; index < paletteEndRows.length; index++) {
    if (startRow > (paletteEndRows[index] ?? 0)) return index;
  }
  return paletteEndRows.length;
}

function historySegmentsFromTracks(
  tracks: readonly HistoryRouteTrack[],
): NexusDashboardHistorySegment[] {
  const segments: NexusDashboardHistorySegment[] = [];
  for (const track of tracks) {
    let current:
      | {
          edgeId?: string;
          targetEventId: string;
          truncated: boolean;
          points: NexusDashboardHistoryPoint[];
        }
      | null = null;

    const flush = () => {
      if (!current || current.points.length < 2) return;
      segments.push(
        historySegmentFromRoute(track, current, segments.length),
      );
    };

    for (const piece of track.pieces) {
      const sameSegment =
        current &&
        current.edgeId === piece.edgeId &&
        current.targetEventId === piece.targetEventId &&
        current.truncated === piece.truncated &&
        historyPointsTouch(current.points[current.points.length - 1], piece.p1);

      if (!sameSegment) {
        flush();
        current = {
          ...(piece.edgeId ? { edgeId: piece.edgeId } : {}),
          targetEventId: piece.targetEventId,
          truncated: piece.truncated,
          points: [piece.p1],
        };
      }
      current?.points.push(piece.p2);
    }
    flush();
  }
  return segments;
}

function historySegmentFromRoute(
  track: HistoryRouteTrack,
  route: {
    readonly edgeId?: string;
    readonly targetEventId: string;
    readonly truncated: boolean;
    readonly points: readonly NexusDashboardHistoryPoint[];
  },
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
    ...(route.edgeId ? { edgeId: route.edgeId } : {}),
    targetEventId: route.targetEventId,
    truncated: route.truncated || undefined,
    trackId: track.id,
    colorIndex: track.colorIndex,
    fromLane: first.lane,
    toLane: last.lane,
    fromRow: first.row,
    toRow: last.row,
    points,
  };
}

function historyPointsTouch(
  left: NexusDashboardHistoryPoint | undefined,
  right: NexusDashboardHistoryPoint,
): boolean {
  return Boolean(left && left.lane === right.lane && left.row === right.row);
}

function historyEdgeId(
  fromEventId: string,
  toEventId: string,
  parentIndex: number,
): string {
  return `edge:${fromEventId}->${toEventId}:${parentIndex}`;
}
