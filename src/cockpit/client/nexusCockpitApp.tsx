import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { useEffect, useMemo, useRef } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  fetchDevNexusCockpitHost,
  fetchDevNexusCockpitShell,
  mountDevNexusDashboard as mountLegacyDevNexusDashboard,
  type DevNexusDashboardMountHandle,
  type DevNexusDashboardMountOptions,
} from "./nexusCockpitClient.js";

export interface DevNexusCockpitMountOptions
  extends DevNexusDashboardMountOptions {
  queryClient?: QueryClient;
}

interface DevNexusCockpitRootElement extends HTMLElement {
  __devNexusCockpitQueryClient?: QueryClient;
  __devNexusCockpitRoot?: Root;
}

export function mountDevNexusCockpit(
  root: HTMLElement | null,
  options: DevNexusCockpitMountOptions = {},
): DevNexusDashboardMountHandle {
  if (!root) throw new Error("mountDevNexusCockpit requires a root element");
  const element = root as DevNexusCockpitRootElement;
  element.__devNexusCockpitRoot?.unmount();

  const queryClient = options.queryClient ?? createDevNexusCockpitQueryClient();
  element.__devNexusCockpitQueryClient = queryClient;
  element.__devNexusCockpitRoot = createRoot(element);
  element.__devNexusCockpitRoot.render(
    <QueryClientProvider client={queryClient}>
      <DevNexusCockpitRoot options={options} />
    </QueryClientProvider>,
  );

  return {
    dispose() {
      element.__devNexusCockpitRoot?.unmount();
      delete element.__devNexusCockpitRoot;
      if (!options.queryClient) {
        element.__devNexusCockpitQueryClient?.clear();
      }
      delete element.__devNexusCockpitQueryClient;
    },
  };
}

export const mountDevNexusDashboard = mountDevNexusCockpit;

function createDevNexusCockpitQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 10_000,
      },
    },
  });
}

function DevNexusCockpitRoot({
  options,
}: {
  options: DevNexusDashboardMountOptions;
}): ReactElement {
  useCockpitShellPrefetch(options);
  return (
    <>
      <VisuallyHidden.Root asChild>
        <span data-dev-nexus-cockpit-primitive="visually-hidden">
          DevNexus cockpit application
        </span>
      </VisuallyHidden.Root>
      <LegacyCockpitSurface options={options} />
    </>
  );
}

function LegacyCockpitSurface({
  options,
}: {
  options: DevNexusDashboardMountOptions;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const legacyHandleRef = useRef<DevNexusDashboardMountHandle | null>(null);
  const legacyOptions = useMemo(
    () => ({
      actionToken: options.actionToken,
      baseUrl: options.baseUrl,
      hostRefreshMs: options.hostRefreshMs,
      refreshMs: options.refreshMs,
      theme: options.theme,
      workspaceId: options.workspaceId,
    }),
    [
      options.actionToken,
      options.baseUrl,
      options.hostRefreshMs,
      options.refreshMs,
      options.theme,
      options.workspaceId,
    ],
  );

  useEffect(() => {
    if (!containerRef.current) return undefined;
    legacyHandleRef.current?.dispose();
    legacyHandleRef.current = mountLegacyDevNexusDashboard(
      containerRef.current,
      legacyOptions,
    );
    return () => {
      legacyHandleRef.current?.dispose();
      legacyHandleRef.current = null;
    };
  }, [legacyOptions]);

  return (
    <div
      ref={containerRef}
      data-dev-nexus-cockpit-react-shell="legacy"
    />
  );
}

function useCockpitShellPrefetch(options: DevNexusDashboardMountOptions): void {
  const queryClient = useQueryClient();
  const baseUrl = options.baseUrl ?? "";
  const workspaceId = normalizeWorkspaceId(
    options.workspaceId ?? readWorkspaceIdFromLocation(),
  );

  useEffect(() => {
    const queryKey = workspaceId
      ? ["dev-nexus", "cockpit", "shell", baseUrl, workspaceId]
      : ["dev-nexus", "cockpit", "host", baseUrl];
    void queryClient.prefetchQuery({
      queryKey,
      queryFn: () =>
        workspaceId
          ? fetchDevNexusCockpitShell(baseUrl, workspaceId)
          : fetchDevNexusCockpitHost(baseUrl),
    });
  }, [baseUrl, queryClient, workspaceId]);
}

function normalizeWorkspaceId(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function readWorkspaceIdFromLocation(): string {
  try {
    if (typeof window === "undefined") return "";
    return new URL(window.location.href).searchParams.get("workspace") ?? "";
  } catch {
    return "";
  }
}
