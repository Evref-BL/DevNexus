import fs from "node:fs";
import path from "node:path";

export const nexusSkillSupportDirectoryName = ".dev-nexus";
export const nexusSkillsDirectoryName = "skills";
export const nexusSkillManifestFileName = "dev-nexus.skill.json";
export const nexusSkillMarkdownFileName = "SKILL.md";

export type NexusSkillMaterializationMode = "copy" | "symlink" | "reference";
export type NexusSkillSourceControl = "support" | "source";

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

export interface MaterializeNexusProjectSkillsResult {
  skillsDirectory: string;
  installed: MaterializedNexusSkill[];
  gitExcludePath: string | null;
  gitExcludeEntries: string[];
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
      supportedAgents: ["codex"],
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
    "Test-first implementation workflow for adding behavior with focused red, green, and refactor steps.",
    `
# TDD

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

1. Identify the owning project, source checkout, and tracker provider.
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

  if (manifest.materialization === "reference") {
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      materialization: manifest.materialization,
      sourceControl: manifest.sourceControl,
      skillRoot,
      manifestPath,
      skillPath: null,
    };
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

    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      materialization: manifest.materialization,
      sourceControl: manifest.sourceControl,
      skillRoot,
      manifestPath,
      skillPath: target,
    };
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

export function materializeNexusProjectSkills(
  options: MaterializeNexusProjectSkillsOptions,
): MaterializeNexusProjectSkillsResult {
  const skillsDirectory = path.join(
    options.projectRoot,
    nexusSkillSupportDirectoryName,
    nexusSkillsDirectoryName,
  );
  const selected = selectedSkillDefinitions(
    options.skillsConfig,
    options.skillDefinitions ?? [],
  );
  const installed = selected.map((definition) => {
    const selection = selectionForSkill(options.skillsConfig, definition.manifest.id);
    return materializeSkill(
      options.projectRoot,
      definition,
      manifestWithOverrides(definition.manifest, selection, options.skillsConfig),
    );
  });
  const supportEntries = installed.some(
    (skill) => skill.sourceControl === "support",
  )
    ? [`${nexusSkillSupportDirectoryName}/${nexusSkillsDirectoryName}/`]
    : [];
  const gitExclude =
    options.excludeFromGit === false
      ? { gitExcludePath: null, gitExcludeEntries: [] }
      : addGitExcludeEntries(options.projectRoot, supportEntries);

  return {
    skillsDirectory,
    installed,
    gitExcludePath: gitExclude.gitExcludePath,
    gitExcludeEntries: gitExclude.gitExcludeEntries,
  };
}
