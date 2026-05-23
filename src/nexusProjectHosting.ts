import { NexusProjectHostingError } from "./nexusProjectHostingTypes.js";
import type {
  NexusProjectHostingProviderName,
  NexusProjectHostingRepositoryVisibility,
  NexusProjectHostingRemoteProtocol,
  NexusProjectHostingRemoteRole,
  NexusProjectHostingRequiredPermission,
  NexusProjectHostingAccessPrincipalKind,
  NexusProjectHostingAccessRole,
  NexusProjectHostingInvitationPolicy,
  NexusProjectHostingRepositoryConfig,
  NexusProjectHostingRemoteConfig,
  NexusProjectHostingAccessPrincipalConfig,
  NexusProjectHostingProvisioningConfig,
  NexusProjectHostingConfig,
  NexusHostingAuthProfileKind,
  NexusHostingAuthProfileCredentialKind,
  NexusHostingAuthProfileCredentialPurpose,
  NexusHostingGitHubAppCredentialConfig,
  NexusHostingAuthProfileConfig,
  NexusProjectHostingProjectIdentity,
  NexusProjectHostingRemoteGenerationOptions,
  NexusProjectHostingExpectedRemote,
  NexusProjectHostingRepositoryRecord,
  NexusProjectHostingPermissionSet,
  NexusProjectHostingProviderRepositoryInput,
  NexusProjectHostingProviderPermissionInput,
  NexusProjectHostingProviderActorInput,
  NexusProjectHostingProviderAccessInput,
  NexusProjectHostingProviderAppInstallationInput,
  NexusProjectHostingProviderAccessRecord,
  NexusProjectHostingProviderAppInstallationRecord,
  NexusProjectHostingProviderAccessRepairOperation,
  NexusProjectHostingProviderAccessRepairInput,
  NexusProjectHostingProviderInvitationRecord,
  NexusProjectHostingProviderInvitationInput,
  NexusProjectHostingProviderAcceptInvitationInput,
  NexusProjectHostingProviderCreateRepositoryInput,
  NexusProjectHostingProviderMutationStatus,
  NexusProjectHostingProviderMutationResult,
  NexusProjectHostingProviderAdapter,
  NexusProjectHostingPreflightStatus,
  NexusProjectHostingPreflightIssue,
  NexusProjectHostingPreflightOptions,
  NexusProjectHostingPreflightResult,
  NexusProjectHostingStatusLevel,
  NexusProjectHostingRemoteStatus,
  NexusProjectHostingAuthProfileStatus,
  NexusProjectHostingAccessStatus,
  NexusProjectHostingAppInstallationStatus,
  NexusProjectHostingLocalRemoteRecord,
  NexusProjectHostingStatusOptions,
  NexusProjectHostingRepositoryStatus,
  NexusProjectHostingRemoteStatusRecord,
  NexusProjectHostingAuthProfileStatusRecord,
  NexusProjectHostingAccessStatusRecord,
  NexusProjectHostingAppInstallationStatusRecord,
  NexusProjectHostingStatusResult,
  NexusProjectHostingPlanStatus,
  NexusProjectHostingPlanActionDisposition,
  NexusProjectHostingPlanMutationClass,
  NexusProjectHostingPlanActionKind,
  NexusProjectHostingPlanActionRepository,
  NexusProjectHostingPlanActionTarget,
  NexusProjectHostingPlanAction,
  NexusProjectHostingPlanOptions,
  NexusProjectHostingPlanResult,
  NexusProjectHostingApplyStatus,
  NexusProjectHostingApplyActionDisposition,
  NexusProjectHostingLocalRemoteCommand,
  NexusProjectHostingLocalRemoteCommandResult,
  NexusProjectHostingLocalRemoteCommandRunner,
  NexusProjectHostingApplyActionResult,
  NexusProjectHostingApplyOptions,
  NexusProjectHostingApplyResult,
  NexusProjectHostingLocalRemoteApplyOptions,
  NexusProjectHostingLocalRemoteApplyResult,
} from "./nexusProjectHostingTypes.js";

export * from "./nexusProjectHostingTypes.js";
export {
  applyNexusProjectHosting,
  applyNexusProjectHostingLocalRemoteRepairs,
} from "./nexusProjectHostingApply.js";
export { planNexusProjectHosting } from "./nexusProjectHostingPlan.js";

export function deriveNexusProjectHostingRepositoryName(options: {
  project: NexusProjectHostingProjectIdentity;
  hosting: NexusProjectHostingConfig;
}): string {
  const configuredName = options.hosting.repository.name?.trim();
  if (configuredName) {
    return configuredName;
  }

  const template = options.hosting.repository.nameTemplate?.trim();
  if (!template) {
    return options.project.id;
  }

  const projectName = options.project.name ?? options.project.id;
  const variables: Record<string, string> = {
    projectId: options.project.id,
    projectName,
    projectNameSlug: slugifyProjectName(projectName) || options.project.id,
    projectSlug: slugifyProjectName(projectName) || options.project.id,
  };
  const repositoryName = template
    .replace(/\{([A-Za-z][A-Za-z0-9]*)\}/gu, (match, variableName) => {
      const value = variables[String(variableName)];
      if (value === undefined) {
        throw new NexusProjectHostingError(
          `Unknown hosting repository name template variable: ${match}`,
        );
      }
      return value;
    })
    .trim();

  if (!repositoryName) {
    throw new NexusProjectHostingError(
      "Hosting repository name template produced an empty name",
    );
  }

  return repositoryName;
}

export function expectedNexusProjectHostingRemotes(
  options: NexusProjectHostingRemoteGenerationOptions,
): NexusProjectHostingExpectedRemote[] {
  const repositoryName = deriveNexusProjectHostingRepositoryName(options);
  return options.hosting.remotes.map((remote) => {
    const authProfileId = authProfileIdForNexusProjectHostingRemote(
      options.hosting,
      remote,
    );
    const authProfile = authProfileId
      ? options.authProfiles?.find((profile) => profile.id === authProfileId)
      : undefined;

    return {
      name: remote.name,
      role: remote.role,
      protocol: remote.protocol,
      authProfile: authProfileId,
      url: nexusProjectHostingRemoteUrl({
        hosting: options.hosting,
        repositoryName,
        remote,
        authProfile,
      }),
    };
  });
}

export function authProfileIdForNexusProjectHostingRemote(
  hosting: NexusProjectHostingConfig,
  remote: NexusProjectHostingRemoteConfig,
): string | null {
  return remote.authProfile ?? hosting.authProfile ?? null;
}

export async function statusNexusProjectHosting(
  options: NexusProjectHostingStatusOptions,
): Promise<NexusProjectHostingStatusResult> {
  if (!options.provider) {
    return statusNexusProjectHostingLocal(options);
  }

  if (!options.hosting) {
    const issue: NexusProjectHostingPreflightIssue = {
      code: "hosting_not_configured",
      severity: "warning",
      message: "Project hosting is not configured.",
    };
    return hostingStatusResult({
      configured: false,
      provider: null,
      namespace: null,
      repositoryName: null,
      repository: {
        exists: null,
        visibility: null,
        defaultBranch: null,
      },
      remotes: [],
      authProfiles: [],
      access: [],
      appInstallations: [],
      issues: [issue],
    });
  }

  const hosting = options.hosting;
  const repositoryName = deriveNexusProjectHostingRepositoryName({
    project: options.project,
    hosting,
  });
  const expectedRemotes = expectedNexusProjectHostingRemotes({
    project: options.project,
    hosting,
    authProfiles: options.authProfiles,
  });
  const issues: NexusProjectHostingPreflightIssue[] = [];
  const authProfileById = new Map(
    (options.authProfiles ?? []).map((profile) => [profile.id, profile]),
  );
  const localRemoteByName = options.localRemotes
    ? new Map(options.localRemotes.map((remote) => [remote.name, remote]))
    : null;

  const remotes = expectedRemotes.map((remote) =>
    hostingRemoteStatus({
      remote,
      localRemoteByName,
      issues,
    }),
  );

  const authProfiles = await hostingAuthProfileStatus({
    hosting,
    expectedRemotes,
    authProfileById,
    provider: options.provider,
    issues,
  });

  let repository: NexusProjectHostingRepositoryStatus = {
    exists: null,
    visibility: null,
    defaultBranch: null,
  };
  let access = uncheckedHostingAccessRecords(hosting);
  let appInstallations = uncheckedHostingAppInstallationRecords(hosting);

  if (options.provider.provider !== hosting.provider) {
    issues.push({
      code: "provider_mismatch",
      severity: "blocker",
      message:
        `Hosting provider ${hosting.provider} cannot be checked with ` +
        `${options.provider.provider} adapter.`,
    });
  } else {
    const repositoryRecord = await options.provider.getRepository({
      namespace: hosting.namespace,
      repositoryName,
    });
    repository = repositoryStatus({
      hosting,
      repository: repositoryRecord,
      repositoryName,
      issues,
    });
    access = repositoryRecord
      ? await hostingAccessStatus({
          hosting,
          authProfileById,
          provider: options.provider,
          repositoryName,
          issues,
        })
      : uncheckedHostingAccessRecords(hosting);
    appInstallations = repositoryRecord
      ? await hostingAppInstallationStatus({
          hosting,
          authProfileById,
          provider: options.provider,
          repositoryName,
          issues,
        })
      : uncheckedHostingAppInstallationRecords(hosting);
  }

  return hostingStatusResult({
    configured: true,
    provider: hosting.provider,
    namespace: hosting.namespace,
    repositoryName,
    repository,
    remotes,
    authProfiles,
    access,
    appInstallations,
    issues,
  });
}

export function statusNexusProjectHostingLocal(
  options: Omit<NexusProjectHostingStatusOptions, "provider">,
): NexusProjectHostingStatusResult {
  if (!options.hosting) {
    const issue: NexusProjectHostingPreflightIssue = {
      code: "hosting_not_configured",
      severity: "warning",
      message: "Project hosting is not configured.",
    };
    return hostingStatusResult({
      configured: false,
      provider: null,
      namespace: null,
      repositoryName: null,
      repository: {
        exists: null,
        visibility: null,
        defaultBranch: null,
      },
      remotes: [],
      authProfiles: [],
      access: [],
      appInstallations: [],
      issues: [issue],
    });
  }

  const hosting = options.hosting;
  const repositoryName = deriveNexusProjectHostingRepositoryName({
    project: options.project,
    hosting,
  });
  const expectedRemotes = expectedNexusProjectHostingRemotes({
    project: options.project,
    hosting,
    authProfiles: options.authProfiles,
  });
  const issues: NexusProjectHostingPreflightIssue[] = [];
  const authProfileById = new Map(
    (options.authProfiles ?? []).map((profile) => [profile.id, profile]),
  );
  const localRemoteByName = options.localRemotes
    ? new Map(options.localRemotes.map((remote) => [remote.name, remote]))
    : null;

  const remotes = expectedRemotes.map((remote) =>
    hostingRemoteStatus({
      remote,
      localRemoteByName,
      issues,
    }),
  );
  const authProfiles = hostingAuthProfileStatusWithoutProvider({
    hosting,
    expectedRemotes,
    authProfileById,
    issues,
  });
  issues.push({
    code: "provider_unavailable",
    severity: "warning",
    message: "No hosting provider adapter was supplied for status checks.",
  });

  return hostingStatusResult({
    configured: true,
    provider: hosting.provider,
    namespace: hosting.namespace,
    repositoryName,
    repository: {
      exists: null,
      visibility: null,
      defaultBranch: null,
    },
    remotes,
    authProfiles,
    access: uncheckedHostingAccessRecords(hosting),
    appInstallations: uncheckedHostingAppInstallationRecords(hosting),
    issues,
  });
}

export async function preflightNexusProjectHosting(
  options: NexusProjectHostingPreflightOptions,
): Promise<NexusProjectHostingPreflightResult> {
  const repositoryName = deriveNexusProjectHostingRepositoryName(options);
  const expectedRemotes = expectedNexusProjectHostingRemotes(options);
  const issues: NexusProjectHostingPreflightIssue[] = [];
  const authProfileById = new Map(
    (options.authProfiles ?? []).map((profile) => [profile.id, profile]),
  );

  collectPreflightProviderIssue({ options, issues });
  collectPreflightAuthProfileIssues({
    expectedRemotes,
    authProfileById,
    issues,
  });

  if (hasPreflightProviderMismatch(issues)) {
    return preflightResult({
      options,
      repositoryName,
      repositoryExists: false,
      expectedRemotes,
      issues,
    });
  }

  const repository = await options.provider.getRepository({
    namespace: options.hosting.namespace,
    repositoryName,
  });
  if (!repository) {
    collectPreflightMissingRepositoryIssue({
      options,
      repositoryName,
      issues,
    });

    return preflightResult({
      options,
      repositoryName,
      repositoryExists: false,
      expectedRemotes,
      issues,
    });
  }

  collectPreflightRepositoryMismatchIssues({
    options,
    repository,
    issues,
  });
  await collectPreflightPermissionIssues({
    options,
    repositoryName,
    expectedRemotes,
    authProfileById,
    issues,
  });

  return preflightResult({
    options,
    repositoryName,
    repositoryExists: true,
    expectedRemotes,
    issues,
  });
}

function collectPreflightProviderIssue(options: {
  options: NexusProjectHostingPreflightOptions;
  issues: NexusProjectHostingPreflightIssue[];
}): void {
  if (options.options.provider.provider !== options.options.hosting.provider) {
    options.issues.push({
      code: "provider_mismatch",
      severity: "blocker",
      message:
        `Hosting provider ${options.options.hosting.provider} cannot be checked with ` +
        `${options.options.provider.provider} adapter.`,
    });
  }
}

function collectPreflightAuthProfileIssues(options: {
  expectedRemotes: NexusProjectHostingExpectedRemote[];
  authProfileById: Map<string, NexusHostingAuthProfileConfig>;
  issues: NexusProjectHostingPreflightIssue[];
}): void {
  for (const expectedRemote of options.expectedRemotes) {
    if (!expectedRemote.authProfile) {
      options.issues.push({
        code: "auth_profile_unset",
        severity: "blocker",
        message:
          `Remote ${expectedRemote.name} does not reference a host-local ` +
          "auth profile, so actor permissions cannot be checked.",
        remoteName: expectedRemote.name,
      });
      continue;
    }
    if (!options.authProfileById.has(expectedRemote.authProfile)) {
      options.issues.push({
        code: "auth_profile_missing",
        severity: "blocker",
        message: `Host-local auth profile is not configured: ${expectedRemote.authProfile}`,
        remoteName: expectedRemote.name,
        authProfile: expectedRemote.authProfile,
      });
    }
  }
}

function hasPreflightProviderMismatch(
  issues: NexusProjectHostingPreflightIssue[],
): boolean {
  return issues.some((issue) => issue.code === "provider_mismatch");
}

function collectPreflightMissingRepositoryIssue(options: {
  options: NexusProjectHostingPreflightOptions;
  repositoryName: string;
  issues: NexusProjectHostingPreflightIssue[];
}): void {
  options.issues.push({
    code: "repository_missing",
    severity: options.options.hosting.provisioning.allowCreate
      ? "warning"
      : "blocker",
    message: options.options.hosting.provisioning.allowCreate
      ? `Remote repository ${options.options.hosting.namespace}/${options.repositoryName} does not exist and may be created when live provisioning is allowed.`
      : `Remote repository ${options.options.hosting.namespace}/${options.repositoryName} does not exist and automatic creation is disabled.`,
  });
}

function collectPreflightRepositoryMismatchIssues(options: {
  options: NexusProjectHostingPreflightOptions;
  repository: NexusProjectHostingRepositoryRecord;
  issues: NexusProjectHostingPreflightIssue[];
}): void {
  if (
    options.repository.visibility &&
    options.repository.visibility !== options.options.hosting.repository.visibility
  ) {
    options.issues.push({
      code: "repository_visibility_mismatch",
      severity: "blocker",
      message:
        `Remote repository visibility is ${options.repository.visibility}; ` +
        `project hosting expects ${options.options.hosting.repository.visibility}.`,
    });
  }

  if (
    options.repository.defaultBranch &&
    options.repository.defaultBranch !==
      options.options.hosting.repository.defaultBranch
  ) {
    options.issues.push({
      code: "repository_default_branch_mismatch",
      severity: "blocker",
      message:
        `Remote repository default branch is ${options.repository.defaultBranch}; ` +
        `project hosting expects ${options.options.hosting.repository.defaultBranch}.`,
    });
  }
}

async function collectPreflightPermissionIssues(options: {
  options: NexusProjectHostingPreflightOptions;
  repositoryName: string;
  expectedRemotes: NexusProjectHostingExpectedRemote[];
  authProfileById: Map<string, NexusHostingAuthProfileConfig>;
  issues: NexusProjectHostingPreflightIssue[];
}): Promise<void> {
  for (const expectedRemote of options.expectedRemotes) {
    if (!expectedRemote.authProfile) {
      continue;
    }
    const authProfile = options.authProfileById.get(
      expectedRemote.authProfile,
    );
    if (!authProfile) {
      continue;
    }

    const permissions = await options.options.provider.getPermissions({
      namespace: options.options.hosting.namespace,
      repositoryName: options.repositoryName,
      remoteName: expectedRemote.name,
      remoteRole: expectedRemote.role,
      authProfile,
    });
    const requiredPermission = requiredPermissionForRemote(
      expectedRemote,
      options.options.hosting,
    );
    if (!permissionSetAllows(permissions, requiredPermission)) {
      options.issues.push({
        code: "permission_mismatch",
        severity: "blocker",
        message:
          `Remote ${expectedRemote.name} uses auth profile ` +
          `${expectedRemote.authProfile}, but that actor does not appear to ` +
          `have ${requiredPermission} access to ` +
          `${options.options.hosting.namespace}/${options.repositoryName}.`,
        remoteName: expectedRemote.name,
        authProfile: expectedRemote.authProfile,
      });
    }
  }
}

function nexusProjectHostingRemoteUrl(options: {
  hosting: NexusProjectHostingConfig;
  repositoryName: string;
  remote: NexusProjectHostingRemoteConfig;
  authProfile?: NexusHostingAuthProfileConfig;
}): string {
  if (options.hosting.provider !== "github") {
    throw new NexusProjectHostingError(
      `Unsupported hosting provider: ${options.hosting.provider}`,
    );
  }

  const host =
    options.remote.host ?? options.authProfile?.host ?? "github.com";
  if (options.remote.protocol === "https") {
    return `https://${host}/${options.hosting.namespace}/${options.repositoryName}.git`;
  }

  const sshHost =
    options.remote.sshHost ??
    options.authProfile?.sshHost ??
    options.remote.host ??
    options.authProfile?.host ??
    "github.com";
  return `git@${sshHost}:${options.hosting.namespace}/${options.repositoryName}.git`;
}

function requiredPermissionForRemote(
  remote: Pick<NexusProjectHostingExpectedRemote, "role">,
  hosting: NexusProjectHostingConfig,
): NexusProjectHostingRequiredPermission {
  if (remote.role === "automation") {
    return hosting.provisioning.allowCreate ? "admin" : "write";
  }

  return "read";
}

function permissionSetAllows(
  permissions: NexusProjectHostingPermissionSet,
  requiredPermission: NexusProjectHostingRequiredPermission,
): boolean {
  if (requiredPermission === "admin") {
    return permissions.admin;
  }
  if (requiredPermission === "maintain") {
    return permissions.maintain || permissions.admin;
  }
  if (requiredPermission === "write") {
    return permissions.write || permissions.maintain || permissions.admin;
  }

  return (
    permissions.read ||
    permissions.write ||
    permissions.maintain ||
    permissions.admin
  );
}

function hostingRemoteStatus(options: {
  remote: NexusProjectHostingExpectedRemote;
  localRemoteByName: Map<string, NexusProjectHostingLocalRemoteRecord> | null;
  issues: NexusProjectHostingPreflightIssue[];
}): NexusProjectHostingRemoteStatusRecord {
  if (!options.localRemoteByName) {
    return remoteStatusRecord(options.remote, null, "unchecked");
  }

  const localRemote = options.localRemoteByName.get(options.remote.name);
  if (!localRemote) {
    options.issues.push({
      code: "local_remote_missing",
      severity: "blocker",
      message: `Local Git remote is missing: ${options.remote.name}`,
      remoteName: options.remote.name,
      authProfile: options.remote.authProfile ?? undefined,
    });
    return remoteStatusRecord(options.remote, null, "missing");
  }

  if (localRemote.url !== options.remote.url) {
    options.issues.push({
      code: "local_remote_url_mismatch",
      severity: "blocker",
      message:
        `Local Git remote ${options.remote.name} points to ` +
        `${localRemote.url ?? "<unset>"}; expected ${options.remote.url}.`,
      remoteName: options.remote.name,
      authProfile: options.remote.authProfile ?? undefined,
    });
    return remoteStatusRecord(options.remote, localRemote.url, "mismatch");
  }

  return remoteStatusRecord(options.remote, localRemote.url, "matched");
}

function remoteStatusRecord(
  remote: NexusProjectHostingExpectedRemote,
  currentUrl: string | null,
  status: NexusProjectHostingRemoteStatus,
): NexusProjectHostingRemoteStatusRecord {
  return {
    name: remote.name,
    role: remote.role,
    protocol: remote.protocol,
    authProfile: remote.authProfile,
    expectedUrl: remote.url,
    currentUrl,
    status,
  };
}

async function hostingAuthProfileStatus(options: {
  hosting: NexusProjectHostingConfig;
  expectedRemotes: NexusProjectHostingExpectedRemote[];
  authProfileById: Map<string, NexusHostingAuthProfileConfig>;
  provider?: NexusProjectHostingProviderAdapter;
  issues: NexusProjectHostingPreflightIssue[];
}): Promise<NexusProjectHostingAuthProfileStatusRecord[]> {
  const statuses: NexusProjectHostingAuthProfileStatusRecord[] = [];
  for (const profileId of requiredHostingAuthProfileIds({
    hosting: options.hosting,
    expectedRemotes: options.expectedRemotes,
  })) {
    const authProfile = options.authProfileById.get(profileId);
    if (!authProfile) {
      options.issues.push({
        code: "auth_profile_missing",
        severity: "blocker",
        message: `Host-local auth profile is not configured: ${profileId}`,
        authProfile: profileId,
      });
      statuses.push({
        id: profileId,
        configured: false,
        kind: null,
        expectedAccount: null,
        observedAccount: null,
        status: "missing",
      });
      continue;
    }

    const observedAccount =
      options.provider?.getAuthenticatedAccount &&
      options.provider.provider === options.hosting.provider
        ? await options.provider.getAuthenticatedAccount({ authProfile })
        : null;
    const expectedAccount = authProfile.account ?? null;
    const status = authProfileStatus({
      profileId,
      expectedAccount,
      observedAccount,
      issues: options.issues,
    });
    statuses.push({
      id: profileId,
      configured: true,
      kind: authProfile.kind ?? null,
      expectedAccount,
      observedAccount,
      status,
    });
  }

  return statuses;
}

function hostingAuthProfileStatusWithoutProvider(options: {
  hosting: NexusProjectHostingConfig;
  expectedRemotes: NexusProjectHostingExpectedRemote[];
  authProfileById: Map<string, NexusHostingAuthProfileConfig>;
  issues: NexusProjectHostingPreflightIssue[];
}): NexusProjectHostingAuthProfileStatusRecord[] {
  return requiredHostingAuthProfileIds({
    hosting: options.hosting,
    expectedRemotes: options.expectedRemotes,
  }).map((profileId) => {
    const authProfile = options.authProfileById.get(profileId);
    if (!authProfile) {
      options.issues.push({
        code: "auth_profile_missing",
        severity: "blocker",
        message: `Host-local auth profile is not configured: ${profileId}`,
        authProfile: profileId,
      });
      return {
        id: profileId,
        configured: false,
        kind: null,
        expectedAccount: null,
        observedAccount: null,
        status: "missing",
      };
    }

    return {
      id: profileId,
      configured: true,
      kind: authProfile.kind ?? null,
      expectedAccount: authProfile.account ?? null,
      observedAccount: null,
      status: "unchecked",
    };
  });
}

function requiredHostingAuthProfileIds(options: {
  hosting: NexusProjectHostingConfig;
  expectedRemotes: NexusProjectHostingExpectedRemote[];
}): string[] {
  const profileIds = new Set<string>();
  for (const remote of options.expectedRemotes) {
    if (remote.authProfile) {
      profileIds.add(remote.authProfile);
    }
  }
  for (const principal of options.hosting.access) {
    if (principal.authProfile) {
      profileIds.add(principal.authProfile);
    }
  }
  if (options.hosting.provisioning.providerMutationAuthProfile) {
    profileIds.add(options.hosting.provisioning.providerMutationAuthProfile);
  }

  return [...profileIds].sort();
}

function authProfileStatus(options: {
  profileId: string;
  expectedAccount: string | null;
  observedAccount: string | null;
  issues: NexusProjectHostingPreflightIssue[];
}): NexusProjectHostingAuthProfileStatus {
  if (!options.expectedAccount || !options.observedAccount) {
    return "unchecked";
  }
  if (
    options.expectedAccount.toLowerCase() ===
    options.observedAccount.toLowerCase()
  ) {
    return "matched";
  }

  options.issues.push({
    code: "auth_profile_actor_mismatch",
    severity: "blocker",
    message:
      `Auth profile ${options.profileId} is authenticated as ` +
      `${options.observedAccount}; expected ${options.expectedAccount}.`,
    authProfile: options.profileId,
  });
  return "mismatch";
}

function repositoryStatus(options: {
  hosting: NexusProjectHostingConfig;
  repository: NexusProjectHostingRepositoryRecord | null;
  repositoryName: string;
  issues: NexusProjectHostingPreflightIssue[];
}): NexusProjectHostingRepositoryStatus {
  if (!options.repository) {
    options.issues.push({
      code: "repository_missing",
      severity: "blocker",
      message:
        `Remote repository ${options.hosting.namespace}/` +
        `${options.repositoryName} does not exist.`,
    });
    return {
      exists: false,
      visibility: null,
      defaultBranch: null,
    };
  }

  if (
    options.repository.visibility &&
    options.repository.visibility !== options.hosting.repository.visibility
  ) {
    options.issues.push({
      code: "repository_visibility_mismatch",
      severity: "blocker",
      message:
        `Remote repository visibility is ${options.repository.visibility}; ` +
        `project hosting expects ${options.hosting.repository.visibility}.`,
    });
  }
  if (
    options.repository.defaultBranch &&
    options.repository.defaultBranch !== options.hosting.repository.defaultBranch
  ) {
    options.issues.push({
      code: "repository_default_branch_mismatch",
      severity: "blocker",
      message:
        `Remote repository default branch is ${options.repository.defaultBranch}; ` +
        `project hosting expects ${options.hosting.repository.defaultBranch}.`,
    });
  }

  return {
    exists: true,
    visibility: options.repository.visibility ?? null,
    defaultBranch: options.repository.defaultBranch ?? null,
  };
}

async function hostingAccessStatus(options: {
  hosting: NexusProjectHostingConfig;
  authProfileById: Map<string, NexusHostingAuthProfileConfig>;
  provider: NexusProjectHostingProviderAdapter;
  repositoryName: string;
  issues: NexusProjectHostingPreflightIssue[];
}): Promise<NexusProjectHostingAccessStatusRecord[]> {
  const principals = nonAppAccessPrincipals(options.hosting);
  if (principals.length === 0) {
    return [];
  }

  if (!options.provider.getAccess) {
    for (const principal of principals) {
      options.issues.push({
        code: "provider_access_unsupported",
        severity: "warning",
        message:
          `Hosting provider ${options.provider.provider} does not expose ` +
          `access status for ${principal.kind}:${principal.providerIdentity}.`,
        authProfile: principal.authProfile,
        principalKind: principal.kind,
        providerIdentity: principal.providerIdentity,
      });
    }
    return principals.map((principal) =>
      uncheckedHostingAccessRecord(principal, "unsupported"),
    );
  }

  const statuses: NexusProjectHostingAccessStatusRecord[] = [];
  for (const principal of principals) {
    const authProfile = principal.authProfile
      ? options.authProfileById.get(principal.authProfile)
      : undefined;
    const access = await options.provider.getAccess({
      namespace: options.hosting.namespace,
      repositoryName: options.repositoryName,
      principal,
      authProfile,
    });
    statuses.push(
      hostingAccessStatusRecord({
        principal,
        access,
        issues: options.issues,
      }),
    );
  }

  return statuses;
}

async function hostingAppInstallationStatus(options: {
  hosting: NexusProjectHostingConfig;
  authProfileById: Map<string, NexusHostingAuthProfileConfig>;
  provider: NexusProjectHostingProviderAdapter;
  repositoryName: string;
  issues: NexusProjectHostingPreflightIssue[];
}): Promise<NexusProjectHostingAppInstallationStatusRecord[]> {
  const appPrincipals = appAccessPrincipals(options.hosting);
  if (appPrincipals.length === 0) {
    return [];
  }

  if (!options.provider.getAppInstallation) {
    for (const principal of appPrincipals) {
      options.issues.push({
        code: "provider_app_installation_unsupported",
        severity: "warning",
        message:
          `Hosting provider ${options.provider.provider} does not expose ` +
          `App installation status for ${principal.providerIdentity}.`,
        authProfile: principal.authProfile,
        principalKind: principal.kind,
        providerIdentity: principal.providerIdentity,
      });
    }
    return appPrincipals.map((principal) =>
      uncheckedHostingAppInstallationRecord(principal, "unsupported"),
    );
  }

  const statuses: NexusProjectHostingAppInstallationStatusRecord[] = [];
  for (const principal of appPrincipals) {
    const authProfile = principal.authProfile
      ? options.authProfileById.get(principal.authProfile)
      : undefined;
    const installation = await options.provider.getAppInstallation({
      namespace: options.hosting.namespace,
      repositoryName: options.repositoryName,
      principal,
      authProfile,
    });
    statuses.push(
      hostingAppInstallationStatusRecord({
        principal,
        installation,
        issues: options.issues,
      }),
    );
  }

  return statuses;
}

function hostingAccessStatusRecord(options: {
  principal: NexusProjectHostingAccessPrincipalConfig;
  access: NexusProjectHostingProviderAccessRecord;
  issues: NexusProjectHostingPreflightIssue[];
}): NexusProjectHostingAccessStatusRecord {
  const pendingInvitation = options.access.pendingInvitation ?? false;
  if (pendingInvitation) {
    const severity =
      options.principal.invitationPolicy === "require_accepted"
        ? "blocker"
        : "warning";
    options.issues.push({
      code: "access_pending_invitation",
      severity,
      message:
        `Access for ${options.principal.kind}:` +
        `${options.principal.providerIdentity} is pending invitation.`,
      authProfile: options.principal.authProfile,
      principalKind: options.principal.kind,
      providerIdentity: options.principal.providerIdentity,
    });
    return accessStatusRecord(options.principal, {
      effectivePermission: options.access.effectivePermission,
      pendingInvitation,
      invitationId: options.access.invitationId ?? null,
      status: "pending",
    });
  }

  if (!options.access.effectivePermission) {
    options.issues.push({
      code: "access_missing",
      severity: "blocker",
      message:
        `Access is missing for ${options.principal.kind}:` +
        `${options.principal.providerIdentity}.`,
      authProfile: options.principal.authProfile,
      principalKind: options.principal.kind,
      providerIdentity: options.principal.providerIdentity,
    });
    return accessStatusRecord(options.principal, {
      effectivePermission: null,
      pendingInvitation,
      invitationId: null,
      status: "missing",
    });
  }

  if (
    !permissionAllows(
      options.access.effectivePermission,
      options.principal.requiredPermission,
    )
  ) {
    options.issues.push({
      code: "access_insufficient",
      severity: "blocker",
      message:
        `Access for ${options.principal.kind}:` +
        `${options.principal.providerIdentity} is ` +
        `${options.access.effectivePermission}; expected ` +
        `${options.principal.requiredPermission}.`,
      authProfile: options.principal.authProfile,
      principalKind: options.principal.kind,
      providerIdentity: options.principal.providerIdentity,
    });
    return accessStatusRecord(options.principal, {
      effectivePermission: options.access.effectivePermission,
      pendingInvitation,
      invitationId: null,
      status: "insufficient",
    });
  }

  return accessStatusRecord(options.principal, {
    effectivePermission: options.access.effectivePermission,
    pendingInvitation,
    invitationId: null,
    status: "satisfied",
  });
}

function hostingAppInstallationStatusRecord(options: {
  principal: NexusProjectHostingAccessPrincipalConfig;
  installation: NexusProjectHostingProviderAppInstallationRecord | null;
  issues: NexusProjectHostingPreflightIssue[];
}): NexusProjectHostingAppInstallationStatusRecord {
  if (!options.installation?.installed) {
    options.issues.push({
      code: "app_installation_missing",
      severity: "blocker",
      message:
        `App installation is missing for ${options.principal.providerIdentity}; ` +
        "install the App on the hosting account before using it for automation.",
      authProfile: options.principal.authProfile,
      principalKind: options.principal.kind,
      providerIdentity: options.principal.providerIdentity,
    });
    return appInstallationStatusRecord(options.principal, {
      installationAccount: null,
      repositorySelection: null,
      repositorySelected: null,
      permissions: {},
      missingPermissions: requiredProviderPermissions(options.principal),
      status: "missing",
    });
  }

  const repositorySelected = options.installation.repositorySelected ?? null;
  if (repositorySelected === false) {
    options.issues.push({
      code: "app_repository_not_selected",
      severity: "blocker",
      message:
        `App ${options.principal.providerIdentity} is installed, but the ` +
        "component repository is not selected for the installation.",
      authProfile: options.principal.authProfile,
      principalKind: options.principal.kind,
      providerIdentity: options.principal.providerIdentity,
    });
    return appInstallationStatusRecord(options.principal, {
      installationAccount: options.installation.installationAccount ?? null,
      repositorySelection: options.installation.repositorySelection ?? null,
      repositorySelected,
      permissions: options.installation.permissions ?? {},
      missingPermissions: requiredProviderPermissions(options.principal),
      status: "repository_missing",
    });
  }

  const permissions = options.installation.permissions ?? {};
  const missingPermissions = missingProviderPermissions(
    requiredProviderPermissions(options.principal),
    permissions,
  );
  if (Object.keys(missingPermissions).length > 0) {
    options.issues.push({
      code: "app_permission_missing",
      severity: "blocker",
      message:
        `App ${options.principal.providerIdentity} is missing required ` +
        `permissions: ${providerPermissionSummary(missingPermissions)}.`,
      authProfile: options.principal.authProfile,
      principalKind: options.principal.kind,
      providerIdentity: options.principal.providerIdentity,
    });
    return appInstallationStatusRecord(options.principal, {
      installationAccount: options.installation.installationAccount ?? null,
      repositorySelection: options.installation.repositorySelection ?? null,
      repositorySelected,
      permissions,
      missingPermissions,
      status: "permission_missing",
    });
  }

  return appInstallationStatusRecord(options.principal, {
    installationAccount: options.installation.installationAccount ?? null,
    repositorySelection: options.installation.repositorySelection ?? null,
    repositorySelected,
    permissions,
    missingPermissions: {},
    status: "installed",
  });
}

function uncheckedHostingAccessRecords(
  hosting: NexusProjectHostingConfig,
): NexusProjectHostingAccessStatusRecord[] {
  return nonAppAccessPrincipals(hosting).map((principal) =>
    uncheckedHostingAccessRecord(principal, "unchecked"),
  );
}

function uncheckedHostingAccessRecord(
  principal: NexusProjectHostingAccessPrincipalConfig,
  status: Extract<NexusProjectHostingAccessStatus, "unchecked" | "unsupported">,
): NexusProjectHostingAccessStatusRecord {
  return accessStatusRecord(principal, {
    effectivePermission: null,
    pendingInvitation: null,
    invitationId: null,
    status,
  });
}

function uncheckedHostingAppInstallationRecords(
  hosting: NexusProjectHostingConfig,
): NexusProjectHostingAppInstallationStatusRecord[] {
  return appAccessPrincipals(hosting).map((principal) =>
    uncheckedHostingAppInstallationRecord(principal, "unchecked"),
  );
}

function uncheckedHostingAppInstallationRecord(
  principal: NexusProjectHostingAccessPrincipalConfig,
  status: Extract<
    NexusProjectHostingAppInstallationStatus,
    "unchecked" | "unsupported"
  >,
): NexusProjectHostingAppInstallationStatusRecord {
  return appInstallationStatusRecord(principal, {
    installationAccount: null,
    repositorySelection: null,
    repositorySelected: null,
    permissions: {},
    missingPermissions: {},
    status,
  });
}

function accessStatusRecord(
  principal: NexusProjectHostingAccessPrincipalConfig,
  status: {
    effectivePermission: NexusProjectHostingRequiredPermission | null;
    pendingInvitation: boolean | null;
    invitationId: string | null;
    status: NexusProjectHostingAccessStatus;
  },
): NexusProjectHostingAccessStatusRecord {
  return {
    kind: principal.kind,
    providerIdentity: principal.providerIdentity,
    role: principal.role,
    requiredPermission: principal.requiredPermission,
    authProfile: principal.authProfile ?? null,
    invitationPolicy: principal.invitationPolicy,
    effectivePermission: status.effectivePermission,
    pendingInvitation: status.pendingInvitation,
    invitationId: status.invitationId,
    status: status.status,
  };
}

function appInstallationStatusRecord(
  principal: NexusProjectHostingAccessPrincipalConfig,
  status: {
    installationAccount: string | null;
    repositorySelection: string | null;
    repositorySelected: boolean | null;
    permissions: Record<string, string>;
    missingPermissions: Record<string, string>;
    status: NexusProjectHostingAppInstallationStatus;
  },
): NexusProjectHostingAppInstallationStatusRecord {
  return {
    providerIdentity: principal.providerIdentity,
    role: principal.role,
    requiredPermission: principal.requiredPermission,
    requiredProviderPermissions: requiredProviderPermissions(principal),
    authProfile: principal.authProfile ?? null,
    installationAccount: status.installationAccount,
    repositorySelection: status.repositorySelection,
    repositorySelected: status.repositorySelected,
    permissions: status.permissions,
    missingPermissions: status.missingPermissions,
    status: status.status,
  };
}

function nonAppAccessPrincipals(
  hosting: NexusProjectHostingConfig,
): NexusProjectHostingAccessPrincipalConfig[] {
  return hosting.access.filter((principal) => principal.kind !== "app");
}

function appAccessPrincipals(
  hosting: NexusProjectHostingConfig,
): NexusProjectHostingAccessPrincipalConfig[] {
  return hosting.access.filter((principal) => principal.kind === "app");
}

function requiredProviderPermissions(
  principal: NexusProjectHostingAccessPrincipalConfig,
): Record<string, string> {
  return principal.requiredProviderPermissions ?? {};
}

function missingProviderPermissions(
  required: Record<string, string>,
  observed: Record<string, string>,
): Record<string, string> {
  const missing: Record<string, string> = {};
  for (const [permission, level] of Object.entries(required)) {
    const observedLevel = observed[permission];
    if (
      !observedLevel ||
      providerPermissionRank(observedLevel) < providerPermissionRank(level)
    ) {
      missing[permission] = level;
    }
  }
  return missing;
}

function providerPermissionRank(level: string): number {
  switch (level.trim().toLowerCase()) {
    case "none":
      return 0;
    case "read":
      return 1;
    case "write":
      return 2;
    case "admin":
      return 3;
    default:
      return -1;
  }
}

function providerPermissionSummary(permissions: Record<string, string>): string {
  return Object.entries(permissions)
    .map(([permission, level]) => `${permission}:${level}`)
    .join(", ");
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

function hostingStatusResult(options: {
  configured: boolean;
  provider: NexusProjectHostingProviderName | null;
  namespace: string | null;
  repositoryName: string | null;
  repository: NexusProjectHostingRepositoryStatus;
  remotes: NexusProjectHostingRemoteStatusRecord[];
  authProfiles: NexusProjectHostingAuthProfileStatusRecord[];
  access: NexusProjectHostingAccessStatusRecord[];
  appInstallations: NexusProjectHostingAppInstallationStatusRecord[];
  issues: NexusProjectHostingPreflightIssue[];
}): NexusProjectHostingStatusResult {
  const hasBlocker = options.issues.some(
    (issue) => issue.severity === "blocker",
  );
  return {
    ok: !hasBlocker,
    status: !options.configured
      ? "not_configured"
      : hasBlocker
        ? "blocked"
        : options.issues.length > 0
          ? "warning"
          : "passed",
    ...options,
  };
}

function preflightResult(options: {
  options: NexusProjectHostingPreflightOptions;
  repositoryName: string;
  repositoryExists: boolean;
  expectedRemotes: NexusProjectHostingExpectedRemote[];
  issues: NexusProjectHostingPreflightIssue[];
}): NexusProjectHostingPreflightResult {
  const hasBlocker = options.issues.some(
    (issue) => issue.severity === "blocker",
  );
  return {
    ok: !hasBlocker,
    status: hasBlocker
      ? "blocked"
      : options.issues.length > 0
        ? "warning"
        : "passed",
    provider: options.options.hosting.provider,
    namespace: options.options.hosting.namespace,
    repositoryName: options.repositoryName,
    repositoryExists: options.repositoryExists,
    expectedRemotes: options.expectedRemotes,
    issues: options.issues,
  };
}

function slugifyProjectName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
