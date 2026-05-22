import fs from "node:fs";
import path from "node:path";
import {
  summarizeNexusAutomationPublicationPolicy,
  type NexusAutomationPublicationConfig,
} from "./nexusAutomationConfig.js";
import type {
  NexusAuthorityComponentSummary,
  NexusAuthorityScopeConfig,
} from "./nexusAuthority.js";
import type { NexusSkillSourceControl } from "./nexusSkills.js";
import type {
  WorkStatus,
  WorkTrackingProviderName,
} from "./workTrackingTypes.js";
import type {
  NexusPluginWorkerFragmentCapabilityKind,
  NexusPluginWorkerFragmentProjection,
  NexusPluginWorkerFragmentSource,
  NexusPluginWorkerFragmentsProjection,
} from "./nexusPluginCapabilities.js";
import type { NexusRunnerProfilePolicySummary } from "./nexusRunnerProfile.js";
import type { NexusExpectedGitIdentity } from "./nexusGitIdentity.js";

export type NexusWorkerContextFileId =
  | "agents"
  | "context"
  | "plan"
  | "target-state"
  | `project-doc:${string}`
  | `component-doc:${string}`;

export interface NexusWorkerContextFileReference {
  id: NexusWorkerContextFileId;
  path: string;
  access: "read_only";
}

export interface NexusWorkerContextProject {
  id: string | null;
  name: string | null;
  root: string;
}

export interface NexusWorkerContextBoundarySet {
  roots: string[];
  files?: NexusWorkerContextFileReference[];
  notes: string[];
}

export interface NexusWorkerContextBoundaries {
  commandWorkingDirectory: string;
  gitWorkingDirectory: string;
  write: NexusWorkerContextBoundarySet;
  read: NexusWorkerContextBoundarySet;
}

export interface NexusWorkerProjectContextReferences {
  agentsPath: string;
  contextPath: string;
  planPath: string;
  targetStatePath: string;
  referencedFiles: NexusWorkerContextFileReference[];
  files: NexusWorkerContextFileReference[];
}

export interface NexusWorkerContextSkillReference {
  id: string;
  sourceSkillRoot: string;
  projectedSkillRoot: string;
  skillPath: string | null;
}

export interface NexusWorkerContextAgentSkillProjection {
  agent: string;
  skillsDirectory: string;
  sourceControl: NexusSkillSourceControl;
  skills: NexusWorkerContextSkillReference[];
}

export interface NexusWorkerContextSkills {
  projectManagedRoot: string;
  agentNativeProjections: NexusWorkerContextAgentSkillProjection[];
}

export interface NexusWorkerContextAgentTargetPolicy {
  explicit: boolean;
  activeProviders: string[];
  assignedProvider: string | null;
  recommendations: string[];
  warnings: string[];
}

export type NexusWorkerContextDependencyProjectionSourceControl =
  | "support"
  | "source";

export type NexusWorkerContextDependencyProjectionStatus =
  | "linked"
  | "present"
  | "skipped";

export interface NexusWorkerContextDependencyProjectionSourceMetadata {
  pluginId: string;
  pluginName: string | null;
  version: string | null;
  capabilityId: string;
}

export interface NexusWorkerContextDependencyProjectionSourceComponent {
  id: string;
  sourceRoot: string;
}

export interface NexusWorkerContextDependencyProjection {
  id: string;
  source: string;
  target: string;
  sourcePath: string;
  targetPath: string;
  required: boolean;
  sourceControl: NexusWorkerContextDependencyProjectionSourceControl;
  reason: string | null;
  status: NexusWorkerContextDependencyProjectionStatus;
  message: string;
  warnings?: string[];
  setupNotes?: string[];
  setupBlockers?: string[];
  sourceMetadata: NexusWorkerContextDependencyProjectionSourceMetadata;
  sourceComponent?: NexusWorkerContextDependencyProjectionSourceComponent;
}

export interface NexusWorkerContextDependencySupport {
  pluginDependencyProjections: NexusWorkerContextDependencyProjection[];
}

export interface NexusWorkerContextBundleWorkItem {
  id: string;
  title: string | null;
  description?: string | null;
  status?: WorkStatus;
  provider?: WorkTrackingProviderName | string;
  labels?: string[];
  assignees?: string[];
}

export interface NexusWorkerContextBundleWorktree {
  componentId: string;
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  workItem: NexusWorkerContextBundleWorkItem | null;
}

export interface NexusWorkerContextBundle {
  version: 1;
  project: NexusWorkerContextProject;
  projectRoot: string;
  component: {
    id: string;
    sourceRoot: string;
  };
  skills: NexusWorkerContextSkills;
  dependencySupport: NexusWorkerContextDependencySupport;
  ownership: NexusWorkerContextBundleWorktree;
  worktree: NexusWorkerContextBundleWorktree;
  publication: NexusAutomationPublicationConfig | null;
  gitIdentity: NexusExpectedGitIdentity | null;
  authority: NexusAuthorityComponentSummary | null;
  runnerProfiles: NexusRunnerProfilePolicySummary[];
  agentTargetPolicy: NexusWorkerContextAgentTargetPolicy;
  projectContext: NexusWorkerProjectContextReferences;
  pluginFragments: NexusPluginWorkerFragmentsProjection;
  boundaries: NexusWorkerContextBoundaries;
}

export interface NexusWorkerContextBundleOptions {
  projectRoot: string;
  projectId?: string | null;
  projectName?: string | null;
  componentId: string;
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  workItem: NexusWorkerContextBundleWorkItem | null;
  targetStatePath?: string | null;
  skills?: NexusWorkerContextSkills;
  dependencyProjections?: NexusWorkerContextDependencyProjection[];
  pluginFragments?: NexusPluginWorkerFragmentsProjection;
  publication?: NexusAutomationPublicationConfig | null;
  gitIdentity?: NexusExpectedGitIdentity | null;
  authority?: NexusAuthorityComponentSummary | null;
  runnerProfiles?: NexusRunnerProfilePolicySummary[];
  agentTargetPolicy?: NexusWorkerContextAgentTargetPolicy;
}

export interface MaterializeNexusWorkerContextBundleResult {
  contextDirectoryPath: string;
  contextJsonPath: string;
  briefingPath: string;
  context: NexusWorkerContextBundle;
  briefingMarkdown: string;
}

export const nexusWorkerContextDirectoryName = "context";
export const nexusWorkerContextJsonFileName = "context.json";
export const nexusWorkerBriefingFileName = "briefing.md";
export const defaultNexusWorkerTargetStatePath =
  ".dev-nexus/automation/target-state.md";
export const defaultNexusWorkerProjectManagedSkillsPath =
  ".dev-nexus/skills";

export class NexusWorkerContextBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusWorkerContextBundleError";
  }
}

export function nexusWorkerContextDirectoryPath(worktreePath: string): string {
  return path.join(
    normalizedAbsolutePath(worktreePath, "worktreePath"),
    ".dev-nexus",
    nexusWorkerContextDirectoryName,
  );
}

export function nexusWorkerContextJsonPath(worktreePath: string): string {
  return path.join(
    nexusWorkerContextDirectoryPath(worktreePath),
    nexusWorkerContextJsonFileName,
  );
}

export function nexusWorkerBriefingPath(worktreePath: string): string {
  return path.join(
    nexusWorkerContextDirectoryPath(worktreePath),
    nexusWorkerBriefingFileName,
  );
}

export function buildNexusWorkerContextBundle(
  options: NexusWorkerContextBundleOptions,
): NexusWorkerContextBundle {
  const projectRoot = normalizedAbsolutePath(options.projectRoot, "projectRoot");
  const projectId = optionalNullableString(options.projectId, "projectId") ?? null;
  const projectName =
    optionalNullableString(options.projectName, "projectName") ?? null;
  const componentId = requiredNonEmptyString(options.componentId, "componentId");
  const sourceRoot = normalizedAbsolutePath(options.sourceRoot, "sourceRoot");
  const worktreesRoot = normalizedAbsolutePath(
    options.worktreesRoot,
    "worktreesRoot",
  );
  const worktreePath = normalizedAbsolutePath(
    options.worktreePath,
    "worktreePath",
  );
  assertPathInsideRoot(
    worktreesRoot,
    worktreePath,
    "worktreePath",
    "worktreesRoot",
  );
  const branchName = requiredNonEmptyString(options.branchName, "branchName");
  const baseRef = optionalNullableString(options.baseRef, "baseRef") ?? null;
  const workItem = normalizeWorkerContextWorkItem(options.workItem);
  const projectContext = projectContextReferences({
    projectRoot,
    sourceRoot,
    targetStatePath: options.targetStatePath,
    workItem,
  });
  const skills = normalizeWorkerContextSkills(projectRoot, options.skills);
  const dependencySupport = normalizeWorkerDependencySupport(
    options.dependencyProjections,
  );
  const pluginFragments = normalizeWorkerPluginFragments(
    options.pluginFragments,
  );
  const publication = options.publication ?? null;
  const gitIdentity = options.gitIdentity ?? null;
  const authority = options.authority ?? null;
  const runnerProfiles = normalizeWorkerRunnerProfiles(options.runnerProfiles);
  const agentTargetPolicy = normalizeWorkerAgentTargetPolicy(
    options.agentTargetPolicy,
  );
  const worktree = {
    componentId,
    sourceRoot,
    worktreesRoot,
    worktreePath,
    branchName,
    baseRef,
    workItem,
  };

  return {
    version: 1,
    project: {
      id: projectId,
      name: projectName,
      root: projectRoot,
    },
    projectRoot,
    component: {
      id: componentId,
      sourceRoot,
    },
    skills,
    dependencySupport,
    ownership: worktree,
    worktree,
    publication,
    gitIdentity,
    authority,
    runnerProfiles,
    agentTargetPolicy,
    projectContext,
    pluginFragments,
    boundaries: {
      commandWorkingDirectory: worktreePath,
      gitWorkingDirectory: worktreePath,
      write: {
        roots: [worktreePath],
        notes: [
          "Write source changes only inside the component worktree unless the coordinator explicitly assigns another boundary.",
          "Run source and git commands from the component worktree.",
        ],
      },
      read: {
        roots: uniquePaths([sourceRoot, projectRoot]),
        files: projectContext.files,
        notes: [
          "Use the original component source root and workspace files as read-only context.",
          "Treat root workspace files as read-only unless the coordinator owns workspace state for this work.",
        ],
      },
    },
  };
}

export function renderNexusWorkerBriefing(
  context: NexusWorkerContextBundle,
): string {
  const workItemLine = context.worktree.workItem
    ? `${context.worktree.workItem.id}: ${context.worktree.workItem.title}`
    : "none";
  const baseRefLine = context.worktree.baseRef ?? "none";

  return [
    "# DevNexus Worker Context",
    "",
    `Component: ${context.component.id}`,
    `Work item: ${workItemLine}`,
    `Branch: ${context.worktree.branchName}`,
    `Base ref: ${baseRefLine}`,
    "",
    ...renderAgentTargetPolicyLines(context.agentTargetPolicy),
    "",
    `Run source and git commands in: ${context.worktree.worktreePath}`,
    "Source and Git commands run from the component checkout root shown above.",
    "Write source changes only inside this component worktree unless the coordinator assigns another boundary.",
    "Treat workspace context files as read-only unless the coordinator explicitly assigns project-state ownership.",
    "",
    "Project context:",
    `- AGENTS.md: ${context.projectContext.agentsPath}`,
    `- CONTEXT.md: ${context.projectContext.contextPath}`,
    `- PLAN.md: ${context.projectContext.planPath}`,
    `- target-state: ${context.projectContext.targetStatePath}`,
    ...renderReferencedProjectFileLines(context.projectContext.referencedFiles),
    "",
    "Skills:",
    `Workspace-managed skills: ${context.skills.projectManagedRoot}`,
    ...renderSkillProjectionLines(context.skills),
    "",
    "Dependency support:",
    ...renderDependencyProjectionLines(context.dependencySupport),
    "Package fetch and install are setup-owned; workers should report missing package dependencies as setup blockers instead of running ad hoc npm install or npx fetches.",
    "",
    ...renderPublicationPolicyLines(context.publication),
    ...renderGitIdentityLines(context.gitIdentity),
    "",
    ...renderAuthorityPolicyLines(context.authority),
    "",
    ...renderRunnerProfilePolicyLines(context.runnerProfiles),
    "",
    ...renderPluginBriefingFragments(context.pluginFragments.briefing),
  ].join("\n");
}

function renderAgentTargetPolicyLines(
  policy: NexusWorkerContextAgentTargetPolicy,
): string[] {
  return [
    "Agent target policy:",
    `- source: ${policy.explicit ? "explicit" : "compatibility"}`,
    `- active providers: ${policy.activeProviders.join(", ") || "none"}`,
    `- assigned worker provider: ${policy.assignedProvider ?? "none"}`,
    ...policy.recommendations.map(
      (recommendation) => `- recommendation: ${recommendation}`,
    ),
    ...policy.warnings.map((warning) => `- warning: ${warning}`),
  ];
}

export function materializeNexusWorkerContextBundle(
  options: NexusWorkerContextBundleOptions,
): MaterializeNexusWorkerContextBundleResult {
  const context = buildNexusWorkerContextBundle(options);
  const contextDirectoryPath = nexusWorkerContextDirectoryPath(
    context.worktree.worktreePath,
  );
  const contextJsonPath = nexusWorkerContextJsonPath(context.worktree.worktreePath);
  const briefingPath = nexusWorkerBriefingPath(context.worktree.worktreePath);
  const briefingMarkdown = renderNexusWorkerBriefing(context);

  fs.mkdirSync(contextDirectoryPath, { recursive: true });
  fs.writeFileSync(
    contextJsonPath,
    `${JSON.stringify(context, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(briefingPath, briefingMarkdown, "utf8");

  return {
    contextDirectoryPath,
    contextJsonPath,
    briefingPath,
    context,
    briefingMarkdown,
  };
}

function projectContextReferences(options: {
  projectRoot: string;
  sourceRoot: string;
  targetStatePath?: string | null;
  workItem: NexusWorkerContextBundleWorkItem | null;
}): NexusWorkerProjectContextReferences {
  const targetStatePath = resolveInsideProjectRoot(
    options.projectRoot,
    options.targetStatePath ?? defaultNexusWorkerTargetStatePath,
    "targetStatePath",
  );
  const agentsPath = path.join(options.projectRoot, "AGENTS.md");
  const contextPath = path.join(options.projectRoot, "CONTEXT.md");
  const planPath = path.join(options.projectRoot, "PLAN.md");
  const defaultFiles: NexusWorkerContextFileReference[] = [
    { id: "agents", path: agentsPath, access: "read_only" },
    { id: "context", path: contextPath, access: "read_only" },
    { id: "plan", path: planPath, access: "read_only" },
    { id: "target-state", path: targetStatePath, access: "read_only" },
  ];
  const referencedFiles = referencedProjectFiles({
    projectRoot: options.projectRoot,
    sourceRoot: options.sourceRoot,
    textSources: [
      options.workItem?.title ?? "",
      options.workItem?.description ?? "",
    ],
  });

  return {
    agentsPath,
    contextPath,
    planPath,
    targetStatePath,
    referencedFiles,
    files: [...defaultFiles, ...referencedFiles],
  };
}

function referencedProjectFiles(options: {
  projectRoot: string;
  sourceRoot: string;
  textSources: string[];
}): NexusWorkerContextFileReference[] {
  const references = new Map<string, NexusWorkerContextFileReference>();
  for (const text of options.textSources) {
    for (const relativePath of extractRootRelativeProjectDocReferences(text)) {
      if (references.has(relativePath)) {
        continue;
      }
      const projectPath = resolveInsideRoot(
        options.projectRoot,
        relativePath,
        "referencedProjectFile",
        "projectRoot",
      );
      if (fs.existsSync(projectPath)) {
        references.set(relativePath, {
          id: `project-doc:${relativePath}`,
          path: projectPath,
          access: "read_only",
        });
        continue;
      }

      const componentPath = resolveInsideRoot(
        options.sourceRoot,
        relativePath,
        "referencedComponentFile",
        "sourceRoot",
      );
      if (fs.existsSync(componentPath)) {
        references.set(relativePath, {
          id: `component-doc:${relativePath}`,
          path: componentPath,
          access: "read_only",
        });
        continue;
      }

      throw new NexusWorkerContextBundleError(
        `Referenced context file is missing: ${relativePath} ` +
          `(projectRoot: ${projectPath}; sourceRoot: ${componentPath})`,
      );
    }
  }

  return [...references.values()];
}

function extractRootRelativeProjectDocReferences(text: string): string[] {
  const matches = text.matchAll(
    /(?:^|[\s"'`(])((?:docs?|adrs?)\/[A-Za-z0-9._/-]+\.(?:md|markdown|txt|json|toml|ya?ml))(?=$|[\s"'`),.;:])/giu,
  );

  return [...matches]
    .map((match) => normalizeProjectDocReference(match[1]!))
    .filter((reference): reference is string => Boolean(reference));
}

function normalizeProjectDocReference(value: string): string | null {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    normalized.length === 0 ||
    normalized.includes("..") ||
    path.isAbsolute(normalized)
  ) {
    return null;
  }

  return normalized;
}

function renderReferencedProjectFileLines(
  files: NexusWorkerContextFileReference[],
): string[] {
  if (files.length === 0) {
    return [];
  }

  const projectFiles = files.filter((file) => file.id.startsWith("project-doc:"));
  const componentFiles = files.filter((file) =>
    file.id.startsWith("component-doc:"),
  );

  return [
    ...renderReferencedFileGroup("Referenced project docs:", projectFiles),
    ...renderReferencedFileGroup("Referenced component docs:", componentFiles),
  ];
}

function renderReferencedFileGroup(
  title: string,
  files: NexusWorkerContextFileReference[],
): string[] {
  if (files.length === 0) {
    return [];
  }

  return [
    "",
    title,
    ...files.map((file) => `- ${referencedFileRelativePath(file)}: ${file.path}`),
  ];
}

function referencedFileRelativePath(
  file: NexusWorkerContextFileReference,
): string {
  if (file.id.startsWith("project-doc:")) {
    return file.id.slice("project-doc:".length);
  }
  if (file.id.startsWith("component-doc:")) {
    return file.id.slice("component-doc:".length);
  }

  return file.id;
}

function normalizeWorkerContextSkills(
  projectRoot: string,
  skills: NexusWorkerContextSkills | undefined,
): NexusWorkerContextSkills {
  const projectManagedRoot = skills?.projectManagedRoot
    ? normalizedAbsolutePath(skills.projectManagedRoot, "skills.projectManagedRoot")
    : path.join(projectRoot, defaultNexusWorkerProjectManagedSkillsPath);

  return {
    projectManagedRoot,
    agentNativeProjections: (skills?.agentNativeProjections ?? []).map(
      (projection, projectionIndex) => ({
        agent: requiredNonEmptyString(
          projection.agent,
          `skills.agentNativeProjections[${projectionIndex}].agent`,
        ),
        skillsDirectory: normalizedAbsolutePath(
          projection.skillsDirectory,
          `skills.agentNativeProjections[${projectionIndex}].skillsDirectory`,
        ),
        sourceControl: normalizeSkillSourceControl(
          projection.sourceControl,
          `skills.agentNativeProjections[${projectionIndex}].sourceControl`,
        ),
        skills: projection.skills.map((skill, skillIndex) => ({
          id: requiredNonEmptyString(
            skill.id,
            `skills.agentNativeProjections[${projectionIndex}].skills[${skillIndex}].id`,
          ),
          sourceSkillRoot: normalizedAbsolutePath(
            skill.sourceSkillRoot,
            `skills.agentNativeProjections[${projectionIndex}].skills[${skillIndex}].sourceSkillRoot`,
          ),
          projectedSkillRoot: normalizedAbsolutePath(
            skill.projectedSkillRoot,
            `skills.agentNativeProjections[${projectionIndex}].skills[${skillIndex}].projectedSkillRoot`,
          ),
          skillPath:
            skill.skillPath === null
              ? null
              : normalizedAbsolutePath(
                  skill.skillPath,
                  `skills.agentNativeProjections[${projectionIndex}].skills[${skillIndex}].skillPath`,
                ),
        })),
      }),
    ),
  };
}

function normalizeWorkerAgentTargetPolicy(
  policy: NexusWorkerContextAgentTargetPolicy | undefined,
): NexusWorkerContextAgentTargetPolicy {
  return {
    explicit: policy?.explicit === true,
    activeProviders: normalizeStringArray(
      policy?.activeProviders ?? [],
      "agentTargetPolicy.activeProviders",
    ),
    assignedProvider:
      optionalNullableString(
        policy?.assignedProvider,
        "agentTargetPolicy.assignedProvider",
      ) ?? null,
    recommendations: normalizeStringArray(
      policy?.recommendations ?? [],
      "agentTargetPolicy.recommendations",
    ),
    warnings: normalizeStringArray(
      policy?.warnings ?? [],
      "agentTargetPolicy.warnings",
    ),
  };
}

function normalizeSkillSourceControl(
  value: NexusSkillSourceControl,
  name: string,
): NexusSkillSourceControl {
  if (value === "support" || value === "source") {
    return value;
  }

  throw new NexusWorkerContextBundleError(`${name} must be support or source`);
}

function renderSkillProjectionLines(
  skills: NexusWorkerContextSkills,
): string[] {
  if (skills.agentNativeProjections.length === 0) {
    return ["- agent-native projections: none"];
  }

  return skills.agentNativeProjections.map(
    (projection) => `- ${projection.agent} skills: ${projection.skillsDirectory}`,
  );
}

function normalizeWorkerDependencySupport(
  dependencyProjections: NexusWorkerContextDependencyProjection[] | undefined,
): NexusWorkerContextDependencySupport {
  return {
    pluginDependencyProjections: (dependencyProjections ?? []).map(
      normalizeWorkerDependencyProjection,
    ),
  };
}

function normalizeWorkerDependencyProjection(
  projection: NexusWorkerContextDependencyProjection,
): NexusWorkerContextDependencyProjection {
  const warnings = normalizeStringArray(
    projection.warnings ?? [],
    "dependencyProjections.warnings",
  );
  const setupNotes = normalizeStringArray(
    projection.setupNotes ?? [],
    "dependencyProjections.setupNotes",
  );
  const setupBlockers = normalizeStringArray(
    projection.setupBlockers ?? [],
    "dependencyProjections.setupBlockers",
  );

  return {
    id: requiredNonEmptyString(projection.id, "dependencyProjections.id"),
    source: requiredNonEmptyString(
      projection.source,
      "dependencyProjections.source",
    ),
    target: requiredNonEmptyString(
      projection.target,
      "dependencyProjections.target",
    ),
    sourcePath: normalizedAbsolutePath(
      projection.sourcePath,
      "dependencyProjections.sourcePath",
    ),
    targetPath: normalizedAbsolutePath(
      projection.targetPath,
      "dependencyProjections.targetPath",
    ),
    required: projection.required === true,
    sourceControl: normalizeDependencyProjectionSourceControl(
      projection.sourceControl,
      "dependencyProjections.sourceControl",
    ),
    reason:
      optionalNullableString(projection.reason, "dependencyProjections.reason") ??
      null,
    status: normalizeDependencyProjectionStatus(
      projection.status,
      "dependencyProjections.status",
    ),
    message: requiredNonEmptyString(
      projection.message,
      "dependencyProjections.message",
    ),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(setupNotes.length > 0 ? { setupNotes } : {}),
    ...(setupBlockers.length > 0 ? { setupBlockers } : {}),
    sourceMetadata: normalizeDependencyProjectionSourceMetadata(
      projection.sourceMetadata,
    ),
    ...(projection.sourceComponent
      ? {
          sourceComponent: normalizeDependencyProjectionSourceComponent(
            projection.sourceComponent,
          ),
        }
      : {}),
  };
}

function normalizeDependencyProjectionSourceControl(
  value: NexusWorkerContextDependencyProjectionSourceControl,
  name: string,
): NexusWorkerContextDependencyProjectionSourceControl {
  if (value === "support" || value === "source") {
    return value;
  }

  throw new NexusWorkerContextBundleError(`${name} must be support or source`);
}

function normalizeDependencyProjectionStatus(
  value: NexusWorkerContextDependencyProjectionStatus,
  name: string,
): NexusWorkerContextDependencyProjectionStatus {
  if (value === "linked" || value === "present" || value === "skipped") {
    return value;
  }

  throw new NexusWorkerContextBundleError(
    `${name} must be linked, present, or skipped`,
  );
}

function normalizeDependencyProjectionSourceMetadata(
  sourceMetadata: NexusWorkerContextDependencyProjectionSourceMetadata,
): NexusWorkerContextDependencyProjectionSourceMetadata {
  return {
    pluginId: requiredNonEmptyString(
      sourceMetadata.pluginId,
      "dependencyProjections.sourceMetadata.pluginId",
    ),
    pluginName:
      optionalNullableString(
        sourceMetadata.pluginName,
        "dependencyProjections.sourceMetadata.pluginName",
      ) ?? null,
    version:
      optionalNullableString(
        sourceMetadata.version,
        "dependencyProjections.sourceMetadata.version",
      ) ?? null,
    capabilityId: requiredNonEmptyString(
      sourceMetadata.capabilityId,
      "dependencyProjections.sourceMetadata.capabilityId",
    ),
  };
}

function normalizeDependencyProjectionSourceComponent(
  sourceComponent: NexusWorkerContextDependencyProjectionSourceComponent,
): NexusWorkerContextDependencyProjectionSourceComponent {
  return {
    id: requiredNonEmptyString(
      sourceComponent.id,
      "dependencyProjections.sourceComponent.id",
    ),
    sourceRoot: normalizedAbsolutePath(
      sourceComponent.sourceRoot,
      "dependencyProjections.sourceComponent.sourceRoot",
    ),
  };
}

function renderDependencyProjectionLines(
  dependencySupport: NexusWorkerContextDependencySupport,
): string[] {
  if (dependencySupport.pluginDependencyProjections.length === 0) {
    return ["- plugin dependency projections: none"];
  }

  return dependencySupport.pluginDependencyProjections.flatMap((projection) => [
    `- ${projection.status} ${projection.id}: ${projection.target}`,
    `  Source: ${projection.sourceMetadata.pluginId}:${projection.sourceMetadata.capabilityId}`,
    ...(projection.sourceComponent
      ? [
          `  Source component: ${projection.sourceComponent.id} (${projection.sourceComponent.sourceRoot})`,
        ]
      : []),
    ...(projection.reason ? [`  Reason: ${projection.reason}`] : []),
    ...(projection.warnings ?? []).map((warning) => `  Warning: ${warning}`),
    ...(projection.setupNotes ?? []).map((note) => `  Setup note: ${note}`),
    ...(projection.setupBlockers ?? []).map(
      (blocker) => `  Setup blocker: ${blocker}`,
    ),
  ]);
}

function renderPublicationPolicyLines(
  publication: NexusAutomationPublicationConfig | null,
): string[] {
  if (!publication) {
    return ["Publication policy:", "- automation remote: none"];
  }

  const commandEnvironmentKeys = Object.keys(publication.commandEnvironment)
    .sort()
    .join(", ");
  const policySummary = summarizeNexusAutomationPublicationPolicy(publication);

  return [
    "Publication policy:",
    `- mode: ${policySummary.mode}`,
    `- target branch: ${policySummary.targetBranch ?? "none"}`,
    `- integration preference: ${policySummary.integrationPreference}`,
    `- integration branch: ${policySummary.integrationBranch ?? "none"}`,
    `- direct target push: ${policySummary.directTargetPush}`,
    `- merge authority: ${policySummary.mergeAuthority ?? "none"}`,
    `- required checks: ${policySummary.requiredChecks.join(", ") || "none"}`,
    `- stale checks: ${policySummary.staleChecks ?? "none"}`,
    `- automation remote: ${publication.remote ?? "none"}`,
    `- automation actor: ${publicationActorLabel(publication.actor)}`,
    `- manual remote: ${publication.manualRemote ?? "none"}`,
    `- manual actor: ${publicationActorLabel(publication.manualActor)}`,
    `- command environment keys: ${commandEnvironmentKeys || "none"}`,
  ];
}

function renderGitIdentityLines(
  gitIdentity: NexusExpectedGitIdentity | null,
): string[] {
  if (!gitIdentity) {
    return [
      "- automation Git identity: none",
      "- automation Git identity warning: repo-local Git identity is not configured; raw git commit may use an inherited host identity.",
    ];
  }

  return [
    `- automation Git identity: ${gitIdentity.name ?? "unknown"} <${gitIdentity.email ?? "unknown"}>`,
    `- automation Git identity source: ${gitIdentity.source}`,
    gitIdentity.name && gitIdentity.email
      ? "- raw git commit uses the prepared repo-local automation identity unless the worker overrides Git config."
      : "- automation Git identity warning: repo-local Git identity is incomplete; raw git commit may use an inherited host identity.",
    ...gitIdentity.warnings.map((warning) => `- automation Git identity warning: ${warning}`),
  ];
}

function publicationActorLabel(
  actor: NexusAutomationPublicationConfig["actor"],
): string {
  if (!actor) {
    return "none";
  }
  return [
    actor.kind,
    actor.provider ?? "unknown-provider",
    actor.handle ?? actor.id ?? "unknown-actor",
  ].join(":");
}

function renderAuthorityPolicyLines(
  authority: NexusAuthorityComponentSummary | null,
): string[] {
  if (!authority) {
    return ["Authority:", "- component authority: not configured"];
  }

  const allowed = authority.keyAllowedActions.length > 0
    ? authority.keyAllowedActions.join(",")
    : "none";
  const blocked = authority.blockedActions.length > 0
    ? authority.blockedActions.join(",")
    : "none";
  const waiting = authority.waitingActions.length > 0
    ? authority.waitingActions.join(",")
    : "none";
  const fallback = authority.fallbackActions.length > 0
    ? authority.fallbackActions.join(",")
    : "none";
  const bindings = authority.roleBindings.length > 0
    ? authority.roleBindings
        .map((binding) =>
          `${binding.roles.join(",")}@${authorityScopeLabel(binding.scope)}`
        )
        .join("; ")
    : "none";

  return [
    "Authority:",
    `- current actor: ${authority.actor.actorId ?? "unknown"} status=${authority.actor.status} profile=${authority.authProfile?.id ?? "none"}`,
    `- role bindings: ${bindings}`,
    `- allowed actions: ${allowed}`,
    `- blocked actions: ${blocked}`,
    `- waiting actions: ${waiting}`,
    `- fallback actions: ${fallback}`,
  ];
}

function authorityScopeLabel(scope: NexusAuthorityScopeConfig): string {
  const entries = Object.entries(scope).filter((entry): entry is [string, string] =>
    typeof entry[1] === "string" && entry[1].length > 0
  );
  if (entries.length === 0) {
    return "fallback";
  }

  return entries.map(([key, value]) => `${key}:${value}`).join(",");
}

function normalizeWorkerRunnerProfiles(
  runnerProfiles: NexusRunnerProfilePolicySummary[] | undefined,
): NexusRunnerProfilePolicySummary[] {
  return (runnerProfiles ?? []).map((profile) => ({
    id: requiredNonEmptyString(profile.id, "runnerProfiles.id"),
    displayName: requiredNonEmptyString(
      profile.displayName,
      "runnerProfiles.displayName",
    ),
    enabled: profile.enabled,
    requiredCapabilities: normalizeStringArray(
      profile.requiredCapabilities,
      "runnerProfiles.requiredCapabilities",
    ),
    allowedOperationClasses: [...profile.allowedOperationClasses],
    commandProfileRefs: normalizeStringArray(
      profile.commandProfileRefs,
      "runnerProfiles.commandProfileRefs",
    ),
    limits: { ...profile.limits },
    artifactRetention: { ...profile.artifactRetention },
    credentialIdentity: { ...profile.credentialIdentity },
    mutationClass: profile.mutationClass,
    approvalRequired: profile.approvalRequired,
    approvalState: profile.approvalState,
    policyGateIds: normalizeStringArray(
      profile.policyGateIds,
      "runnerProfiles.policyGateIds",
    ),
    missingHostCapabilities: normalizeStringArray(
      profile.missingHostCapabilities,
      "runnerProfiles.missingHostCapabilities",
    ),
    runnableHostIds: normalizeStringArray(
      profile.runnableHostIds,
      "runnerProfiles.runnableHostIds",
    ),
  }));
}

function renderRunnerProfilePolicyLines(
  runnerProfiles: NexusRunnerProfilePolicySummary[],
): string[] {
  if (runnerProfiles.length === 0) {
    return ["Runner profile policy:", "- runner profiles: none"];
  }

  return [
    "Runner profile policy:",
    ...runnerProfiles.map(
      (profile) =>
        `- ${profile.id}: mutation=${profile.mutationClass} approval=${profile.approvalState} capabilities=${profile.requiredCapabilities.join(",") || "none"} missingHostCapabilities=${profile.missingHostCapabilities.join(",") || "none"}`,
    ),
  ];
}

function normalizeWorkerContextWorkItem(
  workItem: NexusWorkerContextBundleWorkItem | null,
): NexusWorkerContextBundleWorkItem | null {
  if (workItem === null) {
    return null;
  }

  return {
    id: requiredNonEmptyString(workItem.id, "workItem.id"),
    title: optionalNullableString(workItem.title, "workItem.title") ?? null,
    ...(workItem.description !== undefined
      ? {
          description:
            optionalNullableString(workItem.description, "workItem.description") ??
            null,
        }
      : {}),
    ...(workItem.status ? { status: workItem.status } : {}),
    ...(workItem.provider
      ? { provider: requiredNonEmptyString(workItem.provider, "workItem.provider") }
      : {}),
    ...(workItem.labels ? { labels: [...workItem.labels] } : {}),
    ...(workItem.assignees ? { assignees: [...workItem.assignees] } : {}),
  };
}

function normalizeWorkerPluginFragments(
  pluginFragments: NexusPluginWorkerFragmentsProjection | undefined,
): NexusPluginWorkerFragmentsProjection {
  return {
    context: normalizeWorkerPluginFragmentList(
      pluginFragments?.context ?? [],
      "worker_context_fragment",
    ),
    briefing: normalizeWorkerPluginFragmentList(
      pluginFragments?.briefing ?? [],
      "worker_briefing_fragment",
    ),
  };
}

function normalizeWorkerPluginFragmentList(
  fragments: NexusPluginWorkerFragmentProjection[],
  expectedKind: NexusPluginWorkerFragmentCapabilityKind,
): NexusPluginWorkerFragmentProjection[] {
  return fragments
    .map((fragment) => normalizeWorkerPluginFragment(fragment, expectedKind))
    .sort(compareWorkerPluginFragments);
}

function normalizeWorkerPluginFragment(
  fragment: NexusPluginWorkerFragmentProjection,
  expectedKind: NexusPluginWorkerFragmentCapabilityKind,
): NexusPluginWorkerFragmentProjection {
  const kind = requiredNonEmptyString(
    fragment.kind,
    "pluginFragments.kind",
  ) as NexusPluginWorkerFragmentCapabilityKind;
  if (kind !== expectedKind) {
    throw new NexusWorkerContextBundleError(
      `pluginFragments.${expectedKind} entries must have kind ${expectedKind}`,
    );
  }

  return {
    kind,
    id: requiredNonEmptyString(fragment.id, "pluginFragments.id"),
    title: requiredNonEmptyString(fragment.title, "pluginFragments.title"),
    body: requiredNonEmptyString(fragment.body, "pluginFragments.body"),
    provenance: requiredNonEmptyString(
      fragment.provenance,
      "pluginFragments.provenance",
    ),
    advisory: true,
    targetAgents: normalizeStringArray(
      fragment.targetAgents,
      "pluginFragments.targetAgents",
    ),
    targetComponents: normalizeStringArray(
      fragment.targetComponents,
      "pluginFragments.targetComponents",
    ),
    source: normalizeWorkerPluginFragmentSource(fragment.source),
  };
}

function normalizeWorkerPluginFragmentSource(
  source: NexusPluginWorkerFragmentSource,
): NexusPluginWorkerFragmentSource {
  return {
    pluginId: requiredNonEmptyString(
      source.pluginId,
      "pluginFragments.source.pluginId",
    ),
    pluginName:
      optionalNullableString(
        source.pluginName,
        "pluginFragments.source.pluginName",
      ) ?? null,
    version:
      optionalNullableString(
        source.version,
        "pluginFragments.source.version",
      ) ?? null,
    capabilityId: requiredNonEmptyString(
      source.capabilityId,
      "pluginFragments.source.capabilityId",
    ),
  };
}

function normalizeStringArray(value: string[], name: string): string[] {
  if (!Array.isArray(value)) {
    throw new NexusWorkerContextBundleError(`${name} must be an array`);
  }

  return value.map((entry, index) =>
    requiredNonEmptyString(entry, `${name}[${index}]`),
  );
}

function compareWorkerPluginFragments(
  left: NexusPluginWorkerFragmentProjection,
  right: NexusPluginWorkerFragmentProjection,
): number {
  return (
    compareStrings(left.source.pluginId, right.source.pluginId) ||
    compareStrings(left.id, right.id) ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.provenance, right.provenance)
  );
}

function renderPluginBriefingFragments(
  fragments: NexusPluginWorkerFragmentProjection[],
): string[] {
  if (fragments.length === 0) {
    return [];
  }

  return [
    "## Plugin Briefing Fragments",
    "",
    "These fragments are advisory setup/context only; they do not select work, launch subagents, or supervise implementation.",
    "",
    ...fragments.flatMap(renderPluginBriefingFragment),
  ];
}

function renderPluginBriefingFragment(
  fragment: NexusPluginWorkerFragmentProjection,
): string[] {
  return [
    `### ${fragment.title}`,
    "",
    `Source: ${fragment.source.pluginId}:${fragment.source.capabilityId}`,
    `Provenance: ${fragment.provenance}`,
    ...renderTargetLine("Intended agents", fragment.targetAgents),
    ...renderTargetLine("Intended components", fragment.targetComponents),
    "",
    fragment.body.trim(),
    "",
  ];
}

function renderTargetLine(label: string, targets: string[]): string[] {
  return targets.length > 0 ? [`${label}: ${targets.join(", ")}`] : [];
}

function resolveInsideProjectRoot(
  projectRoot: string,
  value: string,
  name: string,
): string {
  return resolveInsideRoot(projectRoot, value, name, "projectRoot");
}

function resolveInsideRoot(
  root: string,
  value: string,
  valueName: string,
  rootName: string,
): string {
  const resolved = path.resolve(root, requiredNonEmptyString(value, valueName));
  assertPathInsideRoot(root, resolved, valueName, rootName);

  return resolved;
}

function assertPathInsideRoot(
  root: string,
  value: string,
  valueName: string,
  rootName: string,
): void {
  const relative = path.relative(root, value);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new NexusWorkerContextBundleError(
      `${valueName} must resolve inside ${rootName}: ${value}`,
    );
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }

  return 0;
}

function normalizedAbsolutePath(value: unknown, name: string): string {
  return path.resolve(requiredNonEmptyString(value, name));
}

function optionalNullableString(
  value: unknown,
  name: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return requiredNonEmptyString(value, name);
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusWorkerContextBundleError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
