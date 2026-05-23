import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  currentNexusCliScriptPath,
  resolveNexusProjectAgentMcpTargets,
  type MaterializedNexusAgentMcpTarget,
} from "../agents/nexusAgentMcpConfig.js";
import {
  planNexusAgentClientAdapterCommand,
} from "../agents/nexusAgentClientAdapterWrapper.js";
import type {
  NexusAgentClientRuntimeCommandLocator,
  NexusAgentClientRuntimeCommandRunner,
} from "../agents/nexusAgentClientRuntimeResolver.js";
import {
  buildNexusProjectAgentProjectionStatus,
  type NexusAgentProjectionPathStatus,
  type NexusAgentProjectionPolicyDiagnostic,
} from "../agents/nexusAgentProjectionStatus.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  activeNexusProjectMcpAgentTargets,
  activeNexusProjectSkillAgentTargets,
  loadProjectConfig,
  projectConfigPath,
  type NexusProjectAgentMcpTarget,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolveNexusMcpExposure,
  type NexusMcpExposureResolution,
} from "../mcp/nexusMcpExposurePolicy.js";
import {
  defaultNexusMcpGatewayServerName,
  nexusMcpGatewayAgentTargets,
} from "../mcp/nexusMcpGatewayProjection.js";
import { findForbiddenSharedHostLocalDetails } from "../hosts/nexusHostRegistry.js";
import {
  deriveNexusProjectHostingRepositoryName,
  expectedNexusProjectHostingRemotes,
  planNexusProjectHosting,
  statusNexusProjectHostingLocal,
  type NexusHostingAuthProfileConfig,
  type NexusProjectHostingAccessPrincipalConfig,
  type NexusProjectHostingExpectedRemote,
  type NexusProjectHostingPlanResult,
  type NexusProjectHostingStatusResult,
} from "./nexusProjectHosting.js";
import { analyzeNexusProjectPath, resolveNexusProjectPath } from "../runtime/nexusPathResolver.js";
import {
  classifyNexusComponentSourceRootTopology,
  type NexusComponentSourceRootTopology,
} from "./nexusSourceRootTopology.js";
import type {
  NexusPluginMcpServerCapability,
  NexusPluginProjectedSkillCapability,
  NexusProjectPluginConfig,
} from "./nexusPluginCapabilities.js";
import {
  nexusSkillMarkdownFileName,
  nexusSkillSupportDirectoryName,
  nexusSkillsDirectoryName,
} from "../agents/nexusSkills.js";
import { resolveNexusCommandPath } from "../runtime/nexusCommandPath.js";
import {
  isAsciiDigit,
  isAsciiLetterOrDigit,
  isLowerAsciiLetterOrDigit,
  replaceRunsWithHyphen,
  trimHyphens,
} from "../runtime/nexusTextNormalization.js";

export type NexusSetupFlowId =
  | "github-workspace-repository"
  | "github-meta-project"
  | "join-existing-project";

export type NexusSetupPlatform =
  | "auto"
  | "macos"
  | "windows"
  | "linux";

export type NexusSetupStepKind =
  | "manual"
  | "automated"
  | "verification";

export type NexusSetupStepScope =
  | "shared"
  | "host-local";

export type NexusSetupCheckStatus =
  | "passed"
  | "blocked"
  | "warning";

export type NexusSetupRecordedStepStatus =
  | "pending"
  | "completed"
  | "blocked"
  | "skipped";

export interface NexusSetupFlowSummary {
  id: NexusSetupFlowId;
  title: string;
  summary: string;
}

export interface NexusSetupStep {
  id: string;
  title: string;
  kind: NexusSetupStepKind;
  scope: NexusSetupStepScope;
  summary: string;
  commands: string[];
  manualInstructions: string[];
  checks: string[];
}

export interface NexusSetupPlan {
  flow: NexusSetupFlowSummary;
  platform: NexusSetupPlatform;
  project: {
    id: string;
    name: string;
    root: string;
    repoRemoteUrl: string | null;
    defaultBranch: string | null;
  } | null;
  steps: NexusSetupStep[];
  nextActions: string[];
}

export interface NexusSetupCheck {
  flow: NexusSetupFlowSummary;
  platform: NexusSetupPlatform;
  projectRoot: string;
  status: NexusSetupCheckStatus;
  checks: NexusSetupCheckResult[];
  nextActions: string[];
}

export interface NexusSetupCheckResult {
  id: string;
  title: string;
  status: NexusSetupCheckStatus;
  summary: string;
  nextAction: string | null;
  details?: Record<string, unknown>;
}

interface ConfiguredMcpServerCommandLine {
  command: string;
  args: string[];
}

export interface NexusMcpRuntimeProcess {
  pid: number;
  commandLine: string;
  provider?: string | null;
  serverName?: string | null;
}

export interface NexusSetupState {
  version: 1;
  updatedAt: string;
  flows: Record<string, NexusSetupFlowState>;
}

export interface NexusSetupFlowState {
  steps: Record<string, NexusSetupStepRecord>;
}

export interface NexusSetupStepRecord {
  status: NexusSetupRecordedStepStatus;
  note: string | null;
  updatedAt: string;
}

export interface RecordNexusSetupStepOptions {
  projectRoot: string;
  flowId: NexusSetupFlowId | string;
  stepId: string;
  status: NexusSetupRecordedStepStatus;
  note?: string | null;
  now?: () => Date | string;
}

export interface RecordNexusSetupStepResult {
  statePath: string;
  state: NexusSetupState;
}

export interface NexusSetupAgentClientAdapterDiagnosticsOptions {
  sourceRoot?: string | null;
  sourceCliPath?: string | null;
  projectLocalRuntimeRoot?: string | null;
  pluginLocalRuntimeRoot?: string | null;
  pluginDataRoot?: string | null;
  manualGlobalCommand?: string | null;
  env?: NodeJS.ProcessEnv;
  commandRunner?: NexusAgentClientRuntimeCommandRunner;
  commandLocator?: NexusAgentClientRuntimeCommandLocator;
  fileExists?: (filePath: string) => boolean;
}

const setupFlows: NexusSetupFlowSummary[] = [
  {
    id: "github-workspace-repository",
    title: "Create or connect GitHub workspace repository hosting",
    summary:
      "Guide bot or organization setup, isolated GitHub auth, SSH aliases, and shared DevNexus workspace repository remotes.",
  },
  {
    id: "join-existing-project",
    title: "Join an existing DevNexus workspace on this machine",
    summary:
      "Guide a new machine through cloning a shared workspace repository, configuring host-local auth, preparing components, and refreshing agent setup.",
  },
];

const agentProjectSessionStepId = "open-agent-project-session";
const legacyCodexDesktopProjectStepId = "open-codex-desktop-project";

export function listNexusSetupFlows(): NexusSetupFlowSummary[] {
  return setupFlows.map((flow) => ({ ...flow }));
}

export function buildNexusSetupPlan(options: {
  projectRoot: string;
  flowId: NexusSetupFlowId | string;
  platform?: NexusSetupPlatform | string;
}): NexusSetupPlan {
  const flow = setupFlow(options.flowId);
  const platform = normalizeSetupPlatform(options.platform);
  const projectRoot = path.resolve(options.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const project = projectSummary(projectRoot, projectConfig);

  return {
    flow,
    platform,
    project,
    steps:
      flow.id === "join-existing-project"
        ? joinExistingProjectSteps({ projectRoot, projectConfig, platform })
        : githubMetaProjectSteps({ projectRoot, projectConfig, platform }),
    nextActions:
      flow.id === "join-existing-project"
        ? [
            "Install prerequisites, then choose a fresh DevNexus workspace root and clone or update the shared workspace repository there.",
            "Configure human and automation GitHub auth profiles before allowing pushes.",
            "Run setup check again and address blocked component source roots or MCP projection gaps.",
          ]
        : [
            "Choose whether the workspace repository lives under a machine-user account or an organization.",
            "Complete manual GitHub account or organization setup before running verification checks.",
            "Configure host-local auth profiles and only then create or connect the private workspace repository.",
          ],
  };
}

export function buildNexusSetupCheck(options: {
  projectRoot: string;
  flowId: NexusSetupFlowId | string;
  platform?: NexusSetupPlatform | string;
  agentClientAdapter?: false | NexusSetupAgentClientAdapterDiagnosticsOptions;
}): NexusSetupCheck {
  const flow = setupFlow(options.flowId);
  const platform = normalizeSetupPlatform(options.platform);
  const localPathPlatform = currentSetupPlatform();
  const projectRoot = path.resolve(options.projectRoot);
  const checks: NexusSetupCheckResult[] = [];
  const setupState = readNexusSetupState(nexusSetupStatePath(projectRoot));

  let projectConfig: NexusProjectConfig | null = null;
  try {
    projectConfig = loadProjectConfig(projectRoot);
    checks.push({
      id: "project-config",
      title: "Workspace config",
      status: "passed",
      summary: "dev-nexus.project.json loaded successfully.",
      nextAction: null,
    });
  } catch (error) {
    checks.push({
      id: "project-config",
      title: "Workspace config",
      status: "blocked",
      summary: error instanceof Error ? error.message : String(error),
      nextAction: "Clone the shared workspace repository or run this command from the workspace root.",
    });
  }

  checks.push(pathCheck({
    id: "workspace-git-repository",
    title: "Workspace Git repository",
    pathName: path.join(projectRoot, ".git"),
    passedSummary: "The workspace repository is a Git checkout.",
    blockedSummary: "The workspace repository is not a Git checkout at this path.",
    nextAction: "Clone or initialize the shared DevNexus workspace repository.",
    missingStatus: "blocked",
  }));

  const agentMcpTargets = setupAgentMcpTargets(projectRoot, projectConfig);
  const checkedAgentMcpConfigPaths = new Set<string>();
  for (const target of agentMcpTargets) {
    const exposure = projectConfig
      ? agentMcpTargetExposure(target)
      : null;
    if (
      (!exposure || exposure.mode === "direct") &&
      !checkedAgentMcpConfigPaths.has(target.configPath)
    ) {
      checkedAgentMcpConfigPaths.add(target.configPath);
      checks.push(pathCheck({
        id: `agent-mcp-config-${target.agent}`,
        title: `${target.agent} MCP config`,
        pathName: target.configPath,
        passedSummary:
          `${target.provider} MCP config exists for this workspace root: ${target.configPathRelative}.`,
        blockedSummary:
          `${target.provider} MCP config has not been projected or manually configured for this machine: ${target.configPathRelative}.`,
        nextAction:
          "Run dev-nexus workspace mcp refresh . after installing DevNexus.",
        missingStatus: "warning",
      }));
      checks.push(...agentMcpCapabilityGapChecks(target));
    }
    checks.push(agentMcpServerConfiguredCheck(target, exposure ?? undefined));
  }

  if (projectConfig) {
    checks.push(sharedHostRegistryHostLocalDetailsCheck(projectRoot));
    checks.push(...agentProjectionStatusChecks(projectRoot, projectConfig));
    const pluginChecks = pluginProjectionChecks(projectRoot, projectConfig);
    checks.push(...pluginChecks);
    checks.push(...agentClientAdapterReadinessChecks({
      projectRoot,
      projectConfig,
      agentMcpTargets,
      platform: localPathPlatform,
      pluginChecks,
      diagnostics: options.agentClientAdapter,
    }));
  }

  if (flow.id === "github-workspace-repository" && projectConfig) {
    checks.push(...githubMetaProjectChecks(projectRoot, projectConfig, setupState));
  }

  if (flow.id === "join-existing-project" && projectConfig) {
    checks.push(...githubMetaProjectReadinessChecks(projectRoot, projectConfig, {
      checkFallbackRemotes: false,
      warnWhenHostingMissing: false,
    }));
  }

  if (flow.id === "join-existing-project" && agentMcpTargets.length > 0) {
    const flowState = setupState.flows[flow.id];
    checks.push(recordedStepCheck({
      id: "agent-project-session",
      title: "Agent workspace session",
      record:
        flowState?.steps[agentProjectSessionStepId] ??
        flowState?.steps[legacyCodexDesktopProjectStepId],
      passedSummary:
        "Agent application workspace/session opening and DevNexus MCP visibility were recorded for this machine.",
      pendingSummary:
        "Repo-local MCP config exists, but opening the configured agent application or session on this workspace root has not been recorded.",
      blockedSummary:
        "Agent application workspace/session setup was recorded as blocked for this machine.",
      nextAction:
        `Open or restart the configured agent application on this workspace root, confirm DevNexus MCP tools are visible, then run dev-nexus setup record . join-existing-project ${agentProjectSessionStepId} --status completed --note "DevNexus MCP tools visible."`,
    }));
  }

  if (projectConfig) {
    for (const component of projectConfig.components) {
      const sourceRootPlan = componentCheckSourceRoot(
        component,
        projectRoot,
        platform,
        localPathPlatform,
      );
      checks.push(componentSourceRootTopologyCheck({
        component,
        topology: sourceRootPlan.topology,
      }));
      checks.push(...componentGitSafetyChecks(component, sourceRootPlan.path, {
        topology: sourceRootPlan.topology,
      }));
    }
  }

  const status = summarizeCheckStatus(checks);
  return {
    flow,
    platform,
    projectRoot,
    status,
    checks,
    nextActions: checks
      .filter((check) => check.status !== "passed" && check.nextAction)
      .map((check) => check.nextAction!),
  };
}

export function buildNexusMcpRuntimeFreshnessChecks(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  liveProcesses?: readonly NexusMcpRuntimeProcess[] | false;
}): NexusSetupCheckResult[] {
  const projectRoot = path.resolve(options.projectRoot);
  const agentMcpTargets = setupAgentMcpTargets(projectRoot, options.projectConfig);
  const staticChecks = [
    ...agentMcpTargets.map((target) =>
      agentMcpServerConfiguredCheck(
        target,
        agentMcpTargetExposure(target),
      )
    ),
    ...pluginMcpServerChecks(projectRoot, options.projectConfig),
  ].filter((check) => check.summary.includes("stale or unexpected"));
  const liveProcesses = options.liveProcesses === false
    ? []
    : options.liveProcesses ?? listNexusMcpRuntimeProcesses();

  return [
    ...staticChecks,
    ...liveMcpRuntimeChecks({
      projectRoot,
      projectConfig: options.projectConfig,
      agentMcpTargets,
      liveProcesses,
    }),
  ];
}

export function recordNexusSetupStep(
  options: RecordNexusSetupStepOptions,
): RecordNexusSetupStepResult {
  const flow = setupFlow(options.flowId);
  const statePath = nexusSetupStatePath(options.projectRoot);
  const now = normalizeNow(options.now?.() ?? new Date());
  const state = readNexusSetupState(statePath);
  const legacyFlowState = state.flows[options.flowId] ?? { steps: {} };
  const flowState = state.flows[flow.id] ?? legacyFlowState;

  flowState.steps[options.stepId] = {
    status: options.status,
    note: options.note ?? null,
    updatedAt: now,
  };
  state.flows[flow.id] = flowState;
  state.updatedAt = now;

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  return { statePath, state };
}

export function nexusSetupStatePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".dev-nexus", "host-setup", "setup-state.json");
}

function setupFlow(flowId: NexusSetupFlowId | string): NexusSetupFlowSummary {
  const normalizedFlowId = flowId === "github-meta-project"
    ? "github-workspace-repository"
    : flowId;
  const flow = setupFlows.find((candidate) => candidate.id === normalizedFlowId);
  if (!flow) {
    throw new Error(`Unknown DevNexus setup flow: ${flowId}`);
  }
  return { ...flow };
}

function normalizeSetupPlatform(
  platform: NexusSetupPlatform | string | undefined,
): NexusSetupPlatform {
  if (platform === undefined || platform === "auto") {
    return currentSetupPlatform();
  }
  if (
    platform === "macos" ||
    platform === "windows" ||
    platform === "linux"
  ) {
    return platform;
  }
  throw new Error("setup platform must be auto, macos, windows, or linux");
}

function currentSetupPlatform(): NexusSetupPlatform {
  if (process.platform === "darwin") {
    return "macos";
  }
  if (process.platform === "win32") {
    return "windows";
  }
  return "linux";
}

function projectSummary(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusSetupPlan["project"] {
  return {
    id: projectConfig.id,
    name: projectConfig.name,
    root: projectRoot,
    repoRemoteUrl: projectConfig.repo.remoteUrl,
    defaultBranch: projectConfig.repo.defaultBranch,
  };
}

function sharedHostRegistryHostLocalDetailsCheck(
  projectRoot: string,
): NexusSetupCheckResult {
  const configPath = projectConfigPath(projectRoot);
  const rawConfig = JSON.parse(
    fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""),
  );
  const warnings = findForbiddenSharedHostLocalDetails(rawConfig);
  if (warnings.length === 0) {
    return {
      id: "shared-host-registry-host-local-details",
      title: "Shared host registry host-local details",
      status: "passed",
      summary: "Shared host registry contains no host-local transport, path, credential, port, or runtime artifact details.",
      nextAction: null,
    };
  }

  const warningPaths = [...new Set(warnings.map((warning) => warning.path))];
  const visiblePaths = warningPaths.slice(0, 6).join(", ");
  const suffix =
    warningPaths.length > 6
      ? `, and ${warningPaths.length - 6} more`
      : "";

  return {
    id: "shared-host-registry-host-local-details",
    title: "Shared host registry host-local details",
    status: "warning",
    summary:
      `Shared host registry contains host-local details that must not be committed: ${visiblePaths}${suffix}.`,
    nextAction:
      "Move Tailscale or SSH targets, usernames, credentials, absolute paths, live ports, and runtime artifacts into DevNexus home host-local overlays keyed by stable host id.",
  };
}

interface MetaProjectRemotePlan {
  humanRemoteName: string;
  humanRemote: string;
  automationRemoteName: string;
  botRemote: string;
  automationAuthProfileId: string | null;
  automationAuthProfileDirectory: string;
  automationSshHost: string;
  automationAuthKind: "github_app" | "provider_cli";
  automationProviderIdentity: string | null;
}

interface MetaProjectHostingGuide {
  namespace: string;
  repositoryName: string;
  visibility: "public" | "private" | "internal";
  defaultBranch: string;
  allowCreate: boolean;
  recommendedBotAccount: string;
  recommendedOrgNamespace: string;
  configuredHosting: boolean;
}

function metaProjectRemotePlan(
  projectConfig: NexusProjectConfig,
): MetaProjectRemotePlan {
  if (projectConfig.hosting) {
    const remotes = expectedNexusProjectHostingRemotes({
      project: projectConfig,
      hosting: projectConfig.hosting,
    });
    const humanRemote =
      remotes.find((remote) => remote.role === "human") ??
      remotes.find((remote) => remote.name === "origin") ??
      remotes[0]!;
    const botRemote =
      remotes.find((remote) => remote.role === "automation") ??
      remotes.find((remote) => remote.name === "bot") ??
      humanRemote;
    const automationPrincipal = automationPrincipalForRemote(
      projectConfig,
      botRemote,
    );
    const automationAuthKind =
      automationPrincipal?.kind === "app" ? "github_app" : "provider_cli";

    return {
      humanRemoteName: humanRemote.name,
      humanRemote: humanRemote.url,
      automationRemoteName: botRemote.name,
      botRemote: botRemote.url,
      automationAuthProfileId: botRemote.authProfile,
      automationAuthProfileDirectory: authProfileConfigDirectory(
        botRemote.authProfile,
      ),
      automationSshHost:
        sshHostFromGitRemote(botRemote.url) ?? "<automation-ssh-host>",
      automationAuthKind,
      automationProviderIdentity: automationPrincipal?.providerIdentity ?? null,
    };
  }

  const metaRemote = projectConfig.repo.remoteUrl ?? "<workspace-repository-url>";
  const botRemote = metaRemote;
  return {
    humanRemoteName: "origin",
    humanRemote: humanRemoteFromAutomationRemote(metaRemote),
    automationRemoteName: "bot",
    botRemote,
    automationAuthProfileId: null,
    automationAuthProfileDirectory: authProfileConfigDirectory(null),
    automationSshHost: sshHostFromGitRemote(botRemote) ?? "<automation-ssh-host>",
    automationAuthKind: "provider_cli",
    automationProviderIdentity: null,
  };
}

function automationPrincipalForRemote(
  projectConfig: NexusProjectConfig,
  remote: NexusProjectHostingExpectedRemote,
): NexusProjectHostingAccessPrincipalConfig | null {
  const access = projectConfig.hosting?.access ?? [];
  if (remote.authProfile) {
    return access.find((principal) =>
      principal.role === "automation" &&
      principal.authProfile === remote.authProfile
    ) ?? null;
  }

  return access.find((principal) =>
    principal.role === "automation" &&
    principal.kind === "app"
  ) ?? null;
}

function metaProjectHostingGuide(
  projectConfig: NexusProjectConfig,
): MetaProjectHostingGuide {
  const parsedRemote = parseGitHubRemote(projectConfig.repo.remoteUrl ?? "");
  const configuredHosting = projectConfig.hosting;
  const namespace =
    configuredHosting?.namespace ??
    parsedRemote?.namespace ??
    "<github-user-or-org>";
  const repositoryName = configuredHosting
    ? deriveNexusProjectHostingRepositoryName({
        project: projectConfig,
        hosting: configuredHosting,
      })
    : parsedRemote?.repository ?? projectConfig.id;
  const namingSeed = setupNameSlug(
    namespace.startsWith("<") ? projectConfig.id : namespace,
  );

  return {
    namespace,
    repositoryName,
    visibility: configuredHosting?.repository.visibility ?? "private",
    defaultBranch:
      configuredHosting?.repository.defaultBranch ??
      projectConfig.repo.defaultBranch ??
      "main",
    allowCreate: configuredHosting?.provisioning.allowCreate ?? false,
    recommendedBotAccount: `${namingSeed}-bot`,
    recommendedOrgNamespace: `${namingSeed}-dev-nexus`,
    configuredHosting: Boolean(configuredHosting),
  };
}

function authProfileConfigDirectory(authProfile: string | null): string {
  const safeProfile = trimHyphens(
    replaceRunsWithHyphen(
      (authProfile ?? "automation-github").trim(),
      (character) => !isMixedCaseSafeNameCharacter(character),
    ),
  );
  return `gh-${safeProfile || "automation-github"}`;
}

function sshHostFromGitRemote(remoteUrl: string): string | null {
  const match = /^git@([^:]+):/u.exec(remoteUrl);
  return match?.[1] ?? null;
}

function automationAuthProfileSummary(plan: MetaProjectRemotePlan): string {
  if (plan.automationAuthKind === "github_app") {
    return "Configure the host-local GitHub App profile for installation-token automation.";
  }

  return "Create or verify the isolated GitHub CLI and SSH profile used by the automation actor.";
}

function automationAuthProfileCommands(
  plan: MetaProjectRemotePlan,
  platform: NexusSetupPlatform,
  setupCheckFlowId: NexusSetupFlowId,
): string[] {
  if (plan.automationAuthKind === "github_app") {
    const appDirectory = plan.automationAuthProfileId ??
      plan.automationProviderIdentity ??
      "github-app";
    return [
      ...platformCommands(platform, {
        macos: [
          `mkdir -p "$HOME/.dev-nexus/secrets/github-apps/${appDirectory}"`,
        ],
        windows: [
          `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.dev-nexus\\secrets\\github-apps\\${appDirectory}"`,
        ],
        linux: [
          `mkdir -p "$HOME/.dev-nexus/secrets/github-apps/${appDirectory}"`,
        ],
      }),
      `dev-nexus setup check . ${setupCheckFlowId} --json`,
    ];
  }

  return platformCommands(platform, {
    macos: [
      `mkdir -p "$HOME/.config/${plan.automationAuthProfileDirectory}" "$HOME/.ssh"`,
      `GH_CONFIG_DIR="$HOME/.config/${plan.automationAuthProfileDirectory}" gh auth login --hostname github.com --git-protocol ssh --web`,
      `ssh -T git@${plan.automationSshHost}`,
    ],
    windows: [
      `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.config\\${plan.automationAuthProfileDirectory}"`,
      `$env:GH_CONFIG_DIR="$env:USERPROFILE\\.config\\${plan.automationAuthProfileDirectory}"; gh auth login --hostname github.com --git-protocol ssh --web`,
      `ssh -T git@${plan.automationSshHost}`,
    ],
    linux: [
      `mkdir -p "$HOME/.config/${plan.automationAuthProfileDirectory}" "$HOME/.ssh"`,
      `GH_CONFIG_DIR="$HOME/.config/${plan.automationAuthProfileDirectory}" gh auth login --hostname github.com --git-protocol ssh --web`,
      `ssh -T git@${plan.automationSshHost}`,
    ],
  });
}

function automationAuthProfileInstructions(
  plan: MetaProjectRemotePlan,
): string[] {
  if (plan.automationAuthKind === "github_app") {
    return [
      "Create or reuse the GitHub App manually, then install it on the organization or account that owns the repositories.",
      "Store the downloaded private key under DevNexus home or another host-local secret store, not in the shared workspace repository.",
      "Add a DevNexus home auth profile with kind=app, credentialKind=github_app, appId or clientId, privateKeyPath, installationAccount, selected repositories, and intended purposes.",
      "Keep issued installation tokens out of config; DevNexus should mint short-lived tokens through the provider facade when an operation needs them.",
      "If project policy wants a human actor with the App as the credential path, configure a separate kind=human, credentialKind=github_app_user_token profile with githubApp.clientId and authorize it with dev-nexus auth github-app user login.",
      "GitHub CLI can still be used for human actions or as an adapter backend, but the workspace should depend on the DevNexus auth profile id.",
    ];
  }

  return [
    "Keep bot/app tokens and private keys host-local; do not commit them to the workspace repository.",
    "If using an SSH host alias, configure it in ~/.ssh/config before validating the bot remote.",
  ];
}

function automationAuthProfileChecks(
  plan: MetaProjectRemotePlan,
  setupCheckFlowId: NexusSetupFlowId,
): string[] {
  if (plan.automationAuthKind === "github_app") {
    return [
      `dev-nexus setup check . ${setupCheckFlowId} --json`,
      "dev-nexus workspace hosting status . --json",
    ];
  }

  return [
    `GH_CONFIG_DIR="$HOME/.config/${plan.automationAuthProfileDirectory}" gh auth status --hostname github.com`,
    `ssh -T git@${plan.automationSshHost}`,
    `git ls-remote ${plan.botRemote} HEAD`,
  ];
}

function remoteSetCommand(name: string, url: string): string {
  return `git remote get-url ${name} >/dev/null 2>&1 && git remote set-url ${name} ${url} || git remote add ${name} ${url}`;
}

function automationRemoteFetchCommands(plan: MetaProjectRemotePlan): string[] {
  if (plan.automationAuthKind === "github_app") {
    return ["dev-nexus workspace hosting status . --json"];
  }

  return [`git fetch ${plan.automationRemoteName}`];
}

function automationRemoteCheckCommands(plan: MetaProjectRemotePlan): string[] {
  if (plan.automationAuthKind === "github_app") {
    return [
      `git remote get-url ${plan.automationRemoteName}`,
      "dev-nexus workspace hosting status . --json",
    ];
  }

  return [`git fetch --dry-run ${plan.automationRemoteName}`];
}

function parseGitHubRemote(
  remoteUrl: string,
): { namespace: string; repository: string } | null {
  const sshRemote = /^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/u.exec(remoteUrl);
  if (sshRemote) {
    return {
      namespace: sshRemote[1]!,
      repository: sshRemote[2]!,
    };
  }

  const httpsRemote =
    /^https:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/u.exec(remoteUrl);
  if (httpsRemote) {
    return {
      namespace: httpsRemote[1]!,
      repository: httpsRemote[2]!,
    };
  }

  return null;
}

function setupNameSlug(value: string): string {
  return trimHyphens(
    replaceRunsWithHyphen(
      value.trim().toLowerCase(),
      (character) => !isLowerAsciiLetterOrDigit(character),
    ),
  ) || "dev-nexus";
}

function isMixedCaseSafeNameCharacter(character: string): boolean {
  return isAsciiLetterOrDigit(character) ||
    character === "." ||
    character === "_" ||
    character === "-";
}

function joinExistingProjectSteps(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  platform: NexusSetupPlatform;
}): NexusSetupStep[] {
  const remotePlan = metaProjectRemotePlan(options.projectConfig);
  const { humanRemote, botRemote } = remotePlan;
  const devNexusCommand = "dev-nexus";
  const projectRootForPlatform = planProjectRootPath(
    options.projectConfig,
    options.platform,
  );
  const agentMcpTargets = setupAgentMcpTargets(
    options.projectRoot,
    options.projectConfig,
  );
  return [
    {
      id: "install-prerequisites",
      title: "Install prerequisites",
      kind: "manual",
      scope: "host-local",
      summary: "Install Git, Node.js 22 or newer, GitHub CLI, and DevNexus on this machine.",
      commands: platformCommands(options.platform, {
        macos: [
          "brew install git gh node",
          "npm install -g @evref-bl/dev-nexus@alpha",
        ],
        windows: [
          "winget install --id Git.Git -e",
          "winget install --id GitHub.cli -e",
          "npm install -g @evref-bl/dev-nexus@alpha",
        ],
        linux: [
          "npm install -g @evref-bl/dev-nexus@alpha",
        ],
      }),
      manualInstructions: [
        "Use the package manager you trust on this host; the commands are examples.",
        "For freshly published prerelease packages, setup should wait for npm packument and dist-tag visibility with bounded retry/backoff before installing.",
        "Classify npm fetch failures before assigning worker tasks: E404 immediately after publish is registry propagation delay, network and timeout errors are network failures, absent versions are missing-version blockers, and damaged node_modules belongs to setup repair.",
        "Do not continue to auth or remotes until git, gh, node, npm, and dev-nexus are available.",
      ],
      checks: ["git --version", "gh --version", "node --version", `${devNexusCommand} --help`],
    },
    {
      id: "clone-or-update-workspace-repository",
      title: "Clone or update the shared workspace repository",
      kind: "manual",
      scope: "host-local",
      summary:
        `Create or reuse the DevNexus workspace root at ${projectRootForPlatform}; this directory is the shared workspace repository checkout, not a component source checkout.`,
      commands: [
        makeDirectoryCommand(path.dirname(projectRootForPlatform), options.platform),
        `git clone ${humanRemote} ${shellPathPlaceholder(projectRootForPlatform)}`,
        `cd ${shellPathPlaceholder(projectRootForPlatform)}`,
        "git pull --ff-only",
      ],
      manualInstructions: [
        `Use ${projectRootForPlatform} as the fresh DevNexus workspace directory on this machine unless you intentionally chose another empty location.`,
        "The cloned workspace repository root becomes the DevNexus workspace root for later setup, MCP refresh, automation, and work-item commands.",
        "Do not clone the workspace repository inside a component source checkout; component sources are prepared in a later step.",
        "Use your human account for the normal origin remote when the repo is private and you are a collaborator.",
        "If this directory already exists, inspect dirty state before pulling.",
      ],
      checks: ["test -d .git", "git status --short --branch"],
    },
    {
      id: "configure-human-github-auth",
      title: "Configure human GitHub auth",
      kind: "manual",
      scope: "host-local",
      summary: "Verify plain GitHub CLI and SSH access use the human account.",
      commands: [
        "gh auth status --hostname github.com || gh auth login --hostname github.com --git-protocol ssh --web",
        `git ls-remote ${humanRemote} HEAD`,
      ],
      manualInstructions: [
        "Authenticate in the browser as the human account, not the automation bot.",
        "Use the human SSH key for normal github.com access.",
      ],
      checks: ["gh auth status --hostname github.com", `git ls-remote ${humanRemote} HEAD`],
    },
    {
      id: "configure-automation-auth-profile",
      title: "Configure automation auth profile",
      kind: "manual",
      scope: "host-local",
      summary: automationAuthProfileSummary(remotePlan),
      commands: automationAuthProfileCommands(
        remotePlan,
        options.platform,
        "join-existing-project",
      ),
      manualInstructions: automationAuthProfileInstructions(remotePlan),
      checks: automationAuthProfileChecks(remotePlan, "join-existing-project"),
    },
    {
      id: "configure-workspace-remotes",
      title: "Configure workspace repository remotes",
      kind: "automated",
      scope: "host-local",
      summary: "Set the human and automation remotes for workspace publication.",
      commands: [
        `git remote set-url ${remotePlan.humanRemoteName} ${humanRemote}`,
        remoteSetCommand(remotePlan.automationRemoteName, botRemote),
        `git fetch ${remotePlan.humanRemoteName}`,
        ...automationRemoteFetchCommands(remotePlan),
      ],
      manualInstructions: [
        "Run these from the DevNexus workspace root after the human and automation auth profiles are configured.",
        "For GitHub App remotes, DevNexus injects short-lived credentials for publication operations instead of expecting a persistent Git credential helper.",
      ],
      checks: [
        "git remote -v",
        `git fetch --dry-run ${remotePlan.humanRemoteName}`,
        ...automationRemoteCheckCommands(remotePlan),
      ],
    },
    {
      id: "prepare-component-checkouts",
      title: "Prepare component source checkouts",
      kind: "manual",
      scope: "host-local",
      summary: "Clone or point host-local component source roots at the paths configured for this machine.",
      commands: componentCloneCommands(
        options.projectConfig,
        options.platform,
        options.projectRoot,
      ),
      manualInstructions: [
        "Preserve any existing dirty source checkout; fetch first and stop on conflicts.",
        "Host-local paths may differ between Mac and Windows and should not contain secrets.",
      ],
      checks: componentSourceChecks(
        options.projectConfig,
        options.platform,
        options.projectRoot,
      ),
    },
    {
      id: "refresh-agent-mcp-and-skills",
      title: "Refresh agent MCP and skills projection",
      kind: "automated",
      scope: "host-local",
      summary: "Refresh DevNexus MCP and agent support files for this machine.",
      commands: [
        `${devNexusCommand} workspace mcp refresh .`,
        `${devNexusCommand} automation eligible-work . --json`,
      ],
      manualInstructions: [
        "Run from the workspace root after installing DevNexus and configuring local paths.",
        `Configured agent MCP targets: ${agentMcpTargets.length > 0 ? agentMcpTargets.map(agentMcpTargetSummary).join("; ") : "none"}.`,
        "Plugin-projected skills and plugin MCP servers may require plugin-specific setup commands; setup check reports those gaps explicitly.",
        "A raw stdio MCP tools/list smoke test confirms the server command works, but the agent workspace session is not ready until the active provider exposes the tools in its own session.",
      ],
      checks: [
        ...agentMcpConfigCheckCommands(
          options.projectConfig,
          options.projectRoot,
          options.platform,
        ),
        ...pluginProjectionCheckCommands(
          options.projectConfig,
          options.projectRoot,
          options.platform,
        ),
        `${devNexusCommand} automation eligible-work . --json`,
      ],
    },
    {
      id: agentProjectSessionStepId,
      title: "Open agent workspace session",
      kind: "manual",
      scope: "host-local",
      summary:
        "Open or create the configured agent application workspace/session for this workspace root; DevNexus writes repo-local MCP config but does not mutate private agent app state.",
      commands: [
        `${devNexusCommand} setup record . join-existing-project ${agentProjectSessionStepId} --status completed --note "DevNexus MCP tools visible in the configured agent application."`,
      ],
      manualInstructions: [
        `In the configured agent application or CLI provider, create, open, or select a workspace/session rooted at ${projectRootForPlatform}.`,
        `Configured agent MCP targets: ${agentMcpTargets.length > 0 ? agentMcpTargets.map(agentMcpTargetSummary).join("; ") : "none"}.`,
        "Confirm the provider is using the generated MCP config from the workspace root.",
        "For Codex Desktop, this means opening or creating a Codex project at the workspace root; other providers may use a different workspace/session model.",
        "Reload, restart, or start a fresh provider session if the DevNexus MCP tools are not visible after the MCP refresh.",
        "Do not treat a standalone stdio tools/list probe as completion for this step; it only proves the MCP server command can start.",
        "Run the setup record command only after the active provider session can see the DevNexus MCP tools.",
        "Do not edit provider global state or app databases directly; treat workspace/session registration as a manual provider action until a supported API exists.",
      ],
      checks: [
        "Open the configured agent application or session on the workspace root and confirm DevNexus MCP tools are visible.",
        `${devNexusCommand} setup check . join-existing-project --platform ${options.platform} --json`,
      ],
    },
    {
      id: "run-final-preflight",
      title: "Run final setup preflight",
      kind: "verification",
      scope: "host-local",
      summary: "Confirm the new machine is ready for supervised DevNexus work.",
      commands: [
        makeDirectoryCommand(setupCommandPath(".dev-nexus/host-setup", options.platform), options.platform),
        `${devNexusCommand} setup check . join-existing-project --platform ${options.platform} --json`,
        `${devNexusCommand} setup check . join-existing-project --platform ${options.platform} --json > .dev-nexus/host-setup/join-existing-project-report.json`,
        "git status --short --branch",
      ],
      manualInstructions: [
        "Do not launch live runtime services from baseline setup; use approved runtime profiles only.",
        "Keep the saved setup report under .dev-nexus/host-setup on this machine; it is host-local handoff state and must not contain secrets.",
      ],
      checks: [
        `${devNexusCommand} setup check . join-existing-project --platform ${options.platform} --json`,
        "test -f .dev-nexus/host-setup/join-existing-project-report.json",
      ],
    },
  ];
}

function githubMetaProjectSteps(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  platform: NexusSetupPlatform;
}): NexusSetupStep[] {
  const remotePlan = metaProjectRemotePlan(options.projectConfig);
  const { humanRemote, botRemote } = remotePlan;
  const guide = metaProjectHostingGuide(options.projectConfig);
  const devNexusCommand = "dev-nexus";
  return [
    {
      id: "choose-hosting-namespace",
      title: "Choose workspace repository hosting namespace",
      kind: "manual",
      scope: "shared",
      summary:
        `Choose where the shared workspace repository lives. Recommended bot account: ${guide.recommendedBotAccount}; recommended organization namespace: ${guide.recommendedOrgNamespace}; repository: ${guide.repositoryName}.`,
      commands: [],
      manualInstructions: [
        `Use a clearly named machine-user or app actor for automation activity, for example ${guide.recommendedBotAccount}; custom names are fine when recorded in hosting/auth profile metadata.`,
        `Use a private organization namespace such as ${guide.recommendedOrgNamespace} when team ownership is more important than machine-user simplicity.`,
        "Create GitHub accounts, verify email addresses, complete browser/device login, and create organizations manually; DevNexus must not automate account or organization creation.",
        `Record only portable hosting intent in dev-nexus.project.json: provider=github, namespace=${guide.namespace}, repository=${guide.repositoryName}, visibility=${guide.visibility}, defaultBranch=${guide.defaultBranch}.`,
        "Keep source repositories separate from DevNexus workspace repositories when needed.",
      ],
      checks: [],
    },
    {
      id: "configure-auth-profile",
      title: "Configure host-local auth profile",
      kind: "manual",
      scope: "host-local",
      summary: automationAuthProfileSummary(remotePlan),
      commands: automationAuthProfileCommands(
        remotePlan,
        options.platform,
        "github-workspace-repository",
      ),
      manualInstructions: automationAuthProfileInstructions(remotePlan),
      checks: automationAuthProfileChecks(
        remotePlan,
        "github-workspace-repository",
      ),
    },
    {
      id: "connect-workspace-repository",
      title: "Connect workspace repository",
      kind: "manual",
      scope: "host-local",
      summary:
        guide.allowCreate
          ? "Propose creating or connecting the shared workspace repository; live creation still requires explicit approval and configured credentials."
          : "Connect the shared workspace repository; automatic GitHub repository creation is disabled by workspace policy.",
      commands: [
        `${devNexusCommand} workspace hosting status . --json`,
        `${devNexusCommand} workspace hosting plan . --json`,
        ...(guide.allowCreate
          ? [`${devNexusCommand} workspace hosting apply . --json`]
          : []),
        `git remote set-url ${remotePlan.humanRemoteName} ${humanRemote}`,
        remoteSetCommand(remotePlan.automationRemoteName, botRemote),
        "git remote -v",
        `git fetch --dry-run ${remotePlan.humanRemoteName}`,
        ...automationRemoteCheckCommands(remotePlan),
      ],
      manualInstructions: [
        guide.allowCreate
          ? "Treat workspace hosting apply as an approval-required operation; review the plan first and run apply only after confirming the selected namespace, actor permissions, and no-secret boundary."
          : "If workspace hosting status or plan reports a missing repository, create it manually in the provider or update hosting metadata; apply will not create it while allowCreate is false.",
        "Use separate human and automation remotes so later publication guardrails can distinguish actors.",
        "For GitHub App remotes, DevNexus should resolve a short-lived installation token only for the operation that needs it.",
        "Do not push until repository existence, remotes, and actor permissions are verified.",
      ],
      checks: [
        `${devNexusCommand} workspace hosting status . --json`,
        `${devNexusCommand} workspace hosting plan . --json`,
        `git ls-remote ${humanRemote} HEAD`,
        "git remote -v",
        `git fetch --dry-run ${remotePlan.humanRemoteName}`,
        ...automationRemoteCheckCommands(remotePlan),
      ],
    },
    {
      id: "configure-publication-guardrails",
      title: "Configure publication guardrails",
      kind: "manual",
      scope: "shared",
      summary:
        "Confirm DevNexus hosting and publication metadata identify the intended human and automation actors before agents publish.",
      commands: [
        "dev-nexus automation status . --json",
        "dev-nexus setup check . github-workspace-repository --json",
      ],
      manualInstructions: [
        "Workspace hosting metadata should describe expected remotes; component or automation publication policy should name the remote future agents may push.",
        "Do not store secrets in shared publication guardrails. Store only actor kind/provider/handle, remote names, SSH host aliases, and non-secret command environment keys.",
      ],
      checks: [
        "dev-nexus automation status . --json",
        "dev-nexus setup check . github-workspace-repository --json",
      ],
    },
    {
      id: "write-setup-report",
      title: "Write host-local setup report",
      kind: "verification",
      scope: "host-local",
      summary: "Save a final non-secret setup report that another machine or agent can read before continuing.",
      commands: [
        makeDirectoryCommand(setupCommandPath(".dev-nexus/host-setup", options.platform), options.platform),
        "dev-nexus setup check . github-workspace-repository --json > .dev-nexus/host-setup/github-workspace-repository-report.json",
        "git status --short --branch",
      ],
      manualInstructions: [
        "Keep the report host-local under .dev-nexus/host-setup; it may mention local paths or auth profile ids but must not contain tokens, private keys, or gh config contents.",
      ],
      checks: [
        "test -f .dev-nexus/host-setup/github-workspace-repository-report.json",
      ],
    },
  ];
}

function setupAgentMcpTargets(
  projectRoot: string,
  projectConfig: NexusProjectConfig | null,
): MaterializedNexusAgentMcpTarget[] {
  if (projectConfig?.mcp?.enabled === false) {
    return [];
  }

  const agentTargets = projectConfig
    ? activeNexusProjectMcpAgentTargets(projectConfig)
    : undefined;
  const gatewayTargets = projectConfig && agentTargets
    ? nexusMcpGatewayAgentTargets({
        projectConfig,
        selectedTargets: agentTargets,
      })
    : [];

  return resolveNexusProjectAgentMcpTargets({
    projectRoot,
    mcpConfig: projectConfig?.mcp,
    ...(agentTargets
      ? { agentTargets: [...agentTargets, ...gatewayTargets] }
      : {}),
  });
}

function agentMcpConfigCheckCommands(
  projectConfig: NexusProjectConfig,
  projectRoot: string,
  platform: NexusSetupPlatform,
): string[] {
  const commands = setupAgentMcpTargets(projectRoot, projectConfig)
    .map((target) => ({
      target,
      exposure: agentMcpTargetExposure(target),
    }))
    .filter(({ exposure }) => exposure.mode === "direct")
    .map(({ target }) =>
      `test -f ${shellPathPlaceholder(setupCommandPath(target.configPathRelative, platform))}`,
    );
  return [...new Set(commands)];
}

function pluginProjectionCheckCommands(
  projectConfig: NexusProjectConfig,
  projectRoot: string,
  platform: NexusSetupPlatform,
): string[] {
  const commands: string[] = [];
  const skillTargets = setupAgentSkillTargets(projectConfig);
  const mcpTargets = setupAgentMcpTargets(projectRoot, projectConfig)
    .filter((target) => target.serverName !== defaultNexusMcpGatewayServerName);

  for (const { capability } of pluginProjectedSkillCapabilities(projectConfig)) {
    const matchingSkillTargets = skillTargetsForCapability(capability, skillTargets);
    if (matchingSkillTargets.length === 0) {
      continue;
    }
    commands.push(
      `test -f ${shellPathPlaceholder(setupCommandJoin(platform,
        nexusSkillSupportDirectoryName,
        nexusSkillsDirectoryName,
        capability.skillId,
        nexusSkillMarkdownFileName,
      ))}`,
    );
    for (const target of matchingSkillTargets) {
      commands.push(
        `test -f ${shellPathPlaceholder(setupCommandJoin(platform,
          target.directory,
          capability.skillId,
          nexusSkillMarkdownFileName,
        ))}`,
      );
    }
  }

  for (const { plugin, capability } of pluginMcpServerCapabilities(projectConfig)) {
    for (const target of mcpTargetsForCapability(capability, mcpTargets)) {
      const exposure = pluginMcpServerExposure(
        projectConfig,
        target,
        plugin,
        capability,
      );
      if (exposure.mode !== "direct") {
        continue;
      }
      const marker =
        target.configSchema === "codex.mcp_servers"
          ? `[mcp_servers.${capability.serverName}]`
          : `"${capability.serverName}"`;
      const configPath = setupCommandPath(target.configPathRelative, platform);
      commands.push(
        `test -f ${shellPathPlaceholder(configPath)} && grep -Fq ${shellStringLiteral(marker)} ${shellPathPlaceholder(configPath)}`,
      );
    }
  }

  return commands;
}

function pluginProjectionChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusSetupCheckResult[] {
  return [
    ...pluginProjectedSkillChecks(projectRoot, projectConfig),
    ...pluginMcpServerChecks(projectRoot, projectConfig),
  ];
}

function agentClientAdapterReadinessChecks(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  agentMcpTargets: readonly MaterializedNexusAgentMcpTarget[];
  platform: NexusSetupPlatform;
  pluginChecks: readonly NexusSetupCheckResult[];
  diagnostics?: false | NexusSetupAgentClientAdapterDiagnosticsOptions;
}): NexusSetupCheckResult[] {
  if (options.diagnostics === false) {
    return [];
  }
  if (options.diagnostics === undefined && !fs.existsSync(currentNexusCliScriptPath())) {
    return [];
  }

  const diagnostics = options.diagnostics ?? {};
  const seenAgents = new Set<string>();
  return options.agentMcpTargets.flatMap((target) => {
    const key = `${target.agent}\0${target.provider}`;
    if (seenAgents.has(key)) {
      return [];
    }
    seenAgents.add(key);
    return [agentClientAdapterReadinessCheck({
      ...options,
      target,
      diagnostics,
    })];
  });
}

function agentClientAdapterReadinessCheck(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  target: MaterializedNexusAgentMcpTarget;
  platform: NexusSetupPlatform;
  pluginChecks: readonly NexusSetupCheckResult[];
  diagnostics: NexusSetupAgentClientAdapterDiagnosticsOptions;
}): NexusSetupCheckResult {
  const client = options.target.provider.trim().toLowerCase();
  const checkBase = {
    id: `agent-client-adapter-${setupCheckIdPart(options.target.agent)}`,
    title: `${options.target.agent} agent-client adapter`,
  };
  const pluginSummary = agentClientPluginProjectionSummary({
    projectConfig: options.projectConfig,
    target: options.target,
    pluginChecks: options.pluginChecks,
  });

  if (client !== "codex" && client !== "claude") {
    return {
      ...checkBase,
      status: "warning",
      summary:
        `${options.target.provider} is not supported by DevNexus ` +
        `agent-client adapter diagnostics yet; pluginProjection=${pluginSummary}.`,
      nextAction:
        `Use existing MCP setup checks for ${options.target.provider}, ` +
        `or add adapter readiness support before shipping a ${options.target.provider} plugin.`,
      details: {
        agent: options.target.agent,
        provider: options.target.provider,
        supportedClients: ["codex", "claude"],
      },
    };
  }

  const sourceCliPath =
    options.diagnostics.sourceCliPath !== undefined
      ? options.diagnostics.sourceCliPath
      : currentNexusCliScriptPath();
  const sourceRoot =
    options.diagnostics.sourceRoot !== undefined
      ? options.diagnostics.sourceRoot
      : sourceCliPath
        ? path.dirname(path.dirname(sourceCliPath))
        : null;
  const plan = planNexusAgentClientAdapterCommand({
    client,
    entrypoint: "status",
    projectRoot: options.projectRoot,
    platform: options.platform,
    sourceRoot,
    sourceCliPath,
    projectLocalRuntimeRoot: options.diagnostics.projectLocalRuntimeRoot,
    pluginLocalRuntimeRoot: options.diagnostics.pluginLocalRuntimeRoot,
    pluginDataRoot: options.diagnostics.pluginDataRoot,
    manualGlobalCommand: options.diagnostics.manualGlobalCommand,
    env: options.diagnostics.env,
    commandRunner: options.diagnostics.commandRunner,
    commandLocator: options.diagnostics.commandLocator ?? (() => null),
    fileExists: options.diagnostics.fileExists,
  });
  const mcpCheck = agentMcpServerConfiguredCheck(options.target);
  const mcpState = agentClientMcpState(mcpCheck, options.target);
  const selected = plan.runtime.selected;
  const runtimeMode = selected?.mode ?? "none";
  const runtimeVersion = selected?.packageVersion ?? "unknown";
  const commandLine = plan.invocation?.commandLine ?? "unavailable";
  const status: NexusSetupCheckStatus = !plan.invocation
    ? "blocked"
    : mcpCheck.status === "passed"
      ? plan.status === "warning" ? "warning" : "passed"
      : "warning";

  return {
    ...checkBase,
    status,
    summary:
      `${options.target.provider} adapter readiness: runtime=${runtimeMode}; ` +
      `version=${runtimeVersion}; node=${plan.runtime.node.summary}; ` +
      `npm=${plan.runtime.npm.summary}; mcp=${mcpState}; ` +
      `pluginProjection=${pluginSummary}; command=${commandLine}.`,
    nextAction: agentClientAdapterNextAction({ plan, mcpCheck }),
    details: {
      client,
      runtimeStatus: plan.runtime.status,
      selectedRuntimeMode: runtimeMode,
      selectedRuntimeVersion: runtimeVersion,
      mcpStatus: mcpCheck.status,
      mcpSummary: mcpCheck.summary,
      diagnostics: plan.diagnostics,
      advisory: plan.advisory,
    },
  };
}

function agentClientMcpState(
  mcpCheck: NexusSetupCheckResult,
  target: MaterializedNexusAgentMcpTarget,
): string {
  if (target.configStatus === "unsupported") {
    return "unsupported";
  }
  if (!fs.existsSync(target.configPath)) {
    return "missing";
  }
  if (mcpCheck.status === "passed") {
    return "ready";
  }
  if (mcpCheck.summary.includes("stale or unexpected")) {
    return "stale";
  }
  return "warning";
}

function agentClientAdapterNextAction(options: {
  plan: ReturnType<typeof planNexusAgentClientAdapterCommand>;
  mcpCheck: NexusSetupCheckResult;
}): string | null {
  if (!options.plan.invocation) {
    const packageOperation = options.plan.advisory.packageOperations[0];
    if (packageOperation?.command) {
      return `${packageOperation.summary} Approve and run: ${packageOperation.command}`;
    }
    return options.plan.diagnostics[0] ?? "Install or configure a DevNexus runtime.";
  }

  if (options.mcpCheck.status !== "passed") {
    return options.mcpCheck.nextAction;
  }

  return null;
}

function agentClientPluginProjectionSummary(options: {
  projectConfig: NexusProjectConfig;
  target: MaterializedNexusAgentMcpTarget;
  pluginChecks: readonly NexusSetupCheckResult[];
}): string {
  const skillCapabilities = pluginProjectedSkillCapabilities(options.projectConfig)
    .filter(({ capability }) =>
      capabilityTargetsAgent(capability.targetAgents, options.target));
  const mcpCapabilities = pluginMcpServerCapabilities(options.projectConfig)
    .filter(({ capability }) =>
      capabilityTargetsAgent(capability.targetAgents, options.target));
  const matchingCheckStatuses = options.pluginChecks
    .filter((check) =>
      check.id.endsWith(`-${setupCheckIdPart(options.target.agent)}`) ||
      check.title.startsWith(`${options.target.agent} `))
    .map((check) => check.status);
  const nonPassedCount = matchingCheckStatuses
    .filter((status) => status !== "passed")
    .length;

  return [
    `skills:${skillCapabilities.length}`,
    `mcp:${mcpCapabilities.length}`,
    `nonPassed:${nonPassedCount}`,
  ].join(",");
}

function capabilityTargetsAgent(
  targetAgents: readonly string[] | undefined,
  target: MaterializedNexusAgentMcpTarget,
): boolean {
  if (!targetAgents || targetAgents.length === 0) {
    return true;
  }
  const agents = new Set(targetAgents);
  return agents.has(target.agent) || agents.has(target.provider);
}

function agentProjectionStatusChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusSetupCheckResult[] {
  const status = buildNexusProjectAgentProjectionStatus({
    projectRoot,
    projectConfig,
  });
  const hasActionableDiagnostics =
    status.explicit ||
    status.staleGeneratedProviderDirectories.length > 0 ||
    status.manualProviderDirectories.length > 0 ||
    status.unsupportedTargets.length > 0 ||
    status.locallySelectedButNotAllowed.length > 0;
  if (!hasActionableDiagnostics) {
    return [];
  }

  const summaryStatus: NexusSetupCheckStatus =
    status.expectedMcpConfigFiles.some(projectionMissing) ||
    status.expectedSkillDirectories.some(projectionMissing) ||
    status.staleGeneratedProviderDirectories.length > 0 ||
    status.manualProviderDirectories.length > 0 ||
    status.unsupportedTargets.length > 0 ||
    status.locallySelectedButNotAllowed.length > 0
      ? "warning"
      : "passed";
  const checks: NexusSetupCheckResult[] = [{
    id: "agent-projection-summary",
    title: "Agent projection status",
    status: summaryStatus,
    summary: `Agent projection summary: ${status.summary}.`,
    nextAction: summaryStatus === "passed"
      ? null
      : status.explicit
        ? "Review non-passed agent workspaceion checks before refreshing or cleaning provider-native support state."
        : "Add config.agentTargets.active to make provider projection selection explicit.",
  }];

  for (const projection of [
    ...status.expectedMcpConfigFiles,
    ...status.expectedSkillDirectories,
  ]) {
    checks.push(agentProjectionPathCheck(projection));
  }
  for (const projection of status.staleGeneratedProviderDirectories) {
    checks.push(agentProjectionPathCheck(projection));
  }
  for (const projection of status.manualProviderDirectories) {
    checks.push(agentProjectionPathCheck(projection));
  }
  for (const diagnostic of status.unsupportedTargets) {
    checks.push(agentProjectionPolicyCheck(diagnostic));
  }
  for (const diagnostic of status.locallySelectedButNotAllowed) {
    checks.push(agentProjectionPolicyCheck(diagnostic));
  }

  return checks;
}

function agentProjectionPathCheck(
  projection: NexusAgentProjectionPathStatus,
): NexusSetupCheckResult {
  const passed = projection.state === "expected-present";
  const cleanupNote = projection.cleanupSafe ? " cleanupSafe=true" : "";
  return {
    id:
      `agent-projection-${setupCheckIdPart(projection.kind)}-` +
      `${setupCheckIdPart(projection.provider)}-${setupCheckIdPart(projection.state)}`,
    title: `${projection.provider} ${projection.kind} projection`,
    status: passed ? "passed" : "warning",
    summary:
      `state=${projection.state}${cleanupNote}; path=${projection.path}; ` +
      projection.reason,
    nextAction: passed
      ? null
      : projection.state === "expected-missing"
        ? `Refresh ${projection.provider} ${projection.kind} projection or record why this host intentionally leaves it missing.`
        : projection.cleanupSafe
          ? "Run dev-nexus workspace agent-projection cleanup <workspace-root> --dry-run before applying cleanup; do not remove source-controlled or manual files."
          : "Inspect the file ownership before cleanup; DevNexus does not classify this path as generated cleanup-safe support.",
  };
}

function agentProjectionPolicyCheck(
  diagnostic: NexusAgentProjectionPolicyDiagnostic,
): NexusSetupCheckResult {
  return {
    id:
      `agent-projection-policy-${setupCheckIdPart(diagnostic.provider)}-` +
      `${setupCheckIdPart(diagnostic.state)}`,
    title: `${diagnostic.provider} agent workspaceion policy`,
    status: "warning",
    summary: `state=${diagnostic.state}; source=${diagnostic.source}; ${diagnostic.reason}`,
    nextAction:
      diagnostic.state === "unsupported-provider"
        ? "Add a provider adapter, mark the target as manual, or document the provider-specific setup path."
        : "Remove the legacy provider target or add it to config.agentTargets.active before refreshing provider-native projections.",
  };
}

function projectionMissing(projection: NexusAgentProjectionPathStatus): boolean {
  return projection.state === "expected-missing";
}

function pluginProjectedSkillChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusSetupCheckResult[] {
  const checks: NexusSetupCheckResult[] = [];
  const skillTargets = setupAgentSkillTargets(projectConfig);

  for (const { plugin, capability } of pluginProjectedSkillCapabilities(projectConfig)) {
    const matchingSkillTargets = skillTargetsForCapability(capability, skillTargets);
    if (matchingSkillTargets.length === 0) {
      continue;
    }
    const pluginLabel = setupPluginLabel(plugin);
    const skillId = capability.skillId;
    checks.push(pathCheck({
      id: `plugin-${setupCheckIdPart(plugin.id)}-skill-${setupCheckIdPart(skillId)}-managed`,
      title: `${pluginLabel} skill ${skillId}`,
      pathName: path.join(
        projectRoot,
        nexusSkillSupportDirectoryName,
        nexusSkillsDirectoryName,
        skillId,
        nexusSkillMarkdownFileName,
      ),
      passedSummary: `Plugin-projected skill is materialized in ${nexusSkillSupportDirectoryName}/${nexusSkillsDirectoryName}: ${skillId}.`,
      blockedSummary: `Plugin ${pluginLabel} declares projected skill ${skillId}, but it is not materialized in ${nexusSkillSupportDirectoryName}/${nexusSkillsDirectoryName}.`,
      nextAction:
        `Run the plugin skill refresh/setup command or update the workspace skill bundle before assigning ${pluginLabel} worker tasks.`,
      missingStatus: "warning",
    }));

    for (const target of matchingSkillTargets) {
      checks.push(pathCheck({
        id: `plugin-${setupCheckIdPart(plugin.id)}-skill-${setupCheckIdPart(skillId)}-${setupCheckIdPart(target.agent)}`,
        title: `${target.agent} skill ${skillId}`,
        pathName: path.join(
          projectRoot,
          target.directory,
          skillId,
          nexusSkillMarkdownFileName,
        ),
        passedSummary: `Plugin-projected skill ${skillId} is available to ${target.agent}.`,
        blockedSummary: `Plugin-projected skill ${skillId} is missing from the ${target.agent} skill directory.`,
        nextAction:
          `Refresh ${target.agent} skill projection after the workspace-managed ${skillId} skill is materialized.`,
        missingStatus: "warning",
      }));
    }
  }

  return checks;
}

function pluginMcpServerChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusSetupCheckResult[] {
  const checks: NexusSetupCheckResult[] = [];
  const mcpTargets = setupAgentMcpTargets(projectRoot, projectConfig)
    .filter((target) => target.serverName !== defaultNexusMcpGatewayServerName);

  for (const { plugin, capability } of pluginMcpServerCapabilities(projectConfig)) {
    for (const target of mcpTargetsForCapability(capability, mcpTargets)) {
      const exposure = pluginMcpServerExposure(
        projectConfig,
        target,
        plugin,
        capability,
      );
      checks.push(pluginMcpServerCheck({
        projectRoot,
        plugin,
        capability,
        exposure,
        agent: target.agent,
        provider: target.provider,
        configPath: target.configPath,
        configPathRelative: target.configPathRelative,
        configSchema: target.configSchema,
      }));
    }
  }

  return checks;
}

function pluginMcpServerCheck(options: {
  projectRoot: string;
  plugin: NexusProjectPluginConfig;
  capability: NexusPluginMcpServerCapability;
  exposure: NexusMcpExposureResolution;
  agent: string;
  provider: string;
  configPath: string;
  configPathRelative: string;
  configSchema: string;
}): NexusSetupCheckResult {
  const configPath = options.configPath;
  const pluginLabel = setupPluginLabel(options.plugin);
  const serverName = options.capability.serverName;
  const checkBase = {
    id: `plugin-${setupCheckIdPart(options.plugin.id)}-mcp-${setupCheckIdPart(serverName)}-${setupCheckIdPart(options.agent)}`,
    title: `${options.agent} MCP server ${serverName}`,
    details: mcpExposureDetails(options.exposure),
  };

  if (options.exposure.mode === "hidden") {
    return {
      ...checkBase,
      status: "passed",
      summary:
        `Plugin ${pluginLabel} MCP server ${serverName} is intentionally hidden for ${options.provider}; ` +
        `${mcpExposureSummary(options.exposure)}. Direct MCP config is not expected.`,
      nextAction: null,
    };
  }

  if (options.exposure.mode === "gateway") {
    return {
      ...checkBase,
      status: "warning",
      summary:
        `Plugin ${pluginLabel} MCP server ${serverName} is planned for DevNexus gateway registration for ${options.provider}; ` +
        `${mcpExposureSummary(options.exposure)}. Direct MCP config is not expected.`,
      nextAction:
        "Use the MCP gateway projection path once it is available; do not project this plugin MCP server directly unless its exposure is changed to direct.",
    };
  }

  if (!fs.existsSync(configPath)) {
    return {
      ...checkBase,
      status: "warning",
      summary:
        `Plugin ${pluginLabel} declares MCP server ${serverName}, but ${options.provider} MCP config is missing; ` +
        `${mcpExposureSummary(options.exposure)}.`,
      nextAction:
        `Refresh ${options.provider} MCP config at ${options.configPathRelative}, then run the plugin-specific MCP setup or refresh step for ${pluginLabel}.`,
    };
  }

  const configured = mcpServerConfigured({
    provider: options.provider,
    configPath,
    configSchema: options.configSchema,
    serverName,
  });
  if (configured === true) {
    const commandLine = configuredMcpServerCommandLine({
      provider: options.provider,
      configPath,
      configSchema: options.configSchema,
      serverName,
    });
    const expectedCommandLine = pluginExpectedMcpCommandLine(options.capability);
    if (
      commandLine &&
      expectedCommandLine &&
      !mcpCommandLinesEqual(commandLine, expectedCommandLine)
    ) {
      return {
        ...checkBase,
        status: "warning",
        summary:
          `Plugin MCP server ${serverName} is configured for ${options.provider}, but its command line is stale or unexpected. ` +
          `Current: ${formatMcpCommandLine(commandLine)}. Expected: ${formatMcpCommandLine(expectedCommandLine)}. ` +
          `${mcpExposureSummary(options.exposure)}.`,
        nextAction:
          `Refresh ${options.provider} MCP config for ${serverName}, then reload or restart the agent session so it uses the updated command.`,
      };
    }
    if (commandLine && !mcpCommandAvailable(commandLine.command, options.projectRoot)) {
      return {
        ...checkBase,
        status: "warning",
        summary:
          `Plugin MCP server ${serverName} is configured for ${options.provider}, but command ${commandLine.command} is not available on PATH; ` +
          `${mcpExposureSummary(options.exposure)}.`,
        nextAction:
          `Install or expose ${commandLine.command} for this host, or update ${options.configPathRelative} to use the configured plugin MCP command.`,
      };
    }

    return {
      ...checkBase,
      status: "passed",
      summary:
        `Plugin MCP server ${serverName} is configured for ${options.provider}; ` +
        `${mcpExposureSummary(options.exposure)}.`,
      nextAction: null,
    };
  }

  return {
    ...checkBase,
    status: "warning",
    summary:
      configured === false
        ? `Plugin ${pluginLabel} declares MCP server ${serverName}, but it is not configured for ${options.provider}; ${mcpExposureSummary(options.exposure)}.`
        : `Plugin ${pluginLabel} declares MCP server ${serverName}, but DevNexus cannot inspect ${options.provider} MCP config schema ${options.configSchema} yet; ${mcpExposureSummary(options.exposure)}.`,
    nextAction:
      configured === false
        ? `Run the plugin-specific MCP setup or refresh step so ${options.provider} can access ${serverName}.`
        : `Verify ${serverName} manually in ${options.configPathRelative} or add a DevNexus MCP config adapter for ${options.provider}.`,
  };
}

function agentMcpServerConfiguredCheck(
  target: MaterializedNexusAgentMcpTarget,
  exposure?: NexusMcpExposureResolution,
): NexusSetupCheckResult {
  const checkBase = {
    id: `agent-mcp-server-${setupCheckIdPart(target.agent)}-${setupCheckIdPart(target.serverName)}`,
    title: `${target.agent} MCP server ${target.serverName}`,
    ...(exposure ? { details: mcpExposureDetails(exposure) } : {}),
  };

  if (exposure?.mode === "hidden") {
    return {
      ...checkBase,
      status: "passed",
      summary:
        `DevNexus MCP server ${target.serverName} is intentionally hidden for ${target.provider}; ` +
        `${mcpExposureSummary(exposure)}. Direct MCP config is not expected.`,
      nextAction: null,
    };
  }

  if (exposure?.mode === "gateway") {
    return {
      ...checkBase,
      status: "warning",
      summary:
        `DevNexus MCP server ${target.serverName} is planned for gateway projection for ${target.provider}; ` +
        `${mcpExposureSummary(exposure)}. Direct MCP config is not expected.`,
      nextAction:
        "Use the MCP gateway projection path once it is available, or change this target exposure to direct.",
    };
  }

  if (!fs.existsSync(target.configPath)) {
    return {
      ...checkBase,
      status: "warning",
      summary:
        `${target.provider} MCP config is missing, so DevNexus cannot confirm ${target.serverName} is configured.`,
      nextAction:
        `Run dev-nexus workspace mcp refresh . to project ${target.serverName} into ${target.configPathRelative}.`,
    };
  }

  const configured = mcpServerConfigured({
    provider: target.provider,
    configPath: target.configPath,
    configSchema: target.configSchema,
    serverName: target.serverName,
  });
  if (configured === true) {
    const commandLine = configuredMcpServerCommandLine({
      provider: target.provider,
      configPath: target.configPath,
      configSchema: target.configSchema,
      serverName: target.serverName,
    });
    const expectedCommandLine = {
      command: target.command,
      args: target.args,
    };
    if (commandLine && !mcpCommandLinesEqual(commandLine, expectedCommandLine)) {
      return {
        ...checkBase,
        status: "warning",
        summary:
          `DevNexus MCP server ${target.serverName} is configured for ${target.provider}, but its command line is stale or unexpected. ` +
          `Current: ${formatMcpCommandLine(commandLine)}. Expected: ${formatMcpCommandLine(expectedCommandLine)}.` +
          (exposure ? ` ${mcpExposureSummary(exposure)}.` : ""),
        nextAction:
          `Run dev-nexus workspace mcp refresh . and reload or restart the ${target.provider} session so it uses ${formatMcpCommandLine(expectedCommandLine)}.`,
      };
    }

    return {
      ...checkBase,
      status: "passed",
      summary:
        `DevNexus MCP server ${target.serverName} is configured for ${target.provider}` +
        (exposure ? `; ${mcpExposureSummary(exposure)}.` : "."),
      nextAction: null,
    };
  }

  return {
    ...checkBase,
    status: "warning",
    summary:
      configured === false
        ? `DevNexus expected MCP server ${target.serverName}, but it is missing from ${target.configPathRelative}.`
        : `DevNexus cannot inspect ${target.provider} MCP config schema ${target.configSchema} for server ${target.serverName}.`,
    nextAction:
      configured === false
        ? `Run dev-nexus workspace mcp refresh . and confirm ${target.serverName} appears in ${target.configPathRelative}.`
        : `Confirm ${target.serverName} manually in ${target.configPathRelative}, or add a DevNexus adapter for ${target.provider}.`,
  };
}

interface NexusMcpRuntimeExpectedTarget {
  id: string;
  title: string;
  agent: string;
  provider: string;
  serverName: string;
  expectedCommandLine: ConfiguredMcpServerCommandLine;
}

function liveMcpRuntimeChecks(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  agentMcpTargets: readonly MaterializedNexusAgentMcpTarget[];
  liveProcesses: readonly NexusMcpRuntimeProcess[];
}): NexusSetupCheckResult[] {
  const expectedTargets = [
    ...options.agentMcpTargets
      .filter((target) =>
        agentMcpTargetExposure(target).mode === "direct"
      )
      .map(agentMcpRuntimeExpectedTarget),
    ...pluginMcpRuntimeExpectedTargets(options.projectRoot, options.projectConfig),
  ];
  const checks: NexusSetupCheckResult[] = [];

  for (const runtimeProcess of options.liveProcesses) {
    const observedCommandLine = parseMcpProcessCommandLine(
      runtimeProcess.commandLine,
    );
    if (!observedCommandLine) {
      continue;
    }

    for (const expectedTarget of expectedTargets) {
      if (
        !mcpRuntimeProcessMatchesExpectedTarget(
          runtimeProcess,
          observedCommandLine,
          expectedTarget,
        )
      ) {
        continue;
      }
      if (
        mcpRuntimeCommandLinesEqual(
          observedCommandLine,
          expectedTarget.expectedCommandLine,
        )
      ) {
        continue;
      }

      checks.push({
        id: `${expectedTarget.id}-${runtimeProcess.pid}`,
        title: `${expectedTarget.title} live MCP process`,
        status: "warning",
        summary:
          `${expectedTarget.provider} live MCP process ${runtimeProcess.pid} for ${expectedTarget.serverName} is stale or unexpected. ` +
          `Current: ${formatMcpCommandLine(observedCommandLine)}. Expected: ${formatMcpCommandLine(expectedTarget.expectedCommandLine)}.`,
        nextAction:
          `Reload or restart the ${expectedTarget.provider} session so ${expectedTarget.serverName} uses ${formatMcpCommandLine(expectedTarget.expectedCommandLine)}.`,
      });
    }
  }

  return checks;
}

function agentMcpRuntimeExpectedTarget(
  target: MaterializedNexusAgentMcpTarget,
): NexusMcpRuntimeExpectedTarget {
  return {
    id: `agent-mcp-live-${setupCheckIdPart(target.agent)}-${setupCheckIdPart(target.serverName)}`,
    title: `${target.agent} MCP server ${target.serverName}`,
    agent: target.agent,
    provider: target.provider,
    serverName: target.serverName,
    expectedCommandLine: {
      command: target.command,
      args: target.args,
    },
  };
}

function pluginMcpRuntimeExpectedTargets(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusMcpRuntimeExpectedTarget[] {
  const expectedTargets: NexusMcpRuntimeExpectedTarget[] = [];
  const mcpTargets = setupAgentMcpTargets(projectRoot, projectConfig)
    .filter((target) => target.serverName !== defaultNexusMcpGatewayServerName);

  for (const { plugin, capability } of pluginMcpServerCapabilities(projectConfig)) {
    for (const target of mcpTargetsForCapability(capability, mcpTargets)) {
      const exposure = pluginMcpServerExposure(
        projectConfig,
        target,
        plugin,
        capability,
      );
      if (exposure.mode !== "direct") {
        continue;
      }
      const configured = fs.existsSync(target.configPath)
        ? configuredMcpServerCommandLine({
            provider: target.provider,
            configPath: target.configPath,
            configSchema: target.configSchema,
            serverName: capability.serverName,
          })
        : null;
      const expectedCommandLine = pluginExpectedMcpCommandLine(capability) ??
        configured;
      if (!expectedCommandLine) {
        continue;
      }

      expectedTargets.push({
        id:
          `plugin-${setupCheckIdPart(plugin.id)}-mcp-live-` +
          `${setupCheckIdPart(capability.serverName)}-${setupCheckIdPart(target.agent)}`,
        title: `${target.agent} MCP server ${capability.serverName}`,
        agent: target.agent,
        provider: target.provider,
        serverName: capability.serverName,
        expectedCommandLine,
      });
    }
  }

  return expectedTargets;
}

function setupAgentSkillTargets(
  projectConfig: NexusProjectConfig | null,
): { agent: string; directory: string }[] {
  if (!projectConfig) {
    return [];
  }

  return activeNexusProjectSkillAgentTargets(projectConfig)
    .map((target) => ({
      agent: target.agent,
      directory: target.directory ?? defaultSetupAgentSkillDirectory(target.agent),
    }));
}

function defaultSetupAgentSkillDirectory(agent: string): string {
  if (agent === "codex") {
    return path.join(".agents", "skills");
  }
  if (agent === "claude") {
    return path.join(".claude", "skills");
  }
  return path.join(`.${safeAgentConfigDirectoryName(agent)}`, "skills");
}

function skillTargetsForCapability(
  capability: NexusPluginProjectedSkillCapability,
  skillTargets: readonly { agent: string; directory: string }[],
): { agent: string; directory: string }[] {
  if (!capability.targetAgents || capability.targetAgents.length === 0) {
    return [...skillTargets];
  }

  const targetAgents = new Set(capability.targetAgents);
  return skillTargets.filter((target) => targetAgents.has(target.agent));
}

function mcpTargetsForCapability(
  capability: NexusPluginMcpServerCapability,
  mcpTargets: readonly MaterializedNexusAgentMcpTarget[],
): MaterializedNexusAgentMcpTarget[] {
  if (!capability.targetAgents || capability.targetAgents.length === 0) {
    return [...mcpTargets];
  }

  const targetAgents = new Set(capability.targetAgents);
  return mcpTargets.filter((target) =>
    targetAgents.has(target.agent) || targetAgents.has(target.provider),
  );
}

function agentMcpTargetExposure(
  target: MaterializedNexusAgentMcpTarget,
): NexusMcpExposureResolution {
  return {
    applicable: true,
    mode: target.effectiveExposure,
    source: target.exposureSource,
    declaredMode: null,
    path: target.exposurePath,
    reason: target.exposureReason,
  };
}

function pluginMcpServerExposure(
  projectConfig: NexusProjectConfig,
  target: MaterializedNexusAgentMcpTarget,
  plugin: NexusProjectPluginConfig,
  capability: NexusPluginMcpServerCapability,
): NexusMcpExposureResolution {
  return resolveNexusMcpExposure({
    workspaceExposure: projectConfig.mcp?.exposure,
    agentTarget:
      configuredMcpAgentTargetForMaterialized(projectConfig, target) ?? {
        agent: target.agent,
        provider: target.provider,
      },
    plugin,
    server: capability,
  });
}

function configuredMcpAgentTargetForMaterialized(
  projectConfig: NexusProjectConfig,
  target: MaterializedNexusAgentMcpTarget,
): NexusProjectAgentMcpTarget | null {
  return (
    activeNexusProjectMcpAgentTargets(projectConfig).find((candidate) => {
      const candidateProvider = candidate.provider ?? candidate.agent;
      return (
        sameMcpAgentName(candidate.agent, target.agent) &&
        sameMcpAgentName(candidateProvider, target.provider) &&
        (candidate.serverName === undefined || candidate.serverName === target.serverName)
      );
    }) ?? null
  );
}

function sameMcpAgentName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function mcpExposureDetails(exposure: NexusMcpExposureResolution): Record<string, unknown> {
  return {
    exposure: {
      mode: exposure.mode,
      source: exposure.source,
      declaredMode: exposure.declaredMode,
      path: exposure.path,
      reason: exposure.reason,
    },
  };
}

function mcpExposureSummary(exposure: NexusMcpExposureResolution): string {
  return `exposure=${exposure.mode} source=${exposure.source}`;
}

function pluginProjectedSkillCapabilities(
  projectConfig: NexusProjectConfig,
): Array<{
  plugin: NexusProjectPluginConfig;
  capability: NexusPluginProjectedSkillCapability;
}> {
  return enabledPluginConfigs(projectConfig).flatMap((plugin) =>
    plugin.capabilities
      .filter((capability): capability is NexusPluginProjectedSkillCapability =>
        capability.kind === "projected_skill")
      .map((capability) => ({ plugin, capability })),
  );
}

function pluginMcpServerCapabilities(
  projectConfig: NexusProjectConfig,
): Array<{
  plugin: NexusProjectPluginConfig;
  capability: NexusPluginMcpServerCapability;
}> {
  return enabledPluginConfigs(projectConfig).flatMap((plugin) =>
    plugin.capabilities
      .filter((capability): capability is NexusPluginMcpServerCapability =>
        capability.kind === "mcp_server")
      .map((capability) => ({ plugin, capability })),
  );
}

function enabledPluginConfigs(
  projectConfig: NexusProjectConfig,
): NexusProjectPluginConfig[] {
  return (projectConfig.plugins ?? []).filter((plugin) => plugin.enabled !== false);
}

function agentMcpCapabilityGapChecks(
  target: MaterializedNexusAgentMcpTarget,
): NexusSetupCheckResult[] {
  return target.capabilityGaps
    .filter((gap) => !gap.id.startsWith("windows-"))
    .map((gap) => ({
      id: `agent-mcp-gap-${setupCheckIdPart(target.agent)}-${setupCheckIdPart(gap.id)}`,
      title: `${target.agent} MCP capability gap`,
      status: gap.severity === "blocked" ? "blocked" : "warning",
      summary: gap.summary,
      nextAction: gap.nextAction,
    }));
}

function agentMcpTargetSummary(target: MaterializedNexusAgentMcpTarget): string {
  return `${target.agent}/${target.provider} ${target.configStatus} ${target.configPathRelative} ${target.configFormat}/${target.configSchema}`;
}

function mcpServerConfigured(options: {
  provider: string;
  configPath: string;
  configSchema: string;
  serverName: string;
}): boolean | null {
  if (options.configSchema === "codex.mcp_servers") {
    return codexMcpServerConfigured(
      fs.readFileSync(options.configPath, "utf8"),
      options.serverName,
    );
  }

  if (options.configSchema === "claude.mcpServers") {
    return jsonObjectMcpServerConfigured(
      options.configPath,
      "mcpServers",
      options.serverName,
    );
  }

  if (options.configSchema === "opencode.mcp.local") {
    return jsonObjectMcpServerConfigured(
      options.configPath,
      "mcp",
      options.serverName,
    );
  }

  return null;
}

function configuredMcpServerCommandLine(options: {
  provider: string;
  configPath: string;
  configSchema: string;
  serverName: string;
}): ConfiguredMcpServerCommandLine | null {
  if (options.configSchema === "codex.mcp_servers") {
    return codexMcpServerCommandLine(
      fs.readFileSync(options.configPath, "utf8"),
      options.serverName,
    );
  }

  if (options.configSchema === "claude.mcpServers") {
    return jsonObjectMcpServerCommandLine(
      options.configPath,
      "mcpServers",
      options.serverName,
    );
  }

  if (options.configSchema === "opencode.mcp.local") {
    return jsonObjectMcpServerCommandLine(
      options.configPath,
      "mcp",
      options.serverName,
    );
  }

  return null;
}

function codexMcpServerCommandLine(
  content: string,
  serverName: string,
): ConfiguredMcpServerCommandLine | null {
  const lines = content.replace(/\r\n/gu, "\n").split("\n");
  let inServerTable = false;
  let command: string | null = null;
  let args: string[] = [];
  for (const line of lines) {
    const tableName = tomlTableName(line);
    if (tableName !== null) {
      inServerTable =
        tableName === `mcp_servers.${serverName}` ||
        tableName.startsWith(`mcp_servers.${serverName}.`);
      continue;
    }

    if (!inServerTable) {
      continue;
    }

    const commandMatch = /^\s*command\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/u
      .exec(line);
    if (commandMatch) {
      command = parseJsonStringLiteral(commandMatch[1]!);
      continue;
    }
    const argsMatch = /^\s*args\s*=\s*(\[[^\]]*\])\s*(?:#.*)?$/u.exec(line);
    if (argsMatch) {
      args = parseJsonStringArray(argsMatch[1]!);
    }
  }

  return command ? { command, args } : null;
}

function jsonObjectMcpServerCommandLine(
  configPath: string,
  containerKey: "mcp" | "mcpServers",
  serverName: string,
): ConfiguredMcpServerCommandLine | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const mcpServers = (parsed as Record<string, unknown>)[containerKey];
    if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
      return null;
    }
    const server = (mcpServers as Record<string, unknown>)[serverName];
    if (!server || typeof server !== "object" || Array.isArray(server)) {
      return null;
    }
    const commandValue = (server as Record<string, unknown>).command;
    const argsValue = (server as Record<string, unknown>).args;
    if (Array.isArray(commandValue)) {
      const commandParts = commandValue.filter(
        (value): value is string => typeof value === "string",
      );
      const command = commandParts[0];
      return command ? { command, args: commandParts.slice(1) } : null;
    }
    if (typeof commandValue === "string") {
      return {
        command: commandValue,
        args: Array.isArray(argsValue)
          ? argsValue.filter((value): value is string => typeof value === "string")
          : [],
      };
    }

    return null;
  } catch {
    return null;
  }
}

function pluginExpectedMcpCommandLine(
  capability: NexusPluginMcpServerCapability,
): ConfiguredMcpServerCommandLine | null {
  return capability.command
    ? { command: capability.command, args: capability.args ?? [] }
    : null;
}

function mcpCommandLinesEqual(
  left: ConfiguredMcpServerCommandLine,
  right: ConfiguredMcpServerCommandLine,
): boolean {
  return (
    mcpCommandsEqual(left.command, right.command) &&
    left.args.length === right.args.length &&
    left.args.every((arg, index) => arg === right.args[index])
  );
}

function mcpCommandsEqual(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  if (process.platform !== "win32") {
    return false;
  }

  return stripWindowsCommandShim(left).toLowerCase() ===
    stripWindowsCommandShim(right).toLowerCase();
}

function stripWindowsCommandShim(value: string): string {
  return value.toLowerCase().endsWith(".cmd") ? value.slice(0, -4) : value;
}

function mcpRuntimeProcessMatchesExpectedTarget(
  runtimeProcess: NexusMcpRuntimeProcess,
  observed: ConfiguredMcpServerCommandLine,
  expected: NexusMcpRuntimeExpectedTarget,
): boolean {
  if (
    runtimeProcess.provider &&
    normalizedProvider(runtimeProcess.provider) !== normalizedProvider(expected.provider)
  ) {
    return false;
  }
  if (
    runtimeProcess.serverName &&
    normalizedProvider(runtimeProcess.serverName) !== normalizedProvider(expected.serverName)
  ) {
    return false;
  }
  if (runtimeProcess.serverName) {
    return true;
  }

  return (
    mcpRuntimeCommandLinesEqual(observed, expected.expectedCommandLine) ||
    (
      mcpRuntimeCommandsRelated(observed.command, expected.expectedCommandLine.command) &&
      mcpArgsContainSequence(observed.args, expected.expectedCommandLine.args)
    )
  );
}

function mcpRuntimeCommandLinesEqual(
  left: ConfiguredMcpServerCommandLine,
  right: ConfiguredMcpServerCommandLine,
): boolean {
  return (
    mcpRuntimeCommandsEqual(left.command, right.command) &&
    left.args.length === right.args.length &&
    left.args.every((arg, index) => arg === right.args[index])
  );
}

function mcpRuntimeCommandsEqual(left: string, right: string): boolean {
  if (mcpCommandsEqual(left, right)) {
    return true;
  }

  const leftName = normalizedCommandName(left);
  const rightName = normalizedCommandName(right);
  if (!commandHasPathSegment(right)) {
    return leftName === rightName;
  }

  return normalizeCommandPath(left) === normalizeCommandPath(right);
}

function mcpRuntimeCommandsRelated(left: string, right: string): boolean {
  const leftName = normalizedCommandName(left);
  const rightName = normalizedCommandName(right);
  return leftName === rightName || leftName.includes(rightName);
}

function mcpArgsContainSequence(
  observedArgs: readonly string[],
  expectedArgs: readonly string[],
): boolean {
  if (expectedArgs.length === 0) {
    return true;
  }

  let expectedIndex = 0;
  for (const arg of observedArgs) {
    if (arg === expectedArgs[expectedIndex]) {
      expectedIndex += 1;
      if (expectedIndex === expectedArgs.length) {
        return true;
      }
    }
  }

  return false;
}

function parseMcpProcessCommandLine(
  commandLine: string,
): ConfiguredMcpServerCommandLine | null {
  const tokens = shellCommandTokens(commandLine);
  if (tokens.length === 0) {
    return null;
  }

  let command = tokens[0]!;
  let args = tokens.slice(1);
  if (isNodeCommand(command) && args.length > 0 && args[0]) {
    command = args[0]!;
    args = args.slice(1);
  }

  return { command, args };
}

function shellCommandTokens(commandLine: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (const char of commandLine.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function isNodeCommand(command: string): boolean {
  const name = normalizedCommandName(command);
  return name === "node" || name === "node.exe";
}

function commandHasPathSegment(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function normalizedCommandName(command: string): string {
  return stripWindowsCommandShim(commandPathBasename(command)).toLowerCase();
}

function commandPathBasename(command: string): string {
  return command.split(/[\\/]/u).filter(Boolean).pop() ?? command;
}

function normalizeCommandPath(command: string): string {
  return stripWindowsCommandShim(command.replace(/\\/gu, "/")).toLowerCase();
}

function normalizedProvider(value: string): string {
  return value.trim().toLowerCase();
}

export function listNexusMcpRuntimeProcesses(options: {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
} = {}): NexusMcpRuntimeProcess[] {
  const platform = options.platform ?? process.platform;
  return platform === "win32"
    ? listWindowsMcpRuntimeProcesses(options.timeoutMs)
    : listPosixMcpRuntimeProcesses(options.timeoutMs);
}

function listWindowsMcpRuntimeProcesses(
  timeoutMs: number | undefined,
): NexusMcpRuntimeProcess[] {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Get-CimInstance Win32_Process |",
    "Where-Object { $_.CommandLine -match 'mcp' } |",
    "Select-Object ProcessId, CommandLine |",
    "ConvertTo-Json -Compress",
  ].join(" ");
  let result: childProcess.SpawnSyncReturns<string>;
  try {
    result = childProcess.spawnSync(
      resolveNexusCommandPath("powershell.exe"),
      ["-NoProfile", "-Command", script],
      {
        encoding: "utf8",
        shell: false,
        timeout: timeoutMs ?? 2_000,
        windowsHide: true,
      },
    );
  } catch {
    return [];
  }
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    const records = Array.isArray(parsed) ? parsed : [parsed];
    return records.flatMap((record) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        return [];
      }
      const processId = (record as Record<string, unknown>).ProcessId;
      const commandLine = (record as Record<string, unknown>).CommandLine;
      return runtimeProcessRecord(processId, commandLine);
    });
  } catch {
    return [];
  }
}

function listPosixMcpRuntimeProcesses(
  timeoutMs: number | undefined,
): NexusMcpRuntimeProcess[] {
  let result: childProcess.SpawnSyncReturns<string>;
  try {
    result = childProcess.spawnSync(
      resolveNexusCommandPath("ps"),
      ["-axo", "pid=,command="],
      {
        encoding: "utf8",
        shell: false,
        timeout: timeoutMs ?? 2_000,
      },
    );
  } catch {
    return [];
  }
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/u)
    .flatMap(posixRuntimeProcessRecord);
}

function posixRuntimeProcessRecord(line: string): NexusMcpRuntimeProcess[] {
  const trimmed = line.trimStart();
  const separator = firstWhitespaceIndex(trimmed);
  if (separator <= 0) {
    return [];
  }
  const processId = trimmed.slice(0, separator);
  const commandLine = trimmed.slice(separator).trimStart();
  if (!allCharacters(processId, isAsciiDigit) || !isMcpCommandLine(commandLine)) {
    return [];
  }

  return runtimeProcessRecord(Number(processId), commandLine);
}

function firstWhitespaceIndex(value: string): number {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index]!.trim().length === 0) {
      return index;
    }
  }

  return -1;
}

function isMcpCommandLine(value: string): boolean {
  return value.includes("mcp-stdio") || hasWhitespaceDelimitedToken(value, "mcp");
}

function hasWhitespaceDelimitedToken(value: string, token: string): boolean {
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const atEnd = index === value.length;
    if (!atEnd && value[index]!.trim().length > 0) {
      continue;
    }
    if (index > start && value.slice(start, index) === token) {
      return true;
    }
    start = index + 1;
  }

  return false;
}

function allCharacters(
  value: string,
  predicate: (character: string) => boolean,
): boolean {
  if (value.length === 0) {
    return false;
  }
  for (const character of value) {
    if (!predicate(character)) {
      return false;
    }
  }

  return true;
}

function runtimeProcessRecord(
  processId: unknown,
  commandLine: unknown,
): NexusMcpRuntimeProcess[] {
  const pid = Number(processId);
  if (
    !Number.isInteger(pid) ||
    pid <= 0 ||
    typeof commandLine !== "string" ||
    commandLine.trim().length === 0
  ) {
    return [];
  }

  return [{ pid, commandLine: commandLine.trim() }];
}

function formatMcpCommandLine(commandLine: ConfiguredMcpServerCommandLine): string {
  return [commandLine.command, ...commandLine.args]
    .map((part) => JSON.stringify(part))
    .join(" ");
}

function parseJsonStringLiteral(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return "";
  }
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function mcpCommandAvailable(command: string, projectRoot: string): boolean {
  const resolved = resolveNexusProjectPath({ projectRoot, value: command });
  if (resolved !== path.resolve(projectRoot, command) || command.includes(":")) {
    return fs.existsSync(resolved);
  }
  if (command.includes("/") || command.includes("\\")) {
    return fs.existsSync(command);
  }

  const lookupCommand = process.platform === "win32" ? "where.exe" : "sh";
  const args =
    process.platform === "win32"
      ? [command]
      : ["-c", "command -v \"$1\" >/dev/null 2>&1", "sh", command];
  try {
    childProcess.execFileSync(lookupCommand, args, {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function codexMcpServerConfigured(content: string, serverName: string): boolean {
  for (const line of content.replace(/\r\n/gu, "\n").split("\n")) {
    const tableName = tomlTableName(line);
    if (
      tableName === `mcp_servers.${serverName}` ||
      tableName?.startsWith(`mcp_servers.${serverName}.`) === true
    ) {
      return true;
    }
  }
  return false;
}

function jsonObjectMcpServerConfigured(
  configPath: string,
  containerKey: "mcp" | "mcpServers",
  serverName: string,
): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const mcpServers = (parsed as Record<string, unknown>)[containerKey];
    return (
      !!mcpServers &&
      typeof mcpServers === "object" &&
      !Array.isArray(mcpServers) &&
      Object.prototype.hasOwnProperty.call(mcpServers, serverName)
    );
  } catch {
    return false;
  }
}

function tomlTableName(line: string): string | null {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
  return match?.[1]?.trim() ?? null;
}

function setupPluginLabel(plugin: NexusProjectPluginConfig): string {
  return plugin.name ?? plugin.id;
}

function setupCheckIdPart(value: string): string {
  const safe = value
    .replace(/[^A-Za-z0-9_-]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  return safe.length > 0 ? safe : "item";
}

function safeAgentConfigDirectoryName(agent: string): string {
  const safe = agent.replace(/[^A-Za-z0-9_-]/gu, "-").replace(/-+/gu, "-");
  return safe.length > 0 ? safe : "agent";
}

function pathCheck(options: {
  id: string;
  title: string;
  pathName: string;
  passedSummary: string;
  blockedSummary: string;
  nextAction: string;
  missingStatus: NexusSetupCheckStatus;
}): NexusSetupCheckResult {
  if (fs.existsSync(options.pathName)) {
    return {
      id: options.id,
      title: options.title,
      status: "passed",
      summary: options.passedSummary,
      nextAction: null,
    };
  }
  return {
    id: options.id,
    title: options.title,
    status: options.missingStatus,
    summary: options.blockedSummary,
    nextAction: options.nextAction,
  };
}

function componentSourceRootTopologyCheck(options: {
  component: NexusProjectConfig["components"][number];
  topology: NexusComponentSourceRootTopology;
}): NexusSetupCheckResult {
  const { component, topology } = options;
  const status: NexusSetupCheckStatus =
    topology.state === "missing" || topology.state === "incompatible-platform"
      ? "blocked"
      : (topology.layout === "embedded" || topology.layout === "workspace-local") &&
          topology.state === "present"
        ? "passed"
        : "warning";
  return {
    id: `component-${component.id}-source-root`,
    title: `${component.name} source root`,
    status,
    summary:
      `${topology.summary} layout=${topology.layout}; state=${topology.state}; ` +
      `base=${topology.configuredBase}.`,
    nextAction: status === "passed"
      ? null
      : topology.nextAction ??
        (component.remoteUrl
          ? `Clone or fetch ${component.remoteUrl} into ${topology.effectivePath}.`
          : `Create or configure ${topology.effectivePath}.`),
    details: {
      sourceRootTopology: topology,
    },
  };
}

function componentGitSafetyChecks(
  component: NexusProjectConfig["components"][number],
  sourceRoot: string,
  options: {
    topology?: NexusComponentSourceRootTopology;
  } = {},
): NexusSetupCheckResult[] {
  if (!fs.existsSync(sourceRoot)) {
    return [];
  }

  if (!fs.existsSync(path.join(sourceRoot, ".git"))) {
    return [{
      id: `component-${component.id}-git-checkout`,
      title: `${component.name} Git checkout`,
      status: "blocked",
      summary:
        `Component source root exists but is not a Git checkout: ${sourceRoot}`,
      nextAction:
        component.remoteUrl
          ? `Clone ${component.remoteUrl} into ${sourceRoot} or configure this component sourceRoot to a valid checkout.`
          : `Configure ${component.id} sourceRoot to a valid Git checkout.`,
    }];
  }

  const checks: NexusSetupCheckResult[] = [];
  checks.push({
    id: `component-${component.id}-git-checkout`,
    title: `${component.name} Git checkout`,
    status: "passed",
    summary: `Component source root is a Git checkout: ${sourceRoot}`,
    nextAction: null,
  });

  const originRemoteCheck = componentOriginRemoteCheck(component, sourceRoot);
  if (originRemoteCheck) {
    checks.push(originRemoteCheck);
  }

  return [...checks, componentDirtyStateCheck(component, sourceRoot, options)];
}

function componentOriginRemoteCheck(
  component: NexusProjectConfig["components"][number],
  sourceRoot: string,
): NexusSetupCheckResult | null {
  if (!component.remoteUrl) {
    return null;
  }

  const actualOrigin = gitRemoteUrl(sourceRoot, "origin");
  if (actualOrigin === null) {
    return {
      id: `component-${component.id}-origin-remote`,
      title: `${component.name} origin remote`,
      status: "warning",
      summary:
        `Component source root has no origin remote; expected ${component.remoteUrl}.`,
      nextAction:
        `Run git -C ${shellPathPlaceholder(sourceRoot)} remote add origin ${component.remoteUrl} or confirm this checkout uses a different remote policy.`,
    };
  }

  if (actualOrigin !== component.remoteUrl) {
    return {
      id: `component-${component.id}-origin-remote`,
      title: `${component.name} origin remote`,
      status: "blocked",
      summary:
        `Component origin remote is ${actualOrigin}, expected ${component.remoteUrl}.`,
      nextAction:
        `Confirm the intended remote before running git -C ${shellPathPlaceholder(sourceRoot)} remote set-url origin ${component.remoteUrl}.`,
    };
  }

  return {
    id: `component-${component.id}-origin-remote`,
    title: `${component.name} origin remote`,
    status: "passed",
    summary: `Component origin remote matches expected URL for ${component.id}.`,
    nextAction: null,
  };
}

function componentDirtyStateCheck(
  component: NexusProjectConfig["components"][number],
  sourceRoot: string,
  options: {
    topology?: NexusComponentSourceRootTopology;
  },
): NexusSetupCheckResult {
  const dirtyStatus = gitStatusPorcelain(sourceRoot);
  if (dirtyStatus === null) {
    return {
      id: `component-${component.id}-dirty-state`,
      title: `${component.name} dirty state`,
      status: "warning",
      summary:
        `Could not inspect Git dirty state for component source root: ${sourceRoot}`,
      nextAction:
        `Run git -C ${shellPathPlaceholder(sourceRoot)} status --short before fetching, pulling, or assigning work.`,
    };
  }

  if (dirtyStatus.trim().length > 0) {
    const dirtyPaths = dirtyStatusPaths(dirtyStatus);
    const devNexusSetupDirtyPaths = options.topology?.layout === "embedded"
      ? dirtyPaths.filter(isDevNexusSetupDirtyPath)
      : [];
    if (
      options.topology?.layout === "embedded" &&
      dirtyPaths.length > 0 &&
      devNexusSetupDirtyPaths.length === dirtyPaths.length
    ) {
      return {
        id: `component-${component.id}-dirty-state`,
        title: `${component.name} dirty state`,
        status: "warning",
        summary:
          `Embedded component source root has only DevNexus setup files with Git changes (${devNexusSetupDirtyPaths.length}): ${summarizeDirtyPaths(devNexusSetupDirtyPaths)}`,
        nextAction:
          "Review and commit the DevNexus setup files when the embedded workspace configuration is correct.",
      };
    }

    return {
      id: `component-${component.id}-dirty-state`,
      title: `${component.name} dirty state`,
      status: "blocked",
      summary:
        `Component source root has dirty local changes that setup must preserve: ${sourceRoot}`,
      nextAction:
        `Review git -C ${shellPathPlaceholder(sourceRoot)} status --short and commit, stash, or choose another host-local source root before setup fetches or pulls.`,
    };
  }

  return {
    id: `component-${component.id}-dirty-state`,
    title: `${component.name} dirty state`,
    status: "passed",
    summary: `Component source root has no Git working tree changes: ${sourceRoot}`,
    nextAction: null,
  };
}

function dirtyStatusPaths(status: string): string[] {
  return status
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const rawPath = line.length > 3 ? line.slice(3).trim() : line.trim();
      const renameSeparator = " -> ";
      const pathValue = rawPath.includes(renameSeparator)
        ? rawPath.slice(rawPath.lastIndexOf(renameSeparator) + renameSeparator.length)
        : rawPath;
      return unquoteGitStatusPath(pathValue).replace(/\\/gu, "/");
    });
}

function unquoteGitStatusPath(value: string): string {
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1);
  }
  return value;
}

function isDevNexusSetupDirtyPath(filePath: string): boolean {
  return filePath === "dev-nexus.project.json" ||
    filePath === "AGENTS.md" ||
    filePath === ".mcp.json" ||
    filePath === "opencode.json" ||
    filePath.startsWith(".dev-nexus/") ||
    filePath.startsWith(".codex/") ||
    filePath.startsWith(".agents/") ||
    filePath.startsWith(".claude/") ||
    filePath.startsWith(".opencode/");
}

function summarizeDirtyPaths(filePaths: string[]): string {
  const limit = 6;
  if (filePaths.length <= limit) {
    return filePaths.join(", ");
  }
  const remainingCount = filePaths.length - limit;
  return `${filePaths.slice(0, limit).join(", ")} and ${remainingCount} more`;
}

function githubMetaProjectChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  setupState: NexusSetupState,
): NexusSetupCheckResult[] {
  return [
    ...githubMetaProjectReadinessChecks(projectRoot, projectConfig),
    ...githubMetaProjectSetupRecordChecks(setupState),
  ];
}

function githubMetaProjectReadinessChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  options: {
    checkFallbackRemotes?: boolean;
    warnWhenHostingMissing?: boolean;
  } = {},
): NexusSetupCheckResult[] {
  const checks: NexusSetupCheckResult[] = [];
  const hosting = projectConfig.hosting;
  const remotePlan = metaProjectRemotePlan(projectConfig);

  if (hosting || options.checkFallbackRemotes !== false) {
    checks.push(...metaRepositoryRemoteChecks({
      projectRoot,
      expectedRemotes: [
        ["origin", remotePlan.humanRemote],
        ["bot", remotePlan.botRemote],
      ],
    }));
  }

  if (hosting) {
    checks.push(...hostingAuthProfileChecks(projectRoot, projectConfig));
    const authProfiles = loadSetupHomeAuthProfiles(projectRoot, projectConfig);
    const hostingStatus = statusNexusProjectHostingLocal({
      project: {
        id: projectConfig.id,
        name: projectConfig.name,
      },
      hosting,
      authProfiles: authProfiles.ok ? authProfiles.authProfiles : [],
      localRemotes: expectedNexusProjectHostingRemotes({
        project: projectConfig,
        hosting,
        authProfiles: authProfiles.ok ? authProfiles.authProfiles : [],
      }).flatMap((remote) => {
        const url = gitRemoteUrl(projectRoot, remote.name);
        return url === null ? [] : [{ name: remote.name, url }];
      }),
    });
    const hostingPlan = planNexusProjectHosting({
      hosting,
      status: hostingStatus,
    });
    checks.push(hostingStatusSetupCheck(hostingStatus));
    checks.push(hostingPlanSetupCheck(hostingPlan));
  } else if (options.warnWhenHostingMissing !== false) {
    checks.push({
      id: "github-hosting-config",
      title: "GitHub hosting config",
      status: "warning",
      summary:
        "No shared hosting record is configured; setup is falling back to repo.remoteUrl for workspace repository remotes.",
      nextAction:
        "Add a dev-nexus.project.json hosting record before relying on automation publication guardrails from this setup flow.",
    });
  }

  return checks;
}

function hostingStatusSetupCheck(
  status: NexusProjectHostingStatusResult,
): NexusSetupCheckResult {
  return {
    id: "github-hosting-status",
    title: "GitHub hosting status",
    status: setupStatusFromHostingStatus(status.status),
    summary: [
      `Hosting status is ${status.status}`,
      `repository=${repositoryStatusSummary(status)}`,
      `remotes=${statusCountSummary(status.remotes.map((remote) => remote.status))}`,
      `authProfiles=${statusCountSummary(status.authProfiles.map((profile) => profile.status))}`,
      `access=${statusCountSummary(status.access.map((access) => access.status))}`,
      `issues=${status.issues.length}`,
    ].join("; ") + ".",
    nextAction:
      status.status === "passed"
        ? null
        : "Run dev-nexus workspace hosting status . --json for full drift details, then dev-nexus workspace hosting plan . --json before any apply.",
  };
}

function hostingPlanSetupCheck(
  plan: NexusProjectHostingPlanResult,
): NexusSetupCheckResult {
  const dispositions = plan.actions.map((action) => action.disposition);
  const mutationClasses = Array.from(new Set(
    plan.actions.map((action) => action.mutationClass),
  )).sort((left, right) => left.localeCompare(right));
  return {
    id: "github-hosting-plan",
    title: "GitHub hosting plan",
    status:
      plan.status === "passed"
        ? "passed"
        : plan.status === "manual"
          ? "warning"
          : "blocked",
    summary:
      `Hosting plan is ${plan.status} for ${plan.namespace ?? "<none>"}/` +
      `${plan.repositoryName ?? "<none>"}: ` +
      `${statusCountSummary(dispositions)}` +
      `${mutationClasses.length > 0 ? `; mutations=${mutationClasses.join(",")}` : ""}.`,
    nextAction:
      plan.status === "passed"
        ? null
        : "Run dev-nexus workspace hosting plan . --json and use dev-nexus workspace hosting apply . --json only when provisioning policy allows the proposed repairs.",
  };
}

function setupStatusFromHostingStatus(
  status: NexusProjectHostingStatusResult["status"],
): NexusSetupCheckStatus {
  if (status === "blocked") {
    return "blocked";
  }
  if (status === "passed") {
    return "passed";
  }
  return "warning";
}

function repositoryStatusSummary(status: NexusProjectHostingStatusResult): string {
  if (status.repository.exists === true) {
    return [
      "exists",
      status.repository.visibility ? `visibility=${status.repository.visibility}` : null,
      status.repository.defaultBranch
        ? `defaultBranch=${status.repository.defaultBranch}`
        : null,
    ].filter((part): part is string => Boolean(part)).join(",");
  }
  if (status.repository.exists === false) {
    return "missing";
  }
  return "unchecked";
}

function statusCountSummary(values: string[]): string {
  if (values.length === 0) {
    return "none";
  }
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => `${value}=${count}`)
    .join(",");
}

function githubMetaProjectSetupRecordChecks(
  setupState: NexusSetupState,
): NexusSetupCheckResult[] {
  const flowState =
    setupState.flows["github-workspace-repository"] ??
    setupState.flows["github-meta-project"];
  return [recordedStepCheck({
    id: "github-workspace-repository-final-report",
    title: "GitHub workspace repository setup report",
    record: flowState?.steps["write-setup-report"],
    passedSummary:
      "A host-local GitHub workspace repository setup report was recorded for this machine.",
    pendingSummary:
      "A host-local GitHub workspace repository setup report has not been recorded yet.",
    blockedSummary:
      "The host-local GitHub workspace repository setup report was recorded as blocked.",
    nextAction:
      "Run the final setup check command and save the JSON report under .dev-nexus/host-setup before handoff.",
  })];
}

function metaRepositoryRemoteChecks(options: {
  projectRoot: string;
  expectedRemotes: Array<[string, string]>;
}): NexusSetupCheckResult[] {
  return options.expectedRemotes.map(([remoteName, expectedUrl]) => {
    const actualUrl = gitRemoteUrl(options.projectRoot, remoteName);
    if (actualUrl === null) {
      return {
        id: `workspace-remote-${setupCheckIdPart(remoteName)}`,
        title: `Workspace remote ${remoteName}`,
        status: "blocked",
        summary: `Workspace repository remote ${remoteName} is not configured.`,
        nextAction:
          `Run git remote add ${remoteName} ${expectedUrl} from the DevNexus workspace root.`,
      };
    }

    if (actualUrl.trim() !== expectedUrl) {
      return {
        id: `workspace-remote-${setupCheckIdPart(remoteName)}`,
        title: `Workspace remote ${remoteName}`,
        status: "blocked",
        summary:
          `Workspace repository remote ${remoteName} points to ${actualUrl}, expected ${expectedUrl}.`,
        nextAction:
          `Run git remote set-url ${remoteName} ${expectedUrl} after confirming this machine should use that actor/remote.`,
      };
    }

    return {
      id: `workspace-remote-${setupCheckIdPart(remoteName)}`,
      title: `Workspace remote ${remoteName}`,
      status: "passed",
      summary: `Workspace repository remote ${remoteName} matches expected URL.`,
      nextAction: null,
    };
  });
}

function hostingAuthProfileChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusSetupCheckResult[] {
  if (!projectConfig.hosting) {
    return [];
  }

  const requiredProfileIds = Array.from(new Set([
    ...expectedNexusProjectHostingRemotes({
      project: projectConfig,
      hosting: projectConfig.hosting,
    })
      .map((remote) => remote.authProfile)
      .filter((authProfile): authProfile is string => Boolean(authProfile)),
    ...(projectConfig.hosting.access ?? [])
      .map((principal) => principal.authProfile)
      .filter((authProfile): authProfile is string => Boolean(authProfile)),
  ]));
  if (requiredProfileIds.length === 0) {
    return [{
      id: "github-hosting-auth-profile",
      title: "GitHub hosting auth profiles",
      status: "blocked",
      summary:
        "Hosting remotes do not reference host-local auth profiles, so actor permissions cannot be checked.",
      nextAction:
        "Add authProfile references to hosting remotes and configure matching host-local DevNexus home authProfiles.",
    }];
  }

  const home = loadSetupHomeAuthProfiles(projectRoot, projectConfig);
  if (!home.ok) {
    return requiredProfileIds.map((profileId) => ({
      id: `github-hosting-auth-profile-${setupCheckIdPart(profileId)}`,
      title: `GitHub auth profile ${profileId}`,
      status: "blocked",
      summary: home.summary,
      nextAction:
        `Create host-local DevNexus home auth profile ${profileId}; do not store tokens, private keys, or gh config contents in the shared workspace repository.`,
    }));
  }

  const profileById = new Map(home.authProfiles.map((profile) => [
    profile.id,
    profile,
  ]));
  return requiredProfileIds.map((profileId) => {
    const profile = profileById.get(profileId);
    if (!profile) {
      return {
        id: `github-hosting-auth-profile-${setupCheckIdPart(profileId)}`,
        title: `GitHub auth profile ${profileId}`,
        status: "blocked",
        summary:
          `Host-local DevNexus home config does not define auth profile ${profileId}.`,
        nextAction:
          `Add auth profile ${profileId} to the host-local DevNexus home config; keep credentials and private key material outside the shared workspace repository.`,
      };
    }

    const details = [
      profile.kind ? `kind=${profile.kind}` : null,
      profile.credentialKind ? `credential=${profile.credentialKind}` : null,
      profile.actorId ? `actor=${profile.actorId}` : null,
      profile.account ? `account=${profile.account}` : null,
      profile.sshHost ? `sshHost=${profile.sshHost}` : null,
      profile.githubCliConfigDir ? "ghConfigDir=set" : null,
      profile.command ? "command=set" : null,
      profile.githubApp?.slug ? `app=${profile.githubApp.slug}` : null,
      profile.githubApp?.installationAccount
        ? `installation=${profile.githubApp.installationAccount}`
        : null,
      profile.githubApp ? "privateKeyPath=set" : null,
      profile.githubApp?.repositories &&
        profile.githubApp.repositories.length > 0
        ? `repositories=${profile.githubApp.repositories.join(",")}`
        : null,
      profile.environmentKeys && profile.environmentKeys.length > 0
        ? `envKeys=${profile.environmentKeys.join(",")}`
        : null,
    ].filter((detail): detail is string => Boolean(detail));
    const userToServer = profile.credentialKind === "github_app_user_token";
    return {
      id: `github-hosting-auth-profile-${setupCheckIdPart(profileId)}`,
      title: `GitHub auth profile ${profileId}`,
      status: userToServer ? "warning" : "passed",
      summary:
        `Host-local GitHub auth profile ${profileId} is configured${details.length > 0 ? ` (${details.join(", ")})` : ""}${userToServer ? "; user authorization was not checked." : "."}`,
      nextAction: userToServer
        ? "Run the host-local GitHub App user-token helper status/auth command and verify the authorizing user, App installation, selected repository, token refresh, and requested permissions."
        : null,
    };
  });
}

function loadSetupHomeAuthProfiles(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): { ok: true; authProfiles: NexusHostingAuthProfileConfig[] } | {
  ok: false;
  summary: string;
} {
  const homePath = projectConfig.home
    ? resolveNexusProjectPath({ projectRoot, value: projectConfig.home })
    : defaultNexusHomePath();
  try {
    return {
      ok: true,
      authProfiles:
        loadNexusHomeConfigFile(
          homePath,
          validateNexusHomeConfigBase,
        ).authProfiles ?? [],
    };
  } catch (error) {
    return {
      ok: false,
      summary:
        error instanceof Error
          ? `Host-local DevNexus home config could not be loaded from ${homePath}: ${error.message}`
          : `Host-local DevNexus home config could not be loaded from ${homePath}.`,
    };
  }
}

function gitRemoteUrl(sourceRoot: string, remoteName: string): string | null {
  try {
    return childProcess.execFileSync(
      resolveNexusCommandPath("git"),
      ["-C", sourceRoot, "remote", "get-url", remoteName],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return null;
  }
}

function gitStatusPorcelain(sourceRoot: string): string | null {
  try {
    return childProcess.execFileSync(
      resolveNexusCommandPath("git"),
      ["-C", sourceRoot, "status", "--porcelain"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return null;
  }
}

function recordedStepCheck(options: {
  id: string;
  title: string;
  record: NexusSetupStepRecord | undefined;
  passedSummary: string;
  pendingSummary: string;
  blockedSummary: string;
  nextAction: string;
}): NexusSetupCheckResult {
  if (options.record?.status === "completed") {
    return {
      id: options.id,
      title: options.title,
      status: "passed",
      summary: options.passedSummary,
      nextAction: null,
    };
  }

  if (options.record?.status === "blocked") {
    return {
      id: options.id,
      title: options.title,
      status: "blocked",
      summary: options.record.note
        ? `${options.blockedSummary} ${options.record.note}`
        : options.blockedSummary,
      nextAction: options.nextAction,
    };
  }

  return {
    id: options.id,
    title: options.title,
    status: "warning",
    summary: options.record?.note
      ? `${options.pendingSummary} ${options.record.note}`
      : options.pendingSummary,
    nextAction: options.nextAction,
  };
}

function summarizeCheckStatus(checks: NexusSetupCheckResult[]): NexusSetupCheckStatus {
  if (checks.some((check) => check.status === "blocked")) {
    return "blocked";
  }
  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }
  return "passed";
}

function humanRemoteFromAutomationRemote(remote: string): string {
  const sshRemote = /^git@([^:]+):(.+)$/u.exec(remote);
  if (sshRemote?.[1]?.startsWith("github.com-")) {
    return `git@github.com:${sshRemote[2]}`;
  }
  return remote;
}

function platformCommands(
  platform: NexusSetupPlatform,
  commands: { macos: string[]; windows: string[]; linux: string[] },
): string[] {
  if (platform === "windows") {
    return commands.windows;
  }
  if (platform === "linux") {
    return commands.linux;
  }
  return commands.macos;
}

function shellPathPlaceholder(value: string): string {
  return value.includes(" ") ? `"${value}"` : value;
}

function setupCommandJoin(
  platform: NexusSetupPlatform,
  ...segments: string[]
): string {
  return setupCommandPath(segments.join("/"), platform);
}

function setupCommandPath(value: string, platform: NexusSetupPlatform): string {
  return platform === "windows"
    ? value.replace(/[\\/]/gu, "\\")
    : value.replace(/[\\/]/gu, "/");
}

function shellStringLiteral(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function planProjectRootPath(
  projectConfig: NexusProjectConfig,
  platform: NexusSetupPlatform,
): string {
  if (platform === "windows") {
    return `$env:USERPROFILE\\dev-nexus\\${projectConfig.id}`;
  }

  return `$HOME/dev-nexus/${projectConfig.id}`;
}

function componentPlanSourceRoot(
  component: NexusProjectConfig["components"][number],
  platform: NexusSetupPlatform,
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string {
  return componentSetupSourceRoot({
    component,
    platform,
    projectRoot: planProjectRootPath(projectConfig, platform),
    pathPlatform: platform,
  }).path;
}

function componentCheckSourceRoot(
  component: NexusProjectConfig["components"][number],
  projectRoot: string,
  platform: NexusSetupPlatform,
  pathPlatform: NexusSetupPlatform,
): { path: string; reason: string; topology: NexusComponentSourceRootTopology } {
  return componentSetupSourceRoot({
    component,
    platform,
    projectRoot,
    pathPlatform,
  });
}

function componentSetupSourceRoot(options: {
  component: NexusProjectConfig["components"][number];
  platform: NexusSetupPlatform;
  projectRoot: string;
  pathPlatform: NexusSetupPlatform;
}): { path: string; reason: string; topology: NexusComponentSourceRootTopology } {
  const { component, platform, projectRoot, pathPlatform } = options;
  const topology = classifyNexusComponentSourceRootTopology({
    projectRoot,
    component,
    platform,
    pathPlatform,
  });
  const projectLocalPath = componentProjectLocalSourceRoot(
    component,
    pathPlatform,
    projectRoot,
  );

  if (!component.sourceRoot) {
    return {
      path: projectLocalPath,
      topology,
      reason:
        `No sourceRoot is configured for ${component.id}; using the workspace-local components root.`,
    };
  }

  const compatibilityAnalysis = analyzeNexusProjectPath({
    projectRoot,
    value: component.sourceRoot,
    platform,
  });
  if (compatibilityAnalysis.compatible) {
    const pathAnalysis = platform === pathPlatform
      ? compatibilityAnalysis
      : analyzeNexusProjectPath({
          projectRoot,
          value: component.sourceRoot,
          platform: pathPlatform,
        });
    return {
      path: pathAnalysis.path,
      topology,
      reason: `Using configured sourceRoot for ${component.id}.`,
    };
  }

  return {
    path: projectLocalPath,
    topology,
    reason:
      `Configured sourceRoot ${component.sourceRoot} is not compatible with ${platform}; using the workspace-local components root.`,
  };
}

function componentProjectLocalSourceRoot(
  component: NexusProjectConfig["components"][number],
  platform: NexusSetupPlatform,
  projectRoot: string,
): string {
  return resolveNexusProjectPath({
    projectRoot,
    value: `componentsRoot:${component.id}`,
    platform,
  });
}

function makeDirectoryCommand(
  directoryPath: string,
  platform: NexusSetupPlatform,
): string {
  if (platform === "windows") {
    return `New-Item -ItemType Directory -Force -Path ${shellPathPlaceholder(directoryPath)}`;
  }

  return `mkdir -p ${shellPathPlaceholder(directoryPath)}`;
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value);
}

function componentCloneCommands(
  projectConfig: NexusProjectConfig,
  platform: NexusSetupPlatform,
  projectRoot: string,
): string[] {
  return projectConfig.components.flatMap((component) => {
    const sourceRoot = componentPlanSourceRoot(
      component,
      platform,
      projectRoot,
      projectConfig,
    );
    if (!component.remoteUrl) {
      return [];
    }
    const cloneArgs = component.defaultBranch
      ? `--branch ${component.defaultBranch} ${component.remoteUrl}`
      : component.remoteUrl;
    const fetchArgs = component.defaultBranch
      ? `origin ${component.defaultBranch} --prune`
      : "--all --prune";
    const sourceRootArg = shellPathPlaceholder(sourceRoot);
    const cloneCommand = platform === "windows"
      ? `if (-not (${directoryExistsCommand(sourceRoot, platform)})) { git clone ${cloneArgs} ${sourceRootArg} }`
      : `${directoryExistsCommand(sourceRoot, platform)} || git clone ${cloneArgs} ${sourceRootArg}`;
    return [
      cloneCommand,
      `git -C ${sourceRootArg} status --short`,
      `git -C ${sourceRootArg} fetch ${fetchArgs}`,
    ];
  });
}

function directoryExistsCommand(
  directoryPath: string,
  platform: NexusSetupPlatform,
): string {
  if (platform === "windows") {
    return `Test-Path -LiteralPath ${shellPathPlaceholder(directoryPath)} -PathType Container`;
  }

  return `test -d ${shellPathPlaceholder(directoryPath)}`;
}

function componentSourceChecks(
  projectConfig: NexusProjectConfig,
  platform: NexusSetupPlatform,
  projectRoot: string,
): string[] {
  return projectConfig.components
    .map((component) =>
      componentPlanSourceRoot(component, platform, projectRoot, projectConfig),
    )
    .map((sourceRoot) => directoryExistsCommand(sourceRoot, platform));
}

function readNexusSetupState(statePath: string): NexusSetupState {
  if (!fs.existsSync(statePath)) {
    return {
      version: 1,
      updatedAt: "",
      flows: {},
    };
  }
  const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as NexusSetupState;
  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    flows: parsed.flows && typeof parsed.flows === "object" ? parsed.flows : {},
  };
}

function normalizeNow(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
