const gitHistoryColumnStorageKey = "dev-nexus-cockpit-git-history-columns";
const gitHistoryColumnVisibilityStorageKey = "dev-nexus-cockpit-git-history-column-visibility";
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
type GitHistoryColumnVisibility = Record<GitHistoryColumn, boolean>;

export function bindGitHistoryColumnResizers(container: ParentNode): void {
  container.querySelectorAll<HTMLElement>("[data-git-resize-column]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => startGitHistoryColumnResize(event, handle));
    handle.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const board = handle.closest<HTMLElement>("[data-git-board]");
      const column = historyColumnFromAttribute(handle.getAttribute("data-git-resize-column"));
      const nextColumn = historyColumnFromAttribute(handle.getAttribute("data-git-resize-next-column"));
      if (!board || !column || !nextColumn) return;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const step = event.shiftKey ? 32 : 12;
      updateGitHistoryColumnPairWidth(
        board,
        column,
        nextColumn,
        gitHistoryColumnWidth(board, column) + direction * step,
        handle,
      );
    });
  });
  bindGitHistoryColumnVisibilityControls(container);
}

export function renderGitHistoryColumnHeader(
  column: GitHistoryColumn,
  label: string,
  widths: GitHistoryColumnWidths,
  visibility: GitHistoryColumnVisibility = readStoredGitHistoryColumnVisibility(),
): string {
  const spec = gitHistoryColumnSpecs[column];
  const width = widths[column] ?? spec.defaultWidth;
  const nextColumn = visibility[column] ? nextVisibleGitHistoryColumn(column, visibility) : null;
  const nextSpec = nextColumn ? gitHistoryColumnSpecs[nextColumn] : null;
  const nextWidth = nextColumn ? widths[nextColumn] ?? nextSpec!.defaultWidth : null;
  const totalWidth = nextWidth === null ? width : width + nextWidth;
  const minWidth = nextSpec ? Math.max(spec.minWidth, totalWidth - nextSpec.maxWidth) : spec.minWidth;
  const maxWidth = nextSpec ? Math.min(spec.maxWidth, totalWidth - nextSpec.minWidth) : spec.maxWidth;
  const nextLabel = nextColumn ? gitHistoryColumnLabels[nextColumn] : "";
  const handle = nextColumn
    ? `<span class="dn-git-resize-handle" role="separator" tabindex="0" aria-label="Resize ${escapeNexusCockpitHistoryColumnAttribute(label)} and ${escapeNexusCockpitHistoryColumnAttribute(nextLabel)} columns" aria-orientation="vertical" aria-valuemin="${escapeNexusCockpitHistoryColumnAttribute(minWidth)}" aria-valuemax="${escapeNexusCockpitHistoryColumnAttribute(maxWidth)}" aria-valuenow="${escapeNexusCockpitHistoryColumnAttribute(width)}" data-git-resize-column="${escapeNexusCockpitHistoryColumnAttribute(column)}" data-git-resize-next-column="${escapeNexusCockpitHistoryColumnAttribute(nextColumn)}"></span>`
    : "";
  return `<span class="dn-git-column-header" data-git-column="${escapeNexusCockpitHistoryColumnAttribute(column)}" data-git-cell="${escapeNexusCockpitHistoryColumnAttribute(column)}"><span class="dn-git-column-label">${escapeNexusCockpitHistoryColumnAttribute(label)}</span>${handle}</span>`;
}

export function gitHistoryColumnStyle(
  widths: GitHistoryColumnWidths = readStoredGitHistoryColumnWidths(),
  visibility: GitHistoryColumnVisibility = readStoredGitHistoryColumnVisibility(),
): string {
  return Object.entries(gitHistoryColumnSpecs)
    .map(([column, spec]) =>
      `${spec.property}:${visibility[column as GitHistoryColumn] ? normalizeGitHistoryColumnWidth(
        column as GitHistoryColumn,
        widths[column as GitHistoryColumn],
      ) : 0}px`
    )
    .join(";");
}

export function gitHistoryColumnVisibilityAttributes(
  visibility: GitHistoryColumnVisibility = readStoredGitHistoryColumnVisibility(),
): string {
  return gitHistoryColumnOrder
    .map((column) =>
      `data-git-column-${column}="${visibility[column] ? "visible" : "hidden"}"`
    )
    .join(" ");
}

export function renderGitHistoryColumnVisibilityMenu(
  visibility: GitHistoryColumnVisibility = readStoredGitHistoryColumnVisibility(),
  triggerHtml = "Columns",
): string {
  const options = gitHistoryColumnOrder
    .map((column) => {
      const checked = visibility[column] ? " checked" : "";
      return `<label class="dn-git-column-option"><input type="checkbox" data-git-column-toggle="${escapeNexusCockpitHistoryColumnAttribute(column)}"${checked} /> <span>${escapeNexusCockpitHistoryColumnAttribute(gitHistoryColumnLabels[column])}</span></label>`;
    })
    .join("");
  return `<details class="dn-git-column-menu" data-git-column-menu><summary class="dn-git-column-trigger" title="History options" aria-label="History options">${triggerHtml}</summary><div class="dn-git-column-options" role="group" aria-label="Visible event history columns">${options}</div></details>`;
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

export function readStoredGitHistoryColumnVisibility(): GitHistoryColumnVisibility {
  const defaults = gitHistoryDefaultColumnVisibility();
  if (typeof window === "undefined") return defaults;
  try {
    const storage = window.localStorage;
    if (!storage) return defaults;
    const raw = storage.getItem(gitHistoryColumnVisibilityStorageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    return normalizeGitHistoryColumnVisibility(parsed);
  } catch {
    return defaults;
  }
}

export function renderNexusCockpitHistoryColumnsClientSource(): string {
  return [
    `const gitHistoryColumnStorageKey = ${JSON.stringify(gitHistoryColumnStorageKey)};`,
    `const gitHistoryColumnVisibilityStorageKey = ${JSON.stringify(gitHistoryColumnVisibilityStorageKey)};`,
    `const gitHistoryColumnSpecs = ${JSON.stringify(gitHistoryColumnSpecs)};`,
    `const gitHistoryColumnOrder = ${JSON.stringify(gitHistoryColumnOrder)};`,
    `const gitHistoryColumnLabels = ${JSON.stringify(gitHistoryColumnLabels)};`,
    bindGitHistoryColumnResizers,
    renderGitHistoryColumnHeader,
    gitHistoryColumnStyle,
    gitHistoryColumnVisibilityAttributes,
    renderGitHistoryColumnVisibilityMenu,
    readStoredGitHistoryColumnWidths,
    readStoredGitHistoryColumnVisibility,
    writeStoredGitHistoryColumnWidths,
    writeStoredGitHistoryColumnVisibility,
    gitHistoryDefaultColumnVisibility,
    normalizeGitHistoryColumnVisibility,
    normalizeGitHistoryColumnWidth,
    historyColumnFromAttribute,
    nextGitHistoryColumn,
    nextVisibleGitHistoryColumn,
    bindGitHistoryColumnVisibilityControls,
    applyGitHistoryColumnVisibility,
    readGitHistoryColumnVisibilityFromControls,
    updateGitHistoryColumnMenuControls,
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

function writeStoredGitHistoryColumnVisibility(visibility: Partial<Record<GitHistoryColumn, boolean>>): void {
  if (typeof window === "undefined") return;
  try {
    const storage = window.localStorage;
    if (!storage) return;
    storage.setItem(
      gitHistoryColumnVisibilityStorageKey,
      JSON.stringify(normalizeGitHistoryColumnVisibility(visibility)),
    );
  } catch {
    // Visibility controls remain usable for the current page without storage.
  }
}

function gitHistoryDefaultColumnVisibility(): GitHistoryColumnVisibility {
  return Object.fromEntries(gitHistoryColumnOrder.map((column) => [column, true])) as GitHistoryColumnVisibility;
}

function normalizeGitHistoryColumnVisibility(
  visibility: Partial<Record<string, unknown>> | null | undefined,
): GitHistoryColumnVisibility {
  const normalized = Object.fromEntries(
    gitHistoryColumnOrder.map((column) => [
      column,
      visibility?.[column] === undefined ? true : visibility[column] !== false,
    ]),
  ) as GitHistoryColumnVisibility;
  if (!gitHistoryColumnOrder.some((column) => normalized[column])) normalized.description = true;
  return normalized;
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

function nextVisibleGitHistoryColumn(
  column: GitHistoryColumn,
  visibility: GitHistoryColumnVisibility = readStoredGitHistoryColumnVisibility(),
): GitHistoryColumn | null {
  let nextColumn = nextGitHistoryColumn(column);
  while (nextColumn) {
    if (visibility[nextColumn]) return nextColumn;
    nextColumn = nextGitHistoryColumn(nextColumn);
  }
  return null;
}

function bindGitHistoryColumnVisibilityControls(container: ParentNode): void {
  container.querySelectorAll<HTMLInputElement>("[data-git-column-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const menu = toggle.closest<HTMLElement>("[data-git-column-menu]");
      const panel = toggle.closest<HTMLElement>(".dn-git-panel");
      const board = panel?.querySelector<HTMLElement>("[data-git-board]") ?? null;
      const visibility = normalizeGitHistoryColumnVisibility(readGitHistoryColumnVisibilityFromControls(menu));
      writeStoredGitHistoryColumnVisibility(visibility);
      updateGitHistoryColumnMenuControls(menu, visibility);
      if (board) applyGitHistoryColumnVisibility(board, visibility);
      board?.dispatchEvent(new CustomEvent("dn-git-history-columns-change", { bubbles: true }));
    });
  });
}

function applyGitHistoryColumnVisibility(
  board: HTMLElement,
  visibility: GitHistoryColumnVisibility = readStoredGitHistoryColumnVisibility(),
): void {
  const widths = readStoredGitHistoryColumnWidths();
  for (const column of gitHistoryColumnOrder) {
    board.setAttribute(`data-git-column-${column}`, visibility[column] ? "visible" : "hidden");
    const spec = gitHistoryColumnSpecs[column];
    const width = visibility[column] ? normalizeGitHistoryColumnWidth(column, widths[column]) : 0;
    board.style.setProperty(spec.property, `${width}px`);
  }
}

function readGitHistoryColumnVisibilityFromControls(
  menu: Element | null,
): Partial<Record<GitHistoryColumn, boolean>> {
  const visibility = gitHistoryDefaultColumnVisibility();
  if (!menu) return visibility;
  menu.querySelectorAll<HTMLInputElement>("[data-git-column-toggle]").forEach((toggle) => {
    const column = historyColumnFromAttribute(toggle.getAttribute("data-git-column-toggle"));
    if (column) visibility[column] = toggle.checked;
  });
  return visibility;
}

function updateGitHistoryColumnMenuControls(
  menu: Element | null,
  visibility: GitHistoryColumnVisibility,
): void {
  if (!menu) return;
  const visibleCount = gitHistoryColumnOrder.filter((column) => visibility[column]).length;
  menu.querySelectorAll<HTMLInputElement>("[data-git-column-toggle]").forEach((toggle) => {
    const column = historyColumnFromAttribute(toggle.getAttribute("data-git-column-toggle"));
    if (!column) return;
    toggle.checked = visibility[column];
    toggle.disabled = visibility[column] && visibleCount === 1;
  });
}

function startGitHistoryColumnResize(event: PointerEvent, handle: HTMLElement): void {
  if (event.button !== undefined && event.button !== 0) return;
  const board = handle.closest<HTMLElement>("[data-git-board]");
  const column = historyColumnFromAttribute(handle.getAttribute("data-git-resize-column"));
  const nextColumn = historyColumnFromAttribute(handle.getAttribute("data-git-resize-next-column"));
  if (!board || !column || !nextColumn) return;
  event.preventDefault();
  const startX = event.clientX ?? 0;
  const startWidth = gitHistoryColumnWidth(board, column);
  const pairWidth = startWidth + gitHistoryColumnWidth(board, nextColumn);
  board.classList.add("resizing");
  const move = (moveEvent: PointerEvent) => {
    updateGitHistoryColumnPairWidth(
      board,
      column,
      nextColumn,
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
  nextColumn: GitHistoryColumn,
  nextLeftWidth: number,
  handle: HTMLElement | null = null,
  pairWidth: number | null = null,
): void {
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
