import { spawnSync } from "node:child_process";
import type {
  NexusHostingAuthProfileConfig,
  NexusHostingAuthProfileCredentialKind,
  NexusHostingAuthProfileCredentialPurpose,
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
  env?: Record<string, string | undefined>;
  now?: Date | string | (() => Date | string);
  commandRunner?: NexusProviderCredentialCommandRunner;
}

interface CommandTokenResult {
  token?: string;
  authorizationHeader?: string;
  env?: Record<string, string>;
  expiresAt?: string | null;
  scopes?: string[];
  permissions?: Record<string, string>;
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
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => Date;
  private readonly commandRunner: NexusProviderCredentialCommandRunner;

  constructor(options: HostAuthProfileCredentialBrokerOptions) {
    this.authProfiles = options.authProfiles;
    this.env = options.env ?? process.env;
    this.now = normalizeNow(options.now);
    this.commandRunner =
      options.commandRunner ?? defaultProviderCredentialCommandRunner;
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
        env: { GH_CONFIG_DIR: profile.githubCliConfigDir },
      });
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

    if (actorProfiles.length === 1) {
      return actorProfiles[0]!;
    }
    if (actorProfiles.length > 1) {
      throw new NexusProviderCredentialBrokerError(
        "ambiguous_profile",
        `Multiple auth profiles match provider ${request.provider}; specify profileId.`,
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
    const args = (profile.commandArgs ?? []).map((arg) =>
      expandCommandArg(arg, request),
    );
    const result = this.commandRunner(profile.command!, args, { env: this.env });
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
  const token =
    optionalString(record.token) ??
    optionalString(record.accessToken) ??
    optionalString(record.value);
  const authorizationHeader = optionalString(record.authorizationHeader);
  const expiresAt =
    optionalString(record.expiresAt) ?? optionalString(record.expires_at);
  return {
    ...(token ? { token } : {}),
    ...(authorizationHeader ? { authorizationHeader } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...parseScopes(record.scopes),
    ...parsePermissions(record.permissions),
  };
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
