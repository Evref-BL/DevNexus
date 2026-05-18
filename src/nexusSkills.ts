import fs from "node:fs";
import path from "node:path";

export const nexusSkillSupportDirectoryName = ".dev-nexus";
export const nexusSkillsDirectoryName = "skills";
export const nexusSkillManifestFileName = "dev-nexus.skill.json";
export const nexusSkillMarkdownFileName = "SKILL.md";

export type NexusSkillMaterializationMode = "copy" | "symlink" | "reference";
export type NexusSkillSourceControl = "support" | "source";
export type NexusSkillAgentId = string;

export interface NexusProjectSkillAgentTarget {
  agent: NexusSkillAgentId;
  enabled?: boolean;
  directory?: string;
  sourceControl?: NexusSkillSourceControl;
}

export interface NexusSkillSource {
  type: "curated" | "git" | "url" | "local";
  uri?: string;
  commit?: string;
  checksum?: string;
}

export interface NexusSkillManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  license: string;
  source: NexusSkillSource;
  supportedAgents: string[];
  materialization: NexusSkillMaterializationMode;
  sourceControl: NexusSkillSourceControl;
}

export interface NexusSkillDefinition {
  manifest: NexusSkillManifest;
  files: Record<string, string>;
  sourcePath?: string;
}

export interface NexusProjectSkillSelection {
  id: string;
  enabled?: boolean;
  version?: string;
  materialization?: NexusSkillMaterializationMode;
  sourceControl?: NexusSkillSourceControl;
}

export interface NexusProjectSkillsConfig {
  defaultCorePack?: boolean;
  materialization?: NexusSkillMaterializationMode;
  sourceControl?: NexusSkillSourceControl;
  agentTargets?: NexusProjectSkillAgentTarget[];
  items?: NexusProjectSkillSelection[];
}

export interface MaterializeNexusProjectSkillsOptions {
  projectRoot: string;
  skillsConfig?: NexusProjectSkillsConfig;
  skillDefinitions?: NexusSkillDefinition[];
  excludeFromGit?: boolean;
}

export interface MaterializedNexusSkill {
  id: string;
  name: string;
  version: string;
  materialization: NexusSkillMaterializationMode;
  sourceControl: NexusSkillSourceControl;
  skillRoot: string;
  manifestPath: string;
  skillPath: string | null;
}

export interface MaterializedNexusAgentSkill {
  id: string;
  name: string;
  version: string;
  materialization: NexusSkillMaterializationMode;
  skillRoot: string;
  skillPath: string | null;
}

export interface MaterializedNexusAgentSkillTarget {
  agent: NexusSkillAgentId;
  skillsDirectory: string;
  sourceControl: NexusSkillSourceControl;
  installed: MaterializedNexusAgentSkill[];
}

export interface MaterializeNexusProjectSkillsResult {
  skillsDirectory: string;
  installed: MaterializedNexusSkill[];
  agentTargets: MaterializedNexusAgentSkillTarget[];
  gitExcludePath: string | null;
  gitExcludeEntries: string[];
}

export type NexusProjectSkillState =
  | "installed"
  | "missing"
  | "stale"
  | "unexpected"
  | "invalid";

export interface NexusProjectSkillStatus {
  id: string;
  state: NexusProjectSkillState;
  expected: boolean;
  installed: boolean;
  name: string | null;
  expectedVersion: string | null;
  installedVersion: string | null;
  materialization: NexusSkillMaterializationMode | null;
  sourceControl: NexusSkillSourceControl | null;
  skillRoot: string;
  manifestPath: string;
  skillPath: string | null;
  reasons: string[];
}

export interface NexusProjectSkillStatusSummary {
  expected: number;
  installed: number;
  missing: number;
  stale: number;
  unexpected: number;
  invalid: number;
}

export interface InspectNexusProjectSkillsOptions {
  projectRoot: string;
  skillsConfig?: NexusProjectSkillsConfig;
  skillDefinitions?: NexusSkillDefinition[];
}

export interface InspectNexusProjectSkillsResult {
  skillsDirectory: string;
  summary: NexusProjectSkillStatusSummary;
  skills: NexusProjectSkillStatus[];
}

export interface RefreshNexusProjectSkillsOptions
  extends MaterializeNexusProjectSkillsOptions {}

export interface RefreshNexusProjectSkillsResult {
  before: InspectNexusProjectSkillsResult;
  materialized: MaterializeNexusProjectSkillsResult;
  after: InspectNexusProjectSkillsResult;
}

export class NexusSkillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusSkillError";
  }
}

function skillMarkdown(name: string, description: string, body: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}

function curatedCoreSkill(
  id: string,
  name: string,
  description: string,
  body: string,
): NexusSkillDefinition {
  return {
    manifest: {
      id,
      name,
      description,
      version: "0.1.0",
      license: "Apache-2.0",
      source: {
        type: "curated",
        uri: "dev-nexus:core",
      },
      supportedAgents: ["codex", "claude"],
      materialization: "copy",
      sourceControl: "support",
    },
    files: {
      [nexusSkillMarkdownFileName]: skillMarkdown(name, description, body),
    },
  };
}

export const defaultCoreSkillPack: readonly NexusSkillDefinition[] = [
  curatedCoreSkill(
    "dev-nexus",
    "dev-nexus",
    "DevNexus-managed project workflow for using DevNexus infrastructure to plan, triage, slice, implement, verify, publish, automate, coordinate isolated worktrees, and advance work items across components. Use when an agent is asked to work in a DevNexus project, use DevNexus, run a DevNexus workflow, advance tracker work, coordinate parallel chats or subagents, or combine DevNexus with companion skills such as to-prd, to-issues, triage, tdd, diagnose, or architecture review.",
    `
# DevNexus

Use this skill when working inside a DevNexus-managed project.

1. Read project instructions first: agent context file when set, \`AGENTS.md\` or equivalent, durable project context, plan, and target state.
2. Use DevNexus MCP or CLI surfaces for project status, component metadata, work-item services, eligible work, agent profiles, worktrees, target-cycle facts, and result contracts. Avoid ad hoc discovery when DevNexus already exposes the fact.
3. Select the right companion skill for the current mode: \`to-prd\` for Product Requirements Document (PRD) synthesis, \`to-issues\` for issue slicing, \`triage\` for vague work, \`tdd\` for Test-Driven Development (TDD), \`diagnose\` for defects, and architecture skills for boundary or refactor decisions.
4. Work through configured component work-item services. Prefer component-qualified work-item ids when a project has multiple components, and do not assume a tracker provider; use the provider configured for the owning component.
5. Before editing, inspect relevant working trees and preserve unrelated changes. Treat a shared checkout as read-mostly context unless the task is clearly read-only or already owns that checkout.
6. For mutating parallel work, prepare an isolated Git worktree before editing. Use component-scoped worktrees for component source changes, and use a project/meta worktree for DevNexus project files such as \`AGENTS.md\`, \`PLAN.md\`, \`CONTEXT.md\`, \`.dev-nexus/**\`, projected skills, target state, or dogfood docs. Prefer DevNexus worktree tools such as \`worktree_prepare\` or \`dev-nexus worktree prepare\` over hand-rolled \`git worktree\` commands.
7. Let configured setup make prepared worktrees usable. For example, JavaScript/TypeScript projects should expose reusable dependencies through a plugin \`dependency_projection\` such as \`node_modules\` -> \`node_modules\`, instead of teaching every agent to repair missing dependencies manually.
8. Choose a bounded batch with clear ownership, acceptance criteria, verification, and publication expectations. Parallelize independent work when safe: split by work item, component, worktree, or disjoint write scope; respect the configured subagent cap; keep each worker's ownership explicit.
9. Run source and Git commands from the assigned worktree. Stage only files owned by that worktree and avoid committing unrelated project-state or tracker files from another chat.
10. Record progress through DevNexus: set work-item state when starting or finishing, add concise progress or blocker comments, record target-cycle facts, and use coordination handoffs for \`working\`, \`ready\`, \`blocked\`, or \`merged\` worktree branches.
11. Before integrating parallel chat branches, use DevNexus coordination status or integration planning to check related branches, stale handoffs, unpushed commits, conflicts, and verification order.
12. Verify with focused checks first, then broader relevant checks when feasible. Publish only according to component publication policy.
13. When running under a DevNexus-launched cycle, write the configured result file with status, summary, commits, verification, publication decision, and error or blocker details before exiting.
`,
  ),
  curatedCoreSkill(
    "diagnose",
    "diagnose",
    "Systematic debugging workflow for reproducing, isolating, fixing, and verifying defects in managed projects.",
    `
# Diagnose

Use this skill when a defect, failed check, or confusing behavior needs a structured diagnosis.

1. Reproduce the failure with the smallest command or scenario available.
2. Record the observed behavior, expected behavior, and exact inputs.
3. Isolate the likely boundary by reading the owning code before editing.
4. Make the smallest behavior-changing patch that explains the reproduction.
5. Verify with the focused reproduction first, then run the nearest broader check.
6. Leave a compact note with the root cause, fix, verification, and remaining risk.
`,
  ),
  curatedCoreSkill(
    "tdd",
    "tdd",
    "Test-driven development workflow for adding behavior with focused red, green, and refactor steps.",
    `
# Test-Driven Development (TDD)

Use this skill when adding or changing behavior that can be expressed with a focused automated test.

1. Write the smallest failing test that captures the desired behavior or regression.
2. Run that focused test and confirm it fails for the expected reason.
3. Implement the smallest change that makes the focused test pass.
4. Refactor only when the green state is preserved.
5. Run the focused test again, then the nearest relevant suite.
6. Summarize the behavioral contract the test now protects.
`,
  ),
  curatedCoreSkill(
    "handoff",
    "handoff",
    "Continuation workflow for preserving decisions, verification, commits, blockers, and next actions across agent runs.",
    `
# Handoff

Use this skill when work needs to survive a context switch, automation run, or human review.

1. Identify the current objective, selected scope, and acceptance criteria.
2. Record changed files, commits, and verification commands with outcomes.
3. Separate completed decisions from open questions and blockers.
4. Note unrelated dirty worktree state without overwriting it.
5. Name the next safe action and the reason it is next.
6. Keep the handoff concise enough that another agent can act on it immediately.
`,
  ),
  curatedCoreSkill(
    "triage",
    "triage",
    "Work-item triage workflow for turning vague requests or findings into bounded, owned, verifiable next actions.",
    `
# Triage

Use this skill when a request, issue, or finding needs to become actionable work.

1. Identify the owning project component, source root, and work-item service.
2. Separate symptoms, suspected causes, acceptance criteria, and constraints.
3. Check for duplicate or related existing work before creating new items.
4. Slice work so each item has one owner, one verification path, and a clear done state.
5. Record blockers with the smallest prerequisite that can remove them.
6. Prefer updating the owning item over creating a duplicate status report.
`,
  ),
  curatedCoreSkill(
    "architecture-review",
    "architecture-review",
    "Architecture review workflow for evaluating boundaries, dependencies, abstractions, and migration risk before broad changes.",
    `
# Architecture Review

Use this skill when a change touches module boundaries, ownership, or long-lived contracts.

1. Map the existing dependency direction and public surfaces before editing.
2. Identify which behavior is core, provider-specific, or extension-owned.
3. Preserve working behavior while moving one boundary at a time.
4. Add or update tests that prove the intended ownership split.
5. Avoid introducing compatibility paths that are not part of the target state.
6. Record the remaining boundary work separately from the completed slice.
`,
  ),
  curatedCoreSkill(
    "setup-agent-skills",
    "setup-agent-skills",
    "Component setup workflow for documenting work-item services, triage labels, and domain-document context used by agent skills.",
    `
# Setup Agent Skills

Use this skill when a project first enables curated agent skills, or when skills are missing component-specific context about tracking, triage, or domain documentation.

1. Inspect the relevant component source roots before writing: Git remotes, existing \`AGENTS.md\` or \`CLAUDE.md\`, \`docs/agents\`, \`CONTEXT.md\`, \`CONTEXT-MAP.md\`, \`docs/adr\`, and any local issue or work-item directories.
2. Present what exists and what is missing, then confirm setup decisions one at a time instead of asking for every choice at once.
3. Record where work items live for each relevant component: configured DevNexus tracker, GitHub Issues, GitLab Issues, Jira, Linear, local work items, or another project-specific tracker.
4. Record triage labels or status values for the canonical flow: needs triage, needs information, autonomous agent-ready (AFK), ready for human, and will not fix.
5. Record domain-document layout: single-context \`CONTEXT.md\`, multi-context \`CONTEXT-MAP.md\`, and where Architecture Decision Records (ADRs) live.
6. Draft the exact changes before writing: an \`Agent skills\` section in the existing agent instruction file, plus \`docs/agents/issue-tracker.md\`, \`docs/agents/triage-labels.md\`, and \`docs/agents/domain.md\`.
7. Edit the existing agent instruction file. If both \`CLAUDE.md\` and \`AGENTS.md\` exist, prefer the one already used by the project; if neither exists, ask before creating one.
8. Preserve unrelated instructions and update an existing \`Agent skills\` section in place rather than appending a duplicate.
9. Keep generated setup docs local to the project. Do not include external catalog or author names in generated skill names, headings, or operational instructions.
`,
  ),
  curatedCoreSkill(
    "grill-with-docs",
    "grill-with-docs",
    "Plan-grilling workflow for stress-testing product or architecture decisions against code, domain vocabulary, glossary docs, and Architecture Decision Records.",
    `
# Grill With Docs

Use this skill when a plan, design, or feature direction needs to be challenged before implementation.

1. Read existing domain documentation first: root \`CONTEXT.md\`, \`CONTEXT-MAP.md\`, and nearby \`docs/adr\` files when they exist.
2. Cross-check the user's plan against code reality, existing glossary terms, and Architecture Decision Records (ADRs).
3. Ask one high-leverage question at a time. Include your recommended answer, and explore the codebase instead of asking when the answer is discoverable.
4. Challenge overloaded or vague words immediately. Propose one canonical term and record avoided aliases when the user confirms it.
5. Capture resolved domain vocabulary in \`CONTEXT.md\` as a glossary, not a specification or implementation note.
6. Offer an Architecture Decision Record only for decisions that are hard to reverse, surprising without context, and based on a real trade-off.
7. Keep documentation updates small and inline with the conversation so decisions are not lost between runs.

Glossary entries should define project-specific concepts in one sentence, list avoided aliases where useful, and describe important relationships. Architecture Decision Records should briefly state the context, decision, and reason; optional sections belong only when they add real value.
`,
  ),
  curatedCoreSkill(
    "to-issues",
    "to-issues",
    "Issue-slicing workflow for converting a plan or product requirements document into independently verifiable tracker issues.",
    `
# To Issues

Use this skill when a plan, specification, or Product Requirements Document (PRD) needs to become implementation-ready tracker issues.

1. Gather the source plan, existing issue context, tracker conventions, and relevant domain glossary or Architecture Decision Records.
2. Explore enough code to understand the current implementation state before proposing issue boundaries.
3. Split the work into tracer-bullet vertical slices: each issue should deliver a narrow end-to-end behavior that can be demonstrated or verified on its own.
4. Mark each proposed slice as human-in-the-loop (HITL) when it needs product, design, architecture, or external judgment, or autonomous agent-ready (AFK) when it can be implemented and verified without human interaction.
5. Present the proposed issue list for review with title, type, blockers, user stories covered, and acceptance criteria.
6. After approval, create or update tracker issues in dependency order. Do not close or rewrite the parent issue unless explicitly asked.
7. Keep issue bodies stable: describe behavior and acceptance criteria, avoid fragile file-path instructions, and include prototype snippets only when they encode a decision more precisely than prose.
`,
  ),
  curatedCoreSkill(
    "to-prd",
    "to-prd",
    "Product Requirements Document synthesis workflow for turning known context into a tracker-backed planning artifact.",
    `
# To Product Requirements Document (PRD)

Use this skill when the current conversation, notes, or exploratory findings need to become a Product Requirements Document (PRD).

1. Synthesize from existing context. Do not interview the user unless the available context is contradictory or too thin to proceed safely.
2. Explore the current code and domain documentation enough to describe the present state accurately.
3. Write the Product Requirements Document with problem statement, solution, user stories, implementation decisions, testing decisions, out-of-scope items, and further notes.
4. Use explicit product and domain vocabulary. Expand acronyms on first use, for example "Product Requirements Document (PRD)".
5. Avoid file paths and code snippets unless a prototype produced a small decision-bearing shape that prose would obscure.
6. Publish or attach the document through the configured tracker when available, using the project's normal ready-for-planning or ready-for-agent labeling policy.
7. Hand off to the issue-slicing workflow when the Product Requirements Document is ready to become implementation issues.
`,
  ),
  curatedCoreSkill(
    "prototype",
    "prototype",
    "Throwaway prototyping workflow for testing a state model, data model, interaction, or user interface direction before production implementation.",
    `
# Prototype

Use this skill when a design question needs a quick runnable answer before committing production code.

1. State the question the prototype must answer before writing code.
2. Choose the smallest useful form: a terminal or command-line prototype for state and business logic, or a local user interface route for interaction and visual alternatives.
3. Mark prototype files clearly as throwaway and keep them close enough to the real area that the context is obvious.
4. Provide one command to run the prototype, avoid persistent state unless persistence is the thing being tested, and surface the relevant state after each action.
5. Skip production polish, abstractions, and broad tests. The artifact exists to learn quickly.
6. When the question is answered, delete the prototype or fold the validated decision into production code.
7. Record the retained decision in an issue, note, commit message, or Architecture Decision Record when the reason would matter later.
`,
  ),
  curatedCoreSkill(
    "zoom-out",
    "zoom-out",
    "Context-building workflow for mapping unfamiliar code before choosing an implementation or review path.",
    `
# Zoom Out

Use this skill when an area of code is unfamiliar or the local change does not make sense without a broader map.

1. Move one level up from the immediate file and identify the user-facing or system behavior it supports.
2. Map the relevant modules, entry points, callers, adapters, data flow, and ownership boundaries.
3. Use project domain vocabulary from \`CONTEXT.md\` or nearby documentation when available.
4. Separate stable public contracts from implementation details that can change.
5. Name the smallest next file or behavior to inspect after the map is clear.
6. Keep the result concise enough that it guides the next implementation step rather than becoming a separate research report.
`,
  ),
  curatedCoreSkill(
    "architecture-deepening",
    "architecture-deepening",
    "Architecture-improvement workflow for finding shallow modules, weak seams, and refactors that improve locality, leverage, and testability.",
    `
# Architecture Deepening

Use this skill when the goal is to improve codebase structure rather than implement one narrow feature.

1. Read the relevant domain glossary and Architecture Decision Records before proposing structural changes.
2. Map modules by their interface, implementation, callers, and adapters.
3. Look for shallow modules where callers must understand almost as much complexity as the implementation itself.
4. Apply the deletion test: if removing a module only moves complexity into callers, it is probably shallow; if removing it spreads important rules across callers, it is earning its place.
5. Propose deepening opportunities with files, current friction, proposed change, expected locality benefit, expected leverage benefit, and better test surface.
6. Do not implement a broad refactor until the selected opportunity has clear acceptance criteria and a safe migration path.
7. Record rejected architectural directions when future agents are likely to suggest them again.
`,
  ),
];

function assertSkillId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
    throw new NexusSkillError(
      `Skill id must use lowercase letters, digits, and hyphens: ${id}`,
    );
  }
}

function assertRelativeFilePath(filePath: string): void {
  if (
    !filePath ||
    path.isAbsolute(filePath) ||
    filePath.split(/[\\/]/u).some((part) => part === "..")
  ) {
    throw new NexusSkillError(`Skill file path must be relative: ${filePath}`);
  }
}

function availableSkillMap(
  definitions: readonly NexusSkillDefinition[],
): Map<string, NexusSkillDefinition> {
  const skills = new Map<string, NexusSkillDefinition>();
  for (const definition of definitions) {
    assertSkillId(definition.manifest.id);
    if (skills.has(definition.manifest.id)) {
      throw new NexusSkillError(
        `Duplicate skill id: ${definition.manifest.id}`,
      );
    }
    skills.set(definition.manifest.id, definition);
  }

  return skills;
}

function selectedSkillDefinitions(
  skillsConfig: NexusProjectSkillsConfig | undefined,
  skillDefinitions: readonly NexusSkillDefinition[],
): NexusSkillDefinition[] {
  const allDefinitions = [...defaultCoreSkillPack, ...skillDefinitions];
  const available = availableSkillMap(allDefinitions);
  const selected = new Map<string, NexusSkillDefinition>();
  for (const definition of skillsConfig?.defaultCorePack === false
    ? skillDefinitions
    : allDefinitions) {
    selected.set(definition.manifest.id, definition);
  }

  for (const item of skillsConfig?.items ?? []) {
    assertSkillId(item.id);
    if (item.enabled === false) {
      selected.delete(item.id);
      continue;
    }

    const definition = available.get(item.id);
    if (!definition) {
      throw new NexusSkillError(`Unknown configured skill id: ${item.id}`);
    }
    selected.set(item.id, definition);
  }

  return [...selected.values()];
}

function manifestWithOverrides(
  manifest: NexusSkillManifest,
  selection: NexusProjectSkillSelection | undefined,
  config: NexusProjectSkillsConfig | undefined,
): NexusSkillManifest {
  const materialization =
    selection?.materialization ??
    config?.materialization ??
    manifest.materialization;
  const sourceControl =
    selection?.sourceControl ?? config?.sourceControl ?? manifest.sourceControl;

  return {
    ...manifest,
    ...(selection?.version ? { version: selection.version } : {}),
    materialization,
    sourceControl,
  };
}

function selectionForSkill(
  config: NexusProjectSkillsConfig | undefined,
  skillId: string,
): NexusProjectSkillSelection | undefined {
  return config?.items?.find((item) => item.id === skillId && item.enabled !== false);
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeSkillFiles(
  skillRoot: string,
  definition: NexusSkillDefinition,
  manifest: NexusSkillManifest,
): string | null {
  fs.mkdirSync(skillRoot, { recursive: true });
  if (manifest.materialization === "reference") {
    return null;
  }

  if (manifest.materialization === "symlink") {
    if (!definition.sourcePath) {
      throw new NexusSkillError(
        `Skill ${manifest.id} cannot be symlinked without a sourcePath`,
      );
    }
    const target = path.join(skillRoot, nexusSkillMarkdownFileName);
    if (!fs.existsSync(target)) {
      fs.symlinkSync(definition.sourcePath, target);
    }

    return target;
  }

  let skillPath: string | null = null;
  for (const [filePath, content] of Object.entries(definition.files)) {
    assertRelativeFilePath(filePath);
    const targetPath = path.join(skillRoot, filePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
    if (filePath === nexusSkillMarkdownFileName) {
      skillPath = targetPath;
    }
  }

  return skillPath;
}

function materializeSkill(
  projectRoot: string,
  definition: NexusSkillDefinition,
  manifest: NexusSkillManifest,
): MaterializedNexusSkill {
  const skillRoot = path.join(
    projectRoot,
    nexusSkillSupportDirectoryName,
    nexusSkillsDirectoryName,
    manifest.id,
  );
  const manifestPath = path.join(skillRoot, nexusSkillManifestFileName);
  fs.mkdirSync(skillRoot, { recursive: true });
  writeJsonFile(manifestPath, manifest);
  const skillPath = writeSkillFiles(skillRoot, definition, manifest);

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    materialization: manifest.materialization,
    sourceControl: manifest.sourceControl,
    skillRoot,
    manifestPath,
    skillPath,
  };
}

function materializeAgentSkill(
  skillRoot: string,
  definition: NexusSkillDefinition,
  manifest: NexusSkillManifest,
): MaterializedNexusAgentSkill {
  const skillPath = writeSkillFiles(skillRoot, definition, manifest);

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    materialization: manifest.materialization,
    skillRoot,
    skillPath,
  };
}

function addGitExcludeEntries(
  projectRoot: string,
  entries: readonly string[],
): { gitExcludePath: string | null; gitExcludeEntries: string[] } {
  const gitInfoDir = path.join(projectRoot, ".git", "info");
  if (!fs.existsSync(gitInfoDir) || !fs.statSync(gitInfoDir).isDirectory()) {
    return {
      gitExcludePath: null,
      gitExcludeEntries: [],
    };
  }

  const excludePath = path.join(gitInfoDir, "exclude");
  const existing = fs.existsSync(excludePath)
    ? fs.readFileSync(excludePath, "utf8")
    : "";
  const existingLines = new Set(
    existing
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const appended: string[] = [];
  for (const entry of entries) {
    if (!existingLines.has(entry)) {
      appended.push(entry);
      existingLines.add(entry);
    }
  }

  if (appended.length > 0) {
    fs.mkdirSync(gitInfoDir, { recursive: true });
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(excludePath, `${prefix}${appended.join("\n")}\n`, "utf8");
  }

  return {
    gitExcludePath: excludePath,
    gitExcludeEntries: appended,
  };
}

function projectSkillsDirectory(projectRoot: string): string {
  return path.join(
    projectRoot,
    nexusSkillSupportDirectoryName,
    nexusSkillsDirectoryName,
  );
}

function defaultAgentSkillsDirectory(agent: string): string | null {
  if (agent === "codex") {
    return path.join(".agents", "skills");
  }
  if (agent === "claude") {
    return path.join(".claude", "skills");
  }

  return null;
}

function resolveAgentSkillsDirectory(
  projectRoot: string,
  target: NexusProjectSkillAgentTarget,
): string {
  const directory = target.directory ?? defaultAgentSkillsDirectory(target.agent);
  if (!directory) {
    throw new NexusSkillError(
      `Agent skill target ${target.agent} must define directory`,
    );
  }
  if (
    path.isAbsolute(directory) ||
    directory.split(/[\\/]/u).some((part) => part === "..")
  ) {
    throw new NexusSkillError(
      `Agent skill target directory must be project-relative: ${directory}`,
    );
  }

  return path.join(projectRoot, directory);
}

function gitExcludeEntryForDirectory(
  projectRoot: string,
  directory: string,
): string {
  return `${path.relative(projectRoot, directory).replace(/\\/gu, "/")}/`;
}

function expectedSkillEntries(
  skillsConfig: NexusProjectSkillsConfig | undefined,
  skillDefinitions: readonly NexusSkillDefinition[],
): Array<{
  definition: NexusSkillDefinition;
  manifest: NexusSkillManifest;
}> {
  return selectedSkillDefinitions(skillsConfig, skillDefinitions).map(
    (definition) => ({
      definition,
      manifest: manifestWithOverrides(
        definition.manifest,
        selectionForSkill(skillsConfig, definition.manifest.id),
        skillsConfig,
      ),
    }),
  );
}

function isManifest(value: unknown): value is NexusSkillManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.description === "string" &&
    typeof record.version === "string" &&
    typeof record.license === "string" &&
    record.source !== null &&
    typeof record.source === "object" &&
    !Array.isArray(record.source) &&
    Array.isArray(record.supportedAgents) &&
    record.supportedAgents.every((agent) => typeof agent === "string") &&
    (record.materialization === "copy" ||
      record.materialization === "symlink" ||
      record.materialization === "reference") &&
    (record.sourceControl === "support" || record.sourceControl === "source")
  );
}

interface InstalledSkillEntry {
  id: string;
  manifest?: NexusSkillManifest;
  error?: string;
  skillRoot: string;
  manifestPath: string;
}

function readInstalledSkillEntry(skillRoot: string): InstalledSkillEntry {
  const manifestPath = path.join(skillRoot, nexusSkillManifestFileName);
  const fallbackId = path.basename(skillRoot);
  if (!fs.existsSync(manifestPath)) {
    return {
      id: fallbackId,
      error: "skill manifest is missing",
      skillRoot,
      manifestPath,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!isManifest(parsed)) {
      return {
        id: fallbackId,
        error: "skill manifest has an invalid shape",
        skillRoot,
        manifestPath,
      };
    }

    return {
      id: parsed.id,
      manifest: parsed,
      skillRoot,
      manifestPath,
    };
  } catch (error) {
    return {
      id: fallbackId,
      error: error instanceof Error ? error.message : String(error),
      skillRoot,
      manifestPath,
    };
  }
}

function installedSkillEntries(
  skillsDirectory: string,
): Map<string, InstalledSkillEntry> {
  const entries = new Map<string, InstalledSkillEntry>();
  if (!fs.existsSync(skillsDirectory)) {
    return entries;
  }

  for (const directoryEntry of fs.readdirSync(skillsDirectory, {
    withFileTypes: true,
  })) {
    if (!directoryEntry.isDirectory()) {
      continue;
    }

    const entry = readInstalledSkillEntry(
      path.join(skillsDirectory, directoryEntry.name),
    );
    entries.set(entry.id, entry);
  }

  return entries;
}

function skillPathForManifest(
  skillRoot: string,
  manifest: Pick<NexusSkillManifest, "materialization"> | undefined,
): string | null {
  return manifest?.materialization === "reference"
    ? null
    : path.join(skillRoot, nexusSkillMarkdownFileName);
}

function skillStatusSummary(
  skills: readonly NexusProjectSkillStatus[],
): NexusProjectSkillStatusSummary {
  return {
    expected: skills.filter((skill) => skill.expected).length,
    installed: skills.filter((skill) => skill.installed).length,
    missing: skills.filter((skill) => skill.state === "missing").length,
    stale: skills.filter((skill) => skill.state === "stale").length,
    unexpected: skills.filter((skill) => skill.state === "unexpected").length,
    invalid: skills.filter((skill) => skill.state === "invalid").length,
  };
}

function manifestsMatch(
  expected: NexusSkillManifest,
  installed: NexusSkillManifest,
): boolean {
  return JSON.stringify(expected) === JSON.stringify(installed);
}

function expectedSkillStatus(
  skillsDirectory: string,
  expected: {
    definition: NexusSkillDefinition;
    manifest: NexusSkillManifest;
  },
  installed: InstalledSkillEntry | undefined,
): NexusProjectSkillStatus {
  const skillRoot = path.join(skillsDirectory, expected.manifest.id);
  const manifestPath = path.join(skillRoot, nexusSkillManifestFileName);
  if (!installed) {
    return {
      id: expected.manifest.id,
      state: "missing",
      expected: true,
      installed: false,
      name: expected.manifest.name,
      expectedVersion: expected.manifest.version,
      installedVersion: null,
      materialization: expected.manifest.materialization,
      sourceControl: expected.manifest.sourceControl,
      skillRoot,
      manifestPath,
      skillPath: skillPathForManifest(skillRoot, expected.manifest),
      reasons: ["skill is not installed"],
    };
  }

  if (!installed.manifest) {
    return {
      id: expected.manifest.id,
      state: "invalid",
      expected: true,
      installed: true,
      name: expected.manifest.name,
      expectedVersion: expected.manifest.version,
      installedVersion: null,
      materialization: expected.manifest.materialization,
      sourceControl: expected.manifest.sourceControl,
      skillRoot: installed.skillRoot,
      manifestPath: installed.manifestPath,
      skillPath: skillPathForManifest(installed.skillRoot, expected.manifest),
      reasons: [installed.error ?? "skill manifest is invalid"],
    };
  }

  const reasons: string[] = [];
  if (!manifestsMatch(expected.manifest, installed.manifest)) {
    reasons.push("skill manifest differs from the expected definition");
  }

  if (expected.manifest.materialization === "copy") {
    for (const [filePath, content] of Object.entries(expected.definition.files)) {
      const targetPath = path.join(installed.skillRoot, filePath);
      if (!fs.existsSync(targetPath)) {
        reasons.push(`skill file is missing: ${filePath}`);
        continue;
      }
      if (fs.readFileSync(targetPath, "utf8") !== content) {
        reasons.push(`skill file differs from the expected definition: ${filePath}`);
      }
    }
  } else if (expected.manifest.materialization === "symlink") {
    const skillPath = path.join(installed.skillRoot, nexusSkillMarkdownFileName);
    if (!fs.existsSync(skillPath)) {
      reasons.push(`${nexusSkillMarkdownFileName} symlink is missing`);
    } else if (!fs.lstatSync(skillPath).isSymbolicLink()) {
      reasons.push(`${nexusSkillMarkdownFileName} is not a symlink`);
    }
  }

  return {
    id: expected.manifest.id,
    state: reasons.length > 0 ? "stale" : "installed",
    expected: true,
    installed: true,
    name: expected.manifest.name,
    expectedVersion: expected.manifest.version,
    installedVersion: installed.manifest.version,
    materialization: expected.manifest.materialization,
    sourceControl: expected.manifest.sourceControl,
    skillRoot: installed.skillRoot,
    manifestPath: installed.manifestPath,
    skillPath: skillPathForManifest(installed.skillRoot, expected.manifest),
    reasons,
  };
}

function installedOnlySkillStatus(
  installed: InstalledSkillEntry,
): NexusProjectSkillStatus {
  const manifest = installed.manifest;
  const state: NexusProjectSkillState = manifest ? "unexpected" : "invalid";

  return {
    id: installed.id,
    state,
    expected: false,
    installed: true,
    name: manifest?.name ?? null,
    expectedVersion: null,
    installedVersion: manifest?.version ?? null,
    materialization: manifest?.materialization ?? null,
    sourceControl: manifest?.sourceControl ?? null,
    skillRoot: installed.skillRoot,
    manifestPath: installed.manifestPath,
    skillPath: skillPathForManifest(installed.skillRoot, manifest),
    reasons: [
      manifest
        ? "skill is installed but is not selected by project configuration"
        : installed.error ?? "skill manifest is invalid",
    ],
  };
}

export function inspectNexusProjectSkills(
  options: InspectNexusProjectSkillsOptions,
): InspectNexusProjectSkillsResult {
  const skillsDirectory = projectSkillsDirectory(options.projectRoot);
  const expected = expectedSkillEntries(
    options.skillsConfig,
    options.skillDefinitions ?? [],
  );
  const installed = installedSkillEntries(skillsDirectory);
  const statuses = expected.map((entry) =>
    expectedSkillStatus(skillsDirectory, entry, installed.get(entry.manifest.id)),
  );
  const expectedIds = new Set(expected.map((entry) => entry.manifest.id));
  for (const entry of [...installed.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (!expectedIds.has(entry.id)) {
      statuses.push(installedOnlySkillStatus(entry));
    }
  }

  return {
    skillsDirectory,
    summary: skillStatusSummary(statuses),
    skills: statuses,
  };
}

export function materializeNexusProjectSkills(
  options: MaterializeNexusProjectSkillsOptions,
): MaterializeNexusProjectSkillsResult {
  const skillsDirectory = projectSkillsDirectory(options.projectRoot);
  const expected = expectedSkillEntries(
    options.skillsConfig,
    options.skillDefinitions ?? [],
  );
  const installed = expected.map(({ definition, manifest }) =>
    materializeSkill(options.projectRoot, definition, manifest),
  );
  const agentTargets = (options.skillsConfig?.agentTargets ?? [])
    .filter((target) => target.enabled !== false)
    .map((target) => {
      const targetSkillsDirectory = resolveAgentSkillsDirectory(
        options.projectRoot,
        target,
      );
      const targetSourceControl =
        target.sourceControl ?? options.skillsConfig?.sourceControl ?? "support";
      const targetInstalled = expected
        .filter(({ manifest }) => manifest.supportedAgents.includes(target.agent))
        .map(({ definition, manifest }) =>
          materializeAgentSkill(
            path.join(targetSkillsDirectory, manifest.id),
            definition,
            manifest,
          ),
        );

      return {
        agent: target.agent,
        skillsDirectory: targetSkillsDirectory,
        sourceControl: targetSourceControl,
        installed: targetInstalled,
      };
    });
  const supportEntries = installed.some(
    (skill) => skill.sourceControl === "support",
  )
    ? [`${nexusSkillSupportDirectoryName}/${nexusSkillsDirectoryName}/`]
    : [];
  for (const target of agentTargets) {
    if (target.sourceControl === "support" && target.installed.length > 0) {
      supportEntries.push(
        gitExcludeEntryForDirectory(options.projectRoot, target.skillsDirectory),
      );
    }
  }
  const gitExclude =
    options.excludeFromGit === false
      ? { gitExcludePath: null, gitExcludeEntries: [] }
      : addGitExcludeEntries(options.projectRoot, supportEntries);

  return {
    skillsDirectory,
    installed,
    agentTargets,
    gitExcludePath: gitExclude.gitExcludePath,
    gitExcludeEntries: gitExclude.gitExcludeEntries,
  };
}

export function refreshNexusProjectSkills(
  options: RefreshNexusProjectSkillsOptions,
): RefreshNexusProjectSkillsResult {
  const inspectOptions = {
    projectRoot: options.projectRoot,
    skillsConfig: options.skillsConfig,
    skillDefinitions: options.skillDefinitions,
  };
  const before = inspectNexusProjectSkills(inspectOptions);
  const materialized = materializeNexusProjectSkills(options);
  const after = inspectNexusProjectSkills(inspectOptions);

  return {
    before,
    materialized,
    after,
  };
}
