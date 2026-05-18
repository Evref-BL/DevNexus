import type {
  NexusAutomationSafetyConfig,
  NexusAutomationPublicationConfig,
  NexusPublicationActorConfig,
} from "./nexusAutomationConfig.js";
import type {
  NexusHostingAuthProfileConfig,
  NexusHostingAuthProfileKind,
} from "./nexusProjectHosting.js";

export const nexusAuthorityActionNames = [
  "project.read",
  "work_item.read",
  "work_item.update",
  "work_item.comment",
  "work_item.close",
  "coordination.handoff",
  "worktree.create",
  "git.branch.create",
  "git.commit",
  "git.push_branch",
  "git.push_target_branch",
  "provider.state.read",
  "provider.pull_request.open",
  "provider.pull_request.update",
  "provider.pull_request.merge",
  "provider.review.request",
  "provider.review.approve",
  "provider.review.reject",
  "provider.issue.design_approve",
  "provider.issue.design_reject",
  "provider.comment",
  "provider.label",
  "provider.assign",
  "provider.transition",
  "release.publish",
  "runtime.mutate",
] as const;

export type NexusAuthorityAction = typeof nexusAuthorityActionNames[number];

export type NexusAuthorityActorKind =
  | "human"
  | "machine_user"
  | "service_account"
  | "external_agent"
  | "local"
  | "team";

export interface NexusAuthorityActorConfig {
  id: string;
  kind: NexusAuthorityActorKind;
  provider: string | null;
  providerIdentity: string;
  displayName: string;
  handles?: Record<string, string>;
}

export interface NexusAuthorityRoleDefinitionConfig {
  id: string;
  name?: string;
  description?: string;
  actions: NexusAuthorityAction[];
}

export interface NexusAuthorityScopeConfig {
  project?: string;
  component?: string;
  provider?: string;
  tracker?: string;
  repository?: string;
  targetBranch?: string;
  environment?: string;
}

export interface NexusAuthorityRoleBindingConfig {
  actorId: string;
  roles: string[];
  scope: NexusAuthorityScopeConfig;
}

export interface NexusAuthorityConfig {
  actors?: NexusAuthorityActorConfig[];
  roles?: NexusAuthorityRoleDefinitionConfig[];
  roleBindings?: NexusAuthorityRoleBindingConfig[];
  unknownActorFallbackRole?: string;
}

export const recommendedNexusAuthorityRoleIds = [
  "maintainer",
  "contributor",
  "reviewer",
  "observer",
  "runtime_operator",
  "release_operator",
] as const;

export type RecommendedNexusAuthorityRoleId =
  typeof recommendedNexusAuthorityRoleIds[number];

export const recommendedNexusAuthorityRoleDefinitions: NexusAuthorityRoleDefinitionConfig[] = [
  {
    id: "maintainer",
    name: "Maintainer",
    description:
      "May update project state, push branches, open review requests, and integrate approved work when publication policy allows it.",
    actions: [
      "project.read",
      "work_item.read",
      "work_item.update",
      "work_item.comment",
      "work_item.close",
      "coordination.handoff",
      "worktree.create",
      "git.branch.create",
      "git.commit",
      "git.push_branch",
      "git.push_target_branch",
      "provider.state.read",
      "provider.pull_request.open",
      "provider.pull_request.update",
      "provider.pull_request.merge",
      "provider.review.request",
      "provider.review.approve",
      "provider.review.reject",
      "provider.issue.design_approve",
      "provider.issue.design_reject",
      "provider.comment",
      "provider.label",
      "provider.assign",
      "provider.transition",
    ],
  },
  {
    id: "contributor",
    name: "Contributor",
    description:
      "May prepare local changes, push feature branches, open pull requests, update owned work items, and request review.",
    actions: [
      "project.read",
      "work_item.read",
      "work_item.update",
      "work_item.comment",
      "coordination.handoff",
      "worktree.create",
      "git.branch.create",
      "git.commit",
      "git.push_branch",
      "provider.state.read",
      "provider.pull_request.open",
      "provider.pull_request.update",
      "provider.review.request",
      "provider.comment",
    ],
  },
  {
    id: "reviewer",
    name: "Reviewer",
    description:
      "May inspect work, comment, and approve or reject provider review requests where provider policy allows it.",
    actions: [
      "project.read",
      "work_item.read",
      "work_item.comment",
      "coordination.handoff",
      "provider.state.read",
      "provider.comment",
      "provider.review.approve",
      "provider.review.reject",
    ],
  },
  {
    id: "observer",
    name: "Observer",
    description:
      "May read project and provider state and produce handoffs without source, tracker, provider, or runtime mutation authority.",
    actions: [
      "project.read",
      "work_item.read",
      "coordination.handoff",
      "provider.state.read",
    ],
  },
  {
    id: "runtime_operator",
    name: "Runtime Operator",
    description:
      "May perform approved live runtime or host-local mutation actions without gaining source integration authority.",
    actions: [
      "project.read",
      "work_item.read",
      "coordination.handoff",
      "runtime.mutate",
    ],
  },
  {
    id: "release_operator",
    name: "Release Operator",
    description:
      "May publish packages or releases when release policy allows it without gaining implementation authority.",
    actions: [
      "project.read",
      "work_item.read",
      "coordination.handoff",
      "release.publish",
    ],
  },
];

export interface NormalizedNexusAuthorityPolicy {
  actors: NexusAuthorityActorConfig[];
  roles: NexusAuthorityRoleDefinitionConfig[];
  roleBindings: NexusAuthorityRoleBindingConfig[];
  unknownActorFallbackRole: string;
  unknownActorFallbackActions: NexusAuthorityAction[];
  recommendedRoleIds: RecommendedNexusAuthorityRoleId[];
}

export interface ResolvedNexusActorAuthority {
  actorId: string;
  knownActor: boolean;
  roles: string[];
  actions: NexusAuthorityAction[];
  matchedBindings: NexusAuthorityRoleBindingConfig[];
}

export type NexusCurrentActorResolutionStatus =
  | "matched"
  | "missing"
  | "ambiguous"
  | "mismatched"
  | "unknown";

export interface NexusCurrentActorProfileResolution {
  id: string;
  actorId: string | null;
  kind: NexusHostingAuthProfileKind | null;
  account: string | null;
  mechanisms: string[];
}

export interface NexusCurrentActorResolution {
  componentId: string;
  status: NexusCurrentActorResolutionStatus;
  expectedActorId: string | null;
  expectedActorKind: NexusAuthorityActorKind | null;
  expectedProvider: string | null;
  expectedHandle: string | null;
  profileId: string | null;
  profiles: NexusCurrentActorProfileResolution[];
  roles: string[];
  actions: NexusAuthorityAction[];
  warnings: string[];
}

export interface ResolveNexusCurrentAutomationActorOptions {
  authority?: NexusAuthorityConfig;
  componentId: string;
  publication: NexusAutomationPublicationConfig;
  authProfiles?: NexusHostingAuthProfileConfig[];
}

export type NexusEffectiveAuthorityStatus =
  | "allowed"
  | "blocked"
  | "waiting";

export type NexusEffectiveAuthorityScopePrecedence =
  | "fallback"
  | "project_default"
  | "component_override"
  | "provider_override"
  | "repository_override"
  | "tracker_override"
  | "branch_override"
  | "environment_override";

export interface NexusEffectiveAuthorityActorInput {
  id?: string | null;
  kind?: NexusAuthorityActorKind | null;
  provider?: string | null;
  providerIdentity?: string | null;
}

export interface NexusEffectiveAuthorityAuthProfileInput {
  id: string;
  actorId?: string | null;
  kind?: NexusHostingAuthProfileKind | null;
  provider?: string | null;
  account?: string | null;
}

export type NexusAuthorityPullRequestReviewSignal =
  | "unknown"
  | "waiting_for_approval"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "timed_out";

export type NexusAuthorityProviderChecksSignal =
  | "unknown"
  | "checks_pending"
  | "checks_passed"
  | "checks_failed";

export type NexusAuthorityMergeabilitySignal =
  | "unknown"
  | "mergeable"
  | "merge_conflict";

export type NexusAuthorityBranchPolicySignal =
  | "unknown"
  | "clear"
  | "branch_policy_blocked";

export type NexusAuthorityIssueDesignSignal =
  | "unknown"
  | "waiting_for_approval"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "timed_out";

export type NexusAuthorityRequiredProviderSignal =
  | "pull_request_review.approved"
  | "issue_design.approved"
  | "checks.passed"
  | "mergeable"
  | "branch_policy.clear";

export interface NexusAuthorityPullRequestProviderState {
  review?: NexusAuthorityPullRequestReviewSignal | null;
  checks?: NexusAuthorityProviderChecksSignal | null;
  mergeability?: NexusAuthorityMergeabilitySignal | null;
  branchPolicy?: NexusAuthorityBranchPolicySignal | null;
}

export interface NexusAuthorityIssueProviderState {
  designApproval?: NexusAuthorityIssueDesignSignal | null;
  assignedActorIds?: string[];
  casualCommentCount?: number;
  silent?: boolean;
}

export interface NexusAuthorityProviderState {
  pullRequest?: NexusAuthorityPullRequestProviderState | null;
  issue?: NexusAuthorityIssueProviderState | null;
  branchPolicy?: NexusAuthorityBranchPolicySignal | null;
}

export interface ResolveNexusEffectiveAuthorityOptions {
  authority?: NexusAuthorityConfig;
  actor: NexusEffectiveAuthorityActorInput;
  authProfile?: NexusEffectiveAuthorityAuthProfileInput | null;
  project: string;
  component?: string | null;
  provider?: string | null;
  tracker?: string | null;
  remote?: string | null;
  repository?: string | null;
  targetBranch?: string | null;
  environment?: string | null;
  requestedAction: NexusAuthorityAction;
  publication?: NexusAutomationPublicationConfig | null;
  safety?: NexusAutomationSafetyConfig | null;
  providerState?: NexusAuthorityProviderState | null;
}

export interface NexusEffectiveAuthorityMatchedRule {
  precedence: NexusEffectiveAuthorityScopePrecedence;
  bindingIndexes: number[];
  scopes: NexusAuthorityScopeConfig[];
  roles: string[];
}

export interface NexusEffectiveAuthorityResolution {
  status: NexusEffectiveAuthorityStatus;
  allowed: boolean;
  requestedAction: NexusAuthorityAction;
  actorId: string | null;
  knownActor: boolean;
  authProfileId: string | null;
  matchedActorId: string | null;
  matchedRoles: string[];
  matchedRule: NexusEffectiveAuthorityMatchedRule | null;
  matchedBindings: NexusAuthorityRoleBindingConfig[];
  missingRequiredActions: NexusAuthorityAction[];
  missingProviderSignals: NexusAuthorityRequiredProviderSignal[];
  recommendedFallbackAction: NexusAuthorityAction | null;
  explanation: string;
}

interface NexusEffectiveAuthorityRequestScope {
  project: string;
  component: string | null;
  provider: string | null;
  tracker: string | null;
  repository: string | null;
  targetBranch: string | null;
  environment: string | null;
}

interface NexusScopedAuthorityResolution {
  actorId: string;
  knownActor: boolean;
  roles: string[];
  actions: NexusAuthorityAction[];
  matchedBindings: Array<{
    binding: NexusAuthorityRoleBindingConfig;
    index: number;
    precedence: NexusEffectiveAuthorityScopePrecedence;
    rank: number;
  }>;
  matchedRule: NexusEffectiveAuthorityMatchedRule | null;
}

interface NexusProviderAuthorityDecision {
  status: NexusEffectiveAuthorityStatus;
  missingProviderSignals: NexusAuthorityRequiredProviderSignal[];
  explanation: string | null;
}

const nexusAuthorityScopePrecedence = [
  { key: "project", precedence: "project_default", rank: 10 },
  { key: "component", precedence: "component_override", rank: 20 },
  { key: "provider", precedence: "provider_override", rank: 30 },
  { key: "repository", precedence: "repository_override", rank: 35 },
  { key: "tracker", precedence: "tracker_override", rank: 40 },
  { key: "targetBranch", precedence: "branch_override", rank: 50 },
  { key: "environment", precedence: "environment_override", rank: 60 },
] as const satisfies Array<{
  key: keyof NexusAuthorityScopeConfig;
  precedence: NexusEffectiveAuthorityScopePrecedence;
  rank: number;
}>;

export function normalizeNexusAuthorityPolicy(
  config?: NexusAuthorityConfig,
): NormalizedNexusAuthorityPolicy {
  const roleDefinitions = authorityRoleMap(config);
  const unknownActorFallbackRole =
    config?.unknownActorFallbackRole ?? "observer";

  return {
    actors: config?.actors ? [...config.actors] : [],
    roles: [...roleDefinitions.values()].map(copyAuthorityRoleDefinition),
    roleBindings: config?.roleBindings
      ? config.roleBindings.map(copyAuthorityRoleBinding)
      : [],
    unknownActorFallbackRole,
    unknownActorFallbackActions: expandNexusAuthorityRoles(
      [unknownActorFallbackRole],
      config,
    ),
    recommendedRoleIds: [...recommendedNexusAuthorityRoleIds],
  };
}

export function resolveNexusEffectiveAuthority(
  options: ResolveNexusEffectiveAuthorityOptions,
): NexusEffectiveAuthorityResolution {
  const policy = normalizeNexusAuthorityPolicy(options.authority);
  const actorId = normalizeOptionalString(
    options.actor.id ?? options.authProfile?.actorId,
  ) ?? "unknown";
  const actor = policy.actors.find((candidate) => candidate.id === actorId);
  const requestScope = effectiveAuthorityRequestScope(options);
  const scopedAuthority = resolveScopedNexusAuthority({
    actorId,
    config: options.authority,
    policy,
    scope: requestScope,
  });
  const profileBlocker = authProfileAuthorityBlocker({
    actorId,
    actorKind: options.actor.kind ?? actor?.kind ?? null,
    authProfile: options.authProfile ?? null,
  });
  const hasRequestedAction =
    scopedAuthority.actions.includes(options.requestedAction);
  const directIntegrationBlocker = directIntegrationPolicyBlocker(options);
  const runtimeSafetyBlockerMessage = runtimeSafetyBlocker(options);
  const policyBlockers = [
    ...(directIntegrationBlocker ? [directIntegrationBlocker] : []),
    ...(runtimeSafetyBlockerMessage ? [runtimeSafetyBlockerMessage] : []),
  ];
  const providerDecision = providerAuthorityDecision(
    options.requestedAction,
    options.providerState ?? null,
  );
  const missingRequiredActions = hasRequestedAction
    ? []
    : [options.requestedAction];
  const hardBlockers = [
    ...(profileBlocker ? [profileBlocker] : []),
    ...policyBlockers,
    ...(missingRequiredActions.length > 0
      ? [`Actor ${actorId} lacks action ${options.requestedAction}.`]
      : []),
    ...(providerDecision.status === "blocked" && hasRequestedAction
      ? [providerDecision.explanation ?? "Provider state blocks this action."]
      : []),
  ];
  const status: NexusEffectiveAuthorityStatus = hardBlockers.length > 0
    ? "blocked"
    : providerDecision.status === "waiting"
      ? "waiting"
      : "allowed";
  const missingProviderSignals =
    hardBlockers.length === 0 || providerDecision.status === "blocked"
      ? providerDecision.missingProviderSignals
      : [];
  const recommendedFallbackAction = status === "allowed"
    ? null
    : recommendedAuthorityFallbackAction(
        options.requestedAction,
        scopedAuthority.actions,
        missingProviderSignals,
      );

  return {
    status,
    allowed: status === "allowed",
    requestedAction: options.requestedAction,
    actorId: actorId === "unknown" ? null : actorId,
    knownActor: scopedAuthority.knownActor,
    authProfileId: options.authProfile?.id ?? null,
    matchedActorId: actor?.id ?? (actorId === "unknown" ? null : actorId),
    matchedRoles: scopedAuthority.roles,
    matchedRule: scopedAuthority.matchedRule,
    matchedBindings: scopedAuthority.matchedBindings.map((match) =>
      copyAuthorityRoleBinding(match.binding)
    ),
    missingRequiredActions,
    missingProviderSignals,
    recommendedFallbackAction,
    explanation: effectiveAuthorityExplanation({
      status,
      actorId,
      requestedAction: options.requestedAction,
      roles: scopedAuthority.roles,
      matchedRule: scopedAuthority.matchedRule,
      hardBlockers,
      providerDecision,
      fallback: recommendedFallbackAction,
    }),
  };
}

export function resolveNexusAuthorityForActor(
  config: NexusAuthorityConfig | undefined,
  actorId: string,
): ResolvedNexusActorAuthority {
  const policy = normalizeNexusAuthorityPolicy(config);
  const knownActor = policy.actors.some((actor) => actor.id === actorId);
  const matchedBindings = knownActor
    ? policy.roleBindings.filter((binding) => binding.actorId === actorId)
    : [];
  const boundRoles = uniqueValues(
    matchedBindings.flatMap((binding) => binding.roles),
  );
  const roles = boundRoles.length > 0
    ? boundRoles
    : [knownActor ? "observer" : policy.unknownActorFallbackRole];

  return {
    actorId,
    knownActor,
    roles,
    actions: expandNexusAuthorityRoles(roles, config),
    matchedBindings,
  };
}

export function resolveNexusCurrentAutomationActor(
  options: ResolveNexusCurrentAutomationActorOptions,
): NexusCurrentActorResolution {
  const policy = normalizeNexusAuthorityPolicy(options.authority);
  const expected = expectedAuthorityActor(
    policy.actors,
    options.publication.actor,
  );
  const fallbackAuthority = resolveNexusAuthorityForActor(
    options.authority,
    "unknown",
  );
  if (!options.publication.actor) {
    return currentActorResolution({
      componentId: options.componentId,
      status: "unknown",
      expectedActor: null,
      profileId: null,
      profiles: [],
      roles: fallbackAuthority.roles,
      actions: fallbackAuthority.actions,
      warnings: ["No automation publication actor is configured for this component."],
    });
  }
  if (!expected) {
    return currentActorResolution({
      componentId: options.componentId,
      status: "missing",
      expectedActor: publicationActorAsAuthorityActor(options.publication.actor),
      profileId: null,
      profiles: [],
      roles: fallbackAuthority.roles,
      actions: fallbackAuthority.actions,
      warnings: [
        "Automation publication actor does not match a configured authority actor.",
      ],
    });
  }

  const authority = resolveNexusAuthorityForActor(options.authority, expected.id);
  const profiles = options.authProfiles ?? [];
  const actorProfiles = profiles.filter((profile) => profile.actorId === expected.id);
  const mismatchedProfiles = profiles.filter((profile) =>
    profile.actorId !== expected.id &&
    profileLooksLikePublicationActor(profile, expected, options.publication),
  );
  if (actorProfiles.length === 0) {
    const mismatchedProfileRecords = mismatchedProfiles.map((profile) =>
      authProfileResolution(profile, expected, options.publication),
    );
    return currentActorResolution({
      componentId: options.componentId,
      status: mismatchedProfileRecords.length > 0 ? "mismatched" : "missing",
      expectedActor: expected,
      profileId: null,
      profiles: mismatchedProfileRecords,
      roles: authority.roles,
      actions: authority.actions,
      warnings: mismatchedProfileRecords.length > 0
        ? [
            "Host-local auth profile metadata matches the expected automation actor but is bound to a different actor id.",
          ]
        : [
            `No host-local auth profile is bound to automation actor ${expected.id}.`,
          ],
    });
  }

  const invalidKindProfiles = actorProfiles.filter((profile) =>
    !authProfileKindCanActAsAutomation(profile.kind, expected.kind)
  );
  const validKindProfiles = actorProfiles.filter((profile) =>
    authProfileKindCanActAsAutomation(profile.kind, expected.kind)
  );
  if (validKindProfiles.length === 0) {
    return currentActorResolution({
      componentId: options.componentId,
      status: "mismatched",
      expectedActor: expected,
      profileId: null,
      profiles: invalidKindProfiles.map((profile) =>
        authProfileResolution(profile, expected, options.publication)
      ),
      roles: authority.roles,
      actions: authority.actions,
      warnings: [
        `Host-local profile kind ${invalidKindProfiles.map((profile) => profile.kind ?? "unknown").join(",")} cannot satisfy automation actor ${expected.id}.`,
      ],
    });
  }

  const mechanismMatchedProfiles = validKindProfiles
    .map((profile) => authProfileResolution(profile, expected, options.publication))
    .filter((profile) => profile.mechanisms.some((mechanism) => mechanism !== "actorId"));
  const selectedProfiles = mechanismMatchedProfiles.length > 0
    ? mechanismMatchedProfiles
    : validKindProfiles.map((profile) =>
        authProfileResolution(profile, expected, options.publication)
      );
  if (selectedProfiles.length > 1) {
    return currentActorResolution({
      componentId: options.componentId,
      status: "ambiguous",
      expectedActor: expected,
      profileId: null,
      profiles: selectedProfiles,
      roles: authority.roles,
      actions: authority.actions,
      warnings: [
        `Multiple host-local auth profiles can act as automation actor ${expected.id}: ${selectedProfiles.map((profile) => profile.id).join(", ")}.`,
      ],
    });
  }

  const selectedProfile = selectedProfiles[0]!;
  return currentActorResolution({
    componentId: options.componentId,
    status: "matched",
    expectedActor: expected,
    profileId: selectedProfile.id,
    profiles: [selectedProfile],
    roles: authority.roles,
    actions: authority.actions,
    warnings: [
      ...invalidKindProfiles.map((profile) =>
        `Ignoring ${profile.kind ?? "unknown"} auth profile ${profile.id} for automation actor ${expected.id}.`,
      ),
    ],
  });
}

export function expandNexusAuthorityRoles(
  roleIds: readonly string[],
  config?: NexusAuthorityConfig,
): NexusAuthorityAction[] {
  const roleDefinitions = authorityRoleMap(config);
  return uniqueValues(
    roleIds.flatMap((roleId) => roleDefinitions.get(roleId)?.actions ?? []),
  );
}

function resolveScopedNexusAuthority(options: {
  config: NexusAuthorityConfig | undefined;
  policy: NormalizedNexusAuthorityPolicy;
  actorId: string;
  scope: NexusEffectiveAuthorityRequestScope;
}): NexusScopedAuthorityResolution {
  const knownActor = options.policy.actors.some(
    (actor) => actor.id === options.actorId,
  );
  const actorBindings = knownActor
    ? options.policy.roleBindings
        .map((binding, index) => ({ binding, index }))
        .filter(({ binding }) => binding.actorId === options.actorId)
        .filter(({ binding }) =>
          authorityScopeMatches(binding.scope, options.scope)
        )
        .map(({ binding, index }) => {
          const precedence = authorityScopePrecedence(binding.scope);
          return {
            binding,
            index,
            precedence: precedence.precedence,
            rank: precedence.rank,
          };
        })
    : [];
  const selectedRank = actorBindings.length > 0
    ? Math.max(...actorBindings.map((match) => match.rank))
    : null;
  const selectedBindings = selectedRank === null
    ? []
    : actorBindings.filter((match) => match.rank === selectedRank);
  const roles = selectedBindings.length > 0
    ? uniqueValues(selectedBindings.flatMap((match) => match.binding.roles))
    : [knownActor ? "observer" : options.policy.unknownActorFallbackRole];
  const matchedRule: NexusEffectiveAuthorityMatchedRule | null =
    selectedBindings.length > 0
      ? {
          precedence: selectedBindings[0]!.precedence,
          bindingIndexes: selectedBindings.map((match) => match.index),
          scopes: selectedBindings.map((match) => ({ ...match.binding.scope })),
          roles,
        }
      : {
          precedence: "fallback",
          bindingIndexes: [],
          scopes: [],
          roles,
        };

  return {
    actorId: options.actorId,
    knownActor,
    roles,
    actions: expandNexusAuthorityRoles(roles, options.config),
    matchedBindings: selectedBindings,
    matchedRule,
  };
}

function effectiveAuthorityRequestScope(
  options: ResolveNexusEffectiveAuthorityOptions,
): NexusEffectiveAuthorityRequestScope {
  return {
    project: requiredAuthorityString(options.project, "project"),
    component: normalizeOptionalString(options.component),
    provider: normalizeOptionalString(options.provider),
    tracker: normalizeOptionalString(options.tracker),
    repository: normalizeOptionalString(options.repository),
    targetBranch: normalizeOptionalString(options.targetBranch),
    environment: normalizeOptionalString(options.environment),
  };
}

function authorityScopeMatches(
  scope: NexusAuthorityScopeConfig,
  request: NexusEffectiveAuthorityRequestScope,
): boolean {
  return nexusAuthorityScopePrecedence.every(({ key }) =>
    scope[key] === undefined ||
    authorityScopeValueMatches(scope[key], request[key])
  );
}

function authorityScopeValueMatches(
  expected: string | undefined,
  actual: string | null,
): boolean {
  if (expected === undefined) {
    return true;
  }
  if (actual === null) {
    return false;
  }

  return expected === actual;
}

function authorityScopePrecedence(
  scope: NexusAuthorityScopeConfig,
): { precedence: NexusEffectiveAuthorityScopePrecedence; rank: number } {
  let precedence: NexusEffectiveAuthorityScopePrecedence = "fallback";
  let rank = 0;
  for (const entry of nexusAuthorityScopePrecedence) {
    if (scope[entry.key] !== undefined && entry.rank >= rank) {
      precedence = entry.precedence;
      rank = entry.rank;
    }
  }

  return { precedence, rank };
}

function authProfileAuthorityBlocker(options: {
  actorId: string;
  actorKind: NexusAuthorityActorKind | null;
  authProfile: NexusEffectiveAuthorityAuthProfileInput | null;
}): string | null {
  const profile = options.authProfile;
  if (!profile) {
    return null;
  }
  if (
    profile.actorId &&
    options.actorId !== "unknown" &&
    profile.actorId !== options.actorId
  ) {
    return `Auth profile ${profile.id} is bound to actor ${profile.actorId}, not requested actor ${options.actorId}.`;
  }
  if (
    profile.kind &&
    options.actorKind &&
    !authProfileKindCanActAsAutomation(profile.kind, options.actorKind)
  ) {
    return `Auth profile ${profile.id} with kind ${profile.kind} cannot act as ${options.actorKind}.`;
  }

  return null;
}

function directIntegrationPolicyBlocker(
  options: ResolveNexusEffectiveAuthorityOptions,
): string | null {
  if (options.requestedAction !== "git.push_target_branch") {
    return null;
  }
  const publication = options.publication;
  if (!publication) {
    return "Component publication policy is unavailable; direct integration is blocked.";
  }
  if (publication.strategy !== "direct_integration" || !publication.push) {
    return `Component publication policy is ${publication.strategy} with push=${publication.push}; direct integration requires direct_integration with push enabled.`;
  }
  if (
    publication.remote &&
    options.remote &&
    !authorityScopeValueMatches(publication.remote, options.remote)
  ) {
    return `Requested remote ${options.remote} does not match publication remote ${publication.remote}.`;
  }
  if (
    publication.targetBranch &&
    options.targetBranch &&
    !authorityScopeValueMatches(publication.targetBranch, options.targetBranch)
  ) {
    return `Requested target branch ${options.targetBranch} does not match publication target branch ${publication.targetBranch}.`;
  }

  return null;
}

function runtimeSafetyBlocker(
  options: ResolveNexusEffectiveAuthorityOptions,
): string | null {
  if (options.requestedAction !== "runtime.mutate") {
    return null;
  }
  const safety = options.safety;
  if (!safety) {
    return "Automation safety profile is unavailable; runtime mutation is blocked.";
  }
  if (
    safety.profile === "host-authorized" ||
    safety.allowHostMutation ||
    safety.allowDependencyInstall ||
    safety.allowLiveServices
  ) {
    return null;
  }

  return `Automation safety profile ${safety.profile} does not allow host, dependency, or live-service mutation.`;
}

function providerAuthorityDecision(
  action: NexusAuthorityAction,
  providerState: NexusAuthorityProviderState | null,
): NexusProviderAuthorityDecision {
  if (action === "provider.pull_request.merge") {
    return pullRequestMergeProviderDecision(providerState);
  }
  if (action === "git.push_target_branch") {
    return targetBranchPushProviderDecision(providerState);
  }

  return {
    status: "allowed",
    missingProviderSignals: [],
    explanation: null,
  };
}

function pullRequestMergeProviderDecision(
  providerState: NexusAuthorityProviderState | null,
): NexusProviderAuthorityDecision {
  const pullRequest = providerState?.pullRequest ?? null;
  const review = pullRequest?.review ?? "unknown";
  const checks = pullRequest?.checks ?? "unknown";
  const mergeability = pullRequest?.mergeability ?? "unknown";
  const branchPolicy = pullRequest?.branchPolicy ?? "unknown";
  const missingProviderSignals: NexusAuthorityRequiredProviderSignal[] = [];
  const blockers: string[] = [];

  if (review !== "approved") {
    missingProviderSignals.push("pull_request_review.approved");
    if (
      review === "changes_requested" ||
      review === "rejected" ||
      review === "timed_out"
    ) {
      blockers.push(`Pull request review state is ${review}.`);
    }
  }
  if (checks !== "checks_passed") {
    missingProviderSignals.push("checks.passed");
    if (checks === "checks_failed") {
      blockers.push("Required checks failed.");
    }
  }
  if (mergeability !== "mergeable") {
    missingProviderSignals.push("mergeable");
    if (mergeability === "merge_conflict") {
      blockers.push("Pull request has merge conflicts.");
    }
  }
  if (branchPolicy === "branch_policy_blocked") {
    missingProviderSignals.push("branch_policy.clear");
    blockers.push("Provider branch policy blocks merge.");
  }

  if (blockers.length > 0) {
    return {
      status: "blocked",
      missingProviderSignals: uniqueValues(missingProviderSignals),
      explanation: blockers.join(" "),
    };
  }
  if (missingProviderSignals.length > 0) {
    return {
      status: "waiting",
      missingProviderSignals: uniqueValues(missingProviderSignals),
      explanation: "Provider state has not supplied all pull request merge signals.",
    };
  }

  return {
    status: "allowed",
    missingProviderSignals: [],
    explanation: null,
  };
}

function targetBranchPushProviderDecision(
  providerState: NexusAuthorityProviderState | null,
): NexusProviderAuthorityDecision {
  const branchPolicy =
    providerState?.branchPolicy ??
    providerState?.pullRequest?.branchPolicy ??
    null;
  if (branchPolicy === "branch_policy_blocked") {
    return {
      status: "blocked",
      missingProviderSignals: ["branch_policy.clear"],
      explanation: "Provider branch policy blocks direct target-branch push.",
    };
  }
  if (branchPolicy === "unknown") {
    return {
      status: "waiting",
      missingProviderSignals: ["branch_policy.clear"],
      explanation: "Provider branch policy state is unknown.",
    };
  }

  return {
    status: "allowed",
    missingProviderSignals: [],
    explanation: null,
  };
}

function recommendedAuthorityFallbackAction(
  requestedAction: NexusAuthorityAction,
  availableActions: NexusAuthorityAction[],
  missingProviderSignals: NexusAuthorityRequiredProviderSignal[],
): NexusAuthorityAction | null {
  const preferences = authorityFallbackPreferences(
    requestedAction,
    missingProviderSignals,
  );
  return preferences.find((action) => availableActions.includes(action)) ?? null;
}

function authorityFallbackPreferences(
  requestedAction: NexusAuthorityAction,
  missingProviderSignals: NexusAuthorityRequiredProviderSignal[],
): NexusAuthorityAction[] {
  if (missingProviderSignals.includes("pull_request_review.approved")) {
    return [
      "provider.review.request",
      "provider.comment",
      "coordination.handoff",
    ];
  }
  switch (requestedAction) {
    case "git.push_target_branch":
      return [
        "provider.pull_request.open",
        "provider.review.request",
        "coordination.handoff",
      ];
    case "provider.pull_request.merge":
      return [
        "provider.review.request",
        "provider.comment",
        "coordination.handoff",
      ];
    case "provider.review.approve":
    case "provider.review.reject":
    case "provider.issue.design_approve":
    case "provider.issue.design_reject":
      return ["provider.comment", "coordination.handoff"];
    case "runtime.mutate":
    case "release.publish":
    case "git.push_branch":
    case "git.commit":
    case "provider.comment":
    case "provider.label":
    case "provider.assign":
    case "provider.transition":
    case "work_item.update":
    case "work_item.comment":
    case "work_item.close":
      return ["coordination.handoff"];
    default:
      return [];
  }
}

function effectiveAuthorityExplanation(options: {
  status: NexusEffectiveAuthorityStatus;
  actorId: string;
  requestedAction: NexusAuthorityAction;
  roles: string[];
  matchedRule: NexusEffectiveAuthorityMatchedRule | null;
  hardBlockers: string[];
  providerDecision: NexusProviderAuthorityDecision;
  fallback: NexusAuthorityAction | null;
}): string {
  const roleSummary = options.roles.length > 0
    ? options.roles.join(", ")
    : "no roles";
  const ruleSummary = options.matchedRule
    ? options.matchedRule.precedence
    : "no matching rule";
  if (options.status === "allowed") {
    return `Actor ${options.actorId} may ${options.requestedAction} as ${roleSummary} via ${ruleSummary}.`;
  }
  if (options.status === "waiting") {
    const missing = options.providerDecision.missingProviderSignals.join(", ");
    const fallback = options.fallback
      ? ` Fallback: ${options.fallback}.`
      : "";
    return `Actor ${options.actorId} has ${options.requestedAction} authority as ${roleSummary}, but provider state is waiting for ${missing}.${fallback}`;
  }

  const fallback = options.fallback
    ? ` Fallback: ${options.fallback}.`
    : "";
  return `${options.hardBlockers.join(" ")} Matched roles: ${roleSummary} via ${ruleSummary}.${fallback}`;
}

function requiredAuthorityString(value: unknown, name: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function authorityRoleMap(
  config?: NexusAuthorityConfig,
): Map<string, NexusAuthorityRoleDefinitionConfig> {
  const roleDefinitions = new Map<string, NexusAuthorityRoleDefinitionConfig>();
  for (const role of recommendedNexusAuthorityRoleDefinitions) {
    roleDefinitions.set(role.id, copyAuthorityRoleDefinition(role));
  }
  for (const role of config?.roles ?? []) {
    roleDefinitions.set(role.id, copyAuthorityRoleDefinition(role));
  }

  return roleDefinitions;
}

function copyAuthorityRoleDefinition(
  role: NexusAuthorityRoleDefinitionConfig,
): NexusAuthorityRoleDefinitionConfig {
  return {
    id: role.id,
    ...(role.name !== undefined ? { name: role.name } : {}),
    ...(role.description !== undefined ? { description: role.description } : {}),
    actions: uniqueValues(role.actions),
  };
}

function copyAuthorityRoleBinding(
  binding: NexusAuthorityRoleBindingConfig,
): NexusAuthorityRoleBindingConfig {
  return {
    actorId: binding.actorId,
    roles: [...binding.roles],
    scope: { ...binding.scope },
  };
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function currentActorResolution(options: {
  componentId: string;
  status: NexusCurrentActorResolutionStatus;
  expectedActor: NexusAuthorityActorConfig | null;
  profileId: string | null;
  profiles: NexusCurrentActorProfileResolution[];
  roles: string[];
  actions: NexusAuthorityAction[];
  warnings: string[];
}): NexusCurrentActorResolution {
  return {
    componentId: options.componentId,
    status: options.status,
    expectedActorId: options.expectedActor?.id ?? null,
    expectedActorKind: options.expectedActor?.kind ?? null,
    expectedProvider: options.expectedActor?.provider ?? null,
    expectedHandle: options.expectedActor?.providerIdentity ?? null,
    profileId: options.profileId,
    profiles: options.profiles,
    roles: options.roles,
    actions: options.actions,
    warnings: options.warnings,
  };
}

function expectedAuthorityActor(
  actors: readonly NexusAuthorityActorConfig[],
  publicationActor: NexusPublicationActorConfig | null,
): NexusAuthorityActorConfig | null {
  if (!publicationActor) {
    return null;
  }
  if (publicationActor.id) {
    return actors.find((actor) => actor.id === publicationActor.id) ?? null;
  }

  return actors.find((actor) =>
    providerMatches(actor.provider, publicationActor.provider) &&
    authorityKindMatchesPublicationKind(actor.kind, publicationActor.kind) &&
    publicationActorHandleMatches(actor, publicationActor)
  ) ?? null;
}

function publicationActorAsAuthorityActor(
  actor: NexusPublicationActorConfig,
): NexusAuthorityActorConfig {
  return {
    id: actor.id ?? "unknown",
    kind: publicationKindAsAuthorityKind(actor.kind),
    provider: actor.provider,
    providerIdentity: actor.handle ?? actor.id ?? "unknown",
    displayName: actor.handle ?? actor.id ?? "Unknown actor",
  };
}

function publicationKindAsAuthorityKind(
  kind: NexusPublicationActorConfig["kind"],
): NexusAuthorityActorKind {
  return kind === "app" ? "service_account" : kind;
}

function authorityKindMatchesPublicationKind(
  authorityKind: NexusAuthorityActorKind,
  publicationKind: NexusPublicationActorConfig["kind"],
): boolean {
  return authorityKind === publicationKindAsAuthorityKind(publicationKind);
}

function publicationActorHandleMatches(
  actor: NexusAuthorityActorConfig,
  publicationActor: NexusPublicationActorConfig,
): boolean {
  const handle = publicationActor.handle ?? publicationActor.id;
  if (!handle) {
    return false;
  }

  return handlesEqual(actor.providerIdentity, handle) ||
    Object.values(actor.handles ?? {}).some((value) => handlesEqual(value, handle));
}

function authProfileKindCanActAsAutomation(
  profileKind: NexusHostingAuthProfileKind | undefined,
  actorKind: NexusAuthorityActorKind,
): boolean {
  if (actorKind === "human") {
    return profileKind === "human";
  }
  return profileKind === "automation" || profileKind === "app";
}

function profileLooksLikePublicationActor(
  profile: NexusHostingAuthProfileConfig,
  actor: NexusAuthorityActorConfig,
  publication: NexusAutomationPublicationConfig,
): boolean {
  return authProfileResolution(profile, actor, publication).mechanisms.length > 0;
}

function authProfileResolution(
  profile: NexusHostingAuthProfileConfig,
  actor: NexusAuthorityActorConfig,
  publication: NexusAutomationPublicationConfig,
): NexusCurrentActorProfileResolution {
  return {
    id: profile.id,
    actorId: profile.actorId ?? null,
    kind: profile.kind ?? null,
    account: profile.account ?? null,
    mechanisms: authProfileMechanisms(profile, actor, publication),
  };
}

function authProfileMechanisms(
  profile: NexusHostingAuthProfileConfig,
  actor: NexusAuthorityActorConfig,
  publication: NexusAutomationPublicationConfig,
): string[] {
  const mechanisms: string[] = [];
  if (profile.actorId === actor.id) {
    mechanisms.push("actorId");
  }
  if (
    profile.account &&
    (handlesEqual(profile.account, actor.providerIdentity) ||
      Object.values(actor.handles ?? {}).some((value) =>
        handlesEqual(profile.account!, value)
      ))
  ) {
    mechanisms.push("account");
  }
  if (
    publication.sshHostAlias &&
    (profile.sshHost === publication.sshHostAlias ||
      profile.host === publication.sshHostAlias)
  ) {
    mechanisms.push("sshHost");
  }
  if (
    profile.githubCliConfigDir &&
    Object.values(publication.commandEnvironment).includes(
      profile.githubCliConfigDir,
    )
  ) {
    mechanisms.push("githubCliConfigDir");
  }
  const commandEnvironmentKeys = new Set(
    Object.keys(publication.commandEnvironment),
  );
  if (
    (profile.environmentKeys ?? []).some((key) => commandEnvironmentKeys.has(key))
  ) {
    mechanisms.push("environmentKeys");
  }

  return uniqueValues(mechanisms);
}

function providerMatches(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function handlesEqual(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}
