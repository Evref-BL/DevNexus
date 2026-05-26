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

interface HistoryParentReference {
  readonly parentId: string;
  readonly parentIndex: number;
  readonly vertex: HistoryVertex | null;
  readonly edgeId?: string;
  readonly truncated: boolean;
}

interface HistoryConnection {
  readonly connectsTo: HistoryVertex | null;
  readonly branch: HistoryBranch;
}

interface HistoryLine {
  readonly edgeId?: string;
  readonly targetEventId: string;
  readonly truncated: boolean;
  readonly p1: NexusDashboardHistoryPoint;
  readonly p2: NexusDashboardHistoryPoint;
}

class HistoryBranch {
  private end = 0;
  private readonly routeLines: HistoryLine[] = [];

  constructor(
    public readonly id: string,
    public readonly colorIndex: number,
  ) {}

  addLine(
    p1: NexusDashboardHistoryPoint,
    p2: NexusDashboardHistoryPoint,
    parent: HistoryParentReference,
  ): void {
    if (p1.lane === p2.lane && p1.row === p2.row) return;
    this.routeLines.push({
      ...(parent.edgeId ? { edgeId: parent.edgeId } : {}),
      targetEventId: parent.parentId,
      truncated: parent.truncated,
      p1,
      p2,
    });
  }

  get lines(): readonly HistoryLine[] {
    return this.routeLines;
  }

  getEnd(): number {
    return this.end;
  }

  setEnd(end: number): void {
    this.end = end;
  }
}

class HistoryVertex {
  private branch: HistoryBranch | null = null;
  private lane = 0;
  private nextLane = 0;
  private nextParentIndex = 0;
  private readonly connections: Array<HistoryConnection | undefined> = [];
  private readonly parentReferences: HistoryParentReference[] = [];

  readonly children: HistoryVertex[] = [];

  constructor(
    readonly event: NexusDashboardHistoryEvent,
    readonly row: number,
  ) {}

  addParent(parent: HistoryParentReference): void {
    this.parentReferences.push(parent);
  }

  addChild(vertex: HistoryVertex): void {
    this.children.push(vertex);
  }

  getNextParent(): HistoryParentReference | null {
    return this.parentReferences[this.nextParentIndex] ?? null;
  }

  getParentProgress(): number {
    return this.nextParentIndex;
  }

  registerParentProcessed(): void {
    this.nextParentIndex++;
  }

  isMerge(): boolean {
    return this.parentReferences.length > 1;
  }

  isNotOnBranch(): boolean {
    return this.branch === null;
  }

  getBranch(): HistoryBranch | null {
    return this.branch;
  }

  addToBranch(branch: HistoryBranch, lane: number): void {
    if (this.branch !== null) return;
    this.branch = branch;
    this.lane = lane;
  }

  getLane(): number {
    return this.lane;
  }

  getColorIndex(): number {
    return this.branch?.colorIndex ?? 0;
  }

  getPoint(): NexusDashboardHistoryPoint {
    return { lane: this.lane, row: this.row };
  }

  getNextPoint(minLane = 0): NexusDashboardHistoryPoint {
    let lane = Math.max(this.nextLane, minLane);
    while (this.connections[lane]) lane++;
    return { lane, row: this.row };
  }

  getPointConnectingTo(
    vertex: HistoryVertex | null,
    branch: HistoryBranch,
  ): NexusDashboardHistoryPoint | null {
    const lane = this.connections.findIndex(
      (connection) =>
        connection?.connectsTo === vertex && connection.branch === branch,
    );
    return lane >= 0 ? { lane, row: this.row } : null;
  }

  registerUnavailablePoint(
    lane: number,
    connectsTo: HistoryVertex | null,
    branch: HistoryBranch,
  ): void {
    this.connections[lane] = { connectsTo, branch };
    while (this.connections[this.nextLane]) this.nextLane++;
  }
}

export function buildNexusDashboardHistoryLayout(
  input: NexusDashboardHistoryLayoutInput,
): NexusDashboardHistoryLayout {
  const events = input.events ?? [];
  const vertices = events.map((event, row) => new HistoryVertex(event, row));
  const vertexByEventId = new Map(
    vertices.map((vertex) => [vertex.event.id, vertex]),
  );
  const edges: NexusDashboardHistoryEdge[] = [];
  const truncatedParentIds: string[] = [];

  for (const vertex of vertices) {
    vertex.event.parentIds.forEach((parentId, parentIndex) => {
      const parentVertex = vertexByEventId.get(parentId) ?? null;
      const edgeId = parentVertex
        ? historyEdgeId(vertex.event.id, parentId, parentIndex)
        : undefined;
      if (parentVertex) {
        edges.push({
          id: edgeId!,
          kind: "parent",
          fromEventId: vertex.event.id,
          toEventId: parentId,
        });
        parentVertex.addChild(vertex);
      } else {
        truncatedParentIds.push(parentId);
      }
      vertex.addParent({
        parentId,
        parentIndex,
        vertex: parentVertex,
        ...(edgeId ? { edgeId } : {}),
        truncated: parentVertex === null,
      });
    });
  }

  const branches: HistoryBranch[] = [];
  const availableColorEnds: number[] = [];
  let row = 0;
  while (row < vertices.length) {
    const vertex = vertices[row]!;
    if (vertex.getNextParent() !== null || vertex.isNotOnBranch()) {
      determineHistoryPath(row, vertices, branches, availableColorEnds);
    } else {
      row++;
    }
  }

  const nodes: NexusDashboardHistoryNode[] = vertices.map((vertex) => ({
    id: vertex.event.id,
    eventClass: "source-change",
    eventId: vertex.event.id,
    row: vertex.row,
    lane: vertex.getLane(),
    colorIndex: vertex.getColorIndex(),
  }));
  const segments = historySegmentsFromBranches(branches);
  const tracks = new Map(
    branches
      .filter((branch) => branch.lines.length > 0)
      .map((branch) => [
        branch.id,
        { id: branch.id, colorIndex: branch.colorIndex },
      ]),
  );

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
    HistoryBranch,
    HistoryVertex,
    historyEdgeId,
    determineHistoryPath,
    determineHistoryMergePath,
    determineNormalHistoryPath,
    getAvailableHistoryColor,
    historySegmentsFromBranches,
    historySegmentFromPoints,
    pointsConnect,
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

function determineHistoryPath(
  startAt: number,
  vertices: readonly HistoryVertex[],
  branches: HistoryBranch[],
  availableColorEnds: number[],
): void {
  const vertex = vertices[startAt];
  const parent = vertex?.getNextParent();
  if (!vertex) return;

  if (
    parent?.vertex &&
    vertex.isMerge() &&
    !vertex.isNotOnBranch() &&
    !parent.vertex.isNotOnBranch()
  ) {
    determineHistoryMergePath(startAt, vertices, vertex, parent);
    return;
  }

  determineNormalHistoryPath(startAt, vertices, vertex, branches, availableColorEnds);
}

function determineHistoryMergePath(
  startAt: number,
  vertices: readonly HistoryVertex[],
  vertex: HistoryVertex,
  parent: HistoryParentReference,
): void {
  const parentBranch = parent.vertex?.getBranch();
  if (!parent.vertex || !parentBranch) return;
  let lastPoint = vertex.getPoint();
  for (let index = startAt + 1; index < vertices.length; index++) {
    const current = vertices[index]!;
    const existingPoint = current.getPointConnectingTo(parent.vertex, parentBranch);
    const foundParentConnection = existingPoint !== null;
    const currentPoint = existingPoint ?? current.getNextPoint();
    parentBranch.addLine(lastPoint, currentPoint, parent);
    current.registerUnavailablePoint(currentPoint.lane, parent.vertex, parentBranch);
    lastPoint = currentPoint;
    if (foundParentConnection) {
      vertex.registerParentProcessed();
      break;
    }
  }
}

function determineNormalHistoryPath(
  startAt: number,
  vertices: readonly HistoryVertex[],
  startVertex: HistoryVertex,
  branches: HistoryBranch[],
  availableColorEnds: number[],
): void {
  const colorIndex = getAvailableHistoryColor(startAt, availableColorEnds);
  const branch = new HistoryBranch(`track:${branches.length}`, colorIndex);
  let vertex = startVertex;
  let parent = vertex.getNextParent();
  let lastPoint = vertex.isNotOnBranch()
    ? vertex.getNextPoint()
    : vertex.getPoint();
  const startParentProgress = vertex.getParentProgress();

  vertex.addToBranch(branch, lastPoint.lane);
  vertex.registerUnavailablePoint(lastPoint.lane, vertex, branch);

  for (let index = startAt + 1; index < vertices.length; index++) {
    if (!parent) break;
    const current = vertices[index]!;
    const currentPoint =
      parent.vertex === current && !current.isNotOnBranch()
        ? current.getPoint()
        : current.getNextPoint(
            index === startAt + 1 && startParentProgress > 0
              ? lastPoint.lane
              : 0,
          );

    branch.addLine(lastPoint, currentPoint, parent);
    current.registerUnavailablePoint(currentPoint.lane, parent.vertex, branch);
    lastPoint = currentPoint;

    if (parent.vertex === current) {
      vertex.registerParentProcessed();
      const parentWasAlreadyOnBranch = !current.isNotOnBranch();
      current.addToBranch(branch, currentPoint.lane);
      vertex = current;
      parent = vertex.getNextParent();
      if (!parent || parentWasAlreadyOnBranch) break;
    }
  }

  if (parent?.truncated) {
    const bottomRow = Math.max(lastPoint.row + 0.5, vertices.length - 0.5);
    if (bottomRow > lastPoint.row) {
      const bottomPoint = { lane: lastPoint.lane, row: bottomRow };
      branch.addLine(lastPoint, bottomPoint, parent);
      lastPoint = bottomPoint;
    }
    vertex.registerParentProcessed();
  }

  branch.setEnd(Math.max(startAt, Math.ceil(lastPoint.row)));
  branches.push(branch);
  availableColorEnds[branch.colorIndex] = branch.getEnd();
}

function getAvailableHistoryColor(
  startAt: number,
  availableColorEnds: readonly number[],
): number {
  for (let index = 0; index < availableColorEnds.length; index++) {
    if (startAt > (availableColorEnds[index] ?? 0)) return index;
  }
  return availableColorEnds.length;
}

function historySegmentsFromBranches(
  branches: readonly HistoryBranch[],
): NexusDashboardHistorySegment[] {
  const segments: NexusDashboardHistorySegment[] = [];
  for (const branch of branches) {
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
        historySegmentFromPoints(branch, current, segments.length),
      );
    };

    for (const line of branch.lines) {
      const sameSegment =
        current &&
        current.edgeId === line.edgeId &&
        current.targetEventId === line.targetEventId &&
        current.truncated === line.truncated &&
        pointsConnect(current.points[current.points.length - 1], line.p1);

      if (!sameSegment) {
        flush();
        current = {
          ...(line.edgeId ? { edgeId: line.edgeId } : {}),
          targetEventId: line.targetEventId,
          truncated: line.truncated,
          points: [line.p1],
        };
      }
      current?.points.push(line.p2);
    }
    flush();
  }
  return segments;
}

function historySegmentFromPoints(
  branch: HistoryBranch,
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
    trackId: branch.id,
    colorIndex: branch.colorIndex,
    fromLane: first.lane,
    toLane: last.lane,
    fromRow: first.row,
    toRow: last.row,
    points,
  };
}

function pointsConnect(
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
