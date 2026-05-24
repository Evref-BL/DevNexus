export interface NexusProjectReference {
  id: string;
  name: string;
  projectRoot: string;
}

export interface NexusProjectRegistry {
  projects: NexusProjectReference[];
}
