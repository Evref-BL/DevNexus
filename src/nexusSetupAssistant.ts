import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  resolveNexusProjectAgentMcpTargets,
  type MaterializedNexusAgentMcpTarget,
} from "./nexusAgentMcpConfig.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  loadProjectConfig,
  projectConfigPath,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import { findForbiddenSharedHostLocalDetails } from "./nexusHostRegistry.js";
import {
  deriveNexusProjectHostingRepositoryName,
  expectedNexusProjectHostingRemotes,
  type NexusHostingAuthProfileConfig,
} from "./nexusProjectHosting.js";
import { analyzeNexusProjectPath, resolveNexusProjectPath } from "./nexusPathResolver.js";
import type {
  NexusPluginMcpServerCapability,
  NexusPluginProjectedSkillCapability,
  NexusProjectPluginConfig,
} from "./nexusPluginCapabilities.js";
import {
  nexusSkillMarkdownFileName,
  nexusSkillSupportDirectoryName,
  nexusSkillsDirectoryName,
} from "./nexusSkills.js";

export type NexusSetupFlowId =
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

const setupFlows: NexusSetupFlowSummary[] = [
  {
    id: "github-meta-project",
    title: "Create or connect GitHub meta-project hosting",
    summary:
      "Guide bot or organization setup, isolated GitHub auth, SSH aliases, and shared DevNexus meta-repo remotes.",
  },
  {
    id: "join-existing-project",
    title: "Join an existing DevNexus project on this machine",
    summary:
      "Guide a new machine through cloning a shared meta project, configuring host-local auth, preparing components, and refreshing agent setup.",
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
            "Install prerequisites, then choose a fresh DevNexus project root and clone or update the shared meta repository there.",
            "Configure human and automation GitHub auth profiles before allowing pushes.",
            "Run setup check again and address blocked component source roots or MCP projection gaps.",
          ]
        : [
            "Choose whether the meta repository lives under a machine-user account or an organization.",
            "Complete manual GitHub account or organization setup before running verification checks.",
            "Configure host-local auth profiles and only then create or connect the private meta repository.",
          ],
  };
}

export function buildNexusSetupCheck(options: {
  projectRoot: string;
  flowId: NexusSetupFlowId | string;
  platform?: NexusSetupPlatform | string;
}): NexusSetupCheck {
  const flow = setupFlow(options.flowId);
  const platform = normalizeSetupPlatform(options.platform);
  const projectRoot = path.resolve(options.projectRoot);
  const checks: NexusSetupCheckResult[] = [];
  const setupState = readNexusSetupState(nexusSetupStatePath(projectRoot));

  let projectConfig: NexusProjectConfig | null = null;
  try {
    projectConfig = loadProjectConfig(projectRoot);
    checks.push({
      id: "project-config",
      title: "Project config",
      status: "passed",
      summary: "dev-nexus.project.json loaded successfully.",
      nextAction: null,
    });
  } catch (error) {
    checks.push({
      id: "project-config",
      title: "Project config",
      status: "blocked",
      summary: error instanceof Error ? error.message : String(error),
      nextAction: "Clone the shared meta repository or run this command from the project root.",
    });
  }

  checks.push(pathCheck({
    id: "meta-git-repository",
    title: "Meta Git repository",
    pathName: path.join(projectRoot, ".git"),
    passedSummary: "The meta project is a Git checkout.",
    blockedSummary: "The meta project is not a Git checkout at this path.",
    nextAction: "Clone or initialize the shared DevNexus meta repository.",
    missingStatus: "blocked",
  }));

  const agentMcpTargets = setupAgentMcpTargets(projectRoot, projectConfig);
  for (const target of agentMcpTargets) {
    checks.push(pathCheck({
      id: `agent-mcp-config-${target.agent}`,
      title: `${target.agent} MCP config`,
      pathName: target.configPath,
      passedSummary:
        `${target.provider} MCP config exists for this project root: ${target.configPathRelative}.`,
      blockedSummary:
        `${target.provider} MCP config has not been projected or manually configured for this machine: ${target.configPathRelative}.`,
      nextAction:
        "Run dev-nexus project mcp refresh . after installing DevNexus.",
      missingStatus: "warning",
    }));
    checks.push(agentMcpServerConfiguredCheck(target));
    checks.push(...agentMcpCapabilityGapChecks(target));
  }

  if (projectConfig) {
    checks.push(sharedHostRegistryHostLocalDetailsCheck(projectRoot));
    checks.push(...pluginProjectionChecks(projectRoot, projectConfig));
  }

  if (flow.id === "github-meta-project" && projectConfig) {
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
      title: "Agent project session",
      record:
        flowState?.steps[agentProjectSessionStepId] ??
        flowState?.steps[legacyCodexDesktopProjectStepId],
      passedSummary:
        "Agent application project/session opening and DevNexus MCP visibility were recorded for this machine.",
      pendingSummary:
        "Repo-local MCP config exists, but opening the configured agent application or session on this project root has not been recorded.",
      blockedSummary:
        "Agent application project/session setup was recorded as blocked for this machine.",
      nextAction:
        `Open or restart the configured agent application on this project root, confirm DevNexus MCP tools are visible, then run dev-nexus setup record . join-existing-project ${agentProjectSessionStepId} --status completed --note "DevNexus MCP tools visible."`,
    }));
  }

  if (projectConfig) {
    for (const component of projectConfig.components) {
      const sourceRootPlan = componentCheckSourceRoot(
        component,
        projectRoot,
      );

      checks.push(pathCheck({
        id: `component-${component.id}-source-root`,
        title: `${component.name} source root`,
        pathName: sourceRootPlan.path,
        passedSummary: `Component source root exists: ${sourceRootPlan.path}`,
        blockedSummary:
          `${sourceRootPlan.reason} Component source root is missing: ${sourceRootPlan.path}`,
        nextAction: component.remoteUrl
          ? `Clone or fetch ${component.remoteUrl} into ${sourceRootPlan.path}.`
          : `Create or configure ${sourceRootPlan.path}.`,
        missingStatus: "blocked",
      }));
      checks.push(...componentGitSafetyChecks(component, sourceRootPlan.path));
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

export function recordNexusSetupStep(
  options: RecordNexusSetupStepOptions,
): RecordNexusSetupStepResult {
  setupFlow(options.flowId);
  const statePath = nexusSetupStatePath(options.projectRoot);
  const now = normalizeNow(options.now?.() ?? new Date());
  const state = readNexusSetupState(statePath);
  const flowState = state.flows[options.flowId] ?? { steps: {} };

  flowState.steps[options.stepId] = {
    status: options.status,
    note: options.note ?? null,
    updatedAt: now,
  };
  state.flows[options.flowId] = flowState;
  state.updatedAt = now;

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  return { statePath, state };
}

export function nexusSetupStatePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".dev-nexus", "host-setup", "setup-state.json");
}

function setupFlow(flowId: NexusSetupFlowId | string): NexusSetupFlowSummary {
  const flow = setupFlows.find((candidate) => candidate.id === flowId);
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
  humanRemote: string;
  botRemote: string;
  automationAuthProfileDirectory: string;
  automationSshHost: string;
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

    return {
      humanRemote: humanRemote.url,
      botRemote: botRemote.url,
      automationAuthProfileDirectory: authProfileConfigDirectory(
        botRemote.authProfile,
      ),
      automationSshHost:
        sshHostFromGitRemote(botRemote.url) ?? "<automation-ssh-host>",
    };
  }

  const metaRemote = projectConfig.repo.remoteUrl ?? "<meta-repo-url>";
  const botRemote = metaRemote;
  return {
    humanRemote: humanRemoteFromAutomationRemote(metaRemote),
    botRemote,
    automationAuthProfileDirectory: authProfileConfigDirectory(null),
    automationSshHost: sshHostFromGitRemote(botRemote) ?? "<automation-ssh-host>",
  };
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
  const safeProfile = (authProfile ?? "automation-github")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return `gh-${safeProfile || "automation-github"}`;
}

function sshHostFromGitRemote(remoteUrl: string): string | null {
  const match = /^git@([^:]+):/u.exec(remoteUrl);
  return match?.[1] ?? null;
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
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "dev-nexus";
}

function joinExistingProjectSteps(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  platform: NexusSetupPlatform;
}): NexusSetupStep[] {
  const {
    humanRemote,
    botRemote,
    automationAuthProfileDirectory,
    automationSshHost,
  } = metaProjectRemotePlan(options.projectConfig);
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
      summary: "Install Git, Node.js 24 or newer, GitHub CLI, and DevNexus on this machine.",
      commands: platformCommands(options.platform, {
        macos: [
          "brew install git gh node",
          "npm install -g @evref-bl/dev-nexus@dogfood",
        ],
        windows: [
          "winget install --id Git.Git -e",
          "winget install --id GitHub.cli -e",
          "npm install -g @evref-bl/dev-nexus@dogfood",
        ],
        linux: [
          "npm install -g @evref-bl/dev-nexus@dogfood",
        ],
      }),
      manualInstructions: [
        "Use the package manager you trust on this host; the commands are examples.",
        "For freshly published dogfood packages, setup should wait for npm packument and dist-tag visibility with bounded retry/backoff before installing.",
        "Classify npm fetch failures before assigning worker tasks: E404 immediately after publish is registry propagation delay, network and timeout errors are network failures, absent versions are missing-version blockers, and damaged node_modules belongs to setup repair.",
        "Do not continue to auth or remotes until git, gh, node, npm, and dev-nexus are available.",
      ],
      checks: ["git --version", "gh --version", "node --version", `${devNexusCommand} --help`],
    },
    {
      id: "clone-or-update-meta-repo",
      title: "Clone or update the shared meta repository",
      kind: "manual",
      scope: "host-local",
      summary:
        `Create or reuse the DevNexus project root at ${projectRootForPlatform}; this directory is the shared meta project checkout, not a component source checkout.`,
      commands: [
        makeDirectoryCommand(path.dirname(projectRootForPlatform), options.platform),
        `git clone ${humanRemote} ${shellPathPlaceholder(projectRootForPlatform)}`,
        `cd ${shellPathPlaceholder(projectRootForPlatform)}`,
        "git pull --ff-only",
      ],
      manualInstructions: [
        `Use ${projectRootForPlatform} as the fresh DevNexus project directory on this machine unless you intentionally chose another empty location.`,
        "The cloned meta repository root becomes the DevNexus project root for later setup, MCP refresh, automation, and work-item commands.",
        "Do not clone the meta project inside a component source checkout; component sources are prepared in a later step.",
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
      summary: "Create or verify the isolated GitHub CLI and SSH profile used by the bot or app actor.",
      commands: platformCommands(options.platform, {
        macos: [
          `mkdir -p "$HOME/.config/${automationAuthProfileDirectory}" "$HOME/.ssh"`,
          `GH_CONFIG_DIR="$HOME/.config/${automationAuthProfileDirectory}" gh auth login --hostname github.com --git-protocol ssh --web`,
          `ssh -T git@${automationSshHost}`,
        ],
        windows: [
          `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.config\\${automationAuthProfileDirectory}"`,
          `$env:GH_CONFIG_DIR="$env:USERPROFILE\\.config\\${automationAuthProfileDirectory}"; gh auth login --hostname github.com --git-protocol ssh --web`,
          `ssh -T git@${automationSshHost}`,
        ],
        linux: [
          `mkdir -p "$HOME/.config/${automationAuthProfileDirectory}" "$HOME/.ssh"`,
          `GH_CONFIG_DIR="$HOME/.config/${automationAuthProfileDirectory}" gh auth login --hostname github.com --git-protocol ssh --web`,
          `ssh -T git@${automationSshHost}`,
        ],
      }),
      manualInstructions: [
        "Keep bot/app tokens and private keys host-local; do not commit them to the meta repo.",
        "If using an SSH host alias, configure it in ~/.ssh/config before validating the bot remote.",
      ],
      checks: [
        `GH_CONFIG_DIR="$HOME/.config/${automationAuthProfileDirectory}" gh auth status --hostname github.com`,
        `git ls-remote ${botRemote} HEAD`,
      ],
    },
    {
      id: "configure-meta-remotes",
      title: "Configure meta-project remotes",
      kind: "automated",
      scope: "host-local",
      summary: "Set origin for human work and bot for automation publication.",
      commands: [
        `git remote set-url origin ${humanRemote}`,
        `git remote get-url bot >/dev/null 2>&1 && git remote set-url bot ${botRemote} || git remote add bot ${botRemote}`,
        "git fetch origin",
        "git fetch bot",
      ],
      manualInstructions: [
        "Run these from the DevNexus meta-project root after both accounts can read the private repository.",
      ],
      checks: ["git remote -v", "git fetch --dry-run origin", "git fetch --dry-run bot"],
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
      summary: "Project DevNexus MCP and agent support files for this machine.",
      commands: [
        `${devNexusCommand} project mcp refresh .`,
        `${devNexusCommand} automation eligible-work . --json`,
      ],
      manualInstructions: [
        "Run from the meta-project root after installing DevNexus and configuring local paths.",
        `Configured agent MCP targets: ${agentMcpTargets.length > 0 ? agentMcpTargets.map(agentMcpTargetSummary).join("; ") : "none"}.`,
        "Plugin-projected skills and plugin MCP servers may require plugin-specific setup commands; setup check reports those gaps explicitly.",
        "A raw stdio MCP tools/list smoke test confirms the server command works, but the agent project session is not ready until the active provider exposes the tools in its own session.",
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
      title: "Open agent project session",
      kind: "manual",
      scope: "host-local",
      summary:
        "Open or create the configured agent application project/session for this meta-project root; DevNexus projects repo-local MCP config but does not mutate private agent app state.",
      commands: [
        `${devNexusCommand} setup record . join-existing-project ${agentProjectSessionStepId} --status completed --note "DevNexus MCP tools visible in the configured agent application."`,
      ],
      manualInstructions: [
        `In the configured agent application or CLI provider, create, open, or select a project/session rooted at ${projectRootForPlatform}.`,
        `Configured agent MCP targets: ${agentMcpTargets.length > 0 ? agentMcpTargets.map(agentMcpTargetSummary).join("; ") : "none"}.`,
        "Confirm the provider is using the generated MCP config from the meta-project root.",
        "For Codex Desktop, this means opening or creating a Codex project at the meta-project root; other providers may use a different project/session model.",
        "Reload, restart, or start a fresh provider session if the DevNexus MCP tools are not visible after the MCP refresh.",
        "Do not treat a standalone stdio tools/list probe as completion for this step; it only proves the MCP server command can start.",
        "Run the setup record command only after the active provider session can see the DevNexus MCP tools.",
        "Do not edit provider global state or app databases directly; treat project/session registration as a manual provider action until a supported API exists.",
      ],
      checks: [
        "Open the configured agent application or session on the meta-project root and confirm DevNexus MCP tools are visible.",
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
  const {
    humanRemote,
    botRemote,
    automationAuthProfileDirectory,
    automationSshHost,
  } = metaProjectRemotePlan(options.projectConfig);
  const guide = metaProjectHostingGuide(options.projectConfig);
  const repoVisibilityFlag =
    guide.visibility === "public"
      ? "--public"
      : guide.visibility === "internal"
        ? "--internal"
        : "--private";
  const createCommand =
    `GH_CONFIG_DIR="$HOME/.config/${automationAuthProfileDirectory}" gh repo create ${guide.namespace}/${guide.repositoryName} ${repoVisibilityFlag} --disable-wiki --disable-issues`;
  return [
    {
      id: "choose-hosting-namespace",
      title: "Choose meta-project hosting namespace",
      kind: "manual",
      scope: "shared",
      summary:
        `Choose where the shared meta repository lives. Recommended bot account: ${guide.recommendedBotAccount}; recommended organization namespace: ${guide.recommendedOrgNamespace}; repository: ${guide.repositoryName}.`,
      commands: [],
      manualInstructions: [
        `Use a clearly named machine-user or app actor for automation activity, for example ${guide.recommendedBotAccount}; custom names are fine when recorded in hosting/auth profile metadata.`,
        `Use a private organization namespace such as ${guide.recommendedOrgNamespace} when team ownership is more important than machine-user simplicity.`,
        "Create GitHub accounts, verify email addresses, complete browser/device login, and create organizations manually; DevNexus must not automate account or organization creation.",
        `Record only portable hosting intent in dev-nexus.project.json: provider=github, namespace=${guide.namespace}, repository=${guide.repositoryName}, visibility=${guide.visibility}, defaultBranch=${guide.defaultBranch}.`,
        "Keep source project repositories separate from DevNexus meta-project repositories when needed.",
      ],
      checks: [],
    },
    {
      id: "configure-auth-profile",
      title: "Configure host-local auth profile",
      kind: "manual",
      scope: "host-local",
      summary: "Configure SSH and GitHub CLI auth for the selected automation actor.",
      commands: platformCommands(options.platform, {
        macos: [
          `mkdir -p "$HOME/.config/${automationAuthProfileDirectory}" "$HOME/.ssh"`,
          `GH_CONFIG_DIR="$HOME/.config/${automationAuthProfileDirectory}" gh auth login --hostname github.com --git-protocol ssh --web`,
          `ssh -T git@${automationSshHost}`,
        ],
        windows: [
          `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.config\\${automationAuthProfileDirectory}"`,
          `$env:GH_CONFIG_DIR="$env:USERPROFILE\\.config\\${automationAuthProfileDirectory}"; gh auth login --hostname github.com --git-protocol ssh --web`,
          `ssh -T git@${automationSshHost}`,
        ],
        linux: [
          `mkdir -p "$HOME/.config/${automationAuthProfileDirectory}" "$HOME/.ssh"`,
          `GH_CONFIG_DIR="$HOME/.config/${automationAuthProfileDirectory}" gh auth login --hostname github.com --git-protocol ssh --web`,
          `ssh -T git@${automationSshHost}`,
        ],
      }),
      manualInstructions: [
        "Create an SSH host alias such as github.com-<bot> in ~/.ssh/config or the Windows user SSH config before validating the bot remote.",
        "Do not commit tokens, private keys, or gh config directories.",
        "Keep GH_CONFIG_DIR, SSH key paths, GitHub App private keys, and wrapper commands in host-local DevNexus home config or shell state, not in the shared meta repository.",
      ],
      checks: [
        "gh auth status --hostname github.com",
        `GH_CONFIG_DIR="$HOME/.config/${automationAuthProfileDirectory}" gh auth status --hostname github.com`,
        `ssh -T git@${automationSshHost}`,
      ],
    },
    {
      id: "connect-meta-repository",
      title: "Connect meta repository",
      kind: "manual",
      scope: "host-local",
      summary:
        guide.allowCreate
          ? "Propose creating or connecting the shared meta repository; live creation still requires explicit approval and configured credentials."
          : "Connect the shared meta repository; automatic GitHub repository creation is disabled by project policy.",
      commands: [
        `gh repo view ${guide.namespace}/${guide.repositoryName}`,
        ...(guide.allowCreate ? [createCommand] : []),
        `git remote set-url origin ${humanRemote}`,
        `git remote get-url bot >/dev/null 2>&1 && git remote set-url bot ${botRemote} || git remote add bot ${botRemote}`,
        "git remote -v",
        "git fetch --dry-run origin",
        "git fetch --dry-run bot",
      ],
      manualInstructions: [
        guide.allowCreate
          ? "Treat the gh repo create command as an approval-required proposal; run it only after confirming the selected namespace, actor permissions, and no-secret boundary."
          : "If gh repo view fails, create the repository manually in GitHub or update hosting metadata; do not let setup create it automatically while allowCreate is false.",
        "Use origin for human/manual access and bot for the automation actor remote so later publication guardrails can distinguish actors.",
        "Do not push until repository existence, remotes, and actor permissions are verified.",
      ],
      checks: [
        `gh repo view ${guide.namespace}/${guide.repositoryName}`,
        `git ls-remote ${humanRemote} HEAD`,
        `git ls-remote ${botRemote} HEAD`,
        "git remote -v",
        "git fetch --dry-run origin",
        "git fetch --dry-run bot",
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
        "dev-nexus setup check . github-meta-project --json",
      ],
      manualInstructions: [
        "Project hosting metadata should describe expected remotes; component or automation publication policy should name the remote future agents may push.",
        "Do not store secrets in shared publication guardrails. Store only actor kind/provider/handle, remote names, SSH host aliases, and non-secret command environment keys.",
      ],
      checks: [
        "dev-nexus automation status . --json",
        "dev-nexus setup check . github-meta-project --json",
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
        "dev-nexus setup check . github-meta-project --json > .dev-nexus/host-setup/github-meta-project-report.json",
        "git status --short --branch",
      ],
      manualInstructions: [
        "Keep the report host-local under .dev-nexus/host-setup; it may mention local paths or auth profile ids but must not contain tokens, private keys, or gh config contents.",
      ],
      checks: [
        "test -f .dev-nexus/host-setup/github-meta-project-report.json",
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

  return resolveNexusProjectAgentMcpTargets({
    projectRoot,
    mcpConfig: projectConfig?.mcp,
  });
}

function agentMcpConfigCheckCommands(
  projectConfig: NexusProjectConfig,
  projectRoot: string,
  platform: NexusSetupPlatform,
): string[] {
  return setupAgentMcpTargets(projectRoot, projectConfig).map(
    (target) =>
      `test -f ${shellPathPlaceholder(setupCommandPath(target.configPathRelative, platform))}`,
  );
}

function pluginProjectionCheckCommands(
  projectConfig: NexusProjectConfig,
  projectRoot: string,
  platform: NexusSetupPlatform,
): string[] {
  const commands: string[] = [];
  const skillTargets = setupAgentSkillTargets(projectConfig);
  const mcpTargets = setupAgentMcpTargets(projectRoot, projectConfig);

  for (const { capability } of pluginProjectedSkillCapabilities(projectConfig)) {
    commands.push(
      `test -f ${shellPathPlaceholder(setupCommandJoin(platform,
        nexusSkillSupportDirectoryName,
        nexusSkillsDirectoryName,
        capability.skillId,
        nexusSkillMarkdownFileName,
      ))}`,
    );
    for (const target of skillTargetsForCapability(capability, skillTargets)) {
      commands.push(
        `test -f ${shellPathPlaceholder(setupCommandJoin(platform,
          target.directory,
          capability.skillId,
          nexusSkillMarkdownFileName,
        ))}`,
      );
    }
  }

  for (const { capability } of pluginMcpServerCapabilities(projectConfig)) {
    for (const target of mcpTargets) {
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

function pluginProjectedSkillChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusSetupCheckResult[] {
  const checks: NexusSetupCheckResult[] = [];
  const skillTargets = setupAgentSkillTargets(projectConfig);

  for (const { plugin, capability } of pluginProjectedSkillCapabilities(projectConfig)) {
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
        `Run the plugin skill refresh/setup command or update the project skill bundle before assigning ${pluginLabel} worker tasks.`,
      missingStatus: "warning",
    }));

    for (const target of skillTargetsForCapability(capability, skillTargets)) {
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
          `Refresh ${target.agent} skill projection after the project-managed ${skillId} skill is materialized.`,
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
  const mcpTargets = setupAgentMcpTargets(projectRoot, projectConfig);

  for (const { plugin, capability } of pluginMcpServerCapabilities(projectConfig)) {
    for (const target of mcpTargets) {
      checks.push(pluginMcpServerCheck({
        projectRoot,
        plugin,
        capability,
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
  };

  if (!fs.existsSync(configPath)) {
    return {
      ...checkBase,
      status: "warning",
      summary:
        `Plugin ${pluginLabel} declares MCP server ${serverName}, but ${options.provider} MCP config is missing.`,
      nextAction:
        `Project ${options.provider} MCP config at ${options.configPathRelative}, then run the plugin-specific MCP setup or refresh step for ${pluginLabel}.`,
    };
  }

  const configured = mcpServerConfigured({
    provider: options.provider,
    configPath,
    configSchema: options.configSchema,
    serverName,
  });
  if (configured === true) {
    const command = configuredMcpServerCommand({
      provider: options.provider,
      configPath,
      configSchema: options.configSchema,
      serverName,
    });
    if (command && !mcpCommandAvailable(command, options.projectRoot)) {
      return {
        ...checkBase,
        status: "warning",
        summary:
          `Plugin MCP server ${serverName} is configured for ${options.provider}, but command ${command} is not available on PATH.`,
        nextAction:
          `Install or expose ${command} for this host, or update ${options.configPathRelative} to use the configured plugin MCP command.`,
      };
    }

    return {
      ...checkBase,
      status: "passed",
      summary: `Plugin MCP server ${serverName} is configured for ${options.provider}.`,
      nextAction: null,
    };
  }

  return {
    ...checkBase,
    status: "warning",
    summary:
      configured === false
        ? `Plugin ${pluginLabel} declares MCP server ${serverName}, but it is not configured for ${options.provider}.`
        : `Plugin ${pluginLabel} declares MCP server ${serverName}, but DevNexus cannot inspect ${options.provider} MCP config schema ${options.configSchema} yet.`,
    nextAction:
      configured === false
        ? `Run the plugin-specific MCP setup or refresh step so ${options.provider} can access ${serverName}.`
        : `Verify ${serverName} manually in ${options.configPathRelative} or add a DevNexus MCP config adapter for ${options.provider}.`,
  };
}

function agentMcpServerConfiguredCheck(
  target: MaterializedNexusAgentMcpTarget,
): NexusSetupCheckResult {
  const checkBase = {
    id: `agent-mcp-server-${setupCheckIdPart(target.agent)}-${setupCheckIdPart(target.serverName)}`,
    title: `${target.agent} MCP server ${target.serverName}`,
  };

  if (!fs.existsSync(target.configPath)) {
    return {
      ...checkBase,
      status: "warning",
      summary:
        `${target.provider} MCP config is missing, so DevNexus cannot confirm ${target.serverName} is configured.`,
      nextAction:
        `Run dev-nexus project mcp refresh . to project ${target.serverName} into ${target.configPathRelative}.`,
    };
  }

  const configured = mcpServerConfigured({
    provider: target.provider,
    configPath: target.configPath,
    configSchema: target.configSchema,
    serverName: target.serverName,
  });
  if (configured === true) {
    return {
      ...checkBase,
      status: "passed",
      summary:
        `DevNexus MCP server ${target.serverName} is configured for ${target.provider}.`,
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
        ? `Run dev-nexus project mcp refresh . and confirm ${target.serverName} appears in ${target.configPathRelative}.`
        : `Confirm ${target.serverName} manually in ${target.configPathRelative}, or add a DevNexus adapter for ${target.provider}.`,
  };
}

function setupAgentSkillTargets(
  projectConfig: NexusProjectConfig | null,
): { agent: string; directory: string }[] {
  if (projectConfig?.skills?.agentTargets === undefined) {
    return [];
  }

  return projectConfig.skills.agentTargets
    .filter((target) => target.enabled !== false)
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

function configuredMcpServerCommand(options: {
  provider: string;
  configPath: string;
  configSchema: string;
  serverName: string;
}): string | null {
  if (options.configSchema === "codex.mcp_servers") {
    return codexMcpServerCommand(
      fs.readFileSync(options.configPath, "utf8"),
      options.serverName,
    );
  }

  return null;
}

function codexMcpServerCommand(
  content: string,
  serverName: string,
): string | null {
  const lines = content.replace(/\r\n/gu, "\n").split("\n");
  let inServerTable = false;
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

    const match = /^\s*command\s*=\s*"([^"]+)"\s*(?:#.*)?$/u.exec(line);
    if (match) {
      return match[1]!;
    }
  }

  return null;
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

function componentGitSafetyChecks(
  component: NexusProjectConfig["components"][number],
  sourceRoot: string,
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

  if (component.remoteUrl) {
    const actualOrigin = gitRemoteUrl(sourceRoot, "origin");
    if (actualOrigin === null) {
      checks.push({
        id: `component-${component.id}-origin-remote`,
        title: `${component.name} origin remote`,
        status: "warning",
        summary:
          `Component source root has no origin remote; expected ${component.remoteUrl}.`,
        nextAction:
          `Run git -C ${shellPathPlaceholder(sourceRoot)} remote add origin ${component.remoteUrl} or confirm this checkout uses a different remote policy.`,
      });
    } else if (actualOrigin !== component.remoteUrl) {
      checks.push({
        id: `component-${component.id}-origin-remote`,
        title: `${component.name} origin remote`,
        status: "blocked",
        summary:
          `Component origin remote is ${actualOrigin}, expected ${component.remoteUrl}.`,
        nextAction:
          `Confirm the intended remote before running git -C ${shellPathPlaceholder(sourceRoot)} remote set-url origin ${component.remoteUrl}.`,
      });
    } else {
      checks.push({
        id: `component-${component.id}-origin-remote`,
        title: `${component.name} origin remote`,
        status: "passed",
        summary: `Component origin remote matches expected URL for ${component.id}.`,
        nextAction: null,
      });
    }
  }

  const dirtyStatus = gitStatusPorcelain(sourceRoot);
  if (dirtyStatus === null) {
    return [...checks, {
      id: `component-${component.id}-dirty-state`,
      title: `${component.name} dirty state`,
      status: "warning",
      summary:
        `Could not inspect Git dirty state for component source root: ${sourceRoot}`,
      nextAction:
        `Run git -C ${shellPathPlaceholder(sourceRoot)} status --short before fetching, pulling, or assigning work.`,
    }];
  }

  if (dirtyStatus.trim().length > 0) {
    return [...checks, {
      id: `component-${component.id}-dirty-state`,
      title: `${component.name} dirty state`,
      status: "blocked",
      summary:
        `Component source root has dirty local changes that setup must preserve: ${sourceRoot}`,
      nextAction:
        `Review git -C ${shellPathPlaceholder(sourceRoot)} status --short and commit, stash, or choose another host-local source root before setup fetches or pulls.`,
    }];
  }

  return [...checks, {
    id: `component-${component.id}-dirty-state`,
    title: `${component.name} dirty state`,
    status: "passed",
    summary: `Component source root has no Git working tree changes: ${sourceRoot}`,
    nextAction: null,
  }];
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
  const hostingGuide = metaProjectHostingGuide(projectConfig);

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
    checks.push({
      id: "github-hosting-provider-live-preflight",
      title: "GitHub hosting live preflight",
      status: "warning",
      summary:
        `GitHub repository ${hosting.namespace}/${hostingGuide.repositoryName} must be verified through gh or a provider adapter before live provisioning.`,
      nextAction:
        `Run gh repo view ${hosting.namespace}/${hostingGuide.repositoryName} with the configured human and automation profiles, then record the ${hosting.provisioning.allowCreate ? "approval to create or connect" : "connect-only"} outcome in setup state.`,
    });
  } else if (options.warnWhenHostingMissing !== false) {
    checks.push({
      id: "github-hosting-config",
      title: "GitHub hosting config",
      status: "warning",
      summary:
        "No shared hosting record is configured; setup is falling back to repo.remoteUrl for meta-project remotes.",
      nextAction:
        "Add a dev-nexus.project.json hosting record before relying on automation publication guardrails from this setup flow.",
    });
  }

  return checks;
}

function githubMetaProjectSetupRecordChecks(
  setupState: NexusSetupState,
): NexusSetupCheckResult[] {
  const flowState = setupState.flows["github-meta-project"];
  return [recordedStepCheck({
    id: "github-meta-final-report",
    title: "GitHub meta-project setup report",
    record: flowState?.steps["write-setup-report"],
    passedSummary:
      "A host-local GitHub meta-project setup report was recorded for this machine.",
    pendingSummary:
      "A host-local GitHub meta-project setup report has not been recorded yet.",
    blockedSummary:
      "The host-local GitHub meta-project setup report was recorded as blocked.",
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
        id: `meta-remote-${setupCheckIdPart(remoteName)}`,
        title: `Meta remote ${remoteName}`,
        status: "blocked",
        summary: `Meta repository remote ${remoteName} is not configured.`,
        nextAction:
          `Run git remote add ${remoteName} ${expectedUrl} from the DevNexus meta-project root.`,
      };
    }

    if (actualUrl.trim() !== expectedUrl) {
      return {
        id: `meta-remote-${setupCheckIdPart(remoteName)}`,
        title: `Meta remote ${remoteName}`,
        status: "blocked",
        summary:
          `Meta repository remote ${remoteName} points to ${actualUrl}, expected ${expectedUrl}.`,
        nextAction:
          `Run git remote set-url ${remoteName} ${expectedUrl} after confirming this machine should use that actor/remote.`,
      };
    }

    return {
      id: `meta-remote-${setupCheckIdPart(remoteName)}`,
      title: `Meta remote ${remoteName}`,
      status: "passed",
      summary: `Meta repository remote ${remoteName} matches expected URL.`,
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

  const requiredProfileIds = Array.from(new Set(
    expectedNexusProjectHostingRemotes({
      project: projectConfig,
      hosting: projectConfig.hosting,
    })
      .map((remote) => remote.authProfile)
      .filter((authProfile): authProfile is string => Boolean(authProfile)),
  ));
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
        `Create host-local DevNexus home auth profile ${profileId}; do not store tokens, private keys, or gh config contents in the shared meta repo.`,
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
          `Add auth profile ${profileId} to the host-local DevNexus home config; keep credentials and private key material outside the shared meta repo.`,
      };
    }

    const details = [
      profile.account ? `account=${profile.account}` : null,
      profile.sshHost ? `sshHost=${profile.sshHost}` : null,
      profile.githubCliConfigDir ? "ghConfigDir=set" : null,
      profile.command ? "command=set" : null,
    ].filter((detail): detail is string => Boolean(detail));
    return {
      id: `github-hosting-auth-profile-${setupCheckIdPart(profileId)}`,
      title: `GitHub auth profile ${profileId}`,
      status: "passed",
      summary:
        `Host-local GitHub auth profile ${profileId} is configured${details.length > 0 ? ` (${details.join(", ")})` : ""}.`,
      nextAction: null,
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
      "git",
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
      "git",
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
): { path: string; reason: string } {
  const hostPlatform = currentSetupPlatform();
  return componentSetupSourceRoot({
    component,
    platform: hostPlatform,
    projectRoot,
    pathPlatform: hostPlatform,
  });
}

function componentSetupSourceRoot(options: {
  component: NexusProjectConfig["components"][number];
  platform: NexusSetupPlatform;
  projectRoot: string;
  pathPlatform: NexusSetupPlatform;
}): { path: string; reason: string } {
  const { component, platform, projectRoot, pathPlatform } = options;
  const projectLocalPath = componentProjectLocalSourceRoot(
    component,
    pathPlatform,
    projectRoot,
  );

  if (!component.sourceRoot) {
    return {
      path: projectLocalPath,
      reason:
        `No sourceRoot is configured for ${component.id}; using the project-local components root.`,
    };
  }

  const analysis = analyzeNexusProjectPath({
    projectRoot,
    value: component.sourceRoot,
    platform: pathPlatform,
  });
  if (analysis.compatible) {
    return {
      path: analysis.path,
      reason: `Using configured sourceRoot for ${component.id}.`,
    };
  }

  return {
    path: projectLocalPath,
    reason:
      `Configured sourceRoot ${component.sourceRoot} is not compatible with ${platform}; using the project-local components root.`,
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
