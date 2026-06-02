export type NexusDashboardContractScope = "host" | "workspace" | "diagnostics";

export type NexusDashboardContractOwner =
  | "dev-nexus"
  | "host-app"
  | "provider"
  | "assistant-provider";

export type NexusDashboardContractSurfaceId =
  | "hostSummary"
  | "workspaceSummary"
  | "selectedWorkspaceSnapshot"
  | "actionQueue"
  | "providerActions"
  | "plugins"
  | "threadActions"
  | "trackedWork";

export interface NexusDashboardContractSurface {
  field: string;
  endpoint: string;
  owner: NexusDashboardContractOwner;
  defaultPayload: boolean;
  action: "read" | "open-provider" | "start-chat" | "local-thread-action";
}

export interface NexusDashboardContractSelection {
  hostMode: boolean;
  workspaceQueryParam: "workspace";
  selectedWorkspaceId: string | null;
  selectedWorkspaceRoot: string | null;
}

export interface NexusDashboardEmbeddingContract {
  version: 1;
  scope: NexusDashboardContractScope;
  ownership: {
    devNexus: string[];
    hostApp: string[];
  };
  selection: NexusDashboardContractSelection;
  surfaces: Record<
    NexusDashboardContractSurfaceId,
    NexusDashboardContractSurface
  >;
  diagnostics: {
    defaultPayload: boolean;
    endpoint: string;
  };
  routes: {
    host: string;
    cockpit: string;
    dashboard: string;
    diagnostics: string;
    projects: string;
    weave: string;
    events: string;
    threadAction: string;
    threadResolution: string;
  };
}
