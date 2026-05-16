import type {
  NexusExtension,
  NexusProjectScaffoldContext,
  NexusProjectSkillsContext,
} from "./nexusExtension.js";
import {
  emptyNexusProjectAgentMcpConfigResult,
  materializeNexusProjectAgentMcpConfig,
  type MaterializeNexusProjectAgentMcpConfigResult,
} from "./nexusAgentMcpConfig.js";
import type { NexusProjectMcpConfig } from "./nexusProjectConfig.js";
import type { NexusProjectConfig } from "./nexusProjectConfig.js";
import {
  materializeNexusProjectTemplate,
  type MaterializeNexusProjectTemplateResult,
} from "./nexusProjectTemplate.js";
import {
  materializeNexusProjectSkills,
  type MaterializeNexusProjectSkillsResult,
  type NexusProjectSkillsConfig,
  type NexusSkillDefinition,
} from "./nexusSkills.js";

export interface ScaffoldNexusProjectOptions<
  ProjectConfig extends NexusProjectConfig = NexusProjectConfig,
> {
  homePath: string;
  projectRoot: string;
  worktreesRoot: string;
  projectConfig: ProjectConfig;
  extensions?: NexusExtension<ProjectConfig>[];
  skills?: NexusProjectSkillsConfig | false;
  skillDefinitions?: NexusSkillDefinition[];
  mcp?: NexusProjectMcpConfig | false;
}

export interface ScaffoldNexusProjectResult {
  projectRoot: string;
  worktreesRoot: string;
  template: MaterializeNexusProjectTemplateResult;
  skills: MaterializeNexusProjectSkillsResult;
  agentMcp: MaterializeNexusProjectAgentMcpConfigResult;
  extensionResults: Record<string, unknown>;
}

export function scaffoldNexusProject<
  ProjectConfig extends NexusProjectConfig = NexusProjectConfig,
>(
  options: ScaffoldNexusProjectOptions<ProjectConfig>,
): ScaffoldNexusProjectResult {
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

  const template = materializeNexusProjectTemplate({
    projectRoot: options.projectRoot,
    worktreesRoot: options.worktreesRoot,
    projectConfig: options.projectConfig,
    skillsConfig: options.skills,
    mcpConfig: options.mcp,
  });

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
  const agentMcp =
    options.mcp === undefined || options.mcp === false
      ? emptyNexusProjectAgentMcpConfigResult()
      : materializeNexusProjectAgentMcpConfig({
          projectRoot: options.projectRoot,
          mcpConfig: options.mcp,
        });

  return {
    projectRoot: options.projectRoot,
    worktreesRoot: options.worktreesRoot,
    template,
    skills,
    agentMcp,
    extensionResults,
  };
}
