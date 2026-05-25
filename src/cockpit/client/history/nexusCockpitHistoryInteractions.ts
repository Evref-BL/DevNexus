export function bindGitHistoryInteractions(container: HTMLElement): () => void {
  let hoveredId: string | null = null;

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

  container.addEventListener("pointerover", onPointerOver);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerout", onPointerOut);
  container.addEventListener("mouseover", onPointerOver);
  container.addEventListener("mousemove", onPointerMove);
  container.addEventListener("mouseout", onPointerOut);
  container.addEventListener("focusin", onFocusIn);
  container.addEventListener("focusout", onFocusOut);

  return () => {
    setHoveredId(null);
    container.removeEventListener("pointerover", onPointerOver);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerout", onPointerOut);
    container.removeEventListener("mouseover", onPointerOver);
    container.removeEventListener("mousemove", onPointerMove);
    container.removeEventListener("mouseout", onPointerOut);
    container.removeEventListener("focusin", onFocusIn);
    container.removeEventListener("focusout", onFocusOut);
  };
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

export function renderNexusCockpitHistoryInteractionsClientSource(): string {
  return [
    bindGitHistoryInteractions,
    gitHistorySelectIdFromEventTarget,
    updateGitHistoryHover,
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
