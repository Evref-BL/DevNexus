import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildNexusDashboardHostActionQueue,
  buildNexusDashboardHostProjectIndex,
  buildNexusDashboardHostSnapshot,
  buildNexusDashboardSnapshot,
  buildNexusDashboardWorkspaceSection,
  buildNexusDashboardWorkspaceShell,
  nexusDashboardEmbeddingContract,
  nexusDashboardHostWorkspaceReferenceMatches,
  recordNexusDashboardThreadResolution,
  type BuildNexusDashboardHostSnapshotOptions,
  type BuildNexusDashboardSnapshotOptions,
  type NexusDashboardEmbeddingContract,
  type NexusDashboardHostSnapshot,
  type NexusDashboardHostWorkspaceRecord,
  type NexusDashboardSnapshot,
  type NexusDashboardWorkspaceSectionId,
  type NexusDashboardThreadResolutionAction,
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
  currentProjectRoot?: string | null;
  host?: string;
  port?: number;
  homePath?: string;
  env?: BuildNexusDashboardSnapshotOptions["env"];
  credentialResolver?: BuildNexusDashboardSnapshotOptions["credentialResolver"];
  provider?: BuildNexusDashboardSnapshotOptions["provider"];
  providerFactory?: BuildNexusDashboardSnapshotOptions["providerFactory"];
  providerOptions?: BuildNexusDashboardSnapshotOptions["providerOptions"];
  eligibleWorkMode?: NexusEligibleWorkMode;
  gitRunner?: GitRunner;
  now?: () => Date | string;
  codexChatStarter?: NexusDashboardCodexChatStarter;
  localResourceOpener?: NexusDashboardLocalResourceOpener;
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
  readonly workspaceId: string | null;
}

type NexusDashboardWorkspacePayload = Omit<
  NexusDashboardSnapshot,
  "automation" | "eligibleWork" | "targetReport"
>;

interface NexusDashboardDiagnosticsPayload {
  version: 1;
  contract: NexusDashboardEmbeddingContract;
  generatedAt: string;
  projectRoot: string;
  automation: NexusDashboardSnapshot["automation"];
  eligibleWork: NexusDashboardSnapshot["eligibleWork"];
  targetReport: NexusDashboardSnapshot["targetReport"];
  authority: NexusDashboardSnapshot["authority"];
  blockers: NexusDashboardSnapshot["blockers"];
  publication: NexusDashboardSnapshot["publication"];
}

export type NexusDashboardLocalOpenTarget = "home" | "project";

export type NexusDashboardLocalOpenApp = "file" | "code" | "terminal";

export interface NexusDashboardLocalOpenRequest {
  target: NexusDashboardLocalOpenTarget;
  app: NexusDashboardLocalOpenApp;
  path: string;
}

export interface NexusDashboardLocalOpenResult
  extends NexusDashboardLocalOpenRequest {
  ok: boolean;
  command?: string;
  args?: string[];
  error?: string;
}

export type NexusDashboardLocalResourceOpener = (
  request: NexusDashboardLocalOpenRequest,
) => Promise<NexusDashboardLocalOpenResult>;

interface DashboardThreadActionContext {
  threadId: string | null;
  cwd: string | null;
}

interface DashboardCachePolicy {
  readonly freshMs: number;
  readonly staleMs: number;
}

interface DashboardCacheEntry<T> {
  readonly value?: T;
  readonly freshUntil: number;
  readonly staleUntil: number;
  pending?: Promise<T>;
}

interface NexusDashboardServerCache {
  readonly entries: Map<string, DashboardCacheEntry<unknown>>;
}

const dashboardCachePolicies = {
  host: { freshMs: 60_000, staleMs: 300_000 },
  projectIndex: { freshMs: 15_000, staleMs: 120_000 },
  workspace: { freshMs: 60_000, staleMs: 300_000 },
  shell: { freshMs: 10_000, staleMs: 60_000 },
  section: { freshMs: 30_000, staleMs: 180_000 },
} satisfies Record<string, DashboardCachePolicy>;

interface NexusDashboardLocalAppIcon {
  readonly body: Buffer | string;
  readonly contentType: string;
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

function createDashboardServerCache(): NexusDashboardServerCache {
  return { entries: new Map() };
}

function invalidateDashboardCache(cache: NexusDashboardServerCache): void {
  cache.entries.clear();
}

async function cachedDashboardValue<T>(
  cache: NexusDashboardServerCache,
  key: string,
  policy: DashboardCachePolicy,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const entry = cache.entries.get(key) as DashboardCacheEntry<T> | undefined;

  if (entry?.value !== undefined && now < entry.freshUntil) {
    return entry.value;
  }

  if (entry?.value !== undefined && now < entry.staleUntil) {
    if (!entry.pending) {
      entry.pending = load()
        .then((value) => {
          cache.entries.set(
            key,
            dashboardCacheEntry(value, policy) as DashboardCacheEntry<unknown>,
          );
          return value;
        })
        .catch(() => entry.value as T)
        .finally(() => {
          const latest = cache.entries.get(key);
          if (latest === entry) {
            delete entry.pending;
          }
        });
    }
    return entry.value;
  }

  if (entry?.pending) {
    return entry.pending;
  }

  const pending = load()
    .then((value) => {
      cache.entries.set(
        key,
        dashboardCacheEntry(value, policy) as DashboardCacheEntry<unknown>,
      );
      return value;
    })
    .catch((error: unknown) => {
      if (entry?.value !== undefined) {
        cache.entries.set(
          key,
          dashboardCacheEntry(entry.value, {
            freshMs: 0,
            staleMs: policy.staleMs,
          }) as DashboardCacheEntry<unknown>,
        );
        return entry.value;
      }
      cache.entries.delete(key);
      throw error;
    });
  cache.entries.set(key, {
    value: entry?.value,
    freshUntil: 0,
    staleUntil: entry?.staleUntil ?? 0,
    pending,
  } as DashboardCacheEntry<unknown>);
  return pending;
}

function dashboardCacheEntry<T>(
  value: T,
  policy: DashboardCachePolicy,
): DashboardCacheEntry<T> {
  const now = Date.now();
  return {
    value,
    freshUntil: now + policy.freshMs,
    staleUntil: now + policy.staleMs,
  };
}

function dashboardWorkspaceCacheKey(
  kind: string,
  selection: DashboardWorkspaceSelection,
): string {
  return [
    "workspace",
    kind,
    selection.workspaceId ?? "",
    path.resolve(selection.snapshotOptions.projectRoot),
    dashboardSnapshotOptionsCacheKey(selection.snapshotOptions),
  ].join(":");
}

function dashboardHostCacheKey(
  kind: string,
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  workspaceId: string | null,
): string {
  return [
    "host",
    kind,
    workspaceId ?? "",
    dashboardSnapshotOptionsCacheKey(snapshotOptions),
  ].join(":");
}

function dashboardSnapshotOptionsCacheKey(
  options: BuildNexusDashboardHostSnapshotOptions,
): string {
  return JSON.stringify({
    projectRoot: options.projectRoot ? path.resolve(options.projectRoot) : null,
    currentProjectRoot:
      options.currentProjectRoot === undefined
        ? undefined
        : options.currentProjectRoot
          ? path.resolve(options.currentProjectRoot)
          : null,
    homePath: options.homePath ? path.resolve(options.homePath) : null,
    eligibleWorkMode: options.eligibleWorkMode ?? null,
  });
}

export async function startNexusDashboardServer(
  options: StartNexusDashboardServerOptions,
): Promise<NexusDashboardServerHandle> {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : null;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const snapshotOptions: BuildNexusDashboardHostSnapshotOptions = {
    ...(projectRoot ? { projectRoot } : {}),
    ...(options.currentProjectRoot !== undefined
      ? { currentProjectRoot: options.currentProjectRoot }
      : {}),
    homePath: options.homePath,
    env: options.env,
    credentialResolver: options.credentialResolver,
    provider: options.provider,
    providerFactory: options.providerFactory,
    providerOptions: options.providerOptions,
    eligibleWorkMode: options.eligibleWorkMode,
    gitRunner: options.gitRunner,
    now: options.now,
  };
  const codexChatStarter =
    options.codexChatStarter ?? createNexusDashboardCodexChatStarter();
  const localResourceOpener =
    options.localResourceOpener ?? openDashboardLocalResource;
  const actionToken = randomBytes(24).toString("base64url");
  const dashboardCache = createDashboardServerCache();
  const server = http.createServer((request, response) => {
    void routeDashboardRequest(
      request,
      response,
      snapshotOptions,
      codexChatStarter,
      localResourceOpener,
      actionToken,
      dashboardCache,
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
    ":root[data-dev-nexus-theme='light'] { color-scheme: light; --dn-bg: #f5f8f6; --dn-surface: #ffffff; --dn-surface-raised: #edf3ef; --dn-surface-muted: rgba(235, 242, 238, 0.86); --dn-weave-bg: rgba(236, 244, 241, 0.9); --dn-text: #16231b; --dn-strong: #0f1813; --dn-muted: #55685d; --dn-label: #687d71; --dn-border: rgba(42, 73, 55, 0.18); --dn-border-muted: rgba(42, 73, 55, 0.12); --dn-border-strong: rgba(42, 73, 55, 0.28); --dn-pill-text: #27372e; --dn-control-active: #dcebe3; --dn-control-hover: rgba(42, 73, 55, 0.08); --dn-good: #167f53; --dn-active: #265dcc; --dn-warn: #d89400; --dn-warn-soft: #8c5b00; --dn-danger: #bc3b2f; --dn-neutral: #526459; }",
    ":root { --dn-grid-line: rgba(180, 210, 188, 0.055); --dn-shadow: 0 22px 60px rgba(0, 0, 0, 0.28); --dn-branch-0: #ff4d4f; --dn-branch-1: #ff9f0a; --dn-branch-2: #f6d64a; --dn-branch-3: #35dd54; --dn-branch-4: #17d6cf; --dn-branch-5: #1aa7ff; --dn-branch-6: #b68cff; --dn-branch-faint: rgba(238, 245, 236, 0.16); }",
    ":root[data-dev-nexus-theme='light'] { --dn-grid-line: rgba(31, 115, 93, 0.085); --dn-shadow: 0 18px 40px rgba(34, 50, 42, 0.1); --dn-branch-0: #d22f2f; --dn-branch-1: #b66100; --dn-branch-2: #9d7600; --dn-branch-3: #168e35; --dn-branch-4: #008a84; --dn-branch-5: #0076c9; --dn-branch-6: #6a3fd6; --dn-branch-faint: rgba(22, 35, 27, 0.14); }",
    "@media (prefers-color-scheme: light) { :root:not([data-dev-nexus-theme]) { color-scheme: light; --dn-bg: #f5f8f6; --dn-surface: #ffffff; --dn-surface-raised: #edf3ef; --dn-surface-muted: rgba(235, 242, 238, 0.86); --dn-weave-bg: rgba(236, 244, 241, 0.9); --dn-text: #16231b; --dn-strong: #0f1813; --dn-muted: #55685d; --dn-label: #687d71; --dn-border: rgba(42, 73, 55, 0.18); --dn-border-muted: rgba(42, 73, 55, 0.12); --dn-border-strong: rgba(42, 73, 55, 0.28); --dn-pill-text: #27372e; --dn-control-active: #dcebe3; --dn-control-hover: rgba(42, 73, 55, 0.08); --dn-good: #167f53; --dn-active: #265dcc; --dn-warn: #d89400; --dn-warn-soft: #8c5b00; --dn-danger: #bc3b2f; --dn-neutral: #526459; } }",
    "* { box-sizing: border-box; }",
    "body { margin: 0; min-width: 320px; color: var(--dn-text); background: var(--dn-bg); }",
    "@keyframes dn-spin { to { transform: rotate(360deg); } }",
    "@keyframes dn-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }",
    "button, input, select { font: inherit; }",
    ".dn-shell { width: min(1520px, 100%); margin: 0 auto; padding: 24px; }",
    ".dn-header { position: relative; z-index: 2; display: grid; grid-template-columns: minmax(260px, 1fr) minmax(0, 760px); gap: 24px; align-items: end; min-height: 190px; overflow: visible; padding: 32px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); box-shadow: var(--dn-shadow); }",
    ".dn-header::before { content: ''; position: absolute; inset: 0 0 auto; height: 5px; border-radius: 8px 8px 0 0; background: linear-gradient(90deg, var(--dn-branch-0), var(--dn-branch-1), var(--dn-branch-2), var(--dn-branch-3), var(--dn-branch-4), var(--dn-branch-5), var(--dn-branch-6)); }",
    ".dn-eyebrow { display: block; margin: 0 0 12px; color: var(--dn-good); font-size: 0.76rem; font-weight: 850; text-transform: uppercase; }",
    ".dn-header h1 { margin: 0 0 10px; font-size: clamp(2.1rem, 3vw, 3.25rem); line-height: 1.02; letter-spacing: 0; }",
    ".dn-header p { margin: 0; color: var(--dn-muted); }",
    ".dn-header-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; justify-content: flex-end; min-width: 0; }",
    ".dn-host-header-actions, .dn-project-header-actions { width: min(100%, 760px); }",
    ".dn-header-strip { display: flex; flex: 1 1 520px; flex-wrap: wrap; align-items: stretch; justify-content: flex-end; gap: 8px; min-width: 0; }",
    ".dn-header-pill { display: grid; gap: 3px; min-height: 46px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--dn-active) 22%, var(--dn-border)); border-radius: 8px; background: var(--dn-surface-raised); }",
    ".dn-header-pill span { color: var(--dn-label); font-size: 0.68rem; font-weight: 850; text-transform: uppercase; }",
    ".dn-header-pill strong { min-width: 0; color: var(--dn-strong); font-size: 0.86rem; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-host-identity { min-width: 108px; }",
    ".dn-header-stamp { min-width: 136px; }",
    ".dn-header-path-menu { flex: 0 1 auto; width: fit-content; min-width: min(100%, 320px); max-width: min(100%, 520px); }",
    ".dn-header-path-control { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; max-width: 100%; min-height: 52px; padding: 8px 8px 8px 10px; border: 1px solid color-mix(in srgb, var(--dn-active) 22%, var(--dn-border)); border-radius: 8px; color: var(--dn-strong); background: var(--dn-surface-raised); cursor: pointer; }",
    ".dn-header-path-control:hover { border-color: color-mix(in srgb, var(--dn-border-strong) 46%, var(--dn-active) 54%); background: var(--dn-control-hover); }",
    ".dn-header-path-copy { display: grid; gap: 3px; min-width: 0; }",
    ".dn-header-path-label { color: var(--dn-label); font-size: 0.68rem; font-weight: 850; line-height: 1; text-transform: uppercase; }",
    ".dn-header-path-value { min-width: 0; color: var(--dn-strong); font-size: 0.86rem; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-meta { display: grid; gap: 6px; min-width: 250px; padding: 12px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-meta span, .dn-label, .dn-table th { color: var(--dn-label); font-size: 0.76rem; font-weight: 800; text-transform: uppercase; }",
    ".dn-meta strong { color: var(--dn-strong); overflow-wrap: anywhere; }",
    ".dn-action { --dn-action-accent: var(--dn-active); display: inline-flex; align-items: center; justify-content: center; gap: 7px; max-width: 100%; min-height: 34px; padding: 7px 10px; border: 1px solid color-mix(in srgb, var(--dn-action-accent) 42%, var(--dn-border)); border-radius: 8px; color: var(--dn-strong); background: var(--dn-surface-raised); font-size: 0.78rem; font-weight: 850; text-decoration: none; transition: transform 120ms ease, border-color 120ms ease, background 120ms ease; cursor: pointer; }",
    ".dn-action:hover { transform: translateY(-1px); border-color: var(--dn-action-accent); background: var(--dn-control-hover); }",
    ".dn-action.kind-issue { --dn-action-accent: var(--dn-branch-2); }",
    ".dn-action.kind-pull-request { --dn-action-accent: var(--dn-branch-1); }",
    ".dn-action.provider-web { --dn-action-accent: var(--dn-branch-5); }",
    ".dn-local-action { color: var(--dn-strong); border-color: color-mix(in srgb, var(--dn-warn) 44%, var(--dn-border)); background: var(--dn-surface-raised); }",
    ".dn-start-action { color: var(--dn-strong); border-color: color-mix(in srgb, var(--dn-active) 52%, var(--dn-border)); background: var(--dn-surface-raised); }",
    ".dn-local-action[data-copied='true'] { border-color: var(--dn-good); background: var(--dn-control-hover); }",
    ".dn-action:disabled { opacity: 0.72; cursor: wait; transform: none; }",
    ".dn-action:disabled:hover { transform: none; }",
    ".dn-policy-action:disabled { --dn-action-accent: var(--dn-neutral); opacity: 0.78; cursor: not-allowed; background: var(--dn-surface-raised); }",
    ".dn-action svg { flex: 0 0 auto; width: 14px; height: 14px; fill: currentColor; stroke: currentColor; }",
    ".dn-action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-action-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }",
    ".dn-action-strip.compact { margin-top: 0; }",
    ".dn-action-strip.compact .dn-action { min-height: 28px; padding: 5px 8px; font-size: 0.72rem; }",
    ".dn-open-menu { position: relative; justify-self: end; }",
    ".dn-open-menu summary { list-style: none; }",
    ".dn-open-menu summary::-webkit-details-marker { display: none; }",
    ".dn-open-trigger { --dn-action-accent: var(--dn-active); justify-content: space-between; min-width: 94px; min-height: 38px; gap: 7px; padding: 5px 5px 5px 10px; border-color: color-mix(in srgb, var(--dn-border-strong) 78%, var(--dn-active) 22%); background: var(--dn-surface-raised); box-shadow: none; }",
    ".dn-open-trigger:hover { transform: none; border-color: color-mix(in srgb, var(--dn-border-strong) 46%, var(--dn-active) 54%); background: var(--dn-control-hover); }",
    ".dn-open-menu[open] .dn-open-trigger, .dn-open-menu[open] .dn-header-path-control { border-color: color-mix(in srgb, var(--dn-border-strong) 34%, var(--dn-active) 66%); background: var(--dn-surface-raised); }",
    ".dn-open-chevron-shell { display: inline-grid; place-items: center; width: 28px; height: 28px; margin-left: 2px; border-left: 1px solid color-mix(in srgb, var(--dn-border-strong) 70%, transparent); border-radius: 6px; color: var(--dn-muted); background: color-mix(in srgb, var(--dn-surface-raised) 84%, transparent); }",
    ".dn-open-chevron { opacity: 0.92; transition: transform 140ms ease, color 140ms ease; }",
    ".dn-open-menu[open] .dn-open-chevron { transform: rotate(180deg); color: var(--dn-strong); }",
    ".dn-open-options { position: absolute; right: 0; z-index: 10; display: grid; gap: 4px; min-width: 164px; margin-top: 6px; padding: 7px; border: 1px solid var(--dn-border); border-radius: 8px; background: color-mix(in srgb, var(--dn-surface) 96%, var(--dn-bg) 4%); box-shadow: var(--dn-shadow); }",
    ".dn-open-option { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px; border: 0; border-radius: 6px; color: var(--dn-strong); background: transparent; text-align: left; cursor: pointer; }",
    ".dn-open-option:hover { background: var(--dn-control-hover); }",
    ".dn-open-option:disabled { opacity: 0.7; cursor: wait; }",
    ".dn-open-option svg, .dn-open-trigger svg, .dn-header-path-control svg { flex: 0 0 auto; width: 16px; height: 16px; }",
    ".dn-open-option svg:not(.dn-app-icon), .dn-open-trigger svg, .dn-header-path-control svg:not(.dn-app-icon) { stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }",
    ".dn-app-icon { overflow: visible; } .dn-app-icon path, .dn-app-icon rect { stroke: none; } .dn-app-icon-vscode path { fill: #2f80ed; } .dn-app-icon-finder .finder-left { fill: #5bb6ff; } .dn-app-icon-finder .finder-right { fill: #dbeeff; } .dn-app-icon-finder path { stroke: #123354; stroke-width: 0.75; fill: none; } .dn-app-icon-terminal rect { fill: #24272e; } .dn-app-icon-terminal path { stroke: #d7f7df; stroke-width: 1.35; fill: none; stroke-linecap: round; stroke-linejoin: round; }",
    ".dn-app-icon-shell { display: inline-grid; place-items: center; flex: 0 0 auto; width: 16px; height: 16px; }",
    ".dn-app-icon-shell > * { grid-area: 1 / 1; }",
    ".dn-app-icon-img { position: relative; z-index: 1; width: 16px; height: 16px; border-radius: 3px; object-fit: contain; opacity: 0; }",
    ".dn-open-option .dn-action-label { display: block; }",
    ".dn-theme-toggle { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-theme-toggle button { min-width: 66px; min-height: 32px; padding: 0 10px; border: 0; border-radius: 6px; color: var(--dn-muted); background: transparent; cursor: pointer; font-size: 0.82rem; font-weight: 800; }",
    ".dn-theme-toggle button:hover { color: var(--dn-text); background: var(--dn-control-hover); }",
    ".dn-theme-toggle button[aria-pressed='true'] { color: var(--dn-strong); background: var(--dn-control-active); box-shadow: 0 0 0 1px var(--dn-border-strong) inset; }",
    ".dn-signals { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }",
    ".dn-signal, .dn-panel { border: 1px solid var(--dn-border); border-radius: 8px; background: var(--dn-surface); }",
    ".dn-signal { --dn-signal-accent: var(--dn-neutral); position: relative; min-height: 112px; overflow: hidden; padding: 12px; border-color: color-mix(in srgb, var(--dn-signal-accent) 38%, var(--dn-border)); color: inherit; background: var(--dn-surface); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }",
    ".dn-signal::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: var(--dn-signal-accent); }",
    ".dn-signal.signal-components { --dn-signal-accent: #58d68d; } .dn-signal.signal-automation { --dn-signal-accent: #79a7ff; } .dn-signal.signal-eligible-work { --dn-signal-accent: #35d6c6; } .dn-signal.signal-worktrees { --dn-signal-accent: #e4b15f; } .dn-signal.signal-blockers { --dn-signal-accent: #ff8b78; } .dn-signal.signal-plugins { --dn-signal-accent: #b68cff; }",
    ".dn-signal:hover, .dn-component-card:hover, .dn-event:hover, .dn-blocker:hover { transform: translateY(-1px); }",
    ".dn-signal.selected, .dn-component-card.selected, .dn-event.selected, .dn-blocker.selected, .dn-history-item.selected, .dn-git-history-row.selected { border-color: var(--dn-active); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-active) 18%, transparent) inset; }",
    ".dn-signal-top, .dn-card-title, .dn-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }",
    ".dn-host-panel { margin: 16px 0; background: var(--dn-surface); }",
    ".dn-workspace-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }",
    ".dn-workspace-card { --dn-workspace-accent: var(--dn-neutral); display: grid; gap: 7px; min-width: 0; padding: 11px; border: 1px solid color-mix(in srgb, var(--dn-workspace-accent) 34%, var(--dn-border)); border-left: 5px solid var(--dn-workspace-accent); border-radius: 8px; color: inherit; background: var(--dn-surface); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }",
    ".dn-workspace-card:hover { transform: translateY(-1px); border-color: var(--dn-workspace-accent); background: var(--dn-control-hover); }",
    ".dn-workspace-card.selected { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-workspace-accent) 26%, transparent) inset; }",
    ".dn-workspace-card.current-workspace { border-color: color-mix(in srgb, var(--dn-active) 58%, var(--dn-workspace-accent)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-active) 20%, transparent) inset; }",
    ".dn-workspace-card.tone-good { --dn-workspace-accent: var(--dn-good); } .dn-workspace-card.tone-active { --dn-workspace-accent: var(--dn-active); } .dn-workspace-card.tone-warn { --dn-workspace-accent: var(--dn-warn); } .dn-workspace-card.tone-danger { --dn-workspace-accent: var(--dn-danger); }",
    ".dn-workspace-card strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-workspace-card p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.8rem; }",
    ".dn-workspace-current-badge { flex: 0 0 auto; padding: 4px 7px; border: 1px solid color-mix(in srgb, var(--dn-active) 72%, var(--dn-border)); border-radius: 6px; color: var(--dn-active); background: color-mix(in srgb, var(--dn-active) 14%, transparent); font-size: 0.68rem; font-weight: 900; text-transform: uppercase; white-space: nowrap; }",
    ".dn-workspace-meta { display: flex; flex-wrap: wrap; gap: 6px; }",
    ".dn-workspace-meta span { padding: 3px 6px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-raised); font-size: 0.7rem; font-weight: 800; }",
    ".dn-signal-icon { display: inline-grid; place-items: center; flex: 0 0 auto; width: 34px; height: 34px; border: 1px solid color-mix(in srgb, var(--dn-signal-accent) 36%, var(--dn-border)); border-radius: 8px; background: var(--dn-surface-raised); color: var(--dn-signal-accent); }",
    ".dn-signal-icon svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2.2; fill: none; stroke-linecap: round; stroke-linejoin: round; }",
    ".dn-dot { display: inline-block; flex: 0 0 auto; width: 10px; height: 10px; border-radius: 999px; background: currentColor; }",
    ".dn-signal strong { display: block; margin: 6px 0; color: var(--dn-strong); font-size: 1.35rem; line-height: 1; overflow-wrap: anywhere; }",
    ".dn-signal p, .dn-event p, .dn-panel p { margin: 0; color: var(--dn-muted); }",
    ".dn-signal p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.92rem; }",
    ".dn-host-signal { width: 100%; }",
    ".dn-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(340px, 0.9fr); gap: 14px; }",
    ".dn-panel { min-width: 0; padding: 16px; }",
    ".dn-panel h2 { margin: 0 0 12px; color: var(--dn-strong); font-size: 1rem; letter-spacing: 0; }",
    ".dn-pills { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0; list-style: none; }",
    ".dn-pill { padding: 7px 9px; border: 1px solid var(--dn-border); border-radius: 999px; color: var(--dn-pill-text); background: var(--dn-surface-muted); font-size: 0.82rem; font-weight: 700; }",
    ".dn-pill.warn { border-color: color-mix(in srgb, var(--dn-warn) 42%, transparent); color: var(--dn-warn-soft); }",
    ".dn-feature-list { display: grid; gap: 10px; }",
    ".dn-feature-card { --dn-feature-accent: var(--dn-active); display: grid; gap: 8px; width: 100%; min-width: 0; padding: 12px; border: 1px solid color-mix(in srgb, var(--dn-feature-accent) 36%, var(--dn-border)); border-left: 5px solid var(--dn-feature-accent); border-radius: 8px; color: inherit; background: var(--dn-surface); text-align: left; cursor: pointer; transition: border-color 140ms ease, background 140ms ease, transform 140ms ease; }",
    ".dn-feature-card:hover { transform: translateY(-1px); border-color: var(--dn-feature-accent); background: var(--dn-control-hover); }",
    ".dn-feature-card.selected { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-feature-accent) 20%, transparent) inset; }",
    ".dn-feature-card.tone-good { --dn-feature-accent: var(--dn-good); } .dn-feature-card.tone-active { --dn-feature-accent: var(--dn-active); } .dn-feature-card.tone-warn { --dn-feature-accent: var(--dn-warn); } .dn-feature-card.tone-danger { --dn-feature-accent: var(--dn-danger); } .dn-feature-card.tone-neutral { --dn-feature-accent: var(--dn-neutral); }",
    ".dn-feature-title { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }",
    ".dn-feature-title strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-feature-status { padding: 4px 7px; border: 1px solid color-mix(in srgb, var(--dn-feature-accent) 60%, var(--dn-border)); border-radius: 6px; color: var(--dn-feature-accent); background: transparent; font-size: 0.68rem; font-weight: 900; text-transform: uppercase; white-space: nowrap; }",
    ".dn-feature-card p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.84rem; }",
    ".dn-feature-meta { display: flex; flex-wrap: wrap; gap: 6px; }",
    ".dn-feature-meta span { max-width: 100%; overflow: hidden; padding: 4px 7px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-raised); font-size: 0.72rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-feature-more { padding: 8px 10px; border: 1px dashed var(--dn-border-muted); border-radius: 8px; color: var(--dn-muted); background: var(--dn-surface-muted); font-size: 0.78rem; font-weight: 800; }",
    ".dn-git-panel { background: var(--dn-surface); }",
    ".dn-git-board { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0; overflow: hidden; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-weave-bg); }",
    ".dn-git-filters { display: flex; gap: 7px; margin: 0 0 10px; overflow-x: auto; padding-bottom: 2px; }",
    ".dn-git-filter { flex: 0 0 auto; max-width: 210px; overflow: hidden; padding: 5px 8px; border: 1px solid var(--dn-border-muted); border-radius: 7px; color: var(--dn-muted); background: var(--dn-surface); cursor: pointer; font-size: 0.72rem; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-git-filter:hover { color: var(--dn-strong); border-color: var(--dn-border-strong); background: var(--dn-control-hover); }",
    ".dn-git-filter[aria-pressed='true'] { color: var(--dn-strong); border-color: var(--dn-active); background: var(--dn-control-active); }",
    ".dn-git-graph { display: block; flex: 0 0 auto; min-width: 118px; min-height: 34px; border-right: 1px solid var(--dn-border-muted); }",
    ".dn-git-graph path { fill: none; stroke-linecap: round; stroke-linejoin: round; }",
    ".dn-git-line-shadow { stroke: var(--dn-bg); stroke-width: 6; opacity: 0.42; }",
    ".dn-git-line { stroke-width: 3; opacity: 0.82; }",
    ".dn-git-rows { display: grid; min-width: 0; }",
    ".dn-git-history-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, 0.34fr) 70px; align-items: center; gap: 10px; min-height: 30px; height: 30px; padding: 0 10px; border: 0; border-bottom: 1px solid var(--dn-border-muted); color: inherit; background: transparent; text-align: left; cursor: pointer; }",
    ".dn-git-history-row:hover { background: var(--dn-control-hover); }",
    ".dn-git-history-row.selected { background: var(--dn-control-active); }",
    ".dn-git-subject { display: flex; align-items: center; gap: 8px; min-width: 0; }",
    ".dn-git-subject strong { min-width: 0; overflow: hidden; color: var(--dn-strong); font-size: 0.86rem; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-git-refs { display: inline-flex; flex: 0 1 auto; gap: 4px; max-width: 42%; overflow: hidden; }",
    ".dn-git-ref { max-width: 150px; overflow: hidden; padding: 2px 6px; border: 1px solid var(--dn-border-strong); border-left: 5px solid var(--dn-branch-color, var(--dn-active)); border-radius: 6px; color: var(--dn-pill-text); background: var(--dn-surface-raised); font-size: 0.68rem; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-git-badges { display: inline-flex; flex: 0 0 auto; gap: 4px; max-width: 38%; overflow: hidden; }",
    ".dn-git-badge { max-width: 130px; overflow: hidden; padding: 2px 6px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface); font-size: 0.66rem; font-weight: 850; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-git-badge.tone-good { border-color: color-mix(in srgb, var(--dn-good) 48%, var(--dn-border)); color: var(--dn-good); } .dn-git-badge.tone-active { border-color: color-mix(in srgb, var(--dn-active) 48%, var(--dn-border)); color: var(--dn-active); } .dn-git-badge.tone-warn { border-color: color-mix(in srgb, var(--dn-warn) 48%, var(--dn-border)); color: var(--dn-warn-soft); } .dn-git-badge.tone-danger { border-color: color-mix(in srgb, var(--dn-danger) 54%, var(--dn-border)); color: var(--dn-danger-soft); }",
    ".dn-git-meta, .dn-git-sha { min-width: 0; overflow: hidden; color: var(--dn-muted); font-size: 0.76rem; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-git-sha { color: var(--dn-label); font-weight: 850; text-align: right; }",
    ".dn-git-note { margin: 8px 0 0; color: var(--dn-muted); font-size: 0.8rem; }",
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
    ".dn-main-grid { display: grid; grid-template-columns: 1fr; gap: 14px; align-items: start; }",
    ".dn-work-stack { display: grid; gap: 14px; min-width: 0; }",
    ".dn-secondary-grid { grid-template-columns: minmax(0, 0.9fr) minmax(0, 0.9fr) minmax(300px, 0.8fr); margin-top: 14px; }",
    ".dn-plugin-row { margin-top: 14px; }",
    ".dn-history-panel { min-height: 690px; background: var(--dn-surface); }",
    ".dn-count { color: var(--dn-label); font-size: 0.8rem; font-weight: 800; white-space: nowrap; }",
    ".dn-history-note { margin: 8px 0 0; color: var(--dn-muted); font-size: 0.84rem; }",
    ".dn-map-reader { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }",
    ".dn-map-reader span { padding: 4px 7px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-raised); font-size: 0.72rem; font-weight: 780; }",
    ".dn-lane-key { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 6px; margin: 10px 0 0; }",
    ".dn-lane-key span { display: grid; gap: 1px; min-width: 0; padding: 6px 8px; overflow: hidden; border: 1px solid var(--dn-border-muted); border-left: 5px solid var(--dn-branch-color); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface-muted); }",
    ".dn-lane-key strong { overflow: hidden; color: var(--dn-strong); font-size: 0.72rem; font-weight: 850; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }",
    ".dn-lane-key em { overflow: hidden; font-size: 0.72rem; font-style: normal; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-branch-board { position: relative; min-height: 420px; max-height: 650px; margin-top: 12px; padding-left: 132px; overflow: auto; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: color-mix(in srgb, var(--dn-weave-bg) 84%, transparent); scrollbar-gutter: stable; }",
    ".dn-branch-svg { position: absolute; left: 0; top: 0; width: 122px; pointer-events: none; }",
    ".dn-branch-svg path { fill: none; stroke-linecap: round; stroke-linejoin: round; }",
    ".dn-history-rows { display: grid; gap: 0; }",
    ".dn-history-item { position: relative; display: grid; grid-template-columns: minmax(190px, 0.74fr) minmax(140px, 0.46fr) auto; align-items: center; gap: 10px; min-height: 34px; height: 34px; padding: 0 10px 0 10px; border: 0; border-bottom: 1px solid var(--dn-border-muted); border-radius: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; transition: background 120ms ease, box-shadow 120ms ease; }",
    ".dn-history-item:hover { background: var(--dn-control-hover); }",
    ".dn-history-item.selected { background: var(--dn-control-active); border-color: transparent; }",
    ".dn-branch-dot { position: absolute; left: calc(-115px + (var(--dn-lane) * 18px)); top: calc(50% - 5px); width: 10px; height: 10px; border: 2px solid var(--dn-surface); border-radius: 999px; background: var(--dn-branch-color); box-shadow: 0 0 0 1px var(--dn-branch-color), 0 0 12px color-mix(in srgb, var(--dn-branch-color) 54%, transparent); }",
    ".dn-history-main { display: flex; align-items: center; gap: 8px; min-width: 0; }",
    ".dn-history-main strong, .dn-card-title strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-history-main strong { font-size: 0.92rem; font-weight: 720; }",
    ".dn-history-status { color: var(--dn-label); font-size: 0.7rem; font-weight: 850; text-transform: uppercase; white-space: nowrap; }",
    ".dn-history-detail, .dn-card-meta { display: block; min-width: 0; overflow: hidden; color: var(--dn-muted); font-size: 0.82rem; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-more { height: 34px; padding: 9px 10px; border-bottom: 1px solid var(--dn-border-muted); color: var(--dn-label); font-size: 0.78rem; font-weight: 800; }",
    ".dn-selected-panel { margin: 16px 0; background: var(--dn-surface); }",
    ".dn-selected-layout { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(220px, 0.72fr); gap: 12px; align-items: start; }",
    ".dn-selected-section { min-width: 0; padding: 12px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-surface-muted); }",
    ".dn-selected-section h2 { margin: 6px 0 8px; font-size: 1.18rem; letter-spacing: 0; }",
    ".dn-selected-section p { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }",
    ".dn-diagnostic-pills { display: flex; flex-wrap: wrap; gap: 6px; }",
    ".dn-diagnostic-pills span { padding: 4px 7px; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface); font-size: 0.72rem; font-weight: 800; }",
    ".dn-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 16px 0 0; }",
    ".dn-detail-grid div { min-width: 0; padding: 10px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-surface-muted); }",
    ".dn-detail-grid dt { color: var(--dn-label); font-size: 0.72rem; font-weight: 850; text-transform: uppercase; }",
    ".dn-detail-grid dd { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin: 4px 0 0; overflow: hidden; color: var(--dn-strong); font-weight: 760; overflow-wrap: anywhere; }",
    ".dn-related { display: grid; gap: 8px; margin-top: 16px; }",
    ".dn-related article { padding: 10px; border: 1px solid var(--dn-border-muted); border-radius: 8px; background: var(--dn-surface-muted); }",
    ".dn-related p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
    ".dn-component-grid, .dn-blocker-list, .dn-events, .dn-thread-list, .dn-plugin-list, .dn-tracked-list { display: grid; gap: 10px; max-height: 440px; overflow: auto; }",
    ".dn-thread-list { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }",
    ".dn-tracked-list { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }",
    ".dn-plugin-list { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }",
    ".dn-host-panel, .dn-host-action-panel, .dn-selected-panel, .dn-history-panel, .dn-thread-panel, .dn-tracked-panel, .dn-plugin-panel, .dn-components-panel, .dn-blockers-panel { scroll-margin-top: 18px; }",
    ".dn-host-action-list { display: grid; gap: 10px; }",
    ".dn-host-action-shell { display: grid; gap: 6px; min-width: 0; }",
    ".dn-host-action-card { --dn-project-accent: var(--dn-warn); display: grid; gap: 7px; min-width: 0; padding: 12px; border: 1px solid color-mix(in srgb, var(--dn-project-accent) 34%, var(--dn-border)); border-left: 5px solid var(--dn-project-accent); border-radius: 8px; color: inherit; background: var(--dn-surface); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }",
    ".dn-host-action-card:hover { border-color: var(--dn-project-accent); background: var(--dn-control-hover); transform: translateY(-1px); }",
    ".dn-host-action-card strong { min-width: 0; overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-event-card, .dn-blocker-card { display: grid; gap: 6px; min-width: 0; }",
    ".dn-component-card, .dn-event, .dn-blocker { display: grid; gap: 6px; min-width: 0; padding: 11px; border: 1px solid var(--dn-border-muted); border-radius: 8px; color: inherit; background: var(--dn-surface-muted); text-align: left; cursor: pointer; transition: transform 160ms ease, border-color 160ms ease, background 160ms ease; }",
    ".dn-thread-card, .dn-plugin-card, .dn-tracked-card { display: grid; gap: 7px; min-width: 0; padding: 11px; border: 1px solid var(--dn-border-muted); border-radius: 8px; color: inherit; background: var(--dn-surface-muted); }",
    ".dn-thread-card.selected { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-active) 22%, transparent) inset; }",
    ".dn-thread-button { display: grid; gap: 7px; min-width: 0; padding: 0; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }",
    ".dn-tracked-card { --dn-tracked-accent: var(--dn-active); border-left: 5px solid var(--dn-tracked-accent); }",
    ".dn-tracked-card.kind-ready { --dn-tracked-accent: var(--dn-active); } .dn-tracked-card.kind-blocked { --dn-tracked-accent: var(--dn-danger); } .dn-tracked-card.kind-import-candidate { --dn-tracked-accent: var(--dn-branch-4); } .dn-tracked-card.kind-stale { --dn-tracked-accent: var(--dn-warn); } .dn-tracked-card.kind-excluded { --dn-tracked-accent: var(--dn-neutral); }",
    ".dn-tracked-card.selected { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dn-tracked-accent) 24%, transparent) inset; }",
    ".dn-tracked-button { display: grid; gap: 7px; min-width: 0; padding: 0; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }",
    ".dn-thread-card-header, .dn-plugin-card-header, .dn-tracked-card-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; min-width: 0; }",
    ".dn-thread-main { display: grid; gap: 4px; min-width: 0; }",
    ".dn-thread-main strong, .dn-plugin-card strong, .dn-tracked-card strong { overflow: hidden; color: var(--dn-strong); text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-thread-card p, .dn-plugin-card p, .dn-tracked-card p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 0.78rem; }",
    ".dn-thread-decision { padding: 4px 7px; border: 1px solid currentColor; border-radius: 6px; font-size: 0.68rem; font-weight: 900; text-transform: uppercase; white-space: nowrap; }",
    ".dn-thread-decision.decision-continue, .dn-thread-decision.decision-resume { color: var(--dn-active); } .dn-thread-decision.decision-review, .dn-thread-decision.decision-archive, .dn-thread-decision.decision-merged { color: var(--dn-warn); } .dn-thread-decision.decision-rescue, .dn-thread-decision.decision-blocked { color: var(--dn-danger); } .dn-thread-decision.decision-forget { color: var(--dn-good); }",
    ".dn-plugin-pills { display: flex; flex-wrap: wrap; gap: 5px; }",
    ".dn-plugin-pills span { max-width: 100%; padding: 3px 6px; overflow: hidden; border: 1px solid var(--dn-border-muted); border-radius: 6px; color: var(--dn-muted); background: var(--dn-surface); font-size: 0.7rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }",
    ".dn-plugin-note, .dn-panel-note { margin-top: 10px; font-size: 0.78rem; }",
    ".dn-panel-note { color: var(--dn-muted); }",
    ".dn-event strong { color: var(--dn-strong); }",
    ".dn-event p, .dn-blocker strong { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }",
    ".tone-good { color: var(--dn-good); } .tone-active { color: var(--dn-active); } .tone-warn { color: var(--dn-warn); } .tone-danger { color: var(--dn-danger); } .tone-neutral { color: var(--dn-neutral); }",
    ".dn-loading-panel { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px; align-items: start; margin-top: 16px; overflow: hidden; }",
    ".dn-loader { width: 34px; height: 34px; border: 3px solid color-mix(in srgb, var(--dn-active) 22%, var(--dn-border)); border-top-color: var(--dn-active); border-radius: 999px; animation: dn-spin 820ms linear infinite; }",
    ".dn-loading-copy { display: grid; gap: 8px; min-width: 0; }",
    ".dn-inline-loading { display: flex; gap: 9px; align-items: center; min-width: 0; color: var(--dn-muted); font-weight: 760; }",
    ".dn-inline-loading::before { content: ''; width: 12px; height: 12px; border: 2px solid color-mix(in srgb, var(--dn-active) 24%, var(--dn-border)); border-top-color: var(--dn-active); border-radius: 999px; animation: dn-spin 820ms linear infinite; }",
    ".dn-skeleton-stack { display: grid; gap: 8px; margin-top: 4px; }",
    ".dn-skeleton { position: relative; height: 12px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--dn-surface-raised) 80%, var(--dn-active) 20%); }",
    ".dn-skeleton::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--dn-active) 24%, transparent), transparent); animation: dn-shimmer 1.35s ease-in-out infinite; }",
    "@media (max-width: 1120px) { .dn-signals { grid-template-columns: repeat(3, minmax(0, 1fr)); } .dn-grid, .dn-main-grid, .dn-secondary-grid, .dn-selected-layout { grid-template-columns: 1fr; } }",
    "@media (max-width: 860px) { .dn-header { grid-template-columns: 1fr; } .dn-header-actions { justify-content: flex-end; width: 100%; } .dn-header-strip { width: 100%; } }",
    "@media (max-width: 680px) { .dn-shell { padding: 12px; } .dn-header { padding: 20px; } .dn-meta { min-width: 0; } .dn-open-menu { justify-self: stretch; } .dn-open-trigger { width: 100%; } .dn-open-options { left: 0; right: auto; } .dn-theme-toggle button { min-width: 0; flex: 1; } .dn-signals { grid-template-columns: 1fr; } .dn-panel-heading { align-items: flex-start; flex-direction: column; } .dn-history-item { grid-template-columns: minmax(0, 1fr) auto; } .dn-history-detail { display: none; } .dn-detail-grid { grid-template-columns: 1fr; } }",
    "@media (max-width: 560px) { .dn-header-actions { justify-content: stretch; } .dn-header-strip { justify-content: stretch; } .dn-header-path-menu { width: 100%; max-width: 100%; } }",
    "`;",
    "",
    "export async function fetchDevNexusDashboard(baseUrl = '', workspaceId = '') {",
    "  const response = await fetch(`${baseUrl}/api/dashboard${workspaceQuery(workspaceId)}`, { cache: 'no-store' });",
    "  if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);",
    "  return response.json();",
    "}",
    "",
    "export async function fetchDevNexusDashboardShell(baseUrl = '', workspaceId = '') {",
    "  const response = await fetch(`${baseUrl}/api/dashboard/shell${workspaceQuery(workspaceId)}`, { cache: 'no-store' });",
    "  if (!response.ok) throw new Error(`Dashboard shell API returned ${response.status}`);",
    "  return response.json();",
    "}",
    "",
    "export async function fetchDevNexusDashboardSection(baseUrl = '', workspaceId = '', section = '') {",
    "  const query = `${workspaceQuery(workspaceId)}${workspaceQuery(workspaceId) ? '&' : '?'}section=${encodeURIComponent(section)}`;",
    "  const response = await fetch(`${baseUrl}/api/dashboard/section${query}`, { cache: 'no-store' });",
    "  if (!response.ok) throw new Error(`Dashboard section API returned ${response.status}`);",
    "  return response.json();",
    "}",
    "",
    "export async function fetchDevNexusDashboardHost(baseUrl = '', workspaceId = '') {",
    "  const response = await fetch(`${baseUrl}/api/host${workspaceQuery(workspaceId)}`, { cache: 'no-store' });",
    "  if (!response.ok) throw new Error(`Host API returned ${response.status}`);",
    "  return response.json();",
    "}",
    "",
    "export async function fetchDevNexusDashboardProjects(baseUrl = '', workspaceId = '') {",
    "  const response = await fetch(`${baseUrl}/api/projects${workspaceQuery(workspaceId)}`, { cache: 'no-store' });",
    "  if (!response.ok) throw new Error(`Projects API returned ${response.status}`);",
    "  const payload = await response.json();",
    "  return payload.host ?? { version: 1, partial: true, generatedAt: new Date().toISOString(), hostId: hostIdentity(null), workspaceCount: payload.projects?.length ?? 0, needsAttentionCount: 0, actionQueue: [], workspaces: payload.projects ?? [] };",
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
    "  let hostFocus = 'components';",
    "  let gitHistoryFilter = 'all';",
    "  let latestSnapshot = null;",
    "  let latestHost = null;",
    "  let latestError = null;",
    "  let lastRenderSignature = null;",
    "  let lastHostRefreshAt = 0;",
    "  let disposed = false;",
    "  let inFlight = false;",
    "  let hostInFlight = false;",
    "  let workspaceSectionToken = 0;",
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
    "  function setHostFocus(nextHostFocus) {",
    "    if (disposed) return;",
    "    hostFocus = normalizeHostFocus(nextHostFocus);",
    "    renderCurrent();",
    "  }",
    "  function setGitHistoryFilter(nextFilter) {",
    "    if (disposed) return;",
    "    gitHistoryFilter = normalizeGitHistoryFilter(nextFilter);",
    "    const graph = latestSnapshot ? gitHistoryRows(latestSnapshot, gitHistoryFilter) : null;",
    "    if (graph?.rows?.length) {",
    "      const visible = new Set(graph.rows.map((row) => row.selectId));",
    "      if (!visible.has(selectedId)) selectedId = graph.rows[0].selectId;",
    "    }",
    "    renderCurrent();",
    "  }",
    "  function setWorkspaceId(nextWorkspaceId) {",
    "    const nextSelectedId = arguments.length > 1 ? arguments[1] : null;",
    "    if (disposed) return;",
    "    const normalized = normalizeWorkspaceId(nextWorkspaceId);",
    "    if (normalized === selectedWorkspaceId && !nextSelectedId) return;",
    "    selectedWorkspaceId = normalized;",
    "    selectedId = nextSelectedId ? String(nextSelectedId) : null;",
    "    gitHistoryFilter = 'all';",
    "    latestSnapshot = null;",
    "    latestError = null;",
    "    lastHostRefreshAt = 0;",
    "    lastRenderSignature = null;",
    "    workspaceSectionToken += 1;",
    "    writeWorkspaceIdToLocation(selectedWorkspaceId);",
    "    renderCurrent();",
    "    void refresh(true);",
    "  }",
    "  function renderRoot(markup, signature = '') {",
    "    if (signature && signature === lastRenderSignature) return;",
    "    lastRenderSignature = signature || markup;",
    "    root.innerHTML = markup;",
    "    bindThemeControls(root, setThemeMode);",
    "    bindSelectionControls(root, setSelectedId);",
    "    bindHostSignalControls(root, setHostFocus);",
    "    bindGitHistoryFilterControls(root, setGitHistoryFilter);",
    "    bindWorkspaceControls(root, setWorkspaceId);",
    "    bindLocalActions(root, baseUrl, actionToken, selectedWorkspaceId, () => refresh(true));",
    "  }",
    "  function renderCurrent() {",
    "    if (disposed) return;",
    "    if (!selectedWorkspaceId) {",
    "      if (latestHost) renderRoot(renderHostDashboard(latestHost, themeMode, hostFocus), dashboardRenderSignature({ scope: 'host', themeMode, hostFocus, host: latestHost }));",
    "      else if (latestError) renderRoot(renderError(latestError, themeMode), dashboardRenderSignature({ scope: 'host-error', themeMode, error: dashboardErrorMessage(latestError) }));",
    "      else renderRoot(renderLoading(themeMode, latestHost, selectedWorkspaceId), dashboardRenderSignature({ scope: 'host-loading', themeMode, host: latestHost }));",
    "      return;",
    "    }",
    "    if (latestSnapshot) {",
    "      renderRoot(renderDashboard(latestSnapshot, themeMode, selectedId, latestHost, selectedWorkspaceId, gitHistoryFilter), dashboardRenderSignature({ scope: 'workspace', themeMode, selectedWorkspaceId, selectedId, gitHistoryFilter, snapshot: latestSnapshot, host: latestHost }));",
    "    } else if (latestError) {",
    "      renderRoot(renderError(latestError, themeMode), dashboardRenderSignature({ scope: 'workspace-error', themeMode, selectedWorkspaceId, error: dashboardErrorMessage(latestError), host: latestHost }));",
    "    } else {",
    "      renderRoot(renderLoading(themeMode, latestHost, selectedWorkspaceId), dashboardRenderSignature({ scope: 'workspace-loading', themeMode, selectedWorkspaceId, host: latestHost }));",
    "    }",
    "  }",
    "  async function refresh(force = false) {",
    "    if (inFlight && !force) return;",
    "    inFlight = true;",
    "    try {",
    "      const workspaceId = selectedWorkspaceId;",
    "      if (!workspaceId) {",
    "        if (!latestHost) {",
    "          const shell = await fetchDevNexusDashboardProjects(baseUrl);",
    "          if (workspaceId !== selectedWorkspaceId) return;",
    "          latestHost = shell;",
    "          latestSnapshot = null;",
    "          latestError = null;",
    "          renderCurrent();",
    "        }",
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
    "      const needsHostShell = shouldRefreshHost && !latestHost;",
    "      let sectionRefresh = null;",
    "      let sectionToken = workspaceSectionToken;",
    "      if (!latestSnapshot || latestSnapshot.partial === true) {",
    "        const shell = await fetchDevNexusDashboardShell(baseUrl, workspaceId);",
    "        if (workspaceId !== selectedWorkspaceId) return;",
    "        latestSnapshot = shell;",
    "        latestError = null;",
    "        if (!findSelectableById(shell, selectedId)) selectedId = defaultSelectedId(shell);",
    "        renderCurrent();",
    "        sectionToken = ++workspaceSectionToken;",
    "        sectionRefresh = refreshWorkspaceSections(workspaceId, sectionToken);",
    "      }",
    "      if (needsHostShell) void refreshHostShell();",
    "      if (sectionRefresh) {",
    "        await sectionRefresh;",
    "        if (disposed || workspaceId !== selectedWorkspaceId || sectionToken !== workspaceSectionToken) return;",
    "      }",
    "      const snapshot = await fetchDevNexusDashboard(baseUrl, workspaceId);",
    "      if (workspaceId !== selectedWorkspaceId) return;",
    "      latestSnapshot = snapshot;",
    "      latestError = null;",
    "      workspaceSectionToken += 1;",
    "      if (!findSelectableById(snapshot, selectedId)) selectedId = defaultSelectedId(snapshot);",
    "      renderCurrent();",
    "      if (shouldRefreshHost) void refreshHost();",
    "    } catch (error) {",
    "      const hasVisibleData = selectedWorkspaceId ? Boolean(latestSnapshot) : Boolean(latestHost);",
    "      latestError = error;",
    "      if (!hasVisibleData) {",
    "        latestSnapshot = null;",
    "        renderCurrent();",
    "      }",
    "    } finally {",
    "      inFlight = false;",
    "    }",
    "  }",
    "  async function refreshWorkspaceSections(workspaceId, token) {",
    "    const sections = ['components', 'plugins', 'threads', 'tracked-work'];",
    "    await Promise.all(sections.map(async (section) => {",
    "      try {",
    "        const payload = await fetchDevNexusDashboardSection(baseUrl, workspaceId, section);",
    "        if (disposed || workspaceId !== selectedWorkspaceId || token !== workspaceSectionToken) return;",
    "        latestSnapshot = mergeDashboardSnapshot(latestSnapshot, payload.patch);",
    "        if (latestSnapshot && !findSelectableById(latestSnapshot, selectedId)) selectedId = defaultSelectedId(latestSnapshot);",
    "        renderCurrent();",
    "      } catch {",
    "        // Keep the shell visible; the full snapshot is still the final reconciliation path.",
    "      }",
    "    }));",
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
    "    } catch (error) {",
    "      latestError = error;",
    "      if (!latestHost && !latestSnapshot) renderCurrent();",
    "    } finally {",
    "      hostInFlight = false;",
    "    }",
    "  }",
    "  async function refreshHostShell() {",
    "    if (hostInFlight || latestHost) return;",
    "    hostInFlight = true;",
    "    try {",
    "      const workspaceId = selectedWorkspaceId;",
    "      const host = await fetchDevNexusDashboardProjects(baseUrl, workspaceId);",
    "      if (workspaceId !== selectedWorkspaceId) return;",
    "      latestHost = host;",
    "      renderCurrent();",
    "    } catch (error) {",
    "      latestError = error;",
    "      if (!latestHost && !latestSnapshot) renderCurrent();",
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
    "function renderDashboard(snapshot, themeMode, selectedId, host, selectedWorkspaceId = '', gitHistoryFilter = 'all') {",
    "  const activeSelection = findSelectableById(snapshot, selectedId) ? selectedId : defaultSelectedId(snapshot);",
    "  const loading = snapshot.partial === true;",
    "  const componentsLoaded = sectionLoaded(snapshot, 'components');",
    "  const threadsLoaded = sectionLoaded(snapshot, 'threads');",
    "  const trackedLoaded = sectionLoaded(snapshot, 'tracked-work');",
    "  const pluginsLoaded = sectionLoaded(snapshot, 'plugins');",
    "  const gitHistory = loading && !componentsLoaded ? renderProgressivePanel('project-git-history', 'Git history', 'Project History', 'Loading commits, refs, and branch heads.') : renderGitHistory(snapshot, activeSelection, gitHistoryFilter);",
    "  const workHistory = loading && !threadsLoaded ? renderProgressivePanel('parallel-work-map', 'Workspace map', 'Activity Lanes', 'Loading source checkout, branches, automation, and decisions.') : renderWorkHistory(snapshot, activeSelection);",
    "  const features = loading && !threadsLoaded ? renderProgressivePanel('active-features', 'Project workflow', 'Active Features', 'Loading feature branches and active threads.') : renderFeatureOverview(snapshot, activeSelection);",
    "  const threadInbox = loading && !threadsLoaded ? renderProgressivePanel('hitl-queue', 'HITL queue', 'Action Needed', 'Loading active threads and local decisions.') : renderThreadInbox(snapshot, activeSelection);",
    "  const trackedWork = loading && !trackedLoaded ? renderProgressivePanel('tracked-work-panel', 'Tracked work', 'Issues and Work Items', 'Loading provider and local work items.') : renderTrackedWork(snapshot, activeSelection);",
    "  const plugins = loading && !pluginsLoaded ? renderProgressivePanel('plugins-panel', 'Extensions', 'Plugins', 'Loading local plugin candidates and capability details.') : renderPlugins(snapshot.plugins);",
    "  const activity = loading && !threadsLoaded ? renderProgressivePanel('activity-panel', 'Activity', 'Recent Signals', 'Loading workspace events.') : `<div class=\"dn-panel\" id=\"activity-panel\"><h2>Activity</h2><div class=\"dn-events\">${snapshot.events.slice(0, 7).map((event) => renderEvent(event, activeSelection)).join('')}</div></div>`;",
    "  const blockers = loading && !trackedLoaded ? renderProgressivePanel('blockers-panel', 'Blockers', 'Blockers', 'Loading approvals and blockers.') : `<div class=\"dn-panel dn-blockers-panel\" id=\"blockers-panel\"><h2>Blockers</h2>${renderBlockers(snapshot, activeSelection)}</div>`;",
    "  return `<div class=\"dn-shell\">",
    "    <header class=\"dn-header\">",
    "      <div><span class=\"dn-eyebrow\">DevNexus cockpit</span><h1>${escapeHtml(snapshot.project.name)}</h1><p>${escapeHtml(snapshot.summary)}</p></div>",
    "      ${renderProjectHeaderActions(snapshot, themeMode, selectedWorkspaceId)}",
    "    </header>",
    "    ${renderHostOverview(host, snapshot, selectedWorkspaceId)}",
    "    ${renderSignals(snapshot.signals, activeSelection)}",
    "    ${renderSelectedItem(snapshot, activeSelection)}",
    "    <section class=\"dn-main-grid\">",
    "      <div class=\"dn-work-stack\">${gitHistory}${features}${workHistory}${threadInbox}${trackedWork}</div>",
    "    </section>",
    "    <section class=\"dn-plugin-row\">${plugins}</section>",
    "    <section class=\"dn-grid dn-secondary-grid\">",
    "      <div class=\"dn-panel dn-components-panel\" id=\"components-panel\"><h2>Components</h2>${renderComponents(snapshot.components, activeSelection)}</div>",
    "      ${activity}",
    "      ${blockers}",
    "    </section>",
    "  </div>`;",
    "}",
    "",
    "function renderHostDashboard(host, themeMode, hostFocus = 'components') {",
    "  const focus = normalizeHostFocus(hostFocus);",
    "  const workspaceCount = host?.workspaceCount ?? 0;",
    "  const summary = host.partial === true ? `${countLabel(workspaceCount, 'workspace')}, loading signals` : `${countLabel(workspaceCount, 'workspace')}, ${needsAttentionLabel(host.needsAttentionCount ?? 0)}`;",
    "  return `<div class=\"dn-shell dn-host-dashboard\"><header class=\"dn-header\"><div><span class=\"dn-eyebrow\">DevNexus cockpit</span><h1>Host Cockpit</h1><p>${escapeHtml(summary)}</p></div>${renderHostHeaderActions(host, themeMode)}</header>${renderHostOverview(host, null, '', { hostMode: true, focus })}${renderHostSignals(host, focus)}${renderHostActionQueue(host, focus)}</div>`;",
    "}",
    "",
    "function renderHostHeaderActions(host, themeMode) {",
    "  const homePath = host?.homePath ?? '';",
    "  return `<div class=\"dn-header-actions dn-host-header-actions\"><div class=\"dn-header-strip\"><span class=\"dn-header-pill dn-host-identity\"><span>Host</span><strong title=\"${escapeHtml(hostIdentity(host))}\">${escapeHtml(hostIdentity(host))}</strong></span><span class=\"dn-header-pill dn-header-stamp\"><span>Generated</span><strong>${escapeHtml(formatTime(host?.generatedAt))}</strong></span>${renderPathOpenMenu('home', 'Home', homePath)}</div>${renderThemeToggle(themeMode)}</div>`;",
    "}",
    "",
    "function renderProjectHeaderActions(snapshot, themeMode, selectedWorkspaceId = '') {",
    "  const root = snapshot?.project?.root ?? '';",
    "  return `<div class=\"dn-header-actions dn-project-header-actions\"><div class=\"dn-header-strip\">${renderHostNavButton(selectedWorkspaceId)}<span class=\"dn-header-pill dn-header-stamp\"><span>Generated</span><strong>${escapeHtml(formatTime(snapshot?.generatedAt))}</strong></span>${renderPathOpenMenu('project', 'Project', root)}</div>${renderThemeToggle(themeMode)}</div>`;",
    "}",
    "",
    "function hostIdentity(host) {",
    "  const value = host?.hostId ?? host?.hostname ?? host?.hostName ?? '';",
    "  if (String(value).trim()) return String(value).trim();",
    "  if (typeof location === 'object' && location?.hostname) return location.hostname;",
    "  return 'local host';",
    "}",
    "",
    "function renderHostSignals(host, hostFocus = 'components') {",
    "  const workspaces = host?.workspaces ?? [];",
    "  const totalThreads = sumBy(workspaces, (workspace) => workspace.threadCount);",
    "  const totalHitl = sumBy(workspaces, (workspace) => workspace.needsDecisionCount);",
    "  const readyWork = sumBy(workspaces, (workspace) => workspace.eligibleWorkCount);",
    "  const plugins = sumBy(workspaces, (workspace) => workspace.pluginCount);",
    "  const loading = host?.partial === true;",
    "  const signals = [",
    "    { id: 'components', label: 'Workspaces', value: String(host?.workspaceCount ?? workspaces.length), detail: 'Registered and local project cockpits' },",
    "    { id: 'blockers', label: 'Needs attention', value: loading ? '...' : String(host?.needsAttentionCount ?? 0), detail: loading ? 'Loading signals' : 'Workspaces with approvals, dirty state, or errors' },",
    "    { id: 'worktrees', label: 'Threads', value: loading ? '...' : String(totalThreads), detail: loading ? 'Loading thread state' : `${countLabel(totalHitl, 'action')} needed` },",
    "    { id: 'eligible-work', label: 'Tracked work', value: loading ? '...' : String(readyWork), detail: loading ? 'Loading tracked work' : (readyWork ? 'Ready issues and work items' : 'No ready work') },",
    "    { id: 'plugins', label: 'Plugins', value: String(plugins), detail: 'Installed DevNexus plugin instances' },",
    "  ];",
    "  return `<section class=\"dn-signals\" aria-label=\"Host signals\">${signals.map((signal) => `<button class=\"dn-signal dn-host-signal signal-${escapeAttribute(signal.id)} ${signal.id === hostFocus ? 'selected' : ''}\" type=\"button\" data-host-focus=\"${escapeHtml(signal.id)}\"><span class=\"dn-signal-top\"><span class=\"dn-signal-icon\">${signalIcon(signal.id)}</span><span class=\"dn-label\">${escapeHtml(signal.label)}</span></span><strong>${escapeHtml(signal.value)}</strong><p>${escapeHtml(signal.detail)}</p></button>`).join('')}</section>`;",
    "}",
    "",
    "function hostSignalTarget(id) {",
    "  if (id === 'components' || id === 'plugins') return 'host-workspaces';",
    "  return 'host-action-queue';",
    "}",
    "",
    "function renderHostActionQueue(host, hostFocus = 'components') {",
    "  const allActions = host?.actionQueue ?? [];",
    "  const actions = filteredHostActions(allActions, hostFocus, host?.workspaces ?? []);",
    "  const accentMap = workspaceAccentMap(host?.workspaces ?? []);",
    "  const body = host?.partial === true ? renderInlineLoading('Loading action queue') : (actions.length ? actions.slice(0, 8).map((action) => renderHostActionCard(action, accentMap)).join('') : `<p>${escapeHtml(emptyHostActionText(hostFocus))}</p>`);",
    "  return `<section class=\"dn-panel dn-host-action-panel\" id=\"host-action-queue\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Host HITL</span><h2>${escapeHtml(hostActionQueueTitle(hostFocus))}</h2></div><span class=\"dn-count\">${escapeHtml(`${actions.length} of ${countLabel(allActions.length, 'action')}`)}</span></div><div class=\"dn-host-action-list\">${body}</div></section>`;",
    "}",
    "",
    "function renderHostActionCard(action, accentMap) {",
    "  const updated = action.updatedAt ? ` · ${formatTime(action.updatedAt)}` : '';",
    "  const detail = formatDisplayText(action.detail);",
    "  const decisionClass = action.kind === 'ready-work' ? 'continue' : action.tone === 'danger' ? 'rescue' : 'review';",
    "  const targetSelection = action.primaryAction?.targetSelectionId ?? '';",
    "  const provider = action.providerAction ? renderActionStrip([action.providerAction], 'compact') : '';",
    "  return `<article class=\"dn-host-action-shell\"><button class=\"dn-host-action-card action-${escapeAttribute(action.kind)}\" style=\"${projectAccentStyle(action.workspaceId, accentMap)}\" type=\"button\" data-workspace-id=\"${escapeHtml(action.workspaceId)}\" data-workspace-selection-id=\"${escapeHtml(targetSelection)}\"><span class=\"dn-card-title\"><strong>${escapeHtml(action.workspaceName)}</strong><span class=\"dn-thread-decision decision-${decisionClass}\">${escapeHtml(action.state)}</span></span><span class=\"dn-card-meta\">${escapeHtml(action.reason)}${escapeHtml(updated)}</span><p title=\"${escapeHtml(detail)}\">${escapeHtml(truncate(detail, 110))}</p><span class=\"dn-action-label\">${escapeHtml(action.primaryAction?.label ?? 'Open workspace')}</span></button>${provider}</article>`;",
    "}",
    "",
    "function renderHostNavButton(selectedWorkspaceId) {",
    "  return selectedWorkspaceId ? `<button class=\"dn-action\" type=\"button\" data-workspace-id=\"\">${signalIcon('worktrees')}<span class=\"dn-action-label\">Host cockpit</span></button>` : '';",
    "}",
    "",
    "function renderOpenMenu(target, label) {",
    "  const safeTarget = target === 'home' ? 'home' : 'project';",
    "  return `<details class=\"dn-open-menu\"><summary class=\"dn-action dn-open-trigger\">${folderIcon()}<span class=\"dn-action-label\">${escapeHtml(label)}</span><span class=\"dn-open-chevron-shell\">${chevronDownIcon()}</span></summary>${renderOpenOptions(safeTarget)}</details>`;",
    "}",
    "",
    "function renderPathOpenMenu(target, label, pathValue) {",
    "  const safeTarget = target === 'home' ? 'home' : 'project';",
    "  const value = pathValue ?? '';",
    "  return `<details class=\"dn-open-menu dn-header-path-menu\"><summary class=\"dn-header-path-control\">${localAppIcon('file', finderIcon())}<span class=\"dn-header-path-copy\"><span class=\"dn-header-path-label\">${escapeHtml(label)}</span><strong class=\"dn-header-path-value\" title=\"${escapeHtml(value)}\">${escapeHtml(compactPath(value))}</strong></span><span class=\"dn-open-chevron-shell\">${chevronDownIcon()}</span></summary>${renderOpenOptions(safeTarget)}</details>`;",
    "}",
    "",
    "function renderOpenOptions(safeTarget) {",
    "  return `<div class=\"dn-open-options\"><button class=\"dn-open-option\" type=\"button\" data-open-target=\"${safeTarget}\" data-open-app=\"code\">${localAppIcon('code', codeIcon())}<span class=\"dn-action-label\">VS Code</span></button><button class=\"dn-open-option\" type=\"button\" data-open-target=\"${safeTarget}\" data-open-app=\"file\">${localAppIcon('file', finderIcon())}<span class=\"dn-action-label\">Finder</span></button><button class=\"dn-open-option\" type=\"button\" data-open-target=\"${safeTarget}\" data-open-app=\"terminal\">${localAppIcon('terminal', terminalIcon())}<span class=\"dn-action-label\">Terminal</span></button></div>`;",
    "}",
    "",
    "const projectAccentCount = 7;",
    "",
    "function projectAccentStyle(value, accentMap = null) {",
    "  const key = String(value ?? 'workspace');",
    "  const mapped = accentMap instanceof Map ? accentMap.get(key) : undefined;",
    "  const index = typeof mapped === 'number' ? mapped : stableAccentIndex(key);",
    "  return `--dn-project-accent:var(--dn-branch-${index}); --dn-workspace-accent:var(--dn-project-accent);`;",
    "}",
    "",
    "function stableAccentIndex(value) {",
    "  const text = String(value ?? 'workspace');",
    "  let hash = 0;",
    "  for (let index = 0; index < text.length; index += 1) hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;",
    "  return hash % projectAccentCount;",
    "}",
    "",
    "function workspaceAccentMap(workspaces) {",
    "  const map = new Map();",
    "  for (const workspace of workspaces ?? []) {",
    "    if (!workspace?.id || map.has(workspace.id)) continue;",
    "    map.set(workspace.id, map.size % projectAccentCount);",
    "  }",
    "  return map;",
    "}",
    "",
    "function sumBy(values, selector) {",
    "  return values.reduce((total, value) => total + Number(selector(value) ?? 0), 0);",
    "}",
    "",
    "function countLabel(value, singular, pluralValue = `${singular}s`) {",
    "  const count = Number(value ?? 0);",
    "  return `${count} ${count === 1 ? singular : pluralValue}`;",
    "}",
    "",
    "function needsAttentionLabel(value) {",
    "  const count = Number(value ?? 0);",
    "  return `${count} ${count === 1 ? 'needs' : 'need'} attention`;",
    "}",
    "",
    "function mergeDashboardSnapshot(snapshot, patch) {",
    "  if (!snapshot) return patch ?? null;",
    "  if (!patch) return snapshot;",
    "  const loaded = new Set([...(snapshot.loadedSections ?? []), ...(patch.loadedSections ?? [])]);",
    "  return { ...snapshot, ...patch, loadedSections: [...loaded], partial: snapshot.partial === true && patch.partial !== false ? true : patch.partial };",
    "}",
    "",
    "function dashboardRenderSignature(value) {",
    "  try {",
    "    return JSON.stringify(stripVolatileDashboardFields(value));",
    "  } catch {",
    "    return '';",
    "  }",
    "}",
    "",
    "function stripVolatileDashboardFields(value) {",
    "  if (Array.isArray(value)) return value.map(stripVolatileDashboardFields);",
    "  if (value && typeof value === 'object') {",
    "    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'generatedAt').map(([key, child]) => [key, stripVolatileDashboardFields(child)]));",
    "  }",
    "  return value;",
    "}",
    "",
    "function dashboardErrorMessage(error) {",
    "  return error instanceof Error ? error.message : String(error ?? '');",
    "}",
    "",
    "function sectionLoaded(snapshot, section) {",
    "  return snapshot?.partial !== true || (snapshot.loadedSections ?? []).includes(section);",
    "}",
    "",
    "function renderLoading(themeMode, host, selectedWorkspaceId = '') {",
    "  const title = selectedWorkspaceId ? 'Switching workspace' : 'Loading host cockpit';",
    "  const detail = selectedWorkspaceId ? 'Loading workspace state.' : 'Reading registered workspaces, threads, plugins, and approvals.';",
    "  return `<div class=\"dn-shell\"><header class=\"dn-header\"><div><span class=\"dn-eyebrow\">DevNexus cockpit</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></div><div class=\"dn-header-actions\">${renderHostNavButton(selectedWorkspaceId)}${renderThemeToggle(themeMode)}</div></header>${renderHostOverview(host, null, selectedWorkspaceId)}<section class=\"dn-panel dn-loading-panel\" aria-busy=\"true\"><span class=\"dn-loader\" aria-hidden=\"true\"></span><div class=\"dn-loading-copy\"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><div class=\"dn-skeleton-stack\" aria-hidden=\"true\"><span class=\"dn-skeleton\" style=\"width:92%\"></span><span class=\"dn-skeleton\" style=\"width:76%\"></span><span class=\"dn-skeleton\" style=\"width:54%\"></span></div></div></section></div>`;",
    "}",
    "",
    "function renderHostOverview(host, snapshot, selectedWorkspaceId = '', options = {}) {",
    "  const allWorkspaces = host?.workspaces ?? [];",
    "  if (!allWorkspaces.length) return '';",
    "  const workspaces = filteredHostWorkspaces(allWorkspaces, options.focus);",
    "  const accentMap = workspaceAccentMap(allWorkspaces);",
    "  const workspaceCount = host?.workspaceCount ?? allWorkspaces.length;",
    "  const count = host?.partial === true ? `Loading signals · ${countLabel(workspaceCount, 'workspace')}` : (options.hostMode ? `${workspaces.length} shown · ${countLabel(workspaceCount, 'workspace')} total` : `${needsAttentionLabel(host.needsAttentionCount ?? 0)} · ${countLabel(workspaceCount, 'workspace')}`);",
    "  const body = workspaces.length ? workspaces.slice(0, 8).map((workspace) => renderWorkspaceCard(workspace, snapshot, selectedWorkspaceId, !options.hostMode, accentMap)).join('') : `<p>${escapeHtml(emptyHostWorkspaceText(options.focus))}</p>`;",
    "  return `<section class=\"dn-panel dn-host-panel\" id=\"host-workspaces\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Host cockpit</span><h2>${escapeHtml(hostWorkspaceTitle(options.focus))}</h2></div><span class=\"dn-count\">${escapeHtml(count)}</span></div><div class=\"dn-workspace-list\">${body}</div></section>`;",
    "}",
    "",
    "function renderWorkspaceCard(workspace, snapshot, selectedWorkspaceId = '', highlightCurrent = true, accentMap = null) {",
    "  const status = workspace.loading ? 'loading' : (workspace.error ? 'unavailable' : workspaceToneLabel(workspace));",
    "  const detail = workspace.loading ? 'Loading workspace signals.' : formatDisplayText(workspace.summary);",
    "  const title = workspace.current && snapshot ? snapshot.project.name : workspace.name;",
    "  const meta = workspace.loading ? [countLabel(workspace.componentCount, 'component'), 'signals loading', countLabel(workspace.pluginCount, 'plugin')] : [countLabel(workspace.componentCount, 'component'), `${workspace.needsDecisionCount} active HITL`, countLabel(workspace.threadCount, 'active thread'), countLabel(workspace.pluginCount, 'plugin')];",
    "  const selected = workspace.id === selectedWorkspaceId || (highlightCurrent && !selectedWorkspaceId && workspace.current) ? 'selected' : '';",
    "  const currentClass = workspace.current ? 'current-workspace' : '';",
    "  const currentBadge = workspace.current ? '<span class=\"dn-workspace-current-badge\">current</span>' : '';",
    "  return `<button class=\"dn-workspace-card ${currentClass} tone-${escapeAttribute(workspace.tone)} ${selected}\" style=\"${projectAccentStyle(workspace.id, accentMap)}\" type=\"button\" data-workspace-id=\"${escapeHtml(workspace.id)}\" aria-label=\"Open ${escapeHtml(title)}\"><span class=\"dn-card-title\"><strong title=\"${escapeHtml(workspace.root)}\">${escapeHtml(title)}</strong>${currentBadge}</span><p title=\"${escapeHtml(detail)}\">${escapeHtml(detail)}</p><div class=\"dn-workspace-meta\"><span>${escapeHtml(status)}</span>${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div></button>`;",
    "}",
    "",
    "function renderInlineLoading(label) {",
    "  return `<p class=\"dn-inline-loading\">${escapeHtml(label)}</p>`;",
    "}",
    "",
    "function renderProgressivePanel(id, eyebrow, title, detail) {",
    "  return `<div class=\"dn-panel\" id=\"${escapeAttribute(id)}\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2></div><span class=\"dn-count\">loading</span></div>${renderInlineLoading(detail)}<div class=\"dn-skeleton-stack\" aria-hidden=\"true\"><span class=\"dn-skeleton\" style=\"width:86%\"></span><span class=\"dn-skeleton\" style=\"width:68%\"></span><span class=\"dn-skeleton\" style=\"width:42%\"></span></div></div>`;",
    "}",
    "",
    "function workspaceToneLabel(workspace) {",
    "  if (workspace.blockerCount > 0 || workspace.automationStatus === 'blocked') return 'blocked';",
    "  if (workspace.needsDecisionCount > 0) return 'needs action';",
    "  if (workspace.dirtyComponentCount > 0) return 'dirty';",
    "  if (workspace.eligibleWorkCount > 0) return 'ready work';",
    "  return 'clear';",
    "}",
    "",
    "function normalizeHostFocus(value) {",
    "  const id = String(value ?? '').trim();",
    "  return ['components', 'blockers', 'worktrees', 'eligible-work', 'plugins'].includes(id) ? id : 'components';",
    "}",
    "",
    "function filteredHostActions(actions, hostFocus = 'components', workspaces = []) {",
    "  const focus = normalizeHostFocus(hostFocus);",
    "  if (focus === 'worktrees') return actions.filter((action) => action.kind === 'thread');",
    "  if (focus === 'eligible-work') return actions.filter((action) => action.kind === 'ready-work');",
    "  if (focus === 'plugins') {",
    "    const pluginWorkspaceIds = new Set(workspaces.filter((workspace) => workspace.pluginCount > 0).map((workspace) => workspace.id));",
    "    return actions.filter((action) => pluginWorkspaceIds.has(action.workspaceId));",
    "  }",
    "  if (focus === 'components') return actions;",
    "  return actions.filter((action) => ['blocker', 'workspace-error', 'approval', 'thread', 'dirty'].includes(action.kind));",
    "}",
    "",
    "function filteredHostWorkspaces(workspaces, hostFocus = 'components') {",
    "  const focus = normalizeHostFocus(hostFocus);",
    "  if (focus === 'plugins') return workspaces.filter((workspace) => workspace.pluginCount > 0);",
    "  if (focus === 'worktrees') return workspaces.filter((workspace) => workspace.threadCount > 0 || workspace.needsDecisionCount > 0);",
    "  if (focus === 'eligible-work') return workspaces.filter((workspace) => (workspace.eligibleWorkCount ?? 0) > 0);",
    "  if (focus === 'blockers') return workspaces.filter((workspace) => workspace.tone === 'danger' || workspace.tone === 'warn');",
    "  return workspaces;",
    "}",
    "",
    "function hostActionQueueTitle(hostFocus = 'components') {",
    "  const focus = normalizeHostFocus(hostFocus);",
    "  if (focus === 'worktrees') return 'Thread Queue';",
    "  if (focus === 'eligible-work') return 'Tracked Work';",
    "  if (focus === 'plugins') return 'Workspace Actions';",
    "  if (focus === 'blockers') return 'Needs Attention';",
    "  return 'Action Queue';",
    "}",
    "",
    "function hostWorkspaceTitle(hostFocus = 'components') {",
    "  const focus = normalizeHostFocus(hostFocus);",
    "  if (focus === 'worktrees') return 'Thread Workspaces';",
    "  if (focus === 'eligible-work') return 'Ready Workspaces';",
    "  if (focus === 'plugins') return 'Plugin Workspaces';",
    "  if (focus === 'blockers') return 'Attention Workspaces';",
    "  return 'Workspaces';",
    "}",
    "",
    "function emptyHostActionText(hostFocus = 'components') {",
    "  const focus = normalizeHostFocus(hostFocus);",
    "  if (focus === 'worktrees') return 'No thread needs action.';",
    "  if (focus === 'eligible-work') return 'No tracked work is ready.';",
    "  if (focus === 'plugins') return 'No plugin-specific action is needed.';",
    "  if (focus === 'blockers') return 'No attention item is waiting.';",
    "  return 'No workspace needs attention.';",
    "}",
    "",
    "function emptyHostWorkspaceText(hostFocus = 'components') {",
    "  const focus = normalizeHostFocus(hostFocus);",
    "  if (focus === 'worktrees') return 'No workspace has active threads.';",
    "  if (focus === 'eligible-work') return 'No workspace reports ready tracked work.';",
    "  if (focus === 'plugins') return 'No workspace reports installed plugins.';",
    "  if (focus === 'blockers') return 'No workspace needs attention.';",
    "  return 'No registered workspace found.';",
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
    "    button.addEventListener('click', () => {",
    "      onSelect(button.getAttribute('data-select-id'));",
    "      const targetId = button.getAttribute('data-scroll-target');",
    "      if (targetId) scrollToDashboardSection(targetId);",
    "    });",
    "  });",
    "}",
    "",
    "function bindHostSignalControls(container, onSelect) {",
    "  container.querySelectorAll('[data-host-focus]').forEach((button) => {",
    "    button.addEventListener('click', () => {",
    "      const focus = normalizeHostFocus(button.getAttribute('data-host-focus'));",
    "      onSelect(focus);",
    "      scrollToDashboardSection(hostSignalTarget(focus));",
    "    });",
    "  });",
    "}",
    "",
    "function bindGitHistoryFilterControls(container, onSelect) {",
    "  container.querySelectorAll('[data-git-history-filter]').forEach((button) => {",
    "    button.addEventListener('click', () => onSelect(button.getAttribute('data-git-history-filter')));",
    "  });",
    "}",
    "",
    "function scrollToDashboardSection(targetId) {",
    "  requestAnimationFrame(() => {",
    "    const target = document.getElementById(targetId);",
    "    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });",
    "  });",
    "}",
    "",
    "function bindWorkspaceControls(container, onSelect) {",
    "  container.querySelectorAll('[data-workspace-id]').forEach((button) => {",
    "    button.addEventListener('click', () => onSelect(button.getAttribute('data-workspace-id'), button.getAttribute('data-workspace-selection-id')));",
    "  });",
    "}",
    "",
    "function bindLocalActions(container, baseUrl = '', actionToken = '', workspaceId = '', onMutation = null) {",
    "  container.querySelectorAll('[data-open-target][data-open-app]').forEach((button) => {",
    "    button.addEventListener('click', async () => {",
    "      const target = button.getAttribute('data-open-target') ?? '';",
    "      const app = button.getAttribute('data-open-app') ?? '';",
    "      const label = button.querySelector('.dn-action-label');",
    "      const originalLabel = label?.textContent ?? '';",
    "      button.disabled = true;",
    "      if (label) label.textContent = 'Opening...';",
    "      try {",
    "        const headers = { 'content-type': 'application/json' };",
    "        if (actionToken) headers['x-dev-nexus-action-token'] = actionToken;",
    "        const response = await fetch(`${baseUrl}/api/local/open${workspaceQuery(workspaceId)}`, {",
    "          method: 'POST',",
    "          headers,",
    "          body: JSON.stringify({ target, app }),",
    "        });",
    "        const payload = await response.json();",
    "        if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);",
    "        if (label) label.textContent = 'Opened';",
    "        button.closest('details')?.removeAttribute('open');",
    "      } catch (error) {",
    "        if (label) label.textContent = 'Setup needed';",
    "        button.title = error instanceof Error ? error.message : String(error);",
    "      } finally {",
    "        setTimeout(() => { if (label) label.textContent = originalLabel; button.disabled = false; }, 1200);",
    "      }",
    "    });",
    "  });",
    "  container.querySelectorAll('[data-thread-action][data-thread-id]').forEach((button) => {",
    "    button.addEventListener('click', async () => {",
    "      const action = button.getAttribute('data-thread-action') ?? '';",
    "      const threadId = button.getAttribute('data-thread-id') ?? '';",
    "      const label = button.querySelector('.dn-action-label');",
    "      const originalLabel = label?.textContent ?? '';",
    "      const busyLabel = action === 'forget' ? 'Forgetting...' : 'Archiving...';",
    "      const doneLabel = action === 'forget' ? 'Forgotten' : 'Archived';",
    "      button.disabled = true;",
    "      if (label) label.textContent = busyLabel;",
    "      try {",
    "        const headers = { 'content-type': 'application/json' };",
    "        if (actionToken) headers['x-dev-nexus-action-token'] = actionToken;",
    "        const response = await fetch(`${baseUrl}/api/dashboard/thread-action${workspaceQuery(workspaceId)}`, {",
    "          method: 'POST',",
    "          headers,",
    "          body: JSON.stringify({ action, threadId }),",
    "        });",
    "        const payload = await response.json();",
    "        if (!response.ok || payload?.ok !== true) throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);",
    "        if (label) label.textContent = doneLabel;",
    "        if (typeof onMutation === 'function') await onMutation();",
    "      } catch (error) {",
    "        if (label) label.textContent = 'Action failed';",
    "        button.title = error instanceof Error ? error.message : String(error);",
    "        setTimeout(() => { if (label) label.textContent = originalLabel; button.disabled = false; }, 1600);",
    "      }",
    "    });",
    "  });",
    "  container.querySelectorAll('[data-copy-prompt], [data-copy-text]').forEach((button) => {",
    "    button.addEventListener('click', async () => {",
    "      const prompt = button.getAttribute('data-copy-text') ?? button.getAttribute('data-copy-prompt') ?? '';",
    "      const label = button.querySelector('.dn-action-label');",
    "      const originalLabel = label?.textContent ?? button.getAttribute('data-copy-reset-label') ?? 'Copy';",
    "      const doneLabel = button.getAttribute('data-copy-done-label') ?? (button.hasAttribute('data-copy-prompt') ? 'Copied prompt' : 'Copied');",
    "      const resetLabel = button.getAttribute('data-copy-reset-label') ?? originalLabel;",
    "      try {",
    "        await navigator.clipboard.writeText(prompt);",
    "        button.dataset.copied = 'true';",
    "        if (label) label.textContent = doneLabel;",
    "      } catch {",
    "        button.dataset.copied = 'error';",
    "        if (label) label.textContent = 'Copy failed';",
    "      }",
    "      setTimeout(() => { delete button.dataset.copied; if (label) label.textContent = resetLabel; }, 1600);",
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
    "  return `<button class=\"dn-signal signal-${escapeAttribute(signal.id)} ${id === selectedId ? 'selected' : ''}\" type=\"button\" data-select-id=\"${escapeHtml(id)}\" data-scroll-target=\"${escapeHtml(signalPanelTarget(signal.id))}\"><span class=\"dn-signal-top\"><span class=\"dn-signal-icon\">${signalIcon(signal.id)}</span><span class=\"dn-label\">${escapeHtml(signal.label)}</span></span><strong>${escapeHtml(signal.value)}</strong><p title=\"${escapeHtml(detail)}\">${escapeHtml(detail)}</p></button>`;",
    "}",
    "",
    "function signalPanelTarget(id) {",
    "  if (id === 'components') return 'components-panel';",
    "  if (id === 'automation') return 'selected-item';",
    "  if (id === 'eligible-work') return 'tracked-work-panel';",
    "  if (id === 'worktrees') return 'hitl-queue';",
    "  if (id === 'blockers') return 'blockers-panel';",
    "  if (id === 'plugins') return 'plugins-panel';",
    "  return 'selected-item';",
    "}",
    "",
    "function renderEvent(event, selectedId) {",
    "  const relatedId = event.relatedNodeIds.find(Boolean) ?? `event:${event.id}`;",
    "  return `<article class=\"dn-event-card\"><button class=\"dn-event ${relatedId === selectedId ? 'selected' : ''}\" type=\"button\" data-select-id=\"${escapeHtml(relatedId)}\"><span class=\"dn-label\">${escapeHtml(formatTime(event.time))} · ${escapeHtml(event.source)}</span><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(formatDisplayText(event.body))}</p></button>${renderActionStrip(event.actions, 'compact')}</article>`;",
    "}",
    "",
    "function renderGitHistory(snapshot, selectedId, filter = 'all') {",
    "  const activeFilter = normalizeGitHistoryFilter(filter);",
    "  const graph = gitHistoryRows(snapshot, activeFilter);",
    "  if (!graph) return `<div class=\"dn-panel dn-git-panel\" id=\"project-git-history\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Git history</span><h2>Project History</h2></div><span class=\"dn-count\">0 commits</span></div><p>No Git history loaded.</p></div>`;",
    "  const repository = graph.repository;",
    "  const count = `${countLabel(graph.rows.length, 'commit')} · ${countLabel(repository.branchNames?.length ?? 0, 'branch', 'branches')}`;",
    "  const note = repository.moreAvailable ? `<p class=\"dn-git-note\">Showing the newest ${repository.commits.length} commits. Branch filters use the loaded commit window.</p>` : '';",
    "  return `<div class=\"dn-panel dn-git-panel\" id=\"project-git-history\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Git history</span><h2>Project History</h2><p class=\"dn-history-note\">Git refs and commit parent relationships are the source of truth.</p></div><span class=\"dn-count\">${escapeHtml(count)}</span></div>${renderGitHistoryFilters(snapshot, repository, activeFilter)}<div class=\"dn-git-board\">${renderGitHistorySvg(graph)}<div class=\"dn-git-rows\">${graph.rows.map((row) => renderGitHistoryRow(snapshot, row, selectedId)).join('')}</div></div>${note}</div>`;",
    "}",
    "",
    "function normalizeGitHistoryFilter(value) {",
    "  const text = String(value ?? '').trim();",
    "  if (!text || text === 'all') return 'all';",
    "  if (text.startsWith('branch:') && text.slice('branch:'.length).trim()) return `branch:${text.slice('branch:'.length).trim()}`;",
    "  if (text.startsWith('feature:') && text.slice('feature:'.length).trim()) return `feature:${text.slice('feature:'.length).trim()}`;",
    "  return 'all';",
    "}",
    "",
    "function renderGitHistoryFilters(snapshot, repository, activeFilter) {",
    "  const filters = gitHistoryFilters(snapshot, repository);",
    "  if (filters.length <= 1) return '';",
    "  return `<div class=\"dn-git-filters\" aria-label=\"Git history filters\">${filters.map((filter) => `<button class=\"dn-git-filter\" type=\"button\" data-git-history-filter=\"${escapeHtml(filter.id)}\" aria-pressed=\"${filter.id === activeFilter ? 'true' : 'false'}\" title=\"${escapeHtml(filter.title ?? filter.label)}\">${escapeHtml(filter.label)}</button>`).join('')}</div>`;",
    "}",
    "",
    "function gitHistoryFilters(snapshot, repository) {",
    "  const filters = [{ id: 'all', label: 'All commits', title: 'Show the loaded project history' }];",
    "  const seen = new Set(filters.map((filter) => filter.id));",
    "  const push = (id, label, title = label) => {",
    "    const normalized = normalizeGitHistoryFilter(id);",
    "    if (seen.has(normalized)) return;",
    "    seen.add(normalized);",
    "    filters.push({ id: normalized, label, title });",
    "  };",
    "  if (repository.defaultBranch) push(`branch:${repository.defaultBranch}`, repository.defaultBranch, `Show ${repository.defaultBranch} and its loaded ancestors`);",
    "  for (const feature of snapshot.features?.records ?? []) {",
    "    const branches = featureGitBranches(feature);",
    "    if (!branches.length) continue;",
    "    push(`feature:${feature.id}`, feature.title, `Show commits reachable from ${feature.title}`);",
    "  }",
    "  const branchNames = gitHistoryBranchNames(repository);",
    "  for (const branch of branchNames) push(`branch:${branch}`, compactBranchName(branch), `Show ${branch} and its loaded ancestors`);",
    "  return filters.slice(0, 18);",
    "}",
    "",
    "function gitHistoryBranchNames(repository) {",
    "  const names = [];",
    "  const seen = new Set();",
    "  const remember = (name) => {",
    "    const normalized = normalizeGitBranchName(name);",
    "    if (!normalized || seen.has(normalized)) return;",
    "    seen.add(normalized);",
    "    names.push(normalized);",
    "  };",
    "  for (const commit of repository.commits ?? []) {",
    "    for (const ref of commit.refs ?? []) {",
    "      if (ref.kind === 'branch' || ref.kind === 'remote') remember(ref.name);",
    "    }",
    "  }",
    "  for (const branch of repository.branchNames ?? []) remember(branch);",
    "  return names;",
    "}",
    "",
    "function featureGitBranches(feature) {",
    "  return [...new Set([feature.featureBranch, ...(feature.branches ?? [])].filter(Boolean).map((branch) => String(branch).trim()).filter(Boolean))];",
    "}",
    "",
    "function normalizeGitBranchName(value) {",
    "  return String(value ?? '').trim().replace(/^refs\\/heads\\//, '').replace(/^refs\\/remotes\\//, '').replace(/^remotes\\//, '');",
    "}",
    "",
    "function filteredGitHistoryCommits(snapshot, repository, filter) {",
    "  const commits = repository.commits ?? [];",
    "  if (filter === 'all') return commits;",
    "  const headHashes = gitHistoryFilterHeadHashes(snapshot, repository, filter);",
    "  if (!headHashes.size) return [];",
    "  const reachable = collectGitAncestorHashes(commits, headHashes);",
    "  return commits.filter((commit) => reachable.has(commit.hash));",
    "}",
    "",
    "function gitHistoryFilterHeadHashes(snapshot, repository, filter) {",
    "  const headHashes = new Set();",
    "  if (filter.startsWith('branch:')) {",
    "    for (const hash of branchHeadHashes(repository, filter.slice('branch:'.length))) headHashes.add(hash);",
    "  } else if (filter.startsWith('feature:')) {",
    "    const id = filter.slice('feature:'.length);",
    "    const feature = (snapshot.features?.records ?? []).find((candidate) => candidate.id === id);",
    "    for (const branch of featureGitBranches(feature ?? {})) {",
    "      for (const hash of branchHeadHashes(repository, branch)) headHashes.add(hash);",
    "    }",
    "  }",
    "  return headHashes;",
    "}",
    "",
    "function branchHeadHashes(repository, branchName) {",
    "  const wanted = normalizeGitBranchName(branchName);",
    "  const hashes = new Set();",
    "  if (!wanted) return hashes;",
    "  for (const commit of repository.commits ?? []) {",
    "    for (const ref of commit.refs ?? []) {",
    "      if (ref.kind !== 'branch' && ref.kind !== 'remote') continue;",
    "      const refName = normalizeGitBranchName(ref.name);",
    "      if (refName === wanted || refName.endsWith(`/${wanted}`)) hashes.add(ref.hash || commit.hash);",
    "    }",
    "  }",
    "  if (!hashes.size && repository.defaultBranch === wanted && repository.head) hashes.add(repository.head);",
    "  return hashes;",
    "}",
    "",
    "function collectGitAncestorHashes(commits, headHashes) {",
    "  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));",
    "  const reachable = new Set();",
    "  const queue = [...headHashes];",
    "  while (queue.length) {",
    "    const hash = queue.shift();",
    "    if (!hash || reachable.has(hash)) continue;",
    "    reachable.add(hash);",
    "    const commit = byHash.get(hash);",
    "    if (!commit) continue;",
    "    for (const parent of commit.parents ?? []) queue.push(parent);",
    "  }",
    "  return reachable;",
    "}",
    "",
    "function gitHistoryRows(snapshot, filter = 'all') {",
    "  const repository = (snapshot.history?.repositories ?? []).find((candidate) => (candidate.commits ?? []).length > 0) ?? null;",
    "  if (!repository) return null;",
    "  const commits = filteredGitHistoryCommits(snapshot, repository, normalizeGitHistoryFilter(filter));",
    "  const knownHashes = new Set(commits.map((commit) => commit.hash));",
    "  const active = [];",
    "  const rows = [];",
    "  const paths = [];",
    "  for (const commit of commits) {",
    "    const index = rows.length;",
    "    let lane = active.findIndex((entry) => entry?.hash === commit.hash);",
    "    let incoming = null;",
    "    if (lane < 0) lane = firstOpenLane(active);",
    "    else {",
    "      incoming = active[lane];",
    "      active[lane] = null;",
    "      addGitHistoryRoutePoint(incoming, lane, index);",
    "      paths.push(gitHistoryPathFromRoute(incoming));",
    "    }",
    "    const row = { repository, commit, lane, colorLane: incoming?.colorLane ?? lane, index, selectId: gitHistorySelectId(repository, commit) };",
    "    rows.push(row);",
    "    const parents = (commit.parents ?? []).filter((parent) => knownHashes.has(parent));",
    "    for (let parentIndex = 0; parentIndex < parents.length; parentIndex++) {",
    "      const parent = parents[parentIndex];",
    "      const existingLane = active.findIndex((entry) => entry?.hash === parent);",
    "      if (existingLane >= 0) {",
    "        const existing = active[existingLane];",
    "        const route = { hash: parent, colorLane: parentIndex === 0 ? row.colorLane : existing?.colorLane ?? existingLane, points: [{ lane, index }] };",
    "        addGitHistoryRoutePoint(route, existingLane, index + 0.85);",
    "        paths.push(gitHistoryPathFromRoute(route));",
    "        continue;",
    "      }",
    "      const preferredLane = parentIndex === 0 && !active[lane] ? lane : firstOpenLane(active);",
    "      const route = { hash: parent, colorLane: parentIndex === 0 ? row.colorLane : preferredLane, points: [{ lane, index }] };",
    "      if (preferredLane !== lane) addGitHistoryRoutePoint(route, preferredLane, index + 0.85);",
    "      active[preferredLane] = route;",
    "    }",
    "    compactGitHistoryActiveLanes(active, index);",
    "  }",
    "  const maxLane = Math.max(0, ...rows.map((row) => row.lane), ...paths.flatMap((path) => path.points.map((point) => point.lane)));",
    "  return { repository, rows, paths, maxLane };",
    "}",
    "",
    "function gitHistoryPathFromRoute(route) {",
    "  const points = route.points.map((point) => ({ lane: point.lane, index: point.index }));",
    "  const first = points[0] ?? { lane: 0, index: 0 };",
    "  const last = points[points.length - 1] ?? first;",
    "  return { colorLane: route.colorLane, fromLane: first.lane, toLane: last.lane, fromIndex: first.index, toIndex: last.index, points };",
    "}",
    "",
    "function addGitHistoryRoutePoint(route, lane, index) {",
    "  if (!route) return;",
    "  const last = route.points[route.points.length - 1];",
    "  if (last && last.lane === lane && last.index === index) return;",
    "  route.points.push({ lane, index });",
    "}",
    "",
    "function compactGitHistoryActiveLanes(active, rowIndex) {",
    "  let write = 0;",
    "  for (let read = 0; read < active.length; read++) {",
    "    const entry = active[read];",
    "    if (!entry) continue;",
    "    if (read !== write) {",
    "      addGitHistoryRoutePoint(entry, read, rowIndex + 0.45);",
    "      addGitHistoryRoutePoint(entry, write, rowIndex + 0.95);",
    "      active[write] = entry;",
    "      active[read] = null;",
    "    }",
    "    write++;",
    "  }",
    "  active.length = write;",
    "}",
    "",
    "function firstOpenLane(active) {",
    "  const index = active.findIndex((value) => !value);",
    "  return index >= 0 ? index : active.length;",
    "}",
    "",
    "function renderGitHistorySvg(graph) {",
    "  const rowHeight = 30;",
    "  const laneGap = 18;",
    "  const offsetX = 22;",
    "  const offsetY = rowHeight / 2;",
    "  const width = Math.max(118, offsetX * 2 + graph.maxLane * laneGap);",
    "  const height = Math.max(rowHeight, graph.rows.length * rowHeight);",
    "  const x = (lane) => offsetX + lane * laneGap;",
    "  const y = (index) => offsetY + index * rowHeight;",
    "  const paths = graph.paths.map((path) => {",
    "    const points = gitHistoryPathPoints(path).map((point) => ({ x: x(point.lane), y: y(point.index) }));",
    "    const color = `var(--dn-branch-${(path.colorLane ?? path.fromLane ?? 0) % 7})`;",
    "    const d = gitHistoryPathD(points, rowHeight);",
    "    return `<path class=\"dn-git-line-shadow\" d=\"${d}\" /><path class=\"dn-git-line\" d=\"${d}\" stroke=\"${color}\" />`;",
    "  }).join('');",
    "  const dots = graph.rows.map((row) => `<circle cx=\"${x(row.lane)}\" cy=\"${y(row.index)}\" r=\"4.5\" fill=\"var(--dn-surface)\" stroke=\"var(--dn-branch-${(row.colorLane ?? row.lane) % 7})\" stroke-width=\"2.5\" />`).join('');",
    "  return `<svg class=\"dn-git-graph\" width=\"${width}\" height=\"${height}\" viewBox=\"0 0 ${width} ${height}\" role=\"img\" aria-label=\"Git commit graph\">${paths}${dots}</svg>`;",
    "}",
    "",
    "function gitHistoryPathPoints(path) {",
    "  if (path.points?.length) return path.points;",
    "  return [{ lane: path.fromLane, index: path.fromIndex }, { lane: path.toLane, index: path.toIndex }];",
    "}",
    "",
    "function gitHistoryPathD(points, rowHeight) {",
    "  if (!points.length) return '';",
    "  let d = `M ${points[0].x} ${points[0].y}`;",
    "  for (let index = 1; index < points.length; index++) {",
    "    const from = points[index - 1];",
    "    const to = points[index];",
    "    if (from.x === to.x) d += ` V ${to.y}`;",
    "    else {",
    "      const curve = Math.min(rowHeight * 0.7, Math.max(8, Math.abs(to.y - from.y) * 0.58));",
    "      d += ` C ${from.x} ${from.y + curve}, ${to.x} ${to.y - curve}, ${to.x} ${to.y}`;",
    "    }",
    "  }",
    "  return d;",
    "}",
    "",
    "function renderGitHistoryRow(snapshot, row, selectedId) {",
    "  const selected = row.selectId === selectedId ? ' selected' : '';",
    "  const refs = (row.commit.refs ?? []).filter((ref) => ref.kind !== 'head').slice(0, 3);",
    "  const refChips = refs.map((ref) => `<span class=\"dn-git-ref\" style=\"--dn-branch-color:var(--dn-branch-${(row.colorLane ?? row.lane) % 7});\" title=\"${escapeHtml(ref.name)}\">${escapeHtml(ref.name)}</span>`).join('');",
    "  const badges = gitHistoryAnnotations(snapshot, row.repository, row.commit).slice(0, 3).map((annotation) => `<span class=\"dn-git-badge tone-${escapeAttribute(annotation.tone)}\" title=\"${escapeHtml(annotation.title ?? annotation.label)}\">${escapeHtml(annotation.label)}</span>`).join('');",
    "  const meta = [row.commit.authorName, formatTime(row.commit.committedAt)].filter(Boolean).join(' · ');",
    "  return `<button class=\"dn-git-history-row${selected}\" type=\"button\" data-select-id=\"${escapeHtml(row.selectId)}\" data-scroll-target=\"selected-item\"><span class=\"dn-git-subject\"><span class=\"dn-git-refs\">${refChips}</span><strong title=\"${escapeHtml(row.commit.subject)}\">${escapeHtml(row.commit.subject)}</strong><span class=\"dn-git-badges\">${badges}</span></span><span class=\"dn-git-meta\">${escapeHtml(meta)}</span><span class=\"dn-git-sha\">${escapeHtml(row.commit.shortHash)}</span></button>`;",
    "}",
    "",
    "function gitHistoryAnnotations(snapshot, repository, commit) {",
    "  const branchNames = gitCommitBranchNames(commit);",
    "  const features = featuresForGitBranches(snapshot, branchNames);",
    "  const threads = threadsForGitBranches(snapshot, branchNames);",
    "  const trackedWork = trackedWorkForGitBranches(snapshot, branchNames);",
    "  const annotations = [];",
    "  for (const feature of features.slice(0, 2)) {",
    "    annotations.push({ kind: 'feature', label: feature.statusLabel ?? feature.status ?? 'Feature', title: feature.title, tone: toneForStatus(feature.status, 'feature'), feature, actions: [] });",
    "  }",
    "  if (threads.length) {",
    "    const needsDecision = threads.filter((thread) => thread.decision === 'review' || thread.decision === 'rescue' || thread.decision === 'blocked').length;",
    "    annotations.push({ kind: 'thread', label: countLabel(threads.length, 'thread'), title: needsDecision ? countLabel(needsDecision, 'action') + ' needed' : 'Active thread', tone: needsDecision ? 'warn' : 'active', threads, actions: threads.flatMap((thread) => thread.actions ?? []) });",
    "  }",
    "  if (trackedWork.length) {",
    "    const blocked = trackedWork.filter((item) => item.kind === 'blocked').length;",
    "    annotations.push({ kind: 'tracked-work', label: countLabel(trackedWork.length, 'issue'), title: blocked ? countLabel(blocked, 'blocker') : 'Tracked work', tone: blocked ? 'danger' : 'active', trackedWork, actions: trackedWork.flatMap((item) => item.actions ?? []) });",
    "  }",
    "  return annotations;",
    "}",
    "",
    "function gitCommitBranchNames(commit) {",
    "  return [...new Set((commit.refs ?? []).filter((ref) => ref.kind === 'branch' || ref.kind === 'remote').map((ref) => normalizeGitBranchName(ref.name)).filter(Boolean))];",
    "}",
    "",
    "function featuresForGitBranches(snapshot, branchNames) {",
    "  return (snapshot.features?.records ?? []).filter((feature) => branchSetsIntersect(branchNames, featureGitBranches(feature)));",
    "}",
    "",
    "function threadsForGitBranches(snapshot, branchNames) {",
    "  return (snapshot.threads?.records ?? []).filter((thread) => branchSetsIntersect(branchNames, [thread.branchName]));",
    "}",
    "",
    "function trackedWorkForGitBranches(snapshot, branchNames) {",
    "  return (snapshot.trackedWork?.records ?? []).filter((item) => branchNames.some((branch) => trackedWorkMentionsBranch(item, branch)));",
    "}",
    "",
    "function trackedWorkMentionsBranch(item, branch) {",
    "  const normalized = normalizeBranchSearchToken(branch);",
    "  if (!normalized) return false;",
    "  const text = normalizeBranchSearchToken([item.id, item.logicalItemId, item.title, item.detail, item.webUrl].filter(Boolean).join(' '));",
    "  return text.includes(normalized) || normalized.split('-').some((token) => token.length > 3 && text.includes(token));",
    "}",
    "",
    "function normalizeBranchSearchToken(value) {",
    "  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');",
    "}",
    "",
    "function branchSetsIntersect(left, right) {",
    "  const normalizedRight = new Set((right ?? []).map(normalizeGitBranchName).filter(Boolean));",
    "  return (left ?? []).map(normalizeGitBranchName).some((branch) => normalizedRight.has(branch) || [...normalizedRight].some((candidate) => candidate.endsWith(`/${branch}`) || branch.endsWith(`/${candidate}`)));",
    "}",
    "",
    "function gitHistorySelectId(repository, commit) {",
    "  return `history:${repository.componentId}:${commit.hash}`;",
    "}",
    "",
    "function renderFeatureOverview(snapshot, selectedId) {",
    "  const features = snapshot.features;",
    "  const records = features?.records ?? [];",
    "  const count = features ? [countLabel(features.activeCount ?? 0, 'active feature'), features.needsAttentionCount ? countLabel(features.needsAttentionCount, 'needs review') : null].filter(Boolean).join(' · ') : '0 active features';",
    "  const note = features?.incomplete && features.detail ? `<p class=\"dn-panel-note\">${escapeHtml(features.detail)}</p>` : '';",
    "  const visible = records.slice(0, 6);",
    "  const more = records.length > visible.length ? `<div class=\"dn-feature-more\">${escapeHtml(countLabel(records.length - visible.length, 'more feature'))}</div>` : '';",
    "  const body = records.length ? `${visible.map((feature) => renderFeatureCard(feature, selectedId)).join('')}${more}` : '<p>No active feature branch delivery configured.</p>';",
    "  return `<div class=\"dn-panel dn-feature-panel\" id=\"active-features\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Project workflow</span><h2>Active Features</h2></div><span class=\"dn-count\">${escapeHtml(count)}</span></div>${note}<div class=\"dn-feature-list\">${body}</div></div>`;",
    "}",
    "",
    "function renderFeatureCard(feature, selectedId) {",
    "  const selected = feature.id === selectedId ? ' selected' : '';",
    "  const tone = feature.tone ?? toneForStatus(feature.status, 'feature');",
    "  const meta = [feature.branchStrategy, feature.featureBranch ?? feature.reviewBranchPattern, countLabel(feature.branchCount ?? 0, 'branch'), countLabel(feature.threadCount ?? 0, 'thread')].filter(Boolean);",
    "  return `<button class=\"dn-feature-card tone-${escapeAttribute(tone)}${selected}\" type=\"button\" data-select-id=\"${escapeHtml(feature.id)}\" data-scroll-target=\"selected-item\"><span class=\"dn-feature-title\"><strong title=\"${escapeHtml(feature.title)}\">${escapeHtml(feature.title)}</strong><span class=\"dn-feature-status\">${escapeHtml(feature.statusLabel ?? feature.status)}</span></span><p title=\"${escapeHtml(formatDisplayText(feature.detail))}\">${escapeHtml(formatDisplayText(feature.detail))}</p><span class=\"dn-feature-meta\">${meta.map((item) => `<span title=\"${escapeHtml(item)}\">${escapeHtml(item)}</span>`).join('')}</span></button>`;",
    "}",
    "",
    "function renderWorkHistory(snapshot, selectedId) {",
    "  const timeline = historyRows(snapshot);",
    "  const rows = timeline.rows;",
    "  const reader = '<div class=\"dn-map-reader\"><span>Not Git history</span><span>Each rail is a workspace category</span><span>Rows are current records</span><span>Click a row for actions</span></div>';",
    "  return `<div class=\"dn-panel dn-history-panel\" id=\"parallel-work-map\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Workspace map</span><h2>Activity Lanes</h2><p class=\"dn-history-note\">Current workspace records grouped by source checkout, active branches, automation, and decisions.</p>${reader}</div><span class=\"dn-count\">${countLabel(rows.length, 'record')} · ${countLabel(timeline.lanes.length, 'lane')}</span></div>${renderLaneKey(timeline.lanes)}<div class=\"dn-branch-board\" role=\"list\">${renderBranchGraph(rows, timeline.lanes)}<div class=\"dn-history-rows\">${rows.map((row) => renderHistoryItem(row, selectedId)).join('')}</div></div></div>`;",
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
    "  return `<div class=\"dn-lane-key\" aria-label=\"Work map lanes\">${lanes.map((lane) => `<span style=\"--dn-branch-color:var(--dn-branch-${lane.index});\" title=\"${escapeHtml(`${lane.label}: ${lane.detail ?? lane.shortLabel}`)}\"><strong>${escapeHtml(lane.label)}</strong><em>${escapeHtml(lane.detail ?? lane.shortLabel)}</em></span>`).join('')}</div>`;",
    "}",
    "",
    "function renderSelectedItem(snapshot, selectedId) {",
    "  const detail = selectedDetail(snapshot, selectedId);",
    "  const body = formatDisplayText(detail.body);",
    "  const actions = `${renderActionStrip(detail.actions)}${renderChatActionStrip(detail.chat)}` || '<p>No direct action for this item.</p>';",
    "  const evidence = `<dl class=\"dn-detail-grid\">${detail.facts.slice(0, 6).map((fact) => { const value = formatDisplayText(fact[1]); return `<div><dt>${escapeHtml(fact[0])}</dt><dd title=\"${escapeHtml(value)}\">${escapeHtml(truncate(value, 90))}</dd></div>`; }).join('')}</dl>${detail.events.length ? `<div class=\"dn-related\"><span class=\"dn-label\">Related activity</span>${detail.events.slice(0, 2).map((event) => `<article><strong>${escapeHtml(truncate(event.title, 70))}</strong><p>${escapeHtml(truncate(formatDisplayText(event.body), 120))}</p>${renderActionStrip(event.actions, 'compact')}</article>`).join('')}</div>` : ''}`;",
    "  return `<section class=\"dn-panel dn-selected-panel\" id=\"selected-item\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Selected item</span><h2>${escapeHtml(truncate(detail.title, 88))}</h2></div><span class=\"dn-count\">${escapeHtml(detail.events.length ? `${detail.events.length} related` : 'in focus')}</span></div><div class=\"dn-selected-layout\"><article class=\"dn-selected-section\"><span class=\"dn-label\">Summary</span><p title=\"${escapeHtml(body)}\">${escapeHtml(truncate(body, 220))}</p></article><article class=\"dn-selected-section\"><span class=\"dn-label\">Actions</span>${actions}</article><article class=\"dn-selected-section\"><span class=\"dn-label\">Evidence</span>${evidence}</article><article class=\"dn-selected-section\"><span class=\"dn-label\">Diagnostics</span><div class=\"dn-diagnostic-pills\"><span>${escapeHtml(countLabel(detail.facts.length, 'fact'))}</span><span>${escapeHtml(countLabel(detail.actions.length, 'link'))}</span><span>${escapeHtml(countLabel(detail.events.length, 'event'))}</span></div></article></div></section>`;",
    "}",
    "",
    "function renderComponents(components, selectedId) {",
    "  return `<div class=\"dn-component-grid\">${components.map((component) => { const id = `component:${component.id}`; const git = component.git; const loading = component.sourceRootExists && !git; const tone = git?.dirty ? 'warn' : component.sourceRootExists ? (loading ? 'neutral' : 'good') : 'danger'; const branch = git?.branch ?? (loading ? 'loading branch' : 'missing branch'); const state = git ? (git.dirty ? 'dirty' : 'clean') : (loading ? 'loading' : 'missing'); return `<button class=\"dn-component-card ${id === selectedId ? 'selected' : ''}\" type=\"button\" data-select-id=\"${escapeHtml(id)}\"><span class=\"dn-card-title\"><strong>${escapeHtml(component.name)}</strong><span class=\"dn-dot tone-${tone}\"></span></span><span class=\"dn-label\">${escapeHtml(component.role)} · ${escapeHtml(component.defaultTrackerId ?? 'no tracker')}</span><span class=\"dn-card-meta\">${escapeHtml(branch)} · ${escapeHtml(state)}</span></button>`; }).join('')}</div>`;",
    "}",
    "",
    "function renderThreadInbox(snapshot, selectedId) {",
    "  const threads = snapshot.threads?.records ?? [];",
    "  const count = snapshot.threads ? [`${countLabel(snapshot.threads.needsDecisionCount, 'action')} needed`, snapshot.threads.incomplete ? 'local first' : null].filter(Boolean).join(' · ') : '0 actions needed';",
    "  const note = snapshot.threads?.incomplete && snapshot.threads.detail ? `<p class=\"dn-panel-note\">${escapeHtml(snapshot.threads.detail)}</p>` : '';",
    "  const body = threads.length ? threads.slice(0, 5).map((thread) => renderThreadCard(thread, selectedId)).join('') : '<p>No open threads.</p>';",
    "  return `<div class=\"dn-panel dn-thread-panel\" id=\"hitl-queue\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">HITL queue</span><h2>Action Needed</h2></div><span class=\"dn-count\">${escapeHtml(count)}</span></div>${note}<div class=\"dn-thread-list\">${body}</div></div>`;",
    "}",
    "",
    "function renderThreadCard(thread, selectedId) {",
    "  const selectId = threadSelectId(thread);",
    "  const selected = selectId === selectedId ? ' selected' : '';",
    "  const meta = [thread.componentId ?? 'workspace', thread.workItemId, thread.hostId, `updated ${formatTime(thread.updatedAt)}`].filter(Boolean).join(' · ');",
    "  return `<article class=\"dn-thread-card${selected}\"><button class=\"dn-thread-button\" type=\"button\" data-select-id=\"${escapeHtml(selectId)}\" data-scroll-target=\"selected-item\"><div class=\"dn-thread-card-header\"><span class=\"dn-thread-main\"><strong>${escapeHtml(thread.title)}</strong><span class=\"dn-card-meta\">${escapeHtml(meta)}</span></span><span class=\"dn-thread-decision decision-${escapeAttribute(thread.decision)}\">${escapeHtml(thread.decisionLabel)}</span></div><p title=\"${escapeHtml(thread.decisionDetail)}\">${escapeHtml(formatDisplayText(thread.decisionDetail))}</p></button>${renderThreadActions(thread)}</article>`;",
    "}",
    "",
    "function threadSelectId(thread) {",
    "  return `thread:${thread.id}`;",
    "}",
    "",
    "function renderThreadActions(thread) {",
    "  const links = uniqueActions(thread.actions ?? []).slice(0, 2).map((action) => renderProviderAction(action)).join('');",
    "  const policyAction = renderThreadPolicyAction(thread);",
    "  const prompt = cockpitThreadPrompt(thread);",
    "  const title = `Continue ${thread.title}`;",
    "  return `<div class=\"dn-action-strip compact\">${links}${policyAction}${renderChatButtons({ prompt, title, targetId: `thread:${thread.id}`, resumeThreadId: thread.assistantThreadId })}</div>`;",
    "}",
    "",
    "function renderThreadPolicyAction(thread) {",
    "  if (thread.decision === 'archive') return renderThreadLocalAction(thread, 'archive', 'Archive');",
    "  if (thread.decision === 'forget') return renderThreadLocalAction(thread, 'forget', 'Forget');",
    "  return '';",
    "}",
    "",
    "function renderThreadLocalAction(thread, action, label) {",
    "  return `<button class=\"dn-action dn-local-action\" type=\"button\" data-thread-action=\"${escapeHtml(action)}\" data-thread-id=\"${escapeHtml(thread.id)}\" title=\"${escapeHtml(`${label} locally; no files are deleted`)}\">${signalIcon('worktrees')}<span class=\"dn-action-label\">${escapeHtml(label)}</span></button>`;",
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
    "  return `<button class=\"dn-action dn-start-action\" type=\"button\" data-start-chat-prompt=\"${escapeHtml(chat.prompt)}\" data-start-chat-title=\"${escapeHtml(title)}\" data-chat-target-id=\"${escapeHtml(targetId)}\" data-chat-resume=\"${resume ? 'true' : 'false'}\">${chatIcon()}<span class=\"dn-action-label\">${primaryLabel}</span></button><button class=\"dn-action dn-local-action\" type=\"button\" data-copy-prompt=\"${escapeHtml(chat.prompt)}\">${clipboardIcon()}<span class=\"dn-action-label\">Copy prompt</span></button>`;",
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
    "function renderTrackedWork(snapshot, selectedId) {",
    "  const tracked = snapshot.trackedWork;",
    "  const records = tracked?.records ?? [];",
    "  const count = tracked ? [tracked.blockedCount ? countLabel(tracked.blockedCount, 'blocked item') : null, countLabel(tracked.readyCount, 'ready item'), countLabel(tracked.importCandidateCount, 'import candidate'), countLabel(tracked.staleCount, 'stale item'), tracked.incomplete ? 'local first' : null].filter(Boolean).join(' · ') : '0 ready items';",
    "  const note = tracked?.incomplete && tracked.detail ? `<p class=\"dn-panel-note\">${escapeHtml(tracked.detail)}</p>` : '';",
    "  const body = records.length ? records.slice(0, 8).map((item) => renderTrackedWorkCard(item, selectedId)).join('') : '<p>No tracked work is waiting.</p>';",
    "  return `<div class=\"dn-panel dn-tracked-panel\" id=\"tracked-work-panel\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Tracked work</span><h2>Issues and Work Items</h2></div><span class=\"dn-count\">${escapeHtml(count)}</span></div>${note}<div class=\"dn-tracked-list\">${body}</div></div>`;",
    "}",
    "",
    "function renderTrackedWorkCard(item, selectedId) {",
    "  const selectId = trackedWorkSelectId(item);",
    "  const selected = selectId === selectedId ? ' selected' : '';",
    "  const meta = [item.componentName || item.componentId, item.provider, item.trackerId, item.updatedAt ? `updated ${formatTime(item.updatedAt)}` : null].filter(Boolean).join(' · ');",
    "  const detail = formatDisplayText(item.detail);",
    "  return `<article class=\"dn-tracked-card kind-${escapeAttribute(item.kind)}${selected}\"><button class=\"dn-tracked-button\" type=\"button\" data-select-id=\"${escapeHtml(selectId)}\"><div class=\"dn-tracked-card-header\"><span class=\"dn-thread-main\"><strong title=\"${escapeHtml(item.title)}\">${escapeHtml(item.title)}</strong><span class=\"dn-card-meta\">${escapeHtml(meta)}</span></span><span class=\"dn-thread-decision decision-${trackedWorkDecisionClass(item)}\">${escapeHtml(item.kindLabel)}</span></div><p title=\"${escapeHtml(detail)}\">${escapeHtml(detail)}</p></button>${renderActionStrip(item.actions, 'compact')}</article>`;",
    "}",
    "",
    "function trackedWorkSelectId(item) {",
    "  return `tracked-work:${item.componentId}:${item.id}`;",
    "}",
    "",
    "function trackedWorkBySelectId(snapshot, id) {",
    "  return (snapshot.trackedWork?.records ?? []).find((item) => trackedWorkSelectId(item) === id) ?? null;",
    "}",
    "",
    "function trackedWorkDecisionClass(item) {",
    "  if (item.status === 'blocked' || item.kind === 'blocked') return 'blocked';",
    "  if (item.kind === 'ready') return 'continue';",
    "  if (item.kind === 'stale') return 'rescue';",
    "  if (item.kind === 'import-candidate') return 'review';",
    "  return 'archive';",
    "}",
    "",
    "function renderPlugins(plugins) {",
    "  const records = plugins?.records ?? [];",
    "  const available = plugins?.availableCount ?? records.filter((plugin) => plugin.source === 'local' || plugin.state === 'available').length;",
    "  const disabled = records.filter((plugin) => plugin.source !== 'local' && !plugin.enabled).length;",
    "  const countParts = [countLabel(plugins?.enabledCount ?? 0, 'enabled plugin')];",
    "  if (available) countParts.push(countLabel(available, 'available plugin'));",
    "  if (disabled) countParts.push(countLabel(disabled, 'disabled plugin'));",
    "  if (plugins?.capabilityCount) countParts.push(countLabel(plugins.capabilityCount, 'capability', 'capabilities'));",
    "  const count = countParts.join(' · ');",
    "  const body = records.length ? records.map(renderPluginCard).join('') : '<p>No DevNexus plugins installed.</p>';",
    "  return `<div class=\"dn-panel dn-plugin-panel\" id=\"plugins-panel\"><div class=\"dn-panel-heading\"><div><span class=\"dn-eyebrow\">Extensions</span><h2>Plugins</h2></div><span class=\"dn-count\">${escapeHtml(count)}</span></div><div class=\"dn-plugin-list\">${body}</div><p class=\"dn-plugin-note\">Local plugin candidates copy a refresh command. Direct install stays policy-gated.</p></div>`;",
    "}",
    "",
    "function renderPluginCard(plugin) {",
    "  const state = plugin.state ?? (plugin.enabled ? 'enabled' : 'disabled');",
    "  const stateClass = state === 'enabled' ? 'continue' : state === 'available' ? 'review' : 'archive';",
    "  const detail = plugin.detail || [countLabel(plugin.projectedSkillCount, 'skill'), countLabel(plugin.mcpServerCount, 'MCP server'), countLabel(plugin.setupActionCount, 'setup step'), countLabel(plugin.dependencyProjectionCount, 'dependency', 'dependencies')].join(' · ');",
    "  const meta = [plugin.packageName || plugin.id, plugin.version, plugin.sourcePath ? compactPath(plugin.sourcePath) : null].filter(Boolean).join(' · ');",
    "  const pills = pluginPills(plugin);",
    "  const action = renderPluginPolicyAction(plugin);",
    "  return `<article class=\"dn-plugin-card\"><div class=\"dn-plugin-card-header\"><strong>${escapeHtml(plugin.name)}</strong><span class=\"dn-thread-decision decision-${stateClass}\">${escapeHtml(state)}</span></div><span class=\"dn-card-meta\">${escapeHtml(meta)}</span><p>${escapeHtml(detail)}</p>${pills}${action}</article>`;",
    "}",
    "",
    "function renderPluginPolicyAction(plugin) {",
    "  if (plugin.state === 'available') {",
    "    if (!plugin.refreshCommand) return `<div class=\"dn-action-strip compact\">${renderDisabledAction('Refresh unavailable', 'No local plugin refresh command is available', signalIcon('plugins'))}</div>`;",
    "    return `<div class=\"dn-action-strip compact\"><button class=\"dn-action dn-local-action\" type=\"button\" data-copy-text=\"${escapeHtml(plugin.refreshCommand)}\" data-copy-done-label=\"Copied command\" data-copy-reset-label=\"Copy command\" title=\"Copy the plugin refresh command\">${clipboardIcon()}<span class=\"dn-action-label\">Copy command</span></button></div>`;",
    "  }",
    "  if (!plugin.enabled) return `<div class=\"dn-action-strip compact\">${renderDisabledAction('Enable unavailable', 'Needs plugin enable policy', signalIcon('plugins'))}</div>`;",
    "  if (plugin.setupActionCount > 0) return `<div class=\"dn-action-strip compact\">${renderDisabledAction('Setup unavailable', 'Needs plugin setup policy', signalIcon('plugins'))}</div>`;",
    "  return '';",
    "}",
    "",
    "function pluginPills(plugin) {",
    "  const values = [",
    "    ...(plugin.projectedSkills ?? []).map((skill) => `Skill: ${skill}`),",
    "    ...(plugin.mcpServers ?? []).map((server) => `MCP: ${server}`),",
    "    ...(plugin.setupHints ?? []).map((hint) => `Setup: ${hint}`),",
    "    ...(plugin.dependencyHints ?? []).map((hint) => `Deps: ${hint}`),",
    "  ].slice(0, 6);",
    "  if (!values.length) return '';",
    "  return `<div class=\"dn-plugin-pills\">${values.map((value) => `<span title=\"${escapeHtml(value)}\">${escapeHtml(truncate(value, 44))}</span>`).join('')}</div>`;",
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
    "  return `<div class=\"${className}\">${visibleActions.map((action) => renderProviderAction(action)).join('')}</div>`;",
    "}",
    "",
    "function renderDisabledAction(label, title, icon = signalIcon('blockers')) {",
    "  return `<button class=\"dn-action dn-policy-action\" type=\"button\" disabled title=\"${escapeHtml(title)}\" aria-label=\"${escapeHtml(title)}\">${icon}<span class=\"dn-action-label\">${escapeHtml(label)}</span></button>`;",
    "}",
    "",
    "function renderProviderAction(action) {",
    "  const provider = action.provider ?? 'web';",
    "  const kind = action.kind ?? 'provider-link';",
    "  const label = actionChipLabel(action);",
    "  return `<a class=\"dn-action provider-${escapeAttribute(provider)} kind-${escapeAttribute(kind)}\" href=\"${escapeHtml(action.href)}\" target=\"_blank\" rel=\"noopener noreferrer\" title=\"${escapeHtml(externalActionLabel(action))}\" aria-label=\"${escapeHtml(externalActionLabel(action))}\">${providerIcon(provider)}<span class=\"dn-action-label\">${escapeHtml(label)}</span>${externalLinkIcon()}</a>`;",
    "}",
    "",
    "function actionChipLabel(action) {",
    "  const label = action.label ?? 'Open provider';",
    "  if (action.title && (action.kind === 'issue' || action.kind === 'pull-request')) return `${providerRecordId(action)}: ${action.title}`;",
    "  if (action.kind === 'issue') return label.replace(/^Open issue #/u, '#');",
    "  if (action.kind === 'pull-request') return label.replace(/^Open PR #/u, 'PR #');",
    "  if (label === 'Open repository') return 'Repository';",
    "  return label.replace(/^Open /u, '');",
    "}",
    "",
    "function providerRecordId(action) {",
    "  const label = action.label ?? '';",
    "  const pr = /PR #(\\d+)/iu.exec(label);",
    "  if (pr) return `PR #${pr[1]}`;",
    "  const issue = /#(\\d+)/u.exec(label);",
    "  if (issue) return `#${issue[1]}`;",
    "  return action.kind === 'pull-request' ? 'PR' : 'Issue';",
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
    "function folderIcon() {",
    "  return '<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M1.5 4.5A1.5 1.5 0 013 3h3l1.2 1.5H13A1.5 1.5 0 0114.5 6v6A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12z\"/></svg>';",
    "}",
    "",
    "function chevronDownIcon() {",
    "  return '<svg class=\"dn-open-chevron\" viewBox=\"0 0 12 12\" aria-hidden=\"true\"><path d=\"M3.25 4.75 6 7.25l2.75-2.5\"/></svg>';",
    "}",
    "",
    "function codeIcon() {",
    "  return '<svg class=\"dn-app-icon dn-app-icon-vscode\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><path d=\"M13.9 2.1 10.7.7 5.6 5.6 2.5 3.3 1.1 4 4.2 8l-3.1 4 1.4.7 3.1-2.3 5.1 4.9 3.2-1.4V2.1zM10.6 5v6L7.2 8l3.4-3z\"/></svg>';",
    "}",
    "",
    "function localAppIcon(app, fallback) {",
    "  const src = `/api/local/app-icon?app=${encodeURIComponent(app)}`;",
    "  return `<span class=\"dn-app-icon-shell\"><img class=\"dn-app-icon-img\" src=\"${src}\" alt=\"\" aria-hidden=\"true\" onload=\"this.style.opacity='1';this.nextElementSibling.style.display='none'\" onerror=\"this.remove()\">${fallback}</span>`;",
    "}",
    "",
    "function finderIcon() {",
    "  return '<svg class=\"dn-app-icon dn-app-icon-finder\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><rect class=\"finder-left\" x=\"1.8\" y=\"2\" width=\"12.4\" height=\"12\" rx=\"2\"/><path class=\"finder-right\" d=\"M8 2h4.2A2 2 0 0114.2 4v8a2 2 0 01-2 2H8z\"/><path d=\"M8 2v12M4.6 6.1h.01M11.4 6.1h.01M5 10.4c1.8 1 4.2 1 6 0\"/></svg>';",
    "}",
    "",
    "function terminalIcon() {",
    "  return '<svg class=\"dn-app-icon dn-app-icon-terminal\" viewBox=\"0 0 16 16\" aria-hidden=\"true\"><rect x=\"1.8\" y=\"2.5\" width=\"12.4\" height=\"11\" rx=\"2\"/><path d=\"M4.2 6.2 6.2 8l-2 1.8M8.2 10.1h3.5\"/></svg>';",
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
    "    const dedicatedLane = laneKey !== 'worktrees';",
    "    const scope = [worktree.componentId, worktree.workItemId, worktree.hostId].filter(Boolean).join(' · ');",
    "    const detail = dedicatedLane ? `${compactBranchName(branch)} · ${scope || 'worktree'} · updated ${formatTime(worktree.updatedAt)}` : `${scope || 'worktree'} · updated ${formatTime(worktree.updatedAt)}`;",
    "    addRow(node, laneKey, dedicatedLane ? worktreeRowTitle(worktree) : compactBranchName(branch), detail);",
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
    "  const source = snapshot.project.defaultBranch ?? 'main';",
    "  const lanes = [{ key: 'main', label: 'Source checkout', shortLabel: 'Source', detail: `${source} component heads`, index: 0 }];",
    "  const seen = new Set(['main']);",
    "  const activeWorktrees = snapshot.worktrees.records.filter((worktree) => worktree.branchName);",
    "  let representedWorktrees = 0;",
    "  for (const worktree of activeWorktrees) {",
    "    if (lanes.length >= 3) break;",
    "    const key = worktreeLaneKey(worktree);",
    "    if (seen.has(key)) continue;",
    "    seen.add(key);",
    "    representedWorktrees += 1;",
    "    const branch = compactBranchName(worktree.branchName ?? worktree.id);",
    "    lanes.push({ key, label: 'Active branch', shortLabel: 'Branch', detail: branch, index: lanes.length });",
    "  }",
    "  const remainingWorktrees = Math.max(0, activeWorktrees.length - representedWorktrees);",
    "  lanes.push({ key: 'worktrees', label: 'More branches', shortLabel: 'More', detail: remainingWorktrees ? countLabel(remainingWorktrees, 'grouped branch', 'grouped branches') : 'Grouped active branches', index: lanes.length });",
    "  lanes.push({ key: 'cycles', label: 'Automation', shortLabel: 'Automation', detail: 'Runs and target cycles', index: lanes.length });",
    "  lanes.push({ key: 'policy', label: 'Decisions', shortLabel: 'Decisions', detail: 'Approvals and blockers', index: lanes.length });",
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
    "function worktreeRowTitle(worktree) {",
    "  if (worktree.workItemId) return worktree.workItemId;",
    "  if (worktree.componentId) return `${worktree.componentId} worktree`;",
    "  return worktree.id;",
    "}",
    "",
    "function renderBranchGraph(rows, lanes) {",
    "  const rowHeight = 34;",
    "  const height = Math.max(rowHeight, rows.length * rowHeight);",
    "  const xForLane = (lane) => 22 + lane * 18;",
    "  const railTop = rowHeight / 2;",
    "  const railBottom = Math.max(railTop, height - rowHeight / 2);",
    "  const rails = lanes.map((lane) => `<path d=\"M ${xForLane(lane.index)} ${railTop} V ${railBottom}\" stroke=\"var(--dn-branch-${lane.index})\" stroke-width=\"3\" opacity=\"0.58\" />`).join('');",
    "  const rowGuides = rows.map((row, index) => {",
    "    const y = index * rowHeight + rowHeight / 2;",
    "    const x = xForLane(row.lane);",
    "    return `<path d=\"M ${x} ${y} H 118\" stroke=\"var(--dn-branch-${row.lane})\" stroke-width=\"2\" opacity=\"0.34\" />`;",
    "  }).join('');",
    "  return `<svg class=\"dn-branch-svg\" width=\"122\" height=\"${height}\" viewBox=\"0 0 122 ${height}\" aria-hidden=\"true\" data-row-height=\"${rowHeight}\">${rails}${rowGuides}</svg>`;",
    "}",
    "",
    "function compareTimelineRows(left, right) {",
    "  if (left.lane !== right.lane) return left.lane - right.lane;",
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
    "  const urgentFeature = (snapshot.features?.records ?? []).find((candidate) => candidate.status === 'blocked' || candidate.status === 'needs-review');",
    "  if (urgentFeature) return urgentFeature.id;",
    "  const commit = firstGitHistoryCommit(snapshot);",
    "  if (commit) return gitHistorySelectId(commit.repository, commit.commit);",
    "  const feature = (snapshot.features?.records ?? [])[0];",
    "  if (feature) return feature.id;",
    "  const node = snapshot.weave.nodes.find((candidate) => ['blocked', 'failed', 'dirty', 'missing'].includes(candidate.status)) ?? snapshot.weave.nodes.find((candidate) => candidate.kind === 'project') ?? snapshot.weave.nodes[0];",
    "  return node?.id ?? `signal:${snapshot.signals[0]?.id ?? 'components'}`;",
    "}",
    "",
    "function findSelectableById(snapshot, id) {",
    "  if (!id) return false;",
    "  if (String(id).startsWith('signal:')) return snapshot.signals.some((signal) => `signal:${signal.id}` === id);",
    "  if (String(id).startsWith('history:')) return Boolean(gitHistoryCommitBySelectId(snapshot, id));",
    "  if (String(id).startsWith('feature:')) return Boolean(featureBySelectId(snapshot, id));",
    "  if (String(id).startsWith('tracked-work:')) return Boolean(trackedWorkBySelectId(snapshot, id));",
    "  if (String(id).startsWith('thread:')) return Boolean(threadBySelectId(snapshot, id));",
    "  return snapshot.weave.nodes.some((node) => node.id === id);",
    "}",
    "",
    "function selectedDetail(snapshot, selectedId) {",
    "  const id = findSelectableById(snapshot, selectedId) ? selectedId : defaultSelectedId(snapshot);",
    "  if (String(id).startsWith('signal:')) return signalDetail(snapshot, id);",
    "  if (String(id).startsWith('history:')) return gitHistoryDetail(snapshot, id);",
    "  if (String(id).startsWith('feature:')) return featureDetail(snapshot, id);",
    "  if (String(id).startsWith('tracked-work:')) return trackedWorkDetail(snapshot, id);",
    "  if (String(id).startsWith('thread:')) return threadDetail(snapshot, id);",
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
    "function firstGitHistoryCommit(snapshot) {",
    "  const repository = (snapshot.history?.repositories ?? []).find((candidate) => (candidate.commits ?? []).length > 0) ?? null;",
    "  const commit = repository?.commits?.[0] ?? null;",
    "  return repository && commit ? { repository, commit } : null;",
    "}",
    "",
    "function gitHistoryCommitBySelectId(snapshot, id) {",
    "  const parts = String(id).split(':');",
    "  const componentId = parts[1];",
    "  const hash = parts.slice(2).join(':');",
    "  const repository = (snapshot.history?.repositories ?? []).find((candidate) => candidate.componentId === componentId) ?? null;",
    "  const commit = repository?.commits?.find((candidate) => candidate.hash === hash) ?? null;",
    "  return repository && commit ? { repository, commit } : null;",
    "}",
    "",
    "function gitHistoryDetail(snapshot, id) {",
    "  const match = gitHistoryCommitBySelectId(snapshot, id);",
    "  const commit = match?.commit;",
    "  const repository = match?.repository;",
    "  const refs = (commit?.refs ?? []).filter((ref) => ref.kind !== 'head').map((ref) => ref.name).join(', ') || 'none';",
    "  const annotations = commit && repository ? gitHistoryAnnotations(snapshot, repository, commit) : [];",
    "  const facts = [",
    "    ['Type', 'commit'],",
    "    ['Component', repository?.componentName ?? repository?.componentId ?? 'workspace'],",
    "    ['Commit', commit?.shortHash ?? 'unknown'],",
    "    ['Parents', String(commit?.parents?.length ?? 0)],",
    "    ['Author', commit?.authorName ?? 'unknown'],",
    "    ['Refs', refs],",
    "  ];",
    "  const featureNames = annotations.filter((annotation) => annotation.kind === 'feature').map((annotation) => annotation.title).filter(Boolean);",
    "  const threadCount = annotations.filter((annotation) => annotation.kind === 'thread').reduce((total, annotation) => total + (annotation.threads?.length ?? 0), 0);",
    "  const issueCount = annotations.filter((annotation) => annotation.kind === 'tracked-work').reduce((total, annotation) => total + (annotation.trackedWork?.length ?? 0), 0);",
    "  if (featureNames.length) facts.push(['Feature', featureNames.join(', ')]);",
    "  if (threadCount) facts.push(['Threads', String(threadCount)]);",
    "  if (issueCount) facts.push(['Tracked work', String(issueCount)]);",
    "  if (commit?.committedAt) facts.push(['Time', formatTime(commit.committedAt)]);",
    "  const actions = uniqueActions(annotations.flatMap((annotation) => annotation.actions ?? []));",
    "  return { title: commit?.subject ?? 'Commit', body: commit?.subject ?? 'Git commit.', facts, events: [], actions, chat: null };",
    "}",
    "",
    "function featureBySelectId(snapshot, id) {",
    "  return (snapshot.features?.records ?? []).find((feature) => feature.id === id) ?? null;",
    "}",
    "",
    "function featureDetail(snapshot, id) {",
    "  const feature = featureBySelectId(snapshot, id);",
    "  const facts = [",
    "    ['Type', 'feature'],",
    "    ['Status', feature?.statusLabel ?? 'unknown'],",
    "    ['Branch strategy', feature?.branchStrategy ?? 'unknown'],",
    "    ['Feature branch', feature?.featureBranch ?? 'none'],",
    "    ['Review branches', feature?.reviewBranchPattern ?? 'none'],",
    "    ['Target branch', feature?.finalPublicationTarget ?? 'unknown'],",
    "  ];",
    "  if (feature?.updatedAt) facts.push(['Updated', formatTime(feature.updatedAt)]);",
    "  const actions = [];",
    "  const detail = { title: feature?.title ?? 'Feature', body: feature?.detail ?? 'Feature branch delivery plan.', facts, events: [], actions };",
    "  return { ...detail, chat: { prompt: featurePrompt(feature ?? detail), title: `Continue ${detail.title}`, targetId: id } };",
    "}",
    "",
    "function featurePrompt(feature) {",
    "  const lines = [",
    "    sentenceLine('Continue feature', feature.title),",
    "    sentenceLine('Status', feature.statusLabel ?? feature.status),",
    "    sentenceLine('Branch strategy', feature.branchStrategy),",
    "    sentenceLine('Feature branch', feature.featureBranch),",
    "    sentenceLine('Review branches', feature.reviewBranchPattern),",
    "    sentenceLine('Target branch', feature.finalPublicationTarget),",
    "    'Inspect the feature state, preserve unrelated changes, and recommend the next safe action.'",
    "  ].filter(Boolean);",
    "  return lines.join('\\n');",
    "}",
    "",
    "function trackedWorkDetail(snapshot, id) {",
    "  const item = trackedWorkBySelectId(snapshot, id);",
    "  const actions = uniqueActions(item?.actions ?? []);",
    "  const events = relatedEvents(snapshot, `work-item:${item?.componentId}-${item?.id}`);",
    "  const facts = [",
    "    ['Type', 'tracked work'],",
    "    ['Status', item?.status ?? 'unknown'],",
    "    ['Component', item?.componentName ?? item?.componentId ?? 'workspace'],",
    "    ['Provider', item?.provider ?? 'local'],",
    "    ['Tracker', item?.trackerId ?? 'none'],",
    "  ];",
    "  if (item?.updatedAt) facts.push(['Updated', formatTime(item.updatedAt)]);",
    "  const detail = { title: item?.title ?? 'Tracked work', body: item?.detail ?? 'Tracked work needs review.', facts, events, actions: uniqueActions([...actions, ...events.flatMap((event) => event.actions ?? [])]) };",
    "  return { ...detail, chat: { prompt: detailPrompt(detail), title: `Continue ${detail.title}`, targetId: id } };",
    "}",
    "",
    "function threadBySelectId(snapshot, id) {",
    "  return (snapshot.threads?.records ?? []).find((thread) => threadSelectId(thread) === id) ?? null;",
    "}",
    "",
    "function threadDetail(snapshot, id) {",
    "  const thread = threadBySelectId(snapshot, id);",
    "  const actions = uniqueActions(thread?.actions ?? []);",
    "  const facts = [",
    "    ['Type', 'thread'],",
    "    ['Decision', thread?.decisionLabel ?? 'review'],",
    "    ['Component', thread?.componentId ?? 'workspace'],",
    "    ['Branch', thread?.branchName ?? 'none'],",
    "    ['Work item', thread?.workItemId ?? 'none'],",
    "    ['Host', thread?.hostId ?? 'unknown'],",
    "  ];",
    "  if (thread?.updatedAt) facts.push(['Updated', formatTime(thread.updatedAt)]);",
    "  const detail = { title: thread?.title ?? 'Thread', body: thread?.decisionDetail ?? 'Review this thread.', facts, events: [], actions };",
    "  return { ...detail, chat: { prompt: cockpitThreadPrompt(thread ?? { title: detail.title, decisionLabel: 'Review', decisionDetail: detail.body }), title: `Continue ${detail.title}`, targetId: id, resumeThreadId: thread?.assistantThreadId } };",
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

export type NexusDashboardVisualAuditStatus = "passed" | "failed";

export interface NexusDashboardVisualAuditCheck {
  id: string;
  label: string;
  status: NexusDashboardVisualAuditStatus;
  detail: string;
}

export interface NexusDashboardVisualAuditResult {
  ok: boolean;
  checks: NexusDashboardVisualAuditCheck[];
  evidence: string[];
  limitations: string[];
}

export function auditNexusDashboardClientVisuals(
  moduleSource = renderNexusDashboardClientModule(),
): NexusDashboardVisualAuditResult {
  const signalAccents = uniqueMatches(
    moduleSource,
    /\.dn-signal\.signal-[^{]+\{ --dn-signal-accent: (#[0-9a-f]{6})/giu,
  );
  const branchAccents = uniqueMatches(
    moduleSource,
    /--dn-branch-\d: (#[0-9a-f]{6})/giu,
  );
  const checks = [
    visualAuditCheck(
      "theme-modes",
      "Light and dark themes",
      includesAll(moduleSource, [
        "data-theme-mode=\"system\"",
        "data-theme-mode=\"light\"",
        "data-theme-mode=\"dark\"",
        ":root[data-dev-nexus-theme='light']",
        ":root[data-dev-nexus-theme='dark']",
        "prefers-color-scheme",
      ]),
      "System, light, and dark modes are present.",
    ),
    visualAuditCheck(
      "signal-accents",
      "Distinct signal accents",
      signalAccents.length >= 6,
      `${signalAccents.length} signal accent colors found.`,
    ),
    visualAuditCheck(
      "branch-accents",
      "Distinct branch accents",
      branchAccents.length >= 7,
      `${branchAccents.length} branch accent colors found.`,
    ),
    visualAuditCheck(
      "host-smart-cards",
      "Smart host signal cards",
      includesAll(moduleSource, [
        "data-host-focus",
        "bindHostSignalControls",
        "filteredHostActions",
        "filteredHostWorkspaces",
        "workspaceAccentMap",
      ]),
      "Host signal cards filter the queue/workspaces while keeping the workspace panel in the same page position as project pages.",
    ),
    visualAuditCheck(
      "text-fitting",
      "Text fitting guardrails",
      includesAll(moduleSource, [
        ".dn-action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
        ".dn-selected-section p { display: -webkit-box; -webkit-line-clamp: 3;",
        ".dn-plugin-pills span { max-width: 100%;",
        ".dn-thread-main strong, .dn-plugin-card strong, .dn-tracked-card strong { overflow: hidden;",
        ".dn-workspace-card strong { min-width: 0; overflow: hidden;",
        "overflow-wrap: anywhere;",
      ]),
      "Long labels use truncation, line clamp, or overflow wrapping.",
    ),
    visualAuditCheck(
      "lane-labels",
      "Lane labels and row alignment",
      includesAll(moduleSource, [
        ".dn-lane-key { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));",
        "Not Git history",
        "Each rail is a workspace category",
        "Source checkout",
        "Active branch",
        "More branches",
        "Automation",
        "Decisions",
        "const rowHeight = 34",
        "data-row-height",
        "top: calc(50% - 5px)",
      ]),
      "Work-map lanes explain that rails are semantic workspace categories with centered row dots.",
    ),
    visualAuditCheck(
      "selected-details",
      "Selected details panel",
      includesAll(moduleSource, [
        "dn-selected-panel",
        "Selected item",
        "Summary",
        "Actions",
        "Evidence",
        "Diagnostics",
      ]),
      "Selected detail sections are available above the work map.",
    ),
    visualAuditCheck(
      "action-buttons",
      "Provider and chat actions",
      includesAll(moduleSource, [
        "providerIcon",
        "externalLinkIcon",
        "target=\"_blank\"",
        "rel=\"noopener noreferrer\"",
        "Start chat",
        "Resume chat",
      ]),
      "Provider links and chat actions expose their behavior.",
    ),
    visualAuditCheck(
      "plugin-cards",
      "Plugin cards",
      includesAll(moduleSource, [
        "renderPlugins",
        "dn-plugin-card",
        "dn-plugin-pills",
        "Extensions",
        "Local plugin candidates copy a refresh command",
        "data-copy-text",
      ]),
      "Configured and local plugins have their own compact cockpit section.",
    ),
    visualAuditCheck(
      "tracked-work",
      "Tracked work cards",
      includesAll(moduleSource, [
        "renderTrackedWork",
        "dn-tracked-card",
        "Issues and Work Items",
        "Tracked work",
      ]),
      "Provider and local work items have a compact cockpit section.",
    ),
    visualAuditCheck(
      "neutral-surfaces",
      "Neutral dashboard surfaces",
      includesAll(moduleSource, [
        "body { margin: 0; min-width: 320px; color: var(--dn-text); background: var(--dn-bg); }",
        ".dn-header { position: relative; z-index: 2;",
        "background: var(--dn-surface); box-shadow: var(--dn-shadow);",
        ".dn-signal { --dn-signal-accent: var(--dn-neutral);",
        "background: var(--dn-surface); text-align: left;",
        ".dn-workspace-card { --dn-workspace-accent: var(--dn-neutral);",
        "background: var(--dn-surface); text-align: left;",
        ".dn-host-action-card { --dn-project-accent: var(--dn-warn);",
        "background: var(--dn-surface); text-align: left;",
      ]) && includesNone(moduleSource, [
        "var(--dn-surface-muted) 80%, var(--dn-project-accent) 20%",
        "var(--dn-surface-muted) 82%, var(--dn-workspace-accent) 18%",
        "var(--dn-surface) 80%, var(--dn-signal-accent) 20%",
      ]),
      "Repeated cards use neutral light/dark surfaces while keeping color in borders.",
    ),
    visualAuditCheck(
      "responsive-layout",
      "Responsive layout",
      includesAll(moduleSource, [
        "@media (max-width: 1120px)",
        "@media (max-width: 680px)",
        ".dn-signals { grid-template-columns: 1fr; }",
        ".dn-history-detail { display: none; }",
      ]),
      "Desktop and narrow viewport breakpoints are defined.",
    ),
  ];
  return {
    ok: checks.every((check) => check.status === "passed"),
    checks,
    evidence: [
      `${signalAccents.length} signal accent colors`,
      `${branchAccents.length} branch accent colors`,
      `${checks.length} static visual checks`,
    ],
    limitations: [
      "Pixel screenshots still require a browser renderer and human review.",
    ],
  };
}

function visualAuditCheck(
  id: string,
  label: string,
  passed: boolean,
  detail: string,
): NexusDashboardVisualAuditCheck {
  return {
    id,
    label,
    status: passed ? "passed" : "failed",
    detail,
  };
}

function includesAll(source: string, snippets: string[]): boolean {
  return snippets.every((snippet) => source.includes(snippet));
}

function includesNone(source: string, snippets: string[]): boolean {
  return snippets.every((snippet) => !source.includes(snippet));
}

function uniqueMatches(source: string, pattern: RegExp): string[] {
  const matches = [...source.matchAll(pattern)]
    .map((match) => match[1]?.toLowerCase())
    .filter((match): match is string => Boolean(match));
  return [...new Set(matches)];
}

async function routeDashboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  codexChatStarter: NexusDashboardCodexChatStarter,
  localResourceOpener: NexusDashboardLocalResourceOpener,
  actionToken: string,
  dashboardCache: NexusDashboardServerCache,
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
      dashboardCache,
      url,
    );
    return;
  }
  if (method === "POST" && url.pathname === "/api/local/open") {
    await routeLocalOpen(
      request,
      response,
      snapshotOptions,
      localResourceOpener,
      actionToken,
      url,
    );
    return;
  }
  if (method === "POST" && url.pathname === "/api/dashboard/thread-action") {
    await routeDashboardThreadAction(
      request,
      response,
      snapshotOptions,
      actionToken,
      dashboardCache,
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
    if (url.pathname === "/api/local/app-icon") {
      const icon = await dashboardLocalAppIcon(localOpenAppFromUrl(url));
      sendBinary(response, icon.contentType, icon.body);
      return;
    }
    if (url.pathname === "/api/dashboard/shell") {
      const selection = await resolveDashboardWorkspaceSelection(
        snapshotOptions,
        workspaceIdFromUrl(url),
      );
      const snapshot = await cachedDashboardValue(
        dashboardCache,
        dashboardWorkspaceCacheKey("shell", selection),
        dashboardCachePolicies.shell,
        () => buildNexusDashboardWorkspaceShell(selection.snapshotOptions),
      );
      sendJson(response, dashboardWorkspacePayload(snapshot, selection));
      return;
    }
    if (url.pathname === "/api/dashboard/section") {
      const selection = await resolveDashboardWorkspaceSelection(
        snapshotOptions,
        workspaceIdFromUrl(url),
      );
      const section = dashboardSectionFromUrl(url);
      sendJson(
        response,
        await cachedDashboardValue(
          dashboardCache,
          dashboardWorkspaceCacheKey(`section:${section}`, selection),
          dashboardCachePolicies.section,
          () =>
            buildNexusDashboardWorkspaceSection(
              selection.snapshotOptions,
              section,
            ),
        ),
      );
      return;
    }
    if (url.pathname === "/api/dashboard" || url.pathname === "/api/snapshot") {
      const selection = await resolveDashboardWorkspaceSelection(
        snapshotOptions,
        workspaceIdFromUrl(url),
      );
      const snapshot = await cachedDashboardValue(
        dashboardCache,
        dashboardWorkspaceCacheKey("snapshot", selection),
        dashboardCachePolicies.workspace,
        () => buildNexusDashboardSnapshot(selection.snapshotOptions),
      );
      sendJson(response, dashboardWorkspacePayload(snapshot, selection));
      return;
    }
    if (url.pathname === "/api/diagnostics") {
      const selection = await resolveDashboardWorkspaceSelection(
        snapshotOptions,
        workspaceIdFromUrl(url),
      );
      const snapshot = await cachedDashboardValue(
        dashboardCache,
        dashboardWorkspaceCacheKey("snapshot", selection),
        dashboardCachePolicies.workspace,
        () => buildNexusDashboardSnapshot(selection.snapshotOptions),
      );
      sendJson(response, dashboardDiagnosticsPayload(snapshot, selection));
      return;
    }
    if (url.pathname === "/api/host") {
      sendJson(
        response,
        await cachedDashboardValue(
          dashboardCache,
          dashboardHostCacheKey("host", snapshotOptions, workspaceIdFromUrl(url)),
          dashboardCachePolicies.host,
          () => buildDashboardHostForRequest(snapshotOptions, workspaceIdFromUrl(url)),
        ),
      );
      return;
    }
    if (url.pathname === "/api/weave") {
      const selection = await resolveDashboardWorkspaceSelection(
        snapshotOptions,
        workspaceIdFromUrl(url),
      );
      const snapshot = await cachedDashboardValue(
        dashboardCache,
        dashboardWorkspaceCacheKey("snapshot", selection),
        dashboardCachePolicies.workspace,
        () => buildNexusDashboardSnapshot(selection.snapshotOptions),
      );
      sendJson(response, snapshot.weave);
      return;
    }
    if (url.pathname === "/api/events") {
      const selection = await resolveDashboardWorkspaceSelection(
        snapshotOptions,
        workspaceIdFromUrl(url),
      );
      const snapshot = await cachedDashboardValue(
        dashboardCache,
        dashboardWorkspaceCacheKey("snapshot", selection),
        dashboardCachePolicies.workspace,
        () => buildNexusDashboardSnapshot(selection.snapshotOptions),
      );
      sendJson(response, { events: snapshot.events });
      return;
    }
    if (url.pathname === "/api/projects") {
      const host = await cachedDashboardValue(
        dashboardCache,
        dashboardHostCacheKey("projects", snapshotOptions, workspaceIdFromUrl(url)),
        dashboardCachePolicies.projectIndex,
        () =>
          buildDashboardProjectIndexForRequest(
            snapshotOptions,
            workspaceIdFromUrl(url),
          ),
      );
      sendJson(response, { host, projects: host.workspaces });
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
  dashboardCache: NexusDashboardServerCache,
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
    const threadContext = targetId
      ? await resolveDashboardThreadActionContext(selection.snapshotOptions, targetId)
      : null;
    const result = await codexChatStarter.start({
      projectRoot: selection.snapshotOptions.projectRoot,
      prompt,
      ...(title ? { title } : {}),
      ...(threadContext?.threadId ? { threadId: threadContext.threadId } : {}),
      ...(threadContext?.cwd ? { cwd: threadContext.cwd } : {}),
    });
    invalidateDashboardCache(dashboardCache);
    sendJson(response, { ok: true, result }, 201);
  } catch (error) {
    sendJson(response, dashboardErrorBody(error), dashboardErrorStatusCode(error));
  }
}

async function routeLocalOpen(
  request: IncomingMessage,
  response: ServerResponse,
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  localResourceOpener: NexusDashboardLocalResourceOpener,
  actionToken: string,
  url: URL,
): Promise<void> {
  try {
    requireDashboardMutationRequest(request, actionToken);
    const workspaceId = workspaceIdFromUrl(url);
    const body = await readJsonBody(request);
    const target = requiredLocalOpenTarget(body, "target");
    const app = requiredLocalOpenApp(body, "app");
    rejectClientControlledField(body, "path");
    rejectClientControlledField(body, "cwd");
    rejectClientControlledField(body, "projectRoot");
    rejectClientControlledField(body, "workspaceRoot");
    const targetPath = await dashboardLocalOpenPath(
      snapshotOptions,
      workspaceId,
      target,
    );
    const result = await localResourceOpener({
      target,
      app,
      path: targetPath,
    });
    sendJson(response, { ok: result.ok, result }, result.ok ? 200 : 502);
  } catch (error) {
    sendJson(response, dashboardErrorBody(error), dashboardErrorStatusCode(error));
  }
}

async function routeDashboardThreadAction(
  request: IncomingMessage,
  response: ServerResponse,
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  actionToken: string,
  dashboardCache: NexusDashboardServerCache,
  url: URL,
): Promise<void> {
  try {
    requireDashboardMutationRequest(request, actionToken);
    const workspaceId = workspaceIdFromUrl(url);
    const body = await readJsonBody(request);
    const threadId = requiredStringField(body, "threadId");
    const action = requiredDashboardThreadResolutionAction(body, "action");
    rejectClientControlledField(body, "projectRoot");
    rejectClientControlledField(body, "workspaceRoot");
    rejectClientControlledField(body, "path");
    rejectClientControlledField(body, "cwd");
    const selection = await resolveDashboardWorkspaceSelection(
      snapshotOptions,
      workspaceId,
    );
    const snapshot = await buildNexusDashboardSnapshot(selection.snapshotOptions);
    const thread = snapshot.threads.records.find((record) =>
      record.id === threadId
    );
    if (!thread) {
      throw new NexusDashboardRouteError(
        "thread_not_found",
        `Dashboard thread ${threadId} is not active in this workspace`,
        404,
      );
    }
    if (thread.decision !== action) {
      throw new NexusDashboardRouteError(
        "thread_action_not_allowed",
        `Dashboard thread ${threadId} is marked ${thread.decision}, not ${action}`,
        409,
      );
    }
    const record = recordNexusDashboardThreadResolution({
      projectRoot: selection.snapshotOptions.projectRoot,
      action,
      thread,
      now: snapshotOptions.now,
    });
    invalidateDashboardCache(dashboardCache);
    sendJson(response, {
      ok: true,
      result: {
        action: record.action,
        threadId: record.threadId,
        decidedAt: record.decidedAt,
        scope: "local",
      },
    });
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

function dashboardSectionFromUrl(url: URL): NexusDashboardWorkspaceSectionId {
  const section = url.searchParams.get("section")?.trim();
  if (
    section === "components" ||
    section === "plugins" ||
    section === "threads" ||
    section === "tracked-work"
  ) {
    return section;
  }
  throw new NexusDashboardRouteError(
    "invalid_dashboard_section",
    "Dashboard section must be components, plugins, threads, or tracked-work",
    400,
  );
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
      workspaceId: null,
    };
  }

  const matches = nexusDashboardHostWorkspaceReferenceMatches(
    snapshotOptions,
    workspaceId,
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
      projectRoot: path.resolve(matches[0]!.reference.projectRoot),
    },
    workspaceId,
  };
}

async function buildDashboardHostForRequest(
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  workspaceId: string | null,
): Promise<NexusDashboardHostSnapshot> {
  if (!workspaceId) {
    return buildNexusDashboardHostSnapshot(snapshotOptions);
  }
  const baseHost = await buildNexusDashboardHostProjectIndex(snapshotOptions);
  const selection = workspaceSelectionFromHostIndex(
    snapshotOptions,
    workspaceId,
    baseHost,
  );
  const selectedHost = await buildNexusDashboardHostSnapshot(
    selection.snapshotOptions,
  );
  return mergeDashboardHostSnapshots(selectedHost, baseHost);
}

async function buildDashboardProjectIndexForRequest(
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  workspaceId: string | null,
): Promise<NexusDashboardHostSnapshot> {
  if (!workspaceId) {
    return buildNexusDashboardHostProjectIndex(snapshotOptions);
  }
  const baseHost = await buildNexusDashboardHostProjectIndex(snapshotOptions);
  const selection = workspaceSelectionFromHostIndex(
    snapshotOptions,
    workspaceId,
    baseHost,
  );
  const selectedHost = await buildNexusDashboardHostProjectIndex(
    selection.snapshotOptions,
  );
  return mergeDashboardHostSnapshots(selectedHost, baseHost);
}

function workspaceSelectionFromHostIndex(
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  workspaceId: string,
  baseHost: NexusDashboardHostSnapshot,
): DashboardWorkspaceSelection {
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
    workspaceId,
  };
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
  const selectedWorkspace = workspaces.find((workspace) => workspace.current) ?? null;
  return {
    ...selectedHost,
    contract: nexusDashboardEmbeddingContract({
      scope: "host",
      selectedWorkspaceId: selectedWorkspace?.id ?? null,
      selectedWorkspaceRoot: selectedWorkspace?.root ?? null,
      hostMode: true,
    }),
    selectedWorkspaceId: selectedWorkspace?.id ?? null,
    workspaceCount: workspaces.length,
    needsAttentionCount: workspaces.filter((workspace) =>
      workspace.tone === "danger" || workspace.tone === "warn"
    ).length,
    actionQueue: buildNexusDashboardHostActionQueue(workspaces),
    workspaces,
  };
}

function dashboardWorkspacePayload(
  snapshot: NexusDashboardSnapshot,
  selection: DashboardWorkspaceSelection,
): NexusDashboardWorkspacePayload {
  const {
    automation: _automation,
    eligibleWork: _eligibleWork,
    targetReport: _targetReport,
    ...payload
  } = snapshot;
  return {
    ...payload,
    contract: workspaceContract(snapshot, selection, false),
  };
}

function dashboardDiagnosticsPayload(
  snapshot: NexusDashboardSnapshot,
  selection: DashboardWorkspaceSelection,
): NexusDashboardDiagnosticsPayload {
  return {
    version: 1,
    contract: workspaceContract(snapshot, selection, true),
    generatedAt: snapshot.generatedAt,
    projectRoot: snapshot.projectRoot,
    automation: snapshot.automation,
    eligibleWork: snapshot.eligibleWork,
    targetReport: snapshot.targetReport,
    authority: snapshot.authority,
    blockers: snapshot.blockers,
    publication: snapshot.publication,
  };
}

function workspaceContract(
  snapshot: NexusDashboardSnapshot,
  selection: DashboardWorkspaceSelection,
  diagnosticsDefaultPayload: boolean,
): NexusDashboardEmbeddingContract {
  const selectedWorkspace = selection.workspaceId
    ? selection.baseHost?.workspaces.find((workspace) =>
      workspace.id === selection.workspaceId
    ) ?? null
    : null;
  return nexusDashboardEmbeddingContract({
    scope: diagnosticsDefaultPayload ? "diagnostics" : "workspace",
    selectedWorkspaceId: selection.workspaceId ?? snapshot.project.id,
    selectedWorkspaceRoot: selectedWorkspace?.root ?? snapshot.projectRoot,
    hostMode: Boolean(selection.workspaceId || selection.baseHost),
    diagnosticsDefaultPayload,
  });
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

async function resolveDashboardThreadActionContext(
  snapshotOptions: BuildNexusDashboardSnapshotOptions,
  targetId: string,
): Promise<DashboardThreadActionContext | null> {
  if (!targetId.startsWith("thread:")) {
    return null;
  }
  const threadRecordId = targetId.slice("thread:".length);
  if (!threadRecordId) {
    return null;
  }
  const snapshot = await buildNexusDashboardSnapshot(snapshotOptions);
  const thread = snapshot.threads.records.find((record) =>
    record.id === threadRecordId
  );
  const worktree = snapshot.worktrees.records.find((record) =>
    record.id === threadRecordId
  );
  if (!thread && !worktree) {
    return null;
  }
  return {
    threadId: thread?.assistantThreadId ?? null,
    cwd: dashboardChatCwd(worktree?.worktreePath ?? null),
  };
}

function dashboardChatCwd(worktreePath: string | null): string | null {
  if (!worktreePath) {
    return null;
  }
  const resolvedWorktreePath = path.resolve(worktreePath);
  if (!fs.existsSync(resolvedWorktreePath)) {
    return null;
  }
  return resolvedWorktreePath;
}

async function dashboardLocalOpenPath(
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  workspaceId: string | null,
  target: NexusDashboardLocalOpenTarget,
): Promise<string> {
  if (target === "home") {
    const host = await buildNexusDashboardHostSnapshot(snapshotOptions);
    return host.homePath;
  }
  const selection = await resolveDashboardWorkspaceSelection(
    snapshotOptions,
    workspaceId,
  );
  return selection.snapshotOptions.projectRoot;
}

function localOpenAppFromUrl(url: URL): NexusDashboardLocalOpenApp {
  const value = url.searchParams.get("app");
  if (value === "file" || value === "code" || value === "terminal") {
    return value;
  }
  throw new NexusDashboardRouteError(
    "invalid_app",
    "local app icon requires app=file, app=code, or app=terminal",
    400,
  );
}

async function dashboardLocalAppIcon(
  app: NexusDashboardLocalOpenApp,
): Promise<NexusDashboardLocalAppIcon> {
  const pngPath = await dashboardDarwinAppIconPng(app);
  if (pngPath) {
    return {
      body: await fs.promises.readFile(pngPath),
      contentType: "image/png",
    };
  }
  return {
    body: fallbackLocalAppIconSvg(app),
    contentType: "image/svg+xml; charset=utf-8",
  };
}

async function dashboardDarwinAppIconPng(
  app: NexusDashboardLocalOpenApp,
): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const source = dashboardDarwinAppIconSource(app);
  if (!source) return null;
  try {
    const stat = await fs.promises.stat(source);
    const cacheRoot = path.join(os.tmpdir(), "dev-nexus-dashboard-app-icons");
    await fs.promises.mkdir(cacheRoot, { recursive: true });
    const target = path.join(
      cacheRoot,
      `${app}-${stat.size}-${Math.trunc(stat.mtimeMs)}.png`,
    );
    if (!fs.existsSync(target)) {
      await execFilePromise("sips", [
        "-s",
        "format",
        "png",
        source,
        "--out",
        target,
      ]);
    }
    return target;
  } catch {
    return null;
  }
}

function dashboardDarwinAppIconSource(
  app: NexusDashboardLocalOpenApp,
): string | null {
  const homeApplications = path.join(os.homedir(), "Applications");
  const candidates: Record<NexusDashboardLocalOpenApp, string[]> = {
    code: [
      "/Applications/Visual Studio Code.app/Contents/Resources/Code.icns",
      path.join(homeApplications, "Visual Studio Code.app/Contents/Resources/Code.icns"),
      "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/Code - Insiders.icns",
      path.join(homeApplications, "Visual Studio Code - Insiders.app/Contents/Resources/Code - Insiders.icns"),
    ],
    file: [
      "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/FinderIcon.icns",
    ],
    terminal: [
      "/System/Applications/Utilities/Terminal.app/Contents/Resources/Terminal.icns",
      "/Applications/Utilities/Terminal.app/Contents/Resources/Terminal.icns",
    ],
  };
  return candidates[app].find((candidate) => fs.existsSync(candidate)) ?? null;
}

function execFilePromise(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function fallbackLocalAppIconSvg(app: NexusDashboardLocalOpenApp): string {
  const colors: Record<NexusDashboardLocalOpenApp, string> = {
    code: "#2f80ed",
    file: "#5bb6ff",
    terminal: "#24272e",
  };
  const color = colors[app];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${color}"/></svg>`;
}

async function openDashboardLocalResource(
  request: NexusDashboardLocalOpenRequest,
): Promise<NexusDashboardLocalOpenResult> {
  const { command, args } = dashboardLocalOpenCommand(request);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", (error) => {
      resolve({
        ...request,
        ok: false,
        command,
        args,
        error: error.message,
      });
    });
    child.once("spawn", () => {
      child.unref();
      resolve({
        ...request,
        ok: true,
        command,
        args,
      });
    });
  });
}

function dashboardLocalOpenCommand(
  request: NexusDashboardLocalOpenRequest,
): { command: string; args: string[] } {
  if (process.platform === "darwin") {
    if (request.app === "code") {
      return { command: "open", args: ["-a", "Visual Studio Code", request.path] };
    }
    if (request.app === "terminal") {
      return { command: "open", args: ["-a", "Terminal", request.path] };
    }
    return { command: "open", args: [request.path] };
  }
  if (process.platform === "win32") {
    if (request.app === "code") {
      return { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", "code", request.path] };
    }
    if (request.app === "terminal") {
      return { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", "cmd", "/k", "cd", "/d", request.path] };
    }
    return { command: "explorer.exe", args: [request.path] };
  }
  if (request.app === "code") {
    return { command: "code", args: [request.path] };
  }
  if (request.app === "terminal") {
    return { command: "x-terminal-emulator", args: ["--working-directory", request.path] };
  }
  return { command: "xdg-open", args: [request.path] };
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

function sendBinary(
  response: ServerResponse,
  contentType: string,
  body: Buffer | string,
  statusCode = 200,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "public, max-age=86400",
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

function requiredLocalOpenTarget(
  value: unknown,
  fieldName: string,
): NexusDashboardLocalOpenTarget {
  const target = requiredStringField(value, fieldName);
  if (target === "home" || target === "project") {
    return target;
  }
  throw new NexusDashboardCodexChatError(
    `${fieldName} must be home or project`,
    400,
  );
}

function requiredLocalOpenApp(
  value: unknown,
  fieldName: string,
): NexusDashboardLocalOpenApp {
  const app = requiredStringField(value, fieldName);
  if (app === "file" || app === "code" || app === "terminal") {
    return app;
  }
  throw new NexusDashboardCodexChatError(
    `${fieldName} must be file, code, or terminal`,
    400,
  );
}

function requiredDashboardThreadResolutionAction(
  value: unknown,
  fieldName: string,
): NexusDashboardThreadResolutionAction {
  const action = requiredStringField(value, fieldName);
  if (action === "archive" || action === "forget") {
    return action;
  }
  throw new NexusDashboardCodexChatError(
    `${fieldName} must be archive or forget`,
    400,
  );
}

function rejectClientControlledField(
  value: unknown,
  fieldName: string,
): void {
  const record = plainRecord(value);
  if (record[fieldName] !== undefined && record[fieldName] !== null) {
    throw new NexusDashboardCodexChatError(
      `${fieldName} is server-controlled for dashboard actions`,
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
