import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
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
  type NexusDashboardCodexChatStarter,
} from "./nexusDashboardCodexChat.js";
import {
  dashboardPortInUseMessage,
  publicNexusDashboardServerRecord,
  removeNexusDashboardServerRecord,
  saveNexusDashboardServerRecord,
  type NexusDashboardServerRecord,
} from "./nexusDashboardServerRegistry.js";
import {
  cachedDashboardValue,
  createDashboardServerCache,
  dashboardCachePolicies,
  dashboardHostCacheKey,
  dashboardWorkspaceCacheKey,
  invalidateDashboardCache,
} from "./nexusDashboardServerCache.js";
import type {
  NexusDashboardServerCache,
  DashboardWorkspaceCacheSelection,
} from "./nexusDashboardServerCache.js";
import {
  providerOptionsWithFreshnessCache,
} from "../../providers/nexusProviderFreshness.js";
import type { GitRunner } from "../../worktrees/gitWorktreeService.js";
import type { NexusEligibleWorkMode } from "../../work-items/nexusEligibleWorkSummary.js";
import {
  nexusCockpitBrowserModuleAssetRevision,
  renderNexusCockpitBrowserModule,
} from "./nexusDashboardServerAssets.js";
import {
  dashboardLocalAppIcon,
  openDashboardLocalResource,
  type NexusDashboardLocalOpenApp,
  type NexusDashboardLocalOpenTarget,
  type NexusDashboardLocalResourceOpener,
} from "./nexusDashboardLocalOpen.js";
import {
  NexusDashboardRouteError,
  close,
  dashboardErrorBody,
  dashboardErrorStatusCode,
  dashboardTimestamp,
  escapeHtml,
  isAddressInUseError,
  listen,
  optionalStringField,
  readJsonBody,
  rejectClientControlledField,
  requireDashboardMutationRequest,
  requiredDashboardThreadResolutionAction,
  requiredLocalOpenApp,
  requiredLocalOpenTarget,
  requiredStringField,
  safeJsonString,
  sendBinary,
  sendJson,
  sendText,
} from "./nexusDashboardServerHttp.js";

export {
  auditNexusDashboardClientVisuals,
  renderNexusCockpitBrowserModule,
} from "./nexusDashboardServerAssets.js";
export type {
  NexusDashboardVisualAuditCheck,
  NexusDashboardVisualAuditResult,
  NexusDashboardVisualAuditStatus,
} from "./nexusDashboardServerAssets.js";
export type {
  NexusDashboardLocalOpenApp,
  NexusDashboardLocalOpenRequest,
  NexusDashboardLocalOpenResult,
  NexusDashboardLocalOpenTarget,
  NexusDashboardLocalResourceOpener,
} from "./nexusDashboardLocalOpen.js";

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

interface DashboardWorkspaceSelection extends DashboardWorkspaceCacheSelection {
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

interface DashboardThreadActionContext {
  threadId: string | null;
  cwd: string | null;
}

type DashboardFeatureRecord = NexusDashboardSnapshot["features"]["records"][number];
type DashboardThreadRecord = NexusDashboardSnapshot["threads"]["records"][number];
type DashboardTrackedWorkItem = NexusDashboardSnapshot["trackedWork"]["records"][number];
type DashboardWorktreeRecord = NexusDashboardSnapshot["worktrees"]["records"][number];

export async function startNexusDashboardServer(
  options: StartNexusDashboardServerOptions,
): Promise<NexusDashboardServerHandle> {
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : null;
  const currentProjectRoot =
    options.currentProjectRoot === undefined
      ? undefined
      : options.currentProjectRoot
        ? path.resolve(options.currentProjectRoot)
        : null;
  const registryProjectRoot = projectRoot ?? currentProjectRoot ?? null;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const providerOptions = providerOptionsWithFreshnessCache(options.providerOptions);
  const snapshotOptions: BuildNexusDashboardHostSnapshotOptions = {
    ...(projectRoot ? { projectRoot } : {}),
    ...(currentProjectRoot !== undefined
      ? { currentProjectRoot }
      : {}),
    homePath: options.homePath,
    env: options.env,
    credentialResolver: options.credentialResolver,
    provider: options.provider,
    providerFactory: options.providerFactory,
    providerOptions,
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
  let serverRecord: NexusDashboardServerRecord | null = null;
  const server = http.createServer((request, response) => {
    void routeDashboardRequest(
      request,
      response,
      snapshotOptions,
      codexChatStarter,
      localResourceOpener,
      actionToken,
      dashboardCache,
      serverRecord,
    );
  });

  try {
    await listen(server, port, host);
  } catch (error) {
    if (isAddressInUseError(error)) {
      throw new Error(
        await dashboardPortInUseMessage({
          projectRoot: registryProjectRoot,
          host,
          port,
        }),
      );
    }
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Dashboard server did not expose a TCP address");
  }

  const url = `http://${host}:${address.port}/`;
  const startedAt = dashboardTimestamp(options.now);
  serverRecord = {
    id: `dashboard-${randomBytes(12).toString("hex")}`,
    pid: process.pid,
    projectRoot,
    currentProjectRoot: currentProjectRoot ?? null,
    host,
    port: address.port,
    url,
    startedAt,
    updatedAt: startedAt,
    verificationToken: randomBytes(24).toString("base64url"),
  };
  if (registryProjectRoot) {
    try {
      saveNexusDashboardServerRecord(registryProjectRoot, serverRecord, {
        now: options.now,
      });
    } catch (error) {
      await close(server);
      await codexChatStarter.close();
      throw error;
    }
  }
  return {
    projectRoot,
    host,
    port: address.port,
    url,
    server,
    close: async () => {
      try {
        await close(server);
      } finally {
        if (registryProjectRoot && serverRecord) {
          removeNexusDashboardServerRecord(registryProjectRoot, serverRecord.id, {
            now: options.now,
          });
        }
        await codexChatStarter.close();
      }
    },
  };
}

export function renderNexusDashboardHtml(options: {
  title?: string;
  modulePath?: string;
  actionToken?: string;
} = {}): string {
  const title = escapeHtml(options.title ?? "DevNexus Cockpit");
  const modulePath = escapeHtml(options.modulePath ?? defaultNexusCockpitModulePath());
  const mountOptions = options.actionToken
    ? `{ actionToken: ${safeJsonString(options.actionToken)} }`
    : "{}";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    "</head>",
    "<body>",
    '<main id="dev-nexus-cockpit-root"></main>',
    `<script type="module">import { mountDevNexusCockpit } from "${modulePath}"; mountDevNexusCockpit(document.getElementById("dev-nexus-cockpit-root"), ${mountOptions});</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}

function defaultNexusCockpitModulePath(): string {
  return `/assets/dev-nexus-cockpit.js?v=${encodeURIComponent(nexusCockpitBrowserModuleAssetRevision())}`;
}

async function routeDashboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  codexChatStarter: NexusDashboardCodexChatStarter,
  localResourceOpener: NexusDashboardLocalResourceOpener,
  actionToken: string,
  dashboardCache: NexusDashboardServerCache,
  serverRecord: NexusDashboardServerRecord | null,
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
  if (
    method === "POST" &&
    (url.pathname === "/api/cockpit/thread-action" ||
      url.pathname === "/api/dashboard/thread-action")
  ) {
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
    if (
      url.pathname === "/assets/dev-nexus-cockpit.js" ||
      url.pathname === "/assets/dev-nexus-dashboard.js"
    ) {
      sendText(
        response,
        "text/javascript; charset=utf-8",
        renderNexusCockpitBrowserModule(),
      );
      return;
    }
    if (url.pathname === "/api/local/app-icon") {
      const icon = await dashboardLocalAppIcon(localOpenAppFromUrl(url));
      sendBinary(response, icon.contentType, icon.body);
      return;
    }
    if (
      url.pathname === "/api/cockpit/server-info" ||
      url.pathname === "/api/dashboard/server-info"
    ) {
      sendJson(response, {
        ok: true,
        dashboard: serverRecord
          ? publicNexusDashboardServerRecord(serverRecord)
          : null,
        verified: Boolean(
          serverRecord &&
            request.headers["x-dev-nexus-dashboard-verification"] ===
              serverRecord.verificationToken,
        ),
      });
      return;
    }
    if (
      url.pathname === "/api/cockpit/shell" ||
      url.pathname === "/api/dashboard/shell"
    ) {
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
    if (
      url.pathname === "/api/cockpit/section" ||
      url.pathname === "/api/dashboard/section"
    ) {
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
    if (
      url.pathname === "/api/cockpit" ||
      url.pathname === "/api/dashboard" ||
      url.pathname === "/api/snapshot"
    ) {
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

async function resolveDashboardThreadActionContext(
  snapshotOptions: BuildNexusDashboardSnapshotOptions,
  targetId: string,
): Promise<DashboardThreadActionContext | null> {
  const snapshot = await buildNexusDashboardSnapshot(snapshotOptions);
  if (targetId.startsWith("thread:")) {
    const threadRecordId = targetId.slice("thread:".length);
    if (!threadRecordId) {
      return null;
    }
    return dashboardThreadContextById(snapshot, threadRecordId);
  }
  if (targetId.startsWith("tracked-work:")) {
    return dashboardThreadContextByTrackedWorkSelectId(snapshot, targetId);
  }
  if (targetId.startsWith("feature:")) {
    return dashboardThreadContextByFeatureSelectId(snapshot, targetId);
  }
  return null;
}

function dashboardThreadContextById(
  snapshot: NexusDashboardSnapshot,
  threadRecordId: string,
): DashboardThreadActionContext | null {
  const thread = snapshot.threads.records.find((record) =>
    record.id === threadRecordId
  );
  const worktree = thread
    ? dashboardWorktreeForThread(snapshot, thread)
    : snapshot.worktrees.records.find((record) => record.id === threadRecordId);
  if (!thread && !worktree) {
    return null;
  }
  return {
    threadId: thread?.assistantThreadId ?? null,
    cwd: dashboardChatCwd(worktree?.worktreePath ?? null),
  };
}

function dashboardThreadContextByTrackedWorkSelectId(
  snapshot: NexusDashboardSnapshot,
  targetId: string,
): DashboardThreadActionContext | null {
  const item = dashboardTrackedWorkBySelectId(snapshot, targetId);
  if (!item) {
    return null;
  }
  const thread = snapshot.threads.records.find((record) =>
    dashboardThreadMatchesTrackedWork(record, item)
  );
  const worktree = thread
    ? dashboardWorktreeForThread(snapshot, thread)
    : dashboardWorktreeForTrackedWork(snapshot, item);
  if (!thread && !worktree) {
    return null;
  }
  return {
    threadId: thread?.assistantThreadId ?? null,
    cwd: dashboardChatCwd(worktree?.worktreePath ?? null),
  };
}

function dashboardThreadContextByFeatureSelectId(
  snapshot: NexusDashboardSnapshot,
  targetId: string,
): DashboardThreadActionContext | null {
  const feature = snapshot.features.records.find((record) => record.id === targetId);
  if (!feature) {
    return null;
  }
  const branches = dashboardFeatureBranches(feature);
  const thread = snapshot.threads.records.find((record) =>
    dashboardBranchSetsIntersect([record.branchName], branches)
  );
  const worktree = thread
    ? dashboardWorktreeForThread(snapshot, thread)
    : snapshot.worktrees.records.find((record) =>
      dashboardBranchSetsIntersect([record.branchName], branches)
    );
  if (!thread && !worktree) {
    return null;
  }
  return {
    threadId: thread?.assistantThreadId ?? null,
    cwd: dashboardChatCwd(worktree?.worktreePath ?? null),
  };
}

function dashboardTrackedWorkBySelectId(
  snapshot: NexusDashboardSnapshot,
  targetId: string,
): DashboardTrackedWorkItem | null {
  const parts = targetId.split(":");
  const componentId = parts[1] ?? "";
  const itemId = parts.slice(2).join(":");
  if (!componentId || !itemId) {
    return null;
  }
  return snapshot.trackedWork.records.find((item) =>
    item.componentId === componentId && item.id === itemId
  ) ?? null;
}

function dashboardThreadMatchesTrackedWork(
  thread: DashboardThreadRecord,
  item: DashboardTrackedWorkItem,
): boolean {
  const itemIds = new Set(
    [item.id, item.logicalItemId].filter((value): value is string => Boolean(value)),
  );
  return Boolean(
    thread.workItemId && itemIds.has(thread.workItemId) &&
      (!thread.componentId || thread.componentId === item.componentId),
  );
}

function dashboardWorktreeForThread(
  snapshot: NexusDashboardSnapshot,
  thread: DashboardThreadRecord,
): DashboardWorktreeRecord | null {
  return snapshot.worktrees.records.find((record) => record.id === thread.id) ??
    snapshot.worktrees.records.find((record) =>
      dashboardBranchSetsIntersect([record.branchName], [thread.branchName])
    ) ??
    snapshot.worktrees.records.find((record) =>
      Boolean(thread.workItemId && record.workItemId === thread.workItemId)
    ) ??
    null;
}

function dashboardWorktreeForTrackedWork(
  snapshot: NexusDashboardSnapshot,
  item: DashboardTrackedWorkItem,
): DashboardWorktreeRecord | null {
  const itemIds = new Set(
    [item.id, item.logicalItemId].filter((value): value is string => Boolean(value)),
  );
  return snapshot.worktrees.records.find((record) =>
    Boolean(record.workItemId && itemIds.has(record.workItemId)) &&
    (!record.componentId || record.componentId === item.componentId)
  ) ?? null;
}

function dashboardFeatureBranches(feature: DashboardFeatureRecord): string[] {
  return [
    feature.featureBranch,
    ...(feature.branches ?? []),
  ].filter((branch): branch is string => Boolean(branch?.trim()));
}

function dashboardBranchSetsIntersect(
  left: Array<string | null | undefined>,
  right: Array<string | null | undefined>,
): boolean {
  const normalizedRight = new Set(right.map(dashboardNormalizeBranchName).filter(Boolean));
  return left.map(dashboardNormalizeBranchName).some((branch) =>
    Boolean(branch) &&
    (normalizedRight.has(branch) ||
      [...normalizedRight].some((candidate) =>
        candidate.endsWith(`/${branch}`) || branch.endsWith(`/${candidate}`)
      ))
  );
}

function dashboardNormalizeBranchName(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^refs\/heads\//u, "")
    .replace(/^refs\/remotes\//u, "")
    .replace(/^remotes\//u, "");
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
