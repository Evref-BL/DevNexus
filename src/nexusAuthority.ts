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

export function expandNexusAuthorityRoles(
  roleIds: readonly string[],
  config?: NexusAuthorityConfig,
): NexusAuthorityAction[] {
  const roleDefinitions = authorityRoleMap(config);
  return uniqueValues(
    roleIds.flatMap((roleId) => roleDefinitions.get(roleId)?.actions ?? []),
  );
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
