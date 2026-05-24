import type { NexusSkillDefinition } from "../agents/nexusSkills.js";

export interface NexusProjectScaffoldContext<ProjectConfig = unknown> {
  homePath: string;
  projectRoot: string;
  worktreesRoot: string;
  projectConfig: ProjectConfig;
}

export interface NexusProjectStatusContext<ProjectConfig = unknown> {
  projectRoot: string;
  projectConfig: ProjectConfig;
}

export interface NexusProjectSkillsContext<ProjectConfig = unknown> {
  homePath: string;
  projectRoot: string;
  worktreesRoot: string;
  projectConfig: ProjectConfig;
}

export type NexusSkillContribution = NexusSkillDefinition;

export interface NexusExtension<
  ProjectConfig = unknown,
  ProjectScaffoldResult = unknown,
  ProjectStatusResult = unknown,
> {
  id: string;
  name: string;
  installProjectFiles?(
    context: NexusProjectScaffoldContext<ProjectConfig>,
  ): ProjectScaffoldResult;
  projectSkills?(
    context: NexusProjectSkillsContext<ProjectConfig>,
  ): NexusSkillContribution[] | undefined;
  projectStatus?(
    context: NexusProjectStatusContext<ProjectConfig>,
  ): ProjectStatusResult;
}
