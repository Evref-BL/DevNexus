const gitHistoryColumnStorageKey = "dev-nexus-cockpit-git-history-columns";
const gitHistoryColumnSpecs = {
  graph: { property: "--dn-git-graph-width", defaultWidth: 230, minWidth: 96, maxWidth: 520 },
  description: {
    property: "--dn-git-description-width",
    defaultWidth: 360,
    minWidth: 150,
    maxWidth: 760,
  },
  date: { property: "--dn-git-date-width", defaultWidth: 124, minWidth: 92, maxWidth: 230 },
  author: { property: "--dn-git-author-width", defaultWidth: 170, minWidth: 96, maxWidth: 320 },
  commit: { property: "--dn-git-commit-width", defaultWidth: 78, minWidth: 58, maxWidth: 150 },
} as const;
const gitHistoryColumnOrder = ["graph", "description", "date", "author", "commit"] as const;
const gitHistoryColumnLabels = {
  graph: "Graph",
  description: "Description",
  date: "Date",
  author: "Author",
  commit: "Commit",
} as const;

type GitHistoryColumn = keyof typeof gitHistoryColumnSpecs;
type GitHistoryColumnWidths = Partial<Record<GitHistoryColumn, number>>;

export function bindGitHistoryColumnResizers(container: ParentNode): void {
  container.querySelectorAll<HTMLElement>("[data-git-resize-column]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => startGitHistoryColumnResize(event, handle));
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const board = handle.closest<HTMLElement>("[data-git-board]");
      const column = historyColumnFromAttribute(handle.getAttribute("data-git-resize-column"));
      if (!board || !column) return;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const step = event.shiftKey ? 32 : 12;
      updateGitHistoryColumnPairWidth(
        board,
        column,
        gitHistoryColumnWidth(board, column) + direction * step,
        handle,
      );
    });
  });
}

export function renderGitHistoryColumnHeader(
  column: GitHistoryColumn,
  label: string,
  widths: GitHistoryColumnWidths,
): string {
  const spec = gitHistoryColumnSpecs[column];
  const width = widths[column] ?? spec.defaultWidth;
  const nextColumn = nextGitHistoryColumn(column);
  const nextSpec = nextColumn ? gitHistoryColumnSpecs[nextColumn] : null;
  const nextWidth = nextColumn ? widths[nextColumn] ?? nextSpec!.defaultWidth : null;
  const totalWidth = nextWidth === null ? width : width + nextWidth;
  const minWidth = nextSpec ? Math.max(spec.minWidth, totalWidth - nextSpec.maxWidth) : spec.minWidth;
  const maxWidth = nextSpec ? Math.min(spec.maxWidth, totalWidth - nextSpec.minWidth) : spec.maxWidth;
  const nextLabel = nextColumn ? gitHistoryColumnLabels[nextColumn] : "";
  const handle = nextColumn
    ? `<span class="dn-git-resize-handle" role="separator" tabindex="0" aria-label="Resize ${escapeNexusCockpitHistoryColumnAttribute(label)} and ${escapeNexusCockpitHistoryColumnAttribute(nextLabel)} columns" aria-orientation="vertical" aria-valuemin="${escapeNexusCockpitHistoryColumnAttribute(minWidth)}" aria-valuemax="${escapeNexusCockpitHistoryColumnAttribute(maxWidth)}" aria-valuenow="${escapeNexusCockpitHistoryColumnAttribute(width)}" data-git-resize-column="${escapeNexusCockpitHistoryColumnAttribute(column)}" data-git-resize-next-column="${escapeNexusCockpitHistoryColumnAttribute(nextColumn)}"></span>`
    : "";
  return `<span class="dn-git-column-header" data-git-column="${escapeNexusCockpitHistoryColumnAttribute(column)}"><span class="dn-git-column-label">${escapeNexusCockpitHistoryColumnAttribute(label)}</span>${handle}</span>`;
}

export function gitHistoryColumnStyle(
  widths: GitHistoryColumnWidths = readStoredGitHistoryColumnWidths(),
): string {
  return Object.entries(gitHistoryColumnSpecs)
    .map(([column, spec]) =>
      `${spec.property}:${normalizeGitHistoryColumnWidth(
        column as GitHistoryColumn,
        widths[column as GitHistoryColumn],
      )}px`
    )
    .join(";");
}

export function readStoredGitHistoryColumnWidths(): Record<GitHistoryColumn, number> {
  const defaults = Object.fromEntries(
    Object.entries(gitHistoryColumnSpecs).map(([column, spec]) => [column, spec.defaultWidth]),
  ) as Record<GitHistoryColumn, number>;
  if (typeof window === "undefined") return defaults;
  try {
    const storage = window.localStorage;
    if (!storage) return defaults;
    const raw = storage.getItem(gitHistoryColumnStorageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    return Object.fromEntries(
      Object.entries(gitHistoryColumnSpecs).map(([column, spec]) => [
        column,
        normalizeGitHistoryColumnWidth(
          column as GitHistoryColumn,
          parsed?.[column] ?? spec.defaultWidth,
        ),
      ]),
    ) as Record<GitHistoryColumn, number>;
  } catch {
    return defaults;
  }
}

export function renderNexusCockpitHistoryColumnsClientSource(): string {
  return [
    `const gitHistoryColumnStorageKey = ${JSON.stringify(gitHistoryColumnStorageKey)};`,
    `const gitHistoryColumnSpecs = ${JSON.stringify(gitHistoryColumnSpecs)};`,
    `const gitHistoryColumnOrder = ${JSON.stringify(gitHistoryColumnOrder)};`,
    `const gitHistoryColumnLabels = ${JSON.stringify(gitHistoryColumnLabels)};`,
    bindGitHistoryColumnResizers,
    renderGitHistoryColumnHeader,
    gitHistoryColumnStyle,
    readStoredGitHistoryColumnWidths,
    writeStoredGitHistoryColumnWidths,
    normalizeGitHistoryColumnWidth,
    historyColumnFromAttribute,
    nextGitHistoryColumn,
    startGitHistoryColumnResize,
    updateGitHistoryColumnPairWidth,
    gitHistoryColumnPairLeftWidth,
    gitHistoryBoardColumnWidths,
    gitHistoryColumnWidth,
    escapeNexusCockpitHistoryColumnAttribute,
  ]
    .map((part) => part.toString())
    .join("\n\n");
}

function writeStoredGitHistoryColumnWidths(widths: GitHistoryColumnWidths): void {
  if (typeof window === "undefined") return;
  try {
    const storage = window.localStorage;
    if (!storage) return;
    storage.setItem(
      gitHistoryColumnStorageKey,
      JSON.stringify(
        Object.fromEntries(
          Object.keys(gitHistoryColumnSpecs).map((column) => [
            column,
            normalizeGitHistoryColumnWidth(
              column as GitHistoryColumn,
              widths?.[column as GitHistoryColumn],
            ),
          ]),
        ),
      ),
    );
  } catch {
    // Column resizing is still useful without persistent storage.
  }
}

function normalizeGitHistoryColumnWidth(column: GitHistoryColumn, value: unknown): number {
  const spec = gitHistoryColumnSpecs[column];
  const width = Number(value);
  if (!Number.isFinite(width)) return spec.defaultWidth;
  return Math.min(Math.max(Math.round(width), spec.minWidth), spec.maxWidth);
}

function historyColumnFromAttribute(value: string | null): GitHistoryColumn | null {
  return value && Object.hasOwn(gitHistoryColumnSpecs, value) ? (value as GitHistoryColumn) : null;
}

function nextGitHistoryColumn(column: GitHistoryColumn): GitHistoryColumn | null {
  const index = gitHistoryColumnOrder.indexOf(column);
  return index >= 0 ? gitHistoryColumnOrder[index + 1] ?? null : null;
}

function startGitHistoryColumnResize(event: PointerEvent, handle: HTMLElement): void {
  if (event.button !== undefined && event.button !== 0) return;
  const board = handle.closest<HTMLElement>("[data-git-board]");
  const column = historyColumnFromAttribute(handle.getAttribute("data-git-resize-column"));
  if (!board || !column) return;
  event.preventDefault();
  const startX = event.clientX ?? 0;
  const startWidth = gitHistoryColumnWidth(board, column);
  const nextColumn = nextGitHistoryColumn(column);
  if (!nextColumn) return;
  const pairWidth = startWidth + gitHistoryColumnWidth(board, nextColumn);
  board.classList.add("resizing");
  const move = (moveEvent: PointerEvent) => {
    updateGitHistoryColumnPairWidth(
      board,
      column,
      startWidth + ((moveEvent.clientX ?? startX) - startX),
      handle,
      pairWidth,
    );
  };
  const stop = () => {
    board.classList.remove("resizing");
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", stop);
    document.removeEventListener("pointercancel", stop);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", stop);
  document.addEventListener("pointercancel", stop);
}

function updateGitHistoryColumnPairWidth(
  board: HTMLElement,
  column: GitHistoryColumn,
  nextLeftWidth: number,
  handle: HTMLElement | null = null,
  pairWidth: number | null = null,
): void {
  const nextColumn = nextGitHistoryColumn(column);
  if (!nextColumn) return;
  const widths = gitHistoryBoardColumnWidths(board);
  const leftSpec = gitHistoryColumnSpecs[column];
  const rightSpec = gitHistoryColumnSpecs[nextColumn];
  const totalWidth = pairWidth ?? widths[column] + widths[nextColumn];
  const width = gitHistoryColumnPairLeftWidth(column, nextColumn, nextLeftWidth, totalWidth);
  const nextWidth = totalWidth - width;
  board.style.setProperty(leftSpec.property, `${width}px`);
  board.style.setProperty(rightSpec.property, `${nextWidth}px`);
  if (handle) {
    handle.setAttribute("aria-valuenow", String(width));
    handle.setAttribute("aria-valuemin", String(Math.max(leftSpec.minWidth, totalWidth - rightSpec.maxWidth)));
    handle.setAttribute("aria-valuemax", String(Math.min(leftSpec.maxWidth, totalWidth - rightSpec.minWidth)));
  }
  writeStoredGitHistoryColumnWidths({
    ...widths,
    [column]: width,
    [nextColumn]: nextWidth,
  });
}

function gitHistoryColumnPairLeftWidth(
  column: GitHistoryColumn,
  nextColumn: GitHistoryColumn,
  nextLeftWidth: number,
  pairWidth: number,
): number {
  const spec = gitHistoryColumnSpecs[column];
  const nextSpec = gitHistoryColumnSpecs[nextColumn];
  const minWidth = Math.max(spec.minWidth, pairWidth - nextSpec.maxWidth);
  const maxWidth = Math.min(spec.maxWidth, pairWidth - nextSpec.minWidth);
  return Math.min(Math.max(Math.round(nextLeftWidth), minWidth), maxWidth);
}

function gitHistoryBoardColumnWidths(board: HTMLElement): Record<GitHistoryColumn, number> {
  return Object.fromEntries(
    Object.entries(gitHistoryColumnSpecs).map(([column, spec]) => {
      const value = Number.parseInt(board.style.getPropertyValue(spec.property), 10);
      return [
        column,
        normalizeGitHistoryColumnWidth(
          column as GitHistoryColumn,
          Number.isFinite(value) ? value : spec.defaultWidth,
        ),
      ];
    }),
  ) as Record<GitHistoryColumn, number>;
}

function gitHistoryColumnWidth(board: HTMLElement, column: GitHistoryColumn): number {
  return gitHistoryBoardColumnWidths(board)[column] ?? gitHistoryColumnSpecs[column].defaultWidth;
}

function escapeNexusCockpitHistoryColumnAttribute(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
