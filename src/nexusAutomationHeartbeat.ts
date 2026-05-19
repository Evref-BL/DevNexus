import path from "node:path";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import { loadProjectConfig, type NexusProjectConfig } from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";

export type NexusAutomationHeartbeatStatus = "ACTIVE" | "PAUSED";

export interface PrepareNexusAutomationHeartbeatOptions {
  projectRoot: string;
  name?: string | null;
  intervalMinutes?: number | null;
  status?: NexusAutomationHeartbeatStatus | null;
}

export interface NexusAutomationHeartbeatCodexRecipe {
  kind: "heartbeat";
  destination: "thread";
  name: string;
  rrule: string;
  status: NexusAutomationHeartbeatStatus;
  prompt: string;
}

export interface NexusAutomationHeartbeatPreparation {
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  automation: {
    configured: boolean;
    mode: NexusAutomationConfig["mode"] | null;
    maxConcurrentSubagents: number | null;
    selector: NexusAutomationConfig["selector"] | null;
    targetStatePath: string;
  };
  components: Array<{
    id: string;
    name: string;
    sourceRoot: string;
    worktreesRoot: string;
    defaultTrackerId: string | null;
    trackerCount: number;
  }>;
  codexAutomation: NexusAutomationHeartbeatCodexRecipe;
  warnings: string[];
  nextActions: string[];
}

export function prepareNexusAutomationHeartbeat(
  options: PrepareNexusAutomationHeartbeatOptions,
): NexusAutomationHeartbeatPreparation {
  const projectRoot = path.resolve(requiredNonEmpty(options.projectRoot, "projectRoot"));
  const intervalMinutes = normalizeIntervalMinutes(options.intervalMinutes);
  const status = options.status ?? "ACTIVE";
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation ?? null;
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const targetStatePath = path.resolve(
    projectRoot,
    automationConfig?.target.statePath ?? ".dev-nexus/automation/target-state.md",
  );
  const warnings = automationConfig
    ? []
    : ["Project automation is not configured; heartbeat should record that blocker before launching work."];
  const prompt = renderNexusAutomationHeartbeatPrompt({
    projectRoot,
    projectConfig,
    automationConfig,
    components,
    targetStatePath,
  });
  const name = normalizeHeartbeatName(options.name, projectConfig.name);

  return {
    projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    automation: {
      configured: automationConfig !== null,
      mode: automationConfig?.mode ?? null,
      maxConcurrentSubagents:
        automationConfig?.agent.maxConcurrentSubagents ?? null,
      selector: automationConfig?.selector ?? null,
      targetStatePath,
    },
    components: components.map((component) => ({
      id: component.id,
      name: component.name,
      sourceRoot: component.sourceRoot,
      worktreesRoot: component.worktreesRoot,
      defaultTrackerId: component.defaultTrackerId,
      trackerCount: component.workTrackers.length,
    })),
    codexAutomation: {
      kind: "heartbeat",
      destination: "thread",
      name,
      rrule: `FREQ=MINUTELY;INTERVAL=${intervalMinutes}`,
      status,
      prompt,
    },
    warnings,
    nextActions: [
      "Create or update a Codex heartbeat automation with the prepared recipe.",
      "Keep the heartbeat attached to the current project thread so follow-up work continues with project context.",
      "Review project-specific safety boundaries before enabling live provider or runtime mutations.",
    ],
  };
}

interface RenderHeartbeatPromptInput {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig | null;
  components: ResolvedNexusProjectComponent[];
  targetStatePath: string;
}

function renderNexusAutomationHeartbeatPrompt(
  input: RenderHeartbeatPromptInput,
): string {
  const componentLines = input.components.length > 0
    ? input.components
        .map(
          (component) =>
            `- ${component.id}: source=${component.sourceRoot}; worktrees=${component.worktreesRoot}; defaultTracker=${component.defaultTrackerId ?? "none"}; trackers=${component.workTrackers.length}`,
        )
        .join("\n")
    : "- No components are configured.";
  const selectorLine = input.automationConfig
    ? `statuses=${input.automationConfig.selector.statuses.join(",") || "none"}; labels=${input.automationConfig.selector.labels.join(",") || "none"}; excludeLabels=${input.automationConfig.selector.excludeLabels.join(",") || "none"}; limit=${input.automationConfig.selector.limit}`
    : "automation selector is not configured";
  const subagentLimit = input.automationConfig?.agent.maxConcurrentSubagents ?? 1;
  const mode = input.automationConfig?.mode ?? "not configured";

  return [
    `Continue the DevNexus project heartbeat for ${input.projectConfig.name} (${input.projectConfig.id}).`,
    "",
    `Project root: ${input.projectRoot}`,
    `Target state file: ${input.targetStatePath}`,
    `Automation mode: ${mode}`,
    `Automation selector: ${selectorLine}`,
    `Max concurrent subagents: ${subagentLimit}`,
    "",
    "Configured components:",
    componentLines,
    "",
    "At the start of each wake-up:",
    "- Read DEV_NEXUS_AGENT_CONTEXT_FILE when it is set, then read AGENTS.md, CONTEXT.md, PLAN.md, and the target state file.",
    "- Inspect DevNexus automation status, eligible work, agent profiles, target report, component state, worktree leases, and relevant work items through DevNexus CLI or MCP surfaces.",
    "- Run a Git freshness preflight for relevant checkouts: inspect status, remotes, upstream, and ahead/behind state; fetch configured remotes when policy allows; fast-forward clean branches with an upstream.",
    "- Use the configured component work-item services as systems of record. Respect component tracker roles and direct discovery policy; when external issues are direct-selectable, work the provider-native issue directly without importing or copying it into the local tracker.",
    "- Select the largest safe bounded batch of eligible work you can actually finish, respecting component ownership, safety policy, publication policy, and maxConcurrentSubagents.",
    "- Prepare isolated DevNexus worktrees before source edits and keep each worker or local task inside its assigned component/worktree boundary.",
    "- Use subagents when independent work can safely run in parallel; give each subagent explicit component, worktree, write-scope, and verification ownership.",
    "- Advance selected work through the owning tracker with status updates, concise comments, blockers, and coordination handoffs.",
    "- Record target-cycle facts through DevNexus for selected, dispatched, in-progress, completed, blocked, failed, or skipped work.",
    "- Run focused verification first, then broader relevant checks when feasible, and publish only through the configured automation authority and publication policy.",
    "- After direct integration or merge, fetch/prune, confirm work branches are ancestors of the target branch, remove disposable worktrees, and delete merged local and remote review branches; hand off dirty or ambiguous branches instead of deleting.",
    "",
    "When no eligible work is available:",
    "- First try to remove actionable blockers inside the documented safety boundaries.",
    "- If blockers cannot be removed, perform bounded read-only or policy-safe component probing to discover real defects, missing safe operations, ambiguous behavior, or workflow friction.",
    "- Create or update focused component-owned work items for real findings, keeping provider-native GitHub/GitLab/Jira issues in their configured trackers instead of forcing migration.",
    "",
    "Before ending a wake-up:",
    "- Record a target-cycle summary and any work-item comments or handoffs needed for durable continuation.",
    "- Leave the project in a recoverable state with useful source changes committed or clearly handed off.",
  ].join("\n");
}

function normalizeHeartbeatName(
  requestedName: string | null | undefined,
  projectName: string,
): string {
  const trimmed = requestedName?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : `DevNexus heartbeat: ${projectName}`;
}

function normalizeIntervalMinutes(value: number | null | undefined): number {
  if (value === null || value === undefined) {
    return 60;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("intervalMinutes must be a positive integer");
  }
  return value;
}

function requiredNonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}
