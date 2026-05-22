import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import {
  createDefaultNexusHomeConfigBase,
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  nexusHomeConfigPath,
  saveNexusHomeConfigFile,
  validateNexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import type { NexusHomeConfigBase } from "./nexusHomeConfig.js";
import {
  projectConfigPath,
  projectWorktreesRootPath,
  saveProjectConfig,
  type NexusProjectComponentConfig,
  type NexusProjectConfig,
  type NexusProjectWorkTrackerBindingConfig,
  type NexusProjectWorkTrackerRole,
} from "./nexusProjectConfig.js";
import { analyzeNexusProjectSetupComponentTopology } from "./nexusProjectComponentTopology.js";
import { buildNexusProjectSetupAuthInventory } from "./nexusProjectSetupAuthInventory.js";
import { buildNexusProjectSetupHostingHandoff } from "./nexusProjectSetupHostingHandoff.js";
import {
  defaultProjectGitRunner,
  pathForProjectConfig,
  runProjectGitCommand,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
} from "./nexusProjectLifecycle.js";
import { upsertNexusProjectReference } from "./nexusProjectRegistry.js";
import { scaffoldNexusProject } from "./nexusProjectScaffold.js";
import {
  buildNexusProjectSetupProposal,
  renderNexusProjectSetupProposalSummary,
  type NexusProjectSetupAgentProvider,
  type NexusProjectSetupAnswers,
  type NexusProjectSetupAuthProfileAnswers,
  type NexusProjectSetupComponentRole,
  type NexusProjectSetupProposal,
  type NexusProjectSetupWorkTrackerAnswers,
} from "./nexusProjectSetupModel.js";
import { createLocalWorkTrackerProvider } from "./workTrackingLocalProvider.js";
import type {
  WorkTrackingConfig,
} from "./workTrackingTypes.js";
import type {
  NexusHostingAuthProfileConfig,
  NexusHostingAuthProfileKind,
} from "./nexusProjectHosting.js";

export const nexusProjectSetupRequiredAnswerPaths = [
  "project.id",
  "project.name",
  "project.root",
  "components[0].id",
  "components[0].role",
  "components[0].source.kind",
  "components[0].source.path|remoteUrl",
] as const;

export { renderNexusProjectSetupProposalSummary } from "./nexusProjectSetupModel.js";
export type { NexusProjectSetupProposal } from "./nexusProjectSetupModel.js";

export interface LoadNexusProjectSetupAnswersOptions {
  answersPath?: string;
  projectRoot?: string;
  homePath?: string;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

export interface ApplyNexusProjectSetupOptions {
  answers: NexusProjectSetupAnswers;
  projectGitRunner?: ProjectGitRunner;
}

export interface NexusProjectSetupApplyResult {
  projectRoot: string;
  projectConfigPath: string;
  worktreesRoot: string;
  projectConfig: NexusProjectConfig;
  proposal: NexusProjectSetupProposal;
  git: {
    commands: ProjectGitCommandResult[];
  };
  writtenFiles: string[];
  ensuredLocalTrackerStores: string[];
}

export function buildNexusProjectSetupApplyNextActions(
  result: NexusProjectSetupApplyResult,
  options: { quoteArgument?: (value: string) => string } = {},
): string[] {
  const quoteArgument = options.quoteArgument ?? ((value: string) => value);
  const projectRoot = quoteArgument(result.projectRoot);
  const firstTracker = firstConfiguredTracker(result.projectConfig);
  return [
    `Open the DevNexus workspace root in Codex or your configured agent: ${result.projectRoot}`,
    `Run dev-nexus setup check ${projectRoot} join-existing-project --json to verify local readiness.`,
    `Run dev-nexus workspace status ${projectRoot} --json to inspect configured components.`,
    firstTracker
      ? `Create or triage the first work item for component ${firstTracker.componentId} with tracker ${firstTracker.trackerId}.`
      : "Create or triage the first work item through the component work-item service.",
    `Run dev-nexus workspace hosting status ${projectRoot} --json when hosting intent is configured. Add --home only if you used a custom DevNexus home.`,
  ];
}

export async function loadNexusProjectSetupAnswers(
  options: LoadNexusProjectSetupAnswersOptions,
): Promise<NexusProjectSetupAnswers | null> {
  if (options.answersPath) {
    return readNexusProjectSetupAnswersFile(options.answersPath, {
      projectRoot: options.projectRoot,
      homePath: options.homePath,
    });
  }

  const stdin = options.stdin ?? process.stdin;
  if (!stdin.isTTY) {
    return null;
  }

  return promptForNexusProjectSetupAnswers({
    projectRoot: options.projectRoot,
    homePath: options.homePath,
    stdin,
    stdout: options.stdout ?? process.stdout,
  });
}

export function readNexusProjectSetupAnswersFile(
  answersPath: string,
  overrides: { projectRoot?: string; homePath?: string } = {},
): NexusProjectSetupAnswers {
  const resolvedPath = path.resolve(answersPath);
  const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as NexusProjectSetupAnswers;
  return applyNexusProjectSetupAnswerOverrides(parsed, overrides);
}

export function previewNexusProjectSetup(
  answers: NexusProjectSetupAnswers,
): NexusProjectSetupProposal {
  return withTopologyDiagnostics(buildNexusProjectSetupProposal(answers));
}

export async function applyNexusProjectSetup(
  options: ApplyNexusProjectSetupOptions,
): Promise<NexusProjectSetupApplyResult> {
  const proposal = previewNexusProjectSetup(options.answers);
  if (proposal.status !== "ready") {
    throw new Error(
      `workspace setup proposal is blocked: ${proposal.diagnostics
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join("; ")}`,
    );
  }
  const providerMutation = proposal.operations.find(
    (operation) => operation.mutationClass === "provider_mutation",
  );
  if (providerMutation?.allowedDuringLocalSetup) {
    throw new Error("workspace setup refuses provider mutations during local setup");
  }

  const projectRoot = path.resolve(proposal.answers.project.root);
  const homePath = path.resolve(proposal.answers.home.path);
  const gitRunner = options.projectGitRunner ?? defaultProjectGitRunner;
  const gitCommands: ProjectGitCommandResult[] = [];
  const writtenFiles: string[] = [];

  fs.mkdirSync(projectRoot, { recursive: true });
  if (proposal.answers.project.initializeGit) {
    runGitIfMissing(projectRoot, gitRunner, gitCommands);
  }

  for (const component of proposal.answers.components) {
    const sourceRoot = componentSourceRoot(projectRoot, component);
    if (component.source.kind === "clone_project_local" && !fs.existsSync(sourceRoot)) {
      fs.mkdirSync(path.dirname(sourceRoot), { recursive: true });
      runProjectGitCommand(gitRunner, gitCommands, [
        "clone",
        component.source.remoteUrl as string,
        sourceRoot,
      ]);
    }
    if (component.source.kind === "create_local") {
      fs.mkdirSync(sourceRoot, { recursive: true });
      if (component.source.initializeGit) {
        runGitIfMissing(sourceRoot, gitRunner, gitCommands);
      }
    }
  }

  const projectConfig = buildNexusProjectConfigFromSetupAnswers(proposal.answers);
  const savedProjectConfigPath = saveProjectConfig(projectRoot, projectConfig);
  writtenFiles.push(savedProjectConfigPath);

  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);
  const scaffold = scaffoldNexusProject({
    homePath,
    projectRoot,
    worktreesRoot,
    projectConfig,
    skills: projectConfig.skills,
    mcp: projectConfig.mcp,
  });
  writtenFiles.push(scaffold.template.supportReadmePath);
  if (scaffold.template.targetStatePath) {
    writtenFiles.push(scaffold.template.targetStatePath);
  }
  writtenFiles.push(
    ...scaffold.agentMcp.agentTargets.map((target) => target.configPath),
  );
  writtenFiles.push(...scaffold.skills.installed.map((skill) => skill.manifestPath));

  const agentsPath = writeProjectAgentsFile(projectRoot, projectConfig);
  if (agentsPath) {
    writtenFiles.push(agentsPath);
  }

  const ensuredLocalTrackerStores = await ensureLocalTrackerStores({
    projectRoot,
    projectConfig,
  });

  if (
    proposal.answers.home.registerProject !== false ||
    (proposal.answers.authProfiles?.length ?? 0) > 0
  ) {
    const homeConfig = loadOrCreateProjectSetupHome(homePath);
    upsertSetupAuthProfiles(homeConfig, proposal.answers.authProfiles ?? []);
    if (proposal.answers.home.registerProject !== false) {
      upsertNexusProjectReference(homeConfig, projectRoot, projectConfig, {
        vibeKanbanProjectId: null,
      });
    }
    saveNexusHomeConfigFile(homePath, homeConfig, validateNexusHomeConfigBase);
    writtenFiles.push(nexusHomeConfigPath(homePath));
  }

  return {
    projectRoot,
    projectConfigPath: savedProjectConfigPath,
    worktreesRoot,
    projectConfig,
    proposal,
    git: {
      commands: gitCommands,
    },
    writtenFiles: uniqueStrings(writtenFiles),
    ensuredLocalTrackerStores,
  };
}

export function buildNexusProjectConfigFromSetupAnswers(
  answers: NexusProjectSetupAnswers,
): NexusProjectConfig {
  const projectRoot = path.resolve(answers.project.root);
  const agentTargets = answers.agentTargets ?? [{ provider: "codex" as const }];
  const localWorkTracking = answers.localWorkTracking ?? {
    enabled: true,
    provider: "local" as const,
  };
  const projectConfig: NexusProjectConfig = {
    version: 1,
    id: answers.project.id,
    name: answers.project.name,
    home: null,
    repo: {
      kind: answers.project.initializeGit ? "git" : "local",
      remoteUrl: null,
      defaultBranch: answers.project.defaultBranch ?? null,
    },
    worktreesRoot: "worktrees",
    components: answers.components.map((component) =>
      buildNexusProjectComponentConfigFromSetupAnswers(projectRoot, component, {
        localWorkTracking,
        publication: answers.publication,
        workTrackers: answers.workTrackers ?? [],
      }),
    ),
    ...(localWorkTracking.enabled
      ? {
          workTracking: {
            provider: "local" as const,
            ...(localWorkTracking.storePath
              ? { storePath: localWorkTracking.storePath }
              : {}),
          },
        }
      : {}),
    mcp: {
      command: "dev-nexus",
      args: ["mcp-stdio"],
      defaultToolsApprovalMode: "approve",
      agentTargets: agentTargets.map((target) => ({
        agent: target.provider,
        ...(target.configPath ? { configPath: target.configPath } : {}),
      })),
    },
    skills: {
      defaultCorePack: true,
      sourceControl: "support",
      agentTargets: agentTargets.map((target) => ({
        agent: target.provider,
      })),
    },
    ...(answers.hostingIntent?.provider === "github"
      ? {
          hosting: {
            provider: answers.hostingIntent.provider,
            namespace: answers.hostingIntent.namespace,
            repository: {
              name: answers.hostingIntent.repositoryName,
              visibility: "private" as const,
              defaultBranch: answers.hostingIntent.defaultBranch ?? "main",
            },
            ...(answers.hostingIntent.humanAuthProfileId
              ? { authProfile: answers.hostingIntent.humanAuthProfileId }
              : {}),
            remotes: hostingRemotesFromSetupAnswers(answers),
            access: [],
            provisioning: {
              allowCreate: false,
              allowLocalRemoteRepair: false,
              allowAccessRepair: false,
              allowInvitationAcceptance: false,
              allowDefaultBranchRepair: false,
              allowVisibilityRepair: false,
              ...(answers.hostingIntent.providerMutationAuthProfileId
                ? {
                    providerMutationAuthProfile:
                      answers.hostingIntent.providerMutationAuthProfileId,
                  }
                : {}),
            },
          },
        }
      : {}),
  };

  return projectConfig;
}

export function renderNexusProjectSetupRequiredAnswers(): string {
  return [
    "workspace init/setup requires --answers <json-file> in non-interactive mode.",
    "Required answer paths:",
    ...nexusProjectSetupRequiredAnswerPaths.map((answer) => `- ${answer}`),
  ].join("\n");
}

function withTopologyDiagnostics(
  proposal: NexusProjectSetupProposal,
): NexusProjectSetupProposal {
  const topology = analyzeNexusProjectSetupComponentTopology(proposal.answers);
  const authInventory = buildNexusProjectSetupAuthInventory(proposal.answers);
  const diagnostics = [
    ...proposal.diagnostics,
    ...topology.diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      path: diagnostic.path,
      message: diagnostic.message,
    })),
  ];

  return {
    ...proposal,
    status: diagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? "blocked"
      : proposal.status,
    diagnostics,
    authInventory,
    hostingHandoff: buildNexusProjectSetupHostingHandoff(
      proposal.answers,
      authInventory,
    ),
  };
}

async function promptForNexusProjectSetupAnswers(options: {
  projectRoot?: string;
  homePath?: string;
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}): Promise<NexusProjectSetupAnswers> {
  const rl = readline.createInterface({
    input: options.stdin,
    output: options.stdout,
  });
  try {
    options.stdout.write(
      [
        "DevNexus user quickstart",
        "Answer the workspace and component prompts.",
        "Primary component source path defaults to . inside an existing Git checkout and components/<id> in a new workspace.",
        "Press Enter to accept the default, or type another path.",
        "DevNexus home defaults to the host-local ~/.dev-nexus unless --home is supplied.",
        "",
      ].join("\n"),
    );
    const projectRoot = await askWithDefault(
      rl,
      "DevNexus workspace root",
      options.projectRoot ?? process.cwd(),
    );
    const defaultName = path.basename(projectRoot);
    const projectName = await askWithDefault(rl, "Workspace name", defaultName);
    const projectId = await askWithDefault(rl, "Project id", slug(projectName));
    const homePath = options.homePath ?? defaultNexusHomePath();
    const componentId = await askWithDefault(rl, "Primary component id", "primary");
    const componentPath = await askWithDefault(
      rl,
      "Primary component source path",
      defaultPrimaryComponentSourcePath(projectRoot, componentId),
    );
    const components: NexusProjectSetupAnswers["components"] = [
      {
        id: componentId,
        name: componentId,
        role: "primary",
        source: wizardComponentSource(projectRoot, componentPath),
      },
    ];

    while (yesNo(await askWithDefault(rl, "Add another component? (yes/no)", "no"))) {
      const additionalComponentId = await askWithDefault(
        rl,
        "Additional component id",
        `component-${components.length + 1}`,
      );
      const additionalComponentPath = await askWithDefault(
        rl,
        "Additional component source path",
        path.join("components", additionalComponentId),
      );
      const role = await askAdditionalComponentRole(rl, options.stdout);
      components.push({
        id: additionalComponentId,
        name: additionalComponentId,
        role,
        source: wizardComponentSource(projectRoot, additionalComponentPath),
      });
    }

    const agent = await askWithDefault(rl, "Agent target", "codex");
    const localTracker = await askWithDefault(rl, "Enable local tracker? (yes/no)", "yes");
    const initializeGit = await askWithDefault(rl, "Initialize meta Git repo? (yes/no)", "yes");
    const agentProvider = normalizeAgentProvider(agent);

    return {
      home: {
        path: homePath,
      },
      project: {
        id: projectId,
        name: projectName,
        root: projectRoot,
        initializeGit: yesNo(initializeGit),
      },
      components,
      agentTargets: [
        {
          provider: agentProvider,
          ...(agentProvider === "custom" ? { id: agent } : {}),
        },
      ],
      localWorkTracking: {
        enabled: yesNo(localTracker),
        provider: "local",
      },
    };
  } finally {
    rl.close();
  }
}

function wizardComponentSource(
  projectRoot: string,
  sourcePath: string,
): NexusProjectSetupAnswers["components"][number]["source"] {
  const resolvedPath = path.isAbsolute(sourcePath)
    ? path.resolve(sourcePath)
    : path.resolve(projectRoot, sourcePath);
  if (fs.existsSync(resolvedPath) || !isSameOrInsidePath(projectRoot, resolvedPath)) {
    return {
      kind: "reference_existing",
      path: sourcePath,
    };
  }

  return {
    kind: "create_local",
    path: sourcePath,
    initializeGit: true,
  };
}

function defaultPrimaryComponentSourcePath(
  projectRoot: string,
  componentId: string,
): string {
  return fs.existsSync(path.join(path.resolve(projectRoot), ".git"))
    ? "."
    : path.join("components", componentId);
}

function isSameOrInsidePath(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relativePath === "" ||
    (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function askAdditionalComponentRole(
  rl: readline.Interface,
  stdout: NodeJS.WriteStream,
): Promise<NexusProjectSetupComponentRole> {
  for (;;) {
    const answer = await askWithDefault(
      rl,
      "Additional component role (dependency/addon/extension/optional/support)",
      "addon",
    );
    const role = normalizeAdditionalComponentRole(answer);
    if (role) {
      return role;
    }
    if (answer.trim().toLowerCase() === "primary") {
      stdout.write("Additional components cannot use role primary.\n");
    } else {
      stdout.write(
        "Supported additional component roles: dependency, addon, extension, optional, support.\n",
      );
    }
  }
}

function normalizeAdditionalComponentRole(
  value: string,
): NexusProjectSetupComponentRole | null {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "dependency":
    case "addon":
    case "extension":
    case "optional":
    case "support":
      return normalized;
    default:
      return null;
  }
}

async function askWithDefault(
  rl: readline.Interface,
  label: string,
  defaultValue: string,
): Promise<string> {
  const answer = await rl.question(`${label} [${defaultValue}]: `);
  return answer.trim() || defaultValue;
}

function applyNexusProjectSetupAnswerOverrides(
  answers: NexusProjectSetupAnswers,
  overrides: { projectRoot?: string; homePath?: string },
): NexusProjectSetupAnswers {
  return {
    ...answers,
    home: {
      ...answers.home,
      ...(overrides.homePath ? { path: overrides.homePath } : {}),
    },
    project: {
      ...answers.project,
      ...(overrides.projectRoot ? { root: overrides.projectRoot } : {}),
    },
  };
}

export function buildNexusProjectComponentConfigFromSetupAnswers(
  projectRoot: string,
  component: NexusProjectSetupAnswers["components"][number],
  options: {
    localWorkTracking: NonNullable<NexusProjectSetupAnswers["localWorkTracking"]>;
    publication?: NexusProjectSetupAnswers["publication"];
    workTrackers: NexusProjectSetupWorkTrackerAnswers[];
  },
): NexusProjectComponentConfig {
  const workTrackers: NexusProjectWorkTrackerBindingConfig[] = [];
  if (options.localWorkTracking.enabled) {
    workTrackers.push({
      id: "local",
      name: "Local Primary",
      enabled: true,
      roles: ["primary"],
      workTracking: {
        provider: "local",
        storePath:
          options.localWorkTracking.storePath ??
          `.dev-nexus/work-items/${component.id}.json`,
      },
    });
  }
  workTrackers.push(
    ...options.workTrackers
      .filter((tracker) => setupTrackerAppliesToComponent(tracker, component))
      .filter((tracker) => tracker.id !== "local")
      .map(setupWorkTrackerToProjectBinding),
  );

  const sourceRoot = componentSourceRoot(projectRoot, component);
  const kind = component.source.kind === "create_local" &&
    !component.source.initializeGit &&
    !component.source.remoteUrl
      ? "local"
      : "git";

  return {
    id: component.id,
    name: component.name ?? component.id,
    kind,
    role: component.role === "support" ? "optional" : component.role,
    remoteUrl: component.source.remoteUrl ?? null,
    defaultBranch: component.source.defaultBranch ?? null,
    sourceRoot: pathForProjectConfig(projectRoot, sourceRoot),
    ...(workTrackers.length > 0
      ? {
          defaultWorkTrackerId: workTrackers.some((tracker) => tracker.id === "local")
            ? "local"
            : workTrackers[0]!.id,
          workTrackers,
          workTracking: workTrackers[0]!.workTracking,
        }
      : {}),
    ...(options.publication
      ? {
          publication: {
            strategy: options.publication.posture,
            ...(options.publication.remote
              ? { remote: options.publication.remote }
              : {}),
            ...(options.publication.targetBranch
              ? { targetBranch: options.publication.targetBranch }
              : {}),
          },
        }
      : {}),
    relationships: [],
  };
}

function setupTrackerAppliesToComponent(
  tracker: NexusProjectSetupWorkTrackerAnswers,
  component: NexusProjectSetupAnswers["components"][number],
): boolean {
  return tracker.componentId
    ? tracker.componentId === component.id
    : component.role === "primary";
}

function setupWorkTrackerToProjectBinding(
  tracker: NexusProjectSetupWorkTrackerAnswers,
): NexusProjectWorkTrackerBindingConfig {
  return {
    id: tracker.id,
    name: tracker.id,
    enabled: true,
    roles: [setupWorkTrackerRole(tracker)],
    workTracking: setupWorkTrackingConfig(tracker),
  };
}

function setupWorkTrackerRole(
  tracker: NexusProjectSetupWorkTrackerAnswers,
): NexusProjectWorkTrackerRole {
  return tracker.role ?? "eligible_source";
}

function setupWorkTrackingConfig(
  tracker: NexusProjectSetupWorkTrackerAnswers,
): WorkTrackingConfig {
  switch (tracker.provider) {
    case "local":
      return {
        provider: "local",
        storePath: `.dev-nexus/work-items/${tracker.id}.json`,
      };
    case "github":
      return {
        provider: "github",
        ...(tracker.host ? { host: tracker.host } : {}),
        repository: {
          owner: tracker.repositoryOwner as string,
          name: tracker.repositoryName as string,
        },
      };
    case "gitlab": {
      const repositoryId =
        tracker.repositoryId ??
        `${tracker.repositoryOwner as string}/${tracker.repositoryName as string}`;
      return {
        provider: "gitlab",
        ...(tracker.host ? { host: tracker.host } : {}),
        repository: {
          id: repositoryId,
        },
      };
    }
    case "jira":
      return {
        provider: "jira",
        ...(tracker.host ? { host: tracker.host } : {}),
        projectKey: tracker.projectKey as string,
        ...(tracker.issueType ? { issueType: tracker.issueType } : {}),
      };
  }
}

function hostingRemotesFromSetupAnswers(answers: NexusProjectSetupAnswers) {
  const hosting = answers.hostingIntent;
  if (!hosting) {
    return [];
  }

  return [
    {
      name: "origin",
      role: "human" as const,
      protocol: "ssh" as const,
      ...(hosting.humanAuthProfileId
        ? { authProfile: hosting.humanAuthProfileId }
        : {}),
    },
    {
      name: "bot",
      role: "automation" as const,
      protocol: "ssh" as const,
      ...(hosting.automationAuthProfileId
        ? { authProfile: hosting.automationAuthProfileId }
        : {}),
    },
  ];
}

function componentSourceRoot(
  projectRoot: string,
  component: NexusProjectSetupAnswers["components"][number],
): string {
  const sourcePath =
    component.source.path ??
    (component.source.kind === "clone_project_local"
      ? path.join("components", component.id)
      : component.id);
  return path.isAbsolute(sourcePath)
    ? path.resolve(sourcePath)
    : path.resolve(projectRoot, sourcePath);
}

export async function ensureLocalTrackerStores(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
}): Promise<string[]> {
  const ensured: string[] = [];
  for (const component of options.projectConfig.components) {
    const trackers = component.workTrackers ?? [];
    for (const tracker of trackers) {
      if (tracker.workTracking.provider !== "local") {
        continue;
      }
      await createLocalWorkTrackerProvider({
        projectRoot: options.projectRoot,
        config: tracker.workTracking,
      }).ensureProject({
        homePath: "",
        projectRoot: options.projectRoot,
        projectId: options.projectConfig.id,
        projectName: options.projectConfig.name,
        componentId: component.id,
        componentName: component.name,
        sourceRoot: component.sourceRoot
          ? path.resolve(options.projectRoot, component.sourceRoot)
          : options.projectRoot,
      });
      ensured.push(
        path.resolve(
          options.projectRoot,
          tracker.workTracking.storePath ?? ".dev-nexus/work-items.json",
        ),
      );
    }
  }

  return uniqueStrings(ensured);
}

function writeProjectAgentsFile(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string | null {
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  if (fs.existsSync(agentsPath)) {
    return null;
  }
  fs.writeFileSync(
    agentsPath,
    [
      `# Agent Guide For ${projectConfig.name}`,
      "",
      "This is a DevNexus-managed workspace.",
      "",
      "## Workspace And Components",
      "",
      "- The DevNexus workspace root contains orchestration files: `dev-nexus.project.json`, `.dev-nexus/`, generated agent/MCP support, workspace-level handoff notes, and target state.",
      "- Components are the source roots listed in `dev-nexus.project.json`; implementation changes belong in the owning component, not in workspace support files unless the work item explicitly says so.",
      "- Use generated worktrees under the configured worktrees root for coordinated implementation work.",
      "",
      "## First-Run Checklist",
      "",
      "- Open this DevNexus workspace root in Codex or the configured agent.",
      "- Run `dev-nexus setup check <workspace-root> join-existing-project --json` and resolve blocked readiness checks before launching work.",
      "- Run `dev-nexus workspace status <workspace-root> --json` to inspect components, trackers, worktrees, and generated agent support.",
      "- Create or triage the first component work item before assigning implementation work.",
      "",
      "## Operating Rules",
      "",
      "- Read this file, `CONTEXT.md` when present, and DevNexus workspace status before making changes.",
      "- Use DevNexus work items, component metadata, and generated worktrees for coordinated work.",
      "- Before editing a Git checkout, inspect status, remotes, upstream, and ahead/behind state. Fetch configured remotes when policy allows, then fast-forward clean branches with an upstream.",
      "- After direct integration or merge, delete only branches and worktrees proven merged into the target branch; hand off ambiguous or dirty state.",
      "- Keep provider mutations separate from local setup; use explicit hosting status, plan, and apply commands.",
      "- Preserve unrelated user changes in component source roots.",
      "",
    ].join("\n"),
    "utf8",
  );
  return agentsPath;
}

function firstConfiguredTracker(
  projectConfig: NexusProjectConfig,
): { componentId: string; trackerId: string } | null {
  for (const component of projectConfig.components) {
    const trackerId = component.defaultWorkTrackerId ?? component.workTrackers?.[0]?.id;
    if (trackerId) {
      return {
        componentId: component.id,
        trackerId,
      };
    }
  }

  return null;
}

function loadOrCreateProjectSetupHome(homePath: string): NexusHomeConfigBase {
  if (fs.existsSync(nexusHomeConfigPath(homePath))) {
    return loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase);
  }

  return createDefaultNexusHomeConfigBase(homePath);
}

function upsertSetupAuthProfiles(
  homeConfig: NexusHomeConfigBase,
  profiles: NexusProjectSetupAuthProfileAnswers[],
): void {
  if (profiles.length === 0) {
    return;
  }
  const existing = new Map(
    (homeConfig.authProfiles ?? []).map((profile) => [profile.id, profile]),
  );
  for (const profile of profiles) {
    existing.set(profile.id, setupAuthProfileToHomeAuthProfile(profile));
  }
  homeConfig.authProfiles = [...existing.values()];
}

function setupAuthProfileToHomeAuthProfile(
  profile: NexusProjectSetupAuthProfileAnswers,
): NexusHostingAuthProfileConfig {
  const credential = profile.credentialMethod;
  const kind = setupAuthProfileKind(profile);
  return {
    id: profile.id,
    actorId: profile.account ?? profile.id,
    provider: profile.provider,
    ...(kind ? { kind } : {}),
    ...(profile.account ? { account: profile.account } : {}),
    ...(profile.host ? { host: profile.host } : {}),
    ...(credential.kind === "provider_cli" &&
    credential.cli === "gh" &&
    credential.configDir
      ? { githubCliConfigDir: credential.configDir }
      : {}),
    ...(credential.kind === "provider_cli"
      ? { command: credential.cli }
      : {}),
    ...(credential.kind === "environment_variable"
      ? { environmentKeys: [credential.variable] }
      : {}),
  };
}

function setupAuthProfileKind(
  profile: NexusProjectSetupAuthProfileAnswers,
): NexusHostingAuthProfileKind | undefined {
  switch (profile.actorKind) {
    case "human":
      return "human";
    case "machine_user":
    case "service_account":
      return "automation";
    case "unknown":
      return undefined;
  }
}

function runGitIfMissing(
  cwd: string,
  gitRunner: ProjectGitRunner,
  commands: ProjectGitCommandResult[],
): void {
  if (fs.existsSync(path.join(cwd, ".git"))) {
    return;
  }
  runProjectGitCommand(gitRunner, commands, ["init", cwd]);
}

function yesNo(value: string): boolean {
  return /^(?:y|yes|true|1)$/iu.test(value.trim());
}

function normalizeAgentProvider(value: string): NexusProjectSetupAgentProvider {
  const normalized = value.trim().toLowerCase();
  if (normalized === "codex" || normalized === "opencode" || normalized === "claude") {
    return normalized;
  }

  return "custom";
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "") || "dev-nexus-project";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
