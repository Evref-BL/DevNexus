import { spawnSync } from "node:child_process";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveNexusProjectPath } from "./nexusPathResolver.js";
import type {
  NexusHostingAuthProfileConfig,
  NexusHostingAuthProfileCredentialKind,
  NexusHostingAuthProfileCredentialPurpose,
  NexusHostingGitHubAppCredentialConfig,
} from "./nexusProjectHosting.js";
import type { WorkTrackingRepositoryConfig } from "./workTrackingTypes.js";

export type NexusProviderCredentialPurpose =
  NexusHostingAuthProfileCredentialPurpose;

export type NexusProviderCredentialKind = NexusHostingAuthProfileCredentialKind;

export type NexusProviderCredentialErrorCode =
  | "missing_profile"
  | "ambiguous_profile"
  | "wrong_actor"
  | "missing_secret"
  | "expired_credential"
  | "unsupported_purpose"
  | "async_required"
  | "refresh_required"
  | "installation_not_found"
  | "repository_not_selected"
  | "missing_permission"
  | "private_key_unavailable"
  | "provider_request_failed"
  | "command_failed"
  | "invalid_command_output";

export interface NexusProviderCredentialRequest {
  provider: string;
  purpose: NexusProviderCredentialPurpose;
  host?: string | null;
  profileId?: string | null;
  actorId?: string | null;
  providerIdentity?: string | null;
  repository?: WorkTrackingRepositoryConfig | null;
  requiredPermissions?: Record<string, string>;
}

export interface NexusProviderCredentialSecret {
  kind: "token";
  value: string;
}

export interface NexusProviderGitCredentialDescriptor {
  protocol: "https" | "ssh";
  host: string;
  path?: string | null;
}

export interface NexusResolvedProviderCredential {
  provider: string;
  host?: string | null;
  profileId: string;
  actorId?: string | null;
  providerIdentity?: string | null;
  account?: string | null;
  kind: NexusProviderCredentialKind;
  purposes: NexusProviderCredentialPurpose[];
  expiresAt?: string | null;
  scopes?: string[];
  permissions?: Record<string, string>;
  authorizationHeader?: string;
  env?: Record<string, string>;
  gitCredential?: NexusProviderGitCredentialDescriptor;
  secret?: NexusProviderCredentialSecret;
}

export interface NexusProviderCredentialBroker {
  resolveCredential(
    request: NexusProviderCredentialRequest,
  ): NexusResolvedProviderCredential;
  resolveCredentialAsync?(
    request: NexusProviderCredentialRequest,
  ): Promise<NexusResolvedProviderCredential>;
}

export interface NexusProviderCredentialCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type NexusProviderCredentialCommandRunner = (
  command: string,
  args: string[],
  options: { env: Record<string, string | undefined> },
) => NexusProviderCredentialCommandResult;

export interface HostAuthProfileCredentialBrokerOptions {
  authProfiles: NexusHostingAuthProfileConfig[];
  projectRoot?: string;
  homePath?: string;
  env?: Record<string, string | undefined>;
  now?: Date | string | (() => Date | string);
  commandRunner?: NexusProviderCredentialCommandRunner;
  fetch?: typeof fetch;
  readFile?: (filePath: string) => string;
}

interface CommandTokenResult {
  token?: string;
  authorizationHeader?: string;
  env?: Record<string, string>;
  expiresAt?: string | null;
  actorId?: string;
  providerIdentity?: string;
  scopes?: string[];
  permissions?: Record<string, string>;
}

interface CachedGitHubAppCredential {
  cacheKey: string;
  credential: NexusResolvedProviderCredential;
  refreshAt: number;
}

interface GitHubAppInstallation {
  id?: number | string;
  account?: {
    login?: string | null;
  } | null;
  repository_selection?: string | null;
}

interface GitHubAppInstallationTokenResponse {
  token?: string;
  expires_at?: string;
  repository_selection?: string | null;
  permissions?: Record<string, string>;
  repositories?: Array<{ name?: string | null; full_name?: string | null }>;
}

interface GitHubErrorBody {
  message?: string;
  documentation_url?: string;
}

export class NexusProviderCredentialBrokerError extends Error {
  readonly code: NexusProviderCredentialErrorCode;
  readonly profileId: string | null;

  constructor(
    code: NexusProviderCredentialErrorCode,
    message: string,
    options: { profileId?: string | null } = {},
  ) {
    super(message);
    this.name = "NexusProviderCredentialBrokerError";
    this.code = code;
    this.profileId = options.profileId ?? null;
  }
}

export function createHostAuthProfileCredentialBroker(
  options: HostAuthProfileCredentialBrokerOptions,
): NexusProviderCredentialBroker {
  return new HostAuthProfileCredentialBroker(options);
}

export async function resolveProviderCredential(
  broker: NexusProviderCredentialBroker,
  request: NexusProviderCredentialRequest,
): Promise<NexusResolvedProviderCredential> {
  if (broker.resolveCredentialAsync) {
    return broker.resolveCredentialAsync(request);
  }

  return broker.resolveCredential(request);
}

export function defaultProviderCredentialCommandRunner(
  command: string,
  args: string[],
  options: { env: Record<string, string | undefined> },
): NexusProviderCredentialCommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      ...options.env,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

class HostAuthProfileCredentialBroker implements NexusProviderCredentialBroker {
  private readonly authProfiles: NexusHostingAuthProfileConfig[];
  private readonly projectRoot: string;
  private readonly homePath?: string;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => Date;
  private readonly commandRunner: NexusProviderCredentialCommandRunner;
  private readonly fetchFn: typeof fetch;
  private readonly readFile: (filePath: string) => string;
  private readonly githubAppCache = new Map<string, CachedGitHubAppCredential>();

  constructor(options: HostAuthProfileCredentialBrokerOptions) {
    this.authProfiles = options.authProfiles;
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.homePath = options.homePath;
    this.env = options.env ?? process.env;
    this.now = normalizeNow(options.now);
    this.commandRunner =
      options.commandRunner ?? defaultProviderCredentialCommandRunner;
    this.fetchFn = options.fetch ?? fetch;
    this.readFile =
      options.readFile ??
      ((filePath) => readFileSync(filePath, { encoding: "utf8" }));
  }

  resolveCredential(
    request: NexusProviderCredentialRequest,
  ): NexusResolvedProviderCredential {
    const profile = this.resolveProfile(request);
    const purposes = credentialPurposes(profile);
    if (!purposes.includes(request.purpose)) {
      throw new NexusProviderCredentialBrokerError(
        "unsupported_purpose",
        `Auth profile ${profile.id} cannot provide ${request.purpose} credentials for ${request.provider}.`,
        { profileId: profile.id },
      );
    }

    if (request.purpose === "cli" && profile.githubCliConfigDir) {
      return credentialBase(profile, request, purposes, {
        kind: profile.credentialKind ?? "provider_cli",
        env: { GH_CONFIG_DIR: this.resolveConfiguredPath(profile.githubCliConfigDir) },
      });
    }

    if (
      request.purpose === "git" &&
      isGitHubAppTransportCredentialProfile(profile, request)
    ) {
      const tokenCredential = this.resolveEnvironmentToken(
        profile,
        request,
        purposes,
      );
      if (tokenCredential) {
        return withGitHubAppGitCredential(tokenCredential, profile, request);
      }
      if (profile.command) {
        return withGitHubAppGitCredential(
          this.resolveCommandCredential(profile, request, purposes),
          profile,
          request,
        );
      }
      if (isGitHubAppCredentialProfile(profile, request)) {
        throw new NexusProviderCredentialBrokerError(
          "async_required",
          `Auth profile ${profile.id} uses GitHub App token exchange and must be resolved asynchronously.`,
          { profileId: profile.id },
        );
      }
      throw new NexusProviderCredentialBrokerError(
        "missing_secret",
        `Auth profile ${profile.id} does not expose a usable GitHub App Git credential for ${request.provider}.`,
        { profileId: profile.id },
      );
    }

    if (request.purpose === "git") {
      return this.resolveGitCredential(profile, request, purposes);
    }

    const tokenCredential = this.resolveEnvironmentToken(profile, request, purposes);
    if (tokenCredential) {
      return tokenCredential;
    }

    if (profile.command) {
      return this.resolveCommandCredential(profile, request, purposes);
    }

    if (isGitHubAppCredentialProfile(profile, request)) {
      throw new NexusProviderCredentialBrokerError(
        "async_required",
        `Auth profile ${profile.id} uses GitHub App token exchange and must be resolved asynchronously.`,
        { profileId: profile.id },
      );
    }

    throw new NexusProviderCredentialBrokerError(
      "missing_secret",
      `Auth profile ${profile.id} does not expose a usable ${request.purpose} credential for ${request.provider}.`,
      { profileId: profile.id },
    );
  }

  async resolveCredentialAsync(
    request: NexusProviderCredentialRequest,
  ): Promise<NexusResolvedProviderCredential> {
    const profile = this.resolveProfile(request);
    const purposes = credentialPurposes(profile);
    if (!purposes.includes(request.purpose)) {
      throw new NexusProviderCredentialBrokerError(
        "unsupported_purpose",
        `Auth profile ${profile.id} cannot provide ${request.purpose} credentials for ${request.provider}.`,
        { profileId: profile.id },
      );
    }

    if (request.purpose === "cli" && profile.githubCliConfigDir) {
      return credentialBase(profile, request, purposes, {
        kind: profile.credentialKind ?? "provider_cli",
        env: { GH_CONFIG_DIR: this.resolveConfiguredPath(profile.githubCliConfigDir) },
      });
    }

    if (
      request.purpose === "git" &&
      isGitHubAppTransportCredentialProfile(profile, request)
    ) {
      const tokenCredential = this.resolveEnvironmentToken(
        profile,
        request,
        purposes,
      );
      if (tokenCredential) {
        return withGitHubAppGitCredential(tokenCredential, profile, request);
      }
      if (isGitHubAppCredentialProfile(profile, request)) {
        return this.resolveGitHubAppCredential(profile, request, purposes);
      }
      if (profile.command) {
        return withGitHubAppGitCredential(
          this.resolveCommandCredential(profile, request, purposes),
          profile,
          request,
        );
      }
      throw new NexusProviderCredentialBrokerError(
        "missing_secret",
        `Auth profile ${profile.id} does not expose a usable GitHub App Git credential for ${request.provider}.`,
        { profileId: profile.id },
      );
    }

    if (request.purpose === "git") {
      return this.resolveGitCredential(profile, request, purposes);
    }

    const tokenCredential = this.resolveEnvironmentToken(profile, request, purposes);
    if (tokenCredential) {
      return tokenCredential;
    }

    if (isGitHubAppCredentialProfile(profile, request)) {
      return this.resolveGitHubAppCredential(profile, request, purposes);
    }

    if (profile.command) {
      return this.resolveCommandCredential(profile, request, purposes);
    }

    throw new NexusProviderCredentialBrokerError(
      "missing_secret",
      `Auth profile ${profile.id} does not expose a usable ${request.purpose} credential for ${request.provider}.`,
      { profileId: profile.id },
    );
  }

  private resolveProfile(
    request: NexusProviderCredentialRequest,
  ): NexusHostingAuthProfileConfig {
    const provider = normalizeProviderName(request.provider);
    if (request.profileId?.trim()) {
      const profile = this.authProfiles.find(
        (candidate) => candidate.id === request.profileId,
      );
      if (!profile || normalizeProviderName(profile.provider) !== provider) {
        throw new NexusProviderCredentialBrokerError(
          "missing_profile",
          `Auth profile ${request.profileId} is not configured for provider ${request.provider}.`,
          { profileId: request.profileId },
        );
      }
      assertProfileActorMatches(profile, request);
      assertProfileRepositoryMatches(profile, request);
      return profile;
    }

    const providerProfiles = this.authProfiles.filter(
      (profile) => normalizeProviderName(profile.provider) === provider,
    );
    const hostProfiles = providerProfiles.filter((profile) =>
      profileHostMatches(profile, request),
    );
    const actorProfiles = hostProfiles.filter((profile) =>
      profileActorMatches(profile, request),
    );
    const repositoryProfiles = actorProfiles.filter((profile) =>
      profileRepositoryMatches(profile, request),
    );

    if (repositoryProfiles.length === 1) {
      return repositoryProfiles[0]!;
    }
    if (repositoryProfiles.length > 1) {
      throw new NexusProviderCredentialBrokerError(
        "ambiguous_profile",
        `Multiple auth profiles match provider ${request.provider}; specify profileId.`,
      );
    }
    if (actorProfiles.length > 0) {
      const repository = request.repository?.owner && request.repository.name
        ? `${request.repository.owner}/${request.repository.name}`
        : request.repository?.name ?? request.repository?.path ?? "<unspecified>";
      throw new NexusProviderCredentialBrokerError(
        "repository_not_selected",
        `No ${request.provider} auth profile matches repository ${repository}.`,
      );
    }
    if (
      (request.actorId?.trim() || request.providerIdentity?.trim()) &&
      hostProfiles.length > 0
    ) {
      throw new NexusProviderCredentialBrokerError(
        "wrong_actor",
        `No ${request.provider} auth profile matches the requested actor.`,
      );
    }

    throw new NexusProviderCredentialBrokerError(
      "missing_profile",
      `No auth profile is configured for provider ${request.provider}.`,
    );
  }

  private resolveCommandCredential(
    profile: NexusHostingAuthProfileConfig,
    request: NexusProviderCredentialRequest,
    purposes: NexusProviderCredentialPurpose[],
  ): NexusResolvedProviderCredential {
    const command = credentialCommandInvocation(profile, request, (value) =>
      this.resolveConfiguredPath(value),
    );
    const result = this.commandRunner(command.command, command.args, {
      env: this.env,
    });
    if (result.status !== 0 || result.error) {
      const detail =
        result.stderr.trim() || result.stdout.trim() || result.error?.message;
      throw new NexusProviderCredentialBrokerError(
        "command_failed",
        detail
          ? `Credential command for profile ${profile.id} failed: ${detail}`
          : `Credential command for profile ${profile.id} failed.`,
        { profileId: profile.id },
      );
    }

    const commandToken = parseCommandTokenResult(result.stdout, profile);
    assertNotExpired(commandToken.expiresAt, this.now(), profile.id);
    assertCommandTokenActorMatches(profile, request, commandToken);
    assertCredentialPermissionMetadata(
      profile,
      request.requiredPermissions,
      commandToken.permissions,
    );
    const token =
      commandToken.token ?? tokenFromEnvironment(commandToken.env, profile);
    if (!token && !commandToken.authorizationHeader) {
      throw new NexusProviderCredentialBrokerError(
        "invalid_command_output",
        `Credential command for profile ${profile.id} did not return a token or authorization header.`,
        { profileId: profile.id },
      );
    }

    const env = {
      ...(commandToken.env ?? {}),
      ...(token
        ? tokenEnvironment(profile, request, token)
        : {}),
    };
    return credentialBase(profile, request, purposes, {
      kind: profile.credentialKind ?? "command_token",
      ...(commandToken.expiresAt !== undefined
        ? { expiresAt: commandToken.expiresAt }
        : {}),
      ...(commandToken.scopes ? { scopes: commandToken.scopes } : {}),
      ...(commandToken.permissions ? { permissions: commandToken.permissions } : {}),
      ...(commandToken.authorizationHeader
        ? { authorizationHeader: commandToken.authorizationHeader }
        : token
          ? { authorizationHeader: `Bearer ${token}` }
          : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(token ? { secret: { kind: "token", value: token } } : {}),
    });
  }

  private resolveEnvironmentToken(
    profile: NexusHostingAuthProfileConfig,
    request: NexusProviderCredentialRequest,
    purposes: NexusProviderCredentialPurpose[],
  ): NexusResolvedProviderCredential | null {
    const token = tokenFromEnvironment(this.env, profile);
    if (!token) {
      return null;
    }

    return credentialBase(profile, request, purposes, {
      kind: profile.credentialKind ?? "environment_token",
      authorizationHeader: `Bearer ${token}`,
      env: tokenEnvironment(profile, request, token),
      secret: { kind: "token", value: token },
    });
  }

  private resolveGitCredential(
    profile: NexusHostingAuthProfileConfig,
    request: NexusProviderCredentialRequest,
    purposes: NexusProviderCredentialPurpose[],
  ): NexusResolvedProviderCredential {
    const host =
      profile.sshHost?.trim() ||
      profile.host?.trim() ||
      request.host?.trim();
    if (!host) {
      throw new NexusProviderCredentialBrokerError(
        "missing_secret",
        `Auth profile ${profile.id} does not name a Git host for ${request.provider}.`,
        { profileId: profile.id },
      );
    }

    return credentialBase(profile, request, purposes, {
      kind: profile.credentialKind ?? "git_credential",
      gitCredential: {
        protocol: profile.sshHost ? "ssh" : "https",
        host,
        ...(gitRepositoryPath(request.repository)
          ? { path: gitRepositoryPath(request.repository) }
          : {}),
      },
    });
  }

  private async resolveGitHubAppCredential(
    profile: NexusHostingAuthProfileConfig,
    request: NexusProviderCredentialRequest,
    purposes: NexusProviderCredentialPurpose[],
  ): Promise<NexusResolvedProviderCredential> {
    const githubApp = {
      ...profile.githubApp!,
      privateKeyPath: this.resolveConfiguredPath(profile.githubApp!.privateKeyPath),
    };
    const installationAccount = githubApp.installationAccount ?? profile.account;
    if (!installationAccount) {
      throw new NexusProviderCredentialBrokerError(
        "missing_profile",
        `GitHub App profile ${profile.id} must configure githubApp.installationAccount or account.`,
        { profileId: profile.id },
      );
    }
    assertGitHubAppRepositorySelection(profile, request);

    const selectedRepositories = githubAppSelectedRepositories(
      githubApp,
      request,
    );
    const cacheKey = githubAppCredentialCacheKey(
      profile,
      installationAccount,
      selectedRepositories,
      request.requiredPermissions,
    );
    const now = this.now();
    const cached = this.githubAppCache.get(cacheKey);
    if (cached && now.getTime() < cached.refreshAt) {
      return cached.credential;
    }

    const jwt = createGitHubAppJwt(githubApp, now, profile.id, this.readFile);
    const apiBaseUrl = normalizeGitHubAppApiBaseUrl(
      githubApp.apiBaseUrl ?? profile.host,
    );
    const installations = await this.githubAppRequest<GitHubAppInstallation[]>(
      apiBaseUrl,
      "/app/installations?per_page=100",
      {
        method: "GET",
        authorizationHeader: `Bearer ${jwt}`,
        profileId: profile.id,
      },
    );
    const installation = installations.find(
      (entry) => entry.account?.login === installationAccount,
    );
    if (!installation?.id) {
      throw new NexusProviderCredentialBrokerError(
        "installation_not_found",
        `GitHub App profile ${profile.id} is not installed on ${installationAccount}.`,
        { profileId: profile.id },
      );
    }

    const tokenResponse =
      await this.githubAppRequest<GitHubAppInstallationTokenResponse>(
        apiBaseUrl,
        `/app/installations/${installation.id}/access_tokens`,
        {
          method: "POST",
          authorizationHeader: `Bearer ${jwt}`,
          profileId: profile.id,
          body:
            selectedRepositories.length > 0
              ? { repositories: selectedRepositories }
              : undefined,
        },
      );
    const token = requiredGitHubAppToken(tokenResponse, profile.id);
    const expiresAt = requiredGitHubAppExpiresAt(tokenResponse, profile.id);
    assertGitHubAppTokenRepositoryAccess(profile, request, tokenResponse);
    assertGitHubAppPermissions(
      profile,
      request.requiredPermissions,
      tokenResponse.permissions,
    );
    const gitCredential = githubAppGitCredential(profile, request);

    const credential = credentialBase(profile, request, purposes, {
      kind: profile.credentialKind ?? "github_app",
      expiresAt,
      ...(tokenResponse.permissions
        ? { permissions: tokenResponse.permissions }
        : {}),
      authorizationHeader: `Bearer ${token}`,
      env: tokenEnvironment(profile, request, token),
      ...(gitCredential ? { gitCredential } : {}),
      secret: { kind: "token", value: token },
    });
    this.githubAppCache.set(cacheKey, {
      cacheKey,
      credential,
      refreshAt: gitHubAppCredentialRefreshAt(githubApp, expiresAt),
    });
    return credential;
  }

  private async githubAppRequest<T>(
    apiBaseUrl: string,
    pathAndQuery: string,
    options: {
      method: "GET" | "POST";
      authorizationHeader: string;
      profileId: string;
      body?: Record<string, unknown>;
    },
  ): Promise<T> {
    const url = new URL(pathAndQuery.replace(/^\/+/, ""), `${apiBaseUrl}/`);
    const response = await this.fetchFn(url, {
      method: options.method,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "dev-nexus",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: options.authorizationHeader,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const message =
        payload && typeof payload === "object"
          ? (payload as GitHubErrorBody).message
          : undefined;
      throw new NexusProviderCredentialBrokerError(
        "provider_request_failed",
        `${options.method} ${url.pathname} failed: ${response.status} ${
          message ?? response.statusText
        }`,
        { profileId: options.profileId },
      );
    }

    return payload as T;
  }

  private resolveConfiguredPath(value: string): string {
    return resolvePortableCredentialPath({
      value,
      projectRoot: this.projectRoot,
      homePath: this.homePath,
    });
  }
}

function normalizeNow(
  now: HostAuthProfileCredentialBrokerOptions["now"],
): () => Date {
  if (now === undefined) {
    return () => new Date();
  }
  if (typeof now === "function") {
    return () => dateFromValue(now());
  }
  const date = dateFromValue(now);
  return () => new Date(date.getTime());
}

function dateFromValue(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new NexusProviderCredentialBrokerError(
      "invalid_command_output",
      `Invalid credential timestamp: ${String(value)}`,
    );
  }
  return date;
}

function credentialCommandInvocation(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
  resolvePath: (value: string) => string,
): { command: string; args: string[] } {
  const commandLine = requiredCommand(profile);
  const splitCommand =
    profile.commandArgs && profile.commandArgs.length > 0
      ? { command: commandLine, args: profile.commandArgs }
      : splitCredentialCommandLine(commandLine, profile.id);

  return {
    command: resolvePath(expandCommandArg(splitCommand.command, request)),
    args: splitCommand.args.map((arg) =>
      resolvePath(expandCommandArg(arg, request)),
    ),
  };
}

function requiredCommand(profile: NexusHostingAuthProfileConfig): string {
  const command = profile.command?.trim();
  if (!command) {
    throw new NexusProviderCredentialBrokerError(
      "missing_secret",
      `Auth profile ${profile.id} does not configure a credential command.`,
      { profileId: profile.id },
    );
  }

  return command;
}

function splitCredentialCommandLine(
  commandLine: string,
  profileId: string,
): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;
  for (const character of commandLine) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (escaping) {
    current += "\\";
  }
  if (quote) {
    throw new NexusProviderCredentialBrokerError(
      "invalid_command_output",
      `Credential command for profile ${profileId} has an unterminated quote.`,
      { profileId },
    );
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  const [command, ...args] = tokens;
  if (!command) {
    throw new NexusProviderCredentialBrokerError(
      "missing_secret",
      `Auth profile ${profileId} does not configure a credential command.`,
      { profileId },
    );
  }

  return { command, args };
}

function resolvePortableCredentialPath(options: {
  value: string;
  projectRoot: string;
  homePath?: string;
}): string {
  if (!/^(componentsRoot|projectRoot|projectParent|home|sourcesRoot):/u.test(options.value)) {
    return options.value;
  }

  return resolveNexusProjectPath({
    projectRoot: options.projectRoot,
    value: options.value,
    ...(options.homePath ? { homePath: options.homePath } : {}),
  });
}

function normalizeProviderName(provider: string): string {
  return provider.trim().toLowerCase();
}

function normalizeHost(host?: string | null): string | null {
  const value = host?.trim();
  if (!value) {
    return null;
  }

  try {
    const url = value.startsWith("http://") || value.startsWith("https://")
      ? new URL(value)
      : new URL(`https://${value}`);
    if (url.hostname === "api.github.com") {
      return "github.com";
    }
    return url.host.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function profileHostMatches(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
): boolean {
  const requestHost = normalizeHost(request.host);
  const profileHost = normalizeHost(profile.host);
  if (!requestHost || !profileHost) {
    return true;
  }

  return requestHost === profileHost;
}

function assertProfileActorMatches(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
): void {
  if (profileActorMatches(profile, request)) {
    return;
  }

  throw new NexusProviderCredentialBrokerError(
    "wrong_actor",
    `Auth profile ${profile.id} does not match the requested actor.`,
    { profileId: profile.id },
  );
}

function profileActorMatches(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
): boolean {
  if (request.actorId?.trim() && profile.actorId !== request.actorId) {
    return false;
  }
  if (request.providerIdentity?.trim()) {
    const expected = request.providerIdentity.trim().toLowerCase();
    const account = profile.account?.trim().toLowerCase();
    if (account !== expected) {
      return false;
    }
  }

  return true;
}

function assertProfileRepositoryMatches(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
): void {
  if (profileRepositoryMatches(profile, request)) {
    return;
  }

  const repository = request.repository?.owner && request.repository.name
    ? `${request.repository.owner}/${request.repository.name}`
    : request.repository?.name ?? request.repository?.path ?? "<unspecified>";
  throw new NexusProviderCredentialBrokerError(
    "repository_not_selected",
    `Auth profile ${profile.id} does not match repository ${repository}.`,
    { profileId: profile.id },
  );
}

function profileRepositoryMatches(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
): boolean {
  const githubApp = profile.githubApp;
  if (!githubApp || normalizeProviderName(profile.provider) !== "github") {
    return true;
  }

  const requestedOwner = request.repository?.owner?.trim();
  const requestedName = request.repository?.name?.trim();
  if (!requestedName) {
    return true;
  }

  const installationAccount = githubApp.installationAccount?.trim();
  if (
    installationAccount &&
    requestedOwner &&
    installationAccount.toLowerCase() !== requestedOwner.toLowerCase()
  ) {
    return false;
  }

  const selected = githubApp.repositories;
  if (!selected || selected.length === 0) {
    return true;
  }

  return selected.some((repository) => {
    const normalized = repository.trim();
    if (!normalized) {
      return false;
    }
    const [owner, name] = normalized.includes("/")
      ? normalized.split("/", 2)
      : [installationAccount ?? requestedOwner, normalized];
    return (
      (!owner ||
        !requestedOwner ||
        owner.toLowerCase() === requestedOwner.toLowerCase()) &&
      name?.toLowerCase() === requestedName.toLowerCase()
    );
  });
}

function credentialPurposes(
  profile: NexusHostingAuthProfileConfig,
): NexusProviderCredentialPurpose[] {
  if (profile.purposes && profile.purposes.length > 0) {
    return [...profile.purposes];
  }

  const purposes = new Set<NexusProviderCredentialPurpose>();
  if (profile.command || profile.environmentKeys?.length) {
    purposes.add("api");
    purposes.add("cli");
  }
  if (profile.githubApp) {
    purposes.add("api");
    purposes.add("cli");
    purposes.add("git");
  }
  if (profile.githubCliConfigDir) {
    purposes.add("cli");
  }
  if (profile.host || profile.sshHost) {
    purposes.add("git");
  }
  return [...purposes];
}

function credentialBase(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
  purposes: NexusProviderCredentialPurpose[],
  credential: Omit<
    NexusResolvedProviderCredential,
    | "provider"
    | "host"
    | "profileId"
    | "actorId"
    | "providerIdentity"
    | "account"
    | "purposes"
  >,
): NexusResolvedProviderCredential {
  return {
    provider: request.provider,
    host: profile.host ?? request.host ?? null,
    profileId: profile.id,
    actorId: profile.actorId ?? null,
    providerIdentity: profile.account ?? null,
    account: profile.account ?? null,
    purposes,
    ...credential,
  };
}

function withGitHubAppGitCredential(
  credential: NexusResolvedProviderCredential,
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
): NexusResolvedProviderCredential {
  const gitCredential = githubAppGitCredential(profile, request);
  return gitCredential
    ? { ...credential, gitCredential }
    : credential;
}

function assertCredentialPermissionMetadata(
  profile: NexusHostingAuthProfileConfig,
  requiredPermissions: Record<string, string> | undefined,
  grantedPermissions: Record<string, string> | undefined,
): void {
  if (!requiredPermissions || !grantedPermissions) {
    return;
  }
  assertPermissionSet(
    profile,
    requiredPermissions,
    grantedPermissions,
    "Credential",
  );
}

function tokenFromEnvironment(
  env: Record<string, string | undefined> | undefined,
  profile: NexusHostingAuthProfileConfig,
): string | null {
  for (const key of profile.environmentKeys ?? []) {
    const token = env?.[key]?.trim();
    if (token) {
      return token;
    }
  }

  return null;
}

function tokenEnvironment(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
  token: string,
): Record<string, string> {
  const keys = profile.environmentKeys?.length
    ? profile.environmentKeys
    : [defaultTokenEnvironmentKey(request.provider)];
  const env: Record<string, string> = {};
  for (const key of keys) {
    env[key] = token;
  }
  return env;
}

function defaultTokenEnvironmentKey(provider: string): string {
  switch (normalizeProviderName(provider)) {
    case "github":
      return "GH_TOKEN";
    case "gitlab":
      return "GITLAB_TOKEN";
    case "jira":
      return "JIRA_TOKEN";
    default:
      return "PROVIDER_TOKEN";
  }
}

function parseCommandTokenResult(
  stdout: string,
  profile: NexusHostingAuthProfileConfig,
): CommandTokenResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new NexusProviderCredentialBrokerError(
      "invalid_command_output",
      `Credential command for profile ${profile.id} returned no output.`,
      { profileId: profile.id },
    );
  }

  if (trimmed.startsWith("{")) {
    return parseCommandTokenJson(trimmed, profile);
  }

  const env = parseEnvironmentOutput(trimmed);
  if (Object.keys(env).length > 0) {
    return { env };
  }

  return { token: trimmed };
}

function parseCommandTokenJson(
  output: string,
  profile: NexusHostingAuthProfileConfig,
): CommandTokenResult {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new NexusProviderCredentialBrokerError(
      "invalid_command_output",
      `Credential command for profile ${profile.id} returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { profileId: profile.id },
    );
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusProviderCredentialBrokerError(
      "invalid_command_output",
      `Credential command for profile ${profile.id} returned non-object JSON.`,
      { profileId: profile.id },
    );
  }

  const record = value as Record<string, unknown>;
  assertCommandTokenJsonIsUsable(record, profile);
  const token =
    optionalString(record.token) ??
    optionalString(record.accessToken) ??
    optionalString(record.value);
  const authorizationHeader = optionalString(record.authorizationHeader);
  const expiresAt =
    optionalString(record.expiresAt) ?? optionalString(record.expires_at);
  const actorId = optionalString(record.actorId);
  const providerIdentity =
    optionalString(record.providerIdentity) ??
    optionalString(record.account) ??
    optionalString(record.login) ??
    optionalString(record.user);
  return {
    ...(token ? { token } : {}),
    ...(authorizationHeader ? { authorizationHeader } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(actorId ? { actorId } : {}),
    ...(providerIdentity ? { providerIdentity } : {}),
    ...parseScopes(record.scopes),
    ...parsePermissions(record.permissions),
  };
}

function assertCommandTokenJsonIsUsable(
  record: Record<string, unknown>,
  profile: NexusHostingAuthProfileConfig,
): void {
  const status = optionalString(record.status) ?? optionalString(record.code);
  if (
    record.refreshRequired === true ||
    record.refresh_required === true ||
    status === "refresh_required" ||
    status === "refresh_needed"
  ) {
    throw new NexusProviderCredentialBrokerError(
      "refresh_required",
      `Credential command for profile ${profile.id} reported that user authorization must be refreshed.`,
      { profileId: profile.id },
    );
  }
}

function parseEnvironmentOutput(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(
      line.trim(),
    );
    if (!match) {
      return {};
    }
    env[match[1]!] = unquoteShellValue(match[2] ?? "");
  }
  return env;
}

function unquoteShellValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function parseScopes(value: unknown): Pick<NexusResolvedProviderCredential, "scopes"> {
  if (Array.isArray(value)) {
    return {
      scopes: value
        .filter((scope): scope is string => typeof scope === "string")
        .filter((scope) => scope.trim().length > 0),
    };
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return { scopes: value.split(/[,\s]+/).filter(Boolean) };
  }
  return {};
}

function parsePermissions(
  value: unknown,
): Pick<NexusResolvedProviderCredential, "permissions"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const permissions: Record<string, string> = {};
  for (const [key, permission] of Object.entries(value)) {
    if (typeof permission === "string" && permission.trim().length > 0) {
      permissions[key] = permission;
    }
  }
  return Object.keys(permissions).length > 0 ? { permissions } : {};
}

function assertNotExpired(
  expiresAt: string | null | undefined,
  now: Date,
  profileId: string,
): void {
  if (!expiresAt) {
    return;
  }

  const expiresAtDate = dateFromValue(expiresAt);
  if (expiresAtDate.getTime() <= now.getTime()) {
    throw new NexusProviderCredentialBrokerError(
      "expired_credential",
      `Credential for profile ${profileId} expired at ${expiresAt}.`,
      { profileId },
    );
  }
}

function assertCommandTokenActorMatches(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
  commandToken: CommandTokenResult,
): void {
  const expectedActorId = request.actorId?.trim() || profile.actorId?.trim();
  if (
    commandToken.actorId &&
    expectedActorId &&
    commandToken.actorId !== expectedActorId
  ) {
    throw new NexusProviderCredentialBrokerError(
      "wrong_actor",
      `Credential command for profile ${profile.id} returned actor ${commandToken.actorId}, not expected actor ${expectedActorId}.`,
      { profileId: profile.id },
    );
  }

  const expectedIdentity =
    request.providerIdentity?.trim() || profile.account?.trim();
  if (
    commandToken.providerIdentity &&
    expectedIdentity &&
    !providerIdentitiesEqual(commandToken.providerIdentity, expectedIdentity)
  ) {
    throw new NexusProviderCredentialBrokerError(
      "wrong_actor",
      `Credential command for profile ${profile.id} returned identity ${commandToken.providerIdentity}, not expected identity ${expectedIdentity}.`,
      { profileId: profile.id },
    );
  }
}

function providerIdentitiesEqual(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function expandCommandArg(
  arg: string,
  request: NexusProviderCredentialRequest,
): string {
  const repository = request.repository ?? {};
  return arg
    .replaceAll("{provider}", request.provider)
    .replaceAll("{purpose}", request.purpose)
    .replaceAll("{host}", request.host ?? "")
    .replaceAll("{repository.owner}", repository.owner ?? "")
    .replaceAll("{repository.name}", repository.name ?? "")
    .replaceAll("{repository.id}", repository.id ?? "")
    .replaceAll("{repository.path}", repository.path ?? "");
}

function gitRepositoryPath(
  repository: WorkTrackingRepositoryConfig | null | undefined,
): string | null {
  if (!repository) {
    return null;
  }
  if (repository.owner && repository.name) {
    return `${repository.owner}/${repository.name}.git`;
  }
  return repository.path ?? repository.id ?? null;
}

function githubAppGitCredential(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
): NexusProviderGitCredentialDescriptor | null {
  const path = gitRepositoryPath(request.repository);
  return {
    protocol: "https",
    host: normalizeGitHubAppGitHost(
      profile.githubApp?.apiBaseUrl ?? profile.host ?? request.host,
    ),
    ...(path ? { path } : {}),
  };
}

function normalizeGitHubAppGitHost(hostOrApiBaseUrl?: string | null): string {
  const value = hostOrApiBaseUrl?.trim();
  if (!value) {
    return "github.com";
  }
  if (
    value === "github.com" ||
    value === "https://github.com" ||
    value === "api.github.com" ||
    value === "https://api.github.com"
  ) {
    return "github.com";
  }

  try {
    const url = new URL(
      value.startsWith("http://") || value.startsWith("https://")
        ? value
        : `https://${value}`,
    );
    return url.hostname === "api.github.com" ? "github.com" : url.hostname;
  } catch {
    return value
      .replace(/^https?:\/\//u, "")
      .replace(/\/.*$/u, "")
      .replace(/^api\.github\.com$/u, "github.com");
  }
}

function isGitHubAppCredentialProfile(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
): boolean {
  return (
    normalizeProviderName(profile.provider) === "github" &&
    normalizeProviderName(request.provider) === "github" &&
    Boolean(profile.githubApp)
  );
}

function isGitHubAppTransportCredentialProfile(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
): boolean {
  return (
    normalizeProviderName(profile.provider) === "github" &&
    normalizeProviderName(request.provider) === "github" &&
    (profile.kind === "app" ||
      profile.credentialKind === "github_app" ||
      profile.credentialKind === "github_app_user_token" ||
      Boolean(profile.githubApp))
  );
}

function normalizeGitHubAppApiBaseUrl(hostOrApiBaseUrl?: string | null): string {
  const value = hostOrApiBaseUrl?.trim();
  if (!value || value === "github.com" || value === "https://github.com") {
    return "https://api.github.com";
  }
  if (value === "api.github.com" || value === "https://api.github.com") {
    return "https://api.github.com";
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.replace(/\/+$/, "");
  }

  return `https://${value.replace(/\/+$/, "")}/api/v3`;
}

function createGitHubAppJwt(
  config: NexusHostingGitHubAppCredentialConfig,
  now: Date,
  profileId: string,
  readFile: (filePath: string) => string,
): string {
  const issuer = config.appId ?? config.clientId;
  if (!issuer) {
    throw new NexusProviderCredentialBrokerError(
      "missing_profile",
      `GitHub App profile ${profileId} must configure githubApp.appId or githubApp.clientId.`,
      { profileId },
    );
  }

  let privateKey: string;
  try {
    privateKey = readFile(config.privateKeyPath);
  } catch (error) {
    throw new NexusProviderCredentialBrokerError(
      "private_key_unavailable",
      `GitHub App private key for profile ${profileId} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { profileId },
    );
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const unsigned = [
    base64UrlJson({ alg: "RS256", typ: "JWT" }),
    base64UrlJson({
      iat: nowSeconds - 60,
      exp: nowSeconds + 540,
      iss: issuer,
    }),
  ].join(".");
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(privateKey, "base64url");
  return `${unsigned}.${signature}`;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function assertGitHubAppRepositorySelection(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
): void {
  const selected = profile.githubApp?.repositories;
  const requestedRepository = request.repository?.name;
  if (
    selected &&
    requestedRepository &&
    !selected.includes(requestedRepository)
  ) {
    throw new NexusProviderCredentialBrokerError(
      "repository_not_selected",
      `GitHub App profile ${profile.id} does not allow repository ${requestedRepository}.`,
      { profileId: profile.id },
    );
  }
}

function githubAppSelectedRepositories(
  config: NexusHostingGitHubAppCredentialConfig,
  request: NexusProviderCredentialRequest,
): string[] {
  if (config.repositories && config.repositories.length > 0) {
    return [...config.repositories];
  }
  return request.repository?.name ? [request.repository.name] : [];
}

function requiredGitHubAppToken(
  response: GitHubAppInstallationTokenResponse,
  profileId: string,
): string {
  if (response.token?.trim()) {
    return response.token;
  }

  throw new NexusProviderCredentialBrokerError(
    "provider_request_failed",
    `GitHub App token response for profile ${profileId} did not include a token.`,
    { profileId },
  );
}

function requiredGitHubAppExpiresAt(
  response: GitHubAppInstallationTokenResponse,
  profileId: string,
): string {
  if (response.expires_at?.trim()) {
    return response.expires_at;
  }

  throw new NexusProviderCredentialBrokerError(
    "provider_request_failed",
    `GitHub App token response for profile ${profileId} did not include expires_at.`,
    { profileId },
  );
}

function assertGitHubAppTokenRepositoryAccess(
  profile: NexusHostingAuthProfileConfig,
  request: NexusProviderCredentialRequest,
  response: GitHubAppInstallationTokenResponse,
): void {
  const requestedRepository = request.repository?.name;
  if (!requestedRepository || response.repository_selection === "all") {
    return;
  }
  const repositories = response.repositories ?? [];
  if (repositories.length === 0) {
    return;
  }
  const allowed = repositories.some(
    (repository) => repository.name === requestedRepository,
  );
  if (!allowed) {
    throw new NexusProviderCredentialBrokerError(
      "repository_not_selected",
      `GitHub App installation token for profile ${profile.id} does not include repository ${requestedRepository}.`,
      { profileId: profile.id },
    );
  }
}

function assertGitHubAppPermissions(
  profile: NexusHostingAuthProfileConfig,
  requiredPermissions: Record<string, string> | undefined,
  grantedPermissions: Record<string, string> | undefined,
): void {
  assertPermissionSet(
    profile,
    requiredPermissions,
    grantedPermissions,
    "GitHub App profile",
  );
}

function assertPermissionSet(
  profile: NexusHostingAuthProfileConfig,
  requiredPermissions: Record<string, string> | undefined,
  grantedPermissions: Record<string, string> | undefined,
  subject: string,
): void {
  if (!requiredPermissions) {
    return;
  }

  for (const [permission, required] of Object.entries(requiredPermissions)) {
    const granted = grantedPermissions?.[permission];
    if (!permissionSatisfies(granted, required)) {
      throw new NexusProviderCredentialBrokerError(
        "missing_permission",
        `${subject} ${profile.id} requires ${permission}:${required}, but granted ${
          granted ?? "none"
        }.`,
        { profileId: profile.id },
      );
    }
  }
}

function permissionSatisfies(
  granted: string | undefined,
  required: string,
): boolean {
  if (!granted) {
    return false;
  }
  const levels = ["none", "read", "write", "admin"];
  const grantedLevel = levels.indexOf(granted);
  const requiredLevel = levels.indexOf(required);
  if (requiredLevel === -1 || grantedLevel === -1) {
    return granted === required;
  }
  return grantedLevel >= requiredLevel;
}

function githubAppCredentialCacheKey(
  profile: NexusHostingAuthProfileConfig,
  installationAccount: string,
  repositories: string[],
  requiredPermissions: Record<string, string> | undefined,
): string {
  return JSON.stringify({
    profileId: profile.id,
    installationAccount,
    repositories: [...repositories].sort(),
    requiredPermissions: requiredPermissions
      ? Object.fromEntries(Object.entries(requiredPermissions).sort())
      : {},
  });
}

function gitHubAppCredentialRefreshAt(
  config: NexusHostingGitHubAppCredentialConfig,
  expiresAt: string,
): number {
  const expiresAtTime = dateFromValue(expiresAt).getTime();
  const refreshBufferMilliseconds =
    (config.tokenRefreshBufferSeconds ?? 300) * 1000;
  return expiresAtTime - refreshBufferMilliseconds;
}
