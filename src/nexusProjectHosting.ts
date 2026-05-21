export type NexusProjectHostingProviderName = "github";

export type NexusProjectHostingRepositoryVisibility =
  | "public"
  | "private"
  | "internal";

export type NexusProjectHostingRemoteProtocol = "ssh" | "https";

export type NexusProjectHostingRemoteRole =
  | "human"
  | "automation"
  | "other";

export type NexusProjectHostingRequiredPermission =
  | "read"
  | "write"
  | "maintain"
  | "admin";

export type NexusProjectHostingAccessPrincipalKind =
  | "human"
  | "machine_user"
  | "team"
  | "deploy_key"
  | "app";

export type NexusProjectHostingAccessRole =
  | "human"
  | "automation"
  | "reviewer"
  | "observer"
  | "other";

export type NexusProjectHostingInvitationPolicy =
  | "require_accepted"
  | "allow_pending"
  | "auto_accept"
  | "manual";

export interface NexusProjectHostingRepositoryConfig {
  name?: string;
  nameTemplate?: string;
  visibility: NexusProjectHostingRepositoryVisibility;
  defaultBranch: string;
}

export interface NexusProjectHostingRemoteConfig {
  name: string;
  role: NexusProjectHostingRemoteRole;
  protocol: NexusProjectHostingRemoteProtocol;
  authProfile?: string;
  host?: string;
  sshHost?: string;
}

export interface NexusProjectHostingAccessPrincipalConfig {
  kind: NexusProjectHostingAccessPrincipalKind;
  providerIdentity: string;
  role: NexusProjectHostingAccessRole;
  requiredPermission: NexusProjectHostingRequiredPermission;
  requiredProviderPermissions?: Record<string, string>;
  authProfile?: string;
  invitationPolicy: NexusProjectHostingInvitationPolicy;
}

export interface NexusProjectHostingProvisioningConfig {
  allowCreate: boolean;
  allowLocalRemoteRepair: boolean;
  allowAccessRepair: boolean;
  allowInvitationAcceptance: boolean;
  allowDefaultBranchRepair: boolean;
  allowVisibilityRepair: boolean;
  providerMutationAuthProfile?: string;
}

export interface NexusProjectHostingConfig {
  provider: NexusProjectHostingProviderName;
  namespace: string;
  repository: NexusProjectHostingRepositoryConfig;
  authProfile?: string;
  remotes: NexusProjectHostingRemoteConfig[];
  access: NexusProjectHostingAccessPrincipalConfig[];
  provisioning: NexusProjectHostingProvisioningConfig;
}

export type NexusHostingAuthProfileKind = "human" | "automation" | "app";

export type NexusHostingAuthProfileCredentialKind =
  | "environment_token"
  | "provider_cli"
  | "git_credential"
  | "command_token"
  | "github_app"
  | "unknown";

export type NexusHostingAuthProfileCredentialPurpose = "api" | "git" | "cli";

export interface NexusHostingGitHubAppCredentialConfig {
  appId?: string;
  clientId?: string;
  slug?: string;
  privateKeyPath: string;
  installationAccount?: string;
  repositories?: string[];
  apiBaseUrl?: string;
  tokenRefreshBufferSeconds?: number;
}

export interface NexusHostingAuthProfileConfig {
  id: string;
  actorId?: string;
  provider: string;
  kind?: NexusHostingAuthProfileKind;
  credentialKind?: NexusHostingAuthProfileCredentialKind;
  account?: string;
  host?: string;
  sshHost?: string;
  githubCliConfigDir?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  command?: string;
  commandArgs?: string[];
  environmentKeys?: string[];
  purposes?: NexusHostingAuthProfileCredentialPurpose[];
  githubApp?: NexusHostingGitHubAppCredentialConfig;
}

export interface NexusProjectHostingProjectIdentity {
  id: string;
  name?: string;
}

export interface NexusProjectHostingRemoteGenerationOptions {
  project: NexusProjectHostingProjectIdentity;
  hosting: NexusProjectHostingConfig;
  authProfiles?: NexusHostingAuthProfileConfig[];
}

export interface NexusProjectHostingExpectedRemote {
  name: string;
  role: NexusProjectHostingRemoteRole;
  protocol: NexusProjectHostingRemoteProtocol;
  authProfile: string | null;
  url: string;
}

export interface NexusProjectHostingRepositoryRecord {
  namespace: string;
  name: string;
  visibility?: NexusProjectHostingRepositoryVisibility | null;
  defaultBranch?: string | null;
}

export interface NexusProjectHostingPermissionSet {
  read: boolean;
  write: boolean;
  maintain: boolean;
  admin: boolean;
}

export interface NexusProjectHostingProviderRepositoryInput {
  namespace: string;
  repositoryName: string;
}

export interface NexusProjectHostingProviderPermissionInput
  extends NexusProjectHostingProviderRepositoryInput {
  remoteName: string;
  remoteRole: NexusProjectHostingRemoteRole;
  authProfile: NexusHostingAuthProfileConfig;
}

export interface NexusProjectHostingProviderActorInput {
  authProfile: NexusHostingAuthProfileConfig;
}

export interface NexusProjectHostingProviderAccessInput
  extends NexusProjectHostingProviderRepositoryInput {
  principal: NexusProjectHostingAccessPrincipalConfig;
  authProfile?: NexusHostingAuthProfileConfig;
}

export interface NexusProjectHostingProviderAppInstallationInput
  extends NexusProjectHostingProviderRepositoryInput {
  principal: NexusProjectHostingAccessPrincipalConfig;
  authProfile?: NexusHostingAuthProfileConfig;
}

export interface NexusProjectHostingProviderAccessRecord {
  effectivePermission: NexusProjectHostingRequiredPermission | null;
  pendingInvitation?: boolean;
  invitationId?: string | null;
}

export interface NexusProjectHostingProviderAppInstallationRecord {
  installed: boolean;
  installationAccount?: string | null;
  repositorySelection?: "all" | "selected" | string | null;
  repositorySelected?: boolean | null;
  permissions?: Record<string, string>;
}

export type NexusProjectHostingProviderAccessRepairOperation =
  | "invite"
  | "add"
  | "update";

export interface NexusProjectHostingProviderAccessRepairInput
  extends NexusProjectHostingProviderRepositoryInput {
  principal: NexusProjectHostingAccessPrincipalConfig;
  requiredPermission: NexusProjectHostingRequiredPermission;
  operation: NexusProjectHostingProviderAccessRepairOperation;
  mutationAuthProfile: NexusHostingAuthProfileConfig;
}

export interface NexusProjectHostingProviderInvitationRecord {
  id: string;
  namespace: string;
  repositoryName: string;
  permission?: NexusProjectHostingRequiredPermission | null;
}

export interface NexusProjectHostingProviderInvitationInput
  extends NexusProjectHostingProviderRepositoryInput {
  principal: NexusProjectHostingAccessPrincipalConfig;
  authProfile: NexusHostingAuthProfileConfig;
}

export interface NexusProjectHostingProviderAcceptInvitationInput
  extends NexusProjectHostingProviderInvitationInput {
  invitationId: string;
}

export interface NexusProjectHostingProviderCreateRepositoryInput
  extends NexusProjectHostingProviderRepositoryInput {
  visibility: NexusProjectHostingRepositoryVisibility;
  defaultBranch: string;
  authProfile: NexusHostingAuthProfileConfig;
}

export type NexusProjectHostingProviderMutationStatus =
  | "created"
  | "invited"
  | "updated"
  | "accepted"
  | "already_exists"
  | "already_satisfied"
  | "blocked"
  | "failed";

export interface NexusProjectHostingProviderMutationResult {
  status: NexusProjectHostingProviderMutationStatus;
  code?: string;
  message?: string;
  repository?: NexusProjectHostingRepositoryRecord | null;
  access?: NexusProjectHostingProviderAccessRecord | null;
  webUrl?: string | null;
  remoteUrl?: string | null;
}

export interface NexusProjectHostingProviderAdapter {
  provider: NexusProjectHostingProviderName;
  getRepository(
    input: NexusProjectHostingProviderRepositoryInput,
  ): Promise<NexusProjectHostingRepositoryRecord | null>;
  getPermissions(
    input: NexusProjectHostingProviderPermissionInput,
  ): Promise<NexusProjectHostingPermissionSet>;
  getAuthenticatedAccount?(
    input: NexusProjectHostingProviderActorInput,
  ): Promise<string | null>;
  getAccess?(
    input: NexusProjectHostingProviderAccessInput,
  ): Promise<NexusProjectHostingProviderAccessRecord>;
  getAppInstallation?(
    input: NexusProjectHostingProviderAppInstallationInput,
  ): Promise<NexusProjectHostingProviderAppInstallationRecord | null>;
  createRepository?(
    input: NexusProjectHostingProviderCreateRepositoryInput,
  ): Promise<NexusProjectHostingProviderMutationResult>;
  repairAccess?(
    input: NexusProjectHostingProviderAccessRepairInput,
  ): Promise<NexusProjectHostingProviderMutationResult>;
  listInvitations?(
    input: NexusProjectHostingProviderInvitationInput,
  ): Promise<NexusProjectHostingProviderInvitationRecord[]>;
  acceptInvitation?(
    input: NexusProjectHostingProviderAcceptInvitationInput,
  ): Promise<NexusProjectHostingProviderMutationResult>;
}

export type NexusProjectHostingPreflightStatus =
  | "passed"
  | "warning"
  | "blocked";

export interface NexusProjectHostingPreflightIssue {
  code: string;
  severity: "warning" | "blocker";
  message: string;
  remoteName?: string;
  authProfile?: string;
  providerIdentity?: string;
  principalKind?: NexusProjectHostingAccessPrincipalKind;
}

export interface NexusProjectHostingPreflightOptions {
  project: NexusProjectHostingProjectIdentity;
  hosting: NexusProjectHostingConfig;
  authProfiles?: NexusHostingAuthProfileConfig[];
  provider: NexusProjectHostingProviderAdapter;
}

export interface NexusProjectHostingPreflightResult {
  ok: boolean;
  status: NexusProjectHostingPreflightStatus;
  provider: NexusProjectHostingProviderName;
  namespace: string;
  repositoryName: string;
  repositoryExists: boolean;
  expectedRemotes: NexusProjectHostingExpectedRemote[];
  issues: NexusProjectHostingPreflightIssue[];
}

export type NexusProjectHostingStatusLevel =
  | "not_configured"
  | "passed"
  | "warning"
  | "blocked";

export type NexusProjectHostingRemoteStatus =
  | "matched"
  | "missing"
  | "mismatch"
  | "unchecked";

export type NexusProjectHostingAuthProfileStatus =
  | "matched"
  | "missing"
  | "mismatch"
  | "unchecked";

export type NexusProjectHostingAccessStatus =
  | "satisfied"
  | "missing"
  | "insufficient"
  | "pending"
  | "unsupported"
  | "unchecked";

export type NexusProjectHostingAppInstallationStatus =
  | "installed"
  | "missing"
  | "repository_missing"
  | "permission_missing"
  | "unsupported"
  | "unchecked";

export interface NexusProjectHostingLocalRemoteRecord {
  name: string;
  url: string | null;
}

export interface NexusProjectHostingStatusOptions {
  project: NexusProjectHostingProjectIdentity;
  hosting?: NexusProjectHostingConfig;
  authProfiles?: NexusHostingAuthProfileConfig[];
  provider?: NexusProjectHostingProviderAdapter;
  localRemotes?: NexusProjectHostingLocalRemoteRecord[];
}

export interface NexusProjectHostingRepositoryStatus {
  exists: boolean | null;
  visibility: NexusProjectHostingRepositoryVisibility | null;
  defaultBranch: string | null;
}

export interface NexusProjectHostingRemoteStatusRecord {
  name: string;
  role: NexusProjectHostingRemoteRole;
  protocol: NexusProjectHostingRemoteProtocol;
  authProfile: string | null;
  expectedUrl: string;
  currentUrl: string | null;
  status: NexusProjectHostingRemoteStatus;
}

export interface NexusProjectHostingAuthProfileStatusRecord {
  id: string;
  configured: boolean;
  kind: NexusHostingAuthProfileKind | null;
  expectedAccount: string | null;
  observedAccount: string | null;
  status: NexusProjectHostingAuthProfileStatus;
}

export interface NexusProjectHostingAccessStatusRecord {
  kind: NexusProjectHostingAccessPrincipalKind;
  providerIdentity: string;
  role: NexusProjectHostingAccessRole;
  requiredPermission: NexusProjectHostingRequiredPermission;
  authProfile: string | null;
  invitationPolicy: NexusProjectHostingInvitationPolicy;
  effectivePermission: NexusProjectHostingRequiredPermission | null;
  pendingInvitation: boolean | null;
  invitationId: string | null;
  status: NexusProjectHostingAccessStatus;
}

export interface NexusProjectHostingAppInstallationStatusRecord {
  providerIdentity: string;
  role: NexusProjectHostingAccessRole;
  requiredPermission: NexusProjectHostingRequiredPermission;
  requiredProviderPermissions: Record<string, string>;
  authProfile: string | null;
  installationAccount: string | null;
  repositorySelection: string | null;
  repositorySelected: boolean | null;
  permissions: Record<string, string>;
  missingPermissions: Record<string, string>;
  status: NexusProjectHostingAppInstallationStatus;
}

export interface NexusProjectHostingStatusResult {
  ok: boolean;
  status: NexusProjectHostingStatusLevel;
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
}

export type NexusProjectHostingPlanStatus = "passed" | "manual" | "blocked";

export type NexusProjectHostingPlanActionDisposition =
  | "allowed"
  | "blocked"
  | "manual";

export type NexusProjectHostingPlanMutationClass =
  | "read_only"
  | "repository_create"
  | "local_remote_repair"
  | "access_repair"
  | "invitation_acceptance"
  | "default_branch_repair"
  | "visibility_repair";

export type NexusProjectHostingPlanActionKind =
  | "configure_hosting"
  | "create_repository"
  | "add_local_remote"
  | "update_local_remote"
  | "install_app"
  | "select_app_repository"
  | "update_app_permissions"
  | "invite_collaborator"
  | "add_collaborator"
  | "update_collaborator_permission"
  | "accept_invitation"
  | "wait_for_invitation"
  | "repair_default_branch"
  | "repair_visibility"
  | "unsupported_provider_operation";

export interface NexusProjectHostingPlanActionRepository {
  namespace: string;
  name: string;
}

export interface NexusProjectHostingPlanActionTarget {
  type: "hosting" | "repository" | "remote" | "principal";
  name?: string;
  kind?: NexusProjectHostingAccessPrincipalKind;
  providerIdentity?: string;
}

export interface NexusProjectHostingPlanAction {
  id: string;
  kind: NexusProjectHostingPlanActionKind;
  provider: NexusProjectHostingProviderName | null;
  repository: NexusProjectHostingPlanActionRepository | null;
  target: NexusProjectHostingPlanActionTarget;
  current: Record<string, unknown>;
  desired: Record<string, unknown>;
  mutationClass: NexusProjectHostingPlanMutationClass;
  disposition: NexusProjectHostingPlanActionDisposition;
  reason: string;
  authProfile: string | null;
}

export interface NexusProjectHostingPlanOptions {
  hosting?: NexusProjectHostingConfig;
  status: NexusProjectHostingStatusResult;
}

export interface NexusProjectHostingPlanResult {
  ok: boolean;
  status: NexusProjectHostingPlanStatus;
  provider: NexusProjectHostingProviderName | null;
  namespace: string | null;
  repositoryName: string | null;
  actions: NexusProjectHostingPlanAction[];
}

export type NexusProjectHostingApplyStatus =
  | "passed"
  | "blocked"
  | "failed";

export type NexusProjectHostingApplyActionDisposition =
  | "applied"
  | "blocked"
  | "skipped"
  | "failed";

export interface NexusProjectHostingLocalRemoteCommand {
  kind: "add" | "set_url";
  remoteName: string;
  url: string;
  args: string[];
}

export interface NexusProjectHostingLocalRemoteCommandResult {
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type NexusProjectHostingLocalRemoteCommandRunner = (
  command: NexusProjectHostingLocalRemoteCommand,
) =>
  | NexusProjectHostingLocalRemoteCommandResult
  | Promise<NexusProjectHostingLocalRemoteCommandResult>;

export interface NexusProjectHostingApplyActionResult {
  actionId: string;
  kind: NexusProjectHostingPlanActionKind;
  mutationClass: NexusProjectHostingPlanMutationClass;
  disposition: NexusProjectHostingApplyActionDisposition;
  reason: string;
  command?: NexusProjectHostingLocalRemoteCommandResult;
  providerResult?: NexusProjectHostingProviderMutationResult;
}

export interface NexusProjectHostingApplyOptions {
  hosting?: NexusProjectHostingConfig;
  status: NexusProjectHostingStatusResult;
  authProfiles?: NexusHostingAuthProfileConfig[];
  provider?: NexusProjectHostingProviderAdapter;
  runLocalRemoteCommand?: NexusProjectHostingLocalRemoteCommandRunner;
  refreshStatus?: () =>
    | NexusProjectHostingStatusResult
    | Promise<NexusProjectHostingStatusResult>;
}

export interface NexusProjectHostingApplyResult {
  ok: boolean;
  status: NexusProjectHostingApplyStatus;
  plan: NexusProjectHostingPlanResult;
  actions: NexusProjectHostingApplyActionResult[];
  finalStatus?: NexusProjectHostingStatusResult;
  finalPlan?: NexusProjectHostingPlanResult;
}

export interface NexusProjectHostingLocalRemoteApplyOptions
  extends NexusProjectHostingApplyOptions {
  runLocalRemoteCommand: NexusProjectHostingLocalRemoteCommandRunner;
}

export type NexusProjectHostingLocalRemoteApplyResult =
  NexusProjectHostingApplyResult;

export class NexusProjectHostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusProjectHostingError";
  }
}

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

export function planNexusProjectHosting(
  options: NexusProjectHostingPlanOptions,
): NexusProjectHostingPlanResult {
  if (!options.hosting || !options.status.configured) {
    return hostingPlanResult({
      provider: options.status.provider,
      namespace: options.status.namespace,
      repositoryName: options.status.repositoryName,
      actions: [
        {
          id: "hosting:configure",
          kind: "configure_hosting",
          provider: options.status.provider,
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

  const hosting = options.hosting;
  const status = options.status;
  const repository = hostingPlanRepository(status);
  const actions: NexusProjectHostingPlanAction[] = [];
  const providerMutationAuthProfile = providerMutationAuthProfileForHosting(hosting);

  if (repository && status.repository.exists === false) {
    actions.push(
      hostingPlanAction({
        id: "repository:create",
        kind: "create_repository",
        provider: hosting.provider,
        repository,
        target: {
          type: "repository",
          name: repository.name,
        },
        current: {
          exists: false,
        },
        desired: {
          exists: true,
          visibility: hosting.repository.visibility,
          defaultBranch: hosting.repository.defaultBranch,
        },
        mutationClass: "repository_create",
        disposition: gateDisposition(hosting.provisioning.allowCreate),
        reason: hosting.provisioning.allowCreate
          ? "Repository creation is allowed by hosting.provisioning.allowCreate."
          : "Repository creation is blocked because hosting.provisioning.allowCreate is false.",
        authProfile: providerMutationAuthProfile,
      }),
    );
  }

  for (const remote of status.remotes) {
    if (remote.status === "missing") {
      actions.push(
        localRemotePlanAction({
          kind: "add_local_remote",
          remote,
          hosting,
          repository,
          reasonWhenAllowed: `Local Git remote ${remote.name} will be added from hosting intent.`,
          reasonWhenBlocked:
            `Local Git remote ${remote.name} is missing, but ` +
            "hosting.provisioning.allowLocalRemoteRepair is false.",
        }),
      );
    } else if (remote.status === "mismatch") {
      actions.push(
        localRemotePlanAction({
          kind: "update_local_remote",
          remote,
          hosting,
          repository,
          reasonWhenAllowed: `Local Git remote ${remote.name} will be updated to the declared URL.`,
          reasonWhenBlocked:
            `Local Git remote ${remote.name} does not match hosting intent, ` +
            "but hosting.provisioning.allowLocalRemoteRepair is false.",
        }),
      );
    }
  }

  for (const access of status.access) {
    const action = accessPlanAction({
      access,
      hosting,
      repository,
      providerMutationAuthProfile,
    });
    if (action) {
      actions.push(action);
    }
  }

  for (const appInstallation of status.appInstallations) {
    const action = appInstallationPlanAction({
      appInstallation,
      hosting,
      repository,
    });
    if (action) {
      actions.push(action);
    }
  }

  if (
    repository &&
    status.repository.defaultBranch &&
    status.repository.defaultBranch !== hosting.repository.defaultBranch
  ) {
    actions.push(
      hostingPlanAction({
        id: "repository:default-branch",
        kind: "repair_default_branch",
        provider: hosting.provider,
        repository,
        target: {
          type: "repository",
          name: repository.name,
        },
        current: {
          defaultBranch: status.repository.defaultBranch,
        },
        desired: {
          defaultBranch: hosting.repository.defaultBranch,
        },
        mutationClass: "default_branch_repair",
        disposition: gateDisposition(hosting.provisioning.allowDefaultBranchRepair),
        reason: hosting.provisioning.allowDefaultBranchRepair
          ? "Default-branch repair is allowed by hosting.provisioning.allowDefaultBranchRepair."
          : "Default-branch repair is blocked because hosting.provisioning.allowDefaultBranchRepair is false.",
        authProfile: providerMutationAuthProfile,
      }),
    );
  }

  if (
    repository &&
    status.repository.visibility &&
    status.repository.visibility !== hosting.repository.visibility
  ) {
    const safeVisibilityChange = visibilityRepairIsSafe(
      status.repository.visibility,
      hosting.repository.visibility,
    );
    actions.push(
      hostingPlanAction({
        id: "repository:visibility",
        kind: "repair_visibility",
        provider: hosting.provider,
        repository,
        target: {
          type: "repository",
          name: repository.name,
        },
        current: {
          visibility: status.repository.visibility,
        },
        desired: {
          visibility: hosting.repository.visibility,
        },
        mutationClass: "visibility_repair",
        disposition:
          hosting.provisioning.allowVisibilityRepair && safeVisibilityChange
            ? "allowed"
            : "blocked",
        reason: !hosting.provisioning.allowVisibilityRepair
          ? "Visibility repair is blocked because hosting.provisioning.allowVisibilityRepair is false."
          : safeVisibilityChange
            ? "Visibility repair tightens or preserves repository exposure and is allowed by policy."
            : "Visibility repair would broaden repository exposure and is declined as unsafe.",
        authProfile: providerMutationAuthProfile,
      }),
    );
  }

  return hostingPlanResult({
    provider: status.provider,
    namespace: status.namespace,
    repositoryName: status.repositoryName,
    actions,
  });
}

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
  const actions: NexusProjectHostingApplyActionResult[] = [];
  const applyMutationClasses = new Set<NexusProjectHostingPlanMutationClass>(
    options.applyMutationClasses ?? [
      "repository_create",
      "local_remote_repair",
      "access_repair",
      "invitation_acceptance",
    ],
  );

  for (const action of plan.actions) {
    if (!applyMutationClasses.has(action.mutationClass)) {
      continue;
    }

    if (action.disposition !== "allowed") {
      actions.push({
        actionId: action.id,
        kind: action.kind,
        mutationClass: action.mutationClass,
        disposition: "skipped",
        reason:
          `Skipped ${action.disposition} ` +
          `${mutationClassLabel(action.mutationClass)}: ${action.reason}`,
      });
      continue;
    }

    if (action.mutationClass === "repository_create") {
      actions.push(await applyRepositoryCreateAction(options, action));
      continue;
    }

    if (action.mutationClass === "local_remote_repair") {
      actions.push(await applyLocalRemoteRepairAction(options, action));
      continue;
    }

    if (action.mutationClass === "access_repair") {
      actions.push(await applyAccessRepairAction(options, action));
      continue;
    }

    if (action.mutationClass === "invitation_acceptance") {
      actions.push(await applyInvitationAcceptanceAction(options, action));
    }
  }

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
  const hasFailure = actions.some((action) => action.disposition === "failed");
  const hasBlocked = actions.some((action) => action.disposition === "blocked");
  const hasBlockedSkip = actions.some(
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
    plan,
    actions,
    ...(finalStatus ? { finalStatus } : {}),
    ...(finalPlan ? { finalPlan } : {}),
  };
}

async function applyRepositoryCreateAction(
  options: NexusProjectHostingApplyOptions,
  action: NexusProjectHostingPlanAction,
): Promise<NexusProjectHostingApplyActionResult> {
  const repository = action.repository;
  if (!repository || !options.hosting) {
    return blockedApplyAction(
      action,
      "Skipped repository create: hosting repository intent is unavailable.",
    );
  }
  if (!options.provider) {
    return blockedApplyAction(
      action,
      "Skipped repository create: no hosting provider adapter was supplied.",
    );
  }
  if (options.provider.provider !== options.hosting.provider) {
    return blockedApplyAction(
      action,
      `Skipped repository create: hosting provider ${options.hosting.provider} ` +
        `cannot be mutated with ${options.provider.provider} adapter.`,
    );
  }
  if (!options.provider.createRepository) {
    return blockedApplyAction(
      action,
      `Skipped repository create: provider ${options.provider.provider} does ` +
        "not expose repository creation.",
    );
  }
  if (!action.authProfile) {
    return blockedApplyAction(
      action,
      "Skipped repository create: no provider mutation auth profile is configured.",
    );
  }

  const authProfile = options.authProfiles?.find(
    (profile) => profile.id === action.authProfile,
  );
  if (!authProfile) {
    return blockedApplyAction(
      action,
      `Skipped repository create: host-local auth profile is missing: ${action.authProfile}.`,
    );
  }

  const authProfileStatus = options.status.authProfiles.find(
    (status) => status.id === action.authProfile,
  );
  if (authProfileStatus?.status === "mismatch") {
    return blockedApplyAction(
      action,
      `Skipped repository create: auth profile ${action.authProfile} is ` +
        `authenticated as ${authProfileStatus.observedAccount ?? "unknown"}; ` +
        `expected ${authProfileStatus.expectedAccount ?? "unknown"}.`,
    );
  }
  if (authProfileStatus?.status === "missing") {
    return blockedApplyAction(
      action,
      `Skipped repository create: host-local auth profile is missing: ${action.authProfile}.`,
    );
  }

  try {
    const providerResult = await options.provider.createRepository({
      namespace: repository.namespace,
      repositoryName: repository.name,
      visibility: desiredRepositoryVisibility(action),
      defaultBranch: desiredDefaultBranch(action),
      authProfile,
    });
    const mismatchReason = repositoryResultMismatchReason(
      providerResult.repository,
      repository,
    );
    if (mismatchReason) {
      return {
        actionId: action.id,
        kind: action.kind,
        mutationClass: action.mutationClass,
        disposition: "failed",
        reason: mismatchReason,
        providerResult,
      };
    }

    if (providerResult.status === "blocked") {
      return {
        actionId: action.id,
        kind: action.kind,
        mutationClass: action.mutationClass,
        disposition: "blocked",
        reason: providerResult.message ?? "Provider blocked repository creation.",
        providerResult,
      };
    }
    if (providerResult.status === "failed") {
      return {
        actionId: action.id,
        kind: action.kind,
        mutationClass: action.mutationClass,
        disposition: "failed",
        reason: providerResult.message ?? "Provider failed repository creation.",
        providerResult,
      };
    }

    return {
      actionId: action.id,
      kind: action.kind,
      mutationClass: action.mutationClass,
      disposition:
        providerResult.status === "already_exists" ? "skipped" : "applied",
      reason: providerResult.message ?? action.reason,
      providerResult,
    };
  } catch (error) {
    return {
      actionId: action.id,
      kind: action.kind,
      mutationClass: action.mutationClass,
      disposition: "failed",
      reason:
        error instanceof Error
          ? error.message
          : "Provider failed repository creation.",
    };
  }
}

async function applyAccessRepairAction(
  options: NexusProjectHostingApplyOptions,
  action: NexusProjectHostingPlanAction,
): Promise<NexusProjectHostingApplyActionResult> {
  const repository = action.repository;
  if (!repository || !options.hosting) {
    return blockedApplyAction(
      action,
      "Skipped access repair: hosting repository intent is unavailable.",
    );
  }
  if (!options.provider) {
    return blockedApplyAction(
      action,
      "Skipped access repair: no hosting provider adapter was supplied.",
    );
  }
  if (options.provider.provider !== options.hosting.provider) {
    return blockedApplyAction(
      action,
      `Skipped access repair: hosting provider ${options.hosting.provider} ` +
        `cannot be mutated with ${options.provider.provider} adapter.`,
    );
  }
  if (!options.provider.repairAccess) {
    return blockedApplyAction(
      action,
      `Skipped access repair: provider ${options.provider.provider} does ` +
        "not expose access repair.",
    );
  }
  if (!action.authProfile) {
    return blockedApplyAction(
      action,
      "Skipped access repair: no provider mutation auth profile is configured.",
    );
  }

  const authProfile = options.authProfiles?.find(
    (profile) => profile.id === action.authProfile,
  );
  if (!authProfile) {
    return blockedApplyAction(
      action,
      `Skipped access repair: host-local auth profile is missing: ${action.authProfile}.`,
    );
  }

  const authProfileStatus = options.status.authProfiles.find(
    (status) => status.id === action.authProfile,
  );
  if (authProfileStatus?.status === "mismatch") {
    return blockedApplyAction(
      action,
      `Skipped access repair: auth profile ${action.authProfile} is ` +
        `authenticated as ${authProfileStatus.observedAccount ?? "unknown"}; ` +
        `expected ${authProfileStatus.expectedAccount ?? "unknown"}.`,
    );
  }
  if (authProfileStatus?.status === "missing") {
    return blockedApplyAction(
      action,
      `Skipped access repair: host-local auth profile is missing: ${action.authProfile}.`,
    );
  }

  const principal = accessPrincipalForAction(options.hosting, action);
  if (!principal) {
    return blockedApplyAction(
      action,
      "Skipped access repair: declared target principal is unavailable.",
    );
  }
  const requiredPermission = desiredAccessPermission(action);

  try {
    const providerResult = await options.provider.repairAccess({
      namespace: repository.namespace,
      repositoryName: repository.name,
      principal,
      requiredPermission,
      operation: accessRepairOperation(action),
      mutationAuthProfile: authProfile,
    });

    if (providerResult.status === "blocked") {
      return {
        actionId: action.id,
        kind: action.kind,
        mutationClass: action.mutationClass,
        disposition: "blocked",
        reason: providerResult.message ?? "Provider blocked access repair.",
        providerResult,
      };
    }
    if (providerResult.status === "failed") {
      return {
        actionId: action.id,
        kind: action.kind,
        mutationClass: action.mutationClass,
        disposition: "failed",
        reason: providerResult.message ?? "Provider failed access repair.",
        providerResult,
      };
    }

    const mismatchReason = accessResultMismatchReason(
      providerResult.access,
      requiredPermission,
    );
    if (mismatchReason) {
      return {
        actionId: action.id,
        kind: action.kind,
        mutationClass: action.mutationClass,
        disposition: "failed",
        reason: mismatchReason,
        providerResult,
      };
    }

    return {
      actionId: action.id,
      kind: action.kind,
      mutationClass: action.mutationClass,
      disposition: providerAccessRepairWasAlreadySatisfied(providerResult)
        ? "skipped"
        : "applied",
      reason: providerResult.message ?? action.reason,
      providerResult,
    };
  } catch (error) {
    return {
      actionId: action.id,
      kind: action.kind,
      mutationClass: action.mutationClass,
      disposition: "failed",
      reason:
        error instanceof Error
          ? error.message
          : "Provider failed access repair.",
    };
  }
}

async function applyInvitationAcceptanceAction(
  options: NexusProjectHostingApplyOptions,
  action: NexusProjectHostingPlanAction,
): Promise<NexusProjectHostingApplyActionResult> {
  const repository = action.repository;
  if (!repository || !options.hosting) {
    return blockedApplyAction(
      action,
      "Skipped invitation acceptance: hosting repository intent is unavailable.",
    );
  }
  if (!options.provider) {
    return blockedApplyAction(
      action,
      "Skipped invitation acceptance: no hosting provider adapter was supplied.",
    );
  }
  if (options.provider.provider !== options.hosting.provider) {
    return blockedApplyAction(
      action,
      `Skipped invitation acceptance: hosting provider ${options.hosting.provider} ` +
        `cannot be mutated with ${options.provider.provider} adapter.`,
    );
  }
  if (!options.provider.acceptInvitation) {
    return blockedApplyAction(
      action,
      `Skipped invitation acceptance: provider ${options.provider.provider} ` +
        "does not expose invitation acceptance.",
    );
  }
  if (!action.authProfile) {
    return blockedApplyAction(
      action,
      "Skipped invitation acceptance: no invitee auth profile is configured.",
    );
  }

  const authProfile = options.authProfiles?.find(
    (profile) => profile.id === action.authProfile,
  );
  if (!authProfile) {
    return blockedApplyAction(
      action,
      `Skipped invitation acceptance: host-local auth profile is missing: ${action.authProfile}.`,
    );
  }

  const authProfileStatus = options.status.authProfiles.find(
    (status) => status.id === action.authProfile,
  );
  if (authProfileStatus?.status === "mismatch") {
    return blockedApplyAction(
      action,
      `Skipped invitation acceptance: auth profile ${action.authProfile} is ` +
        `authenticated as ${authProfileStatus.observedAccount ?? "unknown"}; ` +
        `expected ${authProfileStatus.expectedAccount ?? "unknown"}.`,
    );
  }
  if (authProfileStatus?.status === "missing") {
    return blockedApplyAction(
      action,
      `Skipped invitation acceptance: host-local auth profile is missing: ${action.authProfile}.`,
    );
  }

  const principal = accessPrincipalForAction(options.hosting, action);
  if (!principal) {
    return blockedApplyAction(
      action,
      "Skipped invitation acceptance: declared target principal is unavailable.",
    );
  }

  const invitationId = await invitationIdForAcceptance({
    action,
    authProfile,
    principal,
    provider: options.provider,
    repository,
  });
  if (!invitationId) {
    return blockedApplyAction(
      action,
      `Skipped invitation acceptance: pending invitation was not found for ${principalLabelFromConfig(principal)}.`,
    );
  }

  try {
    const providerResult = await options.provider.acceptInvitation({
      namespace: repository.namespace,
      repositoryName: repository.name,
      principal,
      invitationId,
      authProfile,
    });

    if (providerResult.status === "blocked") {
      return {
        actionId: action.id,
        kind: action.kind,
        mutationClass: action.mutationClass,
        disposition: "blocked",
        reason:
          providerResult.message ?? "Provider blocked invitation acceptance.",
        providerResult,
      };
    }
    if (providerResult.status === "failed") {
      return {
        actionId: action.id,
        kind: action.kind,
        mutationClass: action.mutationClass,
        disposition: "failed",
        reason:
          providerResult.message ?? "Provider failed invitation acceptance.",
        providerResult,
      };
    }

    return {
      actionId: action.id,
      kind: action.kind,
      mutationClass: action.mutationClass,
      disposition: providerAccessRepairWasAlreadySatisfied(providerResult)
        ? "skipped"
        : "applied",
      reason: providerResult.message ?? action.reason,
      providerResult,
    };
  } catch (error) {
    return {
      actionId: action.id,
      kind: action.kind,
      mutationClass: action.mutationClass,
      disposition: "failed",
      reason:
        error instanceof Error
          ? error.message
          : "Provider failed invitation acceptance.",
    };
  }
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
  resultRepository: NexusProjectHostingRepositoryRecord | null | undefined,
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
  hosting: NexusProjectHostingConfig,
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

export async function preflightNexusProjectHosting(
  options: NexusProjectHostingPreflightOptions,
): Promise<NexusProjectHostingPreflightResult> {
  const repositoryName = deriveNexusProjectHostingRepositoryName(options);
  const expectedRemotes = expectedNexusProjectHostingRemotes(options);
  const issues: NexusProjectHostingPreflightIssue[] = [];
  const authProfileById = new Map(
    (options.authProfiles ?? []).map((profile) => [profile.id, profile]),
  );

  if (options.provider.provider !== options.hosting.provider) {
    issues.push({
      code: "provider_mismatch",
      severity: "blocker",
      message:
        `Hosting provider ${options.hosting.provider} cannot be checked with ` +
        `${options.provider.provider} adapter.`,
    });
  }

  for (const expectedRemote of expectedRemotes) {
    if (!expectedRemote.authProfile) {
      issues.push({
        code: "auth_profile_unset",
        severity: "blocker",
        message:
          `Remote ${expectedRemote.name} does not reference a host-local ` +
          "auth profile, so actor permissions cannot be checked.",
        remoteName: expectedRemote.name,
      });
      continue;
    }
    if (!authProfileById.has(expectedRemote.authProfile)) {
      issues.push({
        code: "auth_profile_missing",
        severity: "blocker",
        message: `Host-local auth profile is not configured: ${expectedRemote.authProfile}`,
        remoteName: expectedRemote.name,
        authProfile: expectedRemote.authProfile,
      });
    }
  }

  if (issues.some((issue) => issue.code === "provider_mismatch")) {
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
    issues.push({
      code: "repository_missing",
      severity: options.hosting.provisioning.allowCreate ? "warning" : "blocker",
      message: options.hosting.provisioning.allowCreate
        ? `Remote repository ${options.hosting.namespace}/${repositoryName} does not exist and may be created when live provisioning is allowed.`
        : `Remote repository ${options.hosting.namespace}/${repositoryName} does not exist and automatic creation is disabled.`,
    });

    return preflightResult({
      options,
      repositoryName,
      repositoryExists: false,
      expectedRemotes,
      issues,
    });
  }

  if (
    repository.visibility &&
    repository.visibility !== options.hosting.repository.visibility
  ) {
    issues.push({
      code: "repository_visibility_mismatch",
      severity: "blocker",
      message:
        `Remote repository visibility is ${repository.visibility}; ` +
        `project hosting expects ${options.hosting.repository.visibility}.`,
    });
  }

  if (
    repository.defaultBranch &&
    repository.defaultBranch !== options.hosting.repository.defaultBranch
  ) {
    issues.push({
      code: "repository_default_branch_mismatch",
      severity: "blocker",
      message:
        `Remote repository default branch is ${repository.defaultBranch}; ` +
        `project hosting expects ${options.hosting.repository.defaultBranch}.`,
    });
  }

  for (const expectedRemote of expectedRemotes) {
    if (!expectedRemote.authProfile) {
      continue;
    }
    const authProfile = authProfileById.get(expectedRemote.authProfile);
    if (!authProfile) {
      continue;
    }

    const permissions = await options.provider.getPermissions({
      namespace: options.hosting.namespace,
      repositoryName,
      remoteName: expectedRemote.name,
      remoteRole: expectedRemote.role,
      authProfile,
    });
    const requiredPermission = requiredPermissionForRemote(
      expectedRemote,
      options.hosting,
    );
    if (!permissionSetAllows(permissions, requiredPermission)) {
      issues.push({
        code: "permission_mismatch",
        severity: "blocker",
        message:
          `Remote ${expectedRemote.name} uses auth profile ` +
          `${expectedRemote.authProfile}, but that actor does not appear to ` +
          `have ${requiredPermission} access to ` +
          `${options.hosting.namespace}/${repositoryName}.`,
        remoteName: expectedRemote.name,
        authProfile: expectedRemote.authProfile,
      });
    }
  }

  return preflightResult({
    options,
    repositoryName,
    repositoryExists: true,
    expectedRemotes,
    issues,
  });
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
    case "satisfied":
    case "unchecked":
      return null;
  }
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
    case "installed":
    case "unchecked":
      return null;
  }
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
  if (options.access.invitationPolicy === "auto_accept") {
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
    return authProfileIdForNexusProjectHostingRemote(hosting, automationRemote);
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

function gateDisposition(
  allowed: boolean,
): NexusProjectHostingPlanActionDisposition {
  return allowed ? "allowed" : "blocked";
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

function principalLabelFromConfig(
  principal: NexusProjectHostingAccessPrincipalConfig,
): string {
  return `${principal.kind}:${principal.providerIdentity}`;
}

function principalIdPart(access: NexusProjectHostingAccessStatusRecord): string {
  return `${access.kind}:${normalizePlanIdPart(access.providerIdentity)}`;
}

function normalizePlanIdPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, "-");
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

function hostingPlanResult(options: {
  provider: NexusProjectHostingProviderName | null;
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
