import path from "node:path";
import { shellQuoteArgument } from "./nexusAutomationAgentProfile.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
  type ResolvedNexusProjectWorkTracker,
} from "./nexusProjectLifecycle.js";
import {
  resolveNexusPublicationPolicy,
} from "./nexusPublicationPolicy.js";
import type {
  NexusAutomationPublicationConfig,
} from "./nexusAutomationConfig.js";
import { safeDirectoryName } from "./gitWorktreeService.js";

export interface NexusQuickFixPlanOptions {
  projectRoot: string;
  componentId?: string;
  workItemId: string;
  topic?: string | null;
  branchName?: string | null;
  worktreeName?: string | null;
  writeScope?: string[];
  verificationCommands?: string[];
}

export interface NexusQuickFixCommandStep {
  id: string;
  title: string;
  command: string;
  environment: Record<string, string>;
  note: string | null;
}

export interface NexusQuickFixPlan {
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  component: {
    id: string;
    name: string;
    sourceRoot: string;
    worktreesRoot: string;
  };
  issue: {
    workItemId: string;
    provider: "github";
    repository: string;
    number: number;
    url: string;
  };
  branch: {
    topic: string;
    name: string;
    worktreeName: string;
  };
  publication: {
    strategy: NexusAutomationPublicationConfig["strategy"];
    remote: string | null;
    targetBranch: string | null;
    commandEnvironment: Record<string, string>;
    requiredChecks: string[];
  };
  writeScope: string[];
  startSteps: NexusQuickFixCommandStep[];
  finishSteps: NexusQuickFixCommandStep[];
  skippedBookkeeping: string[];
  warnings: string[];
}

export function buildNexusQuickFixPlan(
  options: NexusQuickFixPlanOptions,
): NexusQuickFixPlan {
  const projectRoot = path.resolve(required(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const component = resolveQuickFixComponent(projectRoot, projectConfig, options);
  const tracker = githubTracker(component);
  const repository = githubRepository(tracker);
  const issueNumber = issueNumberFromWorkItemId(options.workItemId);
  const publication = resolveNexusPublicationPolicy(projectConfig, component);
  const topic = options.topic?.trim() || `quick-fix-${options.workItemId}`;
  const branchName =
    options.branchName?.trim() ||
    `codex/${component.id}/${safeDirectoryName(topic)}`;
  const worktreeName =
    options.worktreeName?.trim() ||
    `codex-${component.id}-${safeDirectoryName(topic)}`;
  const writeScope = [...(options.writeScope ?? [])];
  const commandEnvironment = { ...publication.commandEnvironment };
  const targetBranch = publication.targetBranch ?? component.defaultBranch ?? "main";
  const repoArg = `${repository.owner}/${repository.name}`;
  const worktreeCommand = quickFixCommand([
    "dev-nexus",
    "worktree",
    "prepare",
    projectRoot,
    "--component",
    component.id,
    "--work-item",
    options.workItemId,
    "--topic",
    topic,
    "--branch",
    branchName,
    "--worktree-name",
    worktreeName,
    ...writeScope.flatMap((scope) => ["--write-scope", scope]),
  ]);
  const verificationCommands =
    options.verificationCommands && options.verificationCommands.length > 0
      ? options.verificationCommands
      : [
          ...(component.verification?.focusedCommands ?? []),
          ...(component.verification?.fullCommands ?? []),
        ];

  return {
    projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    component: {
      id: component.id,
      name: component.name,
      sourceRoot: component.sourceRoot,
      worktreesRoot: component.worktreesRoot,
    },
    issue: {
      workItemId: options.workItemId,
      provider: "github",
      repository: repoArg,
      number: issueNumber,
      url: `https://github.com/${repoArg}/issues/${issueNumber}`,
    },
    branch: {
      topic,
      name: branchName,
      worktreeName,
    },
    publication: {
      strategy: publication.strategy,
      remote: publication.remote ?? null,
      targetBranch,
      commandEnvironment,
      requiredChecks: publication.greenMain?.requiredChecks ?? [],
    },
    writeScope,
    startSteps: [
      {
        id: "validate-bot-identity",
        title: "Validate automation GitHub identity",
        command: quickFixCommand([
          "gh",
          "auth",
          "status",
          "--hostname",
          repository.host ?? "github.com",
        ]),
        environment: commandEnvironment,
        note: "Run before provider writes so quick fixes do not fall back to a human account.",
      },
      {
        id: "prepare-worktree",
        title: "Prepare isolated source worktree",
        command: worktreeCommand,
        environment: {},
        note: "Use the prepared worktree for source and Git commands.",
      },
      {
        id: "mark-in-progress",
        title: "Mark the provider-native issue in progress",
        command: quickFixCommand([
          "gh",
          "issue",
          "edit",
          String(issueNumber),
          "--repo",
          repoArg,
          "--remove-label",
          "status:ready",
          "--add-label",
          "status:in_progress",
        ]),
        environment: commandEnvironment,
        note: "Skip when the issue is already claimed.",
      },
    ],
    finishSteps: [
      ...verificationCommands.map((command, index) => ({
        id: `verify-${index + 1}`,
        title: `Run verification ${index + 1}`,
        command,
        environment: {},
        note: index === 0 ? "Run focused checks first, then broader checks." : null,
      })),
      {
        id: "push-branch",
        title: "Push the review branch",
        command: quickFixCommand([
          "git",
          "push",
          publication.remote ?? "bot",
          branchName,
        ]),
        environment: commandEnvironment,
        note: "Use the automation remote from publication policy.",
      },
      {
        id: "open-pr",
        title: "Open or update the pull request",
        command: quickFixCommand([
          "gh",
          "pr",
          "create",
          "--repo",
          repoArg,
          "--head",
          branchName,
          "--base",
          targetBranch,
          "--title",
          `<issue ${issueNumber} title>`,
          "--body",
          `<summary, verification, closes #${issueNumber}>`,
        ]),
        environment: commandEnvironment,
        note: "Use gh pr edit instead when a PR already exists.",
      },
      {
        id: "wait-required-checks",
        title: "Wait for required green-main checks",
        command: quickFixCommand([
          "gh",
          "pr",
          "checks",
          "<pr-number>",
          "--repo",
          repoArg,
          "--watch",
        ]),
        environment: commandEnvironment,
        note: requiredChecksNote(publication.greenMain?.requiredChecks ?? []),
      },
      {
        id: "merge-pr",
        title: "Merge after checks are green",
        command: quickFixCommand([
          "gh",
          "pr",
          "merge",
          "<pr-number>",
          "--repo",
          repoArg,
          "--merge",
          "--delete-branch",
        ]),
        environment: commandEnvironment,
        note: "Only run when required checks are passing and publication authority allows merge.",
      },
      {
        id: "sync-local-main",
        title: "Sync the local source checkout",
        command: quickFixCommand([
          "git",
          "pull",
          "--ff-only",
          "origin",
          targetBranch,
        ]),
        environment: {},
        note: `Run from ${component.sourceRoot}.`,
      },
      {
        id: "close-issue",
        title: "Close the provider-native issue",
        command: quickFixCommand([
          "gh",
          "issue",
          "close",
          String(issueNumber),
          "--repo",
          repoArg,
          "--comment",
          `<merged PR, commit, verification, cleanup summary>`,
        ]),
        environment: commandEnvironment,
        note: "Remove status:in_progress or add a done label if the tracker uses one.",
      },
      {
        id: "cleanup-worktree",
        title: "Remove the disposable worktree and merged branch",
        command: quickFixCommand([
          "dev-nexus",
          "coordination",
          "cleanup-plan",
          projectRoot,
          "--component",
          component.id,
        ]),
        environment: {},
        note: "Use the cleanup plan before deleting anything ambiguous.",
      },
    ],
    skippedBookkeeping: [
      "Do not create a dogfood metadata PR unless workspace config, target state, policy, or durable coordination changed.",
      "Do not require coordination handoff when provider-backed handoffs are incomplete or unnecessary for a one-issue fix.",
      "Do not run DevNexus work-item sync-execute for live provider writes until provider identity is proven to use the automation profile.",
    ],
    warnings: quickFixWarnings(publication),
  };
}

function resolveQuickFixComponent(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  options: NexusQuickFixPlanOptions,
): ResolvedNexusProjectComponent {
  const components = resolveProjectComponents(projectRoot, projectConfig);
  if (!options.componentId) {
    return components[0] ?? missingComponent(options.componentId);
  }

  return (
    components.find((component) => component.id === options.componentId) ??
    missingComponent(options.componentId)
  );
}

function missingComponent(componentId: string | undefined): never {
  throw new Error(`Component ${componentId ?? "<default>"} was not found.`);
}

function githubTracker(
  component: ResolvedNexusProjectComponent,
): ResolvedNexusProjectWorkTracker {
  const tracker =
    component.workTrackers.find(
      (candidate) =>
        candidate.id === component.defaultTrackerId &&
        candidate.provider === "github",
    ) ??
    component.workTrackers.find(
      (candidate) =>
        candidate.default && candidate.provider === "github",
    ) ??
    component.workTrackers.find(
      (candidate) =>
        candidate.roles.includes("primary") && candidate.provider === "github",
    );
  if (!tracker) {
    throw new Error(
      `Component ${component.id} does not have a GitHub primary/default tracker for quick-fix mode.`,
    );
  }

  return tracker;
}

function githubRepository(tracker: ResolvedNexusProjectWorkTracker): {
  owner: string;
  name: string;
  host: string | null;
} {
  const workTracking = tracker.workTracking;
  if (workTracking.provider !== "github") {
    throw new Error(`Tracker ${tracker.id} is not a GitHub tracker.`);
  }
  if (!workTracking.repository?.owner || !workTracking.repository.name) {
    throw new Error(
      `Tracker ${tracker.id} must configure a GitHub repository owner and name for quick-fix mode.`,
    );
  }

  return {
    owner: workTracking.repository.owner,
    name: workTracking.repository.name,
    host: workTracking.host ?? "github.com",
  };
}

function issueNumberFromWorkItemId(workItemId: string): number {
  const match = /(?:^|[-#])(\d+)$/.exec(workItemId.trim());
  if (!match) {
    throw new Error(
      `Quick-fix work item ${workItemId} must end with a provider issue number, for example github-50.`,
    );
  }

  return Number(match[1]);
}

function quickFixCommand(args: string[]): string {
  return args.map(shellQuoteArgument).join(" ");
}

function required(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function requiredChecksNote(requiredChecks: string[]): string {
  if (requiredChecks.length === 0) {
    return "No required checks are configured; confirm publication policy before merge.";
  }

  return `Required checks: ${requiredChecks.join(", ")}.`;
}

function quickFixWarnings(
  publication: NexusAutomationPublicationConfig,
): string[] {
  const warnings: string[] = [];
  if (!publication.remote) {
    warnings.push("Publication policy does not name an automation remote.");
  }
  if (!publication.commandEnvironment.GH_CONFIG_DIR) {
    warnings.push("Publication policy does not set GH_CONFIG_DIR.");
  }
  if (publication.strategy === "local_only") {
    warnings.push("Publication policy is local_only; PR publication is blocked.");
  }

  return warnings;
}
