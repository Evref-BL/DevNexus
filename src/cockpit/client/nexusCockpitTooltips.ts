export interface CockpitTooltipController {
  hide(): void;
  dispose(): void;
}

export function installCockpitTooltips(root: HTMLElement): CockpitTooltipController {
  if (typeof document === "undefined") return { hide() {}, dispose() {} };
  const tooltip = document.createElement("div");
  tooltip.className = "dn-tooltip";
  tooltip.id = `dn-tooltip-${Math.random().toString(36).slice(2)}`;
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  document.body.appendChild(tooltip);
  let activeTarget: HTMLElement | null = null;

  function show(
    target: HTMLElement,
    clientX: number | null = null,
    clientY: number | null = null,
    mode: "pointer" | "focus" = "pointer",
  ): void {
    const text = cockpitTooltipText(target).trim();
    if (!text || !isCockpitTooltipTargetTruncated(target)) {
      hide();
      return;
    }
    if (activeTarget && activeTarget !== target) restoreActiveTarget();
    activeTarget = target;
    if (target.hasAttribute("title")) {
      target.setAttribute("data-dn-native-title", target.getAttribute("title") ?? "");
      target.removeAttribute("title");
    }
    if (!target.hasAttribute("data-dn-previous-describedby")) {
      target.setAttribute(
        "data-dn-previous-describedby",
        target.getAttribute("aria-describedby") ?? "",
      );
    }
    target.setAttribute(
      "aria-describedby",
      [target.getAttribute("data-dn-previous-describedby"), tooltip.id]
        .filter(Boolean)
        .join(" "),
    );
    tooltip.textContent = text;
    tooltip.classList.add("visible");
    tooltip.setAttribute("aria-hidden", "false");
    positionCockpitTooltip(tooltip, target, clientX, clientY, mode);
  }

  function hide(): void {
    restoreActiveTarget();
    tooltip.classList.remove("visible");
    tooltip.setAttribute("aria-hidden", "true");
  }

  function restoreActiveTarget(): void {
    if (!activeTarget) return;
    const nativeTitle = activeTarget.getAttribute("data-dn-native-title");
    if (nativeTitle !== null) {
      activeTarget.setAttribute("title", nativeTitle);
      activeTarget.removeAttribute("data-dn-native-title");
    }
    const previousDescribedBy = activeTarget.getAttribute("data-dn-previous-describedby");
    if (previousDescribedBy !== null) {
      if (previousDescribedBy) activeTarget.setAttribute("aria-describedby", previousDescribedBy);
      else activeTarget.removeAttribute("aria-describedby");
      activeTarget.removeAttribute("data-dn-previous-describedby");
    }
    activeTarget = null;
  }

  function onPointerOver(event: PointerEvent): void {
    const target = findCockpitTooltipTarget(event.target, root);
    if (target) show(target, event.clientX, event.clientY, "pointer");
  }
  function onPointerMove(event: PointerEvent): void {
    if (activeTarget) {
      positionCockpitTooltip(tooltip, activeTarget, event.clientX, event.clientY, "pointer");
    }
  }
  function onPointerOut(event: PointerEvent): void {
    if (
      activeTarget &&
      event.relatedTarget instanceof Node &&
      activeTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    hide();
  }
  function onFocusIn(event: FocusEvent): void {
    const target = findCockpitTooltipTarget(event.target, root);
    if (target) show(target, null, null, "focus");
  }
  function onFocusOut(event: FocusEvent): void {
    if (
      !activeTarget ||
      (event.relatedTarget instanceof Node && activeTarget.contains(event.relatedTarget))
    ) {
      return;
    }
    hide();
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") hide();
  }

  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerout", onPointerOut);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  document.addEventListener("keydown", onKeyDown);
  return {
    hide,
    dispose() {
      hide();
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerout", onPointerOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
      tooltip.remove();
    },
  };
}

export function findCockpitTooltipTarget(
  source: EventTarget | null,
  root: Element,
): HTMLElement | null {
  if (!(source instanceof Element)) return null;
  const target = source.closest<HTMLElement>(
    "[data-dn-tooltip], [data-dn-native-title], [title]",
  );
  if (!target || !root.contains(target)) return null;
  if (!cockpitTooltipText(target).trim()) return null;
  return isCockpitTooltipTargetTruncated(target) ? target : null;
}

export function cockpitTooltipText(target: Element | null | undefined): string {
  return target?.getAttribute?.("data-dn-tooltip") ??
    target?.getAttribute?.("data-dn-native-title") ??
    target?.getAttribute?.("title") ??
    "";
}

export function isCockpitTooltipTargetTruncated(target: {
  clientHeight?: number;
  clientWidth?: number;
  scrollHeight?: number;
  scrollWidth?: number;
} | null | undefined): boolean {
  return Number(target?.scrollWidth ?? 0) > Number(target?.clientWidth ?? 0) + 1 ||
    Number(target?.scrollHeight ?? 0) > Number(target?.clientHeight ?? 0) + 1;
}

export function renderNexusCockpitTooltipsClientSource(): string {
  return [
    installCockpitTooltips,
    findCockpitTooltipTarget,
    cockpitTooltipText,
    isCockpitTooltipTargetTruncated,
    positionCockpitTooltip,
  ]
    .map((fn) => fn.toString())
    .join("\n\n");
}

function positionCockpitTooltip(
  tooltip: HTMLElement,
  target: HTMLElement,
  clientX: number | null = null,
  clientY: number | null = null,
  mode: "pointer" | "focus" = "pointer",
): void {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 320;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 320;
  const anchor = target.getBoundingClientRect();
  const x = mode === "pointer" && Number.isFinite(clientX)
    ? Number(clientX)
    : anchor.left + anchor.width / 2;
  const y = mode === "pointer" && Number.isFinite(clientY) ? Number(clientY) : anchor.top;
  const bounds = tooltip.getBoundingClientRect();
  const margin = 8;
  const halfWidth = bounds.width / 2;
  const left = Math.min(Math.max(x, halfWidth + margin), viewportWidth - halfWidth - margin);
  let top = y - bounds.height - 12;
  if (top < margin) top = y + 18;
  top = Math.min(Math.max(top, margin), viewportHeight - bounds.height - margin);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}
