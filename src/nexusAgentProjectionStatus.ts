import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  resolveNexusProjectAgentMcpTargets,
  type MaterializedNexusAgentMcpTarget,
} from "./nexusAgentMcpConfig.js";
import {
  activeNexusProjectMcpAgentTargets,
  activeNexusProjectSkillAgentTargets,
  normalizeNexusProjectAgentTargets,
  type NexusProjectAgentMcpTarget,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import { resolveNexusCommandPath } from "./nexusCommandPath.js";
import {
  nexusSkillManifestFileName,
  type NexusProjectSkillAgentTarget,
  type NexusSkillSourceControl,
} from "./nexusSkills.js";

export type NexusAgentProjectionKind = "mcp" | "skills";

export type NexusAgentProjectionState =
  | "expected-present"
  | "expected-missing"
  | "present-stale-generated"
  | "present-manual"
  | "unsupported-provider"
  | "locally-selected-but-not-allowed";

export interface NexusAgentProjectionPathStatus {
  kind: NexusAgentProjectionKind;
  provider: string;
  agent: string;
  path: string;
  state: NexusAgentProjectionState;
  cleanupSafe: boolean;
  sourceControl: NexusSkillSourceControl | "manual" | null;
  reason: string;
}

export interface NexusAgentProjectionTargetStatus {
  provider: string;
  source: "explicit" | "legacy" | "default" | "disabled";
  mcp: {
    enabled: boolean;
    path: string | null;
    state: NexusAgentProjectionState | null;
  };
  skills: {
    enabled: boolean;
    path: string | null;
    state: NexusAgentProjectionState | null;
  };
  setupNotes: string[];
}

export interface NexusAgentProjectionPluginCapabilityStatus {
  pluginId: string;
  capabilityId: string;
  kind: "projected_skill" | "mcp_server";
  targetProviders: string[];
}

export interface NexusAgentProjectionPolicyDiagnostic {
  provider: string;
  state: Extract<
    NexusAgentProjectionState,
    "unsupported-provider" | "locally-selected-but-not-allowed"
  >;
  source: string;
  reason: string;
}

export interface NexusProjectAgentProjectionStatus {
  explicit: boolean;
  activeProviders: string[];
  recommendations: string[];
  targets: NexusAgentProjectionTargetStatus[];
  expectedMcpConfigFiles: NexusAgentProjectionPathStatus[];
  expectedSkillDirectories: NexusAgentProjectionPathStatus[];
  selectedPluginCapabilities: NexusAgentProjectionPluginCapabilityStatus[];
  staleGeneratedProviderDirectories: NexusAgentProjectionPathStatus[];
  manualProviderDirectories: NexusAgentProjectionPathStatus[];
  unsupportedTargets: NexusAgentProjectionPolicyDiagnostic[];
  locallySelectedButNotAllowed: NexusAgentProjectionPolicyDiagnostic[];
  summary: string;
}

interface ProjectionCandidate {
  kind: NexusAgentProjectionKind;
  provider: string;
  agent: string;
  relativePath: string;
  sourceControl: NexusSkillSourceControl | "manual" | null;
}

const knownGeneratedProviders = new Set(["codex", "claude", "opencode"]);

export function buildNexusProjectAgentProjectionStatus(options: {
  projectRoot: string;
  projectConfig: Pick<
    NexusProjectConfig,
    "agentTargets" | "mcp" | "skills" | "plugins"
  >;
}): NexusProjectAgentProjectionStatus {
  const projectRoot = path.resolve(options.projectRoot);
  const normalized = normalizeNexusProjectAgentTargets(options.projectConfig);
  const activeProviders = normalized.targets.map((target) => target.provider);
  const activeProviderSet = new Set(activeProviders);
  const mcpTargets = options.projectConfig.mcp?.enabled === false
    ? []
    : resolveNexusProjectAgentMcpTargets({
        projectRoot,
        mcpConfig: options.projectConfig.mcp,
        agentTargets: activeNexusProjectMcpAgentTargets(options.projectConfig),
      });
  const skillTargets = activeNexusProjectSkillAgentTargets(
    options.projectConfig,
  );
  const expectedMcpConfigFiles = mcpTargets.map((target) =>
    expectedMcpProjection(projectRoot, target),
  );
  const expectedSkillDirectories = skillTargets.map((target) =>
    expectedSkillProjection(projectRoot, target, options.projectConfig),
  );
  const expectedPathKeys = new Set(
    [...expectedMcpConfigFiles, ...expectedSkillDirectories].map(pathKey),
  );
  const unexpectedPresent = candidateProviderProjections(options.projectConfig)
    .filter((candidate) => !expectedPathKeys.has(candidateKey(candidate)))
    .filter((candidate) =>
      fs.existsSync(path.join(projectRoot, candidate.relativePath)),
    )
    .map((candidate) => classifyUnexpectedProjection(projectRoot, candidate));
  const staleGeneratedProviderDirectories = unexpectedPresent.filter(
    (projection) => projection.state === "present-stale-generated",
  );
  const manualProviderDirectories = unexpectedPresent.filter(
    (projection) => projection.state === "present-manual",
  );
  const unsupportedTargets = normalized.targets.flatMap((target) =>
    supportedProvider(target.provider)
      ? []
      : [{
          provider: target.provider,
          state: "unsupported-provider" as const,
          source: target.compatibilitySource,
          reason:
            `Provider ${target.provider} has no built-in generated projection adapter; treat it as manual setup unless an adapter is configured.`,
        }],
  );
  const locallySelectedButNotAllowed = normalized.explicit
    ? legacyTargetsOutsideActivePolicy(options.projectConfig, activeProviderSet)
    : [];
  const targets = normalized.targets.map((target) => {
    const mcpPath = expectedMcpConfigFiles.find(
      (projection) => projection.provider === target.provider,
    );
    const skillPath = expectedSkillDirectories.find(
      (projection) => projection.provider === target.provider,
    );
    return {
      provider: target.provider,
      source: target.mcp.source !== "disabled" ? target.mcp.source : target.skills.source,
      mcp: {
        enabled: target.mcp.enabled,
        path: mcpPath?.path ?? null,
        state: mcpPath?.state ?? null,
      },
      skills: {
        enabled: target.skills.enabled,
        path: skillPath?.path ?? null,
        state: skillPath?.state ?? null,
      },
      setupNotes: [...target.setupNotes],
    };
  });
  const selectedPluginCapabilities = selectedPluginCapabilitiesForActiveProviders(
    options.projectConfig,
    activeProviderSet,
  );

  return {
    explicit: normalized.explicit,
    activeProviders,
    recommendations: [...normalized.recommendations],
    targets,
    expectedMcpConfigFiles,
    expectedSkillDirectories,
    selectedPluginCapabilities,
    staleGeneratedProviderDirectories,
    manualProviderDirectories,
    unsupportedTargets,
    locallySelectedButNotAllowed,
    summary: projectionSummary({
      activeProviders,
      expectedCount: expectedMcpConfigFiles.length + expectedSkillDirectories.length,
      missingCount:
        expectedMcpConfigFiles.filter(isMissing).length +
        expectedSkillDirectories.filter(isMissing).length,
      staleGeneratedCount: staleGeneratedProviderDirectories.length,
      manualCount: manualProviderDirectories.length,
      unsupportedCount: unsupportedTargets.length,
      locallyNotAllowedCount: locallySelectedButNotAllowed.length,
      recommendationCount: normalized.recommendations.length,
    }),
  };
}

function expectedMcpProjection(
  projectRoot: string,
  target: MaterializedNexusAgentMcpTarget,
): NexusAgentProjectionPathStatus {
  const state = fs.existsSync(target.configPath)
    ? "expected-present"
    : "expected-missing";
  return {
    kind: "mcp",
    provider: target.provider,
    agent: target.agent,
    path: stableRelativePath(target.configPathRelative),
    state,
    cleanupSafe: false,
    sourceControl: target.sourceControl,
    reason:
      state === "expected-present"
        ? `${target.provider} MCP config is expected and present.`
        : `${target.provider} MCP config is expected but missing.`,
  };
}

function expectedSkillProjection(
  projectRoot: string,
  target: NexusProjectSkillAgentTarget,
  config: Pick<NexusProjectConfig, "skills">,
): NexusAgentProjectionPathStatus {
  const relativePath = agentSkillDirectory(target);
  const resolvedPath = path.join(projectRoot, relativePath);
  const provider = normalizedProvider(target.agent);
  const state = fs.existsSync(resolvedPath)
    ? "expected-present"
    : "expected-missing";
  return {
    kind: "skills",
    provider,
    agent: target.agent,
    path: stableRelativePath(relativePath),
    state,
    cleanupSafe: false,
    sourceControl: target.sourceControl ?? config.skills?.sourceControl ?? "support",
    reason:
      state === "expected-present"
        ? `${provider} skill projection directory is expected and present.`
        : `${provider} skill projection directory is expected but missing.`,
  };
}

function candidateProviderProjections(
  config: Pick<NexusProjectConfig, "agentTargets" | "mcp" | "skills">,
): ProjectionCandidate[] {
  const candidates: ProjectionCandidate[] = [
    skillCandidate("codex", "codex", path.join(".agents", "skills"), "support"),
    skillCandidate("claude", "claude", path.join(".claude", "skills"), "support"),
    skillCandidate("opencode", "opencode", path.join(".opencode", "skills"), "support"),
    mcpCandidate("codex", "codex", path.join(".codex", "config.toml"), "support"),
    mcpCandidate("claude", "claude", ".mcp.json", "support"),
    mcpCandidate("opencode", "opencode", "opencode.json", "support"),
  ];

  for (const target of config.mcp?.agentTargets ?? []) {
    candidates.push(mcpCandidate(
      normalizedProvider(target.provider ?? target.agent),
      target.agent,
      target.configPath ?? defaultMcpPath(target.provider ?? target.agent),
      target.sourceControl ?? config.mcp?.sourceControl ?? "support",
    ));
  }
  for (const target of config.skills?.agentTargets ?? []) {
    candidates.push(skillCandidate(
      normalizedProvider(target.agent),
      target.agent,
      target.directory ?? defaultSkillDirectory(target.agent),
      target.sourceControl ?? config.skills?.sourceControl ?? "support",
    ));
  }

  return uniqueCandidates(candidates);
}

function classifyUnexpectedProjection(
  projectRoot: string,
  candidate: ProjectionCandidate,
): NexusAgentProjectionPathStatus {
  const sourceControlled = isSourceControlled(projectRoot, candidate.relativePath);
  const ignoredByGit = !sourceControlled &&
    isIgnoredByGit(projectRoot, candidate.relativePath);
  const hasGeneratedSkillManifest = !sourceControlled &&
    containsGeneratedSkillManifest(path.join(projectRoot, candidate.relativePath));
  if (ignoredByGit || hasGeneratedSkillManifest) {
    return {
      kind: candidate.kind,
      provider: candidate.provider,
      agent: candidate.agent,
      path: stableRelativePath(candidate.relativePath),
      state: "present-stale-generated",
      cleanupSafe: true,
      sourceControl: candidate.sourceControl,
      reason:
        `${candidate.provider} ${candidate.kind} projection is present but not selected; ` +
        `${generatedProjectionEvidence({ ignoredByGit, hasGeneratedSkillManifest })} makes cleanup review safe.`,
    };
  }

  return {
    kind: candidate.kind,
    provider: candidate.provider,
    agent: candidate.agent,
    path: stableRelativePath(candidate.relativePath),
    state: "present-manual",
    cleanupSafe: false,
    sourceControl: sourceControlled ? "source" : "manual",
    reason:
      `${candidate.provider} ${candidate.kind} path is present but not selected; it is not classified as generated cleanup-safe support.`,
  };
}

function generatedProjectionEvidence(options: {
  ignoredByGit: boolean;
  hasGeneratedSkillManifest: boolean;
}): string {
  return [
    options.ignoredByGit ? "Git ignore evidence" : null,
    options.hasGeneratedSkillManifest ? "DevNexus skill manifest evidence" : null,
  ].filter(Boolean).join(" and ");
}

function legacyTargetsOutsideActivePolicy(
  config: Pick<NexusProjectConfig, "mcp" | "skills">,
  activeProviderSet: Set<string>,
): NexusAgentProjectionPolicyDiagnostic[] {
  const sourcesByProvider = new Map<string, Set<string>>();
  const addSource = (provider: string, source: string) => {
    const sources = sourcesByProvider.get(provider) ?? new Set<string>();
    sources.add(source);
    sourcesByProvider.set(provider, sources);
  };
  for (const target of config.mcp?.agentTargets ?? []) {
    const provider = normalizedProvider(target.provider ?? target.agent);
    if (target.enabled === false || activeProviderSet.has(provider)) {
      continue;
    }
    addSource(provider, "mcp.agentTargets");
  }
  for (const target of config.skills?.agentTargets ?? []) {
    const provider = normalizedProvider(target.agent);
    if (target.enabled === false || activeProviderSet.has(provider)) {
      continue;
    }
    addSource(provider, "skills.agentTargets");
  }
  return [...sourcesByProvider.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, sources]) => ({
      provider,
      state: "locally-selected-but-not-allowed" as const,
      source: [...sources].sort((left, right) => left.localeCompare(right)).join(", "),
      reason:
        `Legacy target ${provider} is configured outside config.agentTargets.active.`,
    }));
}

function selectedPluginCapabilitiesForActiveProviders(
  config: Pick<NexusProjectConfig, "plugins">,
  activeProviderSet: Set<string>,
): NexusAgentProjectionPluginCapabilityStatus[] {
  const result: NexusAgentProjectionPluginCapabilityStatus[] = [];
  for (const plugin of config.plugins ?? []) {
    if (plugin.enabled === false) {
      continue;
    }
    for (const capability of plugin.capabilities) {
      if (capability.kind !== "projected_skill" && capability.kind !== "mcp_server") {
        continue;
      }
      const targetProviders = selectedCapabilityProviders(
        capability.targetAgents ?? [],
        activeProviderSet,
      );
      if (targetProviders.length === 0) {
        continue;
      }
      result.push({
        pluginId: plugin.id,
        capabilityId: capability.id,
        kind: capability.kind,
        targetProviders,
      });
    }
  }
  return result;
}

function selectedCapabilityProviders(
  capabilityTargets: readonly string[],
  activeProviderSet: Set<string>,
): string[] {
  const active = [...activeProviderSet].sort((left, right) => left.localeCompare(right));
  if (capabilityTargets.length === 0) {
    return active;
  }
  const allowed = new Set(capabilityTargets.map(normalizedProvider));
  return active.filter((provider) => allowed.has(provider));
}

function projectionSummary(options: {
  activeProviders: string[];
  expectedCount: number;
  missingCount: number;
  staleGeneratedCount: number;
  manualCount: number;
  unsupportedCount: number;
  locallyNotAllowedCount: number;
  recommendationCount: number;
}): string {
  const active = options.activeProviders.length > 0
    ? options.activeProviders.join(",")
    : "none";
  return [
    `active=${active}`,
    `expected=${options.expectedCount}`,
    `missing=${options.missingCount}`,
    `staleGenerated=${options.staleGeneratedCount}`,
    `manual=${options.manualCount}`,
    `unsupported=${options.unsupportedCount}`,
    `locallyNotAllowed=${options.locallyNotAllowedCount}`,
    `recommendations=${options.recommendationCount}`,
  ].join("; ");
}

function isMissing(projection: NexusAgentProjectionPathStatus): boolean {
  return projection.state === "expected-missing";
}

function supportedProvider(provider: string): boolean {
  return knownGeneratedProviders.has(provider);
}

function mcpCandidate(
  provider: string,
  agent: string,
  relativePath: string,
  sourceControl: NexusSkillSourceControl | "manual" | null,
): ProjectionCandidate {
  return {
    kind: "mcp",
    provider: normalizedProvider(provider),
    agent,
    relativePath: stableRelativePath(relativePath),
    sourceControl,
  };
}

function skillCandidate(
  provider: string,
  agent: string,
  relativePath: string,
  sourceControl: NexusSkillSourceControl | "manual" | null,
): ProjectionCandidate {
  return {
    kind: "skills",
    provider: normalizedProvider(provider),
    agent,
    relativePath: stableRelativePath(relativePath),
    sourceControl,
  };
}

function uniqueCandidates(candidates: ProjectionCandidate[]): ProjectionCandidate[] {
  const byKey = new Map<string, ProjectionCandidate>();
  for (const candidate of candidates) {
    byKey.set(candidateKey(candidate), candidate);
  }
  return [...byKey.values()];
}

function candidateKey(candidate: ProjectionCandidate): string {
  return `${candidate.kind}:${stableRelativePath(candidate.relativePath)}`;
}

function pathKey(projection: NexusAgentProjectionPathStatus): string {
  return `${projection.kind}:${stableRelativePath(projection.path)}`;
}

function agentSkillDirectory(target: NexusProjectSkillAgentTarget): string {
  return target.directory ?? defaultSkillDirectory(target.agent);
}

function defaultSkillDirectory(agent: string): string {
  if (agent === "codex") {
    return path.join(".agents", "skills");
  }
  if (agent === "claude") {
    return path.join(".claude", "skills");
  }
  return path.join(`.${safePathPart(agent)}`, "skills");
}

function defaultMcpPath(agentOrProvider: string): string {
  const provider = normalizedProvider(agentOrProvider);
  if (provider === "codex") {
    return path.join(".codex", "config.toml");
  }
  if (provider === "claude") {
    return ".mcp.json";
  }
  if (provider === "opencode") {
    return "opencode.json";
  }
  return path.join(`.${safePathPart(agentOrProvider)}`, "mcp.md");
}

function normalizedProvider(value: string): string {
  return value.trim().toLowerCase();
}

function stableRelativePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.?\//u, "");
}

function safePathPart(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]/gu, "-").replace(/-+/gu, "-");
  return safe.length > 0 ? safe : "agent";
}

function isSourceControlled(projectRoot: string, relativePath: string): boolean {
  if (!fs.existsSync(path.join(projectRoot, ".git"))) {
    return false;
  }
  try {
    childProcess.execFileSync(
      resolveNexusCommandPath("git"),
      ["-C", projectRoot, "ls-files", "--error-unmatch", "--", relativePath],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    return true;
  } catch {
    return false;
  }
}

function isIgnoredByGit(projectRoot: string, relativePath: string): boolean {
  if (!fs.existsSync(path.join(projectRoot, ".git"))) {
    return false;
  }
  try {
    childProcess.execFileSync(
      resolveNexusCommandPath("git"),
      ["-C", projectRoot, "check-ignore", "-q", "--", relativePath],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    return true;
  } catch {
    return false;
  }
}

function containsGeneratedSkillManifest(root: string): boolean {
  if (!fs.existsSync(root)) {
    return false;
  }
  const stat = fs.statSync(root);
  if (stat.isFile()) {
    return path.basename(root) === nexusSkillManifestFileName;
  }
  if (!stat.isDirectory()) {
    return false;
  }
  return directoryContainsFile(root, nexusSkillManifestFileName, 3);
}

function directoryContainsFile(
  directory: string,
  fileName: string,
  depth: number,
): boolean {
  if (depth < 0) {
    return false;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === fileName) {
      return true;
    }
    if (entry.isDirectory() && directoryContainsFile(path.join(directory, entry.name), fileName, depth - 1)) {
      return true;
    }
  }
  return false;
}
