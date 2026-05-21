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
    ":root { --dn-grid-line: rgba(180, 210, 188, 0.055); --dn-shadow: 0 22px 60px rgba(0, 0, 0, 0.28); --dn-branch-0: #1aa7ff; --dn-branch-1: #e51ec3; --dn-branch-2: #35dd54; --dn-branch-3: #ff9f0a; --dn-branch-4: #9b5cff; --dn-branch-5: #17d6cf; --dn-branch-faint: rgba(238, 245, 236, 0.16); }",
    ":root[data-dev-nexus-theme='light'] { --dn-grid-line: rgba(31, 115, 93, 0.085); --dn-shadow: 0 18px 40px rgba(34, 50, 42, 0.1); --dn-branch-0: #0076c9; --dn-branch-1: #c01494; --dn-branch-2: #168e35; --dn-branch-3: #b66100; --dn-branch-4: #6a3fd6; --dn-branch-5: #008a84; --dn-branch-faint: rgba(22, 35, 27, 0.14); }",
    "@media (prefers-color-scheme: light) { :root:not([data-dev-nexus-theme]) { color-scheme: light; --dn-bg: #f5f8f6; --dn-surface: #ffffff; --dn-surface-raised: #edf3ef; --dn-surface-muted: rgba(235, 242, 238, 0.86); --dn-weave-bg: rgba(236, 244, 241, 0.9); --dn-text: #16231b; --dn-strong: #0f1813; --dn-muted: #55685d; --dn-label: #687d71; --dn-border: rgba(42, 73, 55, 0.18); --dn-border-muted: rgba(42, 73, 55, 0.12); --dn-border-strong: rgba(42, 73, 55, 0.28); --dn-pill-text: #27372e; --dn-control-active: #dcebe3; --dn-control-hover: rgba(42, 73, 55, 0.08); --dn-good: #167f53; --dn-active: #265dcc; --dn-warn: #9a641c; --dn-warn-soft: #77500f; --dn-danger: #bc3b2f; --dn-neutral: #526459; } }",
    "* { box-sizing: border-box; }",
    "body { margin: 0; min-width: 320px; color: var(--dn-text); background: linear-gradient(90deg, var(--dn-grid-line) 1px, transparent 1px), linear-gradient(0deg, var(--dn-grid-line) 1px, transparent 1px), linear-gradient(135deg, color-mix(in srgb, var(--dn-bg) 88%, var(--dn-branch-0) 12%), var(--dn-bg) 44%, color-mix(in srgb, var(--dn-bg) 86%, var(--dn-branch-1) 14%)); background-size: 28px 28px, 28px 28px, auto; }",
    "button, input, select { font: inherit; }",
    ".dn-shell { width: min(1520px, 100%); margin: 0 auto; padding: 24px; }",
    ".dn-header { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: end; min-height: 210px; overflow: hidden; padding: 32px; border: 1px solid var(--dn-border); border-radius: 8px; background: linear-gradient(135deg, color-mix(in srgb, var(--dn-surface) 88%, var(--dn-branch-0) 12%), color-mix(in srgb, var(--dn-surface) 92%, var(--dn-branch-5) 8%) 52%, color-mix(in srgb, var(--dn-surface) 90%, var(--dn-branch-1) 10%)); box-shadow: var(--dn-shadow); }",
    ".dn-header::before { content: ''; position: absolute; inset: 0 0 auto; height: 5px; background: linear-gradient(90deg, var(--dn-branch-0), var(--dn-branch-1), var(--dn-branch-2), var(--dn-branch-3), var(--dn-branch-4), var(--dn-branch-5)); }",
    ".dn-eyebrow { display: block; margin: 0 0 12px; color: var(--dn-good); font-size: 0.76rem; font-weight: 850; text-transform: uppercase; }",
    ".dn-header h1 { margin: 0 0 10px; font-size: clamp(2.1rem, 3vw, 3.25rem); line-height: 1.02; letter-spacing: 0; }",
    ".dn-header p { margin: 0; color: var(--dn-muted); }",
    ".dn-header-actions { display: grid; gap: 10px; justify-items: end; align-content: end; }",
    ".dn-meta { display: grid; gap: 6px; min-width: 250px; padding: 12px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-meta span, .dn-label, .dn-table th { color: var(--dn-label); font-size: 0.76rem; font-weight: 800; text-transform: uppercase; }",
    ".dn-meta strong { color: var(--dn-strong); overflow-wrap: anywhere; }",
    "a.dn-action { display: inline-flex; align-items: center; justify-content: center; min-height: 34px; padding: 7px 10px; border: 1px solid color-mix(in srgb, var(--dn-active) 42%, var(--dn-border)); border-radius: 8px; color: var(--dn-strong); background: color-mix(in srgb, var(--dn-surface-raised) 78%, var(--dn-active) 22%); font-size: 0.78rem; font-weight: 850; text-decoration: none; transition: transform 120ms ease, border-color 120ms ease, background 120ms ease; }",
    "a.dn-action:hover { transform: translateY(-1px); border-color: var(--dn-active); background: color-mix(in srgb, var(--dn-surface-raised) 64%, var(--dn-active) 36%); }",
    ".dn-action-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }",
    ".dn-action-strip.compact { margin-top: 0; }",
    ".dn-action-strip.compact .dn-action { min-height: 28px; padding: 5px 8px; font-size: 0.72rem; }",
    ".dn-theme-toggle { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-theme-toggle button { min-width: 66px; min-height: 32px; padding: 0 10px; border: 0; border-radius: 6px; color: var(--dn-muted); background: transparent; cursor: pointer; font-size: 0.82rem; font-weight: 800; }",
    ".dn-theme-toggle button:hover { color: var(--dn-text); background: var(--dn-control-hover); }",
    ".dn-theme-toggle button[aria-pressed='true'] { color: var(--dn-strong); background: var(--dn-control-active); box-shadow: 0 0 0 1px var(--dn-border-strong) inset; }",
    ".dn-signals { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }",
    ".dn-signal, .dn-panel { border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-signal { position: relative; min-height: 112px; overflow: hidden; padding: 12px; text-align: left; color: inherit; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }",
    ".dn-signal::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: var(--dn-neutral); }",
    ".dn-signal.tonebox-good::before { background: var(--dn-good); } .dn-signal.tonebox-active::before { background: var(--dn-active); } .dn-signal.tonebox-warn::before { background: var(--dn-warn); } .dn-signal.tonebox-danger::before { background: var(--dn-danger); }",
    ".dn-signal:hover, .dn-component-card:hover, .dn-event:hover, .dn-blocker:hover { transform: translateY(-1px); }",
    ".dn-signal.selected, .dn-component-card.selected, .dn-event.selected, .dn-blocker.selected, .dn-history-item.selected { border-color: var(--dn-active); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-active) 18%, transparent) inset; }",
    ".dn-signal-top, .dn-card-title, .dn-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }",
    ".dn-signal-icon { display: inline-grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border: 1px solid var(--dn-border); border-radius: 8px; background: color-mix(in srgb, var(--dn-surface-raised) 78%, transparent); color: currentColor; }",
    ".dn-signal-icon svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2.2; fill: none; stroke-linecap: round; stroke-linejoin: round; }",
    ".dn-dot { display: inline-block; flex: 0 0 auto; width: 10px; height: 10px; border-radius: 999px; background: currentColor; }",
    ".dn-signal strong { display: block; margin: 6px 0; color: var(--dn-strong); font-size: 1.35rem; line-height: 1; overflow-wrap: anywhere; }",
    ".dn-signal p, .dn-event p, .dn-panel p { margin: 0; color: var(--dn-muted); }",
    ".dn-signal p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.92rem; }",
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
    ".dn-main-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.62fr); gap: 14px; align-items: stretch; }",
    ".dn-secondary-grid { grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(300px, 0.8fr); margin-top: 14px; }",
    ".dn-history-panel { min-height: 690px; background: linear-gradient(180deg, color-mix(in srgb, var(--dn-surface) 96%, var(--dn-branch-0) 4%), var(--dn-surface)); }",
    ".dn-count { color: var(--dn-label); font-size: 0.8rem; font-weight: 800; white-space: nowrap; }",
    ".dn-history-note { margin: 8px 0 0; color: var(--dn-muted); font-size: 0.84rem; }",
    ".dn-lane-key { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }",
    ".dn-lane-key span { max-width: 180px; padding: 3px 7px; overflow: hidden; border: 1px solid var(--dn-border-muted); border-left: 5px solid var(--dn-branch-color); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-muted); font-size: 0.72rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-branch-board { position: relative; min-height: 420px; max-height: 650px; margin-top: 12px; padding-left: 132px; overflow: auto; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: color-mix(in srgb, var(--dn-weave-bg) 84%, transparent); scrollbar-gutter: stable; }",
    ".dn-branch-svg { position: absolute; left: 0; top: 0; width: 122px; pointer-events: none; }",
    ".dn-branch-svg path { fill: none; stroke-linecap: round; stroke-linejoin: round; }",
    ".dn-history-rows { display: grid; gap: 0; }",
    ".dn-history-item { position: relative; display: grid; grid-template-columns: minmax(190px, 0.74fr) minmax(140px, 0.46fr) auto; align-items: center; gap: 10px; min-height: 34px; height: 34px; padding: 0 10px 0 10px; border: 0; border-bottom: 1px solid var(--dn-border-muted); border-radius: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; transition: background 120ms ease, box-shadow 120ms ease; }",
    ".dn-history-item:hover { background: color-mix(in srgb, var(--dn-control-hover) 82%, var(--dn-branch-color) 18%); }",
    ".dn-history-item.selected { background: color-mix(in srgb, var(--dn-control-hover) 66%, var(--dn-branch-color) 34%); border-color: transparent; }",
    ".dn-branch-dot { position: absolute; left: calc(-115px + (var(--dn-lane) * 18px)); top: calc(50% - 5px); width: 10px; height: 10px; border: 2px solid var(--dn-surface); border-radius: 999px; background: var(--dn-branch-color); box-shadow: 0 0 0 1px var(--dn-branch-color), 0 0 12px color-mix(in srgb, var(--dn-branch-color) 54%, transparent); }",
    ".dn-history-main { display: flex; align-items: center; gap: 8px; min-width: 0; }",
    ".dn-history-chip { flex: 0 0 auto; max-width: 116px; height: 22px; padding: 2px 7px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--dn-branch-color) 54%, var(--dn-border)); border-left: 5px solid var(--dn-branch-color); border-radius: 6px; color: var(--dn-pill-text); background: color-mix(in srgb, var(--dn-surface-raised) 76%, var(--dn-branch-color) 24%); font-size: 0.7rem; font-weight: 850; line-height: 16px; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }",
    ".dn-history-main strong, .dn-card-title strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-history-main strong { font-size: 0.92rem; font-weight: 720; }",
    ".dn-history-status { color: var(--dn-label); font-size: 0.7rem; font-weight: 850; text-transform: uppercase; white-space: nowrap; }",
    ".dn-history-detail, .dn-card-meta { display: block; min-width: 0; overflow: hidden; color: var(--dn-muted); font-size: 0.82rem; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-more { height: 34px; padding: 9px 10px; border-bottom: 1px solid var(--dn-border-muted); color: var(--dn-label); font-size: 0.78rem; font-weight: 800; }",
    ".dn-inspector { position: sticky; top: 16px; align-self: start; background: linear-gradient(180deg, color-mix(in srgb, var(--dn-surface) 93%, var(--dn-branch-4) 7%), var(--dn-surface)); }",
    ".dn-inspector h2 { font-size: 1.35rem; }",
    ".dn-inspector > p { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }",
    ".dn-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 16px 0 0; }",
    ".dn-detail-grid div { min-width: 0; padding: 10px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-surface-muted); }",
    ".dn-detail-grid dt { color: var(--dn-label); font-size: 0.72rem; font-weight: 850; text-transform: uppercase; }",
    ".dn-detail-grid dd { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin: 4px 0 0; overflow: hidden; color: var(--dn-strong); font-weight: 760; overflow-wrap: anywhere; }",
    ".dn-related { display: grid; gap: 8px; margin-top: 16px; }",
    ".dn-related article { padding: 10px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-surface-muted); }",
    ".dn-related p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
    ".dn-component-grid, .dn-blocker-list, .dn-events { display: grid; gap: 10px; max-height: 440px; overflow: auto; }",
    ".dn-event-card, .dn-blocker-card { display: grid; gap: 6px; min-width: 0; }",
    ".dn-component-card, .dn-event, .dn-blocker { display: grid; gap: 6px; min-width: 0; padding: 11px; border: 1px solid var(--dn-border-muted); border-radius: 8px; color: inherit; background: var(--dn-surface-muted); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }",
    ".dn-event strong { color: var(--dn-strong); }",
    ".dn-event p, .dn-blocker strong { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }",
    ".tone-good { color: var(--dn-good); } .tone-active { color: var(--dn-active); } .tone-warn { color: var(--dn-warn); } .tone-danger { color: var(--dn-danger); } .tone-neutral { color: var(--dn-neutral); }",
    "@media (max-width: 1120px) { .dn-signals { grid-template-columns: repeat(3, minmax(0, 1fr)); } .dn-grid, .dn-main-grid, .dn-secondary-grid { grid-template-columns: 1fr; } .dn-inspector { position: static; } }",
    "@media (max-width: 680px) { .dn-shell { padding: 12px; } .dn-header { grid-template-columns: 1fr; padding: 20px; } .dn-header-actions { justify-items: stretch; } .dn-meta { min-width: 0; } .dn-theme-toggle button { min-width: 0; flex: 1; } .dn-signals { grid-template-columns: 1fr; } .dn-panel-heading { align-items: flex-start; flex-direction: column; } .dn-history-item { grid-template-columns: minmax(0, 1fr) auto; } .dn-history-detail { display: none; } .dn-detail-grid { grid-template-columns: 1fr; } }",
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
    "  let selectedId = null;",
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
    "  function setSelectedId(nextSelectedId) {",
    "    if (disposed) return;",
    "    selectedId = String(nextSelectedId ?? '');",
    "    renderCurrent();",
    "  }",
    "  function renderRoot(markup) {",
    "    root.innerHTML = markup;",
    "    bindThemeControls(root, setThemeMode);",
    "    bindSelectionControls(root, setSelectedId);",
    "  }",
    "  function renderCurrent() {",
    "    if (disposed) return;",
    "    if (latestSnapshot) {",
    "      renderRoot(renderDashboard(latestSnapshot, themeMode, selectedId));",
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
    "      if (!findSelectableById(snapshot, selectedId)) selectedId = defaultSelectedId(snapshot);",
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
    "function renderDashboard(snapshot, themeMode, selectedId) {",
    "  const activeSelection = findSelectableById(snapshot, selectedId) ? selectedId : defaultSelectedId(snapshot);",
    "  return `<div class=\"dn-shell\">",
    "    <header class=\"dn-header\">",
    "      <div><span class=\"dn-eyebrow\">DevNexus cockpit</span><h1>${escapeHtml(snapshot.project.name)}</h1><p>${escapeHtml(snapshot.summary)}</p></div>",
    "      <div class=\"dn-header-actions\"><div class=\"dn-meta\"><span>Generated</span><strong>${escapeHtml(formatTime(snapshot.generatedAt))}</strong><span>Root</span><strong title=\"${escapeHtml(snapshot.project.root)}\">${escapeHtml(compactPath(snapshot.project.root))}</strong></div>${renderThemeToggle(themeMode)}</div>",
    "    </header>",
    "    ${renderSignals(snapshot.signals, activeSelection)}",
    "    <section class=\"dn-main-grid\">",
    "      ${renderWorkHistory(snapshot, activeSelection)}",
    "      ${renderInspector(snapshot, activeSelection)}",
    "    </section>",
    "    <section class=\"dn-grid dn-secondary-grid\">",
    "      <div class=\"dn-panel\"><h2>Components</h2>${renderComponents(snapshot.components, activeSelection)}</div>",
    "      <div class=\"dn-panel\"><h2>Activity</h2><div class=\"dn-events\">${snapshot.events.slice(0, 7).map((event) => renderEvent(event, activeSelection)).join('')}</div></div>",
    "      <div class=\"dn-panel\"><h2>Blockers</h2>${renderBlockers(snapshot, activeSelection)}</div>",
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
    "function bindSelectionControls(container, onSelect) {",
    "  container.querySelectorAll('[data-select-id]').forEach((button) => {",
    "    button.addEventListener('click', () => onSelect(button.getAttribute('data-select-id')));",
    "  });",
    "}",
    "",
    "function renderSignals(signals, selectedId) {",
    "  return `<section class=\"dn-signals\" aria-label=\"Current workspace signals\">${signals.map((signal) => renderSignal(signal, selectedId)).join('')}</section>`;",
    "}",
    "",
    "function renderSignal(signal, selectedId) {",
    "  const id = `signal:${signal.id}`;",
    "  const detail = formatDisplayText(signal.detail);",
    "  return `<button class=\"dn-signal tonebox-${escapeAttribute(signal.tone)} ${id === selectedId ? 'selected' : ''}\" type=\"button\" data-select-id=\"${escapeHtml(id)}\"><span class=\"dn-signal-top\"><span class=\"dn-signal-icon tone-${escapeAttribute(signal.tone)}\">${signalIcon(signal.id)}</span><span class=\"dn-label tone-${escapeAttribute(signal.tone)}\">${escapeHtml(signal.label)}</span></span><strong>${escapeHtml(signal.value)}</strong><p title=\"${escapeHtml(detail)}\">${escapeHtml(detail)}</p></button>`;",
    "}",
    "",
    "function renderEvent(event, selectedId) {",
    "  const relatedId = event.relatedNodeIds.find(Boolean) ?? `event:${event.id}`;",
    "  return `<article class=\"dn-event-card\"><button class=\"dn-event ${relatedId === selectedId ? 'selected' : ''}\" type=\"button\" data-select-id=\"${escapeHtml(relatedId)}\"><span class=\"dn-label\">${escapeHtml(formatTime(event.time))} · ${escapeHtml(event.source)}</span><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(formatDisplayText(event.body))}</p></button>${renderActionStrip(event.actions, 'compact')}</article>`;",
    "}",
    "",
    "function renderWorkHistory(snapshot, selectedId) {",
    "  const timeline = historyRows(snapshot);",
    "  const rows = timeline.rows;",
    "  return `<div class=\"dn-panel dn-history-panel\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Parallel work map</span><h2>Workspace Activity</h2><p class=\"dn-history-note\">Source, worktrees, cycles, and handoffs in one view.</p></div><span class=\"dn-count\">${rows.length} rows · ${timeline.lanes.length} lanes</span></div>${renderLaneKey(timeline.lanes)}<div class=\"dn-branch-board\" role=\"list\">${renderBranchGraph(rows, timeline.lanes)}<div class=\"dn-history-rows\">${rows.map((row) => renderHistoryItem(row, selectedId)).join('')}</div></div></div>`;",
    "}",
    "",
    "function renderHistoryItem(row, selectedId) {",
    "  const node = row.node;",
    "  const tone = toneForStatus(node.status, node.kind);",
    "  const selected = node.id === selectedId ? 'selected' : '';",
    "  const detail = formatDisplayText(row.detail ?? node.detail ?? node.status);",
    "  const title = `${row.title ?? node.label} · ${detail}`;",
    "  return `<button class=\"dn-history-item ${selected} kind-${escapeAttribute(node.kind)}\" style=\"--dn-lane:${row.lane}; --dn-branch-color:var(--dn-branch-${row.lane});\" type=\"button\" data-lane=\"${row.lane}\" data-select-id=\"${escapeHtml(node.id)}\" title=\"${escapeHtml(title)}\"><span class=\"dn-branch-dot\" aria-hidden=\"true\"></span><span class=\"dn-history-main\"><span class=\"dn-history-chip\">${escapeHtml(row.laneLabel)}</span><strong>${escapeHtml(row.title ?? node.label)}</strong></span><span class=\"dn-history-detail\">${escapeHtml(detail)}</span><span class=\"dn-history-status tone-${escapeAttribute(tone)}\">${escapeHtml(node.status)}</span></button>`;",
    "}",
    "",
    "function renderLaneKey(lanes) {",
    "  return `<div class=\"dn-lane-key\">${lanes.map((lane) => `<span style=\"--dn-branch-color:var(--dn-branch-${lane.index});\" title=\"${escapeHtml(lane.label)}\">${escapeHtml(lane.label)}</span>`).join('')}</div>`;",
    "}",
    "",
    "function renderInspector(snapshot, selectedId) {",
    "  const detail = selectedDetail(snapshot, selectedId);",
    "  const body = formatDisplayText(detail.body);",
    "  return `<aside class=\"dn-panel dn-inspector\"><span class=\"dn-eyebrow\">Details</span><h2>${escapeHtml(truncate(detail.title, 80))}</h2><p title=\"${escapeHtml(body)}\">${escapeHtml(truncate(body, 220))}</p>${renderActionStrip(detail.actions)}<dl class=\"dn-detail-grid\">${detail.facts.map((fact) => { const value = formatDisplayText(fact[1]); return `<div><dt>${escapeHtml(fact[0])}</dt><dd title=\"${escapeHtml(value)}\">${escapeHtml(truncate(value, 90))}</dd></div>`; }).join('')}</dl>${detail.events.length ? `<div class=\"dn-related\"><span class=\"dn-label\">Related activity</span>${detail.events.slice(0, 3).map((event) => `<article><strong>${escapeHtml(truncate(event.title, 70))}</strong><p>${escapeHtml(truncate(formatDisplayText(event.body), 140))}</p>${renderActionStrip(event.actions, 'compact')}</article>`).join('')}</div>` : ''}</aside>`;",
    "}",
    "",
    "function renderComponents(components, selectedId) {",
    "  return `<div class=\"dn-component-grid\">${components.map((component) => { const id = `component:${component.id}`; const git = component.git; const tone = git?.dirty ? 'warn' : component.sourceRootExists ? 'good' : 'danger'; return `<button class=\"dn-component-card ${id === selectedId ? 'selected' : ''}\" type=\"button\" data-select-id=\"${escapeHtml(id)}\"><span class=\"dn-card-title\"><strong>${escapeHtml(component.name)}</strong><span class=\"dn-dot tone-${tone}\"></span></span><span class=\"dn-label\">${escapeHtml(component.role)} · ${escapeHtml(component.defaultTrackerId ?? 'no tracker')}</span><span class=\"dn-card-meta\">${escapeHtml(git?.branch ?? 'missing branch')} · ${escapeHtml(git?.dirty ? 'dirty' : 'clean')}</span></button>`; }).join('')}</div>`;",
    "}",
    "",
    "function renderBlockers(snapshot, selectedId) {",
    "  if (!snapshot.blockers.length) return '<p>No blockers.</p>';",
    "  const nodesById = new Map(snapshot.weave.nodes.map((node) => [node.id, node]));",
    "  return `<div class=\"dn-blocker-list\">${snapshot.blockers.slice(0, 8).map((blocker, index) => { const id = `blocker:${index}`; const node = nodesById.get(id); return `<article class=\"dn-blocker-card\"><button class=\"dn-blocker ${id === selectedId ? 'selected' : ''}\" type=\"button\" data-select-id=\"${escapeHtml(id)}\"><span class=\"dn-label tone-warn\">Blocker</span><strong>${escapeHtml(formatDisplayText(blocker))}</strong></button>${renderActionStrip(node?.actions, 'compact')}</article>`; }).join('')}</div>`;",
    "}",
    "",
    "function renderActionStrip(actions, mode = '') {",
    "  const visibleActions = uniqueActions(actions ?? []).slice(0, 3);",
    "  if (!visibleActions.length) return '';",
    "  const className = mode ? `dn-action-strip ${mode}` : 'dn-action-strip';",
    "  return `<div class=\"${className}\">${visibleActions.map((action) => `<a class=\"dn-action\" href=\"${escapeHtml(action.href)}\" target=\"_blank\" rel=\"noreferrer\">${escapeHtml(action.label ?? 'Open provider')}</a>`).join('')}</div>`;",
    "}",
    "",
    "function signalIcon(id) {",
    "  if (id === 'components') return '<svg viewBox=\"0 0 24 24\"><path d=\"M4 7l8-4 8 4-8 4-8-4z\"/><path d=\"M4 12l8 4 8-4\"/><path d=\"M4 17l8 4 8-4\"/></svg>';",
    "  if (id === 'automation') return '<svg viewBox=\"0 0 24 24\"><path d=\"M6 8a3 3 0 116 0c0 2-3 2-3 5\"/><path d=\"M18 16a3 3 0 11-6 0c0-2 3-2 3-5\"/><path d=\"M9 21v-2\"/><path d=\"M15 3v2\"/></svg>';",
    "  if (id === 'eligible-work') return '<svg viewBox=\"0 0 24 24\"><path d=\"M5 6h14\"/><path d=\"M5 12h10\"/><path d=\"M5 18h6\"/><path d=\"M17 16l2 2 4-5\"/></svg>';",
    "  if (id === 'worktrees') return '<svg viewBox=\"0 0 24 24\"><path d=\"M7 3v7a4 4 0 004 4h6\"/><path d=\"M7 21v-7\"/><circle cx=\"7\" cy=\"4\" r=\"2\"/><circle cx=\"7\" cy=\"20\" r=\"2\"/><circle cx=\"19\" cy=\"14\" r=\"2\"/></svg>';",
    "  if (id === 'blockers') return '<svg viewBox=\"0 0 24 24\"><path d=\"M12 3l10 18H2L12 3z\"/><path d=\"M12 9v5\"/><path d=\"M12 18h.01\"/></svg>';",
    "  return '<svg viewBox=\"0 0 24 24\"><path d=\"M6 3v6a4 4 0 004 4h4\"/><path d=\"M18 21v-6a4 4 0 00-4-4h-4\"/><circle cx=\"6\" cy=\"3\" r=\"2\"/><circle cx=\"18\" cy=\"21\" r=\"2\"/></svg>';",
    "}",
    "",
    "function historyRows(snapshot) {",
    "  const nodesById = new Map(snapshot.weave.nodes.map((node) => [node.id, node]));",
    "  const lanes = timelineLanes(snapshot);",
    "  const laneByKey = new Map(lanes.map((lane) => [lane.key, lane]));",
    "  const rows = [];",
    "  const addRow = (node, laneKey, title, detail) => {",
    "    const lane = laneByKey.get(laneKey) ?? laneByKey.get('worktrees') ?? laneByKey.get('main') ?? lanes[0];",
    "    if (!node || !lane || rows.some((row) => row.node.id === node.id)) return;",
    "    rows.push({ node, index: rows.length, lane: lane.index, laneLabel: lane.shortLabel, title, detail, timeMs: nodeTimeMs(node) });",
    "  };",
    "  for (const group of groupedBranchNodes(snapshot.weave.nodes)) {",
    "    addRow(group.node, 'main', group.node.label, group.detail);",
    "  }",
    "  for (const worktree of snapshot.worktrees.records) {",
    "    const node = nodesById.get(`worktree:${worktree.id}`);",
    "    const branch = worktree.branchName ?? worktree.id;",
    "    const laneKey = laneByKey.has(worktreeLaneKey(worktree)) ? worktreeLaneKey(worktree) : 'worktrees';",
    "    const scope = [worktree.componentId, worktree.workItemId, worktree.hostId].filter(Boolean).join(' · ');",
    "    addRow(node, laneKey, compactBranchName(branch), `${scope || 'worktree'} · updated ${formatTime(worktree.updatedAt)}`);",
    "  }",
    "  snapshot.weave.nodes.filter((node) => node.kind === 'run' || node.kind === 'target-cycle').sort(compareNodesNewestFirst).forEach((node) => addRow(node, 'cycles', displayTitle(node, snapshot), node.detail));",
    "  snapshot.weave.nodes.filter((node) => node.kind === 'authority' || node.kind === 'blocker').forEach((node) => addRow(node, 'policy', displayTitle(node, snapshot), displayBody(node, snapshot)));",
    "  if (!rows.length) addRow(nodesById.get('project'), 'main', snapshot.project.name, snapshot.project.root);",
    "  rows.sort(compareTimelineRows);",
    "  rows.slice(0, 36).forEach((row, index) => { row.index = index; });",
    "  return { rows: rows.slice(0, 36), lanes };",
    "}",
    "",
    "function timelineLanes(snapshot) {",
    "  const lanes = [{ key: 'main', label: snapshot.project.defaultBranch ?? 'main', shortLabel: snapshot.project.defaultBranch ?? 'main', index: 0 }];",
    "  const seen = new Set(['main']);",
    "  const activeWorktrees = snapshot.worktrees.records.filter((worktree) => worktree.branchName);",
    "  for (const worktree of activeWorktrees) {",
    "    if (lanes.length >= 3) break;",
    "    const key = worktreeLaneKey(worktree);",
    "    if (seen.has(key)) continue;",
    "    seen.add(key);",
    "    lanes.push({ key, label: worktree.branchName ?? worktree.id, shortLabel: compactBranchName(worktree.branchName ?? worktree.id), index: lanes.length });",
    "  }",
    "  lanes.push({ key: 'worktrees', label: 'other worktrees', shortLabel: 'worktrees', index: lanes.length });",
    "  lanes.push({ key: 'cycles', label: 'target cycles and runs', shortLabel: 'cycles', index: lanes.length });",
    "  lanes.push({ key: 'policy', label: 'bot handoffs and blockers', shortLabel: 'handoffs', index: lanes.length });",
    "  return lanes.slice(0, 6).map((lane, index) => ({ ...lane, index }));",
    "}",
    "",
    "function groupedBranchNodes(nodes) {",
    "  const groups = new Map();",
    "  nodes.filter((node) => node.kind === 'branch').forEach((node) => {",
    "    const key = node.label || node.id;",
    "    const group = groups.get(key) ?? { node, count: 0, dirty: false };",
    "    group.count += 1;",
    "    group.dirty = group.dirty || node.status === 'dirty';",
    "    if (!groups.has(key) || node.status === 'dirty') group.node = node;",
    "    groups.set(key, group);",
    "  });",
    "  return [...groups.values()].map((group) => ({ node: group.node, detail: group.count > 1 ? `${group.count} component checkouts` : group.node.detail }));",
    "}",
    "",
    "function renderBranchGraph(rows, lanes) {",
    "  const rowHeight = 34;",
    "  const height = Math.max(rowHeight, rows.length * rowHeight);",
    "  const xForLane = (lane) => 22 + lane * 18;",
    "  const railTop = rowHeight / 2;",
    "  const railBottom = Math.max(railTop, height - rowHeight / 2);",
    "  const rails = lanes.map((lane) => `<path d=\"M ${xForLane(lane.index)} ${railTop} V ${railBottom}\" stroke=\"var(--dn-branch-${lane.index})\" stroke-width=\"3\" opacity=\"0.58\" />`).join('');",
    "  const connectors = rows.map((row, index) => {",
    "    if (row.lane === 0) return '';",
    "    const y = index * rowHeight + rowHeight / 2;",
    "    const x1 = xForLane(0);",
    "    const x2 = xForLane(row.lane);",
    "    const mid = x1 + (x2 - x1) / 2;",
    "    return `<path d=\"M ${x1} ${y} C ${mid} ${y}, ${mid} ${y}, ${x2} ${y}\" stroke=\"var(--dn-branch-${row.lane})\" stroke-width=\"3\" opacity=\"0.86\" />`;",
    "  }).join('');",
    "  return `<svg class=\"dn-branch-svg\" width=\"122\" height=\"${height}\" viewBox=\"0 0 122 ${height}\" aria-hidden=\"true\" data-row-height=\"${rowHeight}\">${rails}${connectors}</svg>`;",
    "}",
    "",
    "function compareTimelineRows(left, right) {",
    "  const leftPriority = rowPriority(left.node);",
    "  const rightPriority = rowPriority(right.node);",
    "  if (leftPriority !== rightPriority) return leftPriority - rightPriority;",
    "  return (right.timeMs ?? 0) - (left.timeMs ?? 0);",
    "}",
    "",
    "function rowPriority(node) {",
    "  if (node.kind === 'branch') return 0;",
    "  if (node.kind === 'authority') return 1;",
    "  if (node.kind === 'worktree') return 2;",
    "  if (node.kind === 'run' || node.kind === 'target-cycle') return 3;",
    "  if (node.kind === 'blocker') return 4;",
    "  return 5;",
    "}",
    "",
    "function compareNodesNewestFirst(left, right) {",
    "  return nodeTimeMs(right) - nodeTimeMs(left);",
    "}",
    "",
    "function nodeTimeMs(node) {",
    "  if (!node?.timestamp) return 0;",
    "  const time = new Date(node.timestamp).getTime();",
    "  return Number.isNaN(time) ? 0 : time;",
    "}",
    "",
    "function worktreeLaneKey(worktree) {",
    "  return `worktree:${worktree.branchName ?? worktree.id}`;",
    "}",
    "",
    "function compactBranchName(value) {",
    "  const text = String(value ?? 'worktree');",
    "  const parts = text.split('/').filter(Boolean);",
    "  return parts.length > 2 ? parts.slice(-2).join('/') : text;",
    "}",
    "",
    "function defaultSelectedId(snapshot) {",
    "  const node = snapshot.weave.nodes.find((candidate) => ['blocked', 'failed', 'dirty', 'missing'].includes(candidate.status)) ?? snapshot.weave.nodes.find((candidate) => candidate.kind === 'project') ?? snapshot.weave.nodes[0];",
    "  return node?.id ?? `signal:${snapshot.signals[0]?.id ?? 'components'}`;",
    "}",
    "",
    "function findSelectableById(snapshot, id) {",
    "  if (!id) return false;",
    "  if (String(id).startsWith('signal:')) return snapshot.signals.some((signal) => `signal:${signal.id}` === id);",
    "  return snapshot.weave.nodes.some((node) => node.id === id);",
    "}",
    "",
    "function selectedDetail(snapshot, selectedId) {",
    "  const id = findSelectableById(snapshot, selectedId) ? selectedId : defaultSelectedId(snapshot);",
    "  if (String(id).startsWith('signal:')) return signalDetail(snapshot, id);",
    "  const node = snapshot.weave.nodes.find((candidate) => candidate.id === id) ?? snapshot.weave.nodes[0];",
    "  const lane = snapshot.weave.lanes.find((candidate) => candidate.id === node?.laneId);",
    "  const facts = [['Type', displayKind(node)], ['Status', node?.status ?? 'unknown'], ['Lane', displayLane(lane?.label ?? node?.laneId)]];",
    "  if (node?.timestamp) facts.push(['Time', formatTime(node.timestamp)]);",
    "  enrichNodeFacts(snapshot, node, facts);",
    "  const events = relatedEvents(snapshot, node?.id);",
    "  const actions = uniqueActions([...(node?.actions ?? []), ...events.flatMap((event) => event.actions ?? [])]);",
    "  return { title: displayTitle(node, snapshot), body: displayBody(node, snapshot), facts, events, actions };",
    "}",
    "",
    "function displayTitle(node, snapshot) {",
    "  if (!node) return snapshot.project.name;",
    "  if (node.kind === 'run') return statusTitle('Run', node.status);",
    "  if (node.kind === 'target-cycle') return statusTitle('Cycle', node.status);",
    "  if (node.kind === 'authority') return 'Bot permissions';",
    "  return node.label;",
    "}",
    "",
    "function displayBody(node, snapshot) {",
    "  if (!node) return snapshot.summary;",
    "  if (node.kind === 'authority') return node.detail || 'Publication and provider permissions for the automation bot.';",
    "  if (node.kind === 'blocker') return readableBlocker(node.detail);",
    "  return node.detail ?? snapshot.summary;",
    "}",
    "",
    "function displayKind(node) {",
    "  if (!node) return 'unknown';",
    "  if (node.kind === 'target-cycle') return 'target cycle';",
    "  if (node.kind === 'work-item') return 'work item';",
    "  if (node.kind === 'authority') return 'bot permissions';",
    "  return node.kind;",
    "}",
    "",
    "function displayLane(value) {",
    "  if (value === 'Authority' || value === 'authority') return 'Policy';",
    "  if (value === 'Cycles' || value === 'cycles') return 'Cycles and runs';",
    "  if (value === 'Branches' || value === 'branches') return 'Source and worktrees';",
    "  return value ?? 'unknown';",
    "}",
    "",
    "function statusTitle(prefix, status) {",
    "  const text = String(status ?? '').replace(/[-_]+/g, ' ').trim();",
    "  return text ? `${prefix} ${text}` : prefix;",
    "}",
    "",
    "function readableBlocker(value) {",
    "  const text = String(value ?? 'Blocked');",
    "  return formatDisplayText(text.replace(/lease-[0-9a-f]+/giu, 'a stale worktree lease').replace(/codex\\/[A-Za-z0-9/_-]+/gu, 'a worktree branch'));",
    "}",
    "",
    "function signalDetail(snapshot, id) {",
    "  const signal = snapshot.signals.find((candidate) => `signal:${candidate.id}` === id) ?? snapshot.signals[0];",
    "  const events = id === 'signal:blockers' ? snapshot.events.filter((event) => event.id.startsWith('blocker-')).slice(0, 3) : snapshot.events.slice(0, 2);",
    "  return { title: signal?.label ?? 'Signal', body: signal?.detail ?? snapshot.summary, facts: [['Value', signal?.value ?? 'unknown'], ['Tone', signal?.tone ?? 'neutral'], ['Project', snapshot.project.name]], events, actions: uniqueActions(events.flatMap((event) => event.actions ?? [])) };",
    "}",
    "",
    "function enrichNodeFacts(snapshot, node, facts) {",
    "  if (!node) return;",
    "  if (node.kind === 'component') {",
    "    const component = snapshot.components.find((candidate) => `component:${candidate.id}` === node.id);",
    "    if (component) {",
    "      facts.push(['Role', component.role]);",
    "      facts.push(['Tracker', component.defaultTrackerId ?? 'none']);",
    "      facts.push(['Branch', component.git?.branch ?? 'missing']);",
    "      facts.push(['Git', component.git?.dirty ? 'dirty' : 'clean']);",
    "    }",
    "  }",
    "  if (node.kind === 'worktree') {",
    "    const worktree = snapshot.worktrees.records.find((candidate) => `worktree:${candidate.id}` === node.id);",
    "    if (worktree) {",
    "      facts.push(['Component', worktree.componentId ?? 'workspace']);",
    "      facts.push(['Branch', worktree.branchName ?? 'none']);",
    "      facts.push(['Host', worktree.hostId]);",
    "      facts.push(['Updated', formatTime(worktree.updatedAt)]);",
    "    }",
    "  }",
    "  if (node.kind === 'authority' && snapshot.authority) {",
    "    facts.push(['Components', String(snapshot.authority.components.length)]);",
    "    facts.push(['Blocked actions', String(snapshot.authority.blockedActionCount)]);",
    "    facts.push(['Handoffs', String(snapshot.authority.fallbackActionCount)]);",
    "  }",
    "}",
    "",
    "function relatedEvents(snapshot, nodeId) {",
    "  return nodeId ? snapshot.events.filter((event) => event.relatedNodeIds.includes(nodeId)) : [];",
    "}",
    "",
    "function uniqueActions(actions) {",
    "  const seen = new Set();",
    "  const unique = [];",
    "  for (const action of actions ?? []) {",
    "    if (!action?.href || seen.has(action.href)) continue;",
    "    seen.add(action.href);",
    "    unique.push(action);",
    "  }",
    "  return unique;",
    "}",
    "",
    "function toneForStatus(status, kind) {",
    "  if (['ready', 'clean', 'completed', 'configured'].includes(status)) return 'good';",
    "  if (['working', 'active', 'head', 'dispatched'].includes(status) || kind === 'project') return 'active';",
    "  if (['blocked', 'failed', 'dirty', 'missing'].includes(status)) return 'danger';",
    "  if (['stale', 'warning'].includes(status) || kind === 'blocker') return 'warn';",
    "  return 'neutral';",
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
    "function compactPath(value) {",
    "  const text = String(value ?? '');",
    "  const parts = text.split('/').filter(Boolean);",
    "  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : text;",
    "}",
    "",
    "function formatTime(value) {",
    "  const date = new Date(value);",
    "  return Number.isNaN(date.getTime()) ? String(value ?? '') : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });",
    "}",
    "",
    "function formatDisplayText(value) {",
    "  const text = String(value ?? '').replace(/\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z/gu, (match) => formatTime(match));",
    "  if (/No resolved auth profile is available for publication action provider\\.pull_request\\.open/iu.test(text)) return 'No bot credential is available for opening a pull request. Human handoff is required.';",
    "  return text.replace(/provider\\.pull_request\\.open/gu, 'opening a pull request').replace(/coordination\\.handoff/gu, 'human handoff');",
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
