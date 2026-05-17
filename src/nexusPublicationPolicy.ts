import { spawnSync } from "node:child_process";
import process from "node:process";
import type {
  GitCommandResult,
  GitRunner,
} from "./gitWorktreeService.js";
import {
  defaultGitRunner,
} from "./gitWorktreeService.js";
import {
  defaultNexusAutomationConfig,
  type NexusAutomationPublicationConfig,
  type NexusPublicationActorConfig,
} from "./nexusAutomationConfig.js";
import type { NexusProjectConfig } from "./nexusProjectConfig.js";
import type { ResolvedNexusProjectComponent } from "./nexusProjectLifecycle.js";

export type NexusPublicationGuardAction =
  | "status"
  | "git_push"
  | "provider_write";

export interface NexusPublicationCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type NexusPublicationActorRunner = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
) => NexusPublicationCommandResult;

export interface NexusPublicationGitStatus {
  repositoryPath: string | null;
  branch: string | null;
  upstream: string | null;
  upstreamRemote: string | null;
  upstreamBranch: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  pushUrl: string | null;
  targetBranch: string | null;
  warnings: string[];
}

export type NexusPublicationActorStatusKind =
  | "not_configured"
  | "matched"
  | "mismatched"
  | "unchecked"
  | "unavailable";

export interface NexusPublicationObservedActor {
  provider: string;
  handle: string;
  source: string;
}

export interface NexusPublicationActorStatus {
  status: NexusPublicationActorStatusKind;
  expected: NexusPublicationActorConfig | null;
  observed: NexusPublicationObservedActor | null;
  commandEnvironment: Record<string, string>;
  message: string;
}

export interface NexusPublicationPolicyCheck {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface NexusPublicationStatus {
  componentId: string;
  sourceRoot: string;
  action: NexusPublicationGuardAction;
  policy: NexusAutomationPublicationConfig;
  git: NexusPublicationGitStatus;
  actor: NexusPublicationActorStatus;
  checks: NexusPublicationPolicyCheck[];
  blocking: boolean;
  warnings: string[];
}

export class NexusPublicationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusPublicationPolicyError";
  }
}

export function resolveNexusPublicationPolicy(
  projectConfig: NexusProjectConfig,
  component?: Pick<ResolvedNexusProjectComponent, "publication">,
): NexusAutomationPublicationConfig {
  const projectPublication =
    projectConfig.automation?.publication ??
    defaultNexusAutomationConfig.publication;
  const componentPublication = component?.publication ?? {};

  return {
    ...defaultNexusAutomationConfig.publication,
    ...projectPublication,
    ...componentPublication,
    actor:
      Object.prototype.hasOwnProperty.call(componentPublication, "actor")
        ? componentPublication.actor ?? null
        : projectPublication.actor ?? null,
    manualActor:
      Object.prototype.hasOwnProperty.call(componentPublication, "manualActor")
        ? componentPublication.manualActor ?? null
        : projectPublication.manualActor ?? null,
    commandEnvironment: {
      ...defaultNexusAutomationConfig.publication.commandEnvironment,
      ...projectPublication.commandEnvironment,
      ...componentPublication.commandEnvironment,
    },
  };
}

export function getNexusPublicationStatus(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  action?: NexusPublicationGuardAction;
  gitRunner?: GitRunner;
  actorRunner?: NexusPublicationActorRunner;
  env?: NodeJS.ProcessEnv;
}): NexusPublicationStatus {
  const action = options.action ?? "status";
  const policy = resolveNexusPublicationPolicy(
    options.projectConfig,
    options.component,
  );
  const git = readPublicationGitStatus({
    component: options.component,
    projectConfig: options.projectConfig,
    policy,
    gitRunner: options.gitRunner ?? defaultGitRunner,
  });
  const actor = readPublicationActorStatus({
    component: options.component,
    policy,
    cwd: git.repositoryPath ?? options.component.sourceRoot,
    actorRunner: options.actorRunner ?? defaultPublicationActorRunner,
    baseEnv: options.env ?? process.env,
  });
  const strict = publicationPolicyRequiresGuard(policy, action);
  const checks = publicationPolicyChecks({
    component: options.component,
    policy,
    git,
    actor,
    strict,
  });
  const warnings = [
    ...git.warnings,
    ...(actor.status === "unchecked" || actor.status === "unavailable"
      ? [actor.message]
      : []),
  ];

  return {
    componentId: options.component.id,
    sourceRoot: options.component.sourceRoot,
    action,
    policy,
    git,
    actor,
    checks,
    blocking: checks.some((check) => check.status === "failed"),
    warnings,
  };
}

export function getNexusPublicationStatuses(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  components: ResolvedNexusProjectComponent[];
  action?: NexusPublicationGuardAction;
  gitRunner?: GitRunner;
  actorRunner?: NexusPublicationActorRunner;
  env?: NodeJS.ProcessEnv;
}): NexusPublicationStatus[] {
  return options.components.map((component) =>
    getNexusPublicationStatus({
      projectRoot: options.projectRoot,
      projectConfig: options.projectConfig,
      component,
      action: options.action,
      gitRunner: options.gitRunner,
      actorRunner: options.actorRunner,
      env: options.env,
    }),
  );
}

export function assertNexusPublicationGuard(status: NexusPublicationStatus): void {
  const failed = status.checks.filter((check) => check.status === "failed");
  if (failed.length === 0) {
    return;
  }

  throw new NexusPublicationPolicyError(
    failed.map((check) => check.message).join("; "),
  );
}

export function publicationPreflightChecks(
  statuses: NexusPublicationStatus[],
): NexusPublicationPolicyCheck[] {
  return statuses.flatMap((status) => status.checks);
}

export function publicationCommandEnvironment(
  policy: NexusAutomationPublicationConfig,
): Record<string, string> {
  return { ...policy.commandEnvironment };
}

export function publicationEnvironmentVariables(
  policy: NexusAutomationPublicationConfig,
): NodeJS.ProcessEnv {
  return {
    DEV_NEXUS_PUBLICATION_REMOTE: policy.remote ?? "",
    DEV_NEXUS_PUBLICATION_TARGET_BRANCH: policy.targetBranch ?? "",
    DEV_NEXUS_PUBLICATION_ACTOR_KIND: policy.actor?.kind ?? "",
    DEV_NEXUS_PUBLICATION_ACTOR_PROVIDER: policy.actor?.provider ?? "",
    DEV_NEXUS_PUBLICATION_ACTOR_HANDLE: policy.actor?.handle ?? "",
    DEV_NEXUS_PUBLICATION_MANUAL_REMOTE: policy.manualRemote ?? "",
    DEV_NEXUS_PUBLICATION_MANUAL_ACTOR_KIND: policy.manualActor?.kind ?? "",
    DEV_NEXUS_PUBLICATION_MANUAL_ACTOR_PROVIDER:
      policy.manualActor?.provider ?? "",
    DEV_NEXUS_PUBLICATION_MANUAL_ACTOR_HANDLE:
      policy.manualActor?.handle ?? "",
    DEV_NEXUS_PUBLICATION_COMMAND_ENV_KEYS: Object.keys(
      policy.commandEnvironment,
    )
      .sort()
      .join(","),
  };
}

function readPublicationGitStatus(options: {
  component: ResolvedNexusProjectComponent;
  projectConfig: NexusProjectConfig;
  policy: NexusAutomationPublicationConfig;
  gitRunner: GitRunner;
}): NexusPublicationGitStatus {
  const repositoryPath = gitStdout(
    runOptionalGit(
      options.gitRunner,
      ["rev-parse", "--show-toplevel"],
      options.component.sourceRoot,
    ),
  );
  const warnings: string[] = [];
  if (!repositoryPath) {
    return {
      repositoryPath: null,
      branch: null,
      upstream: null,
      upstreamRemote: null,
      upstreamBranch: null,
      remoteName: options.policy.remote,
      remoteUrl: null,
      pushUrl: null,
      targetBranch:
        options.policy.targetBranch ??
        options.component.defaultBranch ??
        options.projectConfig.repo.defaultBranch,
      warnings: [
        `No Git repository could be resolved for component ${options.component.id}.`,
      ],
    };
  }

  const branch = gitStdout(
    runOptionalGit(
      options.gitRunner,
      ["symbolic-ref", "--short", "HEAD"],
      repositoryPath,
    ),
  );
  const upstream = gitStdout(
    runOptionalGit(
      options.gitRunner,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      repositoryPath,
    ),
  );
  const upstreamParts = splitUpstream(upstream);
  const remoteName =
    options.policy.remote ??
    upstreamParts.remote ??
    defaultNexusAutomationConfig.publication.remote;
  const remoteUrl = remoteName
    ? gitStdout(
        runOptionalGit(
          options.gitRunner,
          ["remote", "get-url", remoteName],
          repositoryPath,
        ),
      )
    : null;
  const pushUrl = remoteName
    ? gitStdout(
        runOptionalGit(
          options.gitRunner,
          ["remote", "get-url", "--push", remoteName],
          repositoryPath,
        ),
      ) ?? remoteUrl
    : null;
  if (!upstream) {
    warnings.push("Current branch has no upstream configured.");
  }
  if (upstreamParts.remote && remoteName && upstreamParts.remote !== remoteName) {
    warnings.push(
      `Current upstream uses remote ${upstreamParts.remote}, not configured publication remote ${remoteName}.`,
    );
  }

  return {
    repositoryPath,
    branch,
    upstream,
    upstreamRemote: upstreamParts.remote,
    upstreamBranch: upstreamParts.branch,
    remoteName,
    remoteUrl,
    pushUrl,
    targetBranch:
      options.policy.targetBranch ??
      upstreamParts.branch ??
      options.component.defaultBranch ??
      options.projectConfig.repo.defaultBranch,
    warnings,
  };
}

function readPublicationActorStatus(options: {
  component: ResolvedNexusProjectComponent;
  policy: NexusAutomationPublicationConfig;
  cwd: string;
  actorRunner: NexusPublicationActorRunner;
  baseEnv: NodeJS.ProcessEnv;
}): NexusPublicationActorStatus {
  const expected = options.policy.actor;
  const commandEnvironment = publicationCommandEnvironment(options.policy);
  if (!expected) {
    return {
      status: "not_configured",
      expected: null,
      observed: null,
      commandEnvironment,
      message: "No automated publication actor is configured.",
    };
  }

  const provider = expected.provider?.toLowerCase() ?? null;
  if (provider !== "github") {
    return {
      status: "unchecked",
      expected,
      observed: null,
      commandEnvironment,
      message: `Publication actor provider ${expected.provider ?? "unknown"} is not checked by DevNexus core.`,
    };
  }

  const host = githubActorHost(options.component);
  const args =
    expected.kind === "app"
      ? ["api", "app", "--jq", ".slug", "--hostname", host]
      : ["api", "user", "--jq", ".login", "--hostname", host];
  const result = options.actorRunner("gh", args, {
    cwd: options.cwd,
    env: {
      ...options.baseEnv,
      ...commandEnvironment,
    },
  });
  if (result.status !== 0 || result.error) {
    const detail =
      result.stderr.trim() || result.stdout.trim() || result.error?.message;
    return {
      status: "unavailable",
      expected,
      observed: null,
      commandEnvironment,
      message: detail
        ? `Observed GitHub actor could not be checked: ${detail}`
        : "Observed GitHub actor could not be checked.",
    };
  }

  const handle = result.stdout.trim();
  if (!handle) {
    return {
      status: "unavailable",
      expected,
      observed: null,
      commandEnvironment,
      message: "Observed GitHub actor command returned an empty handle.",
    };
  }

  const observed = {
    provider: "github",
    handle,
    source: expected.kind === "app" ? "github_cli_app" : "github_cli_user",
  };
  const expectedHandle = expected.handle;
  if (!expectedHandle) {
    return {
      status: "unchecked",
      expected,
      observed,
      commandEnvironment,
      message: "Publication actor has no expected handle to compare.",
    };
  }

  const matched = handlesEqual(expectedHandle, observed.handle);
  return {
    status: matched ? "matched" : "mismatched",
    expected,
    observed,
    commandEnvironment,
    message: matched
      ? `Observed ${observed.provider} actor ${observed.handle} matches publication policy.`
      : `Observed ${observed.provider} actor ${observed.handle} does not match expected actor ${expectedHandle}.`,
  };
}

export function publicationPolicyRequiresGuard(
  policy: NexusAutomationPublicationConfig,
  action: NexusPublicationGuardAction,
): boolean {
  return (
    action !== "status" ||
    policy.push ||
    policy.strategy === "direct_integration" ||
    Boolean(
      policy.remoteUrl ||
        policy.pushUrl ||
        policy.sshHostAlias ||
        policy.actor,
    )
  );
}

function publicationPolicyChecks(options: {
  component: ResolvedNexusProjectComponent;
  policy: NexusAutomationPublicationConfig;
  git: NexusPublicationGitStatus;
  actor: NexusPublicationActorStatus;
  strict: boolean;
}): NexusPublicationPolicyCheck[] {
  const checks: NexusPublicationPolicyCheck[] = [];
  const prefix = `publication:${options.component.id}`;
  const remoteName = options.policy.remote;
  if (remoteName && options.strict) {
    checks.push(
      check(
        `${prefix}:remote`,
        options.git.remoteName === remoteName && Boolean(options.git.remoteUrl),
        `Publication remote ${remoteName} is configured`,
        `Publication remote ${remoteName} is not available in ${options.component.sourceRoot}`,
      ),
    );
  }

  if (options.policy.remoteUrl) {
    checks.push(
      check(
        `${prefix}:remoteUrl`,
        matchesExpectedUrl(options.policy.remoteUrl, [
          options.git.remoteUrl,
          options.git.pushUrl,
        ]),
        `Publication remote URL matches ${options.policy.remoteUrl}`,
        `Publication remote URL mismatch for ${options.component.id}: expected ${options.policy.remoteUrl}, observed ${options.git.remoteUrl ?? "unknown"}`,
      ),
    );
  }

  if (options.policy.pushUrl) {
    checks.push(
      check(
        `${prefix}:pushUrl`,
        normalizeUrl(options.git.pushUrl) ===
          normalizeUrl(options.policy.pushUrl),
        `Publication push URL matches ${options.policy.pushUrl}`,
        `Publication push URL mismatch for ${options.component.id}: expected ${options.policy.pushUrl}, observed ${options.git.pushUrl ?? "unknown"}`,
      ),
    );
  }

  if (options.policy.sshHostAlias) {
    checks.push(
      check(
        `${prefix}:sshHostAlias`,
        [options.git.pushUrl, options.git.remoteUrl].some(
          (url) => sshHostAlias(url) === options.policy.sshHostAlias,
        ),
        `Publication SSH host alias matches ${options.policy.sshHostAlias}`,
        `Publication SSH host alias mismatch for ${options.component.id}: expected ${options.policy.sshHostAlias}, observed ${sshHostAlias(options.git.pushUrl ?? options.git.remoteUrl) ?? "unknown"}`,
      ),
    );
  }

  if (options.policy.actor && options.strict) {
    checks.push(
      check(
        `${prefix}:actor`,
        options.actor.status === "matched" || options.actor.status === "unchecked",
        options.actor.message,
        options.actor.message,
      ),
    );
  }

  return checks;
}

function defaultPublicationActorRunner(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): NexusPublicationCommandResult {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function runOptionalGit(
  gitRunner: GitRunner,
  args: readonly string[],
  cwd: string,
): GitCommandResult | null {
  try {
    const result = gitRunner(args, cwd);
    return result.exitCode === 0 ? result : null;
  } catch {
    return null;
  }
}

function gitStdout(result: GitCommandResult | null): string | null {
  const value = result?.stdout.trim();
  return value ? value : null;
}

function splitUpstream(
  upstream: string | null,
): { remote: string | null; branch: string | null } {
  if (!upstream) {
    return { remote: null, branch: null };
  }
  const separator = upstream.indexOf("/");
  if (separator <= 0 || separator === upstream.length - 1) {
    return { remote: null, branch: upstream };
  }

  return {
    remote: upstream.slice(0, separator),
    branch: upstream.slice(separator + 1),
  };
}

function matchesExpectedUrl(expected: string, observed: Array<string | null>): boolean {
  const normalizedExpected = normalizeUrl(expected);
  return observed.some((value) => normalizeUrl(value) === normalizedExpected);
}

function normalizeUrl(value: string | null): string | null {
  return value?.trim().replace(/\/+$/u, "") || null;
}

function sshHostAlias(value: string | null): string | null {
  const remote = value?.trim();
  if (!remote) {
    return null;
  }
  const scpLike = /^[^@\s]+@([^:\s]+):/u.exec(remote);
  if (scpLike?.[1]) {
    return scpLike[1];
  }
  try {
    const url = new URL(remote);
    return url.hostname || null;
  } catch {
    return null;
  }
}

function githubActorHost(component: ResolvedNexusProjectComponent): string {
  const host = component.workTracking?.host?.trim();
  if (!host || host === "https://github.com" || host === "api.github.com") {
    return "github.com";
  }
  return host
    .replace(/^https?:\/\//u, "")
    .replace(/^api\./u, "")
    .replace(/\/+$/u, "");
}

function handlesEqual(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function check(
  name: string,
  passed: boolean,
  passedMessage: string,
  failedMessage: string,
): NexusPublicationPolicyCheck {
  return {
    name,
    status: passed ? "passed" : "failed",
    message: passed ? passedMessage : failedMessage,
  };
}
