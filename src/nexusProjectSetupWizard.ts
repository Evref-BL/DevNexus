import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import {
  createDefaultNexusHomeConfigBase,
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
} from "./nexusProjectConfig.js";
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
  type NexusProjectSetupProposal,
} from "./nexusProjectSetupModel.js";
import { createLocalWorkTrackerProvider } from "./workTrackingLocalProvider.js";

export const nexusProjectSetupRequiredAnswerPaths = [
  "home.path",
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
  return buildNexusProjectSetupProposal(answers);
}

export async function applyNexusProjectSetup(
  options: ApplyNexusProjectSetupOptions,
): Promise<NexusProjectSetupApplyResult> {
  const proposal = buildNexusProjectSetupProposal(options.answers);
  if (proposal.status !== "ready") {
    throw new Error(
      `project setup proposal is blocked: ${proposal.diagnostics
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join("; ")}`,
    );
  }
  const providerMutation = proposal.operations.find(
    (operation) => operation.mutationClass === "provider_mutation",
  );
  if (providerMutation?.allowedDuringLocalSetup) {
    throw new Error("project setup refuses provider mutations during local setup");
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

  if (proposal.answers.home.registerProject !== false) {
    const homeConfig = loadOrCreateProjectSetupHome(homePath);
    upsertNexusProjectReference(homeConfig, projectRoot, projectConfig, {
      vibeKanbanProjectId: null,
    });
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
      projectComponentFromSetupAnswers(projectRoot, component, {
        localWorkTracking,
        publication: answers.publication,
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
    "project setup requires --answers <json-file> in non-interactive mode.",
    "Required answer paths:",
    ...nexusProjectSetupRequiredAnswerPaths.map((answer) => `- ${answer}`),
  ].join("\n");
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
    const projectRoot = await askWithDefault(
      rl,
      "DevNexus project root",
      options.projectRoot ?? process.cwd(),
    );
    const defaultName = path.basename(projectRoot);
    const projectName = await askWithDefault(rl, "Project name", defaultName);
    const projectId = await askWithDefault(rl, "Project id", slug(projectName));
    const homePath = await askWithDefault(
      rl,
      "DevNexus home",
      options.homePath ?? path.join(process.env.HOME ?? process.cwd(), ".dev-nexus"),
    );
    const componentId = await askWithDefault(rl, "Primary component id", "primary");
    const componentPath = await askWithDefault(
      rl,
      "Primary component source path",
      ".",
    );
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
      components: [
        {
          id: componentId,
          name: componentId,
          role: "primary",
          source: {
            kind: "reference_existing",
            path: componentPath,
          },
        },
      ],
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

function projectComponentFromSetupAnswers(
  projectRoot: string,
  component: NexusProjectSetupAnswers["components"][number],
  options: {
    localWorkTracking: NonNullable<NexusProjectSetupAnswers["localWorkTracking"]>;
    publication?: NexusProjectSetupAnswers["publication"];
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
          defaultWorkTrackerId: "local",
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

async function ensureLocalTrackerStores(options: {
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
      "This is a DevNexus-managed project.",
      "",
      "- Read this file, `CONTEXT.md` when present, and DevNexus project status before making changes.",
      "- Use DevNexus work items, component metadata, and generated worktrees for coordinated work.",
      "- Keep provider mutations separate from local setup; use explicit hosting status, plan, and apply commands.",
      "- Preserve unrelated user changes in component source roots.",
      "",
    ].join("\n"),
    "utf8",
  );
  return agentsPath;
}

function loadOrCreateProjectSetupHome(homePath: string): NexusHomeConfigBase {
  if (fs.existsSync(nexusHomeConfigPath(homePath))) {
    return loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase);
  }

  return createDefaultNexusHomeConfigBase(homePath);
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
