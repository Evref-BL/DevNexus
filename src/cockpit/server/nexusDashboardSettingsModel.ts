import {
  loadNexusHomeConfigFile,
  nexusHomeConfigPath,
  validateNexusHomeConfigBase,
  type NexusHomeConfigBase,
} from "../../project/nexusHomeConfig.js";
import type { NexusProjectConfig } from "../../project/nexusProjectConfig.js";
import type { NexusDashboardGitWorkflowSummary } from "./nexusDashboardGitWorkflows.js";
import type {
  NexusDashboardAuthoritySummary,
  NexusDashboardComponentSummary,
  NexusDashboardPluginSummary,
  NexusDashboardPublicationSummary,
  NexusDashboardSettingsCategory,
  NexusDashboardSettingsItem,
  NexusDashboardSettingsMutationState,
  NexusDashboardSettingsScope,
  NexusDashboardSettingsSummary,
} from "./nexusDashboardTypes.js";

export interface SummarizeDashboardSettingsOptions {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: NexusDashboardComponentSummary[];
  plugins: NexusDashboardPluginSummary;
  gitWorkflows: NexusDashboardGitWorkflowSummary;
  publication: NexusDashboardPublicationSummary[];
  authority: NexusDashboardAuthoritySummary | null;
  homePath?: string;
}

interface HomeSettingsSummary {
  source: string;
  authProfileCount: number;
  claimAuthorityProfileCount: number;
  hostOverlayCount: number;
  remoteExecutionProfileCount: number;
  readable: boolean;
  blocker: string | null;
}

const projectSource = "dev-nexus.project.json";

export function summarizeDashboardSettings(
  options: SummarizeDashboardSettingsOptions,
): NexusDashboardSettingsSummary {
  const home = summarizeHomeSettings(options.homePath);
  const categories = [
    componentsCategory(options),
    workflowsCategory(options),
    pluginsCategory(options),
    automationCategory(options),
    providerLinksCategory(options),
    hostLocalCategory(home),
    authProfilesCategory(home),
    secretsCategory(),
    sessionCategory(),
  ];

  return {
    totalCategoryCount: categories.length,
    editableCategoryCount: categories.filter((category) =>
      category.mutationState === "editable"
    ).length,
    blockedCategoryCount: categories.filter((category) =>
      category.mutationState === "blocked"
    ).length,
    redactedSecretCount: categories.reduce(
      (count, category) => count + category.secretCount,
      0,
    ),
    categories,
  };
}

function componentsCategory(
  options: SummarizeDashboardSettingsOptions,
): NexusDashboardSettingsCategory {
  return category({
    id: "components",
    label: "Components",
    summary:
      "Component registration is writable through typed preview and apply routes.",
    primaryScope: "project",
    items: [
      item({
        id: "components.records",
        label: "Component records",
        scope: "project",
        source: projectSource,
        effectiveValue: componentCount(options.components.length),
        mutationState: "editable",
        mutationContract: "project-config component preview/apply",
        detail:
          "Add, edit, or remove component configuration records without deleting source files or provider state.",
      }),
      item({
        id: "components.source-roots",
        label: "Source roots",
        scope: "project",
        source: projectSource,
        effectiveValue: sourceRootSummary(options.components),
        mutationState: "preview-only",
        mutationContract: "project-config component preview/apply",
        detail:
          "Source root values can be changed through component edits. The cockpit never moves or deletes directories as part of this contract.",
      }),
    ],
  });
}

function workflowsCategory(
  options: SummarizeDashboardSettingsOptions,
): NexusDashboardSettingsCategory {
  return category({
    id: "workflows",
    label: "Workflows",
    summary:
      "Workflow settings are visible, but write policy still needs a dedicated contract.",
    primaryScope: "project",
    items: [
      item({
        id: "workflows.profiles",
        label: "Git workflow profiles",
        scope: "project",
        source: "dev-nexus.project.json automation.gitWorkflows",
        effectiveValue: `${options.gitWorkflows.profileCount} profiles, ${options.gitWorkflows.runCount} runs`,
        mutationState: "blocked",
        mutationContract: "workflow-settings mutation contract",
        blocker:
          "Workflow profile writes can affect branch strategy and publication gates.",
        detail:
          "The cockpit can show active profiles and runs, but editing workflow policy needs a separate preview/apply path.",
      }),
    ],
  });
}

function pluginsCategory(
  options: SummarizeDashboardSettingsOptions,
): NexusDashboardSettingsCategory {
  return category({
    id: "plugins",
    label: "Plugins",
    summary:
      "Plugins and extensions are cataloged; install and enable operations remain policy-gated.",
    primaryScope: "project",
    items: [
      item({
        id: "plugins.configured",
        label: "Configured plugins",
        scope: "project",
        source: "dev-nexus.project.json plugins",
        effectiveValue: `${options.plugins.enabledCount} enabled, ${options.plugins.availableCount} available`,
        mutationState: "blocked",
        mutationContract: "plugin install/enable mutation contract",
        blocker:
          "Plugin writes may require local setup, package installation, and generated support refresh.",
        detail:
          "The cockpit may expose copyable setup guidance, but it should not install or enable plugins without a dedicated contract.",
      }),
    ],
  });
}

function automationCategory(
  options: SummarizeDashboardSettingsOptions,
): NexusDashboardSettingsCategory {
  const automation = options.projectConfig.automation;
  return category({
    id: "automation",
    label: "Automation",
    summary:
      "Automation policy is read-only until each write path has authority checks.",
    primaryScope: "project",
    items: [
      item({
        id: "automation.safety",
        label: "Safety policy",
        scope: "project",
        source: "dev-nexus.project.json automation",
        effectiveValue: automation ? "configured" : "not configured",
        mutationState: "blocked",
        mutationContract: "automation-settings mutation contract",
        blocker:
          "Automation settings can permit host, runtime, provider, or Git mutations.",
        detail:
          "Changes need policy-specific validation and an explicit authority gate before the browser can apply them.",
      }),
      item({
        id: "automation.authority",
        label: "Authority status",
        scope: "workspace",
        source: "automation status",
        effectiveValue: authorityStatusSummary(options.authority),
        mutationState: "read-only",
        mutationContract: null,
        detail:
          "Authority is reported as operational state. Granting authority belongs to guarded project or host-local settings.",
      }),
    ],
  });
}

function providerLinksCategory(
  options: SummarizeDashboardSettingsOptions,
): NexusDashboardSettingsCategory {
  return category({
    id: "providers",
    label: "Providers",
    summary:
      "Provider links and publication identities are visible without mutating provider state.",
    primaryScope: "project",
    items: [
      item({
        id: "providers.publication",
        label: "Publication policy",
        scope: "project",
        source: "dev-nexus.project.json publication/hosting",
        effectiveValue: `${options.publication.length} publication records`,
        mutationState: "blocked",
        mutationContract: "provider/publication settings mutation contract",
        blocker:
          "Provider writes need actor selection, auth-profile checks, and green-main policy gates.",
        detail:
          "The cockpit should show which account or profile an action would use without depending on global provider CLI state.",
      }),
    ],
  });
}

function hostLocalCategory(
  home: HomeSettingsSummary,
): NexusDashboardSettingsCategory {
  return category({
    id: "host-local",
    label: "Host Local",
    summary:
      "Machine-specific paths and runtime adapters stay out of portable project config.",
    primaryScope: "host-local",
    items: [
      item({
        id: "host-local.home",
        label: "DevNexus home",
        scope: "host-local",
        source: home.source,
        effectiveValue: home.readable ? "readable" : "unavailable",
        sensitivity: "local",
        mutationState: "blocked",
        mutationContract: "host-local settings mutation contract",
        blocker:
          home.blocker ??
          "Host-local writes require a local-only contract and redaction tests.",
        detail:
          "Host-local config may contain paths, auth profile metadata, and runtime adapter references. The cockpit should never treat it as portable project config.",
      }),
      item({
        id: "host-local.runtime",
        label: "Runtime adapters",
        scope: "host-local",
        source: home.source,
        effectiveValue: `${home.hostOverlayCount} host overlays, ${home.remoteExecutionProfileCount} command profiles`,
        sensitivity: "local",
        mutationState: "blocked",
        mutationContract: "host-local settings mutation contract",
        blocker:
          "Runtime and remote execution settings can expose local paths or command profiles.",
        detail:
          "Read-only summaries are safe; writes need local-only persistence and audit wording before enabling.",
      }),
    ],
  });
}

function authProfilesCategory(
  home: HomeSettingsSummary,
): NexusDashboardSettingsCategory {
  return category({
    id: "auth-profiles",
    label: "Auth Profiles",
    summary:
      "Account references are visible as redacted profiles, not raw credentials.",
    primaryScope: "auth-profile",
    items: [
      item({
        id: "auth-profiles.records",
        label: "Configured auth profiles",
        scope: "auth-profile",
        source: home.source,
        effectiveValue: `${home.authProfileCount} profiles`,
        sensitivity: "sensitive",
        mutationState: "blocked",
        mutationContract: "auth-profile mutation contract",
        blocker:
          "Auth profile writes need local account selection, provider checks, and secret-store separation.",
        detail:
          "The cockpit should show profile ids, intended roles, and capability state only. It must not show tokens, private keys, or provider CLI internals.",
      }),
      item({
        id: "auth-profiles.claim-authority",
        label: "Claim authority profiles",
        scope: "auth-profile",
        source: home.source,
        effectiveValue: `${home.claimAuthorityProfileCount} claim authority profiles`,
        sensitivity: "sensitive",
        mutationState: "blocked",
        mutationContract: "auth-profile mutation contract",
        blocker:
          "Claim authority profiles may reference local credential environment variables.",
        detail:
          "Summaries can show count and status, while connection strings and tokens stay outside the browser payload.",
      }),
    ],
  });
}

function secretsCategory(): NexusDashboardSettingsCategory {
  return category({
    id: "secrets",
    label: "Secrets",
    summary:
      "Secret values are write-only or external to the cockpit payload.",
    primaryScope: "secret-store",
    items: [
      item({
        id: "secrets.values",
        label: "Credential material",
        scope: "secret-store",
        source: "host credential store",
        effectiveValue: "redacted",
        sensitivity: "secret",
        mutationState: "read-only",
        mutationContract: null,
        detail:
          "Tokens, private keys, passwords, refresh tokens, and secret files are never serialized to the browser.",
      }),
    ],
  });
}

function sessionCategory(): NexusDashboardSettingsCategory {
  return category({
    id: "session",
    label: "Session",
    summary:
      "Cockpit preferences are local UI state unless promoted to a settings contract.",
    primaryScope: "session",
    items: [
      item({
        id: "session.theme",
        label: "Theme",
        scope: "session",
        source: "browser local preference",
        effectiveValue: "system, light, or dark",
        sensitivity: "local",
        mutationState: "editable",
        mutationContract: "browser session/local preference",
        detail:
          "Theme and selected workspace are cockpit preferences. They do not mutate project, host, provider, or secret state.",
      }),
    ],
  });
}

function category(options: {
  id: string;
  label: string;
  summary: string;
  primaryScope: NexusDashboardSettingsScope;
  items: NexusDashboardSettingsItem[];
}): NexusDashboardSettingsCategory {
  const editableCount = options.items.filter((item) =>
    item.mutationState === "editable"
  ).length;
  const blockedCount = options.items.filter((item) =>
    item.mutationState === "blocked"
  ).length;
  const readOnlyCount = options.items.filter((item) =>
    item.mutationState === "read-only"
  ).length;
  const secretCount = options.items.filter((item) =>
    item.sensitivity === "secret"
  ).length;

  return {
    id: options.id,
    label: options.label,
    summary: options.summary,
    primaryScope: options.primaryScope,
    mutationState: categoryMutationState(options.items),
    itemCount: options.items.length,
    editableCount,
    blockedCount,
    readOnlyCount,
    secretCount,
    items: options.items,
  };
}

function item(
  options: Omit<
    NexusDashboardSettingsItem,
    "sensitivity" | "blocker"
  > &
    Partial<Pick<NexusDashboardSettingsItem, "sensitivity" | "blocker">>,
): NexusDashboardSettingsItem {
  return {
    sensitivity: "public",
    blocker: null,
    ...options,
  };
}

function categoryMutationState(
  items: NexusDashboardSettingsItem[],
): NexusDashboardSettingsMutationState {
  if (items.some((item) => item.mutationState === "editable")) return "editable";
  if (items.some((item) => item.mutationState === "preview-only")) {
    return "preview-only";
  }
  if (items.some((item) => item.mutationState === "blocked")) return "blocked";
  return "read-only";
}

function summarizeHomeSettings(homePath: string | undefined): HomeSettingsSummary {
  if (!homePath) {
    return {
      source: "DevNexus home config",
      authProfileCount: 0,
      claimAuthorityProfileCount: 0,
      hostOverlayCount: 0,
      remoteExecutionProfileCount: 0,
      readable: false,
      blocker: "No home path was supplied to the cockpit snapshot.",
    };
  }

  const source = nexusHomeConfigPath(homePath);
  try {
    const home = loadNexusHomeConfigFile(
      homePath,
      validateNexusHomeConfigBase,
      {
        missingMessage: "DevNexus home config is not initialized.",
      },
    );
    return readableHomeSummary(source, home);
  } catch (error) {
    return {
      source,
      authProfileCount: 0,
      claimAuthorityProfileCount: 0,
      hostOverlayCount: 0,
      remoteExecutionProfileCount: 0,
      readable: false,
      blocker: error instanceof Error ? error.message : String(error),
    };
  }
}

function readableHomeSummary(
  source: string,
  home: NexusHomeConfigBase,
): HomeSettingsSummary {
  return {
    source,
    authProfileCount: home.authProfiles?.length ?? 0,
    claimAuthorityProfileCount: home.claimAuthorityProfiles?.length ?? 0,
    hostOverlayCount: home.hostOverlays?.length ?? 0,
    remoteExecutionProfileCount: home.remoteExecution?.commandProfiles.length ?? 0,
    readable: true,
    blocker: null,
  };
}

function componentCount(count: number): string {
  return count === 1 ? "1 component" : `${count} components`;
}

function sourceRootSummary(components: NexusDashboardComponentSummary[]): string {
  const missing = components.filter((component) => !component.sourceRootExists).length;
  if (missing === 0) return "all source roots resolved";
  return missing === 1 ? "1 missing source root" : `${missing} missing source roots`;
}

function authorityStatusSummary(
  authority: NexusDashboardAuthoritySummary | null,
): string {
  if (!authority) return "not loaded";
  return [
    componentCount(authority.components.length),
    `${authority.blockedActionCount} blocked actions`,
    `${authority.waitingActionCount} waiting`,
    `${authority.fallbackActionCount} fallback`,
  ].join(", ");
}
