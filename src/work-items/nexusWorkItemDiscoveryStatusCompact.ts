import {
  nexusCompactResultContract,
  type NexusCompactResultEnvelope,
} from "../results/nexusCompactResult.js";
import type {
  NexusWorkItemDiscoveryComponentStatus,
  NexusWorkItemDiscoveryStatus,
  NexusWorkItemDiscoveryTrackerStatus,
} from "./nexusWorkItemDiscoveryStatus.js";

export type NexusWorkItemDiscoveryCompactStatus =
  | "ok"
  | "warning"
  | "blocked";

export type NexusWorkItemDiscoveryCompactFindingKind =
  | "blocker"
  | "warning"
  | "ignored_work"
  | "unreadable_tracker";

export interface NexusWorkItemDiscoveryCompactSummary {
  status: NexusWorkItemDiscoveryCompactStatus;
  text: string;
  project: {
    id: string;
    name: string;
  };
}

export interface NexusWorkItemDiscoveryCompactStats {
  componentCount: number;
  trackerCount: number;
  selectedTrackerCount: number;
  readableTrackerCount: number;
  warningCount: number;
  blockerCount: number;
  ignoredOpenItemCount: number;
}

export interface NexusWorkItemDiscoveryCompactFinding {
  kind: NexusWorkItemDiscoveryCompactFindingKind;
  message: string;
  componentId?: string;
  trackerId?: string;
  status?: string;
  openCount?: number;
  suggestedCommand?: string[];
}

export type NexusWorkItemDiscoveryCompactResult =
  NexusCompactResultEnvelope<
    NexusWorkItemDiscoveryCompactSummary,
    NexusWorkItemDiscoveryCompactStats,
    NexusWorkItemDiscoveryCompactFinding
  >;

export function compactNexusWorkItemDiscoveryStatus(
  result: NexusWorkItemDiscoveryStatus,
  options: { findingLimit?: number } = {},
): NexusWorkItemDiscoveryCompactResult {
  const findingLimit = options.findingLimit ?? 10;
  const allFindings = workItemDiscoveryFindings(result);
  const findings = allFindings.slice(0, findingLimit);
  const stats = workItemDiscoveryStats(result);
  const status: NexusWorkItemDiscoveryCompactStatus =
    stats.blockerCount > 0 ? "blocked" : stats.warningCount > 0 ? "warning" : "ok";
  const fullRetrieval = {
    description: "Fetch the full work-item discovery status tree.",
    command: [
      "dev-nexus",
      "work-item",
      "discovery-status",
      result.projectRoot,
      "--json=full",
    ],
    mcpTool: {
      name: "work_item_discovery_status",
      arguments: {
        projectRoot: result.projectRoot,
        detail: "full",
      },
    },
  };

  return {
    ok: true,
    contract: nexusCompactResultContract,
    mode: "compact",
    kind: "work_item_discovery_status",
    summary: {
      status,
      text: result.summary,
      project: {
        id: result.project.id,
        name: result.project.name,
      },
    },
    stats,
    findings,
    omitted: [
      {
        path: "components",
        omittedCount: result.components.length,
        reason: "Full per-component tracker discovery details are omitted from compact output.",
        retrieval: "Use retrieval[0] for full output.",
      },
      ...(allFindings.length > findings.length
        ? [
            {
              path: "findings",
              omittedCount: allFindings.length - findings.length,
              reason: `Only the top ${findingLimit} findings are included in compact output.`,
              retrieval: "Use retrieval[0] for full output.",
            },
          ]
        : []),
    ],
    retrieval: [fullRetrieval],
    nextCursor: null,
  };
}

function workItemDiscoveryStats(
  result: NexusWorkItemDiscoveryStatus,
): NexusWorkItemDiscoveryCompactStats {
  const trackers = result.components.flatMap((component) => component.configuredTrackers);
  return {
    componentCount: result.components.length,
    trackerCount: trackers.length,
    selectedTrackerCount: trackers.filter((tracker) => tracker.selectedForDiscovery).length,
    readableTrackerCount: trackers.filter((tracker) => tracker.readable.status === "readable")
      .length,
    warningCount: result.warnings.length,
    blockerCount: result.blockers.length,
    ignoredOpenItemCount: trackers.reduce(
      (count, tracker) => count + (tracker.ignoredWork?.openCount ?? 0),
      0,
    ),
  };
}

function workItemDiscoveryFindings(
  result: NexusWorkItemDiscoveryStatus,
): NexusWorkItemDiscoveryCompactFinding[] {
  return [
    ...result.blockers.map((message) => ({
      kind: "blocker" as const,
      message,
      ...componentAndTrackerFromMessage(result, message),
    })),
    ...result.warnings.map((message) => ({
      kind: "warning" as const,
      message,
      ...componentAndTrackerFromMessage(result, message),
    })),
    ...result.components.flatMap((component) => trackerFindings(component)),
  ];
}

function trackerFindings(
  component: NexusWorkItemDiscoveryComponentStatus,
): NexusWorkItemDiscoveryCompactFinding[] {
  return component.configuredTrackers.flatMap((tracker) => {
    const findings: NexusWorkItemDiscoveryCompactFinding[] = [];
    if (
      tracker.ignoredWork?.openCount !== null &&
      tracker.ignoredWork?.openCount !== undefined &&
      tracker.ignoredWork.openCount > 0
    ) {
      findings.push({
        kind: "ignored_work",
        componentId: component.componentId,
        trackerId: tracker.id,
        status: tracker.ignoredWork.status,
        openCount: tracker.ignoredWork.openCount,
        suggestedCommand: tracker.ignoredWork.suggestedCommand ?? undefined,
        message:
          `Component ${component.componentId} tracker ${tracker.id} has ${tracker.ignoredWork.openCount} ignored open item(s).`,
      });
    }
    if (
      tracker.selectedForDiscovery &&
      tracker.readable.status !== "readable"
    ) {
      findings.push({
        kind: "unreadable_tracker",
        componentId: component.componentId,
        trackerId: tracker.id,
        status: tracker.readable.status,
        message: tracker.readable.message,
      });
    }
    return findings;
  });
}

function componentAndTrackerFromMessage(
  result: NexusWorkItemDiscoveryStatus,
  message: string,
): Pick<NexusWorkItemDiscoveryCompactFinding, "componentId" | "trackerId"> {
  for (const component of result.components) {
    if (!message.includes(component.componentId)) {
      continue;
    }
    const tracker = trackerMentionedInMessage(component.configuredTrackers, message);
    return {
      componentId: component.componentId,
      ...(tracker ? { trackerId: tracker.id } : {}),
    };
  }
  return {};
}

function trackerMentionedInMessage(
  trackers: readonly NexusWorkItemDiscoveryTrackerStatus[],
  message: string,
): NexusWorkItemDiscoveryTrackerStatus | null {
  return trackers.find((tracker) => message.includes(tracker.id)) ?? null;
}
