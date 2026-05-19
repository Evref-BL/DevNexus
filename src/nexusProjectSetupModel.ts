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
  provider: NexusProjectSetupWorkTrackingProvider;
  role?: "primary" | "eligible_source" | "external_inbox" | "coordination";
  repositoryOwner?: string;
  repositoryName?: string;
  projectKey?: string;
}

export interface NexusProjectSetupAuthProfileAnswers {
  id: string;
  provider: NexusProjectSetupAuthProvider;
  actorKind: NexusProjectSetupAuthActorKind;
  account?: string;
  host?: string;
  credentialMethod: NexusProjectSetupCredentialMethod;
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

  if (!nonEmptyString(answers.home?.path)) {
    diagnostics.push(errorDiagnostic("home.path", "DevNexus home path is required."));
  }
  if (!nonEmptyString(answers.project?.id)) {
    diagnostics.push(errorDiagnostic("project.id", "Project id is required."));
  }
  if (!nonEmptyString(answers.project?.name)) {
    diagnostics.push(errorDiagnostic("project.name", "Project name is required."));
  }
  if (!nonEmptyString(answers.project?.root)) {
    diagnostics.push(errorDiagnostic("project.root", "Project root is required."));
  }

  if (!Array.isArray(answers.components) || answers.components.length === 0) {
    diagnostics.push(errorDiagnostic("components", "At least one component is required."));
    return diagnostics;
  }

  const seenComponentIds = new Set<string>();
  let primaryCount = 0;
  for (const [index, component] of answers.components.entries()) {
    const pathPrefix = `components[${index}]`;
    if (!nonEmptyString(component.id)) {
      diagnostics.push(errorDiagnostic(`${pathPrefix}.id`, "Component id is required."));
    } else if (seenComponentIds.has(component.id)) {
      diagnostics.push(errorDiagnostic(`${pathPrefix}.id`, `Duplicate component id: ${component.id}.`));
    } else {
      seenComponentIds.add(component.id);
    }

    if (component.role === "primary") {
      primaryCount += 1;
    }

    if (!component.source) {
      diagnostics.push(errorDiagnostic(`${pathPrefix}.source`, "Component source strategy is required."));
      continue;
    }

    switch (component.source.kind) {
      case "reference_existing":
        if (!nonEmptyString(component.source.path)) {
          diagnostics.push(errorDiagnostic(
            `${pathPrefix}.source.path`,
            "Existing component references require a source path.",
          ));
        }
        break;
      case "clone_project_local":
        if (!nonEmptyString(component.source.remoteUrl)) {
          diagnostics.push(errorDiagnostic(
            `${pathPrefix}.source.remoteUrl`,
            "Project-local component clones require a remote URL.",
          ));
        }
        break;
      case "create_local":
        if (!nonEmptyString(component.source.path)) {
          diagnostics.push(errorDiagnostic(
            `${pathPrefix}.source.path`,
            "New local components require a target path.",
          ));
        }
        break;
      default:
        diagnostics.push(errorDiagnostic(
          `${pathPrefix}.source.kind`,
          `Unsupported component source strategy: ${String(component.source.kind)}.`,
        ));
        break;
    }
  }

  if (primaryCount !== 1) {
    diagnostics.push(errorDiagnostic(
      "components",
      `Exactly one primary component is required; found ${primaryCount}.`,
    ));
  }

  for (const [index, profile] of (answers.authProfiles ?? []).entries()) {
    if (!nonEmptyString(profile.id)) {
      diagnostics.push(errorDiagnostic(`authProfiles[${index}].id`, "Auth profile id is required."));
    }
    if (!profile.credentialMethod) {
      diagnostics.push(errorDiagnostic(
        `authProfiles[${index}].credentialMethod`,
        "Auth profiles require a host-local credential method reference.",
      ));
    }
  }

  return diagnostics;
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
  const operations: NexusProjectSetupOperation[] = [
    {
      id: "write-project-config",
      title: "Write DevNexus project configuration",
      mutationClass: "local_file_write",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: "Create or update dev-nexus.project.json with project identity, components, trackers, hosting intent, and publication posture.",
    },
    {
      id: "write-project-support",
      title: "Write project support scaffold",
      mutationClass: "local_file_write",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: "Create DevNexus support directories, AGENTS.md, skills, and MCP projection files for selected agent targets.",
    },
  ];

  if (answers.home.registerProject !== false) {
    operations.push({
      id: "register-project-home",
      title: "Register project in DevNexus home",
      mutationClass: "local_file_write",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: "Record the project in the selected host-local DevNexus home registry.",
    });
  }

  if (answers.project.initializeGit) {
    operations.push({
      id: "initialize-meta-git",
      title: "Initialize local meta-project Git repository",
      mutationClass: "local_git_operation",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: "Initialize the local meta-project repository without creating or pushing any remote repository.",
    });
  }

  if (answers.localWorkTracking?.enabled !== false) {
    operations.push({
      id: "write-local-tracker-store",
      title: "Write local work-item tracker store",
      mutationClass: "local_file_write",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: `Create or preserve the local tracker store at ${answers.localWorkTracking?.storePath ?? ".dev-nexus/work-items"}.`,
    });
  }

  for (const component of answers.components) {
    if (component.source.kind === "clone_project_local") {
      operations.push({
        id: `clone-component-${operationIdPart(component.id)}`,
        title: `Clone component ${component.id}`,
        mutationClass: "local_git_operation",
        phase: "local_setup",
        allowedDuringLocalSetup: true,
        summary: `Clone ${component.source.remoteUrl ?? "the configured remote"} into the project-local component source area.`,
      });
    }
    if (component.source.kind === "create_local") {
      operations.push({
        id: `create-component-${operationIdPart(component.id)}`,
        title: `Create local component ${component.id}`,
        mutationClass: "local_file_write",
        phase: "local_setup",
        allowedDuringLocalSetup: true,
        summary: `Create the local component source directory at ${component.source.path ?? `components/${component.id}`}.`,
      });
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
    }
  }

  for (const target of answers.agentTargets ?? []) {
    operations.push({
      id: `project-agent-target-${operationIdPart(target.id ?? target.provider)}`,
      title: `Project ${target.provider} agent support`,
      mutationClass: "local_file_write",
      phase: "local_setup",
      allowedDuringLocalSetup: true,
      summary: `Write configured local support for ${target.provider}${target.configPath ? ` at ${target.configPath}` : ""}.`,
    });
  }

  for (const profile of answers.authProfiles ?? []) {
    operations.push({
      id: `check-auth-profile-${operationIdPart(profile.id)}`,
      title: `Check auth profile ${profile.id}`,
      mutationClass: "host_local_auth_check",
      phase: "readiness",
      allowedDuringLocalSetup: true,
      authProfileId: profile.id,
      summary: `Check host-local ${profile.provider} credentials for the ${profile.actorKind} actor without reading or writing shared secrets.`,
    });
  }

  if (answers.hostingIntent) {
    operations.push({
      id: "read-hosting-status",
      title: "Read meta-repo hosting status",
      mutationClass: "provider_read",
      phase: "readiness",
      allowedDuringLocalSetup: true,
      authProfileId: answers.hostingIntent.humanAuthProfileId ?? answers.hostingIntent.automationAuthProfileId,
      summary: `Read ${answers.hostingIntent.provider} metadata for ${answers.hostingIntent.namespace}/${answers.hostingIntent.repositoryName} when credentials are available.`,
    });
    operations.push({
      id: "apply-hosting-intent",
      title: "Apply meta-repo hosting intent",
      mutationClass: "provider_mutation",
      phase: "next_phase",
      allowedDuringLocalSetup: false,
      authProfileId: answers.hostingIntent.providerMutationAuthProfileId,
      summary: "Create repositories, push remotes, repair collaborators, or accept invitations only through explicit hosting plan/apply commands.",
    });
  }

  for (const check of answers.readinessChecks ?? []) {
    if (check.provider && check.provider !== "local") {
      operations.push({
        id: `readiness-provider-report-${operationIdPart(check.id)}`,
        title: check.title,
        mutationClass: "provider_read",
        phase: "readiness",
        allowedDuringLocalSetup: true,
        authProfileId: check.requiresAuthProfileId,
        summary: "Read provider-backed readiness information only when credentials are configured.",
      });
    }
  }

  return operations;
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
    home: {
      path: answers.home?.path ?? "",
      ...(answers.home?.registerProject !== undefined
        ? { registerProject: answers.home.registerProject }
        : {}),
    },
    project: {
      id: answers.project?.id ?? "",
      name: answers.project?.name ?? "",
      root: answers.project?.root ?? "",
      ...(answers.project?.initializeGit !== undefined
        ? { initializeGit: answers.project.initializeGit }
        : {}),
      ...(answers.project?.defaultBranch ? { defaultBranch: answers.project.defaultBranch } : {}),
    },
    components: (answers.components ?? []).map((component) => {
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
          ...(source.initializeGit !== undefined
            ? { initializeGit: source.initializeGit }
            : {}),
        },
      };
    }),
    ...(answers.agentTargets
      ? {
          agentTargets: answers.agentTargets.map((target) => ({
            provider: target.provider,
            ...(target.id ? { id: target.id } : {}),
            ...(target.configPath ? { configPath: target.configPath } : {}),
          })),
        }
      : {}),
    ...(answers.localWorkTracking
      ? {
          localWorkTracking: {
            enabled: answers.localWorkTracking.enabled,
            provider: "local",
            ...(answers.localWorkTracking.storePath
              ? { storePath: answers.localWorkTracking.storePath }
              : {}),
          },
        }
      : {}),
    ...(answers.workTrackers
      ? {
          workTrackers: answers.workTrackers.map((tracker) => ({
            id: tracker.id,
            provider: tracker.provider,
            ...(tracker.role ? { role: tracker.role } : {}),
            ...(tracker.repositoryOwner ? { repositoryOwner: tracker.repositoryOwner } : {}),
            ...(tracker.repositoryName ? { repositoryName: tracker.repositoryName } : {}),
            ...(tracker.projectKey ? { projectKey: tracker.projectKey } : {}),
          })),
        }
      : {}),
    ...(answers.authProfiles
      ? {
          authProfiles: answers.authProfiles.map((profile) => ({
            id: profile.id,
            provider: profile.provider,
            actorKind: profile.actorKind,
            ...(profile.account ? { account: profile.account } : {}),
            ...(profile.host ? { host: profile.host } : {}),
            credentialMethod: normalizeCredentialMethod(profile.credentialMethod),
          })),
        }
      : {}),
    ...(answers.hostingIntent
      ? {
          hostingIntent: {
            provider: answers.hostingIntent.provider,
            ...(answers.hostingIntent.host ? { host: answers.hostingIntent.host } : {}),
            namespace: answers.hostingIntent.namespace,
            repositoryName: answers.hostingIntent.repositoryName,
            ...(answers.hostingIntent.defaultBranch
              ? { defaultBranch: answers.hostingIntent.defaultBranch }
              : {}),
            ...(answers.hostingIntent.humanAuthProfileId
              ? { humanAuthProfileId: answers.hostingIntent.humanAuthProfileId }
              : {}),
            ...(answers.hostingIntent.automationAuthProfileId
              ? { automationAuthProfileId: answers.hostingIntent.automationAuthProfileId }
              : {}),
            ...(answers.hostingIntent.providerMutationAuthProfileId
              ? { providerMutationAuthProfileId: answers.hostingIntent.providerMutationAuthProfileId }
              : {}),
          },
        }
      : {}),
    ...(answers.publication
      ? {
          publication: {
            posture: answers.publication.posture,
            ...(answers.publication.remote ? { remote: answers.publication.remote } : {}),
            ...(answers.publication.targetBranch
              ? { targetBranch: answers.publication.targetBranch }
              : {}),
            ...(answers.publication.automationAuthProfileId
              ? { automationAuthProfileId: answers.publication.automationAuthProfileId }
              : {}),
            ...(answers.publication.humanAuthProfileId
              ? { humanAuthProfileId: answers.publication.humanAuthProfileId }
              : {}),
          },
        }
      : {}),
    ...(answers.readinessChecks
      ? {
          readinessChecks: answers.readinessChecks.map((check) => ({
            id: check.id,
            title: check.title,
            ...(check.provider ? { provider: check.provider } : {}),
            ...(check.requiresAuthProfileId
              ? { requiresAuthProfileId: check.requiresAuthProfileId }
              : {}),
          })),
        }
      : {}),
  };
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
