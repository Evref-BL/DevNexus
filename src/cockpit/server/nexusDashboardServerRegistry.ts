import fs from "node:fs";
import path from "node:path";
import {
  isProcessRunning,
  stopProcessByPid,
  type StopProcessByPidOptions,
  type StopProcessByPidResult,
} from "../../runtime/processSupervisor.js";

export interface NexusDashboardServerRecord {
  id: string;
  pid: number;
  projectRoot: string | null;
  currentProjectRoot: string | null;
  host: string;
  port: number;
  url: string;
  startedAt: string;
  updatedAt: string;
  verificationToken: string;
}

export type NexusDashboardPublicServerRecord = Omit<
  NexusDashboardServerRecord,
  "verificationToken"
>;

export interface NexusDashboardServerRegistry {
  version: 1;
  updatedAt: string;
  servers: NexusDashboardServerRecord[];
}

export interface NexusDashboardServerVerification {
  record: NexusDashboardPublicServerRecord;
  running: boolean;
  reachable: boolean;
  owned: boolean;
  stale: boolean;
  statusCode?: number;
  error?: string;
}

export interface NexusDashboardServerStatus
  extends NexusDashboardPublicServerRecord {
  running: boolean;
  reachable: boolean;
  owned: boolean;
  stale: boolean;
  statusCode?: number;
  error?: string;
}

export interface StopVerifiedNexusDashboardServerOptions {
  fetcher?: typeof fetch;
  stopper?: (
    pid: number,
    options?: StopProcessByPidOptions,
  ) => Promise<StopProcessByPidResult>;
  stopOptions?: StopProcessByPidOptions;
  currentPid?: number;
  timeoutMs?: number;
}

export interface StopVerifiedNexusDashboardServerResult {
  stopped: boolean;
  reason:
    | "stopped"
    | "already_exited"
    | "not_owned"
    | "current_process"
    | "stop_failed";
  verification: NexusDashboardServerVerification;
  stopResult?: StopProcessByPidResult;
}

export interface RestartNexusDashboardServerForPortOptions
  extends StopVerifiedNexusDashboardServerOptions {
  projectRoot: string;
  host: string;
  port: number;
  now?: () => Date | string;
}

export interface RestartNexusDashboardServerForPortResult {
  projectRoot: string;
  host: string;
  port: number;
  matched: number;
  stopped: NexusDashboardPublicServerRecord[];
  skipped: Array<{
    record: NexusDashboardPublicServerRecord;
    reason: StopVerifiedNexusDashboardServerResult["reason"];
  }>;
}

export function nexusDashboardServerRegistryPath(projectRoot: string): string {
  return path.join(
    path.resolve(projectRoot),
    ".dev-nexus",
    "runtime",
    "dashboard-servers.json",
  );
}

export function publicNexusDashboardServerRecord(
  record: NexusDashboardServerRecord,
): NexusDashboardPublicServerRecord {
  const { verificationToken: _verificationToken, ...publicRecord } = record;
  return publicRecord;
}

export function readNexusDashboardServerRegistry(
  projectRoot: string,
): NexusDashboardServerRegistry {
  const registryPath = nexusDashboardServerRegistryPath(projectRoot);
  if (!fs.existsSync(registryPath)) {
    return emptyRegistry();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8")) as unknown;
    if (!isDashboardServerRegistry(parsed)) {
      return emptyRegistry();
    }
    return parsed;
  } catch {
    return emptyRegistry();
  }
}

export function saveNexusDashboardServerRecord(
  projectRoot: string,
  record: NexusDashboardServerRecord,
  options: { now?: () => Date | string } = {},
): NexusDashboardServerRegistry {
  const registry = readNexusDashboardServerRegistry(projectRoot);
  const updatedAt = timestamp(options.now);
  const servers = [
    ...registry.servers.filter((existing) => existing.id !== record.id),
    { ...record, updatedAt },
  ];
  return writeNexusDashboardServerRegistry(projectRoot, {
    version: 1,
    updatedAt,
    servers,
  });
}

export function removeNexusDashboardServerRecord(
  projectRoot: string,
  id: string,
  options: { now?: () => Date | string } = {},
): NexusDashboardServerRegistry {
  const registry = readNexusDashboardServerRegistry(projectRoot);
  return writeNexusDashboardServerRegistry(projectRoot, {
    version: 1,
    updatedAt: timestamp(options.now),
    servers: registry.servers.filter((record) => record.id !== id),
  });
}

export async function listNexusDashboardServerStatuses(
  projectRoot: string,
  options: {
    host?: string;
    port?: number;
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<NexusDashboardServerStatus[]> {
  const registry = readNexusDashboardServerRegistry(projectRoot);
  const records = registry.servers.filter((record) =>
    dashboardServerRecordMatches(record, options.host, options.port)
  );
  const verifications = await Promise.all(
    records.map((record) =>
      verifyNexusDashboardServerRecord(record, {
        fetcher: options.fetcher,
        timeoutMs: options.timeoutMs,
      }),
    ),
  );
  return verifications.map((verification) => ({
    ...verification.record,
    running: verification.running,
    reachable: verification.reachable,
    owned: verification.owned,
    stale: verification.stale,
    ...(verification.statusCode !== undefined
      ? { statusCode: verification.statusCode }
      : {}),
    ...(verification.error ? { error: verification.error } : {}),
  }));
}

export async function verifyNexusDashboardServerRecord(
  record: NexusDashboardServerRecord,
  options: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<NexusDashboardServerVerification> {
  const publicRecord = publicNexusDashboardServerRecord(record);
  const running = safeIsProcessRunning(record.pid);
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 500,
  );

  try {
    const response = await fetcher(`${record.url}api/dashboard/server-info`, {
      headers: {
        "x-dev-nexus-dashboard-verification": record.verificationToken,
      },
      signal: controller.signal,
    });
    const statusCode = response.status;
    if (!response.ok) {
      return {
        record: publicRecord,
        running,
        reachable: true,
        owned: false,
        stale: true,
        statusCode,
      };
    }

    const body = await response.json() as unknown;
    const observed = dashboardServerInfoBody(body);
    const owned = Boolean(
      observed?.verified &&
        observed.dashboard.id === record.id &&
        observed.dashboard.pid === record.pid &&
        observed.dashboard.host === record.host &&
        observed.dashboard.port === record.port &&
        observed.dashboard.url === record.url,
    );
    return {
      record: publicRecord,
      running,
      reachable: true,
      owned,
      stale: !owned,
      statusCode,
    };
  } catch (error) {
    return {
      record: publicRecord,
      running,
      reachable: false,
      owned: false,
      stale: true,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function stopVerifiedNexusDashboardServerRecord(
  record: NexusDashboardServerRecord,
  options: StopVerifiedNexusDashboardServerOptions = {},
): Promise<StopVerifiedNexusDashboardServerResult> {
  const verification = await verifyNexusDashboardServerRecord(record, {
    fetcher: options.fetcher,
    timeoutMs: options.timeoutMs,
  });
  if (!verification.owned) {
    return {
      stopped: false,
      reason: "not_owned",
      verification,
    };
  }

  if (record.pid === (options.currentPid ?? process.pid)) {
    return {
      stopped: false,
      reason: "current_process",
      verification,
    };
  }

  if (!verification.running) {
    return {
      stopped: true,
      reason: "already_exited",
      verification,
    };
  }

  const stopper = options.stopper ?? stopProcessByPid;
  const stopResult = await stopper(record.pid, options.stopOptions);
  return {
    stopped: stopResult.stopped,
    reason: stopResult.stopped ? "stopped" : "stop_failed",
    verification,
    stopResult,
  };
}

export async function restartNexusDashboardServerForPort(
  options: RestartNexusDashboardServerForPortOptions,
): Promise<RestartNexusDashboardServerForPortResult> {
  const registry = readNexusDashboardServerRegistry(options.projectRoot);
  const records = registry.servers.filter((record) =>
    dashboardServerRecordMatches(record, options.host, options.port)
  );
  const stopped: NexusDashboardPublicServerRecord[] = [];
  const skipped: RestartNexusDashboardServerForPortResult["skipped"] = [];

  for (const record of records) {
    const result = await stopVerifiedNexusDashboardServerRecord(record, options);
    if (result.stopped) {
      removeNexusDashboardServerRecord(options.projectRoot, record.id, {
        now: options.now,
      });
      stopped.push(publicNexusDashboardServerRecord(record));
      continue;
    }
    skipped.push({
      record: publicNexusDashboardServerRecord(record),
      reason: result.reason,
    });
  }

  return {
    projectRoot: path.resolve(options.projectRoot),
    host: options.host,
    port: options.port,
    matched: records.length,
    stopped,
    skipped,
  };
}

export async function dashboardPortInUseMessage(options: {
  projectRoot?: string | null;
  host: string;
  port: number;
  fetcher?: typeof fetch;
}): Promise<string> {
  const intro = `Cockpit port ${options.host}:${options.port} is already in use.`;
  const projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : null;
  const known = projectRoot
    ? (await listNexusDashboardServerStatuses(projectRoot, {
        host: options.host,
        port: options.port,
        fetcher: options.fetcher,
      })).find((record) => record.owned)
    : null;
  const knownSentence = known
    ? ` Known DevNexus cockpit: ${known.url}.`
    : "";
  const scopedStatus = projectRoot
    ? `dev-nexus cockpit status ${projectRoot}`
    : "dev-nexus cockpit status";
  const scopedServe = projectRoot
    ? `dev-nexus cockpit serve ${projectRoot}`
    : "dev-nexus cockpit serve";
  return [
    `${intro}${knownSentence}`,
    `Run ${scopedStatus} to inspect known cockpits, ${scopedServe} --host ${options.host} --port ${options.port} --restart to replace a verified DevNexus cockpit, or choose a different --port.`,
  ].join(" ");
}

function writeNexusDashboardServerRegistry(
  projectRoot: string,
  registry: NexusDashboardServerRegistry,
): NexusDashboardServerRegistry {
  const registryPath = nexusDashboardServerRegistryPath(projectRoot);
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  return registry;
}

function emptyRegistry(): NexusDashboardServerRegistry {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    servers: [],
  };
}

function timestamp(now?: () => Date | string): string {
  const value = now?.() ?? new Date();
  return typeof value === "string" ? value : value.toISOString();
}

function safeIsProcessRunning(pid: number): boolean {
  try {
    return isProcessRunning(pid);
  } catch {
    return false;
  }
}

function dashboardServerRecordMatches(
  record: NexusDashboardServerRecord,
  host?: string,
  port?: number,
): boolean {
  if (host !== undefined && record.host !== host) {
    return false;
  }
  if (port !== undefined && record.port !== port) {
    return false;
  }
  return true;
}

function isDashboardServerRegistry(
  value: unknown,
): value is NexusDashboardServerRegistry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const registry = value as Partial<NexusDashboardServerRegistry>;
  return registry.version === 1 &&
    typeof registry.updatedAt === "string" &&
    Array.isArray(registry.servers) &&
    registry.servers.every(isDashboardServerRecord);
}

function isDashboardServerRecord(
  value: unknown,
): value is NexusDashboardServerRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<NexusDashboardServerRecord>;
  return typeof record.id === "string" &&
    typeof record.pid === "number" &&
    (typeof record.projectRoot === "string" || record.projectRoot === null) &&
    (
      typeof record.currentProjectRoot === "string" ||
      record.currentProjectRoot === null
    ) &&
    typeof record.host === "string" &&
    typeof record.port === "number" &&
    typeof record.url === "string" &&
    typeof record.startedAt === "string" &&
    typeof record.updatedAt === "string" &&
    typeof record.verificationToken === "string";
}

function dashboardServerInfoBody(value: unknown): {
  verified: boolean;
  dashboard: NexusDashboardPublicServerRecord;
} | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const body = value as {
    verified?: unknown;
    dashboard?: unknown;
  };
  if (body.verified !== true || !isPublicDashboardServerRecord(body.dashboard)) {
    return null;
  }
  return {
    verified: true,
    dashboard: body.dashboard,
  };
}

function isPublicDashboardServerRecord(
  value: unknown,
): value is NexusDashboardPublicServerRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<NexusDashboardPublicServerRecord>;
  return typeof record.id === "string" &&
    typeof record.pid === "number" &&
    (typeof record.projectRoot === "string" || record.projectRoot === null) &&
    (
      typeof record.currentProjectRoot === "string" ||
      record.currentProjectRoot === null
    ) &&
    typeof record.host === "string" &&
    typeof record.port === "number" &&
    typeof record.url === "string" &&
    typeof record.startedAt === "string" &&
    typeof record.updatedAt === "string";
}
