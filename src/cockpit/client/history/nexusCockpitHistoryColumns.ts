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
      updateGitHistoryColumnWidth(
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
  return `<span class="dn-git-column-header" data-git-column="${escapeNexusCockpitHistoryColumnAttribute(column)}"><span class="dn-git-column-label">${escapeNexusCockpitHistoryColumnAttribute(label)}</span><span class="dn-git-resize-handle" role="separator" tabindex="0" aria-label="Resize ${escapeNexusCockpitHistoryColumnAttribute(label)} column" aria-orientation="vertical" aria-valuemin="${spec.minWidth}" aria-valuemax="${spec.maxWidth}" aria-valuenow="${escapeNexusCockpitHistoryColumnAttribute(width)}" data-git-resize-column="${escapeNexusCockpitHistoryColumnAttribute(column)}"></span></span>`;
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
    bindGitHistoryColumnResizers,
    renderGitHistoryColumnHeader,
    gitHistoryColumnStyle,
    readStoredGitHistoryColumnWidths,
    writeStoredGitHistoryColumnWidths,
    normalizeGitHistoryColumnWidth,
    historyColumnFromAttribute,
    startGitHistoryColumnResize,
    updateGitHistoryColumnWidth,
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

function startGitHistoryColumnResize(event: PointerEvent, handle: HTMLElement): void {
  if (event.button !== undefined && event.button !== 0) return;
  const board = handle.closest<HTMLElement>("[data-git-board]");
  const column = historyColumnFromAttribute(handle.getAttribute("data-git-resize-column"));
  if (!board || !column) return;
  event.preventDefault();
  const startX = event.clientX ?? 0;
  const startWidth = gitHistoryColumnWidth(board, column);
  board.classList.add("resizing");
  const move = (moveEvent: PointerEvent) => {
    updateGitHistoryColumnWidth(
      board,
      column,
      startWidth + ((moveEvent.clientX ?? startX) - startX),
      handle,
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

function updateGitHistoryColumnWidth(
  board: HTMLElement,
  column: GitHistoryColumn,
  nextWidth: number,
  handle: HTMLElement | null = null,
): void {
  const width = normalizeGitHistoryColumnWidth(column, nextWidth);
  const spec = gitHistoryColumnSpecs[column];
  board.style.setProperty(spec.property, `${width}px`);
  if (handle) handle.setAttribute("aria-valuenow", String(width));
  writeStoredGitHistoryColumnWidths({ ...gitHistoryBoardColumnWidths(board), [column]: width });
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
