import fs from "node:fs";
import path from "node:path";
import {
  buildNexusProjectAgentProjectionStatus,
} from "./nexusAgentProjectionStatus.js";
import {
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  activeNexusProjectAgentProviders,
  loadProjectConfig,
  projectConfigPath,
  projectWorktreesRootPath,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  resolveProjectComponents,
  type ResolvedNexusProjectComponent,
} from "./nexusProjectLifecycle.js";
import {
  buildNexusSetupCheck,
  nexusSetupStatePath,
  type NexusSetupCheckResult,
  type NexusSetupPlatform,
} from "./nexusSetupAssistant.js";
import {
  resolveLocalWorkTrackingStorePath,
} from "./workTrackingLocalProvider.js";

export type NexusProjectSetupReadinessVerdict =
  | "ready"
  | "ready_with_warnings"
  | "blocked";

export type NexusProjectSetupReadinessCheckStatus =
  | "passed"
  | "warning"
  | "blocked";

export interface NexusProjectSetupReadinessCheck {
  id: string;
  title: string;
  status: NexusProjectSetupReadinessCheckStatus;
  summary: string;
  nextAction: string | null;
}

export interface NexusProjectSetupReadinessAction {
  checkId: string;
  status: Exclude<NexusProjectSetupReadinessCheckStatus, "passed">;
  action: string;
}

export interface NexusProjectSetupReadinessReport {
  projectRoot: string;
  verdict: NexusProjectSetupReadinessVerdict;
  checks: NexusProjectSetupReadinessCheck[];
  actions: NexusProjectSetupReadinessAction[];
  summary: string;
}

export function buildNexusProjectSetupReadinessReport(options: {
  projectRoot: string;
  platform?: NexusSetupPlatform | string;
}): NexusProjectSetupReadinessReport {
  const projectRoot = path.resolve(options.projectRoot);
  const checks: NexusProjectSetupReadinessCheck[] = [];
  let projectConfig: NexusProjectConfig | null = null;

  try {
    projectConfig = loadProjectConfig(projectRoot);
    checks.push({
      id: "project-config",
      title: "Workspace config",
      status: "passed",
      summary: `Loaded ${projectConfigPath(projectRoot)}.`,
      nextAction: null,
    });
  } catch (error) {
    checks.push({
      id: "project-config",
      title: "Workspace config",
      status: "blocked",
      summary: error instanceof Error ? error.message : String(error),
      nextAction:
        "Run workspace setup from a DevNexus workspace root or restore dev-nexus.project.json.",
    });
  }

  checks.push(supportFileCheck({
    id: "agents-md",
    title: "AGENTS.md",
    pathName: path.join(projectRoot, "AGENTS.md"),
    missingStatus: "blocked",
    passedSummary: "Agent instructions are present.",
    missingSummary: "AGENTS.md is missing from the workspace root.",
    nextAction: "Add AGENTS.md with project operating boundaries and handoff rules.",
  }));

  if (projectConfig) {
    checks.push(...componentSourceChecks(projectRoot, projectConfig));
    checks.push(worktreesRootCheck(projectRoot, projectConfig));
    checks.push(...localTrackerStoreChecks(projectRoot, projectConfig));
    checks.push(...agentProjectionChecks(projectRoot, projectConfig));
    checks.push(activeAgentNextStepsCheck(projectRoot, options.platform));
    checks.push(authInventoryCheck(projectRoot, projectConfig));
    checks.push(hostingHandoffCheck(projectRoot, projectConfig));
  }

  const verdict = aggregateNexusProjectSetupReadinessVerdict(checks);
  const actions = checks.flatMap((check) =>
    check.status === "passed" || !check.nextAction
      ? []
      : [{ checkId: check.id, status: check.status, action: check.nextAction }],
  );

  return {
    projectRoot,
    verdict,
    checks,
    actions,
    summary: readinessSummary(verdict, checks, actions),
  };
}

export function aggregateNexusProjectSetupReadinessVerdict(
  checks: readonly Pick<NexusProjectSetupReadinessCheck, "status">[],
): NexusProjectSetupReadinessVerdict {
  if (checks.some((check) => check.status === "blocked")) {
    return "blocked";
  }
  if (checks.some((check) => check.status === "warning")) {
    return "ready_with_warnings";
  }
  return "ready";
}

function componentSourceChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusProjectSetupReadinessCheck[] {
  let components: ResolvedNexusProjectComponent[];
  try {
    components = resolveProjectComponents(projectRoot, projectConfig);
  } catch (error) {
    return [{
      id: "component-source-roots",
      title: "Component source roots",
      status: "blocked",
      summary: error instanceof Error ? error.message : String(error),
      nextAction: "Fix workspace component configuration before assigning component work.",
    }];
  }

  if (components.length === 0) {
    return [{
      id: "component-source-roots",
      title: "Component source roots",
      status: "blocked",
      summary: "No workspace components are configured.",
      nextAction: "Add at least one component with a reachable source root.",
    }];
  }

  return components.map((component) => ({
    id: `component-${checkIdPart(component.id)}-source-root`,
    title: `${component.name} source root`,
    status: component.sourceRootExists ? "passed" : "blocked",
    summary: component.sourceRootExists
      ? `Component source root exists: ${component.sourceRoot}.`
      : `Component source root is missing: ${component.sourceRoot}.`,
    nextAction: component.sourceRootExists
      ? null
      : component.remoteUrl
        ? `Clone or restore ${component.remoteUrl} at ${component.sourceRoot}.`
        : `Create or configure component source root ${component.sourceRoot}.`,
  }));
}

function worktreesRootCheck(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusProjectSetupReadinessCheck {
  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);
  const exists = isDirectory(worktreesRoot);
  return {
    id: "worktrees-root",
    title: "Worktrees root",
    status: exists ? "passed" : "warning",
    summary: exists
      ? `Generated worktrees root exists: ${worktreesRoot}.`
      : `Generated worktrees root is missing: ${worktreesRoot}.`,
    nextAction: exists
      ? null
      : `Create ${worktreesRoot} before preparing parallel worktrees.`,
  };
}

function localTrackerStoreChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusProjectSetupReadinessCheck[] {
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const stores = new Map<string, string[]>();
  for (const component of components) {
    for (const tracker of component.workTrackers) {
      if (tracker.enabled && tracker.workTracking.provider === "local") {
        const storePath = resolveLocalWorkTrackingStorePath(
          projectRoot,
          tracker.workTracking,
        );
        stores.set(storePath, [...(stores.get(storePath) ?? []), component.id]);
      }
    }
  }
  if (stores.size === 0) {
    return [{
      id: "local-tracker-stores",
      title: "Local tracker stores",
      status: "passed",
      summary: "No enabled local work tracker stores are configured.",
      nextAction: null,
    }];
  }

  return [...stores.entries()].map(([storePath, componentIds]) => {
    const exists = fs.existsSync(storePath);
    return {
      id: `local-tracker-store-${checkIdPart(componentIds.join("-"))}`,
      title: `Local tracker store (${componentIds.join(", ")})`,
      status: exists ? "passed" : "warning",
      summary: exists
        ? `Local tracker store exists: ${storePath}.`
        : `Local tracker store has not been created yet: ${storePath}.`,
      nextAction: exists
        ? null
        : `Create a local work item or initialize the local tracker store at ${storePath}.`,
    };
  });
}

function agentProjectionChecks(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusProjectSetupReadinessCheck[] {
  const projection = buildNexusProjectAgentProjectionStatus({
    projectRoot,
    projectConfig,
  });
  const mcpMissing = projection.expectedMcpConfigFiles.filter(
    (target) => target.state === "expected-missing",
  );
  const skillsMissing = projection.expectedSkillDirectories.filter(
    (target) => target.state === "expected-missing",
  );
  const diagnostics = [
    ...projection.unsupportedTargets,
    ...projection.locallySelectedButNotAllowed,
  ];

  return [
    {
      id: "mcp-config-presence",
      title: "MCP config presence",
      status: mcpMissing.length === 0 ? "passed" : "warning",
      summary: mcpMissing.length === 0
        ? "Expected active-agent MCP config files are present."
        : `Missing active-agent MCP config file(s): ${mcpMissing.map((target) => target.path).join(", ")}.`,
      nextAction: mcpMissing.length === 0
        ? null
        : "Run dev-nexus workspace mcp refresh <workspace-root> for active agent targets.",
    },
    {
      id: "projected-skills-presence",
      title: "Projected skills presence",
      status: skillsMissing.length === 0 ? "passed" : "warning",
      summary: skillsMissing.length === 0
        ? "Expected active-agent skill projection directories are present."
        : `Missing active-agent skill projection directories: ${skillsMissing.map((target) => target.path).join(", ")}.`,
      nextAction: skillsMissing.length === 0
        ? null
        : "Refresh workspace support projection so active agent skills are available.",
    },
    {
      id: "agent-target-policy",
      title: "Agent target policy",
      status: diagnostics.length === 0 ? "passed" : "warning",
      summary: diagnostics.length === 0
        ? `Active agent target policy is usable: ${activeNexusProjectAgentProviders(projectConfig).join(", ") || "none"}.`
        : diagnostics.map((diagnostic) => diagnostic.reason).join(" "),
      nextAction: diagnostics.length === 0
        ? null
        : "Update workspace config.agentTargets.active or remove stale legacy target selections.",
    },
  ];
}

function activeAgentNextStepsCheck(
  projectRoot: string,
  platform: NexusSetupPlatform | string | undefined,
): NexusProjectSetupReadinessCheck {
  const setupCheck = buildNexusSetupCheck({
    projectRoot,
    flowId: "join-existing-project",
    ...(platform ? { platform } : {}),
  });
  const agentSession = setupCheck.checks.find(
    (check) => check.id === "agent-project-session",
  );
  if (!agentSession) {
    return {
      id: "active-agent-next-steps",
      title: "Active agent next steps",
      status: "passed",
      summary: "No active agent workspace/session step is required by current setup policy.",
      nextAction: null,
    };
  }

  return setupCheckResultToReadinessCheck(
    "active-agent-next-steps",
    "Active agent next steps",
    agentSession,
  );
}

function authInventoryCheck(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusProjectSetupReadinessCheck {
  const referencedProfiles = collectAuthProfileReferences(projectConfig);
  if (referencedProfiles.length === 0) {
    return {
      id: "auth-inventory",
      title: "Auth inventory",
      status: "passed",
      summary: "Workspace config does not reference host-local auth profiles.",
      nextAction: null,
    };
  }

  const homePath = projectConfig.home;
  if (!homePath) {
    return {
      id: "auth-inventory",
      title: "Auth inventory",
      status: "warning",
      summary:
        `Workspace references auth profile(s) ${referencedProfiles.join(", ")}, but workspace config.home is not set.`,
      nextAction:
        "Set workspace config.home or verify these auth profiles in the host-local DevNexus home before provider or publication operations.",
    };
  }

  try {
    const homeConfig = loadNexusHomeConfigFile(
      path.isAbsolute(homePath) ? homePath : path.resolve(projectRoot, homePath),
      validateNexusHomeConfigBase,
    );
    const configured = new Set((homeConfig.authProfiles ?? []).map((profile) => profile.id));
    const missing = referencedProfiles.filter((profile) => !configured.has(profile));
    return {
      id: "auth-inventory",
      title: "Auth inventory",
      status: missing.length === 0 ? "passed" : "warning",
      summary: missing.length === 0
        ? `Referenced auth profile(s) are present in DevNexus home: ${referencedProfiles.join(", ")}.`
        : `Referenced auth profile(s) missing from DevNexus home: ${missing.join(", ")}.`,
      nextAction: missing.length === 0
        ? null
        : "Add missing auth profile records to the host-local DevNexus home without storing raw secrets in the project.",
    };
  } catch (error) {
    return {
      id: "auth-inventory",
      title: "Auth inventory",
      status: "warning",
      summary:
        `Could not load DevNexus home auth inventory for referenced profile(s) ${referencedProfiles.join(", ")}: ${error instanceof Error ? error.message : String(error)}`,
      nextAction:
        "Initialize or repair the host-local DevNexus home before provider or publication operations.",
    };
  }
}

function hostingHandoffCheck(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusProjectSetupReadinessCheck {
  if (!projectConfig.hosting) {
    return {
      id: "hosting-handoff",
      title: "Hosting handoff",
      status: "warning",
      summary:
        "Workspace repository hosting is not configured; local readiness is possible, but provider publication handoff is manual.",
      nextAction:
        "Configure workspace hosting or record that this workspace is intentionally local-only.",
    };
  }

  const statePath = nexusSetupStatePath(projectRoot);
  const status = fs.existsSync(statePath) ? "passed" : "warning";
  return {
    id: "hosting-handoff",
    title: "Hosting handoff",
    status,
    summary: status === "passed"
      ? `Hosting is configured for ${projectConfig.hosting.namespace}/${projectConfig.hosting.repository.name}; host setup state exists.`
      : `Hosting is configured for ${projectConfig.hosting.namespace}/${projectConfig.hosting.repository.name}, but host setup state has not been recorded.`,
    nextAction: status === "passed"
      ? null
      : "Run setup checks and record completed host-local setup steps before handing work to agents.",
  };
}

function supportFileCheck(options: {
  id: string;
  title: string;
  pathName: string;
  missingStatus: NexusProjectSetupReadinessCheckStatus;
  passedSummary: string;
  missingSummary: string;
  nextAction: string;
}): NexusProjectSetupReadinessCheck {
  const exists = fs.existsSync(options.pathName) && fs.statSync(options.pathName).isFile();
  return {
    id: options.id,
    title: options.title,
    status: exists ? "passed" : options.missingStatus,
    summary: exists ? options.passedSummary : options.missingSummary,
    nextAction: exists ? null : options.nextAction,
  };
}

function setupCheckResultToReadinessCheck(
  id: string,
  title: string,
  check: NexusSetupCheckResult,
): NexusProjectSetupReadinessCheck {
  return {
    id,
    title,
    status: check.status,
    summary: check.summary,
    nextAction: check.nextAction,
  };
}

function collectAuthProfileReferences(projectConfig: NexusProjectConfig): string[] {
  const references = new Set<string>();
  const add = (value: string | undefined) => {
    if (value) {
      references.add(value);
    }
  };

  add(projectConfig.hosting?.authProfile);
  add(projectConfig.hosting?.provisioning.providerMutationAuthProfile);
  for (const remote of projectConfig.hosting?.remotes ?? []) {
    add(remote.authProfile);
  }
  for (const access of projectConfig.hosting?.access ?? []) {
    add(access.authProfile);
  }
  return [...references].sort((left, right) => left.localeCompare(right));
}

function readinessSummary(
  verdict: NexusProjectSetupReadinessVerdict,
  checks: readonly NexusProjectSetupReadinessCheck[],
  actions: readonly NexusProjectSetupReadinessAction[],
): string {
  const blocked = checks.filter((check) => check.status === "blocked").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  return `Setup readiness verdict is ${verdict}: ${blocked} blocked, ${warnings} warning, ${actions.length} action(s).`;
}

function isDirectory(directoryPath: string): boolean {
  return fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
}

function checkIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "") || "default";
}
