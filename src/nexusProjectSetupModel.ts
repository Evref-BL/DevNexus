import { defaultNexusHomePath } from "./nexusHomeConfig.js";

export type NexusProjectSetupMutationClass =
  | "local_file_write"
  | "local_git_operation"
  | "host_local_auth_check"
  | "provider_read"
  | "provider_mutation";

export type NexusProjectSetupOperationPhase =
  | "local_setup"
  | "readiness"
  | "next_phase";

export type NexusProjectSetupStatus =
  | "ready"
  | "blocked";

export type NexusProjectSetupDiagnosticSeverity =
  | "error"
  | "warning";

export type NexusProjectSetupSourceStrategyKind =
  | "reference_existing"
  | "clone_project_local"
  | "create_local";

export type NexusProjectSetupComponentRole =
  | "primary"
  | "extension"
  | "addon"
  | "dependency"
  | "optional"
  | "support";

export type NexusProjectSetupAgentProvider =
  | "codex"
  | "opencode"
  | "claude"
  | "custom";

export type NexusProjectSetupAuthProvider =
  | "github"
  | "gitlab"
  | "jira"
  | "generic_git"
  | "custom";

export type NexusProjectSetupAuthActorKind =
  | "human"
  | "machine_user"
  | "service_account"
  | "unknown";

export type NexusProjectSetupCredentialMethod =
  | {
      kind: "provider_cli";
      cli: "gh" | "glab" | "jira" | "custom";
      configDir?: string;
    }
  | {
      kind: "environment_variable";
      variable: string;
    }
  | {
      kind: "http_api_token_reference";
      reference: string;
    }
  | {
      kind: "token_store_reference";
      reference: string;
    }
  | {
      kind: "github_app_user_to_server";
      helperCommand: string;
      appSlug?: string;
      authorizationMode?: "device_flow" | "web_callback" | "manual";
    }
  | {
      kind: "manual";
      instructions?: string;
    };

export type NexusProjectSetupMetaHostingProvider =
  | "github"
  | "gitlab"
  | "generic_git";

export type NexusProjectSetupWorkTrackingProvider =
  | "local"
  | "github"
  | "gitlab"
  | "jira";

export type NexusProjectSetupPublicationPosture =
  | "local_only"
  | "green_main"
  | "review_handoff"
  | "direct_integration";

export interface NexusProjectSetupHomeAnswers {
  path: string;
  registerProject?: boolean;
}

export interface NexusProjectSetupProjectAnswers {
  id: string;
  name: string;
  root: string;
  initializeGit?: boolean;
  defaultBranch?: string;
}

export interface NexusProjectSetupComponentSourceStrategy {
  kind: NexusProjectSetupSourceStrategyKind;
  path?: string;
  remoteUrl?: string;
  defaultBranch?: string;
  initializeGit?: boolean;
}

export interface NexusProjectSetupComponentAnswers {
  id: string;
  name?: string;
  role: NexusProjectSetupComponentRole;
  source: NexusProjectSetupComponentSourceStrategy;
}

export interface NexusProjectSetupAgentTargetAnswers {
  provider: NexusProjectSetupAgentProvider;
  id?: string;
  configPath?: string;
}

export interface NexusProjectSetupLocalWorkTrackingAnswers {
  enabled: boolean;
  provider: "local";
  storePath?: string;
}

export interface NexusProjectSetupWorkTrackerAnswers {
  id: string;
  componentId?: string;
  provider: NexusProjectSetupWorkTrackingProvider;
  role?:
    | "primary"
    | "eligible_source"
    | "external_inbox"
    | "mirror"
    | "coordination"
    | "planning"
    | "external_feedback"
    | "migration"
    | "archive";
  authProfileId?: string;
  host?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryId?: string;
  projectKey?: string;
  issueType?: string;
}

export interface NexusProjectSetupAuthProfileAnswers {
  id: string;
  provider: NexusProjectSetupAuthProvider;
  actorKind: NexusProjectSetupAuthActorKind;
  account?: string;
  host?: string;
  credentialMethod: NexusProjectSetupCredentialMethod;
}

export type NexusProjectSetupAuthRequirement =
  | "required_now"
  | "optional_later"
  | "provider_mutation_only";

export type NexusProjectSetupAuthCapabilityStatus =
  | "available"
  | "missing"
  | "manual"
  | "unknown";

export interface NexusProjectSetupAuthReference {
  path: string;
  purpose: string;
  provider?: NexusProjectSetupAuthProvider | NexusProjectSetupWorkTrackingProvider;
  requirement: NexusProjectSetupAuthRequirement;
}

export interface NexusProjectSetupAuthCapabilityCheck {
  id: string;
  title: string;
  status: NexusProjectSetupAuthCapabilityStatus;
  summary: string;
  nextAction: string;
}

export interface NexusProjectSetupAuthInventoryEntry {
  id: string;
  provider: NexusProjectSetupAuthProvider;
  actorKind: NexusProjectSetupAuthProfileAnswers["actorKind"];
  account: string | null;
  host: string | null;
  credentialMethodKind: NexusProjectSetupCredentialMethod["kind"];
  credentialReference: string | null;
  highestRequirement: NexusProjectSetupAuthRequirement;
  references: NexusProjectSetupAuthReference[];
  capabilityChecks: NexusProjectSetupAuthCapabilityCheck[];
}

export interface NexusProjectSetupMissingAuthReference {
  profileId: string;
  references: NexusProjectSetupAuthReference[];
  nextAction: string;
}

export interface NexusProjectSetupAuthInventory {
  profiles: NexusProjectSetupAuthInventoryEntry[];
  missingProfiles: NexusProjectSetupMissingAuthReference[];
  requiredNowProfileIds: string[];
  providerMutationOnlyProfileIds: string[];
  optionalLaterProfileIds: string[];
  summary: string;
}

export interface NexusProjectSetupMetaHostingIntent {
  provider: NexusProjectSetupMetaHostingProvider;
  host?: string;
  namespace: string;
  repositoryName: string;
  defaultBranch?: string;
  humanAuthProfileId?: string;
  automationAuthProfileId?: string;
  providerMutationAuthProfileId?: string;
}

export type NexusProjectSetupHostingHandoffStatus =
  | "not_configured"
  | "planned"
  | "blocked_on_auth";

export interface NexusProjectSetupHostingHandoffCommand {
  id: "hosting-status" | "hosting-plan" | "hosting-apply";
  title: string;
  command: string;
  providerMutation: boolean;
  allowedDuringProjectSetup: boolean;
  authProfileId: string | null;
}

export interface NexusProjectSetupHostingHandoff {
  status: NexusProjectSetupHostingHandoffStatus;
  provider: NexusProjectSetupMetaHostingIntent["provider"] | null;
  host: string | null;
  namespace: string | null;
  repositoryName: string | null;
  defaultBranch: string | null;
  metaProjectOnly: true;
  componentRepositoryHosting: "not_configured_by_project_setup";
  summary: string;
  commands: NexusProjectSetupHostingHandoffCommand[];
  missingAuthProfileIds: string[];
  providerMutationsDeferred: true;
}

export interface NexusProjectSetupPublicationAnswers {
  posture: NexusProjectSetupPublicationPosture;
  remote?: string;
  targetBranch?: string;
  automationAuthProfileId?: string;
  humanAuthProfileId?: string;
}

export interface NexusProjectSetupReadinessCheckAnswers {
  id: string;
  title: string;
  provider?: NexusProjectSetupWorkTrackingProvider | NexusProjectSetupAuthProvider;
  requiresAuthProfileId?: string;
}

export interface NexusProjectSetupAnswers {
  version?: 1;
  home: NexusProjectSetupHomeAnswers;
  project: NexusProjectSetupProjectAnswers;
  components: NexusProjectSetupComponentAnswers[];
  agentTargets?: NexusProjectSetupAgentTargetAnswers[];
  localWorkTracking?: NexusProjectSetupLocalWorkTrackingAnswers;
  workTrackers?: NexusProjectSetupWorkTrackerAnswers[];
  authProfiles?: NexusProjectSetupAuthProfileAnswers[];
  hostingIntent?: NexusProjectSetupMetaHostingIntent;
  publication?: NexusProjectSetupPublicationAnswers;
  readinessChecks?: NexusProjectSetupReadinessCheckAnswers[];
}

export interface NexusProjectSetupOperation {
  id: string;
  title: string;
  mutationClass: NexusProjectSetupMutationClass;
  phase: NexusProjectSetupOperationPhase;
  allowedDuringLocalSetup: boolean;
  summary: string;
  authProfileId?: string;
}

export interface NexusProjectSetupDiagnostic {
  severity: NexusProjectSetupDiagnosticSeverity;
  path: string;
  message: string;
}

export interface NexusProjectSetupProposal {
  version: 1;
  status: NexusProjectSetupStatus;
  answers: NexusProjectSetupAnswers;
  operations: NexusProjectSetupOperation[];
  diagnostics: NexusProjectSetupDiagnostic[];
  nextPhaseActions: NexusProjectSetupOperation[];
  authInventory?: NexusProjectSetupAuthInventory;
  hostingHandoff?: NexusProjectSetupHostingHandoff;
}

export function buildNexusProjectSetupProposal(
  answers: NexusProjectSetupAnswers,
): NexusProjectSetupProposal {
  const normalizedAnswers = normalizeNexusProjectSetupAnswers(answers);
  const diagnostics = validateNexusProjectSetupAnswers(answers);
  const operations = buildNexusProjectSetupOperations(normalizedAnswers);

  return {
    version: 1,
    status: diagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? "blocked"
      : "ready",
    answers: normalizedAnswers,
    operations,
    diagnostics,
    nextPhaseActions: operations.filter((operation) => operation.phase === "next_phase"),
  };
}

export function validateNexusProjectSetupAnswers(
  answers: NexusProjectSetupAnswers,
): NexusProjectSetupDiagnostic[] {
  const diagnostics: NexusProjectSetupDiagnostic[] = [
    ...findNexusProjectSetupSecretDiagnostics(answers),
  ];

  validateProjectIdentity(answers.project, diagnostics);
  if (!validateComponentTopology(answers.components, diagnostics)) {
    return diagnostics;
  }

  const authProfileIds = validateAuthProfiles(answers.authProfiles ?? [], diagnostics);
  const componentIds = new Set(
    answers.components
      .map((component) => component.id)
      .filter(nonEmptyString),
  );
  validateWorkTrackers(answers.workTrackers ?? [], componentIds, authProfileIds, diagnostics);
  validateReferencedAuthProfiles(answers, authProfileIds, diagnostics);

  return diagnostics;
}

function validateProjectIdentity(
  project: NexusProjectSetupAnswers["project"] | undefined,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  if (!nonEmptyString(project?.id)) {
    diagnostics.push(errorDiagnostic("project.id", "Project id is required."));
  }
  if (!nonEmptyString(project?.name)) {
    diagnostics.push(errorDiagnostic("project.name", "Workspace name is required."));
  }
  if (!nonEmptyString(project?.root)) {
    diagnostics.push(errorDiagnostic("project.root", "Workspace root is required."));
  }
}

function validateComponentTopology(
  components: NexusProjectSetupAnswers["components"] | undefined,
  diagnostics: NexusProjectSetupDiagnostic[],
): components is NexusProjectSetupComponentAnswers[] {
  if (!Array.isArray(components) || components.length === 0) {
    diagnostics.push(errorDiagnostic("components", "At least one component is required."));
    return false;
  }

  const seenComponentIds = new Set<string>();
  let primaryCount = 0;
  for (const [index, component] of components.entries()) {
    validateComponentIdentity(component, index, seenComponentIds, diagnostics);
    if (component.role === "primary") {
      primaryCount += 1;
    }
    validateComponentSource(component, index, diagnostics);
  }

  if (primaryCount !== 1) {
    diagnostics.push(errorDiagnostic(
      "components",
      `Exactly one primary component is required; found ${primaryCount}.`,
    ));
  }

  return true;
}

function validateComponentIdentity(
  component: NexusProjectSetupComponentAnswers,
  index: number,
  seenComponentIds: Set<string>,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  const pathPrefix = `components[${index}]`;
  if (!nonEmptyString(component.id)) {
    diagnostics.push(errorDiagnostic(`${pathPrefix}.id`, "Component id is required."));
  } else if (seenComponentIds.has(component.id)) {
    diagnostics.push(errorDiagnostic(`${pathPrefix}.id`, `Duplicate component id: ${component.id}.`));
  } else {
    seenComponentIds.add(component.id);
  }
}

function validateComponentSource(
  component: NexusProjectSetupComponentAnswers,
  index: number,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  const pathPrefix = `components[${index}]`;
  if (!component.source) {
    diagnostics.push(errorDiagnostic(`${pathPrefix}.source`, "Component source strategy is required."));
    return;
  }

  switch (component.source.kind) {
    case "reference_existing":
      validateRequiredString(
        component.source.path,
        `${pathPrefix}.source.path`,
        "Existing component references require a source path.",
        diagnostics,
      );
      return;
    case "clone_project_local":
      validateRequiredString(
        component.source.remoteUrl,
        `${pathPrefix}.source.remoteUrl`,
        "Workspace-local component clones require a remote URL.",
        diagnostics,
      );
      return;
    case "create_local":
      validateRequiredString(
        component.source.path,
        `${pathPrefix}.source.path`,
        "New local components require a target path.",
        diagnostics,
      );
      return;
    default:
      diagnostics.push(errorDiagnostic(
        `${pathPrefix}.source.kind`,
        `Unsupported component source strategy: ${String(component.source.kind)}.`,
      ));
  }
}

function validateAuthProfiles(
  profiles: NexusProjectSetupAuthProfileAnswers[],
  diagnostics: NexusProjectSetupDiagnostic[],
): Set<string> {
  const authProfileIds = new Set<string>();
  for (const [index, profile] of profiles.entries()) {
    validateAuthProfile(profile, index, authProfileIds, diagnostics);
  }
  return authProfileIds;
}

function validateAuthProfile(
  profile: NexusProjectSetupAuthProfileAnswers,
  index: number,
  authProfileIds: Set<string>,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  if (!nonEmptyString(profile.id)) {
    diagnostics.push(errorDiagnostic(`authProfiles[${index}].id`, "Auth profile id is required."));
  } else if (authProfileIds.has(profile.id)) {
    diagnostics.push(errorDiagnostic(
      `authProfiles[${index}].id`,
      `Duplicate auth profile id: ${profile.id}.`,
    ));
  } else {
    authProfileIds.add(profile.id);
  }
  if (!profile.credentialMethod) {
    diagnostics.push(errorDiagnostic(
      `authProfiles[${index}].credentialMethod`,
      "Auth profiles require a host-local credential method reference.",
    ));
  }
}

function validateWorkTrackers(
  trackers: NexusProjectSetupWorkTrackerAnswers[],
  componentIds: Set<string>,
  authProfileIds: Set<string>,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  const workTrackerIds = new Set<string>();
  for (const [index, tracker] of trackers.entries()) {
    validateWorkTrackerIdentity(tracker, index, workTrackerIds, diagnostics);
    validateWorkTrackerReferences(tracker, index, componentIds, authProfileIds, diagnostics);
    validateWorkTrackerProviderFields(tracker, index, diagnostics);
  }
}

function validateWorkTrackerIdentity(
  tracker: NexusProjectSetupWorkTrackerAnswers,
  index: number,
  workTrackerIds: Set<string>,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  const pathPrefix = `workTrackers[${index}]`;
  if (!nonEmptyString(tracker.id)) {
    diagnostics.push(errorDiagnostic(`${pathPrefix}.id`, "Work tracker id is required."));
  } else if (workTrackerIds.has(tracker.id)) {
    diagnostics.push(errorDiagnostic(`${pathPrefix}.id`, `Duplicate work tracker id: ${tracker.id}.`));
  } else {
    workTrackerIds.add(tracker.id);
  }
}

function validateWorkTrackerReferences(
  tracker: NexusProjectSetupWorkTrackerAnswers,
  index: number,
  componentIds: Set<string>,
  authProfileIds: Set<string>,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  const pathPrefix = `workTrackers[${index}]`;
  if (tracker.componentId && !componentIds.has(tracker.componentId)) {
    diagnostics.push(errorDiagnostic(
      `${pathPrefix}.componentId`,
      `Work tracker references unknown component: ${tracker.componentId}.`,
    ));
  }
  if (tracker.authProfileId && !authProfileIds.has(tracker.authProfileId)) {
    diagnostics.push(errorDiagnostic(
      `${pathPrefix}.authProfileId`,
      `Work tracker references unknown auth profile: ${tracker.authProfileId}.`,
    ));
  }
}

function validateWorkTrackerProviderFields(
  tracker: NexusProjectSetupWorkTrackerAnswers,
  index: number,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  const pathPrefix = `workTrackers[${index}]`;
  switch (tracker.provider) {
    case "local":
      return;
    case "github":
      validateGitHubTrackerFields(tracker, pathPrefix, diagnostics);
      return;
    case "gitlab":
      validateGitLabTrackerFields(tracker, pathPrefix, diagnostics);
      return;
    case "jira":
      validateRequiredString(
        tracker.projectKey,
        `${pathPrefix}.projectKey`,
        "Jira trackers require projectKey.",
        diagnostics,
      );
      return;
    default:
      diagnostics.push(errorDiagnostic(
        `${pathPrefix}.provider`,
        `Unsupported work tracker provider: ${String(tracker.provider)}.`,
      ));
  }
}

function validateGitHubTrackerFields(
  tracker: NexusProjectSetupWorkTrackerAnswers,
  pathPrefix: string,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  validateRequiredString(
    tracker.repositoryOwner,
    `${pathPrefix}.repositoryOwner`,
    "GitHub trackers require repositoryOwner.",
    diagnostics,
  );
  validateRequiredString(
    tracker.repositoryName,
    `${pathPrefix}.repositoryName`,
    "GitHub trackers require repositoryName.",
    diagnostics,
  );
}

function validateGitLabTrackerFields(
  tracker: NexusProjectSetupWorkTrackerAnswers,
  pathPrefix: string,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  if (
    !nonEmptyString(tracker.repositoryId) &&
    !(nonEmptyString(tracker.repositoryOwner) && nonEmptyString(tracker.repositoryName))
  ) {
    diagnostics.push(errorDiagnostic(
      `${pathPrefix}.repositoryId`,
      "GitLab trackers require repositoryId or repositoryOwner plus repositoryName.",
    ));
  }
}

function validateReferencedAuthProfiles(
  answers: NexusProjectSetupAnswers,
  authProfileIds: Set<string>,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  for (const [pathName, profileId] of [
    ["hostingIntent.humanAuthProfileId", answers.hostingIntent?.humanAuthProfileId],
    ["hostingIntent.automationAuthProfileId", answers.hostingIntent?.automationAuthProfileId],
    ["hostingIntent.providerMutationAuthProfileId", answers.hostingIntent?.providerMutationAuthProfileId],
    ["publication.automationAuthProfileId", answers.publication?.automationAuthProfileId],
    ["publication.humanAuthProfileId", answers.publication?.humanAuthProfileId],
  ] as const) {
    if (profileId && !authProfileIds.has(profileId)) {
      diagnostics.push(errorDiagnostic(
        pathName,
        `Referenced auth profile is not defined: ${profileId}.`,
      ));
    }
  }
}

function validateRequiredString(
  value: unknown,
  pathName: string,
  message: string,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  if (!nonEmptyString(value)) {
    diagnostics.push(errorDiagnostic(pathName, message));
  }
}

export function renderNexusProjectSetupProposalSummary(
  proposal: NexusProjectSetupProposal,
): string {
  const componentSummary = proposal.answers.components
    .map((component) => `${component.id}:${component.role}:${component.source.kind}`)
    .join(", ");
  const localOperations = proposal.operations.filter(
    (operation) => operation.phase === "local_setup",
  );
  const nextPhaseOperations = proposal.nextPhaseActions;
  const lines = [
    `Project setup proposal: ${proposal.answers.project.name} (${proposal.answers.project.id})`,
    `Root: ${proposal.answers.project.root}`,
    `Components: ${componentSummary || "none"}`,
    `Local setup operations: ${localOperations.length}`,
    `Next-phase handoffs: ${nextPhaseOperations.length}`,
  ];

  for (const operation of localOperations) {
    lines.push(`- [${operation.mutationClass}] ${operation.title}`);
  }
  for (const operation of nextPhaseOperations) {
    lines.push(`- [next:${operation.mutationClass}] ${operation.title}`);
  }
  if (proposal.diagnostics.length > 0) {
    lines.push(`Diagnostics: ${proposal.diagnostics.length}`);
    for (const diagnostic of proposal.diagnostics) {
      lines.push(`- [${diagnostic.severity}] ${diagnostic.path}: ${diagnostic.message}`);
    }
  }

  return lines.join("\n");
}

export function buildNexusProjectSetupOperations(
  answers: NexusProjectSetupAnswers,
): NexusProjectSetupOperation[] {
  return [
    ...baseWorkspaceSetupOperations(),
    ...projectRegistrationOperations(answers.home),
    ...workspaceGitOperations(answers.project),
    ...localWorkTrackingOperations(answers.localWorkTracking),
    ...componentSourceOperations(answers.components),
    ...agentTargetOperations(answers.agentTargets ?? []),
    ...authProfileOperations(answers.authProfiles ?? []),
    ...hostingIntentOperations(answers.hostingIntent),
    ...readinessCheckOperations(answers.readinessChecks ?? []),
  ];
}

function baseWorkspaceSetupOperations(): NexusProjectSetupOperation[] {
  return [
    {
      id: "write-project-config",
      title: "Write DevNexus workspace configuration",
      mutationClass: "local_file_write",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: "Create or update dev-nexus.project.json with project identity, components, trackers, hosting intent, and publication posture.",
    },
    {
      id: "write-project-support",
      title: "Write workspace support scaffold",
      mutationClass: "local_file_write",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: "Create DevNexus support directories, AGENTS.md, skills, and MCP projection files for selected agent targets.",
    },
  ];
}

function projectRegistrationOperations(
  home: NexusProjectSetupHomeAnswers,
): NexusProjectSetupOperation[] {
  if (home.registerProject === false) {
    return [];
  }

  return [
    {
      id: "register-project-home",
      title: "Register workspace in DevNexus home",
      mutationClass: "local_file_write",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: "Record the workspace in the selected host-local DevNexus home registry.",
    },
  ];
}

function workspaceGitOperations(
  project: NexusProjectSetupProjectAnswers,
): NexusProjectSetupOperation[] {
  if (!project.initializeGit) {
    return [];
  }

  return [
    {
      id: "initialize-workspace-git",
      title: "Initialize local workspace Git repository",
      mutationClass: "local_git_operation",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: "Initialize the local workspace repository without creating or pushing any remote repository.",
    },
  ];
}

function localWorkTrackingOperations(
  localWorkTracking: NexusProjectSetupLocalWorkTrackingAnswers | undefined,
): NexusProjectSetupOperation[] {
  if (localWorkTracking?.enabled === false) {
    return [];
  }

  return [
    {
      id: "write-local-tracker-store",
      title: "Write local work-item tracker store",
      mutationClass: "local_file_write",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: `Create or preserve the local tracker store at ${localWorkTracking?.storePath ?? ".dev-nexus/work-items"}.`,
    },
  ];
}

function componentSourceOperations(
  components: NexusProjectSetupComponentAnswers[],
): NexusProjectSetupOperation[] {
  return components.flatMap(componentSourceOperation);
}

function componentSourceOperation(
  component: NexusProjectSetupComponentAnswers,
): NexusProjectSetupOperation[] {
  if (component.source.kind === "clone_project_local") {
    return [cloneComponentOperation(component)];
  }
  if (component.source.kind === "create_local") {
    return createLocalComponentOperations(component);
  }
  return [];
}

function cloneComponentOperation(
  component: NexusProjectSetupComponentAnswers,
): NexusProjectSetupOperation {
  return {
    id: `clone-component-${operationIdPart(component.id)}`,
    title: `Clone component ${component.id}`,
    mutationClass: "local_git_operation",
    phase: "local_setup",
    allowedDuringLocalSetup: true,
    summary: `Clone ${component.source.remoteUrl ?? "the configured remote"} into the workspace-local component source area.`,
  };
}

function createLocalComponentOperations(
  component: NexusProjectSetupComponentAnswers,
): NexusProjectSetupOperation[] {
  const operations: NexusProjectSetupOperation[] = [
    {
      id: `create-component-${operationIdPart(component.id)}`,
      title: `Create local component ${component.id}`,
      mutationClass: "local_file_write",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: `Create the local component source directory at ${component.source.path ?? `components/${component.id}`}.`,
    },
  ];
  if (component.source.initializeGit) {
    operations.push({
      id: `initialize-component-git-${operationIdPart(component.id)}`,
      title: `Initialize Git for component ${component.id}`,
      mutationClass: "local_git_operation",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: "Initialize only the local component repository; provider hosting remains a later explicit phase.",
    });
  }
  return operations;
}

function agentTargetOperations(
  targets: NexusProjectSetupAgentTargetAnswers[],
): NexusProjectSetupOperation[] {
  return targets.map((target) => ({
    id: `project-agent-target-${operationIdPart(target.id ?? target.provider)}`,
    title: `Workspace ${target.provider} agent support`,
    mutationClass: "local_file_write",
    phase: "local_setup",
    allowedDuringLocalSetup: true,
    summary: `Write configured local support for ${target.provider}${target.configPath ? ` at ${target.configPath}` : ""}.`,
  }));
}

function authProfileOperations(
  profiles: NexusProjectSetupAuthProfileAnswers[],
): NexusProjectSetupOperation[] {
  return profiles.map((profile) => ({
    id: `check-auth-profile-${operationIdPart(profile.id)}`,
    title: `Check auth profile ${profile.id}`,
    mutationClass: "host_local_auth_check",
    phase: "readiness",
    allowedDuringLocalSetup: true,
    authProfileId: profile.id,
    summary: `Check host-local ${profile.provider} credentials for the ${profile.actorKind} actor without reading or writing shared secrets.`,
  }));
}

function hostingIntentOperations(
  hostingIntent: NexusProjectSetupMetaHostingIntent | undefined,
): NexusProjectSetupOperation[] {
  if (!hostingIntent) {
    return [];
  }

  return [
    {
      id: "read-hosting-status",
      title: "Read workspace repository hosting status",
      mutationClass: "provider_read",
      phase: "readiness",
      allowedDuringLocalSetup: true,
      authProfileId: hostingIntent.humanAuthProfileId ?? hostingIntent.automationAuthProfileId,
      summary: `Read ${hostingIntent.provider} metadata for ${hostingIntent.namespace}/${hostingIntent.repositoryName} when credentials are available.`,
    },
    {
      id: "apply-hosting-intent",
      title: "Apply workspace repository hosting intent",
      mutationClass: "provider_mutation",
      phase: "next_phase",
      allowedDuringLocalSetup: false,
      authProfileId: hostingIntent.providerMutationAuthProfileId,
      summary: "Create repositories, push remotes, repair collaborators, or accept invitations only through explicit hosting plan/apply commands.",
    },
  ];
}

function readinessCheckOperations(
  checks: NexusProjectSetupReadinessCheckAnswers[],
): NexusProjectSetupOperation[] {
  return checks
    .filter((check) => check.provider && check.provider !== "local")
    .map((check) => ({
      id: `readiness-provider-report-${operationIdPart(check.id)}`,
      title: check.title,
      mutationClass: "provider_read",
      phase: "readiness",
      allowedDuringLocalSetup: true,
      authProfileId: check.requiresAuthProfileId,
      summary: "Read provider-backed readiness information only when credentials are configured.",
    }));
}

export function findNexusProjectSetupSecretDiagnostics(
  value: unknown,
): NexusProjectSetupDiagnostic[] {
  const diagnostics: NexusProjectSetupDiagnostic[] = [];
  visitForSecrets(value, "$", diagnostics);
  return diagnostics;
}

function normalizeNexusProjectSetupAnswers(
  answers: NexusProjectSetupAnswers,
): NexusProjectSetupAnswers {
  return {
    version: 1,
    home: normalizeHomeAnswers(answers.home),
    project: normalizeProjectAnswers(answers.project),
    components: normalizeComponentAnswers(answers.components ?? []),
    ...normalizeOptionalAnswerSections(answers),
  };
}

function normalizeHomeAnswers(
  home: NexusProjectSetupAnswers["home"] | undefined,
): NexusProjectSetupHomeAnswers {
  return {
    path: home?.path ?? defaultNexusHomePath(),
    ...(home?.registerProject !== undefined ? { registerProject: home.registerProject } : {}),
  };
}

function normalizeProjectAnswers(
  project: NexusProjectSetupAnswers["project"] | undefined,
): NexusProjectSetupProjectAnswers {
  return {
    id: project?.id ?? "",
    name: project?.name ?? "",
    root: project?.root ?? "",
    ...(project?.initializeGit !== undefined ? { initializeGit: project.initializeGit } : {}),
    ...(project?.defaultBranch ? { defaultBranch: project.defaultBranch } : {}),
  };
}

function normalizeComponentAnswers(
  components: NexusProjectSetupComponentAnswers[],
): NexusProjectSetupComponentAnswers[] {
  return components.map(normalizeComponentAnswer);
}

function normalizeComponentAnswer(
  component: NexusProjectSetupComponentAnswers,
): NexusProjectSetupComponentAnswers {
  const source = component.source ?? { kind: "reference_existing" as const };
  return {
    id: component.id,
    ...(component.name ? { name: component.name } : {}),
    role: component.role,
    source: {
      kind: source.kind,
      ...(source.path ? { path: source.path } : {}),
      ...(source.remoteUrl ? { remoteUrl: source.remoteUrl } : {}),
      ...(source.defaultBranch ? { defaultBranch: source.defaultBranch } : {}),
      ...(source.initializeGit !== undefined ? { initializeGit: source.initializeGit } : {}),
    },
  };
}

function normalizeOptionalAnswerSections(
  answers: NexusProjectSetupAnswers,
): Partial<NexusProjectSetupAnswers> {
  return {
    ...optionalSection("agentTargets", answers.agentTargets?.map(normalizeAgentTargetAnswer)),
    ...optionalSection("localWorkTracking", normalizeLocalWorkTrackingAnswers(answers.localWorkTracking)),
    ...optionalSection("workTrackers", answers.workTrackers?.map(normalizeWorkTrackerAnswer)),
    ...optionalSection("authProfiles", answers.authProfiles?.map(normalizeAuthProfileAnswer)),
    ...optionalSection("hostingIntent", normalizeHostingIntentAnswers(answers.hostingIntent)),
    ...optionalSection("publication", normalizePublicationAnswers(answers.publication)),
    ...optionalSection("readinessChecks", answers.readinessChecks?.map(normalizeReadinessCheckAnswer)),
  };
}

function normalizeAgentTargetAnswer(
  target: NexusProjectSetupAgentTargetAnswers,
): NexusProjectSetupAgentTargetAnswers {
  return {
    provider: target.provider,
    ...(target.id ? { id: target.id } : {}),
    ...(target.configPath ? { configPath: target.configPath } : {}),
  };
}

function normalizeLocalWorkTrackingAnswers(
  localWorkTracking: NexusProjectSetupLocalWorkTrackingAnswers | undefined,
): NexusProjectSetupLocalWorkTrackingAnswers | undefined {
  if (!localWorkTracking) {
    return undefined;
  }
  return {
    enabled: localWorkTracking.enabled,
    provider: "local",
    ...(localWorkTracking.storePath ? { storePath: localWorkTracking.storePath } : {}),
  };
}

function normalizeWorkTrackerAnswer(
  tracker: NexusProjectSetupWorkTrackerAnswers,
): NexusProjectSetupWorkTrackerAnswers {
  return {
    id: tracker.id,
    ...(tracker.componentId ? { componentId: tracker.componentId } : {}),
    provider: tracker.provider,
    ...(tracker.role ? { role: tracker.role } : {}),
    ...(tracker.authProfileId ? { authProfileId: tracker.authProfileId } : {}),
    ...(tracker.host ? { host: tracker.host } : {}),
    ...(tracker.repositoryOwner ? { repositoryOwner: tracker.repositoryOwner } : {}),
    ...(tracker.repositoryName ? { repositoryName: tracker.repositoryName } : {}),
    ...(tracker.repositoryId ? { repositoryId: tracker.repositoryId } : {}),
    ...(tracker.projectKey ? { projectKey: tracker.projectKey } : {}),
    ...(tracker.issueType ? { issueType: tracker.issueType } : {}),
  };
}

function normalizeAuthProfileAnswer(
  profile: NexusProjectSetupAuthProfileAnswers,
): NexusProjectSetupAuthProfileAnswers {
  return {
    id: profile.id,
    provider: profile.provider,
    actorKind: profile.actorKind,
    ...(profile.account ? { account: profile.account } : {}),
    ...(profile.host ? { host: profile.host } : {}),
    credentialMethod: normalizeCredentialMethod(profile.credentialMethod),
  };
}

function normalizeHostingIntentAnswers(
  hostingIntent: NexusProjectSetupMetaHostingIntent | undefined,
): NexusProjectSetupMetaHostingIntent | undefined {
  if (!hostingIntent) {
    return undefined;
  }
  return {
    provider: hostingIntent.provider,
    ...(hostingIntent.host ? { host: hostingIntent.host } : {}),
    namespace: hostingIntent.namespace,
    repositoryName: hostingIntent.repositoryName,
    ...(hostingIntent.defaultBranch ? { defaultBranch: hostingIntent.defaultBranch } : {}),
    ...(hostingIntent.humanAuthProfileId ? { humanAuthProfileId: hostingIntent.humanAuthProfileId } : {}),
    ...(hostingIntent.automationAuthProfileId
      ? { automationAuthProfileId: hostingIntent.automationAuthProfileId }
      : {}),
    ...(hostingIntent.providerMutationAuthProfileId
      ? { providerMutationAuthProfileId: hostingIntent.providerMutationAuthProfileId }
      : {}),
  };
}

function normalizePublicationAnswers(
  publication: NexusProjectSetupPublicationAnswers | undefined,
): NexusProjectSetupPublicationAnswers | undefined {
  if (!publication) {
    return undefined;
  }
  return {
    posture: publication.posture,
    ...(publication.remote ? { remote: publication.remote } : {}),
    ...(publication.targetBranch ? { targetBranch: publication.targetBranch } : {}),
    ...(publication.automationAuthProfileId
      ? { automationAuthProfileId: publication.automationAuthProfileId }
      : {}),
    ...(publication.humanAuthProfileId ? { humanAuthProfileId: publication.humanAuthProfileId } : {}),
  };
}

function normalizeReadinessCheckAnswer(
  check: NexusProjectSetupReadinessCheckAnswers,
): NexusProjectSetupReadinessCheckAnswers {
  return {
    id: check.id,
    title: check.title,
    ...(check.provider ? { provider: check.provider } : {}),
    ...(check.requiresAuthProfileId ? { requiresAuthProfileId: check.requiresAuthProfileId } : {}),
  };
}

function optionalSection<K extends keyof NexusProjectSetupAnswers>(
  key: K,
  value: NexusProjectSetupAnswers[K] | undefined,
): Partial<Pick<NexusProjectSetupAnswers, K>> {
  return value === undefined ? {} : { [key]: value } as Pick<NexusProjectSetupAnswers, K>;
}

function normalizeCredentialMethod(
  method: NexusProjectSetupCredentialMethod | undefined,
): NexusProjectSetupCredentialMethod {
  if (!method) {
    return {
      kind: "manual",
    };
  }

  switch (method.kind) {
    case "provider_cli":
      return {
        kind: "provider_cli",
        cli: method.cli,
        ...(method.configDir ? { configDir: method.configDir } : {}),
      };
    case "environment_variable":
      return {
        kind: "environment_variable",
        variable: method.variable,
      };
    case "http_api_token_reference":
      return {
        kind: "http_api_token_reference",
        reference: method.reference,
      };
    case "token_store_reference":
      return {
        kind: "token_store_reference",
        reference: method.reference,
      };
    case "github_app_user_to_server":
      return {
        kind: "github_app_user_to_server",
        helperCommand: method.helperCommand,
        ...(method.appSlug ? { appSlug: method.appSlug } : {}),
        ...(method.authorizationMode
          ? { authorizationMode: method.authorizationMode }
          : {}),
      };
    case "manual":
      return {
        kind: "manual",
        ...(method.instructions ? { instructions: method.instructions } : {}),
      };
  }
}

function visitForSecrets(
  value: unknown,
  currentPath: string,
  diagnostics: NexusProjectSetupDiagnostic[],
) {
  if (typeof value === "string") {
    if (rawSecretValuePattern.test(value)) {
      diagnostics.push(errorDiagnostic(
        currentPath,
        "Setup answers must reference host-local credentials instead of storing raw tokens, passwords, or private keys.",
      ));
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitForSecrets(entry, `${currentPath}[${index}]`, diagnostics));
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${currentPath}.${key}`;
    if (rawSecretKeyPattern.test(key)) {
      diagnostics.push(errorDiagnostic(
        entryPath,
        "Setup answers must not contain raw secret fields; use auth profile ids or host-local credential references.",
      ));
      continue;
    }
    visitForSecrets(entry, entryPath, diagnostics);
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function errorDiagnostic(pathName: string, message: string): NexusProjectSetupDiagnostic {
  return {
    severity: "error",
    path: pathName,
    message,
  };
}

function operationIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "") || "unknown";
}

const rawSecretKeyPattern =
  /^(?:password|passphrase|secret|token|accessToken|apiToken|privateKey|private_key)$/iu;

const rawSecretValuePattern =
  /(?:ghp_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|password=|token=|secret=)/iu;
