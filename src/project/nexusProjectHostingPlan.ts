import type {
  NexusProjectHostingAccessStatusRecord,
  NexusProjectHostingAppInstallationStatusRecord,
  NexusProjectHostingConfig,
  NexusProjectHostingPlanAction,
  NexusProjectHostingPlanActionDisposition,
  NexusProjectHostingPlanActionKind,
  NexusProjectHostingPlanActionRepository,
  NexusProjectHostingPlanActionTarget,
  NexusProjectHostingPlanOptions,
  NexusProjectHostingPlanResult,
  NexusProjectHostingRepositoryVisibility,
  NexusProjectHostingRemoteStatusRecord,
  NexusProjectHostingStatusResult,
} from "./nexusProjectHostingTypes.js";
import {
  isLowerAsciiIdentifierSegmentCharacter,
  replaceRunsWithHyphen,
} from "../runtime/nexusTextNormalization.js";

export function planNexusProjectHosting(
  options: NexusProjectHostingPlanOptions,
): NexusProjectHostingPlanResult {
  if (!options.hosting || !options.status.configured) {
    return unconfiguredHostingPlan(options.status);
  }

  const hosting = options.hosting;
  const status = options.status;
  const repository = hostingPlanRepository(status);
  const providerMutationAuthProfile = providerMutationAuthProfileForHosting(hosting);
  const actions: NexusProjectHostingPlanAction[] = [
    ...repositoryCreatePlanActions({
      hosting,
      status,
      repository,
      providerMutationAuthProfile,
    }),
    ...localRemotePlanActions({ hosting, status, repository }),
    ...accessPlanActions({
      hosting,
      status,
      repository,
      providerMutationAuthProfile,
    }),
    ...appInstallationPlanActions({ hosting, status, repository }),
    ...repositoryDefaultBranchPlanActions({
      hosting,
      status,
      repository,
      providerMutationAuthProfile,
    }),
    ...repositoryVisibilityPlanActions({
      hosting,
      status,
      repository,
      providerMutationAuthProfile,
    }),
  ];

  return hostingPlanResult({
    provider: status.provider,
    namespace: status.namespace,
    repositoryName: status.repositoryName,
    actions,
  });
}

function unconfiguredHostingPlan(
  status: NexusProjectHostingStatusResult,
): NexusProjectHostingPlanResult {
  return hostingPlanResult({
    provider: status.provider,
    namespace: status.namespace,
    repositoryName: status.repositoryName,
    actions: [
      {
        id: "hosting:configure",
        kind: "configure_hosting",
        provider: status.provider,
        repository: null,
        target: {
          type: "hosting",
        },
        current: {
          configured: false,
        },
        desired: {
          configured: true,
        },
        mutationClass: "read_only",
        disposition: "manual",
        reason: "Project hosting must be configured before DevNexus can plan provisioning actions.",
        authProfile: null,
      },
    ],
  });
}

function repositoryCreatePlanActions(options: {
  hosting: NexusProjectHostingConfig;
  status: NexusProjectHostingStatusResult;
  repository: NexusProjectHostingPlanActionRepository | null;
  providerMutationAuthProfile: string | null;
}): NexusProjectHostingPlanAction[] {
  if (!options.repository || options.status.repository.exists !== false) {
    return [];
  }

  return [
    hostingPlanAction({
      id: "repository:create",
      kind: "create_repository",
      provider: options.hosting.provider,
      repository: options.repository,
      target: {
        type: "repository",
        name: options.repository.name,
      },
      current: {
        exists: false,
      },
      desired: {
        exists: true,
        visibility: options.hosting.repository.visibility,
        defaultBranch: options.hosting.repository.defaultBranch,
      },
      mutationClass: "repository_create",
      disposition: gateDisposition(options.hosting.provisioning.allowCreate),
      reason: options.hosting.provisioning.allowCreate
        ? "Repository creation is allowed by hosting.provisioning.allowCreate."
        : "Repository creation is blocked because hosting.provisioning.allowCreate is false.",
      authProfile: options.providerMutationAuthProfile,
    }),
  ];
}

function localRemotePlanActions(options: {
  hosting: NexusProjectHostingConfig;
  status: NexusProjectHostingStatusResult;
  repository: NexusProjectHostingPlanActionRepository | null;
}): NexusProjectHostingPlanAction[] {
  return options.status.remotes.flatMap((remote) =>
    localRemotePlanActionForStatus({ ...options, remote }),
  );
}

function localRemotePlanActionForStatus(options: {
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingPlanActionRepository | null;
  remote: NexusProjectHostingRemoteStatusRecord;
}): NexusProjectHostingPlanAction[] {
  if (options.remote.status === "missing") {
    return [
      localRemotePlanAction({
        kind: "add_local_remote",
        remote: options.remote,
        hosting: options.hosting,
        repository: options.repository,
        reasonWhenAllowed: `Local Git remote ${options.remote.name} will be added from hosting intent.`,
        reasonWhenBlocked:
          `Local Git remote ${options.remote.name} is missing, but ` +
          "hosting.provisioning.allowLocalRemoteRepair is false.",
      }),
    ];
  }

  if (options.remote.status === "mismatch") {
    return [
      localRemotePlanAction({
        kind: "update_local_remote",
        remote: options.remote,
        hosting: options.hosting,
        repository: options.repository,
        reasonWhenAllowed: `Local Git remote ${options.remote.name} will be updated to the declared URL.`,
        reasonWhenBlocked:
          `Local Git remote ${options.remote.name} does not match hosting intent, ` +
          "but hosting.provisioning.allowLocalRemoteRepair is false.",
      }),
    ];
  }

  return [];
}

function accessPlanActions(options: {
  hosting: NexusProjectHostingConfig;
  status: NexusProjectHostingStatusResult;
  repository: NexusProjectHostingPlanActionRepository | null;
  providerMutationAuthProfile: string | null;
}): NexusProjectHostingPlanAction[] {
  return options.status.access.flatMap((access) => {
    const action = accessPlanAction({ ...options, access });
    return action ? [action] : [];
  });
}

function appInstallationPlanActions(options: {
  hosting: NexusProjectHostingConfig;
  status: NexusProjectHostingStatusResult;
  repository: NexusProjectHostingPlanActionRepository | null;
}): NexusProjectHostingPlanAction[] {
  return options.status.appInstallations.flatMap((appInstallation) => {
    const action = appInstallationPlanAction({ ...options, appInstallation });
    return action ? [action] : [];
  });
}

function repositoryDefaultBranchPlanActions(options: {
  hosting: NexusProjectHostingConfig;
  status: NexusProjectHostingStatusResult;
  repository: NexusProjectHostingPlanActionRepository | null;
  providerMutationAuthProfile: string | null;
}): NexusProjectHostingPlanAction[] {
  if (
    !options.repository ||
    !options.status.repository.defaultBranch ||
    options.status.repository.defaultBranch ===
      options.hosting.repository.defaultBranch
  ) {
    return [];
  }

  return [
    hostingPlanAction({
      id: "repository:default-branch",
      kind: "repair_default_branch",
      provider: options.hosting.provider,
      repository: options.repository,
      target: {
        type: "repository",
        name: options.repository.name,
      },
      current: {
        defaultBranch: options.status.repository.defaultBranch,
      },
      desired: {
        defaultBranch: options.hosting.repository.defaultBranch,
      },
      mutationClass: "default_branch_repair",
      disposition: gateDisposition(
        options.hosting.provisioning.allowDefaultBranchRepair,
      ),
      reason: options.hosting.provisioning.allowDefaultBranchRepair
        ? "Default-branch repair is allowed by hosting.provisioning.allowDefaultBranchRepair."
        : "Default-branch repair is blocked because hosting.provisioning.allowDefaultBranchRepair is false.",
      authProfile: options.providerMutationAuthProfile,
    }),
  ];
}

function repositoryVisibilityPlanActions(options: {
  hosting: NexusProjectHostingConfig;
  status: NexusProjectHostingStatusResult;
  repository: NexusProjectHostingPlanActionRepository | null;
  providerMutationAuthProfile: string | null;
}): NexusProjectHostingPlanAction[] {
  if (
    !options.repository ||
    !options.status.repository.visibility ||
    options.status.repository.visibility === options.hosting.repository.visibility
  ) {
    return [];
  }

  const safeVisibilityChange = visibilityRepairIsSafe(
    options.status.repository.visibility,
    options.hosting.repository.visibility,
  );
  return [
    hostingPlanAction({
      id: "repository:visibility",
      kind: "repair_visibility",
      provider: options.hosting.provider,
      repository: options.repository,
      target: {
        type: "repository",
        name: options.repository.name,
      },
      current: {
        visibility: options.status.repository.visibility,
      },
      desired: {
        visibility: options.hosting.repository.visibility,
      },
      mutationClass: "visibility_repair",
      disposition:
        options.hosting.provisioning.allowVisibilityRepair &&
        safeVisibilityChange
          ? "allowed"
          : "blocked",
      reason: !options.hosting.provisioning.allowVisibilityRepair
        ? "Visibility repair is blocked because hosting.provisioning.allowVisibilityRepair is false."
        : safeVisibilityChange
          ? "Visibility repair tightens or preserves repository exposure and is allowed by policy."
          : "Visibility repair would broaden repository exposure and is declined as unsafe.",
      authProfile: options.providerMutationAuthProfile,
    }),
  ];
}

function localRemotePlanAction(options: {
  kind: Extract<
    NexusProjectHostingPlanActionKind,
    "add_local_remote" | "update_local_remote"
  >;
  remote: NexusProjectHostingRemoteStatusRecord;
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingPlanActionRepository | null;
  reasonWhenAllowed: string;
  reasonWhenBlocked: string;
}): NexusProjectHostingPlanAction {
  return hostingPlanAction({
    id: `remote:${normalizePlanIdPart(options.remote.name)}:` +
      (options.kind === "add_local_remote" ? "add" : "update"),
    kind: options.kind,
    provider: options.hosting.provider,
    repository: options.repository,
    target: {
      type: "remote",
      name: options.remote.name,
    },
    current: {
      url: options.remote.currentUrl,
    },
    desired: {
      url: options.remote.expectedUrl,
    },
    mutationClass: "local_remote_repair",
    disposition: gateDisposition(
      options.hosting.provisioning.allowLocalRemoteRepair,
    ),
    reason: options.hosting.provisioning.allowLocalRemoteRepair
      ? options.reasonWhenAllowed
      : options.reasonWhenBlocked,
    authProfile: options.remote.authProfile,
  });
}

function accessPlanAction(options: {
  access: NexusProjectHostingAccessStatusRecord;
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingPlanActionRepository | null;
  providerMutationAuthProfile: string | null;
}): NexusProjectHostingPlanAction | null {
  switch (options.access.status) {
    case "missing":
      return accessRepairPlanAction({
        ...options,
        kind: isCollaboratorPrincipal(options.access)
          ? "invite_collaborator"
          : "add_collaborator",
        current: {
          effectivePermission: null,
        },
        desired: {
          effectivePermission: options.access.requiredPermission,
        },
        reasonWhenAllowed:
          `Access for ${principalLabel(options.access)} will be granted as ` +
          `${options.access.requiredPermission}.`,
        reasonWhenBlocked:
          `Access for ${principalLabel(options.access)} is missing, but ` +
          "hosting.provisioning.allowAccessRepair is false.",
      });
    case "insufficient":
      return accessRepairPlanAction({
        ...options,
        kind: "update_collaborator_permission",
        current: {
          effectivePermission: options.access.effectivePermission,
        },
        desired: {
          effectivePermission: options.access.requiredPermission,
        },
        reasonWhenAllowed:
          `Access for ${principalLabel(options.access)} will be updated from ` +
          `${options.access.effectivePermission} to ` +
          `${options.access.requiredPermission}.`,
        reasonWhenBlocked:
          `Access for ${principalLabel(options.access)} is insufficient, but ` +
          "hosting.provisioning.allowAccessRepair is false.",
      });
    case "pending":
      return pendingInvitationPlanAction(options);
    case "unsupported":
      return unsupportedAccessPlanAction(options);
    case "satisfied":
    case "unchecked":
      return null;
  }
}

function unsupportedAccessPlanAction(options: {
  access: NexusProjectHostingAccessStatusRecord;
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingPlanActionRepository | null;
  providerMutationAuthProfile: string | null;
}): NexusProjectHostingPlanAction {
  return hostingPlanAction({
    id: `access:${principalIdPart(options.access)}:unsupported`,
    kind: "unsupported_provider_operation",
    provider: options.hosting.provider,
    repository: options.repository,
    target: principalTarget(options.access),
    current: {
      status: "unsupported",
    },
    desired: {
      effectivePermission: options.access.requiredPermission,
    },
    mutationClass: "read_only",
    disposition: "blocked",
    reason:
      `Provider ${options.hosting.provider} did not report access state ` +
      `for ${principalLabel(options.access)}.`,
    authProfile: options.providerMutationAuthProfile,
  });
}

function appInstallationPlanAction(options: {
  appInstallation: NexusProjectHostingAppInstallationStatusRecord;
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingPlanActionRepository | null;
}): NexusProjectHostingPlanAction | null {
  switch (options.appInstallation.status) {
    case "missing":
      return appInstallationManualPlanAction({
        ...options,
        kind: "install_app",
        suffix: "install",
        current: {
          installed: false,
        },
        desired: {
          installed: true,
          installationAccount: options.hosting.namespace,
        },
        reason:
          `Install App ${options.appInstallation.providerIdentity} on ` +
          `${options.hosting.namespace} before using it for automation.`,
      });
    case "repository_missing":
      return appInstallationManualPlanAction({
        ...options,
        kind: "select_app_repository",
        suffix: "select-repository",
        current: {
          repositorySelected: false,
          repositorySelection: options.appInstallation.repositorySelection,
        },
        desired: {
          repositorySelected: true,
        },
        reason:
          `Select repository ${options.repository?.name ?? "unknown"} in ` +
          `the ${options.appInstallation.providerIdentity} App installation.`,
      });
    case "permission_missing":
      return appInstallationManualPlanAction({
        ...options,
        kind: "update_app_permissions",
        suffix: "permissions",
        current: {
          permissions: options.appInstallation.permissions,
        },
        desired: {
          permissions: options.appInstallation.requiredProviderPermissions,
        },
        reason:
          `Update App ${options.appInstallation.providerIdentity} permissions: ` +
          providerPermissionSummary(options.appInstallation.missingPermissions),
      });
    case "unsupported":
      return unsupportedAppInstallationPlanAction(options);
    case "installed":
    case "unchecked":
      return null;
  }
}

function unsupportedAppInstallationPlanAction(options: {
  appInstallation: NexusProjectHostingAppInstallationStatusRecord;
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingPlanActionRepository | null;
}): NexusProjectHostingPlanAction {
  return hostingPlanAction({
    id: `app:${normalizePlanIdPart(
      options.appInstallation.providerIdentity,
    )}:unsupported`,
    kind: "unsupported_provider_operation",
    provider: options.hosting.provider,
    repository: options.repository,
    target: {
      type: "principal",
      kind: "app",
      providerIdentity: options.appInstallation.providerIdentity,
    },
    current: {
      status: "unsupported",
    },
    desired: {
      installed: true,
      repositorySelected: true,
      permissions: options.appInstallation.requiredProviderPermissions,
    },
    mutationClass: "read_only",
    disposition: "blocked",
    reason:
      `Provider ${options.hosting.provider} did not report App ` +
      `installation state for ${options.appInstallation.providerIdentity}.`,
    authProfile: options.appInstallation.authProfile,
  });
}

function appInstallationManualPlanAction(options: {
  appInstallation: NexusProjectHostingAppInstallationStatusRecord;
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingPlanActionRepository | null;
  kind: Extract<
    NexusProjectHostingPlanActionKind,
    "install_app" | "select_app_repository" | "update_app_permissions"
  >;
  suffix: string;
  current: Record<string, unknown>;
  desired: Record<string, unknown>;
  reason: string;
}): NexusProjectHostingPlanAction {
  return hostingPlanAction({
    id: `app:${normalizePlanIdPart(options.appInstallation.providerIdentity)}:` +
      options.suffix,
    kind: options.kind,
    provider: options.hosting.provider,
    repository: options.repository,
    target: {
      type: "principal",
      kind: "app",
      providerIdentity: options.appInstallation.providerIdentity,
    },
    current: options.current,
    desired: options.desired,
    mutationClass: "read_only",
    disposition: "manual",
    reason: options.reason,
    authProfile: options.appInstallation.authProfile,
  });
}

function accessRepairPlanAction(options: {
  access: NexusProjectHostingAccessStatusRecord;
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingPlanActionRepository | null;
  providerMutationAuthProfile: string | null;
  kind: Extract<
    NexusProjectHostingPlanActionKind,
    "invite_collaborator" | "add_collaborator" | "update_collaborator_permission"
  >;
  current: Record<string, unknown>;
  desired: Record<string, unknown>;
  reasonWhenAllowed: string;
  reasonWhenBlocked: string;
}): NexusProjectHostingPlanAction {
  return hostingPlanAction({
    id: `access:${principalIdPart(options.access)}:` +
      accessActionIdSuffix(options.kind),
    kind: options.kind,
    provider: options.hosting.provider,
    repository: options.repository,
    target: principalTarget(options.access),
    current: options.current,
    desired: options.desired,
    mutationClass: "access_repair",
    disposition: gateDisposition(options.hosting.provisioning.allowAccessRepair),
    reason: options.hosting.provisioning.allowAccessRepair
      ? options.reasonWhenAllowed
      : options.reasonWhenBlocked,
    authProfile: options.providerMutationAuthProfile,
  });
}

function pendingInvitationPlanAction(options: {
  access: NexusProjectHostingAccessStatusRecord;
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingPlanActionRepository | null;
  providerMutationAuthProfile: string | null;
}): NexusProjectHostingPlanAction {
  if (options.access.invitationPolicy !== "auto_accept") {
    return waitForInvitationPlanAction(options);
  }

  const allowed =
    options.hosting.provisioning.allowInvitationAcceptance &&
    Boolean(options.access.authProfile);
  return hostingPlanAction({
    id: `access:${principalIdPart(options.access)}:accept-invitation`,
    kind: "accept_invitation",
    provider: options.hosting.provider,
    repository: options.repository,
    target: principalTarget(options.access),
    current: {
      pendingInvitation: true,
      invitationId: options.access.invitationId,
    },
    desired: {
      pendingInvitation: false,
      effectivePermission: options.access.requiredPermission,
    },
    mutationClass: "invitation_acceptance",
    disposition: allowed ? "allowed" : "blocked",
    reason: !options.hosting.provisioning.allowInvitationAcceptance
      ? "Invitation acceptance is blocked because hosting.provisioning.allowInvitationAcceptance is false."
      : options.access.authProfile
        ? `Pending invitation for ${principalLabel(options.access)} can be accepted through the invitee auth profile.`
        : `Pending invitation for ${principalLabel(options.access)} cannot be accepted because no invitee auth profile is configured.`,
    authProfile: options.access.authProfile,
  });
}

function waitForInvitationPlanAction(options: {
  access: NexusProjectHostingAccessStatusRecord;
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingPlanActionRepository | null;
}): NexusProjectHostingPlanAction {
  return hostingPlanAction({
    id: `access:${principalIdPart(options.access)}:wait-invitation`,
    kind: "wait_for_invitation",
    provider: options.hosting.provider,
    repository: options.repository,
    target: principalTarget(options.access),
    current: {
      pendingInvitation: true,
      invitationId: options.access.invitationId,
    },
    desired: {
      pendingInvitation: false,
      effectivePermission: options.access.requiredPermission,
    },
    mutationClass: "read_only",
    disposition: "manual",
    reason:
      `Pending invitation for ${principalLabel(options.access)} requires ` +
      `${options.access.invitationPolicy === "manual" ? "manual acceptance" : "waiting for acceptance"}.`,
    authProfile: options.access.authProfile,
  });
}

function providerMutationAuthProfileForHosting(
  hosting: NexusProjectHostingConfig,
): string | null {
  if (hosting.provisioning.providerMutationAuthProfile) {
    return hosting.provisioning.providerMutationAuthProfile;
  }

  const automationAccess = hosting.access.find(
    (access) => access.role === "automation" && access.authProfile,
  );
  if (automationAccess?.authProfile) {
    return automationAccess.authProfile;
  }

  const automationRemote = hosting.remotes.find(
    (remote) => remote.role === "automation",
  );
  if (automationRemote) {
    return automationRemote.authProfile ?? hosting.authProfile ?? null;
  }

  return hosting.authProfile ?? null;
}

function hostingPlanRepository(
  status: NexusProjectHostingStatusResult,
): NexusProjectHostingPlanActionRepository | null {
  if (!status.namespace || !status.repositoryName) {
    return null;
  }

  return {
    namespace: status.namespace,
    name: status.repositoryName,
  };
}

function hostingPlanAction(
  action: NexusProjectHostingPlanAction,
): NexusProjectHostingPlanAction {
  return action;
}

function gateDisposition(
  allowed: boolean,
): NexusProjectHostingPlanActionDisposition {
  return allowed ? "allowed" : "blocked";
}

function principalTarget(
  access: NexusProjectHostingAccessStatusRecord,
): NexusProjectHostingPlanActionTarget {
  return {
    type: "principal",
    kind: access.kind,
    providerIdentity: access.providerIdentity,
  };
}

function principalLabel(access: NexusProjectHostingAccessStatusRecord): string {
  return `${access.kind}:${access.providerIdentity}`;
}

function principalIdPart(access: NexusProjectHostingAccessStatusRecord): string {
  return `${access.kind}:${normalizePlanIdPart(access.providerIdentity)}`;
}

function normalizePlanIdPart(value: string): string {
  return replaceRunsWithHyphen(
    value.trim().toLowerCase(),
    (character) => !isLowerAsciiIdentifierSegmentCharacter(character),
  );
}

function isCollaboratorPrincipal(
  access: NexusProjectHostingAccessStatusRecord,
): boolean {
  return access.kind === "human" || access.kind === "machine_user";
}

function accessActionIdSuffix(
  kind: Extract<
    NexusProjectHostingPlanActionKind,
    "invite_collaborator" | "add_collaborator" | "update_collaborator_permission"
  >,
): string {
  if (kind === "invite_collaborator") {
    return "invite";
  }
  if (kind === "add_collaborator") {
    return "add";
  }
  return "update";
}

function visibilityRepairIsSafe(
  current: NexusProjectHostingRepositoryVisibility,
  desired: NexusProjectHostingRepositoryVisibility,
): boolean {
  return visibilityExposureRank(desired) <= visibilityExposureRank(current);
}

function visibilityExposureRank(
  visibility: NexusProjectHostingRepositoryVisibility,
): number {
  switch (visibility) {
    case "private":
      return 1;
    case "internal":
      return 2;
    case "public":
      return 3;
  }
}

function providerPermissionSummary(permissions: Record<string, string>): string {
  return Object.entries(permissions)
    .map(([permission, level]) => `${permission}:${level}`)
    .join(", ");
}

function hostingPlanResult(options: {
  provider: NexusProjectHostingStatusResult["provider"];
  namespace: string | null;
  repositoryName: string | null;
  actions: NexusProjectHostingPlanAction[];
}): NexusProjectHostingPlanResult {
  const hasBlockedAction = options.actions.some(
    (action) => action.disposition === "blocked",
  );
  const hasManualAction = options.actions.some(
    (action) => action.disposition === "manual",
  );
  return {
    ok: !hasBlockedAction,
    status: hasBlockedAction ? "blocked" : hasManualAction ? "manual" : "passed",
    provider: options.provider,
    namespace: options.namespace,
    repositoryName: options.repositoryName,
    actions: options.actions,
  };
}
