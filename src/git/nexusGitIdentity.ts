import type {
  GitCommandResult,
  GitRunner,
} from "../worktrees/gitWorktreeService.js";
import type {
  NexusAutomationPublicationConfig,
  NexusPublicationActorConfig,
} from "../automation/nexusAutomationConfig.js";
import type { NexusHostingAuthProfileConfig } from "../project/nexusProjectHosting.js";

export type NexusGitIdentityStatusKind =
  | "not_configured"
  | "matched"
  | "mismatched"
  | "unchecked"
  | "unavailable";

export interface NexusExpectedGitIdentity {
  name: string | null;
  email: string | null;
  source: string;
  warnings: string[];
}

export interface NexusObservedGitIdentity {
  name: string | null;
  email: string | null;
  localName: string | null;
  localEmail: string | null;
  source: "local" | "inherited" | "unconfigured" | "unavailable";
  warnings: string[];
}

export interface NexusGitIdentityStatus {
  status: NexusGitIdentityStatusKind;
  expected: NexusExpectedGitIdentity | null;
  observed: NexusObservedGitIdentity;
  message: string;
}

export function resolveExpectedAutomationGitIdentity(options: {
  publication: NexusAutomationPublicationConfig;
  authProfiles?: NexusHostingAuthProfileConfig[];
}): NexusExpectedGitIdentity | null {
  const actor = options.publication.actor;
  if (!actor) {
    return null;
  }

  const commandEnvironment = options.publication.commandEnvironment;
  const profile = findPublicationActorAuthProfile(actor, options.authProfiles);
  const publicationGitIdentity = options.publication.gitIdentity;
  const envName =
    matchingEnvironmentValue(commandEnvironment, [
      "GIT_AUTHOR_NAME",
      "GIT_COMMITTER_NAME",
    ]) ?? null;
  const envEmail =
    matchingEnvironmentValue(commandEnvironment, [
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_EMAIL",
    ]) ?? null;
  const githubNoReplyEmail = explicitGithubNoReplyEmail(actor);
  const name =
    envName ??
    publicationGitIdentity?.name ??
    profile?.gitUserName ??
    profile?.account ??
    actor.handle ??
    actor.id ??
    null;
  const email =
    envEmail ??
    publicationGitIdentity?.email ??
    profile?.gitUserEmail ??
    githubNoReplyEmail ??
    null;
  const source = expectedGitIdentitySource({
    envName,
    envEmail,
    publicationGitIdentity,
    profile,
    githubNoReplyEmail,
  });
  const warnings: string[] = [];
  if (!email) {
    warnings.push(
      "Expected Git email is not configured; add authProfiles[].gitUserEmail or explicit GIT_AUTHOR_EMAIL/GIT_COMMITTER_EMAIL.",
    );
  }
  if (!name) {
    warnings.push(
      "Expected Git user name is not configured; add authProfiles[].gitUserName or explicit GIT_AUTHOR_NAME/GIT_COMMITTER_NAME.",
    );
  }

  return {
    name,
    email,
    source,
    warnings,
  };
}

function expectedGitIdentitySource(options: {
  envName: string | null;
  envEmail: string | null;
  publicationGitIdentity: NexusAutomationPublicationConfig["gitIdentity"];
  profile: NexusHostingAuthProfileConfig | null;
  githubNoReplyEmail: string | null;
}): string {
  if (options.envName || options.envEmail) {
    return "publication.commandEnvironment";
  }
  if (
    options.publicationGitIdentity?.name ||
    options.publicationGitIdentity?.email
  ) {
    return "publication.gitIdentity";
  }
  if (options.profile?.gitUserName || options.profile?.gitUserEmail) {
    return `authProfile:${options.profile.id}`;
  }
  if (options.githubNoReplyEmail) {
    return "publication.actor.github_noreply";
  }
  if (options.profile) {
    return `authProfile:${options.profile.id}`;
  }
  return "publication.actor";
}

export function readObservedGitIdentity(options: {
  repositoryPath: string;
  gitRunner: GitRunner;
}): NexusObservedGitIdentity {
  const localName = gitConfigValue(
    options.gitRunner,
    ["config", "--local", "--get", "user.name"],
    options.repositoryPath,
  );
  const localEmail = gitConfigValue(
    options.gitRunner,
    ["config", "--local", "--get", "user.email"],
    options.repositoryPath,
  );
  const effectiveName = gitConfigValue(
    options.gitRunner,
    ["config", "--get", "user.name"],
    options.repositoryPath,
  );
  const effectiveEmail = gitConfigValue(
    options.gitRunner,
    ["config", "--get", "user.email"],
    options.repositoryPath,
  );

  return {
    name: effectiveName,
    email: effectiveEmail,
    localName,
    localEmail,
    source:
      localName || localEmail
        ? "local"
        : effectiveName || effectiveEmail
          ? "inherited"
          : "unconfigured",
    warnings: [],
  };
}

export function compareGitIdentity(options: {
  expected: NexusExpectedGitIdentity | null;
  observed: NexusObservedGitIdentity;
}): NexusGitIdentityStatus {
  if (!options.expected) {
    return {
      status: "not_configured",
      expected: null,
      observed: options.observed,
      message: "No automated Git identity is configured.",
    };
  }

  const expected = options.expected;
  if (!expected.name || !expected.email) {
    return {
      status: "unchecked",
      expected,
      observed: options.observed,
      message: expected.warnings.join(" "),
    };
  }

  if (!options.observed.name || !options.observed.email) {
    return {
      status: "unavailable",
      expected,
      observed: options.observed,
      message: "Observed Git user.name/user.email could not be resolved.",
    };
  }

  const matched =
    identityNameEqual(expected.name, options.observed.name) &&
    identityEmailEqual(expected.email, options.observed.email);
  return {
    status: matched ? "matched" : "mismatched",
    expected,
    observed: options.observed,
    message: matched
      ? `Observed Git identity ${options.observed.name} <${options.observed.email}> matches automation identity.`
      : `Observed Git identity ${options.observed.name} <${options.observed.email}> does not match expected automation identity ${expected.name} <${expected.email}>.`,
  };
}

export function gitIdentityEnvironment(
  expected: NexusExpectedGitIdentity | null,
): Record<string, string> {
  if (!expected?.name || !expected.email) {
    return {};
  }

  return {
    GIT_AUTHOR_NAME: expected.name,
    GIT_AUTHOR_EMAIL: expected.email,
    GIT_COMMITTER_NAME: expected.name,
    GIT_COMMITTER_EMAIL: expected.email,
  };
}

function findPublicationActorAuthProfile(
  actor: NexusPublicationActorConfig,
  authProfiles: NexusHostingAuthProfileConfig[] | undefined,
): NexusHostingAuthProfileConfig | null {
  const provider = actor.provider?.toLowerCase() ?? null;
  return (
    authProfiles?.find((profile) => {
      if (profile.provider.toLowerCase() !== provider) {
        return false;
      }
      if (actor.id && profile.actorId === actor.id) {
        return true;
      }
      return Boolean(
        actor.handle &&
          profile.account &&
          identityNameEqual(actor.handle, profile.account),
      );
    }) ?? null
  );
}

function explicitGithubNoReplyEmail(
  actor: NexusPublicationActorConfig,
): string | null {
  if (actor.provider?.toLowerCase() !== "github" || !actor.handle) {
    return null;
  }
  if (actor.id && /^\d+$/u.test(actor.id)) {
    return `${actor.id}+${actor.handle}@users.noreply.github.com`;
  }

  return null;
}

function matchingEnvironmentValue(
  commandEnvironment: Record<string, string>,
  keys: readonly string[],
): string | null {
  const values = keys
    .map((key) => commandEnvironment[key]?.trim())
    .filter((value): value is string => Boolean(value));
  if (values.length === 0) {
    return null;
  }
  const first = values[0]!;
  return values.every((value) => value === first) ? first : null;
}

function gitConfigValue(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): string | null {
  try {
    const result: GitCommandResult = gitRunner(args, cwd);
    if (result.exitCode !== 0) {
      return null;
    }
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

function identityNameEqual(left: string, right: string): boolean {
  return left.trim() === right.trim();
}

function identityEmailEqual(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
