import fs from "node:fs";
import path from "node:path";
import {
  loadProjectConfig,
  projectConfigPath,
  projectWorktreesRootPath,
  saveProjectConfig,
  type NexusProjectComponentConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import { scaffoldNexusProject } from "./nexusProjectScaffold.js";
import {
  analyzeNexusProjectSetupComponentTopology,
  type NexusProjectComponentTopologyDiagnostic,
} from "./nexusProjectComponentTopology.js";
import type {
  NexusProjectSetupAnswers,
  NexusProjectSetupComponentAnswers,
} from "./nexusProjectSetupModel.js";
import {
  buildNexusProjectComponentConfigFromSetupAnswers,
  ensureLocalTrackerStores,
} from "./nexusProjectSetupWizard.js";

export interface NexusProjectComponentAddAnswers {
  components: NexusProjectSetupComponentAnswers[];
  localWorkTracking?: NexusProjectSetupAnswers["localWorkTracking"];
  publication?: NexusProjectSetupAnswers["publication"];
}

export interface NexusProjectComponentAddProposal {
  status: "ready" | "blocked";
  projectRoot: string;
  project: {
    id: string;
    name: string;
  };
  existingComponentIds: string[];
  addedComponentIds: string[];
  addedComponentConfigs: NexusProjectComponentConfig[];
  diagnostics: NexusProjectComponentTopologyDiagnostic[];
}

export interface NexusProjectComponentAddApplyResult {
  projectRoot: string;
  projectConfigPath: string;
  projectConfig: NexusProjectConfig;
  proposal: NexusProjectComponentAddProposal;
  writtenFiles: string[];
  ensuredLocalTrackerStores: string[];
}

export function readNexusProjectComponentAddAnswersFile(
  answersPath: string,
): NexusProjectComponentAddAnswers {
  return JSON.parse(
    fs.readFileSync(path.resolve(answersPath), "utf8"),
  ) as NexusProjectComponentAddAnswers;
}

export function previewNexusProjectComponentAdd(options: {
  projectRoot: string;
  answers: NexusProjectComponentAddAnswers;
}): NexusProjectComponentAddProposal {
  const projectRoot = path.resolve(options.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const diagnostics = validateComponentAddTopology({
    projectRoot,
    projectConfig,
    answers: options.answers,
  });
  const localWorkTracking = options.answers.localWorkTracking ?? {
    enabled: true,
    provider: "local" as const,
  };
  const addedComponentConfigs = options.answers.components.map((component) =>
    buildNexusProjectComponentConfigFromSetupAnswers(projectRoot, component, {
      localWorkTracking,
      publication: options.answers.publication,
      workTrackers: [],
    }),
  );

  return {
    status: diagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? "blocked"
      : "ready",
    projectRoot,
    project: {
      id: projectConfig.id,
      name: projectConfig.name,
    },
    existingComponentIds: projectConfig.components.map((component) => component.id),
    addedComponentIds: options.answers.components.map((component) => component.id),
    addedComponentConfigs,
    diagnostics,
  };
}

export async function applyNexusProjectComponentAdd(options: {
  projectRoot: string;
  answers: NexusProjectComponentAddAnswers;
  homePath?: string;
}): Promise<NexusProjectComponentAddApplyResult> {
  const projectRoot = path.resolve(options.projectRoot);
  const proposal = previewNexusProjectComponentAdd({
    projectRoot,
    answers: options.answers,
  });
  if (proposal.status !== "ready") {
    throw new Error(
      `component add proposal is blocked: ${proposal.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join("; ")}`,
    );
  }

  const projectConfig = loadProjectConfig(projectRoot);
  const updatedConfig: NexusProjectConfig = {
    ...projectConfig,
    components: [...projectConfig.components, ...proposal.addedComponentConfigs],
  };
  const savedProjectConfigPath = saveProjectConfig(projectRoot, updatedConfig);
  const worktreesRoot = projectWorktreesRootPath(projectRoot, updatedConfig);
  const scaffold = scaffoldNexusProject({
    homePath: options.homePath ?? updatedConfig.home ?? "",
    projectRoot,
    worktreesRoot,
    projectConfig: updatedConfig,
    skills: updatedConfig.skills,
    mcp: updatedConfig.mcp,
  });
  const ensuredLocalTrackerStores = await ensureLocalTrackerStores({
    projectRoot,
    projectConfig: updatedConfig,
  });

  return {
    projectRoot,
    projectConfigPath: savedProjectConfigPath,
    projectConfig: updatedConfig,
    proposal,
    writtenFiles: [
      savedProjectConfigPath,
      scaffold.template.supportReadmePath,
      ...(scaffold.template.targetStatePath ? [scaffold.template.targetStatePath] : []),
      ...scaffold.agentMcp.agentTargets.map((target) => target.configPath),
      ...scaffold.skills.installed.map((skill) => skill.manifestPath),
    ],
    ensuredLocalTrackerStores,
  };
}

function validateComponentAddTopology(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  answers: NexusProjectComponentAddAnswers;
}): NexusProjectComponentTopologyDiagnostic[] {
  const diagnostics: NexusProjectComponentTopologyDiagnostic[] = [];
  const existingIds = new Set(
    options.projectConfig.components.map((component) => component.id),
  );
  const addedIds = new Set<string>();
  const existingPrimary = options.projectConfig.components.some(
    (component) => component.role === "primary",
  );
  let addedPrimaryCount = 0;

  if (!Array.isArray(options.answers.components) || options.answers.components.length === 0) {
    diagnostics.push(componentAddDiagnostic({
      severity: "error",
      path: "components",
      componentId: "",
      sourceRoot: options.projectRoot,
      message: "At least one component is required.",
    }));
    return diagnostics;
  }

  for (const [index, component] of options.answers.components.entries()) {
    const componentPath = `components[${index}]`;
    if (!component.id) {
      diagnostics.push(componentAddDiagnostic({
        severity: "error",
        path: `${componentPath}.id`,
        componentId: "",
        sourceRoot: options.projectRoot,
        message: "Component id is required.",
      }));
      continue;
    }
    if (existingIds.has(component.id)) {
      diagnostics.push(componentAddDiagnostic({
        severity: "error",
        path: `${componentPath}.id`,
        componentId: component.id,
        sourceRoot: options.projectRoot,
        message: `Component already exists in this project: ${component.id}.`,
      }));
    }
    if (addedIds.has(component.id)) {
      diagnostics.push(componentAddDiagnostic({
        severity: "error",
        path: `${componentPath}.id`,
        componentId: component.id,
        sourceRoot: options.projectRoot,
        message: `Duplicate added component id: ${component.id}.`,
      }));
    }
    addedIds.add(component.id);
    if (component.role === "primary") {
      addedPrimaryCount += 1;
    }
  }

  if (existingPrimary && addedPrimaryCount > 0) {
    diagnostics.push(componentAddDiagnostic({
      severity: "error",
      path: "components",
      componentId: "",
      sourceRoot: options.projectRoot,
      message: "Project already has a primary component; added components must use dependency, extension, addon, optional, or support roles.",
    }));
  }
  if (!existingPrimary && addedPrimaryCount !== 1) {
    diagnostics.push(componentAddDiagnostic({
      severity: "error",
      path: "components",
      componentId: "",
      sourceRoot: options.projectRoot,
      message: `Exactly one added primary component is required because the project has no primary component; found ${addedPrimaryCount}.`,
    }));
  }

  diagnostics.push(
    ...analyzeNexusProjectSetupComponentTopology({
      project: {
        id: options.projectConfig.id,
        name: options.projectConfig.name,
        root: options.projectRoot,
      },
      components: options.answers.components,
    }).diagnostics,
  );

  return diagnostics;
}

function componentAddDiagnostic(options: {
  severity: "error" | "warning";
  path: string;
  componentId: string;
  sourceRoot: string;
  message: string;
}): NexusProjectComponentTopologyDiagnostic {
  return options;
}
