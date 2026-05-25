import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { renderNexusDashboardHistoryLayoutClientSource } from "./nexusDashboardHistoryLayout.js";
import { renderNexusCockpitHistoryColumnsClientSource } from "../cockpit/client/history/nexusCockpitHistoryColumns.js";
import { renderNexusCockpitHistoryGraphSvgClientSource } from "../cockpit/client/history/nexusCockpitHistoryGraphSvg.js";
import { renderNexusCockpitHistoryInteractionsClientSource } from "../cockpit/client/history/nexusCockpitHistoryInteractions.js";
import { renderNexusCockpitWorkMapClientSource } from "../cockpit/client/history/nexusCockpitWorkMap.js";
import { renderNexusCockpitEventHistoryClientSource } from "../cockpit/client/history/nexusCockpitEventHistory.js";
import { renderNexusCockpitActionsClientSource } from "../cockpit/client/nexusCockpitActions.js";
import { renderNexusCockpitFormatClientSource } from "../cockpit/client/nexusCockpitFormat.js";
import { renderNexusCockpitStylesClientSource } from "../cockpit/client/nexusCockpitStyles.js";
import { renderNexusCockpitTooltipsClientSource } from "../cockpit/client/nexusCockpitTooltips.js";

export function renderNexusDashboardClientModule(): string {
  return readNexusCockpitLegacyClientModuleSource();
}

export function renderNexusCockpitBrowserModule(): string {
  return readNexusCockpitBuiltClientModuleSource() ?? renderNexusDashboardClientModule();
}

export function nexusCockpitBrowserModuleAssetRevision(): string {
  const candidatePath = readNexusCockpitBuiltClientModulePath();
  if (!candidatePath) return "legacy";
  try {
    const stats = fs.statSync(candidatePath);
    return `${Math.round(stats.mtimeMs)}-${stats.size}`;
  } catch {
    return "legacy";
  }
}

function readNexusCockpitBuiltClientModuleSource(): string | null {
  const candidatePath = readNexusCockpitBuiltClientModulePath();
  return candidatePath ? fs.readFileSync(candidatePath, "utf8") : null;
}

function readNexusCockpitBuiltClientModulePath(): string | null {
  const candidates = [
    new URL("../cockpit-client/dev-nexus-cockpit.js", import.meta.url),
  ];
  for (const candidate of candidates) {
    const candidatePath = fileURLToPath(candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
}

function readNexusCockpitLegacyClientModuleSource(): string {
  const candidates = [
    new URL("../cockpit/client/nexusCockpitClient.js", import.meta.url),
    new URL("../cockpit/client/nexusCockpitClient.ts", import.meta.url),
  ];
  for (const candidate of candidates) {
    const candidatePath = fileURLToPath(candidate);
    if (!fs.existsSync(candidatePath)) continue;
    const source = fs.readFileSync(candidatePath, "utf8");
    return candidatePath.endsWith(".ts")
      ? standaloneNexusCockpitClientSource(source)
      : source;
  }
  throw new Error("DevNexus cockpit legacy client source is missing");
}

function standaloneNexusCockpitClientSource(source: string): string {
  return source
    .replace(/^\/\/ @ts-nocheck\s*/u, "")
    .replace(/^export interface \w+ \{[^}]*\}\s*/gmu, "")
    .replace(
      /^import \{ cockpitStyles \} from ["'][^"']+nexusCockpitStyles\.js["'];\s*/mu,
      `${renderNexusCockpitStylesClientSource()}\n\n`,
    )
    .replace(
      /^import \{\s*compactBranchName,\s*compactPath,\s*countLabel,\s*displayBody,\s*displayTitle,\s*escapeAttribute,\s*escapeHtml,\s*formatDisplayText,\s*formatTime,\s*toneForStatus,\s*truncate,\s*\} from ["'][^"']+nexusCockpitFormat\.js["'];\s*/mu,
      `${renderNexusCockpitFormatClientSource()}\n\n`,
    )
    .replace(
      /^import \{\s*chatIcon,\s*chevronDownIcon,\s*clipboardIcon,\s*codeIcon,\s*finderIcon,\s*folderIcon,\s*localAppIcon,\s*renderActionStrip,\s*renderDisabledAction,\s*renderProviderAction,\s*signalIcon,\s*terminalIcon,\s*uniqueActions,\s*\} from ["'][^"']+nexusCockpitActions\.js["'];\s*/mu,
      `${renderNexusCockpitActionsClientSource()}\n\n`,
    )
    .replace(
      /^import \{\s*historyRows,\s*renderBranchGraph,\s*renderLaneKey,\s*renderWorkHistory,\s*timelineLanes,\s*\} from ["'][^"']+nexusCockpitWorkMap\.js["'];\s*/mu,
      `${renderNexusCockpitWorkMapClientSource()}\n\n`,
    )
    .replace(
      /^import \{\s*featureGitBranches,\s*gitHistoryCommitBySelectId,\s*gitHistoryDetail,\s*gitHistoryRows,\s*isGitHistorySelection,\s*normalizeGitHistoryFilter,\s*renderGitHistory,\s*threadsForGitBranches,\s*trackedWorkForGitBranches,\s*\} from ["'][^"']+nexusCockpitEventHistory\.js["'];\s*/mu,
      `${renderNexusDashboardHistoryLayoutClientSource()}\n\n${renderNexusCockpitHistoryColumnsClientSource()}\n\n${renderNexusCockpitHistoryGraphSvgClientSource()}\n\n${renderNexusCockpitEventHistoryClientSource()}\n\n`,
    )
    .replace(
      /^import \{\s*bindGitHistoryColumnResizers,?\s*\} from ["'][^"']+nexusCockpitHistoryColumns\.js["'];\s*/mu,
      "",
    )
    .replace(
      /^import \{\s*bindGitHistoryInteractions,?\s*\} from ["'][^"']+nexusCockpitHistoryInteractions\.js["'];\s*/mu,
      `${renderNexusCockpitHistoryInteractionsClientSource()}\n\n`,
    )
    .replace(
      /^import \{\s*cockpitTooltipText,\s*installCockpitTooltips,\s*isCockpitTooltipTargetTruncated,\s*\} from ["'][^"']+nexusCockpitTooltips\.js["'];\s*/mu,
      `${renderNexusCockpitTooltipsClientSource()}\n\n`,
    )
    .replace(/^export async function /gmu, "async function ")
    .replace(/^export function /gmu, "function ")
    .replace(/^export const /gmu, "const ");
}

export type NexusDashboardVisualAuditStatus = "passed" | "failed";

export interface NexusDashboardVisualAuditCheck {
  id: string;
  label: string;
  status: NexusDashboardVisualAuditStatus;
  detail: string;
}

export interface NexusDashboardVisualAuditResult {
  ok: boolean;
  checks: NexusDashboardVisualAuditCheck[];
  evidence: string[];
  limitations: string[];
}

export function auditNexusDashboardClientVisuals(
  moduleSource = renderNexusDashboardClientModule(),
): NexusDashboardVisualAuditResult {
  const signalAccents = uniqueMatches(
    moduleSource,
    /\.dn-signal\.signal-[^{]+\{ --dn-signal-accent: (#[0-9a-f]{6})/giu,
  );
  const branchAccents = uniqueMatches(
    moduleSource,
    /--dn-branch-\d: (#[0-9a-f]{6})/giu,
  );
  const checks = [
    visualAuditCheck(
      "theme-modes",
      "Light and dark themes",
      includesAll(moduleSource, [
        "data-theme-mode=\"system\"",
        "data-theme-mode=\"light\"",
        "data-theme-mode=\"dark\"",
        ":root[data-dev-nexus-theme='light']",
        ":root[data-dev-nexus-theme='dark']",
        "prefers-color-scheme",
      ]),
      "System, light, and dark modes are present.",
    ),
    visualAuditCheck(
      "signal-accents",
      "Distinct signal accents",
      signalAccents.length >= 6,
      `${signalAccents.length} signal accent colors found.`,
    ),
    visualAuditCheck(
      "branch-accents",
      "Distinct branch accents",
      branchAccents.length >= 7,
      `${branchAccents.length} branch accent colors found.`,
    ),
    visualAuditCheck(
      "host-smart-cards",
      "Smart host signal cards",
      includesAll(moduleSource, [
        "data-host-focus",
        "bindHostSignalControls",
        "filteredHostActions",
        "filteredHostWorkspaces",
        "workspaceAccentMap",
      ]),
      "Host signal cards filter the queue/workspaces while keeping the workspace panel in the same page position as project pages.",
    ),
    visualAuditCheck(
      "text-fitting",
      "Text fitting guardrails",
      includesAll(moduleSource, [
        ".dn-action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
        ".dn-selected-section p { display: -webkit-box; -webkit-line-clamp: 3;",
        ".dn-plugin-pills span { max-width: 100%;",
        ".dn-thread-main strong, .dn-plugin-card strong, .dn-tracked-card strong { overflow: hidden;",
        ".dn-workspace-card strong { min-width: 0; overflow: hidden;",
        "overflow-wrap: anywhere;",
      ]),
      "Long labels use truncation, line clamp, or overflow wrapping.",
    ),
    visualAuditCheck(
      "lane-labels",
      "Lane labels and row alignment",
      includesAll(moduleSource, [
        ".dn-lane-key { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));",
        "Not Git history",
        "Each rail is a workspace category",
        "Source checkout",
        "Active branch",
        "More branches",
        "Automation",
        "Decisions",
        "const rowHeight = 34",
        "data-row-height",
        "top: calc(50% - 5px)",
      ]),
      "Work-map lanes explain that rails are semantic workspace categories with centered row dots.",
    ),
    visualAuditCheck(
      "selected-details",
      "Selected details panel",
      includesAll(moduleSource, [
        "dn-selected-panel",
        "Selected item",
        "Summary",
        "Actions",
        "Evidence",
        "Diagnostics",
      ]),
      "Selected detail sections are available above the work map.",
    ),
    visualAuditCheck(
      "action-buttons",
      "Provider and chat actions",
      includesAll(moduleSource, [
        "providerIcon",
        "externalLinkIcon",
        "target=\"_blank\"",
        "rel=\"noopener noreferrer\"",
        "Start chat",
        "Resume chat",
      ]),
      "Provider links and chat actions expose their behavior.",
    ),
    visualAuditCheck(
      "plugin-cards",
      "Plugin cards",
      includesAll(moduleSource, [
        "renderPlugins",
        "dn-plugin-card",
        "dn-plugin-pills",
        "Extensions",
        "Curated plugin catalogue entries copy a refresh command",
        "data-copy-text",
      ]),
      "Configured and local plugins have their own compact cockpit section.",
    ),
    visualAuditCheck(
      "tracked-work",
      "Tracked work cards",
      includesAll(moduleSource, [
        "renderTrackedWork",
        "dn-tracked-card",
        "Issues and Work Items",
        "Tracked work",
      ]),
      "Provider and local work items have a compact cockpit section.",
    ),
    visualAuditCheck(
      "neutral-surfaces",
      "Neutral dashboard surfaces",
      includesAll(moduleSource, [
        "body { margin: 0; min-width: 320px; color: var(--dn-text); background: var(--dn-bg); }",
        ".dn-header { position: relative; z-index: 2;",
        "background: var(--dn-surface); box-shadow: var(--dn-shadow);",
        ".dn-signal { --dn-signal-accent: var(--dn-neutral);",
        "background: var(--dn-surface); text-align: left;",
        ".dn-workspace-card { --dn-workspace-accent: var(--dn-neutral);",
        "background: var(--dn-surface); text-align: left;",
        ".dn-host-action-card { --dn-project-accent: var(--dn-warn);",
        "background: var(--dn-surface); text-align: left;",
      ]) && includesNone(moduleSource, [
        "var(--dn-surface-muted) 80%, var(--dn-project-accent) 20%",
        "var(--dn-surface-muted) 82%, var(--dn-workspace-accent) 18%",
        "var(--dn-surface) 80%, var(--dn-signal-accent) 20%",
      ]),
      "Repeated cards use neutral light/dark surfaces while keeping color in borders.",
    ),
    visualAuditCheck(
      "responsive-layout",
      "Responsive layout",
      includesAll(moduleSource, [
        "@media (max-width: 1120px)",
        "@media (max-width: 680px)",
        ".dn-signals { grid-template-columns: 1fr; }",
        ".dn-history-detail { display: none; }",
      ]),
      "Desktop and narrow viewport breakpoints are defined.",
    ),
  ];
  return {
    ok: checks.every((check) => check.status === "passed"),
    checks,
    evidence: [
      `${signalAccents.length} signal accent colors`,
      `${branchAccents.length} branch accent colors`,
      `${checks.length} static visual checks`,
    ],
    limitations: [
      "Pixel screenshots still require a browser renderer and human review.",
    ],
  };
}

function visualAuditCheck(
  id: string,
  label: string,
  passed: boolean,
  detail: string,
): NexusDashboardVisualAuditCheck {
  return {
    id,
    label,
    status: passed ? "passed" : "failed",
    detail,
  };
}

function includesAll(source: string, snippets: string[]): boolean {
  return snippets.every((snippet) => source.includes(snippet));
}

function includesNone(source: string, snippets: string[]): boolean {
  return snippets.every((snippet) => !source.includes(snippet));
}

function uniqueMatches(source: string, pattern: RegExp): string[] {
  const matches = [...source.matchAll(pattern)]
    .map((match) => match[1]?.toLowerCase())
    .filter((match): match is string => Boolean(match));
  return [...new Set(matches)];
}
