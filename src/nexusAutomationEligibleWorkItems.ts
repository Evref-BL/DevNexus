import type {
  NexusEligibleWorkExcludedItem,
  NexusEligibleWorkItem,
  NexusEligibleWorkTrackerQueryResult,
} from "./nexusEligibleWork.js";
import type { WorkItem } from "./workTrackingTypes.js";

export interface NexusAutomationComponentEligibleWorkItems {
  componentId: string;
  workItems: WorkItem[];
  importCandidateWorkItems?: NexusEligibleWorkItem[];
  excludedWorkItems?: NexusEligibleWorkExcludedItem[];
  warnings?: string[];
  blockers?: string[];
  trackerResults?: NexusEligibleWorkTrackerQueryResult[];
}
