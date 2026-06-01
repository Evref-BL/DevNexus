import fs from "node:fs";
import path from "node:path";
import {
  loadProjectConfig,
} from "../project/nexusProjectConfig.js";
import {
  resolveNexusProjectPath,
} from "../runtime/nexusPathResolver.js";

export interface NexusTargetStateCompactionOptions {
  projectRoot: string;
  apply?: boolean;
}

export interface NexusTargetStateCompactionSection {
  title: string;
  action: "preserved" | "removed";
  reason: string;
}

export interface NexusTargetStateCompactionResult {
  projectRoot: string;
  statePath: string;
  apply: boolean;
  changed: boolean;
  beforeMarkdown: string;
  afterMarkdown: string;
  preservedSections: NexusTargetStateCompactionSection[];
  removedSections: NexusTargetStateCompactionSection[];
  summary: string;
}

const authoritativeHeadingPatterns = [
  /^purpose$/iu,
  /^current target$/iu,
  /^live state$/iu,
  /^current operating state$/iu,
  /^current decisions?$/iu,
  /^decisions?$/iu,
  /^active blockers?$/iu,
  /^blockers?$/iu,
  /^next direction$/iu,
  /^boundaries$/iu,
  /^current work selection$/iu,
  /^exceptional recent changes$/iu,
  /^document policy$/iu,
  /^active cleanup notes$/iu,
];

const generatedHistoryHeadingPatterns = [
  /completed/iu,
  /history/iu,
  /past cycles?/iu,
  /cycle log/iu,
  /run log/iu,
  /run history/iu,
  /merged/iu,
  /archive/iu,
  /publication history/iu,
];

interface MarkdownSection {
  level: number;
  title: string;
  lines: string[];
}

export function compactNexusTargetState(
  options: NexusTargetStateCompactionOptions,
): NexusTargetStateCompactionResult {
  const projectRoot = path.resolve(requiredString(options.projectRoot, "projectRoot"));
  const projectConfig = loadProjectConfig(projectRoot);
  const statePath = resolveNexusProjectPath({
    projectRoot,
    value:
      projectConfig.automation?.target.statePath ??
      ".dev-nexus/automation/target-state.md",
  });
  const beforeMarkdown = fs.existsSync(statePath)
    ? fs.readFileSync(statePath, "utf8")
    : "";
  const compacted = compactTargetStateMarkdown(beforeMarkdown, {
    projectName: projectConfig.name,
  });
  const apply = options.apply === true;
  if (apply && compacted.afterMarkdown !== beforeMarkdown) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, compacted.afterMarkdown, "utf8");
  }

  return {
    projectRoot,
    statePath,
    apply,
    changed: compacted.afterMarkdown !== beforeMarkdown,
    beforeMarkdown,
    afterMarkdown: compacted.afterMarkdown,
    preservedSections: compacted.preservedSections,
    removedSections: compacted.removedSections,
    summary: compacted.summary,
  };
}

export function compactTargetStateMarkdown(
  markdown: string,
  options: { projectName?: string | null } = {},
): Pick<
  NexusTargetStateCompactionResult,
  "afterMarkdown" | "preservedSections" | "removedSections" | "summary"
> {
  const normalized = normalizeLineEndings(markdown);
  const sections = splitMarkdownSections(normalized);
  if (sections.length === 0) {
    const title = options.projectName?.trim() || "DevNexus Project";
    return {
      afterMarkdown: [
        `# ${title} Target State`,
        "",
        "Current target: not recorded.",
        "",
        "## Active Blockers",
        "",
        "- None recorded.",
        "",
        "## Next Direction",
        "",
        "- Record the current objective, active decisions, blockers, boundaries, and next direction.",
        "",
      ].join("\n"),
      preservedSections: [],
      removedSections: [],
      summary: "Created a minimal active target-state skeleton.",
    };
  }

  const preservedSections: NexusTargetStateCompactionSection[] = [];
  const removedSections: NexusTargetStateCompactionSection[] = [];
  const output: string[] = [];
  let removedParent: MarkdownSection | null = null;

  for (const section of sections) {
    if (
      removedParent &&
      section.level > removedParent.level
    ) {
      removedSections.push({
        title: section.title,
        action: "removed",
        reason: `nested under removed history section "${removedParent.title}"`,
      });
      continue;
    }
    if (
      removedParent &&
      section.level <= removedParent.level
    ) {
      removedParent = null;
    }

    const classification = classifyTargetStateSection(section);
    if (classification.action === "removed") {
      removedSections.push({
        title: section.title,
        action: "removed",
        reason: classification.reason,
      });
      removedParent = section;
      continue;
    }

    preservedSections.push({
      title: section.title,
      action: "preserved",
      reason: classification.reason,
    });
    output.push(...trimTrailingBlankLines(section.lines), "");
  }

  const afterMarkdown = `${trimTrailingBlankLines(output).join("\n")}\n`;
  const summary = removedSections.length === 0
    ? "Target state is already concise enough for active-state use."
    : `Removed ${removedSections.length} generated/history section(s); preserved ${preservedSections.length} active-state section(s).`;

  return {
    afterMarkdown,
    preservedSections,
    removedSections,
    summary,
  };
}

function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  let preamble: string[] = [];

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!heading) {
      if (current) {
        current.lines.push(line);
      } else {
        preamble.push(line);
      }
      continue;
    }

    if (!current && preamble.some((entry) => entry.trim().length > 0)) {
      sections.push({
        level: 0,
        title: "Preamble",
        lines: trimTrailingBlankLines(preamble),
      });
      preamble = [];
    }
    if (current) {
      sections.push(current);
    }
    current = {
      level: heading[1]!.length,
      title: heading[2]!.trim(),
      lines: [line],
    };
  }

  if (current) {
    sections.push(current);
  } else if (preamble.some((entry) => entry.trim().length > 0)) {
    sections.push({
      level: 0,
      title: "Preamble",
      lines: trimTrailingBlankLines(preamble),
    });
  }

  return sections;
}

function classifyTargetStateSection(section: MarkdownSection): {
  action: "preserved" | "removed";
  reason: string;
} {
  const normalizedTitle = section.title.trim();
  if (section.level <= 1 || normalizedTitle === "Preamble") {
    return {
      action: "preserved",
      reason: "document title or preamble",
    };
  }
  if (generatedHistoryHeadingPatterns.some((pattern) => pattern.test(normalizedTitle))) {
    return {
      action: "removed",
      reason: "completed/history content should be generated from durable facts",
    };
  }
  if (authoritativeHeadingPatterns.some((pattern) => pattern.test(normalizedTitle))) {
    return {
      action: "preserved",
      reason: "authoritative active target-state section",
    };
  }

  return {
    action: "preserved",
    reason: "unrecognized section preserved for human review",
  };
}

function normalizeLineEndings(markdown: string): string {
  return markdown.replace(/\r\n?/gu, "\n");
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.trim() === "") {
    trimmed.pop();
  }
  return trimmed;
}

function requiredString(value: string | undefined, name: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}
