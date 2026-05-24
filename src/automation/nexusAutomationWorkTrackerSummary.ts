import type {
  ResolvedNexusProjectComponent,
  ResolvedNexusProjectWorkTracker,
} from "../project/nexusProjectLifecycle.js";
import type {
  WorkItem,
  WorkTrackerCapabilityReport,
  WorkTrackerRef,
} from "../work-items/workTrackingTypes.js";

export interface NexusAutomationWorkTrackerSummary {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  roles: string[];
  default: boolean;
  capabilityReport: WorkTrackerCapabilityReport;
}

export function summarizeNexusAutomationWorkTrackers(
  component: ResolvedNexusProjectComponent,
): NexusAutomationWorkTrackerSummary[] {
  return component.workTrackers.map((tracker) =>
    summarizeNexusAutomationWorkTracker(component, tracker),
  );
}

export function annotateDefaultTrackerWorkItems(
  component: ResolvedNexusProjectComponent,
  items: WorkItem[],
): WorkItem[] {
  return items.map((item) => annotateDefaultTrackerWorkItem(component, item));
}

export function annotateDefaultTrackerWorkItem(
  component: ResolvedNexusProjectComponent,
  item: WorkItem,
): WorkItem {
  if (item.trackerRef) {
    return item;
  }

  const trackerRef = defaultTrackerRef(component);
  if (!trackerRef) {
    return item;
  }

  return {
    ...item,
    trackerRef,
  };
}

function summarizeNexusAutomationWorkTracker(
  component: ResolvedNexusProjectComponent,
  tracker: ResolvedNexusProjectWorkTracker,
): NexusAutomationWorkTrackerSummary {
  return {
    id: tracker.id,
    name: tracker.name,
    provider: tracker.workTracking.provider,
    enabled: tracker.enabled,
    roles: [...tracker.roles],
    default: component.defaultTrackerId === tracker.id,
    capabilityReport: tracker.workTrackingCapabilityReport,
  };
}

function defaultTrackerRef(
  component: ResolvedNexusProjectComponent,
): WorkTrackerRef | null {
  if (!component.defaultTrackerId) {
    return null;
  }

  const tracker = component.workTrackers.find(
    (candidate) => candidate.id === component.defaultTrackerId,
  );
  if (!tracker) {
    return null;
  }

  return {
    componentId: component.id,
    componentName: component.name,
    trackerId: tracker.id,
    trackerName: tracker.name,
    provider: tracker.workTracking.provider,
    roles: [...tracker.roles],
    default: true,
  };
}
