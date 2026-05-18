import type {
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
