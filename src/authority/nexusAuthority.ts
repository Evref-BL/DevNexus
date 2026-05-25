import type {
  NexusAutomationSafetyConfig,
  NexusAutomationPublicationConfig,
  NexusPublicationActorConfig,
} from "../automation/nexusAutomationConfig.js";
import type {
  NexusHostingAuthProfileConfig,
  NexusHostingAuthProfileKind,
} from "../project/nexusProjectHosting.js";

export const nexusAuthorityActionNames = [
  "project.read",
  "work_item.read",
  "work_item.update",
  "work_item.comment",
  "work_item.close",
  "coordination.handoff",
  "worktree.create",
  "worktree.delete",
  "git.branch.create",
  "git.branch.delete",
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
  "package.publish",
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
      "May update workspace state, push branches, open review requests, and integrate approved work when publication policy allows it.",
    actions: [
      "project.read",
      "work_item.read",
      "work_item.update",
      "work_item.comment",
      "work_item.close",
      "coordination.handoff",
      "worktree.create",
      "worktree.delete",
      "git.branch.create",
      "git.branch.delete",
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
      "May read workspace and provider state and produce handoffs without source, tracker, provider, or runtime mutation authority.",
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
      "package.publish",
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
  componentId: string | null;
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
  componentId: string | null;
  publication: NexusAutomationPublicationConfig;
  authProfiles?: NexusHostingAuthProfileConfig[];
  repository?: string | null;
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
  | "checks_stale"
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
  blockingReasons: string[];
  fallbackSuggestion: string | null;
  explanation: string;
}

export interface NexusAuthorityMutationBlock {
  kind: "authority_blocked_mutation";
  action: NexusAuthorityAction;
  status: NexusEffectiveAuthorityStatus;
  reason: string;
  fallbackAction: NexusAuthorityAction | null;
  fallbackSuggestion: string | null;
  missingRequiredActions: NexusAuthorityAction[];
  missingProviderSignals: NexusAuthorityRequiredProviderSignal[];
  blockingReasons: string[];
  authority: NexusEffectiveAuthorityResolution;
}

export class NexusAuthorityMutationError extends Error {
  readonly block: NexusAuthorityMutationBlock;

  constructor(block: NexusAuthorityMutationBlock) {
    super(block.reason);
    this.name = "NexusAuthorityMutationError";
    this.block = block;
  }
}

export interface NexusAuthorityRoleBindingSummary {
  roles: string[];
  scope: NexusAuthorityScopeConfig;
}

export interface NexusAuthorityAuthProfileSummary {
  id: string;
  provider: string | null;
  kind: NexusHostingAuthProfileKind | null;
}

export interface NexusAuthorityActorIdentitySummary {
  status: NexusCurrentActorResolutionStatus;
  actorId: string | null;
  knownActor: boolean;
  kind: NexusAuthorityActorKind | null;
  provider: string | null;
  handle: string | null;
  displayName: string | null;
}

export interface NexusAuthorityActionDecisionSummary {
  key: string;
  action: NexusAuthorityAction;
  status: NexusEffectiveAuthorityStatus;
  allowed: boolean;
  fallbackAction: NexusAuthorityAction | null;
  missingRequiredActions: NexusAuthorityAction[];
  missingProviderSignals: NexusAuthorityRequiredProviderSignal[];
  explanation: string;
}

export interface NexusAuthorityComponentSummary {
  version: 1;
  componentId: string;
  componentName: string | null;
  actor: NexusAuthorityActorIdentitySummary;
  authProfile: NexusAuthorityAuthProfileSummary | null;
  roleBindings: NexusAuthorityRoleBindingSummary[];
  roles: string[];
  keyAllowedActions: NexusAuthorityAction[];
  blockedActions: NexusAuthorityAction[];
  waitingActions: NexusAuthorityAction[];
  fallbackActions: NexusAuthorityAction[];
  decisions: NexusAuthorityActionDecisionSummary[];
  warnings: string[];
  summary: string;
}

export interface NexusAuthorityProjectSummary {
  version: 1;
  projectId: string;
  components: NexusAuthorityComponentSummary[];
  warnings: string[];
  summary: string;
}

export interface NexusAuthorityComponentSummaryInput {
  projectId: string;
  componentId: string;
  componentName?: string | null;
  authority?: NexusAuthorityConfig;
  publication: NexusAutomationPublicationConfig;
  safety?: NexusAutomationSafetyConfig | null;
  authProfiles?: NexusHostingAuthProfileConfig[];
  currentActor?: NexusCurrentActorResolution | null;
  provider?: string | null;
  tracker?: string | null;
  repository?: string | null;
  environment?: string | null;
}

export interface NexusAuthorityProjectSummaryInput {
  projectId: string;
  authority?: NexusAuthorityConfig;
  components: NexusAuthorityComponentSummaryInput[];
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

const nexusAuthoritySummaryActionSpecs = [
  { key: "read_project", action: "project.read" },
  { key: "commit", action: "git.commit" },
  { key: "push_branch", action: "git.push_branch" },
  { key: "direct_integration", action: "git.push_target_branch" },
  { key: "delete_worktree", action: "worktree.delete" },
  { key: "delete_branch", action: "git.branch.delete" },
  { key: "open_pull_request", action: "provider.pull_request.open" },
  { key: "merge_pull_request", action: "provider.pull_request.merge" },
  { key: "publish_package", action: "package.publish" },
  { key: "publish_release", action: "release.publish" },
  { key: "request_review", action: "provider.review.request" },
  { key: "approve_review", action: "provider.review.approve" },
  { key: "request_changes", action: "provider.review.reject" },
  { key: "comment_work_item", action: "work_item.comment" },
  { key: "update_work_item", action: "work_item.update" },
  { key: "comment_provider", action: "provider.comment" },
  { key: "label_provider", action: "provider.label" },
  { key: "assign_provider", action: "provider.assign" },
  { key: "transition_provider", action: "provider.transition" },
  { key: "handoff", action: "coordination.handoff" },
] as const satisfies Array<{ key: string; action: NexusAuthorityAction }>;

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
    provider: options.provider ?? options.authProfile?.provider ?? null,
    authProfile: options.authProfile ?? null,
  });
  const publicationProfileBlocker = publicationActionAuthProfileBlocker({
    actorId,
    requestedAction: options.requestedAction,
    authProfile: options.authProfile ?? null,
  });
  const hasRequestedAction =
    scopedAuthority.actions.includes(options.requestedAction);
  const publicationPolicyBlockerMessages = publicationPolicyBlockers(options);
  const runtimeSafetyBlockerMessage = runtimeSafetyBlocker(options);
  const policyBlockers = [
    ...publicationPolicyBlockerMessages,
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
    ...(publicationProfileBlocker ? [publicationProfileBlocker] : []),
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
        options.publication ?? null,
      );
  const fallbackSuggestion = publicationFallbackSuggestion(
    options.requestedAction,
    recommendedFallbackAction,
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
    blockingReasons: hardBlockers,
    fallbackSuggestion,
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

export function nexusAuthorityMutationBlock(
  authority: NexusEffectiveAuthorityResolution,
): NexusAuthorityMutationBlock {
  return {
    kind: "authority_blocked_mutation",
    action: authority.requestedAction,
    status: authority.status,
    reason: authority.explanation,
    fallbackAction: authority.recommendedFallbackAction,
    fallbackSuggestion: authority.fallbackSuggestion,
    missingRequiredActions: [...authority.missingRequiredActions],
    missingProviderSignals: [...authority.missingProviderSignals],
    blockingReasons: [...authority.blockingReasons],
    authority,
  };
}

export function unconfiguredNexusAuthorityAllowedResolution(
  requestedAction: NexusAuthorityAction,
): NexusEffectiveAuthorityResolution {
  return {
    status: "allowed",
    allowed: true,
    requestedAction,
    actorId: null,
    knownActor: false,
    authProfileId: null,
    matchedActorId: null,
    matchedRoles: [],
    matchedRule: null,
    matchedBindings: [],
    missingRequiredActions: [],
    missingProviderSignals: [],
    recommendedFallbackAction: null,
    blockingReasons: [],
    fallbackSuggestion: null,
    explanation:
      `No authority policy is configured; ${requestedAction} is allowed by compatibility default.`,
  };
}

export function assertNexusAuthorityMutationAllowed(
  authority: NexusEffectiveAuthorityResolution,
): void {
  if (authority.allowed) {
    return;
  }

  throw new NexusAuthorityMutationError(nexusAuthorityMutationBlock(authority));
}

export function resolveNexusEffectiveAuthorityForCurrentActor(
  options: Omit<ResolveNexusEffectiveAuthorityOptions, "actor" | "authProfile"> & {
    currentActor: NexusCurrentActorResolution;
    authProfiles?: NexusHostingAuthProfileConfig[];
  },
): NexusEffectiveAuthorityResolution {
  const authProfile = currentActorAuthProfile(
    options.currentActor,
    options.authProfiles ?? [],
  );
  return resolveNexusEffectiveAuthority({
    ...options,
    actor: {
      id: options.currentActor.expectedActorId,
      kind: options.currentActor.expectedActorKind,
      provider: options.currentActor.expectedProvider,
      providerIdentity: options.currentActor.expectedHandle,
    },
    authProfile,
  });
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

  const repositoryProfileFilter = filterProfilesForPublicationRepository(
    validKindProfiles,
    options.repository,
  );
  const candidateProfiles =
    repositoryProfileFilter.matchedProfiles.length > 0
      ? repositoryProfileFilter.matchedProfiles
      : repositoryProfileFilter.unscopedProfiles;
  if (candidateProfiles.length === 0) {
    return currentActorResolution({
      componentId: options.componentId,
      status: "missing",
      expectedActor: expected,
      profileId: null,
      profiles: [],
      roles: authority.roles,
      actions: authority.actions,
      warnings: [
        `No host-local auth profile for automation actor ${expected.id} matches publication repository ${options.repository ?? "unknown"}.`,
      ],
    });
  }
  const mechanismMatchedProfiles = candidateProfiles
    .map((profile) => authProfileResolution(profile, expected, options.publication))
    .filter((profile) =>
      profile.mechanisms.some((mechanism) => mechanism !== "actorId")
    );
  const selectedProfiles = mechanismMatchedProfiles.length > 0
    ? mechanismMatchedProfiles
    : candidateProfiles.map((profile) =>
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

export function summarizeNexusAuthorityForProject(
  options: NexusAuthorityProjectSummaryInput,
): NexusAuthorityProjectSummary {
  const components = options.components.map((component) =>
    summarizeNexusAuthorityForComponent({
      ...component,
      projectId: options.projectId,
      authority: component.authority ?? options.authority,
    })
  );
  const warnings = uniqueValues(
    components.flatMap((component) => component.warnings),
  );

  return {
    version: 1,
    projectId: options.projectId,
    components,
    warnings,
    summary: projectAuthoritySummaryText(options.projectId, components),
  };
}

export function summarizeNexusAuthorityForComponent(
  options: NexusAuthorityComponentSummaryInput,
): NexusAuthorityComponentSummary {
  const policy = normalizeNexusAuthorityPolicy(options.authority);
  const currentActor =
    options.currentActor ??
    resolveNexusCurrentAutomationActor({
      authority: options.authority,
      componentId: options.componentId,
      publication: options.publication,
      authProfiles: options.authProfiles,
      repository: options.repository,
    });
  const actorId = currentActor.expectedActorId;
  const actor = actorId
    ? policy.actors.find((candidate) => candidate.id === actorId) ?? null
    : null;
  const authProfile = currentActor.profileId
    ? (options.authProfiles ?? []).find(
        (profile) => profile.id === currentActor.profileId,
      ) ?? null
    : null;
  const currentActorProfile = currentActor.profileId
    ? currentActor.profiles.find((profile) => profile.id === currentActor.profileId) ??
      null
    : null;
  const provider =
    optionalAuthorityString(options.provider) ??
    currentActor.expectedProvider ??
    options.publication.actor?.provider ??
    options.publication.manualActor?.provider ??
    null;
  const requestScope = {
    project: options.projectId,
    component: options.componentId,
    provider,
    tracker: optionalAuthorityString(options.tracker),
    repository: optionalAuthorityString(options.repository),
    targetBranch: options.publication.targetBranch,
    environment: optionalAuthorityString(options.environment),
  };
  const scopedAuthority = resolveScopedNexusAuthority({
    config: options.authority,
    policy,
    actorId: actorId ?? "unknown",
    scope: requestScope,
  });
  const roleBindings = scopedAuthority.matchedBindings.map((match) => ({
    roles: [...match.binding.roles],
    scope: { ...match.binding.scope },
  }));
  const decisions = nexusAuthoritySummaryActionSpecs.map((spec) => {
    const decision = resolveNexusEffectiveAuthority({
      authority: options.authority,
      actor: {
        id: actorId,
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
        : currentActorProfile
          ? {
              id: currentActorProfile.id,
              actorId: currentActorProfile.actorId,
              kind: currentActorProfile.kind,
              provider: null,
              account: currentActorProfile.account,
            }
        : null,
      project: options.projectId,
      component: options.componentId,
      provider,
      tracker: options.tracker,
      remote: options.publication.remote,
      repository: options.repository,
      targetBranch: options.publication.targetBranch,
      environment: options.environment,
      requestedAction: spec.action,
      publication: options.publication,
      safety: options.safety ?? null,
    });

    return {
      key: spec.key,
      action: spec.action,
      status: decision.status,
      allowed: decision.allowed,
      fallbackAction: decision.recommendedFallbackAction,
      missingRequiredActions: [...decision.missingRequiredActions],
      missingProviderSignals: [...decision.missingProviderSignals],
      explanation: decision.explanation,
    } satisfies NexusAuthorityActionDecisionSummary;
  });
  const keyAllowedActions = decisions
    .filter((decision) => decision.allowed)
    .map((decision) => decision.action);
  const blockedActions = decisions
    .filter((decision) => decision.status === "blocked")
    .map((decision) => decision.action);
  const waitingActions = decisions
    .filter((decision) => decision.status === "waiting")
    .map((decision) => decision.action);
  const fallbackActions = uniqueValues(
    decisions.flatMap((decision) =>
      decision.fallbackAction ? [decision.fallbackAction] : []
    ),
  );

  const componentSummary: NexusAuthorityComponentSummary = {
    version: 1,
    componentId: options.componentId,
    componentName: options.componentName ?? null,
    actor: {
      status: currentActor.status,
      actorId,
      knownActor: scopedAuthority.knownActor,
      kind: currentActor.expectedActorKind,
      provider: currentActor.expectedProvider,
      handle: currentActor.expectedHandle,
      displayName: actor?.displayName ?? null,
    },
    authProfile: authProfile
      ? {
          id: authProfile.id,
          provider: authProfile.provider,
          kind: authProfile.kind ?? null,
        }
      : currentActorProfile
        ? {
            id: currentActorProfile.id,
            provider: null,
            kind: currentActorProfile.kind,
          }
      : currentActor.profileId
        ? {
            id: currentActor.profileId,
            provider: null,
            kind: null,
          }
        : null,
    roleBindings,
    roles: [...scopedAuthority.roles],
    keyAllowedActions,
    blockedActions,
    waitingActions,
    fallbackActions,
    decisions,
    warnings: [...currentActor.warnings],
    summary: "",
  };
  componentSummary.summary = componentAuthoritySummaryText(componentSummary);

  return componentSummary;
}

export function normalizeNexusAuthorityProjectSummary(
  value: unknown,
  pathName = "authority",
): NexusAuthorityProjectSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error(`${pathName}.version must be 1`);
  }
  const components = requiredAuthorityArray(
    record.components,
    `${pathName}.components`,
  ).map((component, index) =>
    normalizeNexusAuthorityComponentSummary(
      component,
      `${pathName}.components[${index}]`,
    )
  );

  return {
    version: 1,
    projectId: requiredSummaryString(record.projectId, `${pathName}.projectId`),
    components,
    warnings: requiredSummaryStringArray(
      record.warnings,
      `${pathName}.warnings`,
    ),
    summary: requiredSummaryString(record.summary, `${pathName}.summary`),
  };
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

function matchingAuthorityRoleBindingSummaries(
  bindings: readonly NexusAuthorityRoleBindingConfig[],
  actorId: string,
  requestScope: NexusEffectiveAuthorityRequestScope,
): NexusAuthorityRoleBindingSummary[] {
  return bindings
    .filter((binding) => binding.actorId === actorId)
    .filter((binding) => authorityScopeMatches(binding.scope, requestScope))
    .map((binding) => ({
      roles: [...binding.roles],
      scope: { ...binding.scope },
    }));
}

function projectAuthoritySummaryText(
  projectId: string,
  components: readonly NexusAuthorityComponentSummary[],
): string {
  if (components.length === 0) {
    return `Workspace ${projectId} has no component authority summaries.`;
  }

  return components
    .map((component) => component.summary)
    .join(" ");
}

function componentAuthoritySummaryText(
  component: NexusAuthorityComponentSummary,
): string {
  const actor = component.actor.actorId ?? "unknown";
  const profile = component.authProfile?.id ?? "none";
  const roles = component.roles.length > 0 ? component.roles.join(",") : "none";
  const allowed = component.keyAllowedActions.length > 0
    ? component.keyAllowedActions.join(",")
    : "none";
  const blocked = component.blockedActions.length > 0
    ? component.blockedActions.join(",")
    : "none";
  const waiting = component.waitingActions.length > 0
    ? component.waitingActions.join(",")
    : "none";
  const fallback = component.fallbackActions.length > 0
    ? component.fallbackActions.join(",")
    : "none";

  return `${component.componentId}: actor=${actor} profile=${profile} roles=${roles} allowed=${allowed} blocked=${blocked} waiting=${waiting} fallback=${fallback}`;
}

function normalizeNexusAuthorityComponentSummary(
  value: unknown,
  pathName: string,
): NexusAuthorityComponentSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error(`${pathName}.version must be 1`);
  }

  return {
    version: 1,
    componentId: requiredSummaryString(record.componentId, `${pathName}.componentId`),
    componentName: nullableSummaryString(record.componentName, `${pathName}.componentName`),
    actor: normalizeAuthorityActorIdentitySummary(
      record.actor,
      `${pathName}.actor`,
    ),
    authProfile: nullableAuthorityAuthProfileSummary(
      record.authProfile,
      `${pathName}.authProfile`,
    ),
    roleBindings: requiredAuthorityArray(
      record.roleBindings,
      `${pathName}.roleBindings`,
    ).map((binding, index) =>
      normalizeAuthorityRoleBindingSummary(
        binding,
        `${pathName}.roleBindings[${index}]`,
      )
    ),
    roles: requiredSummaryStringArray(record.roles, `${pathName}.roles`),
    keyAllowedActions: authorityActionArray(
      record.keyAllowedActions,
      `${pathName}.keyAllowedActions`,
    ),
    blockedActions: authorityActionArray(
      record.blockedActions,
      `${pathName}.blockedActions`,
    ),
    waitingActions: authorityActionArray(
      record.waitingActions,
      `${pathName}.waitingActions`,
    ),
    fallbackActions: authorityActionArray(
      record.fallbackActions,
      `${pathName}.fallbackActions`,
    ),
    decisions: requiredAuthorityArray(
      record.decisions,
      `${pathName}.decisions`,
    ).map((decision, index) =>
      normalizeAuthorityActionDecisionSummary(
        decision,
        `${pathName}.decisions[${index}]`,
      )
    ),
    warnings: requiredSummaryStringArray(
      record.warnings,
      `${pathName}.warnings`,
    ),
    summary: requiredSummaryString(record.summary, `${pathName}.summary`),
  };
}

function normalizeAuthorityActorIdentitySummary(
  value: unknown,
  pathName: string,
): NexusAuthorityActorIdentitySummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;

  return {
    status: authorityActorStatus(record.status, `${pathName}.status`),
    actorId: nullableSummaryString(record.actorId, `${pathName}.actorId`),
    knownActor: requiredAuthorityBoolean(
      record.knownActor,
      `${pathName}.knownActor`,
    ),
    kind: nullableAuthorityActorKind(record.kind, `${pathName}.kind`),
    provider: nullableSummaryString(record.provider, `${pathName}.provider`),
    handle: nullableSummaryString(record.handle, `${pathName}.handle`),
    displayName: nullableSummaryString(
      record.displayName,
      `${pathName}.displayName`,
    ),
  };
}

function nullableAuthorityAuthProfileSummary(
  value: unknown,
  pathName: string,
): NexusAuthorityAuthProfileSummary | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object or null`);
  }
  const record = value as Record<string, unknown>;

  return {
    id: requiredSummaryString(record.id, `${pathName}.id`),
    provider: nullableSummaryString(record.provider, `${pathName}.provider`),
    kind: nullableAuthProfileKind(record.kind, `${pathName}.kind`),
  };
}

function normalizeAuthorityRoleBindingSummary(
  value: unknown,
  pathName: string,
): NexusAuthorityRoleBindingSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;

  return {
    roles: requiredSummaryStringArray(record.roles, `${pathName}.roles`),
    scope: authorityScopeFromUnknown(record.scope, `${pathName}.scope`),
  };
}

function normalizeAuthorityActionDecisionSummary(
  value: unknown,
  pathName: string,
): NexusAuthorityActionDecisionSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;

  return {
    key: requiredSummaryString(record.key, `${pathName}.key`),
    action: authorityAction(record.action, `${pathName}.action`),
    status: effectiveAuthorityStatus(record.status, `${pathName}.status`),
    allowed: requiredAuthorityBoolean(record.allowed, `${pathName}.allowed`),
    fallbackAction:
      nullableAuthorityAction(record.fallbackAction, `${pathName}.fallbackAction`),
    missingRequiredActions: authorityActionArray(
      record.missingRequiredActions,
      `${pathName}.missingRequiredActions`,
    ),
    missingProviderSignals: authorityProviderSignalArray(
      record.missingProviderSignals,
      `${pathName}.missingProviderSignals`,
    ),
    explanation: requiredSummaryString(
      record.explanation,
      `${pathName}.explanation`,
    ),
  };
}

function authorityScopeFromUnknown(
  value: unknown,
  pathName: string,
): NexusAuthorityScopeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }
  const record = value as Record<string, unknown>;
  return {
    ...(record.project !== undefined
      ? { project: requiredSummaryString(record.project, `${pathName}.project`) }
      : {}),
    ...(record.component !== undefined
      ? {
          component: requiredSummaryString(
            record.component,
            `${pathName}.component`,
          ),
        }
      : {}),
    ...(record.provider !== undefined
      ? {
          provider: requiredSummaryString(record.provider, `${pathName}.provider`),
        }
      : {}),
    ...(record.tracker !== undefined
      ? { tracker: requiredSummaryString(record.tracker, `${pathName}.tracker`) }
      : {}),
    ...(record.repository !== undefined
      ? {
          repository: requiredSummaryString(
            record.repository,
            `${pathName}.repository`,
          ),
        }
      : {}),
    ...(record.targetBranch !== undefined
      ? {
          targetBranch: requiredSummaryString(
            record.targetBranch,
            `${pathName}.targetBranch`,
          ),
        }
      : {}),
    ...(record.environment !== undefined
      ? {
          environment: requiredSummaryString(
            record.environment,
            `${pathName}.environment`,
          ),
        }
      : {}),
  };
}

function requiredAuthorityArray(value: unknown, pathName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${pathName} must be an array`);
  }
  return value;
}

function requiredSummaryStringArray(
  value: unknown,
  pathName: string,
): string[] {
  return requiredAuthorityArray(value, pathName).map((item, index) =>
    requiredSummaryString(item, `${pathName}[${index}]`)
  );
}

function authorityActionArray(
  value: unknown,
  pathName: string,
): NexusAuthorityAction[] {
  return requiredAuthorityArray(value, pathName).map((item, index) =>
    authorityAction(item, `${pathName}[${index}]`)
  );
}

function authorityProviderSignalArray(
  value: unknown,
  pathName: string,
): NexusAuthorityRequiredProviderSignal[] {
  return requiredAuthorityArray(value, pathName).map((item, index) =>
    authorityProviderSignal(item, `${pathName}[${index}]`)
  );
}

function requiredSummaryString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName} must be a non-empty string`);
  }

  return value.trim();
}

function nullableSummaryString(value: unknown, pathName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requiredSummaryString(value, pathName);
}

function requiredAuthorityBoolean(value: unknown, pathName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${pathName} must be a boolean`);
  }

  return value;
}

function authorityActorStatus(
  value: unknown,
  pathName: string,
): NexusCurrentActorResolutionStatus {
  if (
    value === "matched" ||
    value === "missing" ||
    value === "ambiguous" ||
    value === "mismatched" ||
    value === "unknown"
  ) {
    return value;
  }

  throw new Error(`${pathName} must be a current actor status`);
}

function effectiveAuthorityStatus(
  value: unknown,
  pathName: string,
): NexusEffectiveAuthorityStatus {
  if (value === "allowed" || value === "blocked" || value === "waiting") {
    return value;
  }

  throw new Error(`${pathName} must be allowed, blocked, or waiting`);
}

function nullableAuthorityActorKind(
  value: unknown,
  pathName: string,
): NexusAuthorityActorKind | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    value === "human" ||
    value === "machine_user" ||
    value === "service_account" ||
    value === "external_agent" ||
    value === "local" ||
    value === "team"
  ) {
    return value;
  }

  throw new Error(`${pathName} must be a valid authority actor kind or null`);
}

function nullableAuthProfileKind(
  value: unknown,
  pathName: string,
): NexusHostingAuthProfileKind | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === "human" || value === "automation" || value === "app") {
    return value;
  }

  throw new Error(`${pathName} must be human, automation, app, or null`);
}

function authorityAction(
  value: unknown,
  pathName: string,
): NexusAuthorityAction {
  if (
    typeof value === "string" &&
    (nexusAuthorityActionNames as readonly string[]).includes(value)
  ) {
    return value as NexusAuthorityAction;
  }

  throw new Error(`${pathName} must be a valid authority action`);
}

function nullableAuthorityAction(
  value: unknown,
  pathName: string,
): NexusAuthorityAction | null {
  if (value === undefined || value === null) {
    return null;
  }

  return authorityAction(value, pathName);
}

function authorityProviderSignal(
  value: unknown,
  pathName: string,
): NexusAuthorityRequiredProviderSignal {
  if (
    value === "pull_request_review.approved" ||
    value === "issue_design.approved" ||
    value === "checks.passed" ||
    value === "mergeable" ||
    value === "branch_policy.clear"
  ) {
    return value;
  }

  throw new Error(`${pathName} must be a valid authority provider signal`);
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
  provider: string | null;
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
  if (
    profile.provider &&
    options.provider &&
    !providerMatches(profile.provider, options.provider)
  ) {
    return `Auth profile ${profile.id} is for provider ${profile.provider}, not requested provider ${options.provider}.`;
  }

  return null;
}

function publicationActionAuthProfileBlocker(options: {
  actorId: string;
  requestedAction: NexusAuthorityAction;
  authProfile: NexusEffectiveAuthorityAuthProfileInput | null;
}): string | null {
  if (!publicationActionRequiresResolvedAuthProfile(options.requestedAction)) {
    return null;
  }
  if (!options.authProfile) {
    return `No resolved auth profile is available for publication action ${options.requestedAction}.`;
  }
  if (!options.authProfile.actorId) {
    return `Auth profile ${options.authProfile.id} is not bound to an authority actor for publication action ${options.requestedAction}.`;
  }
  if (
    options.actorId !== "unknown" &&
    options.authProfile.actorId !== options.actorId
  ) {
    return null;
  }

  return null;
}

function publicationActionRequiresResolvedAuthProfile(
  action: NexusAuthorityAction,
): boolean {
  return (
    action === "git.push_target_branch" ||
    action === "provider.pull_request.open" ||
    action === "provider.pull_request.merge" ||
    action === "package.publish" ||
    action === "release.publish"
  );
}

function publicationPolicyBlockers(
  options: ResolveNexusEffectiveAuthorityOptions,
): string[] {
  const blockers = [
    directIntegrationPolicyBlocker(options),
    pullRequestOpenPolicyBlocker(options),
    pullRequestMergePolicyBlocker(options),
    packageOrReleasePublicationPolicyBlocker(options),
  ];
  return blockers.filter((blocker): blocker is string => Boolean(blocker));
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
  return (
    directIntegrationStrategyBlocker(publication) ??
    publicationScopeBlocker("remote", publication.remote, options.remote) ??
    publicationScopeBlocker(
      "target branch",
      publication.targetBranch,
      options.targetBranch,
    )
  );
}

function directIntegrationStrategyBlocker(
  publication: NexusAutomationPublicationConfig,
): string | null {
  if (publication.strategy === "green_main") {
    const directTargetPush =
      publication.greenMain?.directTargetPush ?? "blocked";
    return directTargetPush === "blocked" || !publication.push
      ? `Component publication policy is green_main with directTargetPush=${directTargetPush} and push=${publication.push}; direct target-branch push is blocked.`
      : null;
  }
  return publication.strategy !== "direct_integration" || !publication.push
    ? `Component publication policy is ${publication.strategy} with push=${publication.push}; direct integration requires direct_integration with push enabled.`
    : null;
}

function publicationScopeBlocker(
  label: "remote" | "target branch",
  configured: string | null | undefined,
  requested: string | null | undefined,
): string | null {
  if (
    !configured ||
    !requested ||
    authorityScopeValueMatches(configured, requested)
  ) {
    return null;
  }
  return label === "remote"
    ? `Requested remote ${requested} does not match publication remote ${configured}.`
    : `Requested target branch ${requested} does not match publication target branch ${configured}.`;
}

function pullRequestOpenPolicyBlocker(
  options: ResolveNexusEffectiveAuthorityOptions,
): string | null {
  if (options.requestedAction !== "provider.pull_request.open") {
    return null;
  }
  const publication = options.publication;
  if (!publication) {
    return "Component publication policy is unavailable; review request publication is blocked.";
  }
  if (publication.strategy === "local_only") {
    return "Component publication policy is local_only; pull request or merge request publication is not configured.";
  }

  return null;
}

function pullRequestMergePolicyBlocker(
  options: ResolveNexusEffectiveAuthorityOptions,
): string | null {
  if (options.requestedAction !== "provider.pull_request.merge") {
    return null;
  }
  const publication = options.publication;
  if (!publication) {
    return "Component publication policy is unavailable; pull request or merge request merge is blocked.";
  }
  if (publication.strategy === "local_only") {
    return "Component publication policy is local_only; pull request or merge request merge is blocked.";
  }

  return null;
}

function packageOrReleasePublicationPolicyBlocker(
  options: ResolveNexusEffectiveAuthorityOptions,
): string | null {
  if (
    options.requestedAction !== "package.publish" &&
    options.requestedAction !== "release.publish"
  ) {
    return null;
  }
  const publication = options.publication;
  if (!publication) {
    return `Component publication policy is unavailable; ${options.requestedAction} is blocked.`;
  }
  if (publication.strategy === "local_only") {
    return `Component publication policy is local_only; ${options.requestedAction} is blocked.`;
  }
  if (
    options.requestedAction === "package.publish" &&
    !publication.packagePublish
  ) {
    return "Component publication policy does not allow package publication.";
  }
  if (
    options.requestedAction === "release.publish" &&
    !publication.releasePublish
  ) {
    return "Component publication policy does not allow release publication.";
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
  const evaluations = [
    pullRequestReviewProviderEvaluation(pullRequest?.review ?? "unknown"),
    pullRequestChecksProviderEvaluation(pullRequest?.checks ?? "unknown"),
    pullRequestMergeabilityProviderEvaluation(
      pullRequest?.mergeability ?? "unknown",
    ),
    branchPolicyProviderEvaluation(
      pullRequest?.branchPolicy ?? providerState?.branchPolicy ?? "unknown",
    ),
  ];
  const missingProviderSignals = evaluations.flatMap(
    (evaluation) => evaluation.missingProviderSignals,
  );
  const blockers = evaluations.flatMap((evaluation) => evaluation.blockers);

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

interface ProviderSignalEvaluation {
  missingProviderSignals: NexusAuthorityRequiredProviderSignal[];
  blockers: string[];
}

function providerSignalSatisfied(): ProviderSignalEvaluation {
  return { missingProviderSignals: [], blockers: [] };
}

function providerSignalBlockers<Signal extends string>(
  signal: Signal,
  blockersBySignal: Partial<Record<Signal, string>>,
): string[] {
  const blocker = blockersBySignal[signal];
  return blocker ? [blocker] : [];
}

function pullRequestReviewProviderEvaluation(
  review: NexusAuthorityPullRequestReviewSignal,
): ProviderSignalEvaluation {
  return review === "approved"
    ? providerSignalSatisfied()
    : {
        missingProviderSignals: ["pull_request_review.approved"],
        blockers: providerSignalBlockers(review, {
          changes_requested: `Pull request review state is ${review}.`,
          rejected: `Pull request review state is ${review}.`,
          timed_out: `Pull request review state is ${review}.`,
        }),
      };
}

function pullRequestChecksProviderEvaluation(
  checks: NexusAuthorityProviderChecksSignal,
): ProviderSignalEvaluation {
  return checks === "checks_passed"
    ? providerSignalSatisfied()
    : {
        missingProviderSignals: ["checks.passed"],
        blockers: providerSignalBlockers(checks, {
          checks_failed: "Required checks failed.",
          checks_stale: "Required checks are stale.",
        }),
      };
}

function pullRequestMergeabilityProviderEvaluation(
  mergeability: NexusAuthorityMergeabilitySignal,
): ProviderSignalEvaluation {
  return mergeability === "mergeable"
    ? providerSignalSatisfied()
    : {
        missingProviderSignals: ["mergeable"],
        blockers: providerSignalBlockers(mergeability, {
          merge_conflict: "Pull request has merge conflicts.",
        }),
      };
}

function branchPolicyProviderEvaluation(
  branchPolicy: NexusAuthorityBranchPolicySignal,
): ProviderSignalEvaluation {
  return branchPolicy === "clear"
    ? providerSignalSatisfied()
    : {
        missingProviderSignals: ["branch_policy.clear"],
        blockers: providerSignalBlockers(branchPolicy, {
          branch_policy_blocked: "Provider branch policy blocks merge.",
        }),
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
  publication: NexusAutomationPublicationConfig | null,
): NexusAuthorityAction | null {
  const preferences = authorityFallbackPreferences(
    requestedAction,
    missingProviderSignals,
  );
  return preferences.find((action) =>
    availableActions.includes(action) &&
    publicationAllowsFallbackAction(action, publication)
  ) ?? null;
}

function authorityFallbackPreferences(
  requestedAction: NexusAuthorityAction,
  missingProviderSignals: NexusAuthorityRequiredProviderSignal[],
): NexusAuthorityAction[] {
  return missingProviderSignals.includes("pull_request_review.approved")
    ? authorityFallbackPreferenceGroups.reviewSignal
    : authorityFallbackPreferenceGroups.byAction[requestedAction] ?? [];
}

const authorityFallbackPreferenceGroups: {
  reviewSignal: NexusAuthorityAction[];
  byAction: Partial<Record<NexusAuthorityAction, NexusAuthorityAction[]>>;
} = {
  reviewSignal: [
    "provider.review.request",
    "provider.comment",
    "coordination.handoff",
  ],
  byAction: {
    "git.push_target_branch": [
      "provider.pull_request.open",
      "provider.review.request",
      "coordination.handoff",
    ],
    "provider.pull_request.open": ["coordination.handoff"],
    "provider.pull_request.merge": [
      "provider.review.request",
      "provider.comment",
      "coordination.handoff",
    ],
    "provider.review.approve": ["provider.comment", "coordination.handoff"],
    "provider.review.reject": ["provider.comment", "coordination.handoff"],
    "provider.issue.design_approve": [
      "provider.comment",
      "coordination.handoff",
    ],
    "provider.issue.design_reject": [
      "provider.comment",
      "coordination.handoff",
    ],
    "runtime.mutate": ["coordination.handoff"],
    "package.publish": ["coordination.handoff"],
    "release.publish": ["coordination.handoff"],
    "git.push_branch": ["coordination.handoff"],
    "git.commit": ["coordination.handoff"],
    "provider.comment": ["coordination.handoff"],
    "provider.label": ["coordination.handoff"],
    "provider.assign": ["coordination.handoff"],
    "provider.transition": ["coordination.handoff"],
    "work_item.update": ["coordination.handoff"],
    "work_item.comment": ["coordination.handoff"],
    "work_item.close": ["coordination.handoff"],
  },
};

function publicationAllowsFallbackAction(
  action: NexusAuthorityAction,
  publication: NexusAutomationPublicationConfig | null,
): boolean {
  if (
    action === "provider.pull_request.open" ||
    action === "provider.review.request"
  ) {
    return Boolean(publication && publication.strategy !== "local_only");
  }

  return true;
}

function publicationFallbackSuggestion(
  requestedAction: NexusAuthorityAction,
  fallbackAction: NexusAuthorityAction | null,
): string | null {
  if (!fallbackAction) {
    return null;
  }
  if (
    requestedAction === "git.push_target_branch" &&
    fallbackAction === "provider.pull_request.open"
  ) {
    return "Open a pull request or merge request for review instead of pushing the target branch directly.";
  }
  if (fallbackAction === "provider.review.request") {
    return "Request provider review and wait for approval before continuing publication.";
  }
  if (fallbackAction === "provider.comment") {
    return "Leave a provider comment with the blocker and required follow-up.";
  }
  if (fallbackAction === "coordination.handoff") {
    return "Record a coordination handoff with the blocker and required human or maintainer action.";
  }

  return `Use fallback action ${fallbackAction}.`;
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

function optionalAuthorityString(value: string | null | undefined): string | null {
  return normalizeOptionalString(value);
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
  componentId: string | null;
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

function currentActorAuthProfile(
  currentActor: NexusCurrentActorResolution,
  authProfiles: NexusHostingAuthProfileConfig[],
): NexusEffectiveAuthorityAuthProfileInput | null {
  if (!currentActor.profileId) {
    return null;
  }
  const authProfile =
    authProfiles.find((profile) => profile.id === currentActor.profileId) ??
    null;
  if (authProfile) {
    return {
      id: authProfile.id,
      actorId: authProfile.actorId ?? null,
      kind: authProfile.kind ?? null,
      provider: authProfile.provider,
      account: authProfile.account ?? null,
    };
  }
  const currentActorProfile =
    currentActor.profiles.find((profile) => profile.id === currentActor.profileId) ??
    null;
  if (!currentActorProfile) {
    return null;
  }

  return {
    id: currentActorProfile.id,
    actorId: currentActorProfile.actorId,
    kind: currentActorProfile.kind,
    provider: null,
    account: currentActorProfile.account,
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

function filterProfilesForPublicationRepository(
  profiles: NexusHostingAuthProfileConfig[],
  repository: string | null | undefined,
): {
  matchedProfiles: NexusHostingAuthProfileConfig[];
  unscopedProfiles: NexusHostingAuthProfileConfig[];
  scopedProfileCount: number;
} {
  const repositoryRef = parseGitHubRepositoryRef(repository);
  if (!repositoryRef) {
    return {
      matchedProfiles: [],
      unscopedProfiles: profiles,
      scopedProfileCount: 0,
    };
  }
  const scopedProfiles = profiles.filter((profile) =>
    authProfileHasRepositoryScope(profile)
  );
  const unscopedProfiles = profiles.filter((profile) =>
    !authProfileHasRepositoryScope(profile)
  );
  return {
    matchedProfiles: scopedProfiles.filter((profile) =>
      authProfileIncludesRepository(profile, repositoryRef)
    ),
    unscopedProfiles,
    scopedProfileCount: scopedProfiles.length,
  };
}

function authProfileHasRepositoryScope(
  profile: NexusHostingAuthProfileConfig,
): boolean {
  return (
    (profile.repositoryScopes?.length ?? 0) > 0 ||
    Boolean(profile.githubApp)
  );
}

function authProfileIncludesRepository(
  profile: NexusHostingAuthProfileConfig,
  repository: { host: string; owner: string; name: string },
): boolean {
  if ((profile.repositoryScopes?.length ?? 0) > 0) {
    return profile.repositoryScopes!.some((scope) =>
      repositoryScopeMatches(scope, repository)
    );
  }

  return githubAppProfileIncludesRepository(profile, repository);
}

function repositoryScopeMatches(
  scope: string,
  repository: { host: string; owner: string; name: string },
): boolean {
  const normalized = scope.trim();
  if (!normalized) {
    return false;
  }

  const wildcard = parseGitHubRepositoryWildcardScope(normalized);
  if (wildcard) {
    return (
      handlesEqual(wildcard.host, repository.host) &&
      handlesEqual(wildcard.owner, repository.owner)
    );
  }

  const exact = parseGitHubRepositoryRef(normalized);
  return Boolean(
    exact &&
      handlesEqual(exact.host, repository.host) &&
      handlesEqual(exact.owner, repository.owner) &&
      handlesEqual(exact.name, repository.name),
  );
}

function parseGitHubRepositoryWildcardScope(
  scope: string,
): { host: string; owner: string } | null {
  const parts = scope.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2 && parts[1] === "*") {
    return {
      host: "github.com",
      owner: parts[0]!,
    };
  }
  if (parts.length === 3 && parts[2] === "*") {
    return {
      host: parts[0]!,
      owner: parts[1]!,
    };
  }
  return null;
}

function githubAppProfileIncludesRepository(
  profile: NexusHostingAuthProfileConfig,
  repository: { host: string; owner: string; name: string },
): boolean {
  if (profile.provider.toLowerCase() !== "github" || !profile.githubApp) {
    return false;
  }
  const profileHost = profile.host?.trim() || "github.com";
  if (!handlesEqual(profileHost, repository.host)) {
    return false;
  }
  const installationAccount = profile.githubApp.installationAccount?.trim();
  if (
    installationAccount &&
    !handlesEqual(installationAccount, repository.owner)
  ) {
    return false;
  }
  const repositories = profile.githubApp.repositories ?? [];
  if (repositories.length === 0) {
    return true;
  }
  return repositories.some((name) => handlesEqual(name, repository.name));
}

function parseGitHubRepositoryRef(
  repository: string | null | undefined,
): { host: string; owner: string; name: string } | null {
  const normalized = repository?.trim();
  if (!normalized) {
    return null;
  }

  const ownerName = /^([^/\s:]+)\/([^/\s:]+?)(?:\.git)?$/u.exec(normalized);
  if (ownerName) {
    return {
      host: "github.com",
      owner: ownerName[1]!,
      name: ownerName[2]!,
    };
  }

  const scp = /^(?:[^@]+@)?([^:]+):([^/]+)\/(.+)$/u.exec(normalized);
  if (scp) {
    return normalizeGitHubRepositoryRef(scp[1]!, scp[2]!, scp[3]!);
  }

  try {
    const url = new URL(normalized);
    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:" &&
      url.protocol !== "ssh:"
    ) {
      return null;
    }
    const [owner, name, ...extra] = url.pathname.replace(/^\/+/u, "").split("/");
    if (extra.length > 0) {
      return null;
    }
    return normalizeGitHubRepositoryRef(url.hostname, owner, name);
  } catch {
    return null;
  }
}

function normalizeGitHubRepositoryRef(
  host: string | undefined,
  owner: string | undefined,
  name: string | undefined,
): { host: string; owner: string; name: string } | null {
  const normalizedOwner = owner?.trim();
  const normalizedName = name?.trim().replace(/\.git$/u, "");
  if (!normalizedOwner || !normalizedName || normalizedName.includes("/")) {
    return null;
  }
  return {
    host: host?.trim() || "github.com",
    owner: normalizedOwner,
    name: normalizedName,
  };
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
