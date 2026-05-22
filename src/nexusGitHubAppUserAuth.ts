import fs from "node:fs";
import path from "node:path";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";

export type NexusGitHubAppUserAuthFetch = typeof fetch;

export interface NexusGitHubAppUserTokenInput {
  accessToken: string;
  expiresAt?: string | null;
  refreshToken?: string | null;
  refreshTokenExpiresAt?: string | null;
  login?: string | null;
  tokenType?: string | null;
}

export interface NexusGitHubAppUserTokenRecord
  extends Required<Pick<NexusGitHubAppUserTokenInput, "accessToken">> {
  version: 1;
  provider: "github";
  host: string;
  profileId: string;
  clientId: string;
  expiresAt: string | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: string | null;
  login: string | null;
  tokenType: string;
  updatedAt: string;
}

export type NexusGitHubAppUserTokenState =
  | "missing"
  | "authorized"
  | "expired_refreshable"
  | "expired";

export interface NexusGitHubAppUserTokenStatus {
  state: NexusGitHubAppUserTokenState;
  profileId: string;
  login: string | null;
  expiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  path: string;
}

export interface NexusGitHubAppUserDeviceLoginResult {
  profileId: string;
  login: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  status: NexusGitHubAppUserTokenStatus;
}

interface GitHubDeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

interface GitHubOAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
  interval?: number;
}

interface GitHubUserResponse {
  login?: string;
}

export function nexusGitHubAppUserTokenPath(options: {
  homePath: string;
  profileId: string;
}): string {
  return path.join(
    options.homePath,
    "auth",
    "github-app-user-tokens",
    `${safeTokenFileName(options.profileId)}.json`,
  );
}

export function readNexusGitHubAppUserToken(options: {
  homePath: string;
  profileId: string;
}): NexusGitHubAppUserTokenRecord | null {
  const filePath = nexusGitHubAppUserTokenPath(options);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return parseStoredToken(value, filePath);
}

export function writeNexusGitHubAppUserToken(options: {
  homePath: string;
  profile: NexusHostingAuthProfileConfig;
  token: NexusGitHubAppUserTokenInput;
  now?: () => Date;
}): NexusGitHubAppUserTokenRecord {
  const now = options.now?.() ?? new Date();
  const profileId = options.profile.id;
  const record: NexusGitHubAppUserTokenRecord = {
    version: 1,
    provider: "github",
    host: normalizeGitHubHost(options.profile.host),
    profileId,
    clientId: githubAppUserClientId(options.profile),
    accessToken: requiredString(options.token.accessToken, "accessToken"),
    expiresAt: options.token.expiresAt ?? null,
    refreshToken: options.token.refreshToken ?? null,
    refreshTokenExpiresAt: options.token.refreshTokenExpiresAt ?? null,
    login: options.token.login ?? null,
    tokenType: options.token.tokenType?.trim() || "bearer",
    updatedAt: now.toISOString(),
  };
  const filePath = nexusGitHubAppUserTokenPath({
    homePath: options.homePath,
    profileId,
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Some filesystems ignore POSIX modes. The file still stays under home-local state.
  }
  return record;
}

export function deleteNexusGitHubAppUserToken(options: {
  homePath: string;
  profileId: string;
}): boolean {
  const filePath = nexusGitHubAppUserTokenPath(options);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  fs.rmSync(filePath, { force: true });
  return true;
}

export function nexusGitHubAppUserTokenStatus(options: {
  homePath: string;
  profile: NexusHostingAuthProfileConfig;
  now?: () => Date;
}): NexusGitHubAppUserTokenStatus {
  const filePath = nexusGitHubAppUserTokenPath({
    homePath: options.homePath,
    profileId: options.profile.id,
  });
  const token = readNexusGitHubAppUserToken({
    homePath: options.homePath,
    profileId: options.profile.id,
  });
  if (!token) {
    return {
      state: "missing",
      profileId: options.profile.id,
      login: null,
      expiresAt: null,
      refreshTokenExpiresAt: null,
      path: filePath,
    };
  }
  const now = options.now?.() ?? new Date();
  return {
    state: tokenState(token, now),
    profileId: token.profileId,
    login: token.login,
    expiresAt: token.expiresAt,
    refreshTokenExpiresAt: token.refreshTokenExpiresAt,
    path: filePath,
  };
}

export async function runNexusGitHubAppUserDeviceLogin(options: {
  homePath: string;
  profile: NexusHostingAuthProfileConfig;
  fetch?: NexusGitHubAppUserAuthFetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  onDeviceCode?: (code: {
    userCode: string;
    verificationUri: string;
    expiresInSeconds: number;
  }) => void;
}): Promise<NexusGitHubAppUserDeviceLoginResult> {
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const clientId = githubAppUserClientId(options.profile);
  const webBaseUrl = githubWebBaseUrl(options.profile);
  const apiBaseUrl = githubApiBaseUrl(options.profile);
  const deviceCode = await requestDeviceCode(fetchFn, webBaseUrl, clientId);
  const userCode = requiredString(deviceCode.user_code, "user_code");
  const verificationUri = requiredString(
    deviceCode.verification_uri,
    "verification_uri",
  );
  const expiresInSeconds = positiveNumber(deviceCode.expires_in, 900);
  options.onDeviceCode?.({
    userCode,
    verificationUri,
    expiresInSeconds,
  });
  const token = await pollDeviceToken({
    fetch: fetchFn,
    webBaseUrl,
    clientId,
    deviceCode: requiredString(deviceCode.device_code, "device_code"),
    intervalSeconds: positiveNumber(deviceCode.interval, 5),
    maxPolls: Math.ceil(expiresInSeconds / positiveNumber(deviceCode.interval, 5)) + 1,
    sleep,
    now,
  });
  const login = await readGitHubLogin(fetchFn, apiBaseUrl, token.accessToken);
  assertExpectedLogin(options.profile, login);
  const record = writeNexusGitHubAppUserToken({
    homePath: options.homePath,
    profile: options.profile,
    token: {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      refreshToken: token.refreshToken,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
      login,
      tokenType: token.tokenType,
    },
    now,
  });
  return {
    profileId: options.profile.id,
    login,
    userCode,
    verificationUri,
    expiresAt: record.expiresAt,
    refreshTokenExpiresAt: record.refreshTokenExpiresAt,
    status: nexusGitHubAppUserTokenStatus({
      homePath: options.homePath,
      profile: options.profile,
      now,
    }),
  };
}

export async function refreshNexusGitHubAppUserToken(options: {
  homePath: string;
  profile: NexusHostingAuthProfileConfig;
  fetch?: NexusGitHubAppUserAuthFetch;
  now?: () => Date;
}): Promise<NexusGitHubAppUserTokenRecord> {
  const token = readNexusGitHubAppUserToken({
    homePath: options.homePath,
    profileId: options.profile.id,
  });
  if (!token?.refreshToken) {
    throw new Error(`GitHub App user token for profile ${options.profile.id} must be authorized with dev-nexus auth github-app user login.`);
  }
  const now = options.now ?? (() => new Date());
  if (token.refreshTokenExpiresAt && new Date(token.refreshTokenExpiresAt).getTime() <= now().getTime()) {
    throw new Error(`GitHub App user refresh token for profile ${options.profile.id} has expired; run login again.`);
  }
  const clientId = githubAppUserClientId(options.profile);
  const response = await oauthRequest<GitHubOAuthTokenResponse>(
    options.fetch ?? fetch,
    `${githubWebBaseUrl(options.profile)}/login/oauth/access_token`,
    {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    },
  );
  if (response.error) {
    throw new Error(
      response.error_description ?? `GitHub App user token refresh failed: ${response.error}`,
    );
  }
  const refreshed = normalizeOAuthToken(response, now());
  return writeNexusGitHubAppUserToken({
    homePath: options.homePath,
    profile: options.profile,
    token: {
      ...refreshed,
      login: token.login,
    },
    now,
  });
}

function tokenState(
  token: NexusGitHubAppUserTokenRecord,
  now: Date,
): NexusGitHubAppUserTokenState {
  if (!token.expiresAt || new Date(token.expiresAt).getTime() > now.getTime()) {
    return "authorized";
  }
  if (
    token.refreshToken &&
    (!token.refreshTokenExpiresAt ||
      new Date(token.refreshTokenExpiresAt).getTime() > now.getTime())
  ) {
    return "expired_refreshable";
  }
  return "expired";
}

async function requestDeviceCode(
  fetchFn: NexusGitHubAppUserAuthFetch,
  webBaseUrl: string,
  clientId: string,
): Promise<GitHubDeviceCodeResponse> {
  const response = await oauthRequest<GitHubDeviceCodeResponse>(
    fetchFn,
    `${webBaseUrl}/login/device/code`,
    { client_id: clientId },
  );
  if (response.error) {
    throw new Error(response.error_description ?? response.error);
  }
  return response;
}

async function pollDeviceToken(options: {
  fetch: NexusGitHubAppUserAuthFetch;
  webBaseUrl: string;
  clientId: string;
  deviceCode: string;
  intervalSeconds: number;
  maxPolls: number;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => Date;
}): Promise<NexusGitHubAppUserTokenInput> {
  let intervalSeconds = options.intervalSeconds;
  for (let attempt = 0; attempt < options.maxPolls; attempt += 1) {
    const response = await oauthRequest<GitHubOAuthTokenResponse>(
      options.fetch,
      `${options.webBaseUrl}/login/oauth/access_token`,
      {
        client_id: options.clientId,
        device_code: options.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
    );
    if (!response.error) {
      return normalizeOAuthToken(response, options.now());
    }
    if (response.error === "authorization_pending") {
      await options.sleep(intervalSeconds * 1000);
      continue;
    }
    if (response.error === "slow_down") {
      intervalSeconds = positiveNumber(response.interval, intervalSeconds + 5);
      await options.sleep(intervalSeconds * 1000);
      continue;
    }
    throw new Error(response.error_description ?? response.error);
  }
  throw new Error("GitHub App user device authorization did not complete before the device code expired.");
}

function normalizeOAuthToken(
  response: GitHubOAuthTokenResponse,
  now: Date,
): NexusGitHubAppUserTokenInput {
  const accessToken = requiredString(response.access_token, "access_token");
  return {
    accessToken,
    expiresAt:
      typeof response.expires_in === "number"
        ? new Date(now.getTime() + response.expires_in * 1000).toISOString()
        : null,
    refreshToken: response.refresh_token ?? null,
    refreshTokenExpiresAt:
      typeof response.refresh_token_expires_in === "number"
        ? new Date(now.getTime() + response.refresh_token_expires_in * 1000).toISOString()
        : null,
    tokenType: response.token_type ?? "bearer",
  };
}

async function readGitHubLogin(
  fetchFn: NexusGitHubAppUserAuthFetch,
  apiBaseUrl: string,
  accessToken: string,
): Promise<string> {
  const response = await fetchFn(`${apiBaseUrl}/user`, {
    method: "GET",
    headers: githubJsonHeaders(`Bearer ${accessToken}`),
  });
  const body = await responseJson<GitHubUserResponse>(response);
  if (!response.ok) {
    throw new Error(`GET /user failed: ${response.status}`);
  }
  return requiredString(body.login, "login");
}

async function oauthRequest<T>(
  fetchFn: NexusGitHubAppUserAuthFetch,
  url: string,
  body: Record<string, string>,
): Promise<T> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "dev-nexus",
    },
    body: new URLSearchParams(body).toString(),
  });
  return responseJson<T>(response);
}

async function responseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text) as T;
  }
  return Object.fromEntries(new URLSearchParams(text)) as T;
}

function parseStoredToken(
  value: unknown,
  filePath: string,
): NexusGitHubAppUserTokenRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`GitHub App user token store ${filePath} must contain an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    version: 1,
    provider: "github",
    host: requiredString(record.host, "host"),
    profileId: requiredString(record.profileId, "profileId"),
    clientId: requiredString(record.clientId, "clientId"),
    accessToken: requiredString(record.accessToken, "accessToken"),
    expiresAt: optionalStringOrNull(record.expiresAt),
    refreshToken: optionalStringOrNull(record.refreshToken),
    refreshTokenExpiresAt: optionalStringOrNull(record.refreshTokenExpiresAt),
    login: optionalStringOrNull(record.login),
    tokenType: optionalStringOrNull(record.tokenType) ?? "bearer",
    updatedAt: requiredString(record.updatedAt, "updatedAt"),
  };
}

function githubAppUserClientId(profile: NexusHostingAuthProfileConfig): string {
  if (profile.credentialKind !== "github_app_user_token") {
    throw new Error(`Auth profile ${profile.id} must use credentialKind=github_app_user_token.`);
  }
  return requiredString(profile.githubApp?.clientId, "githubApp.clientId");
}

function assertExpectedLogin(
  profile: NexusHostingAuthProfileConfig,
  login: string,
): void {
  if (
    profile.account?.trim() &&
    profile.account.trim().toLowerCase() !== login.toLowerCase()
  ) {
    throw new Error(
      `GitHub App user token resolved ${login}, but auth profile ${profile.id} expects ${profile.account}.`,
    );
  }
}

function githubWebBaseUrl(profile: NexusHostingAuthProfileConfig): string {
  const host = normalizeGitHubHost(profile.host);
  return host === "github.com" ? "https://github.com" : `https://${host}`;
}

function githubApiBaseUrl(profile: NexusHostingAuthProfileConfig): string {
  const host = normalizeGitHubHost(profile.host);
  return host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
}

function normalizeGitHubHost(host?: string | null): string {
  const value = host?.trim();
  if (!value || value === "https://github.com" || value === "api.github.com") {
    return "github.com";
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const url = new URL(value);
    return url.hostname === "api.github.com" ? "github.com" : url.host;
  }
  return value;
}

function githubJsonHeaders(authorization: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: authorization,
    "User-Agent": "dev-nexus",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function safeTokenFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, "_");
}

function requiredString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName} must be a non-empty string`);
  }
  return value;
}

function optionalStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requiredString(value, "stored token value");
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}
