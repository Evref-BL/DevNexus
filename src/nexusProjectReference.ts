export interface NexusProjectReference {
  id: string;
  name: string;
  projectRoot: string;
  vibeKanbanProjectId?: string;
  vibeKanbanRepoId?: string;
}

export interface NexusProjectRegistry {
  projects: NexusProjectReference[];
}
