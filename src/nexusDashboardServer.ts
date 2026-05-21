import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import {
  buildNexusDashboardSnapshot,
  type BuildNexusDashboardSnapshotOptions,
  type NexusDashboardSnapshot,
} from "./nexusDashboard.js";
import type { GitRunner } from "./gitWorktreeService.js";
import type { NexusEligibleWorkMode } from "./nexusEligibleWorkSummary.js";

export interface StartNexusDashboardServerOptions {
  projectRoot: string;
  host?: string;
  port?: number;
  homePath?: string;
  eligibleWorkMode?: NexusEligibleWorkMode;
  gitRunner?: GitRunner;
  now?: () => Date | string;
}

export interface NexusDashboardServerHandle {
  projectRoot: string;
  host: string;
  port: number;
  url: string;
  server: Server;
  close: () => Promise<void>;
}

export async function startNexusDashboardServer(
  options: StartNexusDashboardServerOptions,
): Promise<NexusDashboardServerHandle> {
  const projectRoot = path.resolve(options.projectRoot);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const snapshotOptions: BuildNexusDashboardSnapshotOptions = {
    projectRoot,
    homePath: options.homePath,
    eligibleWorkMode: options.eligibleWorkMode,
    gitRunner: options.gitRunner,
    now: options.now,
  };
  const server = http.createServer((request, response) => {
    void routeDashboardRequest(request, response, snapshotOptions);
  });

  await listen(server, port, host);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Dashboard server did not expose a TCP address");
  }

  const url = `http://${host}:${address.port}/`;
  return {
    projectRoot,
    host,
    port: address.port,
    url,
    server,
    close: () => close(server),
  };
}

export function renderNexusDashboardHtml(options: {
  title?: string;
  modulePath?: string;
} = {}): string {
  const title = escapeHtml(options.title ?? "DevNexus Cockpit");
  const modulePath = escapeHtml(options.modulePath ?? "/assets/dev-nexus-dashboard.js");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    "</head>",
    "<body>",
    '<main id="dev-nexus-dashboard-root"></main>',
    `<script type="module">import { mountDevNexusDashboard } from "${modulePath}"; mountDevNexusDashboard(document.getElementById("dev-nexus-dashboard-root"));</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

export function renderNexusDashboardClientModule(): string {
  return [
    "const defaultRefreshMs = 15000;",
    "const themeStorageKey = 'dev-nexus-dashboard-theme';",
    "const styles = `",
    ":root { color-scheme: dark; --dn-bg: #0b100e; --dn-surface: #121915; --dn-surface-raised: #17211c; --dn-surface-muted: rgba(12, 18, 15, 0.76); --dn-weave-bg: rgba(8, 12, 10, 0.58); --dn-text: #eef5ec; --dn-strong: #f3f8f0; --dn-muted: #aebbae; --dn-label: #87998d; --dn-border: rgba(180, 210, 188, 0.18); --dn-border-muted: rgba(180, 210, 188, 0.12); --dn-border-strong: rgba(180, 210, 188, 0.28); --dn-pill-text: #dfe8df; --dn-control-active: #203127; --dn-control-hover: rgba(180, 210, 188, 0.1); --dn-good: #67d29e; --dn-active: #79a7ff; --dn-warn: #e4b15f; --dn-warn-soft: #f2d49b; --dn-danger: #ff8b78; --dn-neutral: #b3c0b5; color: var(--dn-text); background: var(--dn-bg); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-synthesis: none; }",
    ":root[data-dev-nexus-theme='dark'] { color-scheme: dark; --dn-bg: #0b100e; --dn-surface: #121915; --dn-surface-raised: #17211c; --dn-surface-muted: rgba(12, 18, 15, 0.76); --dn-weave-bg: rgba(8, 12, 10, 0.58); --dn-text: #eef5ec; --dn-strong: #f3f8f0; --dn-muted: #aebbae; --dn-label: #87998d; --dn-border: rgba(180, 210, 188, 0.18); --dn-border-muted: rgba(180, 210, 188, 0.12); --dn-border-strong: rgba(180, 210, 188, 0.28); --dn-pill-text: #dfe8df; --dn-control-active: #203127; --dn-control-hover: rgba(180, 210, 188, 0.1); --dn-good: #67d29e; --dn-active: #79a7ff; --dn-warn: #e4b15f; --dn-warn-soft: #f2d49b; --dn-danger: #ff8b78; --dn-neutral: #b3c0b5; }",
    ":root[data-dev-nexus-theme='light'] { color-scheme: light; --dn-bg: #f5f8f6; --dn-surface: #ffffff; --dn-surface-raised: #edf3ef; --dn-surface-muted: rgba(235, 242, 238, 0.86); --dn-weave-bg: rgba(236, 244, 241, 0.9); --dn-text: #16231b; --dn-strong: #0f1813; --dn-muted: #55685d; --dn-label: #687d71; --dn-border: rgba(42, 73, 55, 0.18); --dn-border-muted: rgba(42, 73, 55, 0.12); --dn-border-strong: rgba(42, 73, 55, 0.28); --dn-pill-text: #27372e; --dn-control-active: #dcebe3; --dn-control-hover: rgba(42, 73, 55, 0.08); --dn-good: #167f53; --dn-active: #265dcc; --dn-warn: #9a641c; --dn-warn-soft: #77500f; --dn-danger: #bc3b2f; --dn-neutral: #526459; }",
    "@media (prefers-color-scheme: light) { :root:not([data-dev-nexus-theme]) { color-scheme: light; --dn-bg: #f5f8f6; --dn-surface: #ffffff; --dn-surface-raised: #edf3ef; --dn-surface-muted: rgba(235, 242, 238, 0.86); --dn-weave-bg: rgba(236, 244, 241, 0.9); --dn-text: #16231b; --dn-strong: #0f1813; --dn-muted: #55685d; --dn-label: #687d71; --dn-border: rgba(42, 73, 55, 0.18); --dn-border-muted: rgba(42, 73, 55, 0.12); --dn-border-strong: rgba(42, 73, 55, 0.28); --dn-pill-text: #27372e; --dn-control-active: #dcebe3; --dn-control-hover: rgba(42, 73, 55, 0.08); --dn-good: #167f53; --dn-active: #265dcc; --dn-warn: #9a641c; --dn-warn-soft: #77500f; --dn-danger: #bc3b2f; --dn-neutral: #526459; } }",
    "* { box-sizing: border-box; }",
    "body { margin: 0; min-width: 320px; color: var(--dn-text); background: var(--dn-bg); }",
    "button, input, select { font: inherit; }",
    ".dn-shell { width: min(1520px, 100%); margin: 0 auto; padding: 24px; }",
    ".dn-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: end; padding-bottom: 18px; border-bottom: 1px solid var(--dn-border); }",
    ".dn-header h1 { margin: 0 0 8px; font-size: 1.9rem; line-height: 1.08; letter-spacing: 0; }",
    ".dn-header p { margin: 0; color: var(--dn-muted); }",
    ".dn-header-actions { display: grid; gap: 10px; justify-items: end; align-content: end; }",
    ".dn-meta { display: grid; gap: 6px; min-width: 250px; padding: 12px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-meta span, .dn-label, .dn-table th { color: var(--dn-label); font-size: 0.76rem; font-weight: 800; text-transform: uppercase; }",
    ".dn-meta strong { color: var(--dn-strong); overflow-wrap: anywhere; }",
    ".dn-theme-toggle { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-theme-toggle button { min-width: 66px; min-height: 32px; padding: 0 10px; border: 0; border-radius: 6px; color: var(--dn-muted); background: transparent; cursor: pointer; font-size: 0.82rem; font-weight: 800; }",
    ".dn-theme-toggle button:hover { color: var(--dn-text); background: var(--dn-control-hover); }",
    ".dn-theme-toggle button[aria-pressed='true'] { color: var(--dn-strong); background: var(--dn-control-active); box-shadow: 0 0 0 1px var(--dn-border-strong) inset; }",
    ".dn-signals { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }",
    ".dn-signal, .dn-panel { border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-signal { min-height: 132px; padding: 14px; }",
    ".dn-signal strong { display: block; margin: 8px 0; color: var(--dn-strong); font-size: 1.45rem; line-height: 1; overflow-wrap: anywhere; }",
    ".dn-signal p, .dn-event p, .dn-panel p { margin: 0; color: var(--dn-muted); }",
    ".dn-signal p { display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }",
    ".dn-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(340px, 0.9fr); gap: 14px; }",
    ".dn-panel { min-width: 0; padding: 16px; }",
    ".dn-panel h2 { margin: 0 0 12px; color: var(--dn-strong); font-size: 1rem; letter-spacing: 0; }",
    ".dn-pills { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0; list-style: none; }",
    ".dn-pill { padding: 7px 9px; border: 1px solid var(--dn-border); border-radius: 999px; color: var(--dn-pill-text); background: var(--dn-surface-muted); font-size: 0.82rem; font-weight: 700; }",
    ".dn-pill.warn { border-color: color-mix(in srgb, var(--dn-warn) 42%, transparent); color: var(--dn-warn-soft); }",
    ".dn-weave { width: 100%; min-height: 430px; overflow: auto; border-radius: 8px; background: var(--dn-weave-bg); }",
    ".dn-weave svg { min-width: 900px; display: block; }",
    ".dn-lane-label { fill: var(--dn-label); font-size: 12px; font-weight: 800; text-transform: uppercase; }",
    ".dn-edge { stroke: var(--dn-border-strong); stroke-width: 2; fill: none; }",
    ".dn-node rect { fill: var(--dn-surface-raised); stroke: var(--dn-border-strong); stroke-width: 1; rx: 8; }",
    ".dn-node text { fill: var(--dn-text); font-size: 12px; font-weight: 750; }",
    ".dn-node .dn-node-detail { fill: var(--dn-muted); font-size: 10px; font-weight: 600; }",
    ".dn-node.status-ready rect, .dn-node.status-clean rect, .dn-node.status-completed rect { stroke: var(--dn-good); }",
    ".dn-node.status-working rect, .dn-node.status-active rect, .dn-node.status-head rect { stroke: var(--dn-active); }",
    ".dn-node.status-blocked rect, .dn-node.status-failed rect, .dn-node.status-dirty rect { stroke: var(--dn-danger); }",
    ".dn-table { width: 100%; border-collapse: collapse; }",
    ".dn-table th, .dn-table td { padding: 9px 8px; border-bottom: 1px solid var(--dn-border-muted); text-align: left; vertical-align: top; }",
    ".dn-table td { color: var(--dn-pill-text); overflow-wrap: anywhere; }",
    ".dn-events { display: grid; gap: 10px; max-height: 590px; overflow: auto; }",
    ".dn-event { display: grid; gap: 5px; padding: 10px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-surface-muted); }",
    ".dn-event strong { color: var(--dn-strong); }",
    ".dn-event p { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }",
    ".tone-good { color: var(--dn-good); } .tone-active { color: var(--dn-active); } .tone-warn { color: var(--dn-warn); } .tone-danger { color: var(--dn-danger); } .tone-neutral { color: var(--dn-neutral); }",
    "@media (max-width: 1120px) { .dn-signals { grid-template-columns: repeat(3, minmax(0, 1fr)); } .dn-grid { grid-template-columns: 1fr; } }",
    "@media (max-width: 680px) { .dn-shell { padding: 12px; } .dn-header { grid-template-columns: 1fr; } .dn-header-actions { justify-items: stretch; } .dn-meta { min-width: 0; } .dn-theme-toggle button { min-width: 0; flex: 1; } .dn-signals { grid-template-columns: 1fr; } }",
    "`;",
    "",
    "export async function fetchDevNexusDashboard(baseUrl = '') {",
    "  const response = await fetch(`${baseUrl}/api/dashboard`, { cache: 'no-store' });",
    "  if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);",
    "  return response.json();",
    "}",
    "",
    "export function mountDevNexusDashboard(root, options = {}) {",
    "  if (!root) throw new Error('mountDevNexusDashboard requires a root element');",
    "  const baseUrl = options.baseUrl ?? '';",
    "  const refreshMs = options.refreshMs ?? defaultRefreshMs;",
    "  let themeMode = normalizeThemeMode(options.theme ?? readStoredThemeMode());",
    "  let latestSnapshot = null;",
    "  let latestError = null;",
    "  let disposed = false;",
    "  let inFlight = false;",
    "  applyThemePreference(themeMode);",
    "  injectStyles();",
    "  const systemThemeQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;",
    "  const onSystemThemeChange = () => {",
    "    if (themeMode !== 'system') return;",
    "    applyThemePreference(themeMode);",
    "    renderCurrent();",
    "  };",
    "  if (systemThemeQuery?.addEventListener) systemThemeQuery.addEventListener('change', onSystemThemeChange);",
    "  else if (systemThemeQuery?.addListener) systemThemeQuery.addListener(onSystemThemeChange);",
    "  function setThemeMode(nextThemeMode) {",
    "    if (disposed) return;",
    "    themeMode = normalizeThemeMode(nextThemeMode);",
    "    writeStoredThemeMode(themeMode);",
    "    applyThemePreference(themeMode);",
    "    renderCurrent();",
    "  }",
    "  function renderRoot(markup) {",
    "    root.innerHTML = markup;",
    "    bindThemeControls(root, setThemeMode);",
    "  }",
    "  function renderCurrent() {",
    "    if (disposed) return;",
    "    if (latestSnapshot) {",
    "      renderRoot(renderDashboard(latestSnapshot, themeMode));",
    "    } else if (latestError) {",
    "      renderRoot(renderError(latestError, themeMode));",
    "    }",
    "  }",
    "  async function refresh() {",
    "    if (inFlight) return;",
    "    inFlight = true;",
    "    try {",
    "      const snapshot = await fetchDevNexusDashboard(baseUrl);",
    "      latestSnapshot = snapshot;",
    "      latestError = null;",
    "      renderCurrent();",
    "    } catch (error) {",
    "      latestSnapshot = null;",
    "      latestError = error;",
    "      renderCurrent();",
    "    } finally {",
    "      inFlight = false;",
    "    }",
    "  }",
    "  void refresh();",
    "  const timer = setInterval(refresh, refreshMs);",
    "  return { dispose() { disposed = true; clearInterval(timer); if (systemThemeQuery?.removeEventListener) systemThemeQuery.removeEventListener('change', onSystemThemeChange); else if (systemThemeQuery?.removeListener) systemThemeQuery.removeListener(onSystemThemeChange); } };",
    "}",
    "",
    "function injectStyles() {",
    "  if (document.getElementById('dev-nexus-dashboard-styles')) return;",
    "  const style = document.createElement('style');",
    "  style.id = 'dev-nexus-dashboard-styles';",
    "  style.textContent = styles;",
    "  document.head.appendChild(style);",
    "}",
    "",
    "function renderDashboard(snapshot, themeMode) {",
    "  return `<div class=\"dn-shell\">",
    "    <header class=\"dn-header\">",
    "      <div><h1>${escapeHtml(snapshot.project.name)} Cockpit</h1><p>${escapeHtml(snapshot.summary)}</p></div>",
    "      <div class=\"dn-header-actions\"><div class=\"dn-meta\"><span>Generated</span><strong>${escapeHtml(formatTime(snapshot.generatedAt))}</strong><span>Root</span><strong>${escapeHtml(snapshot.project.root)}</strong></div>${renderThemeToggle(themeMode)}</div>",
    "    </header>",
    "    <section class=\"dn-signals\">${snapshot.signals.map(renderSignal).join('')}</section>",
    "    <section class=\"dn-grid\">",
    "      <div class=\"dn-panel\"><h2>Work Weave</h2>${renderWeave(snapshot.weave)}</div>",
    "      <div class=\"dn-panel\"><h2>Events</h2><div class=\"dn-events\">${snapshot.events.slice(0, 14).map(renderEvent).join('')}</div></div>",
    "    </section>",
    "    <section class=\"dn-grid\" style=\"margin-top:14px\">",
    "      <div class=\"dn-panel\"><h2>Components</h2>${renderComponents(snapshot.components)}</div>",
    "      <div class=\"dn-panel\"><h2>Blockers</h2>${renderBlockers(snapshot.blockers)}</div>",
    "    </section>",
    "  </div>`;",
    "}",
    "",
    "function renderThemeToggle(themeMode) {",
    "  return `<div class=\"dn-theme-toggle\" role=\"group\" aria-label=\"Color theme\"><button type=\"button\" data-theme-mode=\"system\" aria-pressed=\"${themeMode === 'system' ? 'true' : 'false'}\">System</button><button type=\"button\" data-theme-mode=\"light\" aria-pressed=\"${themeMode === 'light' ? 'true' : 'false'}\">Light</button><button type=\"button\" data-theme-mode=\"dark\" aria-pressed=\"${themeMode === 'dark' ? 'true' : 'false'}\">Dark</button></div>`;",
    "}",
    "",
    "function bindThemeControls(container, onSelect) {",
    "  container.querySelectorAll('[data-theme-mode]').forEach((button) => {",
    "    button.addEventListener('click', () => onSelect(button.getAttribute('data-theme-mode')));",
    "  });",
    "}",
    "",
    "function renderSignal(signal) {",
    "  return `<article class=\"dn-signal\"><span class=\"dn-label tone-${escapeAttribute(signal.tone)}\">${escapeHtml(signal.label)}</span><strong>${escapeHtml(signal.value)}</strong><p>${escapeHtml(signal.detail)}</p></article>`;",
    "}",
    "",
    "function renderEvent(event) {",
    "  return `<article class=\"dn-event\"><span class=\"dn-label\">${escapeHtml(formatTime(event.time))} · ${escapeHtml(event.source)}</span><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.body)}</p></article>`;",
    "}",
    "",
    "function renderComponents(components) {",
    "  return `<table class=\"dn-table\"><thead><tr><th>Component</th><th>Role</th><th>Git</th><th>Tracker</th></tr></thead><tbody>${components.map((component) => `<tr><td>${escapeHtml(component.name)}<br><span class=\"dn-label\">${escapeHtml(component.id)}</span></td><td>${escapeHtml(component.role)}</td><td>${escapeHtml(component.git?.branch ?? 'missing')}<br><span class=\"dn-label\">${escapeHtml(component.git?.dirty ? 'dirty' : 'clean')}</span></td><td>${escapeHtml(component.defaultTrackerId ?? 'none')}</td></tr>`).join('')}</tbody></table>`;",
    "}",
    "",
    "function renderBlockers(blockers) {",
    "  if (!blockers.length) return '<p>No dashboard-visible blockers.</p>';",
    "  return `<ul class=\"dn-pills\">${blockers.map((blocker) => `<li class=\"dn-pill warn\">${escapeHtml(blocker)}</li>`).join('')}</ul>`;",
    "}",
    "",
    "function renderWeave(weave) {",
    "  const laneHeight = 76;",
    "  const nodeWidth = 156;",
    "  const nodeHeight = 48;",
    "  const gapX = 192;",
    "  const positions = new Map();",
    "  weave.lanes.forEach((lane, laneIndex) => lane.nodeIds.forEach((nodeId, nodeIndex) => positions.set(nodeId, { x: 132 + nodeIndex * gapX, y: 42 + laneIndex * laneHeight })));",
    "  const width = Math.max(920, 360 + Math.max(0, ...weave.lanes.map((lane) => lane.nodeIds.length)) * gapX);",
    "  const height = 72 + weave.lanes.length * laneHeight;",
    "  const edges = weave.edges.map((edge) => renderEdge(edge, positions, nodeWidth, nodeHeight)).join('');",
    "  const laneLabels = weave.lanes.map((lane, index) => `<text class=\"dn-lane-label\" x=\"16\" y=\"${54 + index * laneHeight}\">${escapeHtml(lane.label)}</text>`).join('');",
    "  const nodes = weave.nodes.map((node) => renderNode(node, positions.get(node.id), nodeWidth, nodeHeight)).join('');",
    "  return `<div class=\"dn-weave\"><svg width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\" role=\"img\" aria-label=\"DevNexus work weave\">${laneLabels}${edges}${nodes}</svg></div>`;",
    "}",
    "",
    "function renderEdge(edge, positions, nodeWidth, nodeHeight) {",
    "  const from = positions.get(edge.from);",
    "  const to = positions.get(edge.to);",
    "  if (!from || !to) return '';",
    "  const x1 = from.x + nodeWidth;",
    "  const y1 = from.y + nodeHeight / 2;",
    "  const x2 = to.x;",
    "  const y2 = to.y + nodeHeight / 2;",
    "  const mid = x1 + Math.max(28, (x2 - x1) / 2);",
    "  return `<path class=\"dn-edge\" d=\"M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}\" />`;",
    "}",
    "",
    "function renderNode(node, position, width, height) {",
    "  if (!position) return '';",
    "  const label = truncate(node.label, 24);",
    "  const detail = truncate(node.detail, 30);",
    "  return `<g class=\"dn-node status-${escapeAttribute(node.status)}\" transform=\"translate(${position.x} ${position.y})\"><rect width=\"${width}\" height=\"${height}\"></rect><text x=\"10\" y=\"20\">${escapeHtml(label)}</text><text class=\"dn-node-detail\" x=\"10\" y=\"36\">${escapeHtml(detail)}</text></g>`;",
    "}",
    "",
    "function renderError(error, themeMode) {",
    "  return `<div class=\"dn-shell\"><header class=\"dn-header\"><div><h1>DevNexus Cockpit</h1><p>Dashboard data could not be loaded.</p></div><div class=\"dn-header-actions\">${renderThemeToggle(themeMode)}</div></header><section class=\"dn-panel\" style=\"margin-top:18px\"><h2>Dashboard unavailable</h2><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></section></div>`;",
    "}",
    "",
    "function normalizeThemeMode(value) {",
    "  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';",
    "}",
    "",
    "function resolveThemeMode(mode) {",
    "  if (mode !== 'system') return mode;",
    "  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';",
    "}",
    "",
    "function applyThemePreference(mode) {",
    "  const normalized = normalizeThemeMode(mode);",
    "  document.documentElement.dataset.devNexusThemePreference = normalized;",
    "  document.documentElement.dataset.devNexusTheme = resolveThemeMode(normalized);",
    "}",
    "",
    "function readStoredThemeMode() {",
    "  try {",
    "    if (typeof window === 'undefined' || !window.localStorage) return 'system';",
    "    return normalizeThemeMode(window.localStorage.getItem(themeStorageKey));",
    "  } catch {",
    "    return 'system';",
    "  }",
    "}",
    "",
    "function writeStoredThemeMode(mode) {",
    "  try {",
    "    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(themeStorageKey, normalizeThemeMode(mode));",
    "  } catch {",
    "    // Storage may be disabled for embedded dashboards.",
    "  }",
    "}",
    "",
    "function truncate(value, limit) {",
    "  const text = String(value ?? '');",
    "  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3))}...` : text;",
    "}",
    "",
    "function formatTime(value) {",
    "  const date = new Date(value);",
    "  return Number.isNaN(date.getTime()) ? String(value ?? '') : date.toLocaleString();",
    "}",
    "",
    "function escapeHtml(value) {",
    "  return String(value ?? '').replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[char]));",
    "}",
    "",
    "function escapeAttribute(value) {",
    "  return String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '-');",
    "}",
    "",
  ].join("\n");
}

async function routeDashboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  snapshotOptions: BuildNexusDashboardSnapshotOptions,
): Promise<void> {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, {
      "content-type": "application/json; charset=utf-8",
      allow: "GET, HEAD",
    });
    response.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      sendText(response, "text/html; charset=utf-8", renderNexusDashboardHtml());
      return;
    }
    if (url.pathname === "/assets/dev-nexus-dashboard.js") {
      sendText(
        response,
        "text/javascript; charset=utf-8",
        renderNexusDashboardClientModule(),
      );
      return;
    }
    if (url.pathname === "/api/dashboard" || url.pathname === "/api/snapshot") {
      sendJson(response, await buildNexusDashboardSnapshot(snapshotOptions));
      return;
    }
    if (url.pathname === "/api/weave") {
      const snapshot = await buildNexusDashboardSnapshot(snapshotOptions);
      sendJson(response, snapshot.weave);
      return;
    }
    if (url.pathname === "/api/events") {
      const snapshot = await buildNexusDashboardSnapshot(snapshotOptions);
      sendJson(response, { events: snapshot.events });
      return;
    }
    if (url.pathname === "/api/projects") {
      const snapshot = await buildNexusDashboardSnapshot(snapshotOptions);
      sendJson(response, { projects: [snapshot.project] });
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: "not_found" }));
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        ok: false,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      }),
    );
  }
}

function sendJson(response: ServerResponse, value: unknown): void {
  sendText(
    response,
    "application/json; charset=utf-8",
    JSON.stringify(value, null, 2),
  );
}

function sendText(
  response: ServerResponse,
  contentType: string,
  body: string,
): void {
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
