import process from "node:process";
import {
  type TextWriter,
  writeJson,
  writeLine,
} from "./cliSupport.js";
import type { DevNexusCliDependencies } from "./cliCommandContext.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  resolveNexusHome,
  validateNexusHomeConfigBase,
} from "../project/nexusHomeConfig.js";
import {
  deleteNexusGitHubAppUserToken,
  nexusGitHubAppUserTokenStatus,
  runNexusGitHubAppUserDeviceLogin,
} from "../git/nexusGitHubAppUserAuth.js";
import type { NexusHostingAuthProfileConfig } from "../project/nexusProjectHosting.js";

interface ParsedAuthCommand {
  action: "login" | "status" | "logout";
  homePath: string;
  profileId: string;
  json: boolean;
}

interface AuthCommandContext {
  parsed: ParsedAuthCommand;
  dependencies: DevNexusCliDependencies;
  stdout: TextWriter;
  homePath: string;
  profile: NexusHostingAuthProfileConfig;
}

type AuthActionHandler = (context: AuthCommandContext) => Promise<number>;

export async function handleAuthCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const parsed = parseAuthCommand(argv, dependencies.env ?? process.env);
  const stdout = dependencies.stdout ?? process.stdout;
  const homePath = resolveNexusHome(parsed.homePath);
  const profile = loadAuthProfile(homePath, parsed.profileId);
  assertGitHubAppUserAuthProfile(profile);

  return authActionHandlers[parsed.action]({
    parsed,
    dependencies,
    stdout,
    homePath,
    profile,
  });
}

const authActionHandlers: Record<ParsedAuthCommand["action"], AuthActionHandler> = {
  login: handleAuthLogin,
  logout: handleAuthLogout,
  status: handleAuthStatus,
};

async function handleAuthStatus(context: AuthCommandContext): Promise<number> {
  const status = nexusGitHubAppUserTokenStatus({
    homePath: context.homePath,
    profile: context.profile,
    now: nowFromDependencies(context.dependencies),
  });
  if (context.parsed.json) {
    writeJson(context.stdout, { ok: true, status });
  } else {
    writeLine(
      context.stdout,
      `GitHub App user auth ${context.profile.id}: ${status.state}${
        status.login ? ` as ${status.login}` : ""
      }`,
    );
  }
  return 0;
}

async function handleAuthLogout(context: AuthCommandContext): Promise<number> {
  const removed = deleteNexusGitHubAppUserToken({
    homePath: context.homePath,
    profileId: context.profile.id,
  });
  if (context.parsed.json) {
    writeJson(context.stdout, {
      ok: true,
      profileId: context.profile.id,
      removed,
    });
  } else {
    writeLine(
      context.stdout,
      removed
        ? `Removed GitHub App user auth token for ${context.profile.id}.`
        : `No GitHub App user auth token was stored for ${context.profile.id}.`,
    );
  }
  return 0;
}

async function handleAuthLogin(context: AuthCommandContext): Promise<number> {
  const result = await runNexusGitHubAppUserDeviceLogin({
    homePath: context.homePath,
    profile: context.profile,
    fetch: context.dependencies.fetch,
    now: nowFromDependencies(context.dependencies),
    sleep: context.dependencies.sleep,
    onDeviceCode: context.parsed.json
      ? undefined
      : ({ userCode, verificationUri }) => {
          writeLine(
            context.stdout,
            `Open ${verificationUri} and enter code ${userCode}. Waiting for authorization...`,
          );
        },
  });
  if (context.parsed.json) {
    writeJson(context.stdout, { ok: true, result });
  } else {
    writeLine(
      context.stdout,
      `Authorized ${context.profile.id} as ${result.login}; token expires ${result.expiresAt ?? "when revoked"}.`,
    );
  }
  return 0;
}

function assertGitHubAppUserAuthProfile(
  profile: NexusHostingAuthProfileConfig,
): void {
  if (profile.credentialKind !== "github_app_user_token") {
    throw new Error(
      `Auth profile ${profile.id} must use credentialKind=github_app_user_token.`,
    );
  }
}

function parseAuthCommand(
  argv: string[],
  env: NodeJS.ProcessEnv,
): ParsedAuthCommand {
  if (argv[1] !== "github-app" || argv[2] !== "user") {
    throw new Error("auth requires github-app user");
  }
  const action = argv[3];
  if (action !== "login" && action !== "status" && action !== "logout") {
    throw new Error("auth github-app user requires login, status, or logout");
  }
  let homePath = defaultNexusHomePath();
  let profileId: string | null = null;
  let json = false;
  for (let index = 4; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--home") {
      homePath = requiredNext(argv, index, "--home");
      index += 1;
      continue;
    }
    if (arg === "--profile") {
      profileId = requiredNext(argv, index, "--profile");
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown auth option: ${arg}`);
  }
  profileId ??= env.DEV_NEXUS_AUTH_PROFILE?.trim() || null;
  if (!profileId) {
    throw new Error("auth github-app user requires --profile");
  }
  return {
    action,
    homePath,
    profileId,
    json,
  };
}

function loadAuthProfile(
  homePath: string,
  profileId: string,
): NexusHostingAuthProfileConfig {
  const homeConfig = loadNexusHomeConfigFile(
    homePath,
    validateNexusHomeConfigBase,
  );
  const profile = homeConfig.authProfiles?.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile) {
    throw new Error(`Auth profile ${profileId} is not configured in DevNexus home.`);
  }
  return profile;
}

function nowFromDependencies(
  dependencies: DevNexusCliDependencies,
): (() => Date) | undefined {
  if (!dependencies.now) {
    return undefined;
  }
  return () => {
    const value = dependencies.now!();
    return value instanceof Date ? value : new Date(value);
  };
}

function requiredNext(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}
