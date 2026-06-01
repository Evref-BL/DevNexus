import path from "node:path";
import process from "node:process";
import { verifyNexusAgentClaimForMutation } from "../agents/nexusAgentClaimGuard.js";
import {
  prepareNexusManualWorktree,
  resolveNexusManualWorktreeWorkItem,
  summarizeNexusManualWorktreeResult,
  type PrepareNexusManualWorktreeResult,
} from "../worktrees/nexusManualWorktree.js";
import type { WorkItem } from "../work-items/workTrackingTypes.js";
import {
  assertCliMutationAllowed,
  type DevNexusCliDependencies,
} from "./cliCommandContext.js";
import {
  parsePositiveInteger,
  writeJson,
  writeLine,
  type TextWriter,
} from "./cliSupport.js";

interface ParsedWorktreePrepareCommand {
  projectRoot: string;
  componentId?: string;
  projectMeta?: boolean;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string | null;
  featureId?: string | null;
  featureChange?: string | null;
  featureParentBranch?: string | null;
  featureStackPosition?: number | null;
  branchIntent?: string | null;
  topic?: string | null;
  workItemId?: string | null;
  workItemTitle?: string | null;
  hostId?: string | null;
  agentId?: string | null;
  workerAgentProvider?: string | null;
  writeScope: string[];
  leaseNotes: string[];
  json?: boolean;
}

type NextWorktreePrepareArg = () => string;

type WorktreePrepareOptionHandler = (
  parsed: ParsedWorktreePrepareCommand,
  next: NextWorktreePrepareArg,
  option: string,
) => void;

const worktreePrepareOptionHandlers: Record<string, WorktreePrepareOptionHandler> = {
  "--component": (parsed, next) => {
    parsed.componentId = next();
  },
  "--workspace-meta": (parsed) => {
    parsed.projectMeta = true;
  },
  "--project-meta": (parsed) => {
    parsed.projectMeta = true;
  },
  "--work-item": (parsed, next) => {
    parsed.workItemId = next();
  },
  "--work-item-title": (parsed, next) => {
    parsed.workItemTitle = next();
  },
  "--topic": (parsed, next) => {
    parsed.topic = next();
  },
  "--branch": (parsed, next) => {
    parsed.branchName = next();
  },
  "--worktree-name": (parsed, next) => {
    parsed.worktreeName = next();
  },
  "--base-ref": (parsed, next) => {
    parsed.baseRef = next();
  },
  "--no-base-ref": (parsed) => {
    parsed.baseRef = null;
  },
  "--feature": (parsed, next) => {
    parsed.featureId = next();
  },
  "--feature-change": (parsed, next) => {
    parsed.featureChange = next();
  },
  "--feature-parent": (parsed, next) => {
    parsed.featureParentBranch = next();
  },
  "--feature-stack-position": (parsed, next, option) => {
    parsed.featureStackPosition = parsePositiveInteger(next(), option);
  },
  "--branch-intent": (parsed, next) => {
    parsed.branchIntent = next();
  },
  "--host": (parsed, next) => {
    parsed.hostId = next();
  },
  "--agent": (parsed, next) => {
    parsed.agentId = next();
  },
  "--worker-agent": (parsed, next) => {
    parsed.workerAgentProvider = next();
  },
  "--write-scope": (parsed, next) => {
    parsed.writeScope.push(next());
  },
  "--lease-note": (parsed, next) => {
    parsed.leaseNotes.push(next());
  },
  "--json": (parsed) => {
    parsed.json = true;
  },
};

export async function handleWorktreeCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const command = argv[1];
  if (command === "prepare") {
    const parsed = parseWorktreePrepareCommand(argv);
    assertCliMutationAllowed(dependencies, {
      projectRoot: path.resolve(parsed.projectRoot),
      command: "worktree prepare",
      mutationClass: "worktree_bootstrap",
      componentId: parsed.componentId,
    });
    const resolvedWorkItem = await resolveWorktreePrepareWorkItem(
      parsed,
      dependencies,
    );
    await verifyNexusAgentClaimForMutation({
      projectRoot: path.resolve(parsed.projectRoot),
      componentId: resolvedWorkItem.componentId ?? parsed.componentId ?? null,
      workItemId: resolvedWorkItem.itemId ?? parsed.workItemId ?? null,
      env: dependencies.env ?? process.env,
      claimAuthority: dependencies.workItemClaimAuthority,
      now: dependencies.now,
    });
    const result = prepareNexusManualWorktree({
      projectRoot: parsed.projectRoot,
      componentId: resolvedWorkItem.componentId ?? parsed.componentId,
      projectMeta: parsed.projectMeta,
      branchName: parsed.branchName,
      worktreeName: parsed.worktreeName,
      baseRef: parsed.baseRef,
      featureId: parsed.featureId,
      featureChange: parsed.featureChange,
      featureParentBranch: parsed.featureParentBranch,
      featureStackPosition: parsed.featureStackPosition,
      branchIntent: parsed.branchIntent,
      topic: parsed.topic,
      workItemId: resolvedWorkItem.itemId ?? parsed.workItemId,
      workItemTitle:
        parsed.workItemTitle ?? resolvedWorkItem.workItem?.title ?? null,
      workItemDescription: resolvedWorkItem.workItem?.description ?? null,
      hostId: parsed.hostId,
      agentId: parsed.agentId,
      workerAgentProvider: parsed.workerAgentProvider,
      writeScope: parsed.writeScope,
      leaseNotes: parsed.leaseNotes,
      gitRunner: dependencies.gitRunner,
      now: dependencies.now,
    });
    printWorktreePrepareResult(
      result,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error("worktree requires prepare");
}

function parseWorktreePrepareCommand(
  argv: string[],
): ParsedWorktreePrepareCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("worktree prepare requires a workspace root");
  }

  const parsed: ParsedWorktreePrepareCommand = {
    projectRoot,
    writeScope: [],
    leaseNotes: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    const handler = worktreePrepareOptionHandlers[arg];
    if (!handler) {
      throw new Error(`Unknown worktree prepare option: ${arg}`);
    }
    handler(parsed, next, arg);
  }

  return parsed;
}

async function resolveWorktreePrepareWorkItem(
  parsed: ParsedWorktreePrepareCommand,
  dependencies: DevNexusCliDependencies,
): Promise<{
  componentId?: string;
  itemId?: string;
  workItem?: WorkItem | null;
}> {
  return resolveNexusManualWorktreeWorkItem({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    projectMeta: parsed.projectMeta,
    workItemId: parsed.workItemId,
    workItemTitle: parsed.workItemTitle,
    topic: parsed.topic,
    now: dependencies.now,
  });
}

function printWorktreePrepareResult(
  result: PrepareNexusManualWorktreeResult,
  parsed: ParsedWorktreePrepareCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...summarizeNexusManualWorktreeResult(result) };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus worktree prepared.");
  writeLine(stdout, `  Scope: ${result.scope}`);
  if (result.component) {
    writeLine(stdout, `  Component: ${result.component.id}`);
  }
  writeLine(stdout, `  Worktree: ${result.worktree.worktreePath}`);
  writeLine(stdout, `  Branch: ${result.worktree.branchName}`);
  writeLine(stdout, `  Lease: ${result.lease.id}`);
  writeLine(
    stdout,
    `  Workspace metadata: ${result.workspaceMetadataFreshness.status}`,
  );
  for (const warning of result.workspaceMetadataFreshness.warnings) {
    writeLine(stdout, `  Workspace metadata warning: ${warning}`);
  }
  if (result.worktree.baseRef) {
    writeLine(
      stdout,
      `  Base ref: ${result.worktree.baseRef} (${result.worktree.baseRefKind})`,
    );
  }
  if (result.worktree.resolvedBaseCommit) {
    writeLine(
      stdout,
      `  Resolved base commit: ${result.worktree.resolvedBaseCommit}`,
    );
  }
  for (const warning of result.worktree.baseRefFreshness.warnings) {
    writeLine(stdout, `  Base warning: ${warning}`);
  }
  if (result.setup.context?.context.featureBranchDelivery) {
    const feature = result.setup.context.context.featureBranchDelivery;
    writeLine(stdout, `  Feature: ${feature.featureId}`);
    writeLine(stdout, `  Review target: ${feature.branchTarget}`);
    writeLine(stdout, `  Final target: ${feature.finalPublicationTarget}`);
  }
  for (const action of result.nextActions) {
    writeLine(stdout, `  Next: ${action}`);
  }
}
