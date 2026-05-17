import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  resolveNexusProjectAgentMcpTargets,
  type MaterializedNexusAgentMcpTarget,
} from "./nexusAgentMcpConfig.js";
import { loadProjectConfig, type NexusProjectConfig } from "./nexusProjectConfig.js";
import { expectedNexusProjectHostingRemotes } from "./nexusProjectHosting.js";
import { analyzeNexusProjectPath } from "./nexusPathResolver.js";
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
    checks.push(...pluginProjectionChecks(projectRoot, projectConfig));
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
      if (!component.sourceRoot) {
        checks.push({
          id: `component-${component.id}-source-root`,
          title: `${component.name} source root`,
          status: "warning",
          summary: "No host-local sourceRoot is configured for this component.",
          nextAction:
            "Add a host-local component source root or clone the component according to project policy.",
        });
        continue;
      }

      const sourceRootAnalysis = analyzeNexusProjectPath({
        projectRoot: componentResolutionProjectRoot(projectRoot, projectConfig, platform),
        value: component.sourceRoot,
        platform,
      });

      if (!sourceRootAnalysis.compatible) {
        checks.push({
          id: `component-${component.id}-source-root`,
          title: `${component.name} source root`,
          status: "blocked",
          summary: `Component sourceRoot is configured for another OS: ${component.sourceRoot}`,
          nextAction:
            `Configure a ${platform} host-local source root for ${component.id} before running component work on this machine.`,
        });
        continue;
      }

      checks.push(pathCheck({
        id: `component-${component.id}-source-root`,
        title: `${component.name} source root`,
        pathName: sourceRootAnalysis.path,
        passedSummary: `Component source root exists: ${sourceRootAnalysis.path}`,
        blockedSummary: `Component source root is missing: ${sourceRootAnalysis.path}`,
        nextAction: component.remoteUrl
          ? `Clone or fetch ${component.remoteUrl} into ${sourceRootAnalysis.path}.`
          : `Create or configure ${sourceRootAnalysis.path}.`,
        missingStatus: "blocked",
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

interface MetaProjectRemotePlan {
  humanRemote: string;
  botRemote: string;
  automationAuthProfileDirectory: string;
  automationSshHost: string;
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
    options.projectRoot,
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
        `${devNexusCommand} setup check . join-existing-project --platform ${options.platform} --json`,
        "git status --short --branch",
      ],
      manualInstructions: [
        "Do not launch live runtime services from baseline setup; use approved runtime profiles only.",
      ],
      checks: [
        `${devNexusCommand} setup check . join-existing-project --platform ${options.platform} --json`,
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
    botRemote,
    automationAuthProfileDirectory,
    automationSshHost,
  } = metaProjectRemotePlan(options.projectConfig);
  return [
    {
      id: "choose-hosting-namespace",
      title: "Choose meta-project hosting namespace",
      kind: "manual",
      scope: "shared",
      summary: "Choose a machine-user account repository or private organization namespace for shared meta projects.",
      commands: [],
      manualInstructions: [
        "Use a clearly named bot or app actor for automation activity.",
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
        "Do not commit tokens, private keys, or gh config directories.",
      ],
      checks: ["gh auth status --hostname github.com"],
    },
    {
      id: "connect-meta-repository",
      title: "Connect meta repository",
      kind: "automated",
      scope: "host-local",
      summary: "Create or connect the shared private meta repository according to project policy.",
      commands: [
        `git remote get-url bot >/dev/null 2>&1 && git remote set-url bot ${botRemote} || git remote add bot ${botRemote}`,
        "git push bot main",
      ],
      manualInstructions: [
        "Only create or push the remote when project policy allows the configured automation actor to do so.",
      ],
      checks: [`git ls-remote ${botRemote} HEAD`],
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
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  platform: NexusSetupPlatform,
): string {
  if (!isPathIncompatibleWithPlatform(projectRoot, platform)) {
    return projectRoot;
  }

  if (platform === "windows") {
    return `$env:USERPROFILE\\dev-nexus\\${projectConfig.id}`;
  }

  return `$HOME/dev-nexus/${projectConfig.id}`;
}

function componentResolutionProjectRoot(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  platform: NexusSetupPlatform,
): string {
  return isPathIncompatibleWithPlatform(projectRoot, platform)
    ? planProjectRootPath(projectRoot, projectConfig, platform)
    : projectRoot;
}

function componentPlanSourceRoot(
  component: NexusProjectConfig["components"][number],
  platform: NexusSetupPlatform,
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string | null {
  if (!component.sourceRoot) {
    return null;
  }
  const analysis = analyzeNexusProjectPath({
    projectRoot: componentResolutionProjectRoot(projectRoot, projectConfig, platform),
    value: component.sourceRoot,
    platform,
  });
  if (analysis.compatible) {
    return analysis.path;
  }

  if (platform === "windows") {
    return `$env:USERPROFILE\\dev-nexus\\sources\\${component.id}`;
  }

  return `$HOME/dev-nexus/sources/${component.id}`;
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

function isPathIncompatibleWithPlatform(
  value: string,
  platform: NexusSetupPlatform,
): boolean {
  if (platform === "auto") {
    return false;
  }

  if (platform === "windows") {
    return isPosixAbsolutePath(value);
  }

  return isWindowsAbsolutePath(value);
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value);
}

function isPosixAbsolutePath(value: string): boolean {
  return value.startsWith("/");
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
    if (!sourceRoot || !component.remoteUrl) {
      return [];
    }
    return [
      `test -d ${shellPathPlaceholder(sourceRoot)} || git clone ${component.remoteUrl} ${shellPathPlaceholder(sourceRoot)}`,
      `git -C ${shellPathPlaceholder(sourceRoot)} fetch --all --prune`,
    ];
  });
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
    .filter((sourceRoot): sourceRoot is string => Boolean(sourceRoot))
    .map((sourceRoot) => `test -d ${shellPathPlaceholder(sourceRoot)}`);
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
