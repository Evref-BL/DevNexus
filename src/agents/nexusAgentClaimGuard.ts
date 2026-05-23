import fs from "node:fs";
import process from "node:process";
import {
  defaultNexusAutomationConfig,
} from "../automation/nexusAutomationConfig.js";
import {
  loadProjectConfig,
} from "../project/nexusProjectConfig.js";
import {
  heartbeatNexusWorkItemAuthorityClaim,
  verifyNexusWorkItemAuthorityClaim,
  type NexusWorkItemClaimAuthority,
  type NexusWorkItemClaimAuthorityRecord,
} from "../work-items/nexusWorkItemClaim.js";

export type NexusAgentClaimGuardStatus =
  | "heartbeat"
  | "not_applicable"
  | "verified";

export interface NexusAgentClaimGuardResult {
  status: NexusAgentClaimGuardStatus;
  reason: string;
  authorityClaim?: NexusWorkItemClaimAuthorityRecord;
}

export interface VerifyNexusAgentClaimForMutationOptions {
  projectRoot: string;
  componentId?: string | null;
  workItemId?: string | null;
  homePath?: string;
  env?: NodeJS.ProcessEnv;
  claimAuthority?: NexusWorkItemClaimAuthority;
  now?: () => Date | string;
}

export interface HeartbeatNexusAgentClaimOptions
  extends VerifyNexusAgentClaimForMutationOptions {
  leaseDurationMs?: number;
}

interface AgentLaunchContextClaim {
  status?: unknown;
  componentId?: unknown;
  workItemId?: unknown;
  logicalWorkItemId?: unknown;
  authorityClaim?: unknown;
}

export async function verifyNexusAgentClaimForMutation(
  options: VerifyNexusAgentClaimForMutationOptions,
): Promise<NexusAgentClaimGuardResult> {
  const env = options.env ?? process.env;
  if (env.DEV_NEXUS_AUTOMATION_MODE !== "agent_launch") {
    return {
      status: "not_applicable",
      reason: "not running inside a DevNexus agent launch",
    };
  }
  if (env.DEV_NEXUS_WORK_ITEM_CLAIM_STATUS !== "claimed") {
    throw new Error(
      `DevNexus agent launch mutation requires a claimed work item; current claim status is ${env.DEV_NEXUS_WORK_ITEM_CLAIM_STATUS ?? "none"}`,
    );
  }

  const contextFile = requiredNonEmptyString(
    env.DEV_NEXUS_AGENT_CONTEXT_FILE,
    "DEV_NEXUS_AGENT_CONTEXT_FILE",
  );
  const claim = agentLaunchClaimFromContext(contextFile);
  assertClaimMatchesRequestedWork({
    claim,
    componentId: options.componentId,
    workItemId: options.workItemId,
  });
  const authorityClaim = normalizeAuthorityClaim(claim.authorityClaim);
  if (!authorityClaim) {
    return {
      status: "not_applicable",
      reason: "current claim has no authority-backed fencing record",
    };
  }

  const projectConfig = loadProjectConfig(options.projectRoot);
  const verification = await verifyNexusWorkItemAuthorityClaim({
    projectRoot: options.projectRoot,
    projectConfig,
    automationConfig: projectConfig.automation ?? defaultNexusAutomationConfig,
    authorityClaim,
    homePath: options.homePath,
    env,
    claimAuthority: options.claimAuthority,
    now: options.now,
  });
  if (verification.status !== "verified") {
    throw new Error(
      `DevNexus claim verification failed before mutation: ${verification.status}`,
    );
  }

  return {
    status: "verified",
    reason: "authority-backed claim verified",
    authorityClaim: verification.claim,
  };
}

export async function heartbeatNexusAgentClaim(
  options: HeartbeatNexusAgentClaimOptions,
): Promise<NexusAgentClaimGuardResult> {
  const env = options.env ?? process.env;
  if (env.DEV_NEXUS_AUTOMATION_MODE !== "agent_launch") {
    return {
      status: "not_applicable",
      reason: "not running inside a DevNexus agent launch",
    };
  }
  if (env.DEV_NEXUS_WORK_ITEM_CLAIM_STATUS !== "claimed") {
    throw new Error(
      `DevNexus agent launch heartbeat requires a claimed work item; current claim status is ${env.DEV_NEXUS_WORK_ITEM_CLAIM_STATUS ?? "none"}`,
    );
  }

  const contextFile = requiredNonEmptyString(
    env.DEV_NEXUS_AGENT_CONTEXT_FILE,
    "DEV_NEXUS_AGENT_CONTEXT_FILE",
  );
  const claim = agentLaunchClaimFromContext(contextFile);
  assertClaimMatchesRequestedWork({
    claim,
    componentId: options.componentId,
    workItemId: options.workItemId,
  });
  const authorityClaim = normalizeAuthorityClaim(claim.authorityClaim);
  if (!authorityClaim) {
    return {
      status: "not_applicable",
      reason: "current claim has no authority-backed fencing record",
    };
  }

  const projectConfig = loadProjectConfig(options.projectRoot);
  const heartbeat = await heartbeatNexusWorkItemAuthorityClaim({
    projectRoot: options.projectRoot,
    projectConfig,
    automationConfig: projectConfig.automation ?? defaultNexusAutomationConfig,
    authorityClaim,
    leaseDurationMs: options.leaseDurationMs,
    homePath: options.homePath,
    env,
    claimAuthority: options.claimAuthority,
    now: options.now,
  });
  if (heartbeat.status !== "heartbeat") {
    throw new Error(
      `DevNexus claim heartbeat failed: ${heartbeat.reason}`,
    );
  }

  return {
    status: "heartbeat",
    reason: "authority-backed claim heartbeat accepted",
    authorityClaim: heartbeat.claim,
  };
}

function agentLaunchClaimFromContext(contextFile: string): AgentLaunchContextClaim {
  const parsed = JSON.parse(fs.readFileSync(contextFile, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("DevNexus agent context must be a JSON object");
  }
  const claim = (parsed as { workItemClaim?: unknown }).workItemClaim;
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
    throw new Error("DevNexus agent context does not include workItemClaim");
  }

  return claim as AgentLaunchContextClaim;
}

function assertClaimMatchesRequestedWork(options: {
  claim: AgentLaunchContextClaim;
  componentId?: string | null;
  workItemId?: string | null;
}): void {
  const claimComponentId = optionalString(options.claim.componentId);
  if (
    options.componentId &&
    claimComponentId &&
    options.componentId !== claimComponentId
  ) {
    throw new Error(
      `DevNexus claimed component ${claimComponentId} does not match requested component ${options.componentId}`,
    );
  }

  const claimWorkItemIds = [
    optionalString(options.claim.workItemId),
    optionalString(options.claim.logicalWorkItemId),
  ].filter((value): value is string => Boolean(value));
  if (
    options.workItemId &&
    claimWorkItemIds.length > 0 &&
    !claimWorkItemIds.includes(options.workItemId)
  ) {
    throw new Error(
      `DevNexus claimed work item ${claimWorkItemIds[0]} does not match requested work item ${options.workItemId}`,
    );
  }
}

function normalizeAuthorityClaim(
  value: unknown,
): NexusWorkItemClaimAuthorityRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<NexusWorkItemClaimAuthorityRecord>;
  if (
    typeof record.authorityKind !== "string" ||
    typeof record.fencingToken !== "number" ||
    !record.key ||
    typeof record.key !== "object" ||
    !record.owner ||
    typeof record.owner !== "object"
  ) {
    throw new Error("DevNexus authority claim in agent context is invalid");
  }

  return record as NexusWorkItemClaimAuthorityRecord;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}
