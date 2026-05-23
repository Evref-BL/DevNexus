import type {
  NexusEligibleWorkExcludedItem,
  NexusEligibleWorkItem,
  NexusEligibleWorkTrackerQueryResult,
} from "../work-items/nexusEligibleWork.js";
import type { WorkItem } from "../work-items/workTrackingTypes.js";

export interface NexusAutomationComponentEligibleWorkItems {
  componentId: string;
  workItems: WorkItem[];
  importCandidateWorkItems?: NexusEligibleWorkItem[];
  excludedWorkItems?: NexusEligibleWorkExcludedItem[];
  warnings?: string[];
  blockers?: string[];
  trackerResults?: NexusEligibleWorkTrackerQueryResult[];
}
