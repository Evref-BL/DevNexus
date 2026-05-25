export function bindGitHistoryInteractions(container: HTMLElement): {
  dispose(): void;
  refresh(): void;
} {
  let hoveredId: string | null = null;
  let searchQuery = "";
  let activeSearchIndex = 0;

  function setHoveredId(nextId: string | null): void {
    if (hoveredId === nextId) return;
    updateGitHistoryHover(container, hoveredId, false);
    hoveredId = nextId;
    updateGitHistoryHover(container, hoveredId, true);
  }

  function onPointerOver(event: MouseEvent | PointerEvent): void {
    setHoveredId(gitHistorySelectIdFromEventTarget(container, event.target));
  }

  function onPointerMove(event: MouseEvent | PointerEvent): void {
    setHoveredId(gitHistorySelectIdFromEventTarget(container, event.target));
  }

  function onPointerOut(event: MouseEvent | PointerEvent): void {
    if (!hoveredId) return;
    const nextId = gitHistorySelectIdFromEventTarget(container, event.relatedTarget);
    if (nextId === hoveredId) return;
    setHoveredId(null);
  }

  function onFocusIn(event: FocusEvent): void {
    setHoveredId(gitHistorySelectIdFromEventTarget(container, event.target));
  }

  function onFocusOut(event: FocusEvent): void {
    if (!hoveredId) return;
    const nextId = gitHistorySelectIdFromEventTarget(container, event.relatedTarget);
    if (nextId === hoveredId) return;
    setHoveredId(null);
  }

  function onSearchInput(event: Event): void {
    const target = gitHistoryInteractionElement(event.target);
    if (!target?.matches?.("[data-git-history-search-input]")) return;
    searchQuery = (target as HTMLInputElement).value;
    activeSearchIndex = 0;
    applyGitHistorySearch(container, searchQuery, activeSearchIndex, true);
  }

  function onSearchKeyDown(event: KeyboardEvent): void {
    const target = gitHistoryInteractionElement(event.target);
    if (!target?.matches?.("[data-git-history-search-input]")) return;
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
    container.removeEventListener("pointerover", onPointerOver);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerout", onPointerOut);
    container.removeEventListener("mouseover", onPointerOver);
    container.removeEventListener("mousemove", onPointerMove);
    container.removeEventListener("mouseout", onPointerOut);
    container.removeEventListener("focusin", onFocusIn);
    container.removeEventListener("focusout", onFocusOut);
    container.removeEventListener("input", onSearchInput);
    container.removeEventListener("keydown", onSearchKeyDown);
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
  container.addEventListener("keydown", onSearchKeyDown);
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
    applyGitHistorySearch,
    normalizeGitHistorySearchText,
    clearGitHistorySearchClasses,
    markGitHistorySearchElement,
    wrapGitHistorySearchIndex,
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
