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
  | "github_app_user_token"
  | "unknown";

export type NexusHostingAuthProfileCredentialPurpose = "api" | "git" | "cli";

export interface NexusHostingGitHubAppCredentialConfig {
  appId?: string;
  clientId?: string;
  slug?: string;
  privateKeyPath?: string;
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
  repositoryScopes?: string[];
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
