import {
  NexusProjectHostingError,
  type NexusHostingAuthProfileConfig,
  type NexusProjectHostingAccessPrincipalConfig,
  type NexusProjectHostingApplyActionResult,
  type NexusProjectHostingApplyOptions,
  type NexusProjectHostingApplyResult,
  type NexusProjectHostingLocalRemoteApplyOptions,
  type NexusProjectHostingLocalRemoteApplyResult,
  type NexusProjectHostingLocalRemoteCommand,
  type NexusProjectHostingPlanAction,
  type NexusProjectHostingPlanActionKind,
  type NexusProjectHostingPlanActionRepository,
  type NexusProjectHostingPlanMutationClass,
  type NexusProjectHostingProviderAccessRecord,
  type NexusProjectHostingProviderAccessRepairOperation,
  type NexusProjectHostingProviderAdapter,
  type NexusProjectHostingProviderInvitationRecord,
  type NexusProjectHostingProviderMutationResult,
  type NexusProjectHostingRepositoryVisibility,
  type NexusProjectHostingRequiredPermission,
} from "./nexusProjectHostingTypes.js";
import { planNexusProjectHosting } from "./nexusProjectHostingPlan.js";

export async function applyNexusProjectHostingLocalRemoteRepairs(
  options: NexusProjectHostingLocalRemoteApplyOptions,
): Promise<NexusProjectHostingLocalRemoteApplyResult> {
  return applyNexusProjectHostingActions({
    ...options,
    applyMutationClasses: ["local_remote_repair"],
  });
}

export async function applyNexusProjectHosting(
  options: NexusProjectHostingApplyOptions,
): Promise<NexusProjectHostingApplyResult> {
  return applyNexusProjectHostingActions(options);
}

async function applyNexusProjectHostingActions(
  options: NexusProjectHostingApplyOptions & {
    applyMutationClasses?: NexusProjectHostingPlanMutationClass[];
  },
): Promise<NexusProjectHostingApplyResult> {
  const plan = planNexusProjectHosting({
    hosting: options.hosting,
    status: options.status,
  });
  const applyMutationClasses = new Set<NexusProjectHostingPlanMutationClass>(
    options.applyMutationClasses ?? [
      "repository_create",
      "local_remote_repair",
      "access_repair",
      "invitation_acceptance",
    ],
  );
  const actions = await applyAllowedPlanActions({
    options,
    planActions: plan.actions,
    applyMutationClasses,
  });
  const finalStatus = options.refreshStatus
    ? await options.refreshStatus()
    : undefined;
  const finalPlan =
    finalStatus && options.hosting
      ? planNexusProjectHosting({
          hosting: options.hosting,
          status: finalStatus,
        })
      : undefined;

  return applyResult({
    plan,
    actions,
    finalStatus,
    finalPlan,
  });
}

async function applyAllowedPlanActions(options: {
  options: NexusProjectHostingApplyOptions;
  planActions: NexusProjectHostingPlanAction[];
  applyMutationClasses: Set<NexusProjectHostingPlanMutationClass>;
}): Promise<NexusProjectHostingApplyActionResult[]> {
  const actions: NexusProjectHostingApplyActionResult[] = [];
  for (const action of options.planActions) {
    if (!options.applyMutationClasses.has(action.mutationClass)) {
      continue;
    }
    actions.push(await applyPlanAction(options.options, action));
  }
  return actions;
}

async function applyPlanAction(
  options: NexusProjectHostingApplyOptions,
  action: NexusProjectHostingPlanAction,
): Promise<NexusProjectHostingApplyActionResult> {
  if (action.disposition !== "allowed") {
    return skippedPlanAction(action);
  }

  switch (action.mutationClass) {
    case "repository_create":
      return applyRepositoryCreateAction(options, action);
    case "local_remote_repair":
      return applyLocalRemoteRepairAction(options, action);
    case "access_repair":
      return applyAccessRepairAction(options, action);
    case "invitation_acceptance":
      return applyInvitationAcceptanceAction(options, action);
    case "read_only":
    case "default_branch_repair":
    case "visibility_repair":
      return skippedPlanAction(action);
  }
}

function skippedPlanAction(
  action: NexusProjectHostingPlanAction,
): NexusProjectHostingApplyActionResult {
  return {
    actionId: action.id,
    kind: action.kind,
    mutationClass: action.mutationClass,
    disposition: "skipped",
    reason:
      `Skipped ${action.disposition} ` +
      `${mutationClassLabel(action.mutationClass)}: ${action.reason}`,
  };
}

async function applyRepositoryCreateAction(
  options: NexusProjectHostingApplyOptions,
  action: NexusProjectHostingPlanAction,
): Promise<NexusProjectHostingApplyActionResult> {
  const context = providerMutationContext({
    options,
    action,
    label: "repository create",
    requireProviderMethod: (provider) => Boolean(provider.createRepository),
    unsupportedMessage: (provider) =>
      `Skipped repository create: provider ${provider.provider} does ` +
      "not expose repository creation.",
    missingAuthProfileMessage:
      "Skipped repository create: no provider mutation auth profile is configured.",
  });
  if ("blocked" in context) {
    return context.blocked;
  }

  try {
    const providerResult = await context.provider.createRepository!({
      namespace: context.repository.namespace,
      repositoryName: context.repository.name,
      visibility: desiredRepositoryVisibility(action),
      defaultBranch: desiredDefaultBranch(action),
      authProfile: context.authProfile,
    });
    const mismatchReason = repositoryResultMismatchReason(
      providerResult.repository,
      context.repository,
    );
    return providerMutationApplyResult({
      action,
      providerResult,
      blockedMessage: "Provider blocked repository creation.",
      failedMessage: "Provider failed repository creation.",
      mismatchReason,
      alreadySatisfied: providerResult.status === "already_exists",
    });
  } catch (error) {
    return failedApplyAction(
      action,
      error,
      "Provider failed repository creation.",
    );
  }
}

async function applyAccessRepairAction(
  options: NexusProjectHostingApplyOptions,
  action: NexusProjectHostingPlanAction,
): Promise<NexusProjectHostingApplyActionResult> {
  const context = providerMutationContext({
    options,
    action,
    label: "access repair",
    requireProviderMethod: (provider) => Boolean(provider.repairAccess),
    unsupportedMessage: (provider) =>
      `Skipped access repair: provider ${provider.provider} does ` +
      "not expose access repair.",
    missingAuthProfileMessage:
      "Skipped access repair: no provider mutation auth profile is configured.",
  });
  if ("blocked" in context) {
    return context.blocked;
  }

  const principal = accessPrincipalForAction(options.hosting!, action);
  if (!principal) {
    return blockedApplyAction(
      action,
      "Skipped access repair: declared target principal is unavailable.",
    );
  }
  const requiredPermission = desiredAccessPermission(action);

  try {
    const providerResult = await context.provider.repairAccess!({
      namespace: context.repository.namespace,
      repositoryName: context.repository.name,
      principal,
      requiredPermission,
      operation: accessRepairOperation(action),
      mutationAuthProfile: context.authProfile,
    });
    return providerMutationApplyResult({
      action,
      providerResult,
      blockedMessage: "Provider blocked access repair.",
      failedMessage: "Provider failed access repair.",
      mismatchReason: accessResultMismatchReason(
        providerResult.access,
        requiredPermission,
      ),
      alreadySatisfied: providerAccessRepairWasAlreadySatisfied(providerResult),
    });
  } catch (error) {
    return failedApplyAction(action, error, "Provider failed access repair.");
  }
}

async function applyInvitationAcceptanceAction(
  options: NexusProjectHostingApplyOptions,
  action: NexusProjectHostingPlanAction,
): Promise<NexusProjectHostingApplyActionResult> {
  const context = providerMutationContext({
    options,
    action,
    label: "invitation acceptance",
    requireProviderMethod: (provider) => Boolean(provider.acceptInvitation),
    unsupportedMessage: (provider) =>
      `Skipped invitation acceptance: provider ${provider.provider} ` +
      "does not expose invitation acceptance.",
    missingAuthProfileMessage:
      "Skipped invitation acceptance: no invitee auth profile is configured.",
  });
  if ("blocked" in context) {
    return context.blocked;
  }

  const principal = accessPrincipalForAction(options.hosting!, action);
  if (!principal) {
    return blockedApplyAction(
      action,
      "Skipped invitation acceptance: declared target principal is unavailable.",
    );
  }

  const invitationId = await invitationIdForAcceptance({
    action,
    authProfile: context.authProfile,
    principal,
    provider: context.provider,
    repository: context.repository,
  });
  if (!invitationId) {
    return blockedApplyAction(
      action,
      `Skipped invitation acceptance: pending invitation was not found for ${principalLabelFromConfig(principal)}.`,
    );
  }

  try {
    const providerResult = await context.provider.acceptInvitation!({
      namespace: context.repository.namespace,
      repositoryName: context.repository.name,
      principal,
      invitationId,
      authProfile: context.authProfile,
    });
    return providerMutationApplyResult({
      action,
      providerResult,
      blockedMessage: "Provider blocked invitation acceptance.",
      failedMessage: "Provider failed invitation acceptance.",
      mismatchReason: null,
      alreadySatisfied: providerAccessRepairWasAlreadySatisfied(providerResult),
    });
  } catch (error) {
    return failedApplyAction(
      action,
      error,
      "Provider failed invitation acceptance.",
    );
  }
}

function providerMutationContext(options: {
  options: NexusProjectHostingApplyOptions;
  action: NexusProjectHostingPlanAction;
  label: string;
  requireProviderMethod: (provider: NexusProjectHostingProviderAdapter) => boolean;
  unsupportedMessage: (provider: NexusProjectHostingProviderAdapter) => string;
  missingAuthProfileMessage: string;
}):
  | {
      repository: NexusProjectHostingPlanActionRepository;
      provider: NexusProjectHostingProviderAdapter;
      authProfile: NexusHostingAuthProfileConfig;
    }
  | { blocked: NexusProjectHostingApplyActionResult } {
  const repository = options.action.repository;
  if (!repository || !options.options.hosting) {
    return {
      blocked: blockedApplyAction(
        options.action,
        `Skipped ${options.label}: hosting repository intent is unavailable.`,
      ),
    };
  }
  const providerCheck = providerForMutation({
    options: options.options,
    action: options.action,
    label: options.label,
    requireProviderMethod: options.requireProviderMethod,
    unsupportedMessage: options.unsupportedMessage,
  });
  if ("blocked" in providerCheck) {
    return providerCheck;
  }
  const authProfileCheck = authProfileForMutation({
    options: options.options,
    action: options.action,
    label: options.label,
    missingAuthProfileMessage: options.missingAuthProfileMessage,
  });
  if ("blocked" in authProfileCheck) {
    return authProfileCheck;
  }

  return {
    repository,
    provider: providerCheck.provider,
    authProfile: authProfileCheck.authProfile,
  };
}

function providerForMutation(options: {
  options: NexusProjectHostingApplyOptions;
  action: NexusProjectHostingPlanAction;
  label: string;
  requireProviderMethod: (provider: NexusProjectHostingProviderAdapter) => boolean;
  unsupportedMessage: (provider: NexusProjectHostingProviderAdapter) => string;
}):
  | { provider: NexusProjectHostingProviderAdapter }
  | { blocked: NexusProjectHostingApplyActionResult } {
  if (!options.options.provider) {
    return {
      blocked: blockedApplyAction(
        options.action,
        `Skipped ${options.label}: no hosting provider adapter was supplied.`,
      ),
    };
  }
  if (options.options.provider.provider !== options.options.hosting?.provider) {
    return {
      blocked: blockedApplyAction(
        options.action,
        `Skipped ${options.label}: hosting provider ${options.options.hosting?.provider} ` +
          `cannot be mutated with ${options.options.provider.provider} adapter.`,
      ),
    };
  }
  if (!options.requireProviderMethod(options.options.provider)) {
    return {
      blocked: blockedApplyAction(
        options.action,
        options.unsupportedMessage(options.options.provider),
      ),
    };
  }

  return { provider: options.options.provider };
}

function authProfileForMutation(options: {
  options: NexusProjectHostingApplyOptions;
  action: NexusProjectHostingPlanAction;
  label: string;
  missingAuthProfileMessage: string;
}):
  | { authProfile: NexusHostingAuthProfileConfig }
  | { blocked: NexusProjectHostingApplyActionResult } {
  if (!options.action.authProfile) {
    return {
      blocked: blockedApplyAction(options.action, options.missingAuthProfileMessage),
    };
  }

  const authProfile = options.options.authProfiles?.find(
    (profile) => profile.id === options.action.authProfile,
  );
  if (!authProfile) {
    return {
      blocked: blockedApplyAction(
        options.action,
        `Skipped ${options.label}: host-local auth profile is missing: ${options.action.authProfile}.`,
      ),
    };
  }

  const authProfileStatus = options.options.status.authProfiles.find(
    (status) => status.id === options.action.authProfile,
  );
  if (authProfileStatus?.status === "mismatch") {
    return {
      blocked: blockedApplyAction(
        options.action,
        `Skipped ${options.label}: auth profile ${options.action.authProfile} is ` +
          `authenticated as ${authProfileStatus.observedAccount ?? "unknown"}; ` +
          `expected ${authProfileStatus.expectedAccount ?? "unknown"}.`,
      ),
    };
  }
  if (authProfileStatus?.status === "missing") {
    return {
      blocked: blockedApplyAction(
        options.action,
        `Skipped ${options.label}: host-local auth profile is missing: ${options.action.authProfile}.`,
      ),
    };
  }

  return { authProfile };
}

function providerMutationApplyResult(options: {
  action: NexusProjectHostingPlanAction;
  providerResult: NexusProjectHostingProviderMutationResult;
  blockedMessage: string;
  failedMessage: string;
  mismatchReason: string | null;
  alreadySatisfied: boolean;
}): NexusProjectHostingApplyActionResult {
  if (options.providerResult.status === "blocked") {
    return providerResultApplyAction({
      ...options,
      disposition: "blocked",
      fallbackReason: options.blockedMessage,
    });
  }
  if (options.providerResult.status === "failed") {
    return providerResultApplyAction({
      ...options,
      disposition: "failed",
      fallbackReason: options.failedMessage,
    });
  }
  if (options.mismatchReason) {
    return providerResultApplyAction({
      ...options,
      disposition: "failed",
      fallbackReason: options.mismatchReason,
    });
  }

  return providerResultApplyAction({
    ...options,
    disposition: options.alreadySatisfied ? "skipped" : "applied",
    fallbackReason: options.action.reason,
  });
}

function providerResultApplyAction(options: {
  action: NexusProjectHostingPlanAction;
  providerResult: NexusProjectHostingProviderMutationResult;
  disposition: NexusProjectHostingApplyActionResult["disposition"];
  fallbackReason: string;
}): NexusProjectHostingApplyActionResult {
  return {
    actionId: options.action.id,
    kind: options.action.kind,
    mutationClass: options.action.mutationClass,
    disposition: options.disposition,
    reason: options.providerResult.message ?? options.fallbackReason,
    providerResult: options.providerResult,
  };
}

async function applyLocalRemoteRepairAction(
  options: NexusProjectHostingApplyOptions,
  action: NexusProjectHostingPlanAction,
): Promise<NexusProjectHostingApplyActionResult> {
  if (!options.runLocalRemoteCommand) {
    return blockedApplyAction(
      action,
      "Skipped local remote repair: no Git remote command runner was supplied.",
    );
  }

  const command = localRemoteRepairCommand(action);
  const commandResult = await options.runLocalRemoteCommand(command);
  const commandFailed = commandResult.exitCode !== 0;
  return {
    actionId: action.id,
    kind: action.kind,
    mutationClass: action.mutationClass,
    disposition: commandFailed ? "failed" : "applied",
    reason: commandFailed
      ? `Git remote command failed with exit code ${commandResult.exitCode ?? "null"}.`
      : action.reason,
    command: commandResult,
  };
}

function blockedApplyAction(
  action: NexusProjectHostingPlanAction,
  reason: string,
): NexusProjectHostingApplyActionResult {
  return {
    actionId: action.id,
    kind: action.kind,
    mutationClass: action.mutationClass,
    disposition: "blocked",
    reason,
  };
}

function failedApplyAction(
  action: NexusProjectHostingPlanAction,
  error: unknown,
  fallbackReason: string,
): NexusProjectHostingApplyActionResult {
  return {
    actionId: action.id,
    kind: action.kind,
    mutationClass: action.mutationClass,
    disposition: "failed",
    reason: error instanceof Error ? error.message : fallbackReason,
  };
}

function desiredRepositoryVisibility(
  action: NexusProjectHostingPlanAction,
): NexusProjectHostingRepositoryVisibility {
  const visibility = action.desired.visibility;
  if (
    visibility === "public" ||
    visibility === "private" ||
    visibility === "internal"
  ) {
    return visibility;
  }
  throw new NexusProjectHostingError(
    `Repository create action is missing desired visibility: ${action.id}`,
  );
}

function desiredDefaultBranch(action: NexusProjectHostingPlanAction): string {
  const defaultBranch = action.desired.defaultBranch;
  if (typeof defaultBranch === "string" && defaultBranch.trim().length > 0) {
    return defaultBranch;
  }
  throw new NexusProjectHostingError(
    `Repository create action is missing desired default branch: ${action.id}`,
  );
}

function repositoryResultMismatchReason(
  resultRepository: NexusProjectHostingProviderMutationResult["repository"],
  expectedRepository: NexusProjectHostingPlanActionRepository,
): string | null {
  if (!resultRepository) {
    return null;
  }
  if (
    resultRepository.namespace !== expectedRepository.namespace ||
    resultRepository.name !== expectedRepository.name
  ) {
    return (
      "Provider returned repository " +
      `${resultRepository.namespace}/${resultRepository.name}; expected ` +
      `${expectedRepository.namespace}/${expectedRepository.name}.`
    );
  }

  return null;
}

function accessPrincipalForAction(
  hosting: NonNullable<NexusProjectHostingApplyOptions["hosting"]>,
  action: NexusProjectHostingPlanAction,
): NexusProjectHostingAccessPrincipalConfig | null {
  const targetKind = action.target.kind;
  const targetIdentity = action.target.providerIdentity;
  if (!targetKind || !targetIdentity) {
    return null;
  }

  return (
    hosting.access.find(
      (principal) =>
        principal.kind === targetKind &&
        principal.providerIdentity === targetIdentity,
    ) ?? null
  );
}

function desiredAccessPermission(
  action: NexusProjectHostingPlanAction,
): NexusProjectHostingRequiredPermission {
  const permission = action.desired.effectivePermission;
  if (isRequiredPermission(permission)) {
    return permission;
  }
  throw new NexusProjectHostingError(
    `Access repair action is missing desired permission: ${action.id}`,
  );
}

function isRequiredPermission(
  value: unknown,
): value is NexusProjectHostingRequiredPermission {
  return (
    value === "read" ||
    value === "write" ||
    value === "maintain" ||
    value === "admin"
  );
}

function accessRepairOperation(
  action: NexusProjectHostingPlanAction,
): NexusProjectHostingProviderAccessRepairOperation {
  switch (action.kind) {
    case "invite_collaborator":
      return "invite";
    case "add_collaborator":
      return "add";
    case "update_collaborator_permission":
      return "update";
    default:
      throw new NexusProjectHostingError(
        `Unsupported access repair action: ${action.kind}`,
      );
  }
}

function accessResultMismatchReason(
  access: NexusProjectHostingProviderAccessRecord | null | undefined,
  requiredPermission: NexusProjectHostingRequiredPermission,
): string | null {
  if (!access || access.pendingInvitation || !access.effectivePermission) {
    return null;
  }

  if (!permissionAllows(access.effectivePermission, requiredPermission)) {
    return (
      `Provider reported ${access.effectivePermission} access after repair; ` +
      `expected ${requiredPermission}.`
    );
  }

  return null;
}

function providerAccessRepairWasAlreadySatisfied(
  result: NexusProjectHostingProviderMutationResult,
): boolean {
  return (
    result.status === "already_satisfied" || result.status === "already_exists"
  );
}

async function invitationIdForAcceptance(options: {
  action: NexusProjectHostingPlanAction;
  authProfile: NexusHostingAuthProfileConfig;
  principal: NexusProjectHostingAccessPrincipalConfig;
  provider: NexusProjectHostingProviderAdapter;
  repository: NexusProjectHostingPlanActionRepository;
}): Promise<string | null> {
  const actionInvitationId = options.action.current.invitationId;
  if (
    typeof actionInvitationId === "string" &&
    actionInvitationId.trim().length > 0
  ) {
    return actionInvitationId;
  }

  if (!options.provider.listInvitations) {
    return null;
  }

  const invitations = await options.provider.listInvitations({
    namespace: options.repository.namespace,
    repositoryName: options.repository.name,
    principal: options.principal,
    authProfile: options.authProfile,
  });
  return (
    invitations.find((invitation) =>
      invitationMatchesRepository(invitation, options.repository),
    )?.id ?? null
  );
}

function invitationMatchesRepository(
  invitation: NexusProjectHostingProviderInvitationRecord,
  repository: NexusProjectHostingPlanActionRepository,
): boolean {
  return (
    invitation.namespace === repository.namespace &&
    invitation.repositoryName === repository.name
  );
}

function localRemoteRepairCommand(
  action: NexusProjectHostingPlanAction,
): NexusProjectHostingLocalRemoteCommand {
  const remoteName = action.target.name;
  const url = action.desired.url;
  if (
    action.kind !== "add_local_remote" &&
    action.kind !== "update_local_remote"
  ) {
    throw new NexusProjectHostingError(
      `Unsupported local remote repair action: ${action.kind}`,
    );
  }
  if (!remoteName) {
    throw new NexusProjectHostingError(
      `Local remote repair action is missing a target remote name: ${action.id}`,
    );
  }
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new NexusProjectHostingError(
      `Local remote repair action is missing a desired URL: ${action.id}`,
    );
  }

  if (action.kind === "add_local_remote") {
    return {
      kind: "add",
      remoteName,
      url,
      args: ["remote", "add", remoteName, url],
    };
  }

  return {
    kind: "set_url",
    remoteName,
    url,
    args: ["remote", "set-url", remoteName, url],
  };
}

function mutationClassLabel(
  mutationClass: NexusProjectHostingPlanMutationClass,
): string {
  switch (mutationClass) {
    case "read_only":
      return "read-only action";
    case "repository_create":
      return "repository creation";
    case "local_remote_repair":
      return "local remote repair";
    case "access_repair":
      return "access repair";
    case "invitation_acceptance":
      return "invitation acceptance";
    case "default_branch_repair":
      return "default-branch repair";
    case "visibility_repair":
      return "visibility repair";
  }
}

function principalLabelFromConfig(
  principal: NexusProjectHostingAccessPrincipalConfig,
): string {
  return `${principal.kind}:${principal.providerIdentity}`;
}

function permissionAllows(
  effectivePermission: NexusProjectHostingRequiredPermission,
  requiredPermission: NexusProjectHostingRequiredPermission,
): boolean {
  return (
    permissionRank(effectivePermission) >= permissionRank(requiredPermission)
  );
}

function permissionRank(permission: NexusProjectHostingRequiredPermission): number {
  switch (permission) {
    case "read":
      return 1;
    case "write":
      return 2;
    case "maintain":
      return 3;
    case "admin":
      return 4;
  }
}

function applyResult(options: {
  plan: NexusProjectHostingApplyResult["plan"];
  actions: NexusProjectHostingApplyActionResult[];
  finalStatus?: NexusProjectHostingApplyResult["finalStatus"];
  finalPlan?: NexusProjectHostingApplyResult["finalPlan"];
}): NexusProjectHostingApplyResult {
  const hasFailure = options.actions.some(
    (action) => action.disposition === "failed",
  );
  const hasBlocked = options.actions.some(
    (action) => action.disposition === "blocked",
  );
  const hasBlockedSkip = options.actions.some(
    (action) =>
      action.disposition === "skipped" &&
      action.reason.startsWith("Skipped blocked"),
  );

  return {
    ok: !hasFailure && !hasBlocked && !hasBlockedSkip,
    status: hasFailure
      ? "failed"
      : hasBlocked || hasBlockedSkip
        ? "blocked"
        : "passed",
    plan: options.plan,
    actions: options.actions,
    ...(options.finalStatus ? { finalStatus: options.finalStatus } : {}),
    ...(options.finalPlan ? { finalPlan: options.finalPlan } : {}),
  };
}
