import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import type {
  GitCommandResult,
  GitRunner,
} from "./gitWorktreeService.js";
import {
  defaultGitRunner,
} from "./gitWorktreeService.js";
import {
  resolveNexusCurrentAutomationActor,
  resolveNexusEffectiveAuthority,
  type NexusAuthorityAction,
  type NexusAuthorityProviderState,
  type NexusEffectiveAuthorityResolution,
} from "./nexusAuthority.js";
import {
  defaultNexusAutomationConfig,
  type NexusAutomationPublicationConfig,
  type NexusPublicationActorConfig,
} from "./nexusAutomationConfig.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import { resolveNexusProjectPath } from "./nexusPathResolver.js";
import type { NexusProjectConfig } from "./nexusProjectConfig.js";
import type { NexusHostingAuthProfileConfig } from "./nexusProjectHosting.js";
import type { ResolvedNexusProjectComponent } from "./nexusProjectLifecycle.js";

export type NexusPublicationGuardAction =
  | "status"
  | "git_push"
  | "provider_write"
  | "provider_pull_request_merge"
  | "provider_review_approve"
  | "package_publish"
  | "release_publish";

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
  authority: NexusEffectiveAuthorityResolution | null;
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
  authProfiles?: NexusHostingAuthProfileConfig[];
  homePath?: string;
  providerState?: NexusAuthorityProviderState | null;
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
    projectRoot: options.projectRoot,
    component: options.component,
    policy,
    cwd: git.repositoryPath ?? options.component.sourceRoot,
    actorRunner: options.actorRunner ?? defaultPublicationActorRunner,
    baseEnv: options.env ?? process.env,
  });
  const authProfiles =
    options.authProfiles ??
    loadNexusPublicationAuthProfiles({
      projectRoot: options.projectRoot,
      projectConfig: options.projectConfig,
      homePath: options.homePath,
    });
  const authority = resolvePublicationAuthority({
    projectConfig: options.projectConfig,
    component: options.component,
    policy,
    git,
    action,
    authProfiles,
    providerState: options.providerState ?? null,
  });
  const strict = publicationPolicyRequiresGuard(policy, action);
  const checks = publicationPolicyChecks({
    component: options.component,
    policy,
    git,
    actor,
    authority,
    strict,
  });
  const warnings = [
    ...git.warnings,
    ...(actor.status === "unchecked" || actor.status === "unavailable"
      ? [actor.message]
      : []),
    ...(authority && !authority.allowed && authority.fallbackSuggestion
      ? [authority.fallbackSuggestion]
      : []),
  ];

  return {
    componentId: options.component.id,
    sourceRoot: options.component.sourceRoot,
    action,
    policy,
    git,
    actor,
    authority,
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
  authProfiles?: NexusHostingAuthProfileConfig[];
  homePath?: string;
  providerState?: NexusAuthorityProviderState | null;
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
      authProfiles: options.authProfiles,
      homePath: options.homePath,
      providerState: options.providerState,
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
  options: { projectRoot?: string } = {},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(policy.commandEnvironment).map(([key, value]) => [
      key,
      resolvePublicationCommandEnvironmentValue(
        value,
        options.projectRoot ?? process.cwd(),
      ),
    ]),
  );
}

function resolvePublicationCommandEnvironmentValue(
  value: string,
  projectRoot: string,
): string {
  if (/^(projectRoot|projectParent|home|sourcesRoot):/u.test(value)) {
    return resolveNexusProjectPath({ projectRoot, value });
  }

  return value;
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
    DEV_NEXUS_PUBLICATION_PACKAGE_PUBLISH: String(policy.packagePublish),
    DEV_NEXUS_PUBLICATION_RELEASE_PUBLISH: String(policy.releasePublish),
    DEV_NEXUS_PUBLICATION_COMMAND_ENV_KEYS: Object.keys(
      policy.commandEnvironment,
    )
      .sort()
      .join(","),
  };
}

export function loadNexusPublicationAuthProfiles(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  homePath?: string;
}): NexusHostingAuthProfileConfig[] {
  const homePath = options.homePath
    ? path.resolve(options.homePath)
    : options.projectConfig.home
      ? resolveNexusProjectPath({
          projectRoot: options.projectRoot,
          value: options.projectConfig.home,
        })
      : defaultNexusHomePath();
  try {
    return loadNexusHomeConfigFile(
      homePath,
      validateNexusHomeConfigBase,
    ).authProfiles ?? [];
  } catch {
    return [];
  }
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
  projectRoot: string;
  component: ResolvedNexusProjectComponent;
  policy: NexusAutomationPublicationConfig;
  cwd: string;
  actorRunner: NexusPublicationActorRunner;
  baseEnv: NodeJS.ProcessEnv;
}): NexusPublicationActorStatus {
  const expected = options.policy.actor;
  const commandEnvironment = publicationCommandEnvironment(options.policy, {
    projectRoot: options.projectRoot,
  });
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
  authority: NexusEffectiveAuthorityResolution | null;
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

  if (options.authority && options.strict) {
    const failedMessage = [
      options.authority.explanation,
      ...(options.authority.blockingReasons.length > 0
        ? [`Reasons: ${options.authority.blockingReasons.join(" ")}`]
        : []),
      ...(options.authority.fallbackSuggestion
        ? [`Fallback: ${options.authority.fallbackSuggestion}`]
        : []),
    ].join(" ");
    checks.push(
      check(
        `${prefix}:authority:${options.authority.requestedAction}`,
        options.authority.allowed,
        options.authority.explanation,
        failedMessage,
      ),
    );
  }

  return checks;
}

function resolvePublicationAuthority(options: {
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  policy: NexusAutomationPublicationConfig;
  git: NexusPublicationGitStatus;
  action: NexusPublicationGuardAction;
  authProfiles: NexusHostingAuthProfileConfig[];
  providerState: NexusAuthorityProviderState | null;
}): NexusEffectiveAuthorityResolution | null {
  const requestedAction = publicationAuthorityAction(
    options.action,
    options.policy,
  );
  if (!requestedAction) {
    return null;
  }

  const currentActor = resolveNexusCurrentAutomationActor({
    authority: options.projectConfig.authority,
    componentId: options.component.id,
    publication: options.policy,
    authProfiles: options.authProfiles,
  });
  const authProfile = currentActor.profileId
    ? options.authProfiles.find((profile) => profile.id === currentActor.profileId) ??
      null
    : null;

  return resolveNexusEffectiveAuthority({
    authority: options.projectConfig.authority,
    actor: {
      id: currentActor.expectedActorId,
      kind: currentActor.expectedActorKind,
      provider: currentActor.expectedProvider,
      providerIdentity: currentActor.expectedHandle,
    },
    authProfile: authProfile
      ? {
          id: authProfile.id,
          actorId: authProfile.actorId ?? null,
          kind: authProfile.kind ?? null,
          provider: authProfile.provider,
          account: authProfile.account ?? null,
        }
      : null,
    project: options.projectConfig.id,
    component: options.component.id,
    provider:
      options.policy.actor?.provider ??
      options.policy.manualActor?.provider ??
      currentActor.expectedProvider ??
      options.component.workTracking?.provider ??
      null,
    tracker: options.component.defaultTrackerId,
    remote: options.git.remoteName ?? options.policy.remote,
    repository:
      options.component.remoteUrl ??
      options.git.pushUrl ??
      options.git.remoteUrl ??
      null,
    targetBranch: options.git.targetBranch ?? options.policy.targetBranch,
    requestedAction,
    publication: options.policy,
    providerState: options.providerState,
  });
}

function publicationAuthorityAction(
  action: NexusPublicationGuardAction,
  policy: NexusAutomationPublicationConfig,
): NexusAuthorityAction | null {
  switch (action) {
    case "git_push":
      return "git.push_target_branch";
    case "provider_write":
      return "provider.pull_request.open";
    case "provider_pull_request_merge":
      return "provider.pull_request.merge";
    case "provider_review_approve":
      return "provider.review.approve";
    case "package_publish":
      return "package.publish";
    case "release_publish":
      return "release.publish";
    case "status":
      if (policy.strategy === "direct_integration" && policy.push) {
        return "git.push_target_branch";
      }
      if (policy.strategy !== "local_only") {
        return "provider.pull_request.open";
      }
      return null;
  }
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
