import process from "node:process";
import {
  writeJson,
  writeLine,
} from "./cliSupport.js";
import type { DevNexusCliDependencies } from "./cliCommandContext.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  resolveNexusHome,
  validateNexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  deleteNexusGitHubAppUserToken,
  nexusGitHubAppUserTokenStatus,
  runNexusGitHubAppUserDeviceLogin,
} from "./nexusGitHubAppUserAuth.js";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";

interface ParsedAuthCommand {
  action: "login" | "status" | "logout";
  homePath: string;
  profileId: string;
  json: boolean;
}

export async function handleAuthCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  const parsed = parseAuthCommand(argv, dependencies.env ?? process.env);
  const stdout = dependencies.stdout ?? process.stdout;
  const homePath = resolveNexusHome(parsed.homePath);
  const profile = loadAuthProfile(homePath, parsed.profileId);
  if (profile.credentialKind !== "github_app_user_token") {
    throw new Error(`Auth profile ${profile.id} must use credentialKind=github_app_user_token.`);
  }

  if (parsed.action === "status") {
    const status = nexusGitHubAppUserTokenStatus({
      homePath,
      profile,
      now: nowFromDependencies(dependencies),
    });
    if (parsed.json) {
      writeJson(stdout, { ok: true, status });
    } else {
      writeLine(
        stdout,
        `GitHub App user auth ${profile.id}: ${status.state}${
          status.login ? ` as ${status.login}` : ""
        }`,
      );
    }
    return 0;
  }

  if (parsed.action === "logout") {
    const removed = deleteNexusGitHubAppUserToken({
      homePath,
      profileId: profile.id,
    });
    if (parsed.json) {
      writeJson(stdout, { ok: true, profileId: profile.id, removed });
    } else {
      writeLine(
        stdout,
        removed
          ? `Removed GitHub App user auth token for ${profile.id}.`
          : `No GitHub App user auth token was stored for ${profile.id}.`,
      );
    }
    return 0;
  }

  const result = await runNexusGitHubAppUserDeviceLogin({
    homePath,
    profile,
    fetch: dependencies.fetch,
    now: nowFromDependencies(dependencies),
    sleep: dependencies.sleep,
    onDeviceCode: parsed.json
      ? undefined
      : ({ userCode, verificationUri }) => {
          writeLine(
            stdout,
            `Open ${verificationUri} and enter code ${userCode}. Waiting for authorization...`,
          );
        },
  });
  if (parsed.json) {
    writeJson(stdout, { ok: true, result });
  } else {
    writeLine(
      stdout,
      `Authorized ${profile.id} as ${result.login}; token expires ${result.expiresAt ?? "when revoked"}.`,
    );
  }
  return 0;
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
