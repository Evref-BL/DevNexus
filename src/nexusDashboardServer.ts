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
    "const styles = `",
    ":root { color: #eef5ec; background: #0b100e; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-synthesis: none; }",
    "* { box-sizing: border-box; }",
    "body { margin: 0; min-width: 320px; background: #0b100e; }",
    "button, input, select { font: inherit; }",
    ".dn-shell { width: min(1520px, 100%); margin: 0 auto; padding: 24px; }",
    ".dn-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: end; padding-bottom: 18px; border-bottom: 1px solid rgba(180, 210, 188, 0.18); }",
    ".dn-header h1 { margin: 0 0 8px; font-size: 1.9rem; line-height: 1.08; letter-spacing: 0; }",
    ".dn-header p { margin: 0; color: #aebbae; }",
    ".dn-meta { display: grid; gap: 6px; min-width: 250px; padding: 12px; border: 1px solid rgba(180, 210, 188, 0.18); border-radius: 8px; background: #121915; }",
    ".dn-meta span, .dn-label, .dn-table th { color: #87998d; font-size: 0.76rem; font-weight: 800; text-transform: uppercase; }",
    ".dn-meta strong { color: #f3f8f0; overflow-wrap: anywhere; }",
    ".dn-signals { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }",
    ".dn-signal, .dn-panel { border: 1px solid rgba(180, 210, 188, 0.18); border-radius: 8px; background: #121915; }",
    ".dn-signal { min-height: 132px; padding: 14px; }",
    ".dn-signal strong { display: block; margin: 8px 0; color: #f3f8f0; font-size: 1.45rem; line-height: 1; overflow-wrap: anywhere; }",
    ".dn-signal p, .dn-event p, .dn-panel p { margin: 0; color: #aebbae; }",
    ".dn-signal p { display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }",
    ".dn-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(340px, 0.9fr); gap: 14px; }",
    ".dn-panel { min-width: 0; padding: 16px; }",
    ".dn-panel h2 { margin: 0 0 12px; color: #f3f8f0; font-size: 1rem; letter-spacing: 0; }",
    ".dn-pills { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0; list-style: none; }",
    ".dn-pill { padding: 7px 9px; border: 1px solid rgba(180, 210, 188, 0.18); border-radius: 999px; color: #dfe8df; background: rgba(12, 18, 15, 0.76); font-size: 0.82rem; font-weight: 700; }",
    ".dn-pill.warn { border-color: rgba(228, 177, 95, 0.32); color: #f2d49b; }",
    ".dn-weave { width: 100%; min-height: 430px; overflow: auto; border-radius: 8px; background: rgba(8, 12, 10, 0.58); }",
    ".dn-weave svg { min-width: 900px; display: block; }",
    ".dn-lane-label { fill: #87998d; font-size: 12px; font-weight: 800; text-transform: uppercase; }",
    ".dn-edge { stroke: rgba(180, 210, 188, 0.28); stroke-width: 2; fill: none; }",
    ".dn-node rect { fill: #17211c; stroke: rgba(180, 210, 188, 0.28); stroke-width: 1; rx: 8; }",
    ".dn-node text { fill: #eef5ec; font-size: 12px; font-weight: 750; }",
    ".dn-node .dn-node-detail { fill: #aebbae; font-size: 10px; font-weight: 600; }",
    ".dn-node.status-ready rect, .dn-node.status-clean rect, .dn-node.status-completed rect { stroke: #67d29e; }",
    ".dn-node.status-working rect, .dn-node.status-active rect, .dn-node.status-head rect { stroke: #79a7ff; }",
    ".dn-node.status-blocked rect, .dn-node.status-failed rect, .dn-node.status-dirty rect { stroke: #ff8b78; }",
    ".dn-table { width: 100%; border-collapse: collapse; }",
    ".dn-table th, .dn-table td { padding: 9px 8px; border-bottom: 1px solid rgba(180, 210, 188, 0.12); text-align: left; vertical-align: top; }",
    ".dn-table td { color: #dfe8df; overflow-wrap: anywhere; }",
    ".dn-events { display: grid; gap: 10px; max-height: 590px; overflow: auto; }",
    ".dn-event { display: grid; gap: 5px; padding: 10px; border: 1px solid rgba(180, 210, 188, 0.14); border-radius: 8px; background: rgba(12, 18, 15, 0.76); }",
    ".dn-event strong { color: #f3f8f0; }",
    ".dn-event p { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }",
    ".tone-good { color: #67d29e; } .tone-active { color: #79a7ff; } .tone-warn { color: #e4b15f; } .tone-danger { color: #ff8b78; } .tone-neutral { color: #b3c0b5; }",
    "@media (max-width: 1120px) { .dn-signals { grid-template-columns: repeat(3, minmax(0, 1fr)); } .dn-grid { grid-template-columns: 1fr; } }",
    "@media (max-width: 680px) { .dn-shell { padding: 12px; } .dn-header { grid-template-columns: 1fr; } .dn-signals { grid-template-columns: 1fr; } }",
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
    "  injectStyles();",
    "  const baseUrl = options.baseUrl ?? '';",
    "  const refreshMs = options.refreshMs ?? defaultRefreshMs;",
    "  let disposed = false;",
    "  let inFlight = false;",
    "  async function refresh() {",
    "    if (inFlight) return;",
    "    inFlight = true;",
    "    try {",
    "      const snapshot = await fetchDevNexusDashboard(baseUrl);",
    "      if (!disposed) root.innerHTML = renderDashboard(snapshot);",
    "    } catch (error) {",
    "      if (!disposed) root.innerHTML = renderError(error);",
    "    } finally {",
    "      inFlight = false;",
    "    }",
    "  }",
    "  void refresh();",
    "  const timer = setInterval(refresh, refreshMs);",
    "  return { dispose() { disposed = true; clearInterval(timer); } };",
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
    "function renderDashboard(snapshot) {",
    "  return `<div class=\"dn-shell\">",
    "    <header class=\"dn-header\">",
    "      <div><h1>${escapeHtml(snapshot.project.name)} Cockpit</h1><p>${escapeHtml(snapshot.summary)}</p></div>",
    "      <div class=\"dn-meta\"><span>Generated</span><strong>${escapeHtml(formatTime(snapshot.generatedAt))}</strong><span>Root</span><strong>${escapeHtml(snapshot.project.root)}</strong></div>",
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
    "function renderError(error) {",
    "  return `<div class=\"dn-shell\"><section class=\"dn-panel\"><h2>Dashboard unavailable</h2><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></section></div>`;",
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
