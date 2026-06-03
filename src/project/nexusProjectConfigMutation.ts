import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  applyNexusProjectComponentAdd,
  previewNexusProjectComponentAdd,
  type NexusProjectComponentAddAnswers,
} from "./nexusProjectComponentAdd.js";
import {
  analyzeNexusProjectSetupComponentTopology,
  type NexusProjectComponentTopologyDiagnostic,
} from "./nexusProjectComponentTopology.js";
import {
  loadProjectConfig,
  projectConfigPath,
  projectWorktreesRootPath,
  saveProjectConfig,
  validateProjectConfig,
  NexusConfigError,
  type NexusProjectComponentConfig,
  type NexusProjectComponentRole,
  type NexusProjectConfig,
  type NexusProjectRepoKind,
} from "./nexusProjectConfig.js";
import { scaffoldNexusProject } from "./nexusProjectScaffold.js";
import {
  ensureLocalTrackerStores,
} from "./nexusProjectSetupWizard.js";

export interface NexusProjectConfigRevision {
  configPath: string;
  sha256: string;
  sizeBytes: number;
}

export interface NexusProjectComponentEditPatch {
  name?: string;
  kind?: NexusProjectRepoKind;
  role?: NexusProjectComponentRole;
  remoteUrl?: string | null;
  defaultBranch?: string | null;
  sourceRoot?: string | null;
  worktreesRoot?: string | null;
  defaultWorkTrackerId?: string | null;
}

export type NexusProjectConfigMutationIntent =
  | {
      kind: "add_component";
      answers: NexusProjectComponentAddAnswers;
    }
  | {
      kind: "edit_component";
      componentId: string;
      patch: NexusProjectComponentEditPatch;
    }
  | {
      kind: "remove_component";
      componentId: string;
    };

export interface NexusProjectConfigMutationDiagnostic {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
  componentId?: string;
  sourceRoot?: string;
}

export interface NexusProjectConfigMutationProposal {
  status: "ready" | "blocked";
  projectRoot: string;
  projectConfigPath: string;
  revision: NexusProjectConfigRevision;
  project: {
    id: string;
    name: string;
  };
  intent: NexusProjectConfigMutationIntent;
  mutation: {
    kind: NexusProjectConfigMutationIntent["kind"];
    componentIds: string[];
  };
  summary: string;
  changedComponentIds: string[];
  diagnostics: NexusProjectConfigMutationDiagnostic[];
  plannedFiles: string[];
}

export interface NexusProjectConfigMutationApplyResult {
  projectRoot: string;
  projectConfigPath: string;
  beforeRevision: NexusProjectConfigRevision;
  afterRevision: NexusProjectConfigRevision;
  proposal: NexusProjectConfigMutationProposal;
  writtenFiles: string[];
  ensuredLocalTrackerStores: string[];
  skippedSideEffects: string[];
}

export class NexusProjectConfigMutationError extends Error {
  constructor(
    message: string,
    readonly code: "blocked" | "stale" | "invalid",
    readonly diagnostics: NexusProjectConfigMutationDiagnostic[] = [],
  ) {
    super(message);
    this.name = "NexusProjectConfigMutationError";
  }
}

export function readNexusProjectConfigRevision(
  projectRoot: string,
): NexusProjectConfigRevision {
  const configPath = projectConfigPath(projectRoot);
  const content = fs.readFileSync(configPath);
  return {
    configPath,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.byteLength,
  };
}

export function previewNexusProjectConfigMutation(options: {
  projectRoot: string;
  intent: NexusProjectConfigMutationIntent;
}): NexusProjectConfigMutationProposal {
  const projectRoot = path.resolve(options.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const revision = readNexusProjectConfigRevision(projectRoot);

  switch (options.intent.kind) {
    case "add_component":
      return previewComponentAddMutation({
        projectRoot,
        projectConfig,
        revision,
        intent: options.intent,
      });
    case "edit_component":
      return previewComponentEditMutation({
        projectRoot,
        projectConfig,
        revision,
        intent: options.intent,
      });
    case "remove_component":
      return previewComponentRemoveMutation({
        projectRoot,
        projectConfig,
        revision,
        intent: options.intent,
      });
  }
}

export async function applyNexusProjectConfigMutation(options: {
  projectRoot: string;
  expectedRevision: NexusProjectConfigRevision;
  intent: NexusProjectConfigMutationIntent;
  homePath?: string;
}): Promise<NexusProjectConfigMutationApplyResult> {
  const projectRoot = path.resolve(options.projectRoot);
  assertExpectedRevision(projectRoot, options.expectedRevision);
  const proposal = previewNexusProjectConfigMutation({
    projectRoot,
    intent: options.intent,
  });
  if (proposal.status !== "ready") {
    throw new NexusProjectConfigMutationError(
      `project config mutation is blocked: ${proposal.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join("; ")}`,
      "blocked",
      proposal.diagnostics,
    );
  }

  switch (options.intent.kind) {
    case "add_component": {
      const result = await applyNexusProjectComponentAdd({
        projectRoot,
        answers: options.intent.answers,
        homePath: options.homePath,
      });
      return {
        projectRoot,
        projectConfigPath: result.projectConfigPath,
        beforeRevision: proposal.revision,
        afterRevision: readNexusProjectConfigRevision(projectRoot),
        proposal,
        writtenFiles: result.writtenFiles,
        ensuredLocalTrackerStores: result.ensuredLocalTrackerStores,
        skippedSideEffects: [],
      };
    }
    case "edit_component":
    case "remove_component": {
      const updatedConfig = mutatedProjectConfig(projectConfigClone(
        loadProjectConfig(projectRoot),
      ), options.intent);
      const savedProjectConfigPath = saveProjectConfig(projectRoot, updatedConfig);
      const refresh = await refreshProjectSupport({
        projectRoot,
        projectConfig: updatedConfig,
        homePath: options.homePath,
      });
      return {
        projectRoot,
        projectConfigPath: savedProjectConfigPath,
        beforeRevision: proposal.revision,
        afterRevision: readNexusProjectConfigRevision(projectRoot),
        proposal,
        writtenFiles: [
          savedProjectConfigPath,
          ...refresh.writtenFiles.filter((filePath) =>
            filePath !== savedProjectConfigPath
          ),
        ],
        ensuredLocalTrackerStores: refresh.ensuredLocalTrackerStores,
        skippedSideEffects: [
          "Source directories are never deleted by project config mutation.",
        ],
      };
    }
  }
}

function previewComponentAddMutation(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  revision: NexusProjectConfigRevision;
  intent: Extract<NexusProjectConfigMutationIntent, { kind: "add_component" }>;
}): NexusProjectConfigMutationProposal {
  const addProposal = previewNexusProjectComponentAdd({
    projectRoot: options.projectRoot,
    answers: options.intent.answers,
  });
  const changedComponentIds = addProposal.addedComponentIds;
  const diagnostics = addProposal.diagnostics.map(topologyDiagnostic);
  return proposal({
    projectRoot: options.projectRoot,
    projectConfig: options.projectConfig,
    revision: options.revision,
    intent: options.intent,
    componentIds: changedComponentIds,
    summary: `Add ${componentCountLabel(changedComponentIds.length)}.`,
    changedComponentIds,
    diagnostics,
  });
}

function previewComponentEditMutation(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  revision: NexusProjectConfigRevision;
  intent: Extract<NexusProjectConfigMutationIntent, { kind: "edit_component" }>;
}): NexusProjectConfigMutationProposal {
  const diagnostics: NexusProjectConfigMutationDiagnostic[] = [];
  const updatedConfig = projectConfigClone(options.projectConfig);
  const component = updatedConfig.components.find((item) =>
    item.id === options.intent.componentId
  );
  if (!component) {
    diagnostics.push(componentMissingDiagnostic(options.intent.componentId));
  } else {
    applyComponentEditPatch(component, options.intent.patch);
    diagnostics.push(
      ...validateMutatedProjectConfig(updatedConfig),
      ...componentTopologyDiagnostics({
        projectRoot: options.projectRoot,
        component,
        componentIndex: updatedConfig.components.findIndex((item) =>
          item.id === options.intent.componentId
        ),
      }),
    );
  }

  return proposal({
    projectRoot: options.projectRoot,
    projectConfig: options.projectConfig,
    revision: options.revision,
    intent: options.intent,
    componentIds: [options.intent.componentId],
    summary: `Edit component ${options.intent.componentId}.`,
    changedComponentIds: [options.intent.componentId],
    diagnostics,
  });
}

function previewComponentRemoveMutation(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  revision: NexusProjectConfigRevision;
  intent: Extract<NexusProjectConfigMutationIntent, { kind: "remove_component" }>;
}): NexusProjectConfigMutationProposal {
  const diagnostics: NexusProjectConfigMutationDiagnostic[] = [];
  const updatedConfig = projectConfigClone(options.projectConfig);
  const componentIndex = updatedConfig.components.findIndex((component) =>
    component.id === options.intent.componentId
  );
  if (componentIndex < 0) {
    diagnostics.push(componentMissingDiagnostic(options.intent.componentId));
  } else {
    updatedConfig.components.splice(componentIndex, 1);
    diagnostics.push(...validateMutatedProjectConfig(updatedConfig));
  }

  return proposal({
    projectRoot: options.projectRoot,
    projectConfig: options.projectConfig,
    revision: options.revision,
    intent: options.intent,
    componentIds: [options.intent.componentId],
    summary: `Remove component ${options.intent.componentId} from project configuration.`,
    changedComponentIds: [options.intent.componentId],
    diagnostics,
  });
}

function mutatedProjectConfig(
  projectConfig: NexusProjectConfig,
  intent: NexusProjectConfigMutationIntent,
): NexusProjectConfig {
  switch (intent.kind) {
    case "add_component":
      throw new NexusProjectConfigMutationError(
        "add_component mutations are applied through component setup",
        "invalid",
      );
    case "edit_component": {
      const component = projectConfig.components.find((item) =>
        item.id === intent.componentId
      );
      if (!component) {
        throw new NexusProjectConfigMutationError(
          `component not found: ${intent.componentId}`,
          "blocked",
          [componentMissingDiagnostic(intent.componentId)],
        );
      }
      applyComponentEditPatch(component, intent.patch);
      return validateProjectConfig(projectConfig);
    }
    case "remove_component": {
      const componentIndex = projectConfig.components.findIndex((component) =>
        component.id === intent.componentId
      );
      if (componentIndex < 0) {
        throw new NexusProjectConfigMutationError(
          `component not found: ${intent.componentId}`,
          "blocked",
          [componentMissingDiagnostic(intent.componentId)],
        );
      }
      projectConfig.components.splice(componentIndex, 1);
      return validateProjectConfig(projectConfig);
    }
  }
}

function applyComponentEditPatch(
  component: NexusProjectComponentConfig,
  patch: NexusProjectComponentEditPatch,
): void {
  if (patch.name !== undefined) {
    component.name = patch.name;
  }
  if (patch.kind !== undefined) {
    component.kind = patch.kind;
  }
  if (patch.role !== undefined) {
    component.role = patch.role;
  }
  if (patch.remoteUrl !== undefined) {
    component.remoteUrl = patch.remoteUrl;
  }
  if (patch.defaultBranch !== undefined) {
    component.defaultBranch = patch.defaultBranch;
  }
  if (patch.sourceRoot !== undefined) {
    setOptionalComponentField(component, "sourceRoot", patch.sourceRoot);
  }
  if (patch.worktreesRoot !== undefined) {
    setOptionalComponentField(component, "worktreesRoot", patch.worktreesRoot);
  }
  if (patch.defaultWorkTrackerId !== undefined) {
    setOptionalComponentField(
      component,
      "defaultWorkTrackerId",
      patch.defaultWorkTrackerId,
    );
  }
}

function setOptionalComponentField<Key extends
  "sourceRoot" | "worktreesRoot" | "defaultWorkTrackerId">(
  component: NexusProjectComponentConfig,
  key: Key,
  value: string | null,
): void {
  if (value === null) {
    delete component[key];
    return;
  }
  component[key] = value;
}

function validateMutatedProjectConfig(
  projectConfig: NexusProjectConfig,
): NexusProjectConfigMutationDiagnostic[] {
  try {
    validateProjectConfig(projectConfig);
    return [];
  } catch (error) {
    if (error instanceof NexusConfigError) {
      return [{
        severity: "error",
        code: "invalid_project_config",
        path: "projectConfig",
        message: error.message,
      }];
    }
    throw error;
  }
}

function componentTopologyDiagnostics(options: {
  projectRoot: string;
  component: NexusProjectComponentConfig;
  componentIndex: number;
}): NexusProjectConfigMutationDiagnostic[] {
  return analyzeNexusProjectSetupComponentTopology({
    project: {
      id: "project-config-mutation",
      name: "Project Config Mutation",
      root: options.projectRoot,
    },
    components: [{
      id: options.component.id,
      name: options.component.name,
      role: options.component.role,
      source: {
        kind: "reference_existing",
        path: options.component.sourceRoot,
        remoteUrl: options.component.remoteUrl ?? undefined,
        defaultBranch: options.component.defaultBranch ?? undefined,
      },
    }],
  }).diagnostics.map((diagnostic) => ({
    ...topologyDiagnostic(diagnostic),
    path: diagnostic.path.replace("components[0]", `components[${options.componentIndex}]`),
  }));
}

function topologyDiagnostic(
  diagnostic: NexusProjectComponentTopologyDiagnostic,
): NexusProjectConfigMutationDiagnostic {
  return {
    severity: diagnostic.severity,
    code: `component_topology_${diagnostic.severity}`,
    path: diagnostic.path,
    message: diagnostic.message,
    componentId: diagnostic.componentId,
    sourceRoot: diagnostic.sourceRoot,
  };
}

function componentMissingDiagnostic(
  componentId: string,
): NexusProjectConfigMutationDiagnostic {
  return {
    severity: "error",
    code: "component_not_found",
    path: "componentId",
    componentId,
    message: `Component not found: ${componentId}.`,
  };
}

function proposal(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  revision: NexusProjectConfigRevision;
  intent: NexusProjectConfigMutationIntent;
  componentIds: string[];
  summary: string;
  changedComponentIds: string[];
  diagnostics: NexusProjectConfigMutationDiagnostic[];
}): NexusProjectConfigMutationProposal {
  return {
    status: options.diagnostics.some((diagnostic) =>
      diagnostic.severity === "error"
    )
      ? "blocked"
      : "ready",
    projectRoot: options.projectRoot,
    projectConfigPath: projectConfigPath(options.projectRoot),
    revision: options.revision,
    project: {
      id: options.projectConfig.id,
      name: options.projectConfig.name,
    },
    intent: options.intent,
    mutation: {
      kind: options.intent.kind,
      componentIds: options.componentIds,
    },
    summary: options.summary,
    changedComponentIds: options.changedComponentIds,
    diagnostics: options.diagnostics,
    plannedFiles: [projectConfigPath(options.projectRoot)],
  };
}

function assertExpectedRevision(
  projectRoot: string,
  expectedRevision: NexusProjectConfigRevision,
): void {
  const currentRevision = readNexusProjectConfigRevision(projectRoot);
  if (
    currentRevision.configPath !== expectedRevision.configPath ||
    currentRevision.sha256 !== expectedRevision.sha256
  ) {
    throw new NexusProjectConfigMutationError(
      "project config changed since preview; refresh before applying this mutation",
      "stale",
    );
  }
}

async function refreshProjectSupport(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  homePath?: string;
}): Promise<{
  writtenFiles: string[];
  ensuredLocalTrackerStores: string[];
}> {
  const worktreesRoot = projectWorktreesRootPath(
    options.projectRoot,
    options.projectConfig,
  );
  const scaffold = scaffoldNexusProject({
    homePath: options.homePath ?? options.projectConfig.home ?? "",
    projectRoot: options.projectRoot,
    worktreesRoot,
    projectConfig: options.projectConfig,
    skills: options.projectConfig.skills,
    mcp: options.projectConfig.mcp,
  });
  const ensuredLocalTrackerStores = await ensureLocalTrackerStores({
    projectRoot: options.projectRoot,
    projectConfig: options.projectConfig,
  });

  return {
    writtenFiles: [
      scaffold.template.supportReadmePath,
      ...(scaffold.template.targetStatePath ? [scaffold.template.targetStatePath] : []),
      ...scaffold.agentMcp.agentTargets.map((target) => target.configPath),
      ...scaffold.skills.installed.map((skill) => skill.manifestPath),
    ],
    ensuredLocalTrackerStores,
  };
}

function componentCountLabel(count: number): string {
  return count === 1 ? "1 component" : `${count} components`;
}

function projectConfigClone(projectConfig: NexusProjectConfig): NexusProjectConfig {
  return JSON.parse(JSON.stringify(projectConfig)) as NexusProjectConfig;
}
