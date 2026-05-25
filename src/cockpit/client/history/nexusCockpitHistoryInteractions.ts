export function bindGitHistoryInteractions(container: HTMLElement): {
  dispose(): void;
  refresh(): void;
} {
  let hoveredId: string | null = null;
  let searchQuery = "";
  let activeSearchIndex = 0;
  const popover = createGitHistoryNodePopover();

  function setHoveredId(nextId: string | null): void {
    if (hoveredId === nextId) return;
    updateGitHistoryHover(container, hoveredId, false);
    hoveredId = nextId;
    updateGitHistoryHover(container, hoveredId, true);
  }

  function onPointerOver(event: MouseEvent | PointerEvent): void {
    const target = gitHistoryInteractionElement(event.target);
    setHoveredId(gitHistorySelectIdFromEventTarget(container, target));
    showGitHistoryNodePopover(popover, gitHistoryNodeFromEventTarget(container, target));
  }

  function onPointerMove(event: MouseEvent | PointerEvent): void {
    const target = gitHistoryInteractionElement(event.target);
    setHoveredId(gitHistorySelectIdFromEventTarget(container, target));
    showGitHistoryNodePopover(popover, gitHistoryNodeFromEventTarget(container, target));
  }

  function onPointerOut(event: MouseEvent | PointerEvent): void {
    if (!hoveredId) return;
    const nextId = gitHistorySelectIdFromEventTarget(container, event.relatedTarget);
    if (nextId === hoveredId) return;
    setHoveredId(null);
    hideGitHistoryNodePopover(popover);
  }

  function onFocusIn(event: FocusEvent): void {
    const target = gitHistoryInteractionElement(event.target);
    setHoveredId(gitHistorySelectIdFromEventTarget(container, target));
    showGitHistoryNodePopover(popover, gitHistoryNodeFromEventTarget(container, target));
  }

  function onFocusOut(event: FocusEvent): void {
    if (!hoveredId) return;
    const nextId = gitHistorySelectIdFromEventTarget(container, event.relatedTarget);
    if (nextId === hoveredId) return;
    setHoveredId(null);
    hideGitHistoryNodePopover(popover);
  }

  function onSearchInput(event: Event): void {
    const target = gitHistoryInteractionElement(event.target);
    if (!target?.matches?.("[data-git-history-search-input]")) return;
    searchQuery = (target as HTMLInputElement).value;
    activeSearchIndex = 0;
    applyGitHistorySearch(container, searchQuery, activeSearchIndex, true);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (onSearchKeyDown(event)) return;
    onHistoryKeyDown(event);
  }

  function onSearchKeyDown(event: KeyboardEvent): boolean {
    const target = gitHistoryInteractionElement(event.target);
    if (!target?.matches?.("[data-git-history-search-input]")) return false;
    if (event.key === "Enter") {
      event.preventDefault();
      moveGitHistorySearch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      searchQuery = "";
      activeSearchIndex = 0;
      if (target instanceof HTMLInputElement) target.value = "";
      applyGitHistorySearch(container, searchQuery, activeSearchIndex, false);
    }
    return true;
  }

  function onHistoryKeyDown(event: KeyboardEvent): void {
    const target = gitHistoryKeyboardTarget(container, event.target);
    if (!target) return;
    const key = event.key;
    if (key === "Enter" || key === " ") {
      if (!target.classList.contains("dn-git-history-row")) {
        event.preventDefault();
        gitHistoryRowForSelectId(container, target.getAttribute("data-select-id"))?.click();
      }
      return;
    }
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    event.preventDefault();
    const nextId = nextGitHistoryKeyboardSelectId(
      container,
      target.getAttribute("data-select-id"),
      key,
    );
    if (!nextId) return;
    const preferGraph = target.classList.contains("dn-git-node") || target.classList.contains("dn-git-row-hit");
    focusGitHistoryEvent(container, nextId, preferGraph);
    setHoveredId(nextId);
  }

  function onSearchClick(event: MouseEvent): void {
    const target = gitHistoryInteractionElement(event.target);
    const action = target?.closest?.("[data-git-history-search-action]");
    if (!action || !container.contains(action)) return;
    const command = action.getAttribute("data-git-history-search-action");
    if (command === "previous") moveGitHistorySearch(-1);
    else if (command === "next") moveGitHistorySearch(1);
    else if (command === "clear") {
      searchQuery = "";
      activeSearchIndex = 0;
      const input = container.querySelector<HTMLInputElement>("[data-git-history-search-input]");
      if (input) input.value = "";
      applyGitHistorySearch(container, searchQuery, activeSearchIndex, false);
    }
  }

  function moveGitHistorySearch(delta: number): void {
    const result = applyGitHistorySearch(container, searchQuery, activeSearchIndex, false);
    if (!result.matchCount) return;
    activeSearchIndex = wrapGitHistorySearchIndex(activeSearchIndex + delta, result.matchCount);
    applyGitHistorySearch(container, searchQuery, activeSearchIndex, true);
  }

  function refresh(): void {
    const input = container.querySelector<HTMLInputElement>("[data-git-history-search-input]");
    if (input && input.value !== searchQuery) input.value = searchQuery;
    applyGitHistorySearch(container, searchQuery, activeSearchIndex, false);
  }

  function dispose(): void {
    setHoveredId(null);
    hideGitHistoryNodePopover(popover);
    popover.remove();
    container.removeEventListener("pointerover", onPointerOver);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerout", onPointerOut);
    container.removeEventListener("mouseover", onPointerOver);
    container.removeEventListener("mousemove", onPointerMove);
    container.removeEventListener("mouseout", onPointerOut);
    container.removeEventListener("focusin", onFocusIn);
    container.removeEventListener("focusout", onFocusOut);
    container.removeEventListener("input", onSearchInput);
    container.removeEventListener("keydown", onKeyDown);
    container.removeEventListener("click", onSearchClick);
  }

  container.addEventListener("pointerover", onPointerOver);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerout", onPointerOut);
  container.addEventListener("mouseover", onPointerOver);
  container.addEventListener("mousemove", onPointerMove);
  container.addEventListener("mouseout", onPointerOut);
  container.addEventListener("focusin", onFocusIn);
  container.addEventListener("focusout", onFocusOut);
  container.addEventListener("input", onSearchInput);
  container.addEventListener("keydown", onKeyDown);
  container.addEventListener("click", onSearchClick);

  return { dispose, refresh };
}

export function gitHistorySelectIdFromEventTarget(
  container: Element,
  source: EventTarget | null,
): string | null {
  const sourceElement = gitHistoryInteractionElement(source);
  const target = sourceElement?.closest?.("[data-select-id]");
  if (!target || !container.contains(target)) return null;
  const selectId = target.getAttribute("data-select-id") ?? "";
  return selectId.startsWith("history:") ? selectId : null;
}

export function updateGitHistoryHover(
  container: Element,
  selectId: string | null,
  hovered: boolean,
): void {
  if (!selectId) return;
  container.querySelectorAll("[data-select-id]").forEach((element) => {
    if (element.getAttribute("data-select-id") === selectId) {
      element.classList.toggle("dn-history-hovered", hovered);
    }
  });
}

export function gitHistoryKeyboardTarget(
  container: Element,
  source: EventTarget | null,
): HTMLElement | SVGElement | null {
  const sourceElement = gitHistoryInteractionElement(source);
  const target = sourceElement?.closest?.(
    ".dn-git-history-row[data-select-id], .dn-git-node[data-select-id], .dn-git-row-hit[data-select-id]",
  );
  return target && container.contains(target) ? (target as HTMLElement | SVGElement) : null;
}

export function nextGitHistoryKeyboardSelectId(
  container: Element,
  currentId: string | null,
  key: string,
): string | null {
  const ids = orderedGitHistorySelectIds(container);
  if (!ids.length) return null;
  const currentIndex = Math.max(0, ids.indexOf(String(currentId ?? "")));
  if (key === "Home") return ids[0] ?? null;
  if (key === "End") return ids[ids.length - 1] ?? null;
  if (key === "ArrowUp") return ids[Math.max(0, currentIndex - 1)] ?? null;
  if (key === "ArrowDown") return ids[Math.min(ids.length - 1, currentIndex + 1)] ?? null;
  return null;
}

export function orderedGitHistorySelectIds(container: Element): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  container.querySelectorAll(".dn-git-history-row[data-select-id]").forEach((row) => {
    const id = row.getAttribute("data-select-id") ?? "";
    if (!id.startsWith("history:") || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

export function focusGitHistoryEvent(
  container: Element,
  selectId: string,
  preferGraph = false,
): void {
  const target = preferGraph
    ? gitHistoryGraphNodeForSelectId(container, selectId) ?? gitHistoryRowForSelectId(container, selectId)
    : gitHistoryRowForSelectId(container, selectId) ?? gitHistoryGraphNodeForSelectId(container, selectId);
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function gitHistoryRowForSelectId(
  container: Element,
  selectId: string | null,
): HTMLElement | null {
  if (!selectId) return null;
  for (const row of container.querySelectorAll<HTMLElement>(".dn-git-history-row[data-select-id]")) {
    if (row.getAttribute("data-select-id") === selectId) return row;
  }
  return null;
}

export function gitHistoryGraphNodeForSelectId(
  container: Element,
  selectId: string | null,
): SVGElement | null {
  if (!selectId) return null;
  for (const node of container.querySelectorAll<SVGElement>(".dn-git-node[data-select-id]")) {
    if (node.getAttribute("data-select-id") === selectId) return node;
  }
  for (const hit of container.querySelectorAll<SVGElement>(".dn-git-row-hit[data-select-id]")) {
    if (hit.getAttribute("data-select-id") === selectId) return hit;
  }
  return null;
}

export function createGitHistoryNodePopover(): HTMLElement {
  const popover = document.createElement("div");
  popover.className = "dn-history-popover";
  popover.setAttribute("role", "tooltip");
  popover.setAttribute("aria-hidden", "true");
  document.body.appendChild(popover);
  return popover;
}

export function showGitHistoryNodePopover(
  popover: HTMLElement,
  node: Element | null,
): void {
  if (!node) {
    hideGitHistoryNodePopover(popover);
    return;
  }
  const content = gitHistoryNodePopoverContent(node);
  if (!content.title && !content.commit) {
    hideGitHistoryNodePopover(popover);
    return;
  }
  popover.innerHTML = renderGitHistoryNodePopoverContent(content);
  popover.style.setProperty("--dn-history-popover-accent", gitHistoryNodeAccentColor(node));
  popover.classList.add("visible");
  popover.setAttribute("aria-hidden", "false");
  positionGitHistoryNodePopover(popover, node);
}

export function hideGitHistoryNodePopover(popover: HTMLElement): void {
  popover.classList.remove("visible");
  popover.setAttribute("aria-hidden", "true");
}

export function gitHistoryNodeAccentColor(node: Element): string {
  const fallback = "var(--dn-good)";
  const computedFill = typeof window === "undefined"
    ? ""
    : window.getComputedStyle(node).fill;
  const fill = computedFill || node.getAttribute("fill") || "";
  return isGitHistoryPopoverColor(fill) ? fill : fallback;
}

export function isGitHistoryPopoverColor(value: string): boolean {
  const trimmed = value.trim();
  return /^(#[\da-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|color\([^)]+\)|var\(--dn-branch-\d+\))$/iu.test(trimmed);
}

export function gitHistoryNodeFromEventTarget(
  container: Element,
  source: EventTarget | null,
): Element | null {
  const sourceElement = gitHistoryInteractionElement(source);
  const node = sourceElement?.closest?.(".dn-git-node[data-select-id]");
  return node && container.contains(node) ? node : null;
}

export function gitHistoryNodePopoverContent(node: Element): {
  readonly commit: string;
  readonly component: string;
  readonly details: readonly string[];
  readonly meta: string;
  readonly refs: readonly string[];
  readonly title: string;
} {
  const lines = String(node.getAttribute("data-dn-tooltip") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const title = lines[0] ?? String(node.getAttribute("aria-label") ?? "").trim();
  const identity = lines[1] ?? "";
  const identityParts = identity.split("·").map((part) => part.trim()).filter(Boolean);
  const refsLine = lines.find((line) => line.startsWith("Refs:")) ?? "";
  const detailsLine = lines.find((line) => line.startsWith("Details:")) ?? "";
  const meta = lines.find((line) => !line.startsWith("Refs:") && !line.startsWith("Details:") && line !== title && line !== identity) ?? "";
  return {
    title,
    component: identityParts[0] ?? "",
    commit: identityParts[1] ?? "",
    refs: refsLine.replace(/^Refs:\s*/u, "").split(",").map((ref) => ref.trim()).filter(Boolean),
    meta,
    details: detailsLine.replace(/^Details:\s*/u, "").split(",").map((detail) => detail.trim()).filter(Boolean),
  };
}

export function renderGitHistoryNodePopoverContent(content: {
  readonly commit: string;
  readonly component: string;
  readonly details: readonly string[];
  readonly meta: string;
  readonly refs: readonly string[];
  readonly title: string;
}): string {
  const heading = content.commit ? `Commit ${content.commit}` : "Commit";
  const component = content.component ? `<span>${escapeHistoryPopoverHtml(content.component)}</span>` : "";
  const meta = content.meta ? `<span>${escapeHistoryPopoverHtml(content.meta)}</span>` : "";
  const refs = content.refs.length
    ? content.refs.map((ref) => `<span class="dn-history-popover-chip">${escapeHistoryPopoverHtml(ref)}</span>`).join("")
    : `<span class="dn-history-popover-muted">No branch refs loaded</span>`;
  const details = content.details.length
    ? content.details.map((detail) => `<span class="dn-history-popover-chip soft">${escapeHistoryPopoverHtml(detail)}</span>`).join("")
    : `<span class="dn-history-popover-muted">No attached details</span>`;
  return `<div class="dn-history-popover-heading">${escapeHistoryPopoverHtml(heading)}</div><div class="dn-history-popover-title">${escapeHistoryPopoverHtml(content.title)}</div><div class="dn-history-popover-meta">${component}${meta}</div><div class="dn-history-popover-section"><span class="dn-history-popover-label">Branches</span><div class="dn-history-popover-chips">${refs}</div></div><div class="dn-history-popover-section"><span class="dn-history-popover-label">Details</span><div class="dn-history-popover-chips">${details}</div></div>`;
}

export function positionGitHistoryNodePopover(
  popover: HTMLElement,
  node: Element,
): void {
  const margin = 12;
  const anchor = node.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 320;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 320;
  const bounds = popover.getBoundingClientRect();
  const preferredLeft = anchor.right + 16;
  const fallbackLeft = anchor.left - bounds.width - 16;
  const usesPreferredSide = preferredLeft + bounds.width + margin <= viewportWidth;
  const left = usesPreferredSide ? preferredLeft : Math.max(margin, fallbackLeft);
  const anchorCenterY = anchor.top + anchor.height / 2;
  const top = Math.min(
    Math.max(margin, anchorCenterY - bounds.height / 2),
    Math.max(margin, viewportHeight - bounds.height - margin),
  );
  const edgeSide = usesPreferredSide ? "left" : "right";
  const connectorWidth = edgeSide === "left"
    ? Math.max(8, left - anchor.right)
    : Math.max(8, anchor.left - (left + bounds.width));
  const connectorY = bounds.height / 2;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.setProperty("--dn-history-popover-connector-width", `${connectorWidth}px`);
  popover.style.setProperty("--dn-history-popover-connector-y", `${connectorY}px`);
  popover.dataset.edgeSide = edgeSide;
}

export function applyGitHistorySearch(
  container: Element,
  query: string,
  activeIndex = 0,
  scrollToActive = false,
): { matchCount: number; activeIndex: number } {
  clearGitHistorySearchClasses(container);
  const input = container.querySelector<HTMLInputElement>("[data-git-history-search-input]");
  const status = container.querySelector<HTMLElement>("[data-git-history-search-status]");
  const buttons = container.querySelectorAll<HTMLButtonElement>("[data-git-history-search-action]");
  const normalizedQuery = normalizeGitHistorySearchText(query);
  if (input && input.value !== query) input.value = query;
  if (!normalizedQuery) {
    if (status) status.textContent = "";
    buttons.forEach((button) => {
      button.disabled = true;
    });
    return { matchCount: 0, activeIndex: 0 };
  }
  const rows = [...container.querySelectorAll<HTMLElement>(".dn-git-history-row[data-select-id]")];
  const matches = rows.filter((row) =>
    normalizeGitHistorySearchText(
      row.getAttribute("data-history-search-text") ?? row.textContent ?? "",
    ).includes(normalizedQuery),
  );
  const matchCount = matches.length;
  const nextActiveIndex = wrapGitHistorySearchIndex(activeIndex, matchCount);
  matches.forEach((row, index) => {
    const current = index === nextActiveIndex;
    markGitHistorySearchElement(container, row.getAttribute("data-select-id"), current);
    row.classList.add("dn-history-search-match");
    row.classList.toggle("dn-history-search-current", current);
  });
  if (status) {
    status.textContent = matchCount
      ? `${nextActiveIndex + 1} of ${matchCount}`
      : "No matches";
  }
  buttons.forEach((button) => {
    const action = button.getAttribute("data-git-history-search-action");
    button.disabled = action === "clear" ? false : matchCount < 2;
  });
  const activeRow = matches[nextActiveIndex] ?? null;
  if (scrollToActive && activeRow) {
    activeRow.scrollIntoView({ behavior: "smooth", block: "center" });
    activeRow.classList.add("dn-history-search-flash");
    window.setTimeout(() => {
      activeRow.classList.remove("dn-history-search-flash");
    }, 900);
  }
  return { matchCount, activeIndex: nextActiveIndex };
}

export function normalizeGitHistorySearchText(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/\s+/gu, " ").trim();
}

function clearGitHistorySearchClasses(container: Element): void {
  container.querySelectorAll(".dn-history-search-match, .dn-history-search-current, .dn-history-search-flash").forEach((element) => {
    element.classList.remove(
      "dn-history-search-match",
      "dn-history-search-current",
      "dn-history-search-flash",
    );
  });
}

function markGitHistorySearchElement(
  container: Element,
  selectId: string | null,
  current: boolean,
): void {
  if (!selectId) return;
  container.querySelectorAll("[data-select-id]").forEach((element) => {
    if (element.getAttribute("data-select-id") !== selectId) return;
    element.classList.add("dn-history-search-match");
    element.classList.toggle("dn-history-search-current", current);
  });
}

function wrapGitHistorySearchIndex(index: number, matchCount: number): number {
  if (!matchCount) return 0;
  return ((index % matchCount) + matchCount) % matchCount;
}

export function renderNexusCockpitHistoryInteractionsClientSource(): string {
  return [
    bindGitHistoryInteractions,
    gitHistorySelectIdFromEventTarget,
    updateGitHistoryHover,
    gitHistoryKeyboardTarget,
    nextGitHistoryKeyboardSelectId,
    orderedGitHistorySelectIds,
    focusGitHistoryEvent,
    gitHistoryRowForSelectId,
    gitHistoryGraphNodeForSelectId,
    createGitHistoryNodePopover,
    showGitHistoryNodePopover,
    hideGitHistoryNodePopover,
    gitHistoryNodeAccentColor,
    isGitHistoryPopoverColor,
    gitHistoryNodeFromEventTarget,
    gitHistoryNodePopoverContent,
    renderGitHistoryNodePopoverContent,
    positionGitHistoryNodePopover,
    applyGitHistorySearch,
    normalizeGitHistorySearchText,
    clearGitHistorySearchClasses,
    markGitHistorySearchElement,
    wrapGitHistorySearchIndex,
    escapeHistoryPopoverHtml,
    gitHistoryInteractionElement,
  ]
    .map((fn) => fn.toString())
    .join("\n\n");
}

function gitHistoryInteractionElement(source: EventTarget | null): Element | null {
  if (source instanceof Element) return source;
  if (source instanceof Node) return source.parentElement;
  return null;
}

function escapeHistoryPopoverHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
