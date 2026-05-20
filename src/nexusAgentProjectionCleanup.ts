import fs from "node:fs";
import path from "node:path";
import {
  buildNexusProjectAgentProjectionStatus,
  type NexusAgentProjectionKind,
  type NexusAgentProjectionPathStatus,
  type NexusAgentProjectionState,
  type NexusProjectAgentProjectionStatus,
} from "./nexusAgentProjectionStatus.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";

export type NexusAgentProjectionCleanupAction = "remove" | "skip";
export type NexusAgentProjectionCleanupPlanStatus = "ready" | "blocked";
export type NexusAgentProjectionCleanupApplyStatus = "completed" | "blocked";

export interface NexusAgentProjectionCleanupItem {
  kind: NexusAgentProjectionKind;
  provider: string;
  agent: string;
  path: string;
  absolutePath: string;
  state: NexusAgentProjectionState;
  cleanupSafe: boolean;
  sourceControl: NexusAgentProjectionPathStatus["sourceControl"];
  action: NexusAgentProjectionCleanupAction;
  reason: string;
  blocker: string | null;
  exists: boolean;
}

export interface NexusAgentProjectionCleanupPlan {
  status: NexusAgentProjectionCleanupPlanStatus;
  projectRoot: string;
  activeProviders: string[];
  staleGeneratedCount: number;
  removableCount: number;
  skippedCount: number;
  items: NexusAgentProjectionCleanupItem[];
  nextActions: string[];
  agentProjectionStatus: NexusProjectAgentProjectionStatus;
}

export interface NexusAgentProjectionCleanupError {
  path: string;
  message: string;
}

export interface NexusAgentProjectionCleanupApplyResult {
  status: NexusAgentProjectionCleanupApplyStatus;
  projectRoot: string;
  plan: NexusAgentProjectionCleanupPlan;
  removed: NexusAgentProjectionCleanupItem[];
  skipped: NexusAgentProjectionCleanupItem[];
  errors: NexusAgentProjectionCleanupError[];
  remainingPlan: NexusAgentProjectionCleanupPlan;
  nextActions: string[];
}

export interface NexusAgentProjectionCleanupOptions {
  projectRoot: string;
  projectConfig?: Pick<NexusProjectConfig, "agentTargets" | "mcp" | "skills" | "plugins">;
}

const cleanupSupportedGeneratedProviders = new Set(["codex", "claude", "opencode"]);

export function planNexusAgentProjectionCleanup(
  options: NexusAgentProjectionCleanupOptions,
): NexusAgentProjectionCleanupPlan {
  const projectRoot = path.resolve(options.projectRoot);
  const projectConfig = options.projectConfig ?? loadProjectConfig(projectRoot);
  const agentProjectionStatus = buildNexusProjectAgentProjectionStatus({
    projectRoot,
    projectConfig,
  });
  const removable = agentProjectionStatus.staleGeneratedProviderDirectories.map(
    (projection) => {
      const blocker = cleanupRemovalBlocker(projection);
      return cleanupItemFromProjection({
        projectRoot,
        projection,
        action: blocker ? "skip" : "remove",
        blocker,
      });
    },
  );
  const active = [
    ...agentProjectionStatus.expectedMcpConfigFiles,
    ...agentProjectionStatus.expectedSkillDirectories,
  ]
    .filter((projection) => projection.state === "expected-present")
    .map((projection) =>
      cleanupItemFromProjection({
        projectRoot,
        projection,
        action: "skip",
        blocker:
          "Path belongs to an active provider projection; cleanup never removes selected provider support.",
      })
    );
  const manual = agentProjectionStatus.manualProviderDirectories.map((projection) =>
    cleanupItemFromProjection({
      projectRoot,
      projection,
      action: "skip",
      blocker:
        projection.sourceControl === "source"
          ? "Path is source-controlled; cleanup only removes untracked generated support."
          : "Path is manual; cleanup only removes cleanup-safe generated support.",
    })
  );
  const items = [...removable, ...active, ...manual].map((item) =>
    pathInside(projectRoot, item.absolutePath)
      ? item
      : {
          ...item,
          action: "skip" as const,
          cleanupSafe: false,
          blocker: "Path resolves outside the project root.",
        }
  );
  const blocked = items.some((item) =>
    item.state === "present-stale-generated" && item.cleanupSafe && !pathInside(projectRoot, item.absolutePath)
  );

  return {
    status: blocked ? "blocked" : "ready",
    projectRoot,
    activeProviders: [...agentProjectionStatus.activeProviders],
    staleGeneratedCount: agentProjectionStatus.staleGeneratedProviderDirectories.length,
    removableCount: items.filter((item) => item.action === "remove").length,
    skippedCount: items.filter((item) => item.action === "skip").length,
    items,
    nextActions: cleanupPlanNextActions(items),
    agentProjectionStatus,
  };
}

export function applyNexusAgentProjectionCleanup(
  options: NexusAgentProjectionCleanupOptions,
): NexusAgentProjectionCleanupApplyResult {
  const plan = planNexusAgentProjectionCleanup(options);
  const removed: NexusAgentProjectionCleanupItem[] = [];
  const errors: NexusAgentProjectionCleanupError[] = [];

  for (const item of plan.items) {
    if (item.action !== "remove") {
      continue;
    }
    const refusal = removalRefusal(plan.projectRoot, item);
    if (refusal) {
      errors.push({
        path: item.path,
        message: refusal,
      });
      continue;
    }
    if (!fs.existsSync(item.absolutePath)) {
      continue;
    }
    try {
      fs.rmSync(item.absolutePath, { recursive: true, force: true });
      removed.push(item);
    } catch (error) {
      errors.push({
        path: item.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const remainingPlan = planNexusAgentProjectionCleanup(options);
  const status = errors.length === 0 ? "completed" : "blocked";

  return {
    status,
    projectRoot: plan.projectRoot,
    plan,
    removed,
    skipped: plan.items.filter((item) => item.action === "skip"),
    errors,
    remainingPlan,
    nextActions: status === "completed"
      ? [
          "Run dev-nexus project status <project-root> to confirm stale generated projections are gone.",
          "Rerun setup checks if agent target configuration changed.",
        ]
      : [
          "Review cleanup errors and rerun the dry-run before applying again.",
        ],
  };
}

function cleanupItemFromProjection(options: {
  projectRoot: string;
  projection: NexusAgentProjectionPathStatus;
  action: NexusAgentProjectionCleanupAction;
  blocker: string | null;
}): NexusAgentProjectionCleanupItem {
  const absolutePath = path.resolve(options.projectRoot, options.projection.path);
  return {
    kind: options.projection.kind,
    provider: options.projection.provider,
    agent: options.projection.agent,
    path: options.projection.path,
    absolutePath,
    state: options.projection.state,
    cleanupSafe: options.projection.cleanupSafe,
    sourceControl: options.projection.sourceControl,
    action: options.action,
    reason: options.projection.reason,
    blocker: options.blocker,
    exists: fs.existsSync(absolutePath),
  };
}

function cleanupRemovalBlocker(
  projection: NexusAgentProjectionPathStatus,
): string | null {
  if (!projection.cleanupSafe) {
    return "Projection is stale but is not marked cleanup-safe.";
  }
  if (!cleanupSupportedGeneratedProviders.has(projection.provider)) {
    return "Unknown provider projection is not eligible for cleanup without an explicit force policy.";
  }
  if (projection.sourceControl === "source") {
    return "Path is source-controlled; cleanup only removes untracked generated support.";
  }
  return null;
}

function removalRefusal(
  projectRoot: string,
  item: NexusAgentProjectionCleanupItem,
): string | null {
  if (item.state !== "present-stale-generated") {
    return "Cleanup refuses to remove paths that are not stale generated projections.";
  }
  if (!item.cleanupSafe) {
    return "Cleanup refuses to remove paths without cleanupSafe=true.";
  }
  if (item.sourceControl === "source") {
    return "Cleanup refuses to remove source-controlled paths.";
  }
  if (!pathInside(projectRoot, item.absolutePath)) {
    return "Cleanup refuses to remove paths outside the project root.";
  }
  if (!fs.existsSync(item.absolutePath)) {
    return null;
  }
  return null;
}

function cleanupPlanNextActions(items: NexusAgentProjectionCleanupItem[]): string[] {
  const removable = items.filter((item) => item.action === "remove");
  if (removable.length === 0) {
    return [
      "No cleanup-safe stale generated provider support paths are currently removable.",
    ];
  }
  return [
    "Review the dry-run output, then rerun with --apply to remove only cleanup-safe stale generated provider support.",
    "Do not manually delete paths listed as active, manual, or source-controlled.",
  ];
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
