import path from "node:path";
import type { BuildNexusDashboardHostSnapshotOptions } from "./nexusDashboardTypes.js";

export interface DashboardCachePolicy {
  readonly freshMs: number;
  readonly staleMs: number;
}

export interface DashboardCacheEntry<T> {
  readonly value?: T;
  readonly freshUntil: number;
  readonly staleUntil: number;
  pending?: Promise<T>;
}

export interface NexusDashboardServerCache {
  readonly entries: Map<string, DashboardCacheEntry<unknown>>;
}

export interface DashboardWorkspaceCacheSelection {
  readonly snapshotOptions: BuildNexusDashboardHostSnapshotOptions & {
    readonly projectRoot: string;
  };
  readonly workspaceId: string | null;
}

export const dashboardCachePolicies = {
  host: { freshMs: 60_000, staleMs: 300_000 },
  projectIndex: { freshMs: 15_000, staleMs: 120_000 },
  workspace: { freshMs: 60_000, staleMs: 300_000 },
  shell: { freshMs: 10_000, staleMs: 60_000 },
  section: { freshMs: 30_000, staleMs: 180_000 },
} satisfies Record<string, DashboardCachePolicy>;

export function createDashboardServerCache(): NexusDashboardServerCache {
  return { entries: new Map() };
}

export function invalidateDashboardCache(cache: NexusDashboardServerCache): void {
  cache.entries.clear();
}

export async function cachedDashboardValue<T>(
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

export function dashboardWorkspaceCacheKey(
  kind: string,
  selection: DashboardWorkspaceCacheSelection,
): string {
  return [
    "workspace",
    kind,
    selection.workspaceId ?? "",
    path.resolve(selection.snapshotOptions.projectRoot),
    dashboardSnapshotOptionsCacheKey(selection.snapshotOptions),
  ].join(":");
}

export function dashboardHostCacheKey(
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

export function dashboardSnapshotOptionsCacheKey(
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
