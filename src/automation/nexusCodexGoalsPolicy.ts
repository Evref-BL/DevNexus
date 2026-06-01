import type { NexusProjectConfig } from "../project/nexusProjectConfig.js";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";
import type { NexusAutomationAgentProfilePolicy } from "./nexusAutomationAgentProfile.js";

export const nexusCodexGoalsHitlStates = [
  "approval_required",
  "budget_limited",
  "paused",
  "blocked",
  "external_provider_review",
  "publication_review",
] as const;

export type NexusCodexGoalsHitlState =
  (typeof nexusCodexGoalsHitlStates)[number];

export type NexusCodexGoalsAutomationMode =
  | "disabled"
  | "goal_projection"
  | "goal_continuation";

export type NexusCodexGoalsPolicyStatus =
  | "allowed"
  | "warning"
  | "blocked";

export type NexusCodexGoalsPolicyFindingSeverity =
  | "info"
  | "warning"
  | "blocked";

export interface NexusCodexGoalsPolicyFinding {
  code: string;
  severity: NexusCodexGoalsPolicyFindingSeverity;
  summary: string;
  hitlState: NexusCodexGoalsHitlState | null;
}

export interface NexusCodexGoalsPolicyDecision {
  mode: NexusCodexGoalsAutomationMode;
  status: NexusCodexGoalsPolicyStatus;
  hitlStates: NexusCodexGoalsHitlState[];
  findings: NexusCodexGoalsPolicyFinding[];
  warnings: NexusCodexGoalsPolicyFinding[];
  blockers: NexusCodexGoalsPolicyFinding[];
}

export interface NexusCodexGoalsAutomationPolicyInput {
  mode: NexusCodexGoalsAutomationMode;
  approvalPolicy: string | null;
  sandbox: string | null;
  permissionProfile: string | null;
  allowHostMutation: boolean;
  allowDependencyInstall: boolean;
  allowLiveServices: boolean;
  tokenBudget: number | null;
  devNexusRelaunchWhileEligible: boolean;
  mcpDefaultToolsApprovalMode: string | null;
}

export interface NexusCodexGoalsAutomationProfilePolicyInput {
  projectConfig: NexusProjectConfig;
  automationConfig: NexusAutomationConfig;
  profile: NexusAutomationAgentProfilePolicy;
  mode: NexusCodexGoalsAutomationMode;
  tokenBudget?: number | null;
}

export class NexusCodexGoalsPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusCodexGoalsPolicyError";
  }
}

export function evaluateNexusCodexGoalsAutomationProfilePolicy(
  options: NexusCodexGoalsAutomationProfilePolicyInput,
): NexusCodexGoalsPolicyDecision {
  return evaluateNexusCodexGoalsAutomationPolicy({
    mode: options.mode,
    approvalPolicy:
      codexProfileConfigValue(options.profile.args, "approval_policy") ??
      codexProfileOptionValue(options.profile.args, "--approval-policy"),
    sandbox:
      codexProfileOptionValue(options.profile.args, "--sandbox") ??
      codexProfileConfigValue(options.profile.args, "sandbox_mode") ??
      codexProfileConfigValue(options.profile.args, "sandbox"),
    permissionProfile: options.profile.safety.profile,
    allowHostMutation: options.profile.safety.allowHostMutation,
    allowDependencyInstall: options.profile.safety.allowDependencyInstall,
    allowLiveServices: options.profile.safety.allowLiveServices,
    tokenBudget: options.tokenBudget ?? null,
    devNexusRelaunchWhileEligible:
      options.automationConfig.agent.relaunch.whileEligible,
    mcpDefaultToolsApprovalMode:
      codexMcpDefaultToolsApprovalMode(options.projectConfig),
  });
}

export function evaluateNexusCodexGoalsAutomationPolicy(
  input: NexusCodexGoalsAutomationPolicyInput,
): NexusCodexGoalsPolicyDecision {
  const findings: NexusCodexGoalsPolicyFinding[] = [];
  const mode = input.mode;
  const approvalPolicy = normalizePolicyValue(input.approvalPolicy);
  const sandbox = normalizePolicyValue(input.sandbox);
  const permissionProfile = normalizePolicyValue(input.permissionProfile);
  const broadAuthority =
    isBroadSandbox(sandbox) ||
    permissionProfile === "host-authorized" ||
    input.allowHostMutation;

  if (mode === "disabled") {
    findings.push(info(
      "goals_disabled",
      "Codex Goals are disabled for this app-server launch.",
    ));
    return decision(mode, findings);
  }

  if (mode === "goal_projection") {
    findings.push(info(
      "goal_projection_only",
      "Goal projection records the objective only; DevNexus still owns work-item, result, verification, authority, and publication gates.",
    ));
  } else {
    findings.push(info(
      "goal_continuation_selected",
      "Goal-driven continuation lets Codex resume work from the native Goal lifecycle and must be selected instead of DevNexus relaunch driving the same work.",
    ));
  }

  if (mode === "goal_continuation" && input.devNexusRelaunchWhileEligible) {
    findings.push(blocked(
      "double_driving",
      "Native Goal continuation and DevNexus relaunch.whileEligible would both drive the same work; choose one continuation owner.",
      "approval_required",
    ));
  }

  if (approvalPolicy === null) {
    findings.push(warning(
      "approval_policy_unspecified",
      "Codex approval policy is not explicit; review the selected app-server profile before enabling Goals.",
      "approval_required",
    ));
  } else if (approvalPolicy === "never") {
    if (mode === "goal_continuation" && broadAuthority) {
      findings.push(blocked(
        "approval_policy_never_with_broad_authority",
        "Goal-driven continuation cannot run with approval_policy=never and broad host or sandbox authority.",
        "approval_required",
      ));
    } else {
      findings.push(warning(
        "approval_policy_never",
        "approval_policy=never removes interactive approvals during the turn; DevNexus HITL and publication gates still apply.",
        "approval_required",
      ));
    }
  }

  if (input.tokenBudget === null) {
    findings.push(mode === "goal_continuation"
      ? blocked(
        "token_budget_required",
        "Goal-driven continuation requires an explicit token budget before it can run AFK.",
        "budget_limited",
      )
      : warning(
        "token_budget_omitted",
        "Goal projection has no token budget; the DevNexus result contract remains the completion gate.",
        "budget_limited",
      ));
  }

  if (mode === "goal_continuation" && approvalPolicy === "never" && input.allowLiveServices) {
    findings.push(blocked(
      "approval_policy_never_with_live_services",
      "Goal-driven continuation cannot run live-service permissions without an approval path.",
      "approval_required",
    ));
  } else if (input.allowLiveServices) {
    findings.push(warning(
      "live_services_allowed",
      "The selected profile allows live services; live runtime use still needs the configured DevNexus approval profile.",
      "approval_required",
    ));
  }

  if (mode === "goal_continuation" && approvalPolicy === "never" && input.allowDependencyInstall) {
    findings.push(blocked(
      "approval_policy_never_with_dependency_installs",
      "Goal-driven continuation cannot run dependency installs without an approval path.",
      "approval_required",
    ));
  } else if (input.allowDependencyInstall) {
    findings.push(warning(
      "dependency_installs_allowed",
      "The selected profile allows dependency installs; package changes still need the configured DevNexus approval profile.",
      "approval_required",
    ));
  }

  if (mode === "goal_projection" && broadAuthority) {
    findings.push(warning(
      "broad_authority",
      "The selected profile has broad host or sandbox authority; Goal projection does not expand that authority, but the profile still deserves review.",
      "approval_required",
    ));
  }

  if (
    mode === "goal_continuation" &&
    mcpToolsCanRunWithoutApproval(input.mcpDefaultToolsApprovalMode)
  ) {
    findings.push(blocked(
      "mcp_tools_without_approval",
      "Goal-driven continuation cannot run with MCP tools configured to skip approval.",
      "approval_required",
    ));
  }

  return decision(mode, findings);
}

export function formatNexusCodexGoalsPolicyBlockers(
  decision: NexusCodexGoalsPolicyDecision,
): string {
  return decision.blockers
    .map((blocker) => `${blocker.code}: ${blocker.summary}`)
    .join("; ");
}

export function normalizeNexusCodexGoalsPolicyDecision(
  value: unknown,
): NexusCodexGoalsPolicyDecision | null {
  if (value === undefined || value === null) {
    return null;
  }
  const record = requiredRecord(value, "Codex Goals policy decision");
  const mode = normalizeMode(record.mode, "Codex Goals policy decision.mode");
  const findings = optionalFindingArray(record.findings);
  return decision(mode, findings);
}

function decision(
  mode: NexusCodexGoalsAutomationMode,
  findings: NexusCodexGoalsPolicyFinding[],
): NexusCodexGoalsPolicyDecision {
  const blockers = findings.filter((finding) => finding.severity === "blocked");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  return {
    mode,
    status: blockers.length > 0
      ? "blocked"
      : warnings.length > 0
      ? "warning"
      : "allowed",
    hitlStates: [...nexusCodexGoalsHitlStates],
    findings,
    warnings,
    blockers,
  };
}

function info(
  code: string,
  summary: string,
): NexusCodexGoalsPolicyFinding {
  return { code, severity: "info", summary, hitlState: null };
}

function warning(
  code: string,
  summary: string,
  hitlState: NexusCodexGoalsHitlState,
): NexusCodexGoalsPolicyFinding {
  return { code, severity: "warning", summary, hitlState };
}

function blocked(
  code: string,
  summary: string,
  hitlState: NexusCodexGoalsHitlState,
): NexusCodexGoalsPolicyFinding {
  return { code, severity: "blocked", summary, hitlState };
}

function normalizePolicyValue(value: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function isBroadSandbox(sandbox: string | null): boolean {
  return sandbox === "danger-full-access" ||
    sandbox === "full-access" ||
    sandbox === "unrestricted" ||
    sandbox === "none";
}

function mcpToolsCanRunWithoutApproval(mode: string | null): boolean {
  const normalized = normalizePolicyValue(mode);
  return normalized === "never" ||
    normalized === "none" ||
    normalized === "auto_approve" ||
    normalized === "always_allow" ||
    normalized === "trusted";
}

function codexMcpDefaultToolsApprovalMode(
  projectConfig: NexusProjectConfig,
): string | null {
  const targetValue = projectConfig.mcp?.agentTargets?.find((target) => {
    const provider = (target.provider ?? target.agent).toLowerCase();
    return target.enabled !== false &&
      provider === "codex" &&
      target.defaultToolsApprovalMode;
  })?.defaultToolsApprovalMode;

  return targetValue ?? projectConfig.mcp?.defaultToolsApprovalMode ?? null;
}

function codexProfileConfigValue(
  args: readonly string[],
  key: string,
): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== "-c" && arg !== "--config") {
      continue;
    }
    const value = args[index + 1];
    if (!value) {
      continue;
    }
    const [configKey, ...rest] = value.split("=");
    if (configKey === key && rest.length > 0) {
      return rest.join("=");
    }
  }

  return null;
}

function codexProfileOptionValue(
  args: readonly string[],
  optionName: string,
): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === optionName) {
      return args[index + 1] ?? null;
    }
    if (arg.startsWith(`${optionName}=`)) {
      return arg.slice(optionName.length + 1);
    }
  }

  return null;
}

function optionalFindingArray(value: unknown): NexusCodexGoalsPolicyFinding[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusCodexGoalsPolicyError(
      "Codex Goals policy decision.findings must be an array",
    );
  }
  return value.map((item, index) =>
    normalizeFinding(item, `Codex Goals policy decision.findings[${index}]`)
  );
}

function normalizeFinding(
  value: unknown,
  pathName: string,
): NexusCodexGoalsPolicyFinding {
  const record = requiredRecord(value, pathName);
  return {
    code: requiredString(record.code, `${pathName}.code`),
    severity: normalizeSeverity(record.severity, `${pathName}.severity`),
    summary: requiredString(record.summary, `${pathName}.summary`),
    hitlState: record.hitlState === undefined || record.hitlState === null
      ? null
      : normalizeHitlState(record.hitlState, `${pathName}.hitlState`),
  };
}

function normalizeMode(
  value: unknown,
  pathName: string,
): NexusCodexGoalsAutomationMode {
  if (
    value === "disabled" ||
    value === "goal_projection" ||
    value === "goal_continuation"
  ) {
    return value;
  }
  throw new NexusCodexGoalsPolicyError(
    `${pathName} must be disabled, goal_projection, or goal_continuation`,
  );
}

function normalizeSeverity(
  value: unknown,
  pathName: string,
): NexusCodexGoalsPolicyFindingSeverity {
  if (value === "info" || value === "warning" || value === "blocked") {
    return value;
  }
  throw new NexusCodexGoalsPolicyError(
    `${pathName} must be info, warning, or blocked`,
  );
}

function normalizeHitlState(
  value: unknown,
  pathName: string,
): NexusCodexGoalsHitlState {
  if (nexusCodexGoalsHitlStates.includes(value as NexusCodexGoalsHitlState)) {
    return value as NexusCodexGoalsHitlState;
  }
  throw new NexusCodexGoalsPolicyError(
    `${pathName} must be one of ${nexusCodexGoalsHitlStates.join(", ")}`,
  );
}

function requiredRecord(
  value: unknown,
  pathName: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusCodexGoalsPolicyError(`${pathName} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusCodexGoalsPolicyError(`${pathName} must be a non-empty string`);
  }
  return value.trim();
}
