import fs from "node:fs";
import type {
  NexusExtension,
  NexusProjectScaffoldContext,
  NexusProjectSkillsContext,
} from "./nexusExtension.js";
import {
  materializeNexusProjectSkills,
  type MaterializeNexusProjectSkillsResult,
  type NexusProjectSkillsConfig,
  type NexusSkillDefinition,
} from "./nexusSkills.js";

export interface ScaffoldNexusProjectOptions<ProjectConfig = unknown> {
  homePath: string;
  projectRoot: string;
  worktreesRoot: string;
  projectConfig: ProjectConfig;
  extensions?: NexusExtension<ProjectConfig>[];
  skills?: NexusProjectSkillsConfig | false;
  skillDefinitions?: NexusSkillDefinition[];
}

export interface ScaffoldNexusProjectResult {
  projectRoot: string;
  worktreesRoot: string;
  skills: MaterializeNexusProjectSkillsResult;
  extensionResults: Record<string, unknown>;
}

export function scaffoldNexusProject<ProjectConfig>(
  options: ScaffoldNexusProjectOptions<ProjectConfig>,
): ScaffoldNexusProjectResult {
  fs.mkdirSync(options.worktreesRoot, { recursive: true });

  const context: NexusProjectScaffoldContext<ProjectConfig> = {
    homePath: options.homePath,
    projectRoot: options.projectRoot,
    worktreesRoot: options.worktreesRoot,
    projectConfig: options.projectConfig,
  };
  const skillsContext: NexusProjectSkillsContext<ProjectConfig> = context;
  const extensionResults: Record<string, unknown> = {};
  const extensionSkills: NexusSkillDefinition[] = [];

  for (const extension of options.extensions ?? []) {
    const skills = extension.projectSkills?.(skillsContext);
    if (skills) {
      extensionSkills.push(...skills);
    }

    if (!extension.installProjectFiles) {
      continue;
    }

    extensionResults[extension.id] = extension.installProjectFiles(context);
  }

  const skills =
    options.skills === false
      ? {
          skillsDirectory: "",
          installed: [],
          agentTargets: [],
          gitExcludePath: null,
          gitExcludeEntries: [],
        }
      : materializeNexusProjectSkills({
          projectRoot: options.projectRoot,
          skillsConfig: options.skills,
          skillDefinitions: [
            ...extensionSkills,
            ...(options.skillDefinitions ?? []),
          ],
        });

  return {
    projectRoot: options.projectRoot,
    worktreesRoot: options.worktreesRoot,
    skills,
    extensionResults,
  };
}
