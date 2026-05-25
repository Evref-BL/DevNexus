export interface NexusCockpitHistoryGraphPoint {
  readonly lane: number;
  readonly index: number;
}

export interface NexusCockpitHistoryGraphRoute {
  readonly colorLane?: number;
  readonly fromLane?: number;
  readonly toLane?: number;
  readonly fromIndex?: number;
  readonly toIndex?: number;
  readonly points?: readonly NexusCockpitHistoryGraphPoint[];
}

export interface NexusCockpitHistoryGraphRow {
  readonly colorLane?: number;
  readonly lane: number;
  readonly index: number;
  readonly selectId?: string;
  readonly selected?: boolean;
  readonly tooltip?: string;
  readonly commit?: {
    readonly authorName?: string;
    readonly committedAt?: string;
    readonly hash?: string;
    readonly shortHash?: string;
    readonly subject?: string;
  };
}

export interface NexusCockpitHistoryGraph {
  readonly maxLane?: number;
  readonly rows: readonly NexusCockpitHistoryGraphRow[];
  readonly paths?: readonly NexusCockpitHistoryGraphRoute[];
}

export interface NexusCockpitHistoryGraphSvgOptions {
  readonly ariaLabel?: string;
  readonly branchColorCount?: number;
  readonly laneGap?: number;
  readonly minWidth?: number;
  readonly nodeRadius?: number;
  readonly offsetX?: number;
  readonly rowHeight?: number;
}

export interface NexusCockpitHistoryGraphSvgPoint {
  readonly lane: number;
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

export interface NexusCockpitHistoryGraphSvgRoute {
  readonly id: string;
  readonly colorIndex: number;
  readonly d: string;
  readonly points: readonly NexusCockpitHistoryGraphSvgPoint[];
}

export interface NexusCockpitHistoryGraphSvgNode {
  readonly id: string;
  readonly colorIndex: number;
  readonly eventClass: "source-change";
  readonly lane: number;
  readonly index: number;
  readonly selected: boolean;
  readonly tooltip: string;
  readonly x: number;
  readonly y: number;
  readonly label: string;
}

export interface NexusCockpitHistoryGraphSvgHitTarget {
  readonly id: string;
  readonly index: number;
  readonly selected: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NexusCockpitHistoryGraphSvgModel {
  readonly width: number;
  readonly height: number;
  readonly laneCount: number;
  readonly rowCount: number;
  readonly rowHeight: number;
  readonly nodeRadius: number;
  readonly hitTargets: readonly NexusCockpitHistoryGraphSvgHitTarget[];
  readonly routes: readonly NexusCockpitHistoryGraphSvgRoute[];
  readonly nodes: readonly NexusCockpitHistoryGraphSvgNode[];
}

export function renderNexusCockpitHistoryGraphSvg(
  graph: NexusCockpitHistoryGraph,
  options: NexusCockpitHistoryGraphSvgOptions = {},
): string {
  const model = buildNexusCockpitHistoryGraphSvgModel(graph, options);
  const ariaLabel = escapeNexusCockpitHistoryGraphAttribute(
    options.ariaLabel ?? "History graph",
  );
  const paths = model.routes
    .map((route) => {
      const color = `var(--dn-branch-${route.colorIndex})`;
      const id = escapeNexusCockpitHistoryGraphAttribute(route.id);
      const d = escapeNexusCockpitHistoryGraphAttribute(route.d);
      return `<g data-history-route-id="${id}" data-history-color-index="${route.colorIndex}"><path class="dn-git-line-shadow" d="${d}" /><path class="dn-git-line" d="${d}" stroke="${color}" /></g>`;
    })
    .join("");
  const hitTargets = model.hitTargets
    .map((target) => {
      const id = escapeNexusCockpitHistoryGraphAttribute(target.id);
      const selected = target.selected ? " selected" : "";
      return `<rect class="dn-git-row-hit${selected}" data-select-id="${id}" data-history-event-id="${id}" aria-hidden="true" x="${target.x}" y="${target.y}" width="${target.width}" height="${target.height}" />`;
    })
    .join("");
  const nodes = model.nodes
    .map((node) => {
      const id = escapeNexusCockpitHistoryGraphAttribute(node.id);
      const label = escapeNexusCockpitHistoryGraphAttribute(node.label);
      const tooltip = escapeNexusCockpitHistoryGraphAttribute(node.tooltip);
      const color = `var(--dn-branch-${node.colorIndex})`;
      const selected = node.selected ? " selected" : "";
      return `<circle class="dn-git-node${selected}" data-select-id="${id}" data-history-event-class="${node.eventClass}" data-history-event-id="${id}" data-dn-tooltip="${tooltip}" data-dn-tooltip-mode="always" aria-label="${label}" cx="${node.x}" cy="${node.y}" r="${model.nodeRadius}" fill="${color}" stroke="var(--dn-surface)" stroke-width="1.6" />`;
    })
    .join("");
  return `<svg class="dn-git-graph dn-history-graph" width="${model.width}" height="${model.height}" viewBox="0 0 ${model.width} ${model.height}" role="img" aria-label="${ariaLabel}" data-history-row-count="${model.rowCount}" data-history-lane-count="${model.laneCount}">${hitTargets}${paths}${nodes}</svg>`;
}

export function buildNexusCockpitHistoryGraphSvgModel(
  graph: NexusCockpitHistoryGraph,
  options: NexusCockpitHistoryGraphSvgOptions = {},
): NexusCockpitHistoryGraphSvgModel {
  const metrics = nexusCockpitHistoryGraphSvgMetrics(options);
  const rows = graph.rows ?? [];
  const routes = graph.paths ?? [];
  const rowCount = Math.max(
    1,
    rows.length,
    Math.ceil(
      Math.max(
        0,
        ...rows.map((row) =>
          finiteNexusCockpitHistoryGraphNumber(row.index, 0),
        ),
        ...routes.flatMap((route) =>
          nexusCockpitHistoryGraphRoutePoints(route).map((point) => point.index),
        ),
      ) + 0.5,
    ),
  );
  const maxLane = Math.max(
    0,
    finiteNexusCockpitHistoryGraphNumber(graph.maxLane, 0),
    ...rows.map((row) => finiteNexusCockpitHistoryGraphNumber(row.lane, 0)),
    ...routes.flatMap((route) =>
      nexusCockpitHistoryGraphRoutePoints(route).map((point) =>
        finiteNexusCockpitHistoryGraphNumber(point.lane, 0),
      ),
    ),
  );
  const laneCount = maxLane + 1;
  const width = Math.max(
    metrics.minWidth,
    metrics.offsetX * 2 + maxLane * metrics.laneGap,
  );
  const height = Math.max(metrics.rowHeight, rowCount * metrics.rowHeight);
  const x = (lane: number): number =>
    metrics.offsetX + finiteNexusCockpitHistoryGraphNumber(lane, 0) * metrics.laneGap;
  const y = (index: number): number =>
    metrics.rowHeight / 2 +
    finiteNexusCockpitHistoryGraphNumber(index, 0) * metrics.rowHeight;

  return {
    width,
    height,
    laneCount,
    rowCount,
    rowHeight: metrics.rowHeight,
    nodeRadius: metrics.nodeRadius,
    hitTargets: rows.map((row, index) => {
      const id = nexusCockpitHistoryGraphNodeId(row, index);
      const nodeY = y(row.index);
      return {
        id,
        index: row.index,
        selected: row.selected === true,
        x: 0,
        y: Math.max(0, nodeY - metrics.rowHeight / 2),
        width,
        height: metrics.rowHeight,
      };
    }),
    routes: routes
      .map((route, index) => {
        const points = nexusCockpitHistoryGraphRoutePoints(route).map((point) => ({
          lane: point.lane,
          index: point.index,
          x: x(point.lane),
          y: y(point.index),
        }));
        return {
          id: `route:${index}`,
          colorIndex: nexusCockpitHistoryGraphColorIndex(
            route.colorLane ?? route.fromLane ?? 0,
            metrics.branchColorCount,
          ),
          d: nexusCockpitHistoryGraphRouteD(points, metrics.rowHeight),
          points,
        };
      })
      .filter((route) => route.points.length > 1 && route.d !== ""),
    nodes: rows.map((row, index) => ({
      id: nexusCockpitHistoryGraphNodeId(row, index),
      colorIndex: nexusCockpitHistoryGraphColorIndex(
        row.colorLane ?? row.lane,
        metrics.branchColorCount,
      ),
      eventClass: "source-change" as const,
      lane: row.lane,
      index: row.index,
      selected: row.selected === true,
      tooltip: nexusCockpitHistoryGraphNodeTooltip(row, index),
      x: x(row.lane),
      y: y(row.index),
      label: nexusCockpitHistoryGraphNodeLabel(row, index),
    })),
  };
}

export function renderNexusCockpitHistoryGraphSvgClientSource(): string {
  return [
    renderNexusCockpitHistoryGraphSvg,
    buildNexusCockpitHistoryGraphSvgModel,
    nexusCockpitHistoryGraphSvgMetrics,
    nexusCockpitHistoryGraphRoutePoints,
    nexusCockpitHistoryGraphRouteD,
    nexusCockpitHistoryGraphLaneTransitionD,
    nexusCockpitHistoryGraphColorIndex,
    nexusCockpitHistoryGraphNodeId,
    nexusCockpitHistoryGraphNodeLabel,
    nexusCockpitHistoryGraphNodeTooltip,
    finiteNexusCockpitHistoryGraphNumber,
    formatNexusCockpitHistoryGraphNumber,
    escapeNexusCockpitHistoryGraphAttribute,
  ]
    .map((fn) => fn.toString())
    .join("\n\n");
}

function nexusCockpitHistoryGraphSvgMetrics(
  options: NexusCockpitHistoryGraphSvgOptions,
): Required<NexusCockpitHistoryGraphSvgOptions> {
  return {
    ariaLabel: options.ariaLabel ?? "History graph",
    branchColorCount: Math.max(
      1,
      Math.floor(
        finiteNexusCockpitHistoryGraphNumber(options.branchColorCount, 7),
      ),
    ),
    laneGap: Math.max(
      1,
      finiteNexusCockpitHistoryGraphNumber(options.laneGap, 22),
    ),
    minWidth: Math.max(
      1,
      finiteNexusCockpitHistoryGraphNumber(options.minWidth, 148),
    ),
    nodeRadius: Math.max(
      0.5,
      finiteNexusCockpitHistoryGraphNumber(options.nodeRadius, 5.2),
    ),
    offsetX: Math.max(
      0,
      finiteNexusCockpitHistoryGraphNumber(options.offsetX, 28),
    ),
    rowHeight: Math.max(
      1,
      finiteNexusCockpitHistoryGraphNumber(options.rowHeight, 30),
    ),
  };
}

function nexusCockpitHistoryGraphRoutePoints(
  route: NexusCockpitHistoryGraphRoute,
): readonly NexusCockpitHistoryGraphPoint[] {
  if (route.points?.length) return route.points;
  return [
    {
      lane: finiteNexusCockpitHistoryGraphNumber(route.fromLane, 0),
      index: finiteNexusCockpitHistoryGraphNumber(route.fromIndex, 0),
    },
    {
      lane: finiteNexusCockpitHistoryGraphNumber(route.toLane, 0),
      index: finiteNexusCockpitHistoryGraphNumber(route.toIndex, 0),
    },
  ];
}

function nexusCockpitHistoryGraphRouteD(
  points: readonly NexusCockpitHistoryGraphSvgPoint[],
  rowHeight: number,
): string {
  if (!points.length) return "";
  let d = `M ${formatNexusCockpitHistoryGraphNumber(points[0]!.x)} ${formatNexusCockpitHistoryGraphNumber(points[0]!.y)}`;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!;
    const to = points[index]!;
    if (from.x === to.x) {
      d += ` V ${formatNexusCockpitHistoryGraphNumber(to.y)}`;
    } else if (from.y === to.y) {
      d += ` H ${formatNexusCockpitHistoryGraphNumber(to.x)}`;
    } else {
      d += nexusCockpitHistoryGraphLaneTransitionD(from, to, rowHeight);
    }
  }
  return d;
}

function nexusCockpitHistoryGraphLaneTransitionD(
  from: NexusCockpitHistoryGraphSvgPoint,
  to: NexusCockpitHistoryGraphSvgPoint,
  rowHeight: number,
): string {
  const dy = to.y - from.y;
  const directionY = Math.sign(dy) || 1;
  const curve = Math.min(rowHeight * 0.8, Math.abs(dy) * 0.8);
  return ` C ${formatNexusCockpitHistoryGraphNumber(from.x)} ${formatNexusCockpitHistoryGraphNumber(from.y + directionY * curve)}, ${formatNexusCockpitHistoryGraphNumber(to.x)} ${formatNexusCockpitHistoryGraphNumber(to.y - directionY * curve)}, ${formatNexusCockpitHistoryGraphNumber(to.x)} ${formatNexusCockpitHistoryGraphNumber(to.y)}`;
}

function nexusCockpitHistoryGraphColorIndex(
  value: number | undefined,
  branchColorCount: number,
): number {
  const color = Math.floor(finiteNexusCockpitHistoryGraphNumber(value, 0));
  return ((color % branchColorCount) + branchColorCount) % branchColorCount;
}

function nexusCockpitHistoryGraphNodeId(
  row: NexusCockpitHistoryGraphRow,
  index: number,
): string {
  return String(row.selectId ?? row.commit?.hash ?? `event:${index}`);
}

function nexusCockpitHistoryGraphNodeLabel(
  row: NexusCockpitHistoryGraphRow,
  index: number,
): string {
  const subject = String(row.commit?.subject ?? "").trim();
  const shortHash = String(row.commit?.shortHash ?? "").trim();
  if (subject && shortHash) return `${subject} (${shortHash})`;
  return subject || shortHash || `Event ${index + 1}`;
}

function nexusCockpitHistoryGraphNodeTooltip(
  row: NexusCockpitHistoryGraphRow,
  index: number,
): string {
  const explicit = String(row.tooltip ?? "").trim();
  if (explicit) return explicit;
  const label = nexusCockpitHistoryGraphNodeLabel(row, index);
  const author = String(row.commit?.authorName ?? "").trim();
  const date = String(row.commit?.committedAt ?? "").trim();
  return [label, author, date].filter(Boolean).join(" · ");
}

function finiteNexusCockpitHistoryGraphNumber(
  value: number | null | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatNexusCockpitHistoryGraphNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function escapeNexusCockpitHistoryGraphAttribute(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
