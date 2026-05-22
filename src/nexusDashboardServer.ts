import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  buildNexusDashboardHostActionQueue,
  buildNexusDashboardHostSnapshot,
  buildNexusDashboardSnapshot,
  type BuildNexusDashboardHostSnapshotOptions,
  type BuildNexusDashboardSnapshotOptions,
  type NexusDashboardHostSnapshot,
  type NexusDashboardHostWorkspaceRecord,
  type NexusDashboardSnapshot,
} from "./nexusDashboard.js";
import {
  createNexusDashboardCodexChatStarter,
  NexusDashboardCodexChatError,
  type NexusDashboardCodexChatStarter,
} from "./nexusDashboardCodexChat.js";
import type { GitRunner } from "./gitWorktreeService.js";
import type { NexusEligibleWorkMode } from "./nexusEligibleWorkSummary.js";

export interface StartNexusDashboardServerOptions {
  projectRoot?: string;
  host?: string;
  port?: number;
  homePath?: string;
  eligibleWorkMode?: NexusEligibleWorkMode;
  gitRunner?: GitRunner;
  now?: () => Date | string;
  codexChatStarter?: NexusDashboardCodexChatStarter;
}

export interface NexusDashboardServerHandle {
  projectRoot: string | null;
  host: string;
  port: number;
  url: string;
  server: Server;
  close: () => Promise<void>;
}

interface DashboardWorkspaceSelection {
  readonly snapshotOptions: BuildNexusDashboardSnapshotOptions;
  readonly baseHost?: NexusDashboardHostSnapshot;
}

class NexusDashboardRouteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "NexusDashboardRouteError";
  }
}

export async function startNexusDashboardServer(
  options: StartNexusDashboardServerOptions,
): Promise<NexusDashboardServerHandle> {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : null;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const snapshotOptions: BuildNexusDashboardHostSnapshotOptions = {
    ...(projectRoot ? { projectRoot } : {}),
    homePath: options.homePath,
    eligibleWorkMode: options.eligibleWorkMode,
    gitRunner: options.gitRunner,
    now: options.now,
  };
  const codexChatStarter =
    options.codexChatStarter ?? createNexusDashboardCodexChatStarter();
  const actionToken = randomBytes(24).toString("base64url");
  const server = http.createServer((request, response) => {
    void routeDashboardRequest(
      request,
      response,
      snapshotOptions,
      codexChatStarter,
      actionToken,
    );
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
    close: async () => {
      await close(server);
      await codexChatStarter.close();
    },
  };
}

export function renderNexusDashboardHtml(options: {
  title?: string;
  modulePath?: string;
  actionToken?: string;
} = {}): string {
  const title = escapeHtml(options.title ?? "DevNexus Cockpit");
  const modulePath = escapeHtml(options.modulePath ?? "/assets/dev-nexus-dashboard.js");
  const actionTokenScript = options.actionToken
    ? `<script>globalThis.__DEV_NEXUS_DASHBOARD_ACTION_TOKEN__ = ${safeJsonString(options.actionToken)};</script>`
    : "";
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
    actionTokenScript,
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
    ".dn-action { display: inline-flex; align-items: center; justify-content: center; gap: 7px; max-width: 100%; min-height: 34px; padding: 7px 10px; border: 1px solid color-mix(in srgb, var(--dn-active) 42%, var(--dn-border)); border-radius: 8px; color: var(--dn-strong); background: color-mix(in srgb, var(--dn-surface-raised) 78%, var(--dn-active) 22%); font-size: 0.78rem; font-weight: 850; text-decoration: none; transition: transform 120ms ease, border-color 120ms ease, background 120ms ease; cursor: pointer; }",
    ".dn-action:hover { transform: translateY(-1px); border-color: var(--dn-active); background: color-mix(in srgb, var(--dn-surface-raised) 64%, var(--dn-active) 36%); }",
    ".dn-local-action { color: var(--dn-strong); border-color: color-mix(in srgb, var(--dn-warn) 44%, var(--dn-border)); background: color-mix(in srgb, var(--dn-surface-raised) 78%, var(--dn-warn) 22%); }",
    ".dn-start-action { color: var(--dn-strong); border-color: color-mix(in srgb, var(--dn-active) 52%, var(--dn-border)); background: color-mix(in srgb, var(--dn-surface-raised) 70%, var(--dn-active) 30%); }",
    ".dn-local-action[data-copied='true'] { border-color: var(--dn-good); background: color-mix(in srgb, var(--dn-surface-raised) 70%, var(--dn-good) 30%); }",
    ".dn-action:disabled { opacity: 0.72; cursor: wait; transform: none; }",
    ".dn-action:disabled:hover { transform: none; }",
    ".dn-action svg { flex: 0 0 auto; width: 14px; height: 14px; fill: currentColor; stroke: currentColor; }",
    ".dn-action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-action-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }",
    ".dn-action-strip.compact { margin-top: 0; }",
    ".dn-action-strip.compact .dn-action { min-height: 28px; padding: 5px 8px; font-size: 0.72rem; }",
    ".dn-theme-toggle { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-theme-toggle button { min-width: 66px; min-height: 32px; padding: 0 10px; border: 0; border-radius: 6px; color: var(--dn-muted); background: transparent; cursor: pointer; font-size: 0.82rem; font-weight: 800; }",
    ".dn-theme-toggle button:hover { color: var(--dn-text); background: var(--dn-control-hover); }",
    ".dn-theme-toggle button[aria-pressed='true'] { color: var(--dn-strong); background: var(--dn-control-active); box-shadow: 0 0 0 1px var(--dn-border-strong) inset; }",
    ".dn-signals { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }",
    ".dn-signal, .dn-panel { border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-signal { --dn-signal-accent: var(--dn-neutral); position: relative; min-height: 112px; overflow: hidden; padding: 12px; border-color: color-mix(in srgb, var(--dn-signal-accent) 38%, var(--dn-border)); color: inherit; background: linear-gradient(145deg, color-mix(in srgb, var(--dn-surface) 80%, var(--dn-signal-accent) 20%), var(--dn-surface)); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }",
    ".dn-signal::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: var(--dn-signal-accent); }",
    ".dn-signal.signal-components { --dn-signal-accent: #58d68d; } .dn-signal.signal-automation { --dn-signal-accent: #79a7ff; } .dn-signal.signal-eligible-work { --dn-signal-accent: #35d6c6; } .dn-signal.signal-worktrees { --dn-signal-accent: #e4b15f; } .dn-signal.signal-blockers { --dn-signal-accent: #ff8b78; } .dn-signal.signal-plugins { --dn-signal-accent: #b68cff; }",
    ".dn-signal:hover, .dn-component-card:hover, .dn-event:hover, .dn-blocker:hover { transform: translateY(-1px); }",
    ".dn-signal.selected, .dn-component-card.selected, .dn-event.selected, .dn-blocker.selected, .dn-history-item.selected { border-color: var(--dn-active); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-active) 18%, transparent) inset; }",
    ".dn-signal-top, .dn-card-title, .dn-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }",
    ".dn-host-panel { margin: 16px 0; background: linear-gradient(135deg, color-mix(in srgb, var(--dn-surface) 92%, var(--dn-branch-5) 8%), var(--dn-surface)); }",
    ".dn-workspace-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }",
    ".dn-workspace-card { --dn-workspace-accent: var(--dn-neutral); display: grid; gap: 7px; min-width: 0; padding: 11px; border: 1px solid color-mix(in srgb, var(--dn-workspace-accent) 34%, var(--dn-border)); border-left: 5px solid var(--dn-workspace-accent); border-radius: 8px; color: inherit; background: color-mix(in srgb, var(--dn-surface-muted) 82%, var(--dn-workspace-accent) 18%); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }",
    ".dn-workspace-card:hover { transform: translateY(-1px); border-color: var(--dn-workspace-accent); }",
    ".dn-workspace-card.selected { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-workspace-accent) 26%, transparent) inset; }",
    ".dn-workspace-card.tone-good { --dn-workspace-accent: var(--dn-good); } .dn-workspace-card.tone-active { --dn-workspace-accent: var(--dn-active); } .dn-workspace-card.tone-warn { --dn-workspace-accent: var(--dn-warn); } .dn-workspace-card.tone-danger { --dn-workspace-accent: var(--dn-danger); }",
    ".dn-workspace-card strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-workspace-card p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.8rem; }",
    ".dn-workspace-meta { display: flex; flex-wrap: wrap; gap: 6px; }",
    ".dn-workspace-meta span { padding: 3px 6px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-muted); font-size: 0.7rem; font-weight: 800; }",
    ".dn-signal-icon { display: inline-grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border: 1px solid color-mix(in srgb, var(--dn-signal-accent) 36%, var(--dn-border)); border-radius: 8px; background: color-mix(in srgb, var(--dn-surface-raised) 72%, var(--dn-signal-accent) 28%); color: var(--dn-signal-accent); }",
    ".dn-signal-icon svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2.2; fill: none; stroke-linecap: round; stroke-linejoin: round; }",
    ".dn-dot { display: inline-block; flex: 0 0 auto; width: 10px; height: 10px; border-radius: 999px; background: currentColor; }",
    ".dn-signal strong { display: block; margin: 6px 0; color: var(--dn-strong); font-size: 1.35rem; line-height: 1; overflow-wrap: anywhere; }",
    ".dn-signal p, .dn-event p, .dn-panel p { margin: 0; color: var(--dn-muted); }",
    ".dn-signal p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.92rem; }",
    ".dn-host-signal { cursor: default; } .dn-host-signal:hover { transform: none; }",
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
    ".dn-main-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.62fr); gap: 14px; align-items: start; }",
    ".dn-work-stack { display: grid; gap: 14px; min-width: 0; }",
    ".dn-secondary-grid { grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(300px, 0.8fr); margin-top: 14px; }",
    ".dn-plugin-row { margin-top: 14px; }",
    ".dn-history-panel { min-height: 690px; background: linear-gradient(180deg, color-mix(in srgb, var(--dn-surface) 96%, var(--dn-branch-0) 4%), var(--dn-surface)); }",
    ".dn-count { color: var(--dn-label); font-size: 0.8rem; font-weight: 800; white-space: nowrap; }",
    ".dn-history-note { margin: 8px 0 0; color: var(--dn-muted); font-size: 0.84rem; }",
    ".dn-lane-key { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }",
    ".dn-lane-key span { max-width: 210px; padding: 3px 7px; overflow: hidden; border: 1px solid var(--dn-border-muted); border-left: 5px solid var(--dn-branch-color); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-muted); font-size: 0.72rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-branch-board { position: relative; min-height: 420px; max-height: 650px; margin-top: 12px; padding-left: 132px; overflow: auto; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: color-mix(in srgb, var(--dn-weave-bg) 84%, transparent); scrollbar-gutter: stable; }",
    ".dn-branch-svg { position: absolute; left: 0; top: 0; width: 122px; pointer-events: none; }",
    ".dn-branch-svg path { fill: none; stroke-linecap: round; stroke-linejoin: round; }",
    ".dn-history-rows { display: grid; gap: 0; }",
    ".dn-history-item { position: relative; display: grid; grid-template-columns: minmax(190px, 0.74fr) minmax(140px, 0.46fr) auto; align-items: center; gap: 10px; min-height: 34px; height: 34px; padding: 0 10px 0 10px; border: 0; border-bottom: 1px solid var(--dn-border-muted); border-radius: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; transition: background 120ms ease, box-shadow 120ms ease; }",
    ".dn-history-item:hover { background: color-mix(in srgb, var(--dn-control-hover) 82%, var(--dn-branch-color) 18%); }",
    ".dn-history-item.selected { background: color-mix(in srgb, var(--dn-control-hover) 66%, var(--dn-branch-color) 34%); border-color: transparent; }",
    ".dn-branch-dot { position: absolute; left: calc(-115px + (var(--dn-lane) * 18px)); top: calc(50% - 5px); width: 10px; height: 10px; border: 2px solid var(--dn-surface); border-radius: 999px; background: var(--dn-branch-color); box-shadow: 0 0 0 1px var(--dn-branch-color), 0 0 12px color-mix(in srgb, var(--dn-branch-color) 54%, transparent); }",
    ".dn-history-main { display: flex; align-items: center; gap: 8px; min-width: 0; }",
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
    ".dn-component-grid, .dn-blocker-list, .dn-events, .dn-thread-list, .dn-plugin-list { display: grid; gap: 10px; max-height: 440px; overflow: auto; }",
    ".dn-thread-list { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }",
    ".dn-plugin-list { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }",
    ".dn-host-main-grid { display: grid; grid-template-columns: minmax(320px, 0.72fr) minmax(0, 1.28fr); gap: 14px; align-items: start; margin-top: 14px; }",
    ".dn-host-action-list { display: grid; gap: 10px; }",
    ".dn-host-action-card { display: grid; gap: 7px; min-width: 0; padding: 12px; border: 1px solid color-mix(in srgb, var(--dn-warn) 34%, var(--dn-border)); border-left: 5px solid var(--dn-warn); border-radius: 8px; color: inherit; background: color-mix(in srgb, var(--dn-surface-muted) 80%, var(--dn-warn) 20%); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease; }",
    ".dn-host-action-card:hover { border-color: var(--dn-warn); transform: translateY(-1px); }",
    ".dn-host-action-card strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-event-card, .dn-blocker-card { display: grid; gap: 6px; min-width: 0; }",
    ".dn-component-card, .dn-event, .dn-blocker { display: grid; gap: 6px; min-width: 0; padding: 11px; border: 1px solid var(--dn-border-muted); border-radius: 8px; color: inherit; background: var(--dn-surface-muted); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }",
    ".dn-thread-card, .dn-plugin-card { display: grid; gap: 7px; min-width: 0; padding: 11px; border: 1px solid var(--dn-border-muted); border-radius: 8px; color: inherit; background: var(--dn-surface-muted); }",
    ".dn-thread-card-header, .dn-plugin-card-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; min-width: 0; }",
    ".dn-thread-main { display: grid; gap: 4px; min-width: 0; }",
    ".dn-thread-main strong, .dn-plugin-card strong { overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-thread-card p, .dn-plugin-card p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.78rem; }",
    ".dn-thread-decision { padding: 4px 7px; border: 1px solid currentColor; border-radius: 6px; font-size: 0.68rem; font-weight: 900; text-transform: uppercase; white-space: nowrap; }",
    ".dn-thread-decision.decision-continue { color: var(--dn-active); } .dn-thread-decision.decision-review, .dn-thread-decision.decision-archive { color: var(--dn-warn); } .dn-thread-decision.decision-rescue { color: var(--dn-danger); } .dn-thread-decision.decision-forget { color: var(--dn-good); }",
    ".dn-event strong { color: var(--dn-strong); }",
    ".dn-event p, .dn-blocker strong { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }",
    ".tone-good { color: var(--dn-good); } .tone-active { color: var(--dn-active); } .tone-warn { color: var(--dn-warn); } .tone-danger { color: var(--dn-danger); } .tone-neutral { color: var(--dn-neutral); }",
    "@media (max-width: 1120px) { .dn-signals { grid-template-columns: repeat(3, minmax(0, 1fr)); } .dn-grid, .dn-main-grid, .dn-host-main-grid, .dn-secondary-grid { grid-template-columns: 1fr; } .dn-inspector { position: static; } }",
    "@media (max-width: 680px) { .dn-shell { padding: 12px; } .dn-header { grid-template-columns: 1fr; padding: 20px; } .dn-header-actions { justify-items: stretch; } .dn-meta { min-width: 0; } .dn-theme-toggle button { min-width: 0; flex: 1; } .dn-signals { grid-template-columns: 1fr; } .dn-panel-heading { align-items: flex-start; flex-direction: column; } .dn-history-item { grid-template-columns: minmax(0, 1fr) auto; } .dn-history-detail { display: none; } .dn-detail-grid { grid-template-columns: 1fr; } }",
    "`;",
    "",
    "export async function fetchDevNexusDashboard(baseUrl = '', workspaceId = '') {",
    "  const response = await fetch(`${baseUrl}/api/dashboard${workspaceQuery(workspaceId)}`, { cache: 'no-store' });",
    "  if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);",
    "  return response.json();",
    "}",
    "",
    "export async function fetchDevNexusDashboardHost(baseUrl = '', workspaceId = '') {",
    "  const response = await fetch(`${baseUrl}/api/host${workspaceQuery(workspaceId)}`, { cache: 'no-store' });",
    "  if (!response.ok) throw new Error(`Host API returned ${response.status}`);",
    "  return response.json();",
    "}",
    "",
    "function workspaceQuery(workspaceId) {",
    "  const id = normalizeWorkspaceId(workspaceId);",
    "  return id ? `?workspace=${encodeURIComponent(id)}` : '';",
    "}",
    "",
    "export function mountDevNexusDashboard(root, options = {}) {",
    "  if (!root) throw new Error('mountDevNexusDashboard requires a root element');",
    "  const baseUrl = options.baseUrl ?? '';",
    "  const actionToken = options.actionToken ?? (typeof globalThis !== 'undefined' ? (globalThis.__DEV_NEXUS_DASHBOARD_ACTION_TOKEN__ ?? '') : '');",
    "  const refreshMs = options.refreshMs ?? defaultRefreshMs;",
    "  const hostRefreshMs = options.hostRefreshMs ?? Math.max(refreshMs * 4, 60000);",
    "  let themeMode = normalizeThemeMode(options.theme ?? readStoredThemeMode());",
    "  let selectedWorkspaceId = normalizeWorkspaceId(options.workspaceId ?? readWorkspaceIdFromLocation());",
    "  let selectedId = null;",
    "  let latestSnapshot = null;",
    "  let latestHost = null;",
    "  let latestError = null;",
    "  let lastHostRefreshAt = 0;",
    "  let disposed = false;",
    "  let inFlight = false;",
    "  let hostInFlight = false;",
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
    "  function setWorkspaceId(nextWorkspaceId) {",
    "    if (disposed) return;",
    "    const normalized = normalizeWorkspaceId(nextWorkspaceId);",
    "    if (normalized === selectedWorkspaceId) return;",
    "    selectedWorkspaceId = normalized;",
    "    selectedId = null;",
    "    latestSnapshot = null;",
    "    latestError = null;",
    "    lastHostRefreshAt = 0;",
    "    writeWorkspaceIdToLocation(selectedWorkspaceId);",
    "    renderCurrent();",
    "    void refresh(true);",
    "  }",
    "  function renderRoot(markup) {",
    "    root.innerHTML = markup;",
    "    bindThemeControls(root, setThemeMode);",
    "    bindSelectionControls(root, setSelectedId);",
    "    bindWorkspaceControls(root, setWorkspaceId);",
    "    bindLocalActions(root, baseUrl, actionToken, selectedWorkspaceId);",
    "  }",
    "  function renderCurrent() {",
    "    if (disposed) return;",
    "    if (!selectedWorkspaceId) {",
    "      if (latestHost) renderRoot(renderHostDashboard(latestHost, themeMode));",
    "      else if (latestError) renderRoot(renderError(latestError, themeMode));",
    "      else renderRoot(renderLoading(themeMode, latestHost, selectedWorkspaceId));",
    "      return;",
    "    }",
    "    if (latestSnapshot) {",
    "      renderRoot(renderDashboard(latestSnapshot, themeMode, selectedId, latestHost, selectedWorkspaceId));",
    "    } else if (latestError) {",
    "      renderRoot(renderError(latestError, themeMode));",
    "    } else {",
    "      renderRoot(renderLoading(themeMode, latestHost, selectedWorkspaceId));",
    "    }",
    "  }",
    "  async function refresh(force = false) {",
    "    if (inFlight && !force) return;",
    "    inFlight = true;",
    "    try {",
    "      const workspaceId = selectedWorkspaceId;",
    "      if (!workspaceId) {",
    "        const host = await fetchDevNexusDashboardHost(baseUrl);",
    "        if (workspaceId !== selectedWorkspaceId) return;",
    "        latestHost = host;",
    "        latestSnapshot = null;",
    "        latestError = null;",
    "        lastHostRefreshAt = Date.now();",
    "        renderCurrent();",
    "        return;",
    "      }",
    "      const shouldRefreshHost = !latestHost || Date.now() - lastHostRefreshAt >= hostRefreshMs;",
    "      const snapshot = await fetchDevNexusDashboard(baseUrl, workspaceId);",
    "      if (workspaceId !== selectedWorkspaceId) return;",
    "      latestSnapshot = snapshot;",
    "      latestError = null;",
    "      if (!findSelectableById(snapshot, selectedId)) selectedId = defaultSelectedId(snapshot);",
    "      renderCurrent();",
    "      if (shouldRefreshHost) void refreshHost();",
    "    } catch (error) {",
    "      latestSnapshot = null;",
    "      latestError = error;",
    "      renderCurrent();",
    "    } finally {",
    "      inFlight = false;",
    "    }",
    "  }",
    "  async function refreshHost() {",
    "    if (hostInFlight) return;",
    "    hostInFlight = true;",
    "    try {",
    "      const workspaceId = selectedWorkspaceId;",
    "      const host = await fetchDevNexusDashboardHost(baseUrl, workspaceId);",
    "      if (workspaceId !== selectedWorkspaceId) return;",
    "      latestHost = host;",
    "      lastHostRefreshAt = Date.now();",
    "      renderCurrent();",
    "    } catch {",
    "      latestHost = null;",
    "    } finally {",
    "      hostInFlight = false;",
    "    }",
    "  }",
    "  renderCurrent();",
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
    "function renderDashboard(snapshot, themeMode, selectedId, host, selectedWorkspaceId = '') {",
    "  const activeSelection = findSelectableById(snapshot, selectedId) ? selectedId : defaultSelectedId(snapshot);",
    "  return `<div class=\"dn-shell\">",
    "    <header class=\"dn-header\">",
    "      <div><span class=\"dn-eyebrow\">DevNexus cockpit</span><h1>${escapeHtml(snapshot.project.name)}</h1><p>${escapeHtml(snapshot.summary)}</p></div>",
    "      <div class=\"dn-header-actions\">${renderHostNavButton(selectedWorkspaceId)}<div class=\"dn-meta\"><span>Generated</span><strong>${escapeHtml(formatTime(snapshot.generatedAt))}</strong><span>Root</span><strong title=\"${escapeHtml(snapshot.project.root)}\">${escapeHtml(compactPath(snapshot.project.root))}</strong></div>${renderThemeToggle(themeMode)}</div>",
    "    </header>",
    "    ${renderHostOverview(host, snapshot, selectedWorkspaceId)}",
    "    ${renderSignals(snapshot.signals, activeSelection)}",
    "    <section class=\"dn-main-grid\">",
    "      <div class=\"dn-work-stack\">${renderWorkHistory(snapshot, activeSelection)}${renderThreadInbox(snapshot)}</div>",
    "      ${renderInspector(snapshot, activeSelection)}",
    "    </section>",
    "    <section class=\"dn-grid dn-secondary-grid\">",
    "      <div class=\"dn-panel\"><h2>Components</h2>${renderComponents(snapshot.components, activeSelection)}</div>",
    "      <div class=\"dn-panel\"><h2>Activity</h2><div class=\"dn-events\">${snapshot.events.slice(0, 7).map((event) => renderEvent(event, activeSelection)).join('')}</div></div>",
    "      <div class=\"dn-panel\"><h2>Blockers</h2>${renderBlockers(snapshot, activeSelection)}</div>",
    "    </section>",
    "    <section class=\"dn-plugin-row\">${renderPlugins(snapshot.plugins)}</section>",
    "  </div>`;",
    "}",
    "",
    "function renderHostDashboard(host, themeMode) {",
    "  const summary = `${host.workspaceCount} workspaces, ${host.needsAttentionCount} need attention`;",
    "  return `<div class=\"dn-shell dn-host-dashboard\"><header class=\"dn-header\"><div><span class=\"dn-eyebrow\">DevNexus cockpit</span><h1>Host Cockpit</h1><p>${escapeHtml(summary)}</p></div><div class=\"dn-header-actions\"><div class=\"dn-meta\"><span>Generated</span><strong>${escapeHtml(formatTime(host.generatedAt))}</strong><span>Home</span><strong title=\"${escapeHtml(host.homePath)}\">${escapeHtml(compactPath(host.homePath))}</strong></div>${renderThemeToggle(themeMode)}</div></header>${renderHostSignals(host)}<section class=\"dn-host-main-grid\">${renderHostActionQueue(host)}${renderHostOverview(host, null, '', { hostMode: true })}</section></div>`;",
    "}",
    "",
    "function renderHostSignals(host) {",
    "  const workspaces = host?.workspaces ?? [];",
    "  const totalThreads = sumBy(workspaces, (workspace) => workspace.threadCount);",
    "  const totalHitl = sumBy(workspaces, (workspace) => workspace.needsDecisionCount);",
    "  const dirty = sumBy(workspaces, (workspace) => workspace.dirtyComponentCount);",
    "  const plugins = sumBy(workspaces, (workspace) => workspace.pluginCount);",
    "  const signals = [",
    "    { id: 'components', label: 'Workspaces', value: String(host?.workspaceCount ?? workspaces.length), detail: 'Registered and local project cockpits' },",
    "    { id: 'blockers', label: 'Needs attention', value: String(host?.needsAttentionCount ?? 0), detail: 'Workspaces with approvals, dirty state, or errors' },",
    "    { id: 'worktrees', label: 'Threads', value: String(totalThreads), detail: `${totalHitl} need review` },",
    "    { id: 'eligible-work', label: 'Dirty', value: String(dirty), detail: 'Component checkouts with local changes' },",
    "    { id: 'plugins', label: 'Plugins', value: String(plugins), detail: 'Installed DevNexus plugin instances' },",
    "  ];",
    "  return `<section class=\"dn-signals\" aria-label=\"Host signals\">${signals.map((signal) => `<article class=\"dn-signal dn-host-signal signal-${escapeAttribute(signal.id)}\"><span class=\"dn-signal-top\"><span class=\"dn-signal-icon\">${signalIcon(signal.id)}</span><span class=\"dn-label\">${escapeHtml(signal.label)}</span></span><strong>${escapeHtml(signal.value)}</strong><p>${escapeHtml(signal.detail)}</p></article>`).join('')}</section>`;",
    "}",
    "",
    "function renderHostActionQueue(host) {",
    "  const actions = host?.actionQueue ?? [];",
    "  const body = actions.length ? actions.slice(0, 8).map(renderHostActionCard).join('') : '<p>No workspace needs attention.</p>';",
    "  return `<section class=\"dn-panel\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Host HITL</span><h2>Action Queue</h2></div><span class=\"dn-count\">${escapeHtml(`${actions.length} actions`)}</span></div><div class=\"dn-host-action-list\">${body}</div></section>`;",
    "}",
    "",
    "function renderHostActionCard(action) {",
    "  const updated = action.updatedAt ? ` · ${formatTime(action.updatedAt)}` : '';",
    "  const detail = formatDisplayText(action.detail);",
    "  return `<button class=\"dn-host-action-card action-${escapeAttribute(action.kind)}\" type=\"button\" data-workspace-id=\"${escapeHtml(action.workspaceId)}\"><span class=\"dn-card-title\"><strong>${escapeHtml(action.workspaceName)}</strong><span class=\"dn-thread-decision decision-${action.tone === 'danger' ? 'rescue' : 'review'}\">${escapeHtml(action.state)}</span></span><span class=\"dn-card-meta\">${escapeHtml(action.reason)}${escapeHtml(updated)}</span><p title=\"${escapeHtml(detail)}\">${escapeHtml(truncate(detail, 110))}</p><span class=\"dn-action-label\">${escapeHtml(action.primaryAction?.label ?? 'Open workspace')}</span></button>`;",
    "}",
    "",
    "function renderHostNavButton(selectedWorkspaceId) {",
    "  return selectedWorkspaceId ? `<button class=\"dn-action\" type=\"button\" data-workspace-id=\"\">${signalIcon('worktrees')}<span class=\"dn-action-label\">Host cockpit</span></button>` : '';",
    "}",
    "",
    "function sumBy(values, selector) {",
    "  return values.reduce((total, value) => total + Number(selector(value) ?? 0), 0);",
    "}",
    "",
    "function renderLoading(themeMode, host, selectedWorkspaceId = '') {",
    "  const title = selectedWorkspaceId ? 'Switching workspace' : 'Loading host cockpit';",
    "  const detail = selectedWorkspaceId ? 'Loading workspace state.' : 'Reading registered workspaces, threads, plugins, and approvals.';",
    "  return `<div class=\"dn-shell\"><header class=\"dn-header\"><div><span class=\"dn-eyebrow\">DevNexus cockpit</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div><div class=\"dn-header-actions\">${renderHostNavButton(selectedWorkspaceId)}${renderThemeToggle(themeMode)}</div></header>${renderHostOverview(host, null, selectedWorkspaceId)}<section class=\"dn-panel\" style=\"margin-top:16px\"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p></section></div>`;",
    "}",
    "",
    "function renderHostOverview(host, snapshot, selectedWorkspaceId = '', options = {}) {",
    "  const workspaces = host?.workspaces ?? [];",
    "  if (!workspaces.length) return '';",
    "  const count = `${host.needsAttentionCount ?? 0} need attention · ${host.workspaceCount ?? workspaces.length} workspaces`;",
    "  return `<section class=\"dn-panel dn-host-panel\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Host cockpit</span><h2>Workspaces</h2></div><span class=\"dn-count\">${escapeHtml(count)}</span></div><div class=\"dn-workspace-list\">${workspaces.slice(0, 8).map((workspace) => renderWorkspaceCard(workspace, snapshot, selectedWorkspaceId, !options.hostMode)).join('')}</div></section>`;",
    "}",
    "",
    "function renderWorkspaceCard(workspace, snapshot, selectedWorkspaceId = '', highlightCurrent = true) {",
    "  const current = highlightCurrent && workspace.current ? 'current' : (workspace.registered ? 'registered' : 'local');",
    "  const status = workspace.error ? 'unavailable' : workspaceToneLabel(workspace);",
    "  const detail = formatDisplayText(workspace.summary);",
    "  const title = workspace.current && snapshot ? snapshot.project.name : workspace.name;",
    "  const meta = [`${workspace.componentCount} components`, `${workspace.needsDecisionCount} active HITL`, `${workspace.threadCount} active`, `${workspace.pluginCount} plugins`];",
    "  const selected = workspace.id === selectedWorkspaceId || (highlightCurrent && !selectedWorkspaceId && workspace.current) ? 'selected' : '';",
    "  return `<button class=\"dn-workspace-card tone-${escapeAttribute(workspace.tone)} ${selected}\" type=\"button\" data-workspace-id=\"${escapeHtml(workspace.id)}\" aria-label=\"Open ${escapeHtml(title)}\"><span class=\"dn-card-title\"><strong title=\"${escapeHtml(workspace.root)}\">${escapeHtml(title)}</strong><span class=\"dn-thread-decision decision-${workspace.needsDecisionCount > 0 ? 'rescue' : 'continue'}\">${escapeHtml(current)}</span></span><p title=\"${escapeHtml(detail)}\">${escapeHtml(detail)}</p><div class=\"dn-workspace-meta\"><span>${escapeHtml(status)}</span>${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div></button>`;",
    "}",
    "",
    "function workspaceToneLabel(workspace) {",
    "  if (workspace.blockerCount > 0 || workspace.automationStatus === 'blocked') return 'blocked';",
    "  if (workspace.needsDecisionCount > 0) return 'needs review';",
    "  if (workspace.dirtyComponentCount > 0) return 'dirty';",
    "  if (workspace.eligibleWorkCount > 0) return 'ready work';",
    "  return 'clear';",
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
    "function bindWorkspaceControls(container, onSelect) {",
    "  container.querySelectorAll('[data-workspace-id]').forEach((button) => {",
    "    button.addEventListener('click', () => onSelect(button.getAttribute('data-workspace-id')));",
    "  });",
    "}",
    "",
    "function bindLocalActions(container, baseUrl = '', actionToken = '', workspaceId = '') {",
    "  container.querySelectorAll('[data-copy-prompt]').forEach((button) => {",
    "    button.addEventListener('click', async () => {",
    "      const prompt = button.getAttribute('data-copy-prompt') ?? '';",
    "      const label = button.querySelector('.dn-action-label');",
    "      try {",
    "        await navigator.clipboard.writeText(prompt);",
    "        button.dataset.copied = 'true';",
    "        if (label) label.textContent = 'Copied brief';",
    "      } catch {",
    "        button.dataset.copied = 'error';",
    "        if (label) label.textContent = 'Copy failed';",
    "      }",
    "      setTimeout(() => { delete button.dataset.copied; if (label) label.textContent = 'Copy brief'; }, 1600);",
    "    });",
    "  });",
    "  container.querySelectorAll('[data-start-chat-prompt]').forEach((button) => {",
    "    button.addEventListener('click', async () => {",
    "      const prompt = button.getAttribute('data-start-chat-prompt') ?? '';",
    "      const title = button.getAttribute('data-start-chat-title') ?? '';",
    "      const targetId = button.getAttribute('data-chat-target-id') ?? '';",
    "      const startingLabel = button.getAttribute('data-chat-resume') === 'true' ? 'Resuming...' : 'Starting...';",
    "      const label = button.querySelector('.dn-action-label');",
    "      button.disabled = true;",
    "      if (label) label.textContent = startingLabel;",
    "      try {",
    "        const headers = { 'content-type': 'application/json' };",
    "        if (actionToken) headers['x-dev-nexus-action-token'] = actionToken;",
    "        const response = await fetch(`${baseUrl}/api/codex/thread${workspaceQuery(workspaceId)}`, {",
    "          method: 'POST',",
    "          headers,",
    "          body: JSON.stringify({ prompt, title, targetId }),",
    "        });",
    "        const payload = await response.json();",
    "        if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);",
    "        if (label) label.textContent = payload.result?.status === 'resumed' ? 'Chat resumed' : 'Chat started';",
    "        button.title = `Thread ${payload.result?.threadId ?? 'started'}`;",
    "      } catch (error) {",
    "        if (label) label.textContent = 'Setup needed';",
    "        button.title = error instanceof Error ? error.message : String(error);",
    "      } finally {",
    "        button.disabled = false;",
    "      }",
    "    });",
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
    "  return `<button class=\"dn-signal signal-${escapeAttribute(signal.id)} ${id === selectedId ? 'selected' : ''}\" type=\"button\" data-select-id=\"${escapeHtml(id)}\"><span class=\"dn-signal-top\"><span class=\"dn-signal-icon\">${signalIcon(signal.id)}</span><span class=\"dn-label\">${escapeHtml(signal.label)}</span></span><strong>${escapeHtml(signal.value)}</strong><p title=\"${escapeHtml(detail)}\">${escapeHtml(detail)}</p></button>`;",
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
    "  return `<div class=\"dn-panel dn-history-panel\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Parallel work map</span><h2>Workspace Activity</h2><p class=\"dn-history-note\">Source, work, cycles, and approvals in one view.</p></div><span class=\"dn-count\">${rows.length} rows · ${timeline.lanes.length} lanes</span></div>${renderLaneKey(timeline.lanes)}<div class=\"dn-branch-board\" role=\"list\">${renderBranchGraph(rows, timeline.lanes)}<div class=\"dn-history-rows\">${rows.map((row) => renderHistoryItem(row, selectedId)).join('')}</div></div></div>`;",
    "}",
    "",
    "function renderHistoryItem(row, selectedId) {",
    "  const node = row.node;",
    "  const tone = toneForStatus(node.status, node.kind);",
    "  const selected = node.id === selectedId ? 'selected' : '';",
    "  const detail = formatDisplayText(row.detail ?? node.detail ?? node.status);",
    "  const title = `${row.title ?? node.label} · ${detail}`;",
    "  return `<button class=\"dn-history-item ${selected} kind-${escapeAttribute(node.kind)}\" style=\"--dn-lane:${row.lane}; --dn-branch-color:var(--dn-branch-${row.lane});\" type=\"button\" data-lane=\"${row.lane}\" data-select-id=\"${escapeHtml(node.id)}\" title=\"${escapeHtml(title)}\"><span class=\"dn-branch-dot\" aria-hidden=\"true\"></span><span class=\"dn-history-main\"><strong>${escapeHtml(row.title ?? node.label)}</strong></span><span class=\"dn-history-detail\">${escapeHtml(detail)}</span><span class=\"dn-history-status tone-${escapeAttribute(tone)}\">${escapeHtml(node.status)}</span></button>`;",
    "}",
    "",
    "function renderLaneKey(lanes) {",
    "  return `<div class=\"dn-lane-key\">${lanes.map((lane) => `<span style=\"--dn-branch-color:var(--dn-branch-${lane.index});\" title=\"${escapeHtml(lane.label)}\">${escapeHtml(lane.shortLabel)}</span>`).join('')}</div>`;",
    "}",
    "",
    "function renderInspector(snapshot, selectedId) {",
    "  const detail = selectedDetail(snapshot, selectedId);",
    "  const body = formatDisplayText(detail.body);",
    "  return `<aside class=\"dn-panel dn-inspector\"><span class=\"dn-eyebrow\">Details</span><h2>${escapeHtml(truncate(detail.title, 80))}</h2><p title=\"${escapeHtml(body)}\">${escapeHtml(truncate(body, 220))}</p>${renderActionStrip(detail.actions)}${renderChatActionStrip(detail.chat)}<dl class=\"dn-detail-grid\">${detail.facts.map((fact) => { const value = formatDisplayText(fact[1]); return `<div><dt>${escapeHtml(fact[0])}</dt><dd title=\"${escapeHtml(value)}\">${escapeHtml(truncate(value, 90))}</dd></div>`; }).join('')}</dl>${detail.events.length ? `<div class=\"dn-related\"><span class=\"dn-label\">Related activity</span>${detail.events.slice(0, 3).map((event) => `<article><strong>${escapeHtml(truncate(event.title, 70))}</strong><p>${escapeHtml(truncate(formatDisplayText(event.body), 140))}</p>${renderActionStrip(event.actions, 'compact')}</article>`).join('')}</div>` : ''}</aside>`;",
    "}",
    "",
    "function renderComponents(components, selectedId) {",
    "  return `<div class=\"dn-component-grid\">${components.map((component) => { const id = `component:${component.id}`; const git = component.git; const tone = git?.dirty ? 'warn' : component.sourceRootExists ? 'good' : 'danger'; return `<button class=\"dn-component-card ${id === selectedId ? 'selected' : ''}\" type=\"button\" data-select-id=\"${escapeHtml(id)}\"><span class=\"dn-card-title\"><strong>${escapeHtml(component.name)}</strong><span class=\"dn-dot tone-${tone}\"></span></span><span class=\"dn-label\">${escapeHtml(component.role)} · ${escapeHtml(component.defaultTrackerId ?? 'no tracker')}</span><span class=\"dn-card-meta\">${escapeHtml(git?.branch ?? 'missing branch')} · ${escapeHtml(git?.dirty ? 'dirty' : 'clean')}</span></button>`; }).join('')}</div>`;",
    "}",
    "",
    "function renderThreadInbox(snapshot) {",
    "  const threads = snapshot.threads?.records ?? [];",
    "  const count = snapshot.threads ? `${snapshot.threads.needsDecisionCount} to review` : '0 to review';",
    "  const body = threads.length ? threads.slice(0, 5).map((thread) => renderThreadCard(thread)).join('') : '<p>No open threads.</p>';",
    "  return `<div class=\"dn-panel dn-thread-panel\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">HITL queue</span><h2>Action Needed</h2></div><span class=\"dn-count\">${escapeHtml(count)}</span></div><div class=\"dn-thread-list\">${body}</div></div>`;",
    "}",
    "",
    "function renderThreadCard(thread) {",
    "  const meta = [thread.componentId ?? 'workspace', thread.workItemId, thread.hostId, `updated ${formatTime(thread.updatedAt)}`].filter(Boolean).join(' · ');",
    "  return `<article class=\"dn-thread-card\"><div class=\"dn-thread-card-header\"><span class=\"dn-thread-main\"><strong>${escapeHtml(thread.title)}</strong><span class=\"dn-card-meta\">${escapeHtml(meta)}</span></span><span class=\"dn-thread-decision decision-${escapeAttribute(thread.decision)}\">${escapeHtml(thread.decisionLabel)}</span></div><p title=\"${escapeHtml(thread.decisionDetail)}\">${escapeHtml(formatDisplayText(thread.decisionDetail))}</p>${renderThreadActions(thread)}</article>`;",
    "}",
    "",
    "function renderThreadActions(thread) {",
    "  const links = uniqueActions(thread.actions ?? []).slice(0, 2).map((action) => `<a class=\"dn-action\" href=\"${escapeHtml(action.href)}\" target=\"_blank\" rel=\"noreferrer\" aria-label=\"${escapeHtml(externalActionLabel(action))}\">${providerIcon(action.provider)}<span class=\"dn-action-label\">${escapeHtml(action.label ?? 'Open provider')}</span>${externalLinkIcon()}</a>`).join('');",
    "  const prompt = cockpitThreadPrompt(thread);",
    "  const title = `Continue ${thread.title}`;",
    "  return `<div class=\"dn-action-strip compact\">${links}${renderChatButtons({ prompt, title, targetId: `thread:${thread.id}`, resumeThreadId: thread.assistantThreadId })}</div>`;",
    "}",
    "",
    "function renderChatActionStrip(chat, mode = '') {",
    "  if (!chat?.prompt) return '';",
    "  const className = mode ? `dn-action-strip ${mode}` : 'dn-action-strip';",
    "  return `<div class=\"${className}\">${renderChatButtons(chat)}</div>`;",
    "}",
    "",
    "function renderChatButtons(chat) {",
    "  const title = chat.title ?? 'Continue in chat';",
    "  const targetId = chat.targetId ?? '';",
    "  const resume = Boolean(chat.resumeThreadId);",
    "  const primaryLabel = resume ? 'Resume chat' : 'Start chat';",
    "  return `<button class=\"dn-action dn-start-action\" type=\"button\" data-start-chat-prompt=\"${escapeHtml(chat.prompt)}\" data-start-chat-title=\"${escapeHtml(title)}\" data-chat-target-id=\"${escapeHtml(targetId)}\" data-chat-resume=\"${resume ? 'true' : 'false'}\">${chatIcon()}<span class=\"dn-action-label\">${primaryLabel}</span></button><button class=\"dn-action dn-local-action\" type=\"button\" data-copy-prompt=\"${escapeHtml(chat.prompt)}\">${clipboardIcon()}<span class=\"dn-action-label\">Copy brief</span></button>`;",
    "}",
    "",
    "function cockpitThreadPrompt(thread) {",
    "  const lines = [",
    "    sentenceLine('Continue cockpit thread', thread.title),",
    "    sentenceLine('Decision', thread.decisionLabel),",
    "    sentenceLine('Reason', thread.decisionDetail),",
    "    thread.componentId ? sentenceLine('Component', thread.componentId) : '',",
    "    thread.branchName ? sentenceLine('Branch', thread.branchName) : '',",
    "    thread.workItemId ? sentenceLine('Work item', thread.workItemId) : '',",
    "    thread.hostId ? sentenceLine('Host', thread.hostId) : '',",
    "    'Inspect the current workspace state, preserve unrelated changes, and recommend the next safe action.'",
    "  ].filter(Boolean);",
    "  return lines.join('\\n');",
    "}",
    "",
    "function detailPrompt(detail) {",
    "  const lines = [",
    "    sentenceLine('Continue cockpit item', detail.title),",
    "    sentenceLine('Status', factValue(detail.facts, 'Status')),",
    "    sentenceLine('Type', factValue(detail.facts, 'Type')),",
    "    sentenceLine('Reason', detail.body),",
    "    'Inspect the current workspace state, preserve unrelated changes, and recommend the next safe action.'",
    "  ].filter(Boolean);",
    "  return lines.join('\\n');",
    "}",
    "",
    "function sentenceLine(label, value) {",
    "  const text = stripTerminalPunctuation(formatDisplayText(value));",
    "  return text ? `${label}: ${text}.` : '';",
    "}",
    "",
    "function stripTerminalPunctuation(value) {",
    "  return String(value ?? '').trim().replace(/([.!?,;:]+)([\"')\\]]*)$/u, '$2').trim();",
    "}",
    "",
    "function factValue(facts, label) {",
    "  return facts.find((fact) => fact[0] === label)?.[1] ?? '';",
    "}",
    "",
    "function renderPlugins(plugins) {",
    "  const records = plugins?.records ?? [];",
    "  const count = plugins ? `${plugins.enabledCount} enabled · ${plugins.capabilityCount} capabilities` : '0 enabled';",
    "  const body = records.length ? records.map(renderPluginCard).join('') : '<p>No DevNexus plugins installed.</p>';",
    "  return `<div class=\"dn-panel dn-plugin-panel\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Installed extensions</span><h2>Plugins</h2></div><span class=\"dn-count\">${escapeHtml(count)}</span></div><div class=\"dn-plugin-list\">${body}</div></div>`;",
    "}",
    "",
    "function renderPluginCard(plugin) {",
    "  const version = plugin.version ? ` · ${plugin.version}` : '';",
    "  const detail = [`${plugin.projectedSkillCount} skills`, `${plugin.mcpServerCount} MCP`, `${plugin.setupActionCount} setup`, `${plugin.dependencyProjectionCount} deps`].join(' · ');",
    "  return `<article class=\"dn-plugin-card\"><div class=\"dn-plugin-card-header\"><strong>${escapeHtml(plugin.name)}</strong><span class=\"dn-thread-decision decision-continue\">enabled</span></div><span class=\"dn-card-meta\">${escapeHtml(plugin.id)}${escapeHtml(version)}</span><p>${escapeHtml(detail)}</p></article>`;",
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
    "  return `<div class=\"${className}\">${visibleActions.map((action) => `<a class=\"dn-action\" href=\"${escapeHtml(action.href)}\" target=\"_blank\" rel=\"noreferrer\" aria-label=\"${escapeHtml(externalActionLabel(action))}\">${providerIcon(action.provider)}<span class=\"dn-action-label\">${escapeHtml(action.label ?? 'Open provider')}</span>${externalLinkIcon()}</a>`).join('')}</div>`;",
    "}",
    "",
    "function externalActionLabel(action) {",
    "  return `${action.label ?? 'Open provider'} (opens in a new tab)`;",
    "}",
    "",
    "function providerIcon(provider) {",
    "  if (provider === 'github') return '<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M8 .2a8 8 0 00-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-.9-2.7-.9-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.2-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8A7.4 7.4 0 018 3.7c.7 0 1.4.1 2 .3 1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.2 0 3-1.8 3.7-3.6 3.9.3.3.6.8.6 1.6v2.4c0 .2.1.5.6.4A8 8 0 008 .2z\"/></svg>';",
    "  return '<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M8 1.2a6.8 6.8 0 100 13.6A6.8 6.8 0 008 1.2zm0 1.4c.7.8 1.2 1.8 1.4 2.9H6.6C6.8 4.4 7.3 3.4 8 2.6zm-3.2.8c-.4.6-.7 1.3-.9 2.1H2.8a5.5 5.5 0 012-2.1zm8.4 2.1h-1.1c-.2-.8-.5-1.5-.9-2.1a5.5 5.5 0 012 2.1zM2.5 8c0-.4 0-.7.1-1.1h1.1a9 9 0 000 2.2H2.6c-.1-.4-.1-.7-.1-1.1zm2.6 0c0-.4 0-.7.1-1.1h5.6c.1.4.1.7.1 1.1s0 .7-.1 1.1H5.2C5.1 8.7 5.1 8.4 5.1 8zm1.5 2.5h2.8c-.2 1.1-.7 2.1-1.4 2.9-.7-.8-1.2-1.8-1.4-2.9zm4.6 2.1c.4-.6.7-1.3.9-2.1h1.1a5.5 5.5 0 01-2 2.1zm2.2-3.5h-1.1a9 9 0 000-2.2h1.1c.1.4.1.7.1 1.1s0 .7-.1 1.1zM2.8 10.5h1.1c.2.8.5 1.5.9 2.1a5.5 5.5 0 01-2-2.1z\"/></svg>';",
    "}",
    "",
    "function externalLinkIcon() {",
    "  return '<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path fill=\"none\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M6 4H3.8A1.8 1.8 0 002 5.8v6.4A1.8 1.8 0 003.8 14h6.4a1.8 1.8 0 001.8-1.8V10M9 2h5v5M8 8l5.5-5.5\"/></svg>';",
    "}",
    "",
    "function clipboardIcon() {",
    "  return '<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path fill=\"none\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M6 2.5h4M6.5 1.5h3A1.5 1.5 0 0111 3v.5H5V3a1.5 1.5 0 011.5-1.5zM4 3.5H3A1.5 1.5 0 001.5 5v8A1.5 1.5 0 003 14.5h10A1.5 1.5 0 0014.5 13V5A1.5 1.5 0 0013 3.5h-1\"/></svg>';",
    "}",
    "",
    "function chatIcon() {",
    "  return '<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path fill=\"none\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M3 3.5h10A1.5 1.5 0 0114.5 5v4A1.5 1.5 0 0113 10.5H8l-3.5 3v-3H3A1.5 1.5 0 011.5 9V5A1.5 1.5 0 013 3.5z\"/><path fill=\"none\" stroke-width=\"1.8\" stroke-linecap=\"round\" d=\"M5 6.5h6M5 8.5h3\"/></svg>';",
    "}",
    "",
    "function signalIcon(id) {",
    "  if (id === 'components') return '<svg viewBox=\"0 0 24 24\"><path d=\"M4 7l8-4 8 4-8 4-8-4z\"/><path d=\"M4 12l8 4 8-4\"/><path d=\"M4 17l8 4 8-4\"/></svg>';",
    "  if (id === 'automation') return '<svg viewBox=\"0 0 24 24\"><path d=\"M6 8a3 3 0 116 0c0 2-3 2-3 5\"/><path d=\"M18 16a3 3 0 11-6 0c0-2 3-2 3-5\"/><path d=\"M9 21v-2\"/><path d=\"M15 3v2\"/></svg>';",
    "  if (id === 'eligible-work') return '<svg viewBox=\"0 0 24 24\"><path d=\"M5 6h14\"/><path d=\"M5 12h10\"/><path d=\"M5 18h6\"/><path d=\"M17 16l2 2 4-5\"/></svg>';",
    "  if (id === 'worktrees') return '<svg viewBox=\"0 0 24 24\"><path d=\"M7 3v7a4 4 0 004 4h6\"/><path d=\"M7 21v-7\"/><circle cx=\"7\" cy=\"4\" r=\"2\"/><circle cx=\"7\" cy=\"20\" r=\"2\"/><circle cx=\"19\" cy=\"14\" r=\"2\"/></svg>';",
    "  if (id === 'blockers') return '<svg viewBox=\"0 0 24 24\"><path d=\"M12 3l10 18H2L12 3z\"/><path d=\"M12 9v5\"/><path d=\"M12 18h.01\"/></svg>';",
    "  if (id === 'plugins') return '<svg viewBox=\"0 0 24 24\"><path d=\"M8 4h8\"/><path d=\"M8 20h8\"/><path d=\"M12 4v5\"/><path d=\"M12 15v5\"/><path d=\"M5 9h14v6H5z\"/><path d=\"M7 12h.01\"/><path d=\"M17 12h.01\"/></svg>';",
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
    "  const lanes = [{ key: 'main', label: `source: ${snapshot.project.defaultBranch ?? 'main'}`, shortLabel: `source: ${snapshot.project.defaultBranch ?? 'main'}`, index: 0 }];",
    "  const seen = new Set(['main']);",
    "  const activeWorktrees = snapshot.worktrees.records.filter((worktree) => worktree.branchName);",
    "  for (const worktree of activeWorktrees) {",
    "    if (lanes.length >= 3) break;",
    "    const key = worktreeLaneKey(worktree);",
    "    if (seen.has(key)) continue;",
    "    seen.add(key);",
    "    const branch = compactBranchName(worktree.branchName ?? worktree.id);",
    "    lanes.push({ key, label: `active branch: ${branch}`, shortLabel: `work: ${branch}`, index: lanes.length });",
    "  }",
    "  lanes.push({ key: 'worktrees', label: 'other work branches', shortLabel: 'more work', index: lanes.length });",
    "  lanes.push({ key: 'cycles', label: 'target cycles and runs', shortLabel: 'cycles/runs', index: lanes.length });",
    "  lanes.push({ key: 'policy', label: 'approval and blockers', shortLabel: 'approval', index: lanes.length });",
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
    "  const detail = { title: displayTitle(node, snapshot), body: displayBody(node, snapshot), facts, events, actions };",
    "  return { ...detail, chat: detailChat(node, detail) };",
    "}",
    "",
    "function detailChat(node, detail) {",
    "  if (!node || !isActionableNode(node)) return null;",
    "  return { prompt: detailPrompt(detail), title: `Continue ${detail.title}` };",
    "}",
    "",
    "function isActionableNode(node) {",
    "  return ['authority', 'blocker', 'worktree', 'run', 'target-cycle'].includes(node.kind) || ['blocked', 'failed', 'dirty', 'missing', 'stale'].includes(node.status);",
    "}",
    "",
    "function displayTitle(node, snapshot) {",
    "  if (!node) return snapshot.project.name;",
    "  if (node.kind === 'run') return statusTitle('Run', node.status);",
    "  if (node.kind === 'target-cycle') return statusTitle('Cycle', node.status);",
    "  if (node.kind === 'authority') return 'Approval';",
    "  return node.label;",
    "}",
    "",
    "function displayBody(node, snapshot) {",
    "  if (!node) return snapshot.summary;",
    "  if (node.kind === 'authority') return node.detail || 'A provider action needs approval before automation can continue.';",
    "  if (node.kind === 'blocker') return readableBlocker(node.detail);",
    "  return node.detail ?? snapshot.summary;",
    "}",
    "",
    "function displayKind(node) {",
    "  if (!node) return 'unknown';",
    "  if (node.kind === 'target-cycle') return 'target cycle';",
    "  if (node.kind === 'work-item') return 'work item';",
    "  if (node.kind === 'authority') return 'approval';",
    "  return node.kind;",
    "}",
    "",
    "function displayLane(value) {",
    "  if (value === 'Authority' || value === 'authority') return 'Approval';",
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
    "  return formatDisplayText(text.replace(/lease-[0-9a-f]+/giu, 'a stale work record').replace(/codex\\/[A-Za-z0-9/_-]+/gu, 'a work branch'));",
    "}",
    "",
    "function signalDetail(snapshot, id) {",
    "  const signal = snapshot.signals.find((candidate) => `signal:${candidate.id}` === id) ?? snapshot.signals[0];",
    "  if (id === 'signal:worktrees' && snapshot.threads) return { title: 'Threads', body: 'Open work threads are shown in Action Needed.', facts: [['Open', String(snapshot.threads.totalCount)], ['Needs review', String(snapshot.threads.needsDecisionCount)]], events: [], actions: [], chat: null };",
    "  const events = id === 'signal:blockers' ? snapshot.events.filter((event) => event.id.startsWith('blocker-')).slice(0, 3) : snapshot.events.slice(0, 2);",
    "  return { title: signal?.label ?? 'Signal', body: signal?.detail ?? snapshot.summary, facts: [['Value', signal?.value ?? 'unknown'], ['Tone', signal?.tone ?? 'neutral'], ['Project', snapshot.project.name]], events, actions: uniqueActions(events.flatMap((event) => event.actions ?? [])), chat: null };",
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
    "      facts.push(['Work item', worktree.workItemId ?? 'none']);",
    "      facts.push(['Branch', worktree.branchName ?? 'none']);",
    "      facts.push(['Host', worktree.hostId]);",
    "      facts.push(['Updated', formatTime(worktree.updatedAt)]);",
    "    }",
    "  }",
    "  if (node.kind === 'authority' && snapshot.authority) {",
    "    facts.push(['Components', String(snapshot.authority.components.length)]);",
    "    facts.push(['Blocked actions', String(snapshot.authority.blockedActionCount)]);",
    "    facts.push(['Approvals', String(snapshot.authority.fallbackActionCount)]);",
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
    "function normalizeWorkspaceId(value) {",
    "  return String(value ?? '').trim();",
    "}",
    "",
    "function readWorkspaceIdFromLocation() {",
    "  try {",
    "    if (typeof window === 'undefined') return '';",
    "    return new URL(window.location.href).searchParams.get('workspace') ?? '';",
    "  } catch {",
    "    return '';",
    "  }",
    "}",
    "",
    "function writeWorkspaceIdToLocation(workspaceId) {",
    "  try {",
    "    if (typeof window === 'undefined' || !window.history?.replaceState) return;",
    "    const url = new URL(window.location.href);",
    "    const id = normalizeWorkspaceId(workspaceId);",
    "    if (id) url.searchParams.set('workspace', id);",
    "    else url.searchParams.delete('workspace');",
    "    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);",
    "  } catch {",
    "    // Embedded dashboards may not expose a mutable location.",
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
    "  if (/No resolved auth profile is available for publication action provider\\.pull_request\\.open/iu.test(text)) return 'No bot credential is available for opening a pull request. Approval is required.';",
    "  return text.replace(/provider\\.pull_request\\.open/gu, 'opening a pull request').replace(/coordination\\.handoff/gu, 'approval').replace(/advisory worktree lease/giu, 'advisory thread record').replace(/worktree lease/giu, 'thread record').replace(/human approval/giu, 'approval');",
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
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  codexChatStarter: NexusDashboardCodexChatStarter,
  actionToken: string,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  if (method === "POST" && url.pathname === "/api/codex/thread") {
    await routeCodexThreadStart(
      request,
      response,
      snapshotOptions,
      codexChatStarter,
      actionToken,
      url,
    );
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, {
      "content-type": "application/json; charset=utf-8",
      allow: "GET, HEAD, POST",
    });
    response.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return;
  }

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      sendText(
        response,
        "text/html; charset=utf-8",
        renderNexusDashboardHtml({ actionToken }),
      );
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
      const selection = await resolveDashboardWorkspaceSelection(
        snapshotOptions,
        workspaceIdFromUrl(url),
      );
      sendJson(response, await buildNexusDashboardSnapshot(selection.snapshotOptions));
      return;
    }
    if (url.pathname === "/api/host") {
      sendJson(
        response,
        await buildDashboardHostForRequest(snapshotOptions, workspaceIdFromUrl(url)),
      );
      return;
    }
    if (url.pathname === "/api/weave") {
      const selection = await resolveDashboardWorkspaceSelection(
        snapshotOptions,
        workspaceIdFromUrl(url),
      );
      const snapshot = await buildNexusDashboardSnapshot(selection.snapshotOptions);
      sendJson(response, snapshot.weave);
      return;
    }
    if (url.pathname === "/api/events") {
      const selection = await resolveDashboardWorkspaceSelection(
        snapshotOptions,
        workspaceIdFromUrl(url),
      );
      const snapshot = await buildNexusDashboardSnapshot(selection.snapshotOptions);
      sendJson(response, { events: snapshot.events });
      return;
    }
    if (url.pathname === "/api/projects") {
      const host = await buildDashboardHostForRequest(
        snapshotOptions,
        workspaceIdFromUrl(url),
      );
      sendJson(response, { projects: host.workspaces });
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: "not_found" }));
  } catch (error) {
    sendJson(response, dashboardErrorBody(error), dashboardErrorStatusCode(error));
  }
}

async function routeCodexThreadStart(
  request: IncomingMessage,
  response: ServerResponse,
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  codexChatStarter: NexusDashboardCodexChatStarter,
  actionToken: string,
  url: URL,
): Promise<void> {
  try {
    requireDashboardMutationRequest(request, actionToken);
    const workspaceId = workspaceIdFromUrl(url);
    const body = await readJsonBody(request);
    const prompt = requiredStringField(body, "prompt");
    const title = optionalStringField(body, "title");
    const targetId = optionalStringField(body, "targetId");
    rejectClientControlledField(body, "profileId");
    rejectClientControlledField(body, "projectRoot");
    rejectClientControlledField(body, "workspaceRoot");
    rejectClientControlledField(body, "cwd");
    rejectClientControlledField(body, "threadId");
    rejectClientControlledField(body, "assistantThreadId");
    const selection = await resolveDashboardWorkspaceSelection(
      snapshotOptions,
      workspaceId,
    );
    const resumeThreadId = targetId
      ? await resolveDashboardResumeThreadId(selection.snapshotOptions, targetId)
      : null;
    const result = await codexChatStarter.start({
      projectRoot: selection.snapshotOptions.projectRoot,
      prompt,
      ...(title ? { title } : {}),
      ...(resumeThreadId ? { threadId: resumeThreadId } : {}),
    });
    sendJson(response, { ok: true, result }, 201);
  } catch (error) {
    sendJson(response, dashboardErrorBody(error), dashboardErrorStatusCode(error));
  }
}

function workspaceIdFromUrl(url: URL): string | null {
  if (!url.searchParams.has("workspace")) {
    return null;
  }
  const workspaceId = url.searchParams.get("workspace")?.trim() ?? "";
  if (!workspaceId) {
    throw new NexusDashboardRouteError(
      "invalid_workspace",
      "workspace must be a non-empty host workspace id",
      400,
    );
  }
  return workspaceId;
}

async function resolveDashboardWorkspaceSelection(
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  workspaceId: string | null,
): Promise<DashboardWorkspaceSelection> {
  if (!workspaceId) {
    if (!snapshotOptions.projectRoot) {
      throw new NexusDashboardRouteError(
        "workspace_required",
        "A workspace id is required for workspace dashboard data when the server was started in host mode",
        400,
      );
    }
    return {
      snapshotOptions: {
        ...snapshotOptions,
        projectRoot: path.resolve(snapshotOptions.projectRoot),
      },
    };
  }

  const baseHost = await buildNexusDashboardHostSnapshot(snapshotOptions);
  const matches = baseHost.workspaces.filter((workspace) =>
    workspace.id === workspaceId
  );
  if (matches.length === 0) {
    throw new NexusDashboardRouteError(
      "workspace_not_found",
      `Workspace ${workspaceId} is not registered on this host`,
      404,
    );
  }
  if (matches.length > 1) {
    throw new NexusDashboardRouteError(
      "ambiguous_workspace",
      `Workspace ${workspaceId} matched multiple host workspaces`,
      409,
    );
  }

  return {
    snapshotOptions: {
      ...snapshotOptions,
      projectRoot: path.resolve(matches[0]!.root),
    },
    baseHost,
  };
}

async function buildDashboardHostForRequest(
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  workspaceId: string | null,
): Promise<NexusDashboardHostSnapshot> {
  if (!workspaceId) {
    return buildNexusDashboardHostSnapshot(snapshotOptions);
  }
  const selection = await resolveDashboardWorkspaceSelection(
    snapshotOptions,
    workspaceId,
  );
  const selectedHost = await buildNexusDashboardHostSnapshot(
    selection.snapshotOptions,
  );
  if (!selection.baseHost) {
    return selectedHost;
  }

  return mergeDashboardHostSnapshots(selectedHost, selection.baseHost);
}

function mergeDashboardHostSnapshots(
  selectedHost: NexusDashboardHostSnapshot,
  baseHost: NexusDashboardHostSnapshot,
): NexusDashboardHostSnapshot {
  const workspaceByRoot = new Map<string, NexusDashboardHostWorkspaceRecord>();
  for (const workspace of selectedHost.workspaces) {
    workspaceByRoot.set(path.resolve(workspace.root), workspace);
  }
  for (const workspace of baseHost.workspaces) {
    const key = path.resolve(workspace.root);
    if (workspaceByRoot.has(key)) {
      continue;
    }
    workspaceByRoot.set(key, { ...workspace, current: false });
  }

  const workspaces = [...workspaceByRoot.values()].sort((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  return {
    ...selectedHost,
    workspaceCount: workspaces.length,
    needsAttentionCount: workspaces.filter((workspace) =>
      workspace.tone === "danger" || workspace.tone === "warn"
    ).length,
    actionQueue: buildNexusDashboardHostActionQueue(workspaces),
    workspaces,
  };
}

function dashboardErrorStatusCode(error: unknown): number {
  if (
    error instanceof NexusDashboardRouteError ||
    error instanceof NexusDashboardCodexChatError
  ) {
    return error.statusCode;
  }
  return 500;
}

function dashboardErrorBody(error: unknown): unknown {
  return {
    ok: false,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof NexusDashboardRouteError
        ? { code: error.code }
        : {}),
    },
  };
}

async function resolveDashboardResumeThreadId(
  snapshotOptions: BuildNexusDashboardSnapshotOptions,
  targetId: string,
): Promise<string | null> {
  if (!targetId.startsWith("thread:")) {
    return null;
  }
  const threadRecordId = targetId.slice("thread:".length);
  if (!threadRecordId) {
    return null;
  }
  const snapshot = await buildNexusDashboardSnapshot(snapshotOptions);
  return snapshot.threads.records.find((record) => record.id === threadRecordId)
    ?.assistantThreadId ?? null;
}

function requireDashboardMutationRequest(
  request: IncomingMessage,
  actionToken: string,
): void {
  const contentType = request.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !contentType.toLowerCase().split(";").some((part) =>
      part.trim() === "application/json"
    )
  ) {
    throw new NexusDashboardCodexChatError(
      "Content-Type must be application/json",
      415,
    );
  }

  const suppliedToken = request.headers["x-dev-nexus-action-token"];
  if (suppliedToken !== actionToken) {
    throw new NexusDashboardCodexChatError(
      "Dashboard action token is missing or invalid",
      403,
    );
  }

  const origin = request.headers.origin;
  if (typeof origin === "string") {
    const requestHost = request.headers.host;
    const originHost = safeOriginHost(origin);
    if (!requestHost || originHost !== requestHost) {
      throw new NexusDashboardCodexChatError(
        "Dashboard action origin is not allowed",
        403,
      );
    }
  }
}

function sendJson(
  response: ServerResponse,
  value: unknown,
  statusCode = 200,
): void {
  sendText(
    response,
    "application/json; charset=utf-8",
    JSON.stringify(value, null, 2),
    statusCode,
  );
}

function sendText(
  response: ServerResponse,
  contentType: string,
  body: string,
  statusCode = 200,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (Buffer.byteLength(body, "utf8") > maxBytes) {
      throw new NexusDashboardCodexChatError(
        "Request body is too large",
        413,
      );
    }
  }
  if (!body.trim()) {
    throw new NexusDashboardCodexChatError(
      "Request body must be JSON",
      400,
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new NexusDashboardCodexChatError(
      "Request body must be valid JSON",
      400,
    );
  }
}

function requiredStringField(value: unknown, fieldName: string): string {
  const record = plainRecord(value);
  const field = record[fieldName];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new NexusDashboardCodexChatError(
      `${fieldName} must be a non-empty string`,
      400,
    );
  }

  return field.trim();
}

function optionalStringField(
  value: unknown,
  fieldName: string,
): string | undefined {
  const record = plainRecord(value);
  const field = record[fieldName];
  if (field === undefined || field === null || field === "") {
    return undefined;
  }
  if (typeof field !== "string") {
    throw new NexusDashboardCodexChatError(
      `${fieldName} must be a string`,
      400,
    );
  }

  return field.trim() || undefined;
}

function rejectClientControlledField(
  value: unknown,
  fieldName: string,
): void {
  const record = plainRecord(value);
  if (record[fieldName] !== undefined && record[fieldName] !== null) {
    throw new NexusDashboardCodexChatError(
      `${fieldName} is server-controlled for dashboard chat actions`,
      400,
    );
  }
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusDashboardCodexChatError(
      "Request body must be a JSON object",
      400,
    );
  }

  return value as Record<string, unknown>;
}

function safeOriginHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
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

function safeJsonString(value: string): string {
  return JSON.stringify(value).replace(/<\/script/giu, "<\\/script");
}
