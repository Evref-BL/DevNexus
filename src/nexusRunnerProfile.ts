import type { NexusProjectHostConfig } from "./nexusHostRegistry.js";

export type NexusRunnerOperationClass =
  | "read_only"
  | "verification"
  | "project_local_mutation"
  | "live_runtime"
  | "destructive";

export type NexusRunnerMutationClass =
  | "none"
  | "verification"
  | "project_local"
  | "live_runtime"
  | "destructive";

export type NexusRunnerArtifactRetentionMode =
  | "none"
  | "summary"
  | "logs"
  | "artifacts";

export type NexusRunnerCredentialIdentityKind =
  | "none"
  | "host"
  | "automation"
  | "manual";

export interface NexusRunnerProfileLimitsConfig {
  timeoutMs: number | null;
  outputLineLimit: number | null;
  outputByteLimit: number | null;
}

export interface NexusRunnerArtifactRetentionConfig {
  mode: NexusRunnerArtifactRetentionMode;
  ttlDays: number | null;
}

export interface NexusRunnerCredentialIdentityPolicyConfig {
  kind: NexusRunnerCredentialIdentityKind;
  identityRef: string | null;
}

export interface NexusRunnerApprovalRequirementConfig {
  required: boolean;
  policyGateIds: string[];
  approvalRef: string | null;
  reason: string | null;
}

export interface NexusRunnerProfileConfig {
  id: string;
  displayName: string;
  enabled: boolean;
  requiredCapabilities: string[];
  allowedOperationClasses: NexusRunnerOperationClass[];
  commandProfileRefs: string[];
  limits: NexusRunnerProfileLimitsConfig;
  artifactRetention: NexusRunnerArtifactRetentionConfig;
  credentialIdentity: NexusRunnerCredentialIdentityPolicyConfig;
  mutationClass: NexusRunnerMutationClass;
  approval: NexusRunnerApprovalRequirementConfig;
}

export type NexusRunnerProfileApprovalState =
  | "not_required"
  | "approved"
  | "policy_gated"
  | "missing_gate";

export interface NexusRunnerProfileHostCapabilityStatus {
  hostId: string;
  enabled: boolean;
  missingCapabilities: string[];
}

export interface NexusRunnerProfileStatus {
  id: string;
  displayName: string;
  enabled: boolean;
  requiredCapabilities: string[];
  allowedOperationClasses: NexusRunnerOperationClass[];
  commandProfileRefs: string[];
  limits: NexusRunnerProfileLimitsConfig;
  artifactRetention: NexusRunnerArtifactRetentionConfig;
  credentialIdentity: NexusRunnerCredentialIdentityPolicyConfig;
  mutationClass: NexusRunnerMutationClass;
  approvalRequired: boolean;
  approvalState: NexusRunnerProfileApprovalState;
  policyGateIds: string[];
  missingHostCapabilities: string[];
  runnableHostIds: string[];
  hostCapabilities: NexusRunnerProfileHostCapabilityStatus[];
}

export type NexusRunnerProfilePolicySummary = Omit<
  NexusRunnerProfileStatus,
  "hostCapabilities"
>;

export function buildNexusRunnerProfileStatuses(
  profiles: readonly NexusRunnerProfileConfig[] | undefined,
  hosts: readonly NexusProjectHostConfig[] | undefined,
): NexusRunnerProfileStatus[] {
  return (profiles ?? []).map((profile) =>
    buildNexusRunnerProfileStatus(profile, hosts ?? []),
  );
}

export function buildNexusRunnerProfilePolicySummary(
  profiles: readonly NexusRunnerProfileConfig[] | undefined,
  hosts: readonly NexusProjectHostConfig[] | undefined,
): NexusRunnerProfilePolicySummary[] {
  return buildNexusRunnerProfileStatuses(profiles, hosts).map(
    ({ hostCapabilities: _hostCapabilities, ...summary }) => summary,
  );
}

export function requiredMutationClassForOperationClasses(
  operationClasses: readonly NexusRunnerOperationClass[],
): NexusRunnerMutationClass {
  const ranks = operationClasses.map(operationClassRank);
  const maxRank = ranks.length > 0 ? Math.max(...ranks) : 0;
  if (maxRank >= operationClassRank("destructive")) {
    return "destructive";
  }
  if (maxRank >= operationClassRank("live_runtime")) {
    return "live_runtime";
  }
  if (maxRank >= operationClassRank("project_local_mutation")) {
    return "project_local";
  }
  if (maxRank >= operationClassRank("verification")) {
    return "verification";
  }
  return "none";
}

export function runnerProfileRequiresApproval(
  operationClasses: readonly NexusRunnerOperationClass[],
  mutationClass: NexusRunnerMutationClass,
): boolean {
  return (
    operationClasses.includes("live_runtime") ||
    operationClasses.includes("destructive") ||
    mutationClass === "live_runtime" ||
    mutationClass === "destructive"
  );
}

function buildNexusRunnerProfileStatus(
  profile: NexusRunnerProfileConfig,
  hosts: readonly NexusProjectHostConfig[],
): NexusRunnerProfileStatus {
  const enabledHosts = hosts.filter((host) => host.enabled);
  const hostCapabilities = hosts.map((host) => ({
    hostId: host.id,
    enabled: host.enabled,
    missingCapabilities: missingCapabilities(
      profile.requiredCapabilities,
      host.capabilityTags,
    ),
  }));
  const runnableHostIds = hostCapabilities
    .filter((host) => host.enabled && host.missingCapabilities.length === 0)
    .map((host) => host.hostId);
  const enabledCapabilitySet = new Set(
    enabledHosts.flatMap((host) => host.capabilityTags),
  );
  const missingHostCapabilities = profile.requiredCapabilities.filter(
    (capability) => !enabledCapabilitySet.has(capability),
  );

  return {
    id: profile.id,
    displayName: profile.displayName,
    enabled: profile.enabled,
    requiredCapabilities: [...profile.requiredCapabilities],
    allowedOperationClasses: [...profile.allowedOperationClasses],
    commandProfileRefs: [...profile.commandProfileRefs],
    limits: { ...profile.limits },
    artifactRetention: { ...profile.artifactRetention },
    credentialIdentity: { ...profile.credentialIdentity },
    mutationClass: profile.mutationClass,
    approvalRequired: profile.approval.required,
    approvalState: approvalState(profile.approval),
    policyGateIds: [...profile.approval.policyGateIds],
    missingHostCapabilities,
    runnableHostIds,
    hostCapabilities,
  };
}

function missingCapabilities(
  requiredCapabilities: readonly string[],
  hostCapabilities: readonly string[],
): string[] {
  const hostCapabilitySet = new Set(hostCapabilities);
  return requiredCapabilities.filter(
    (capability) => !hostCapabilitySet.has(capability),
  );
}

function approvalState(
  approval: NexusRunnerApprovalRequirementConfig,
): NexusRunnerProfileApprovalState {
  if (!approval.required) {
    return "not_required";
  }
  if (approval.approvalRef) {
    return "approved";
  }
  if (approval.policyGateIds.length > 0) {
    return "policy_gated";
  }
  return "missing_gate";
}

function operationClassRank(operationClass: NexusRunnerOperationClass): number {
  switch (operationClass) {
    case "read_only":
      return 0;
    case "verification":
      return 1;
    case "project_local_mutation":
      return 2;
    case "live_runtime":
      return 3;
    case "destructive":
      return 4;
  }
}
