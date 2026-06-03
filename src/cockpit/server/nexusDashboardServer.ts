import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  buildNexusDashboardHostActionQueue,
  buildNexusDashboardHostProjectIndex,
  buildNexusDashboardHostSnapshot,
  buildNexusDashboardSnapshot,
  buildNexusDashboardWorkspaceSection,
  buildNexusDashboardWorkspaceShell,
  nexusDashboardEmbeddingContract,
  type BuildNexusDashboardHostSnapshotOptions,
  type BuildNexusDashboardSnapshotOptions,
  type NexusDashboardEmbeddingContract,
  type NexusDashboardHostSnapshot,
  type NexusDashboardHostWorkspaceRecord,
  type NexusDashboardSnapshot,
  type NexusDashboardWorkspaceSectionId,
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
  readJsonBody,
  rejectClientControlledField,
  requireDashboardMutationRequest,
  requiredLocalOpenApp,
  requiredLocalOpenTarget,
  safeJsonString,
  sendBinary,
  sendJson,
  sendText,
} from "./nexusDashboardServerHttp.js";
import {
  routeCodexThreadStart,
  routeDashboardThreadAction,
} from "./nexusDashboardServerChatRoutes.js";
import {
  routeDashboardProjectConfigApply,
  routeDashboardProjectConfigPreview,
} from "./nexusDashboardServerConfigRoutes.js";
import {
  resolveDashboardWorkspaceSelection,
  workspaceIdFromUrl,
  workspaceSelectionFromHostIndex,
  type DashboardWorkspaceSelection,
} from "./nexusDashboardServerWorkspace.js";

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
  if (
    method === "POST" &&
    (url.pathname === "/api/cockpit/project-config/preview" ||
      url.pathname === "/api/dashboard/project-config/preview")
  ) {
    await routeDashboardProjectConfigPreview(
      request,
      response,
      snapshotOptions,
      actionToken,
      url,
    );
    return;
  }
  if (
    method === "POST" &&
    (url.pathname === "/api/cockpit/project-config/apply" ||
      url.pathname === "/api/dashboard/project-config/apply")
  ) {
    await routeDashboardProjectConfigApply(
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
