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

export interface NexusHostingAuthProfileConfig {
  id: string;
  provider: NexusProjectHostingProviderName;
  kind?: NexusHostingAuthProfileKind;
  account?: string;
  host?: string;
  sshHost?: string;
  githubCliConfigDir?: string;
  command?: string;
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

export interface NexusProjectHostingProviderAdapter {
  provider: NexusProjectHostingProviderName;
  getRepository(
    input: NexusProjectHostingProviderRepositoryInput,
  ): Promise<NexusProjectHostingRepositoryRecord | null>;
  getPermissions(
    input: NexusProjectHostingProviderPermissionInput,
  ): Promise<NexusProjectHostingPermissionSet>;
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
