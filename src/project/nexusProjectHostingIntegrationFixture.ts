import {
  applyNexusProjectHosting,
  deriveNexusProjectHostingRepositoryName,
  planNexusProjectHosting,
  statusNexusProjectHosting,
  type NexusHostingAuthProfileConfig,
  type NexusProjectHostingApplyActionResult,
  type NexusProjectHostingApplyResult,
  type NexusProjectHostingConfig,
  type NexusProjectHostingLocalRemoteCommand,
  type NexusProjectHostingLocalRemoteCommandResult,
  type NexusProjectHostingLocalRemoteCommandRunner,
  type NexusProjectHostingLocalRemoteRecord,
  type NexusProjectHostingPlanResult,
  type NexusProjectHostingPlanAction,
  type NexusProjectHostingProjectIdentity,
  type NexusProjectHostingProviderAdapter,
  type NexusProjectHostingRepositoryVisibility,
  type NexusProjectHostingStatusResult,
} from "./nexusProjectHosting.js";
import {
  isLowerAsciiIdentifierSegmentCharacter,
  replaceRunsWithHyphen,
  trimHyphens,
} from "../runtime/nexusTextNormalization.js";

const DEFAULT_FIXTURE_PREFIX = "dev-nexus-fixture-";
const DEFAULT_MAX_PASSES = 8;

export const NEXUS_PROJECT_HOSTING_FIXTURE_ENV = {
  enabled: "DEV_NEXUS_HOSTING_FIXTURE_ENABLED",
  namespace: "DEV_NEXUS_HOSTING_FIXTURE_NAMESPACE",
  runId: "DEV_NEXUS_HOSTING_FIXTURE_RUN_ID",
  humanAccount: "DEV_NEXUS_HOSTING_FIXTURE_HUMAN_ACCOUNT",
  automationAccount: "DEV_NEXUS_HOSTING_FIXTURE_AUTOMATION_ACCOUNT",
  humanGithubCliConfigDir: "DEV_NEXUS_HOSTING_FIXTURE_HUMAN_GH_CONFIG_DIR",
  automationGithubCliConfigDir:
    "DEV_NEXUS_HOSTING_FIXTURE_AUTOMATION_GH_CONFIG_DIR",
} as const;

export interface NexusProjectHostingFixtureOptions {
  namespace: string;
  runId?: string;
  repositoryPrefix?: string;
  humanAccount: string;
  automationAccount: string;
  humanGithubCliConfigDir?: string;
  automationGithubCliConfigDir?: string;
  defaultBranch?: string;
  visibility?: NexusProjectHostingRepositoryVisibility;
}

export interface NexusProjectHostingFixtureCleanupResult {
  ok: boolean;
  status: "allowed" | "blocked";
  provider: "github";
  namespace: string;
  repositoryName: string;
  reason: string;
}

export interface NexusProjectHostingFixture {
  project: NexusProjectHostingProjectIdentity;
  hosting: NexusProjectHostingConfig;
  authProfiles: NexusHostingAuthProfileConfig[];
  repositoryName: string;
  cleanup: NexusProjectHostingFixtureCleanupResult;
}

export interface NexusProjectHostingFixtureRunPlan {
  enabled: boolean;
  status: "ready" | "skipped";
  reason: string;
  fixture: NexusProjectHostingFixture | null;
  missing: string[];
}

export interface NexusProjectHostingFixtureProvisioningPass {
  status: NexusProjectHostingStatusResult;
  plan: NexusProjectHostingPlanResult;
  apply: NexusProjectHostingApplyResult;
}

export interface NexusProjectHostingFixtureProvisioningOptions {
  fixture: NexusProjectHostingFixture;
  provider: NexusProjectHostingProviderAdapter;
  localRemotes?: NexusProjectHostingLocalRemoteRecord[];
  runLocalRemoteCommand: NexusProjectHostingLocalRemoteCommandRunner;
  maxPasses?: number;
}

export interface NexusProjectHostingFixtureProvisioningResult {
  ok: boolean;
  status: "passed" | "blocked" | "failed";
  cleanup: NexusProjectHostingFixtureCleanupResult;
  passes: NexusProjectHostingFixtureProvisioningPass[];
  finalStatus: NexusProjectHostingStatusResult | null;
  finalPlan: NexusProjectHostingPlanResult | null;
  reason: string;
}

export function buildNexusProjectHostingFixture(
  options: NexusProjectHostingFixtureOptions,
): NexusProjectHostingFixture {
  const repositoryPrefix = options.repositoryPrefix ?? DEFAULT_FIXTURE_PREFIX;
  const runId = normalizeFixturePart(options.runId ?? defaultFixtureRunId());
  const repositoryName = `${repositoryPrefix}${runId}`;
  const project: NexusProjectHostingProjectIdentity = {
    id: repositoryName,
    name: `DevNexus Hosting Fixture ${runId}`,
  };
  const hosting: NexusProjectHostingConfig = {
    provider: "github",
    namespace: options.namespace,
    repository: {
      name: repositoryName,
      visibility: options.visibility ?? "private",
      defaultBranch: options.defaultBranch ?? "main",
    },
    authProfile: "human-github",
    remotes: [
      {
        name: "origin",
        role: "human",
        protocol: "ssh",
        authProfile: "human-github",
      },
      {
        name: "bot",
        role: "automation",
        protocol: "ssh",
        authProfile: "bot-github",
        sshHost: "github.com-bot",
      },
    ],
    access: [
      {
        kind: "machine_user",
        providerIdentity: options.automationAccount,
        role: "automation",
        requiredPermission: "admin",
        authProfile: "bot-github",
        invitationPolicy: "require_accepted",
      },
      {
        kind: "human",
        providerIdentity: options.humanAccount,
        role: "human",
        requiredPermission: "maintain",
        authProfile: "human-github",
        invitationPolicy: "auto_accept",
      },
    ],
    provisioning: {
      allowCreate: true,
      allowLocalRemoteRepair: true,
      allowAccessRepair: true,
      allowInvitationAcceptance: true,
      allowDefaultBranchRepair: false,
      allowVisibilityRepair: false,
      providerMutationAuthProfile: "bot-github",
    },
  };
  const authProfiles: NexusHostingAuthProfileConfig[] = [
    {
      id: "human-github",
      provider: "github",
      kind: "human",
      account: options.humanAccount,
      host: "github.com",
      ...(options.humanGithubCliConfigDir
        ? { githubCliConfigDir: options.humanGithubCliConfigDir }
        : {}),
    },
    {
      id: "bot-github",
      provider: "github",
      kind: "automation",
      account: options.automationAccount,
      host: "github.com",
      sshHost: "github.com-bot",
      ...(options.automationGithubCliConfigDir
        ? { githubCliConfigDir: options.automationGithubCliConfigDir }
        : {}),
    },
  ];

  return {
    project,
    hosting,
    authProfiles,
    repositoryName: deriveNexusProjectHostingRepositoryName({
      project,
      hosting,
    }),
    cleanup: validateNexusProjectHostingFixtureCleanupTarget({
      expectedNamespace: options.namespace,
      namespace: options.namespace,
      repositoryName,
      repositoryPrefix,
    }),
  };
}

export function planNexusProjectHostingFixtureRun(options: {
  env?: Record<string, string | undefined>;
}): NexusProjectHostingFixtureRunPlan {
  const env = options.env ?? process.env;
  if (!truthyEnvValue(env[NEXUS_PROJECT_HOSTING_FIXTURE_ENV.enabled])) {
    return {
      enabled: false,
      status: "skipped",
      reason:
        `Set ${NEXUS_PROJECT_HOSTING_FIXTURE_ENV.enabled}=true with ` +
        "fixture namespace and actor settings to run live hosting provisioning.",
      fixture: null,
      missing: [],
    };
  }

  const required = [
    NEXUS_PROJECT_HOSTING_FIXTURE_ENV.namespace,
    NEXUS_PROJECT_HOSTING_FIXTURE_ENV.runId,
    NEXUS_PROJECT_HOSTING_FIXTURE_ENV.humanAccount,
    NEXUS_PROJECT_HOSTING_FIXTURE_ENV.automationAccount,
  ];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    return {
      enabled: true,
      status: "skipped",
      reason:
        "Live hosting fixture is enabled but missing required fixture settings: " +
        missing.join(", ") +
        ".",
      fixture: null,
      missing,
    };
  }

  const fixture = buildNexusProjectHostingFixture({
    namespace: env[NEXUS_PROJECT_HOSTING_FIXTURE_ENV.namespace]!,
    runId: env[NEXUS_PROJECT_HOSTING_FIXTURE_ENV.runId]!,
    humanAccount: env[NEXUS_PROJECT_HOSTING_FIXTURE_ENV.humanAccount]!,
    automationAccount:
      env[NEXUS_PROJECT_HOSTING_FIXTURE_ENV.automationAccount]!,
    humanGithubCliConfigDir:
      env[NEXUS_PROJECT_HOSTING_FIXTURE_ENV.humanGithubCliConfigDir],
    automationGithubCliConfigDir:
      env[NEXUS_PROJECT_HOSTING_FIXTURE_ENV.automationGithubCliConfigDir],
  });
  return {
    enabled: true,
    status: "ready",
    reason:
      `Live hosting fixture is ready for ` +
      `${fixture.hosting.namespace}/${fixture.repositoryName}.`,
    fixture,
    missing: [],
  };
}

export function validateNexusProjectHostingFixtureCleanupTarget(options: {
  expectedNamespace: string;
  namespace: string;
  repositoryName: string;
  repositoryPrefix?: string;
}): NexusProjectHostingFixtureCleanupResult {
  const repositoryPrefix = options.repositoryPrefix ?? DEFAULT_FIXTURE_PREFIX;
  if (options.namespace !== options.expectedNamespace) {
    return fixtureCleanupBlocked(
      options,
      `Refusing fixture cleanup for namespace ${options.namespace}; expected ${options.expectedNamespace}.`,
    );
  }
  if (!options.repositoryName.startsWith(repositoryPrefix)) {
    return fixtureCleanupBlocked(
      options,
      `Refusing fixture cleanup for repository ${options.repositoryName}; ` +
        `name does not start with ${repositoryPrefix}.`,
    );
  }
  if (options.repositoryName.length <= repositoryPrefix.length) {
    return fixtureCleanupBlocked(
      options,
      `Refusing fixture cleanup for repository ${options.repositoryName}; ` +
        "fixture suffix is empty.",
    );
  }

  return {
    ok: true,
    status: "allowed",
    provider: "github",
    namespace: options.namespace,
    repositoryName: options.repositoryName,
    reason:
      `Cleanup is limited to disposable fixture repository ` +
      `${options.namespace}/${options.repositoryName}.`,
  };
}

export async function runNexusProjectHostingFixtureProvisioning(
  options: NexusProjectHostingFixtureProvisioningOptions,
): Promise<NexusProjectHostingFixtureProvisioningResult> {
  const cleanup = validateNexusProjectHostingFixtureCleanupTarget({
    expectedNamespace: options.fixture.hosting.namespace,
    namespace: options.fixture.hosting.namespace,
    repositoryName: options.fixture.repositoryName,
  });
  if (!cleanup.ok) {
    return {
      ok: false,
      status: "blocked",
      cleanup,
      passes: [],
      finalStatus: null,
      finalPlan: null,
      reason: cleanup.reason,
    };
  }

  const localRemotes = new Map(
    (options.localRemotes ?? []).map((remote) => [remote.name, remote.url]),
  );
  const passes: NexusProjectHostingFixtureProvisioningPass[] = [];
  const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES;
  let finalStatus: NexusProjectHostingStatusResult | null = null;
  let finalPlan: NexusProjectHostingPlanResult | null = null;

  for (let index = 0; index < maxPasses; index += 1) {
    const status = await hostingStatus(options, localRemotes);
    const plan = planNexusProjectHosting({
      hosting: options.fixture.hosting,
      status,
    });
    finalStatus = status;
    finalPlan = plan;
    if (plan.actions.length === 0) {
      return {
        ok: status.ok,
        status: status.ok ? "passed" : "blocked",
        cleanup,
        passes,
        finalStatus: status,
        finalPlan: plan,
        reason: status.ok
          ? "Fixture hosting status is satisfied."
          : "Fixture hosting status still reports blockers.",
      };
    }

    const prerequisiteBlocker = providerMutationPrerequisiteBlocker({
      status,
      plan,
      authProfiles: options.fixture.authProfiles,
    });
    if (prerequisiteBlocker) {
      const apply = blockedFixtureApply(plan, prerequisiteBlocker);
      passes.push({
        status,
        plan,
        apply,
      });
      return {
        ok: false,
        status: "blocked",
        cleanup,
        passes,
        finalStatus: status,
        finalPlan: plan,
        reason: prerequisiteBlocker.reason,
      };
    }

    const apply = await applyNexusProjectHosting({
      hosting: options.fixture.hosting,
      status,
      authProfiles: options.fixture.authProfiles,
      provider: options.provider,
      runLocalRemoteCommand: localRemoteCommandRunner({
        localRemotes,
        runLocalRemoteCommand: options.runLocalRemoteCommand,
      }),
      refreshStatus: () => hostingStatus(options, localRemotes),
    });
    passes.push({
      status,
      plan,
      apply,
    });
    finalStatus = apply.finalStatus ?? status;
    finalPlan = apply.finalPlan ?? plan;

    if (!apply.ok) {
      return {
        ok: false,
        status: apply.status === "failed" ? "failed" : "blocked",
        cleanup,
        passes,
        finalStatus,
        finalPlan,
        reason: firstApplyProblem(apply) ?? "Fixture hosting apply was blocked.",
      };
    }
  }

  return {
    ok: false,
    status: "blocked",
    cleanup,
    passes,
    finalStatus,
    finalPlan,
    reason: `Fixture hosting did not converge after ${maxPasses} passes.`,
  };
}

function hostingStatus(
  options: NexusProjectHostingFixtureProvisioningOptions,
  localRemotes: Map<string, string | null>,
): Promise<NexusProjectHostingStatusResult> {
  return statusNexusProjectHosting({
    project: options.fixture.project,
    hosting: options.fixture.hosting,
    authProfiles: options.fixture.authProfiles,
    provider: options.provider,
    localRemotes: [...localRemotes.entries()].map(([name, url]) => ({
      name,
      url,
    })),
  });
}

function localRemoteCommandRunner(options: {
  localRemotes: Map<string, string | null>;
  runLocalRemoteCommand: NexusProjectHostingLocalRemoteCommandRunner;
}): (command: NexusProjectHostingLocalRemoteCommand) =>
  | NexusProjectHostingLocalRemoteCommandResult
  | Promise<NexusProjectHostingLocalRemoteCommandResult> {
  return async (command) => {
    const result = await options.runLocalRemoteCommand(command);
    if (result.exitCode === 0) {
      options.localRemotes.set(command.remoteName, command.url);
    }
    return result;
  };
}

function fixtureCleanupBlocked(
  options: {
    namespace: string;
    repositoryName: string;
  },
  reason: string,
): NexusProjectHostingFixtureCleanupResult {
  return {
    ok: false,
    status: "blocked",
    provider: "github",
    namespace: options.namespace,
    repositoryName: options.repositoryName,
    reason,
  };
}

function providerMutationPrerequisiteBlocker(options: {
  status: NexusProjectHostingStatusResult;
  plan: NexusProjectHostingPlanResult;
  authProfiles: NexusHostingAuthProfileConfig[];
}): NexusProjectHostingApplyActionResult | null {
  const authProfileById = new Map(
    options.authProfiles.map((profile) => [profile.id, profile]),
  );
  for (const action of options.plan.actions) {
    if (!providerMutationClass(action) || action.disposition !== "allowed") {
      continue;
    }
    if (!action.authProfile) {
      return blockedApplyActionResult(
        action,
        `Skipped ${providerMutationLabel(action)}: no provider mutation auth profile is configured.`,
      );
    }
    if (!authProfileById.has(action.authProfile)) {
      return blockedApplyActionResult(
        action,
        `Skipped ${providerMutationLabel(action)}: host-local auth profile is missing: ${action.authProfile}.`,
      );
    }
    const authProfileStatus = options.status.authProfiles.find(
      (record) => record.id === action.authProfile,
    );
    if (authProfileStatus?.status === "mismatch") {
      return blockedApplyActionResult(
        action,
        `Skipped ${providerMutationLabel(action)}: auth profile ${action.authProfile} is ` +
          `authenticated as ${authProfileStatus.observedAccount ?? "unknown"}; ` +
          `expected ${authProfileStatus.expectedAccount ?? "unknown"}.`,
      );
    }
    if (authProfileStatus?.status === "missing") {
      return blockedApplyActionResult(
        action,
        `Skipped ${providerMutationLabel(action)}: host-local auth profile is missing: ${action.authProfile}.`,
      );
    }
  }
  return null;
}

function blockedFixtureApply(
  plan: NexusProjectHostingPlanResult,
  action: NexusProjectHostingApplyActionResult,
): NexusProjectHostingApplyResult {
  return {
    ok: false,
    status: "blocked",
    plan,
    actions: [action],
  };
}

function blockedApplyActionResult(
  action: NexusProjectHostingPlanAction,
  reason: string,
): NexusProjectHostingApplyActionResult {
  return {
    actionId: action.id,
    kind: action.kind,
    mutationClass: action.mutationClass,
    disposition: "blocked",
    reason,
  };
}

function providerMutationClass(action: NexusProjectHostingPlanAction): boolean {
  return (
    action.mutationClass === "repository_create" ||
    action.mutationClass === "access_repair" ||
    action.mutationClass === "invitation_acceptance"
  );
}

function providerMutationLabel(action: NexusProjectHostingPlanAction): string {
  switch (action.mutationClass) {
    case "repository_create":
      return "repository create";
    case "access_repair":
      return "access repair";
    case "invitation_acceptance":
      return "invitation acceptance";
    default:
      return "provider mutation";
  }
}

function firstApplyProblem(
  apply: NexusProjectHostingApplyResult,
): string | null {
  return (
    apply.actions.find(
      (action) =>
        action.disposition === "blocked" || action.disposition === "failed",
    )?.reason ?? null
  );
}

function truthyEnvValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on";
}

function normalizeFixturePart(value: string): string {
  const normalized = trimHyphens(
    replaceRunsWithHyphen(
      value.trim().toLowerCase(),
      (character) => !isLowerAsciiIdentifierSegmentCharacter(character),
    ),
  );
  return normalized || defaultFixtureRunId();
}

function defaultFixtureRunId(): string {
  return Date.now().toString(36);
}
