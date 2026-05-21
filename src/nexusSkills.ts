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
  tag?: string;
  commit?: string;
  paths?: string[];
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
  agentTargets?: NexusProjectSkillAgentTarget[];
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

const humanizerSkillMarkdown = skillMarkdown(
  "humanizer",
  "Remove signs of AI-generated writing from text. Use when editing or reviewing prose to make it sound natural, specific, and human-written while preserving meaning and technical accuracy.",
  `
# Humanizer

Vendored from \`blader/humanizer\`, this is a DevNexus adaptation of the MIT-licensed upstream
skill. Use it when text reads like an AI draft: inflated, over-structured,
over-polite, vague, promotional, or too evenly polished.

## Task

When asked to humanize text:

1. Identify AI writing patterns in the input.
2. Rewrite the problematic sections.
3. Preserve meaning, factual claims, commands, warnings, and technical terms.
4. Match the intended tone and, when provided, the user's writing sample.
5. Add voice only where the document type allows it. A README can be direct and
   helpful without becoming chatty.
6. Do a final audit: ask what still sounds obviously AI generated, then revise
   those remaining tells.

## Voice Calibration

If the user provides a writing sample, read it before rewriting. Notice sentence
length, word choice, paragraph starts, punctuation habits, transitions, and any
recurring phrases. Match those patterns without copying private or unrelated
content from the sample.

When no sample is provided, default to plain, varied, specific writing. Prefer a
competent maintainer's voice over a marketing page or tutorial script.

## Patterns To Remove

- Significance inflation: "pivotal", "crucial", "testament", "underscores",
  "marks a shift", "evolving landscape".
- Promotional phrasing: "boasts", "vibrant", "groundbreaking", "seamless",
  "powerful", "in the heart of".
- Vague attribution: "experts believe", "industry observers", "some say",
  "available sources suggest".
- Superficial "-ing" clauses that fake depth: "highlighting", "ensuring",
  "showcasing", "reflecting".
- Copula avoidance: replace "serves as", "functions as", "stands as" with
  "is", "has", or another direct verb when clearer.
- Negative parallelisms: "not just X, but Y" and similar constructions.
- Forced threes, false ranges, synonym cycling, and balanced list padding.
- Chatbot artifacts: "Great question", "Of course", "I hope this helps",
  "let me know if".
- Formulaic transitions: "let's dive in", "here's what you need to know",
  "without further ado".
- Generic positive conclusions: "the future looks bright", "exciting times lie
  ahead", "a step in the right direction".
- Over-formatting: decorative emoji, mechanical bold labels, and unnecessary
  em dashes.
- Excessive hedging and filler: "could potentially", "it is important to note",
  "in order to", "due to the fact that".

## Rewrite Rules

- Replace vague claims with sourced specifics, or remove them.
- Shorten before decorating. If a sentence can be direct, make it direct.
- Keep repeated terms when repetition is clearer than synonym cycling.
- Do not invent citations, examples, names, metrics, or confidence.
- Do not soften warnings that users need to see.
- Preserve commands exactly unless the task is to correct them.
- Use contractions only when they fit the document and project voice.
- Keep Markdown structure useful. Do not flatten a good quick start just to make
  prose sound casual.

## Output

For short text, provide the final rewrite directly.

For larger or risky edits, provide:

1. Draft rewrite.
2. Brief remaining-AI-tells audit.
3. Final rewrite.
4. Optional concise summary of what changed.

## Attribution

Adapted from \`blader/humanizer\` version 2.5.1 at commit
\`8b3a17889fbf12bedae20974a3c9f9de746ed754\`, licensed under MIT by Siqi Chen.
The pattern catalog is based on Wikipedia's "Signs of AI writing" guidance
maintained by WikiProject AI Cleanup.
`,
);

const humanizerLicenseText = `MIT License

Copyright (c) 2025 Siqi Chen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const superpowersSource = {
  uri: "https://github.com/obra/superpowers",
  tag: "v5.1.0",
  commit: "f2cbfbefebbfef77321e4c9abc9e949826bea9d7",
};

const superpowersLicenseText = `MIT License

Copyright (c) 2025 Jesse Vincent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function adaptedSuperpowersSkill(
  id: string,
  name: string,
  description: string,
  sourcePaths: string[],
  body: string,
): NexusSkillDefinition {
  return {
    manifest: {
      id,
      name,
      description,
      version: "5.1.0-dev-nexus.0",
      license: "MIT",
      source: {
        type: "git",
        ...superpowersSource,
        paths: sourcePaths,
      },
      supportedAgents: ["codex", "claude"],
      materialization: "copy",
      sourceControl: "support",
    },
    files: {
      [nexusSkillMarkdownFileName]: skillMarkdown(name, description, body),
      LICENSE: superpowersLicenseText,
    },
  };
}

const mattPocockSkillsSource = {
  uri: "https://github.com/mattpocock/skills",
  commit: "b8be62ffacb0118fa3eaa29a0923c87c8c11985c",
};

const mattPocockSkillsLicenseText = `MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function adaptedMattPocockSkill(
  id: string,
  name: string,
  description: string,
  sourcePaths: string[],
  body: string,
): NexusSkillDefinition {
  return {
    manifest: {
      id,
      name,
      description,
      version: "0.1.0-dev-nexus.0",
      license: "MIT",
      source: {
        type: "git",
        ...mattPocockSkillsSource,
        paths: sourcePaths,
      },
      supportedAgents: ["codex", "claude"],
      materialization: "copy",
      sourceControl: "support",
    },
    files: {
      [nexusSkillMarkdownFileName]: skillMarkdown(name, description, body),
      LICENSE: mattPocockSkillsLicenseText,
    },
  };
}

const humanizerSkill: NexusSkillDefinition = {
  manifest: {
    id: "humanizer",
    name: "humanizer",
    description:
      "Vendored MIT writing-polish skill adapted from blader/humanizer. Use when editing or reviewing prose to remove signs of AI-generated writing while preserving meaning, technical accuracy, and the user's intended voice.",
    version: "2.5.1-dev-nexus.0",
    license: "MIT",
    source: {
      type: "git",
      uri: "https://github.com/blader/humanizer",
      commit: "8b3a17889fbf12bedae20974a3c9f9de746ed754",
    },
    supportedAgents: ["codex", "claude"],
    materialization: "copy",
    sourceControl: "support",
  },
  files: {
    [nexusSkillMarkdownFileName]: humanizerSkillMarkdown,
    LICENSE: humanizerLicenseText,
  },
};

const designWithUserSkill = adaptedSuperpowersSkill(
  "design-with-user",
  "design-with-user",
  "Collaborative design workflow adapted from Superpowers brainstorming. Use before multi-step creative, product, code, documentation, research, operations, or workflow changes when intent, scope, tradeoffs, or success criteria need to be shaped before execution.",
  ["skills/brainstorming/SKILL.md"],
  `
# Design With User

Use this skill before starting multi-step work whose shape is not already clear.
Keep the agent active in leading the design, while the user owns product,
scope, and risk decisions.

## Workflow

1. Read the relevant project context first: existing docs, tracker item, current
   files, recent decisions, and any active initiative surface.
2. Decide whether the request is small enough to execute directly. If it is not,
   keep designing before implementation.
3. Ask only the questions needed to remove real ambiguity. Prefer one focused
   question at a time, and state your recommended answer when you have one.
4. Offer two or three viable approaches when meaningful. Lead with the
   recommended approach and name the tradeoffs.
5. Present the design at the right size for the work. Cover objective, scope,
   major parts, data or artifact flow, risks, verification, and done criteria.
6. Get explicit user approval before implementation when the design changes
   behavior, scope, publication, cost, safety, or long-lived project direction.
7. Record the durable design only when it needs to survive the chat. In a
   DevNexus workspace, prefer the configured tracker, a Product Requirements
   Document (PRD), target-cycle facts, or initiative notes over ad hoc files.
8. Hand off to planning or execution with the approved scope and open decisions
   clearly separated.

## Guardrails

- Do not turn every small fix into ceremony; scale the design to the risk.
- Do not write code, mutate durable artifacts, or publish before required
  approval.
- Do not ask questions whose answers are discoverable from local context.
- Do not hide unresolved decisions inside an implementation plan.
- If the user already has a plan and wants it challenged, use \`grill-me\` or
  \`grill-with-docs\` before returning to collaborative design.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/brainstorming/SKILL.md\`.
This DevNexus adaptation changes the workflow to support generic initiatives,
DevNexus durable records, and risk-scaled design gates.
`,
);

const grillMeSkill = adaptedMattPocockSkill(
  "grill-me",
  "grill-me",
  "Plan and design interrogation workflow adapted from Matt Pocock's grill-me. Use when the user asks to be grilled, stress-test a plan, challenge assumptions, resolve a decision tree, or reach shared understanding through one-question-at-a-time pressure.",
  ["skills/productivity/grill-me/SKILL.md"],
  `
# Grill Me

Use this skill when the user wants a plan, design, proposal, or decision tree
challenged through direct questioning. This is the general-purpose interview
mode: the agent probes, recommends, and resolves branches; the user answers and
decides.

## Workflow

1. State the plan or assumption being grilled so the target is explicit.
2. Walk the decision tree one branch at a time. Resolve dependencies between
   decisions before moving deeper.
3. Ask one question at a time. Make it specific enough that the user can answer
   or reject the premise.
4. Include your recommended answer for each question, with the reason and the
   tradeoff.
5. If the answer can be discovered from code, docs, tracker state, or project
   history, inspect that source instead of asking.
6. Track resolved answers and open branches compactly so the conversation does
   not lose state.
7. Stop when the remaining uncertainty is explicit enough to design, plan,
   reject, or defer.

## Boundaries

- Use \`design-with-user\` when no concrete plan exists and the goal is
  collaborative shaping.
- Use \`grill-with-docs\` when the challenge depends on domain docs, glossary
  terms, Architecture Decision Records (ADRs), or code reality.
- Do not turn grilling into broad debate. Keep each question tied to a decision
  or assumption.
- Do not ask multiple questions disguised as one.

## Attribution

Adapted from \`mattpocock/skills\` at commit
\`b8be62ffacb0118fa3eaa29a0923c87c8c11985c\`, licensed under MIT by Matt
Pocock. Source path:
\`skills/productivity/grill-me/SKILL.md\`.
This DevNexus adaptation adds role boundaries, durable-state expectations, and
DevNexus-compatible source attribution.
`,
);

const writeImplementationPlanSkill = adaptedSuperpowersSkill(
  "write-implementation-plan",
  "write-implementation-plan",
  "Implementation planning workflow adapted from Superpowers writing-plans. Use after design or requirements are approved and before execution when work needs owned slices, DevNexus component or artifact scope, acceptance criteria, and verification.",
  ["skills/writing-plans/SKILL.md"],
  `
# Write Implementation Plan

Use this skill when approved requirements need to become executable work. The
agent leads the plan; the user decides scope, risk, and approval gates.

## Workflow

1. Read the source requirements first: tracker issue, Product Requirements
   Document (PRD), initiative notes, relevant code, existing docs, and recent
   decisions.
2. Confirm the work belongs to one initiative or delivery surface. If the
   request covers independent objectives, propose separate plans before
   execution.
3. Map the changed surfaces before writing tasks. Name the owning component,
   files or artifacts, tracker anchor, expected worktree, and command working
   directory where those are knowable.
4. Split the work into bounded slices. Each slice needs one owner, one scope,
   dependencies, acceptance criteria, verification commands, and handoff notes.
5. Prefer Test-Driven Development (TDD) for behavior changes that can be tested
   cleanly. Include the focused failing test target, minimal implementation
   target, and nearest broader check.
6. Be concrete enough for another agent to execute without guessing: exact
   paths, exact commands, expected outcomes, and explicit blockers. Do not use
   placeholders such as TBD, TODO, "similar to above", or "add tests".
7. Mark human-in-the-loop gates for publication, destructive cleanup, external
   provider writes, product decisions, cost, security, or live runtime actions.
8. Save a durable plan only when it needs to survive the chat. In a DevNexus
   workspace, prefer the configured tracker, issue comment, PRD, initiative
   notes, or target-cycle facts over an ad hoc file.
9. End with the recommended execution mode: subagents for independent disjoint
   slices, inline execution for tightly coupled work, or blocked with the
   smallest decision needed.

## Plan Shape

Use this shape when writing a saved implementation plan:

1. Goal and done criteria.
2. Integration surface and tracker anchor.
3. Component, artifact, or document ownership.
4. Task slices with files, acceptance criteria, steps, verification, and
   handoff.
5. Human approval gates and publication path.
6. Open questions and blockers.

## Guardrails

- Do not plan implementation before design approval when the design changes
  behavior, scope, publication, cost, safety, or long-lived direction.
- Do not hide unresolved product or architecture decisions inside a task list.
- Do not create many unrelated final publications for one initiative.
- Do not make the plan programming-centric when the work is documentation,
  research, operations, or another artifact workflow.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/writing-plans/SKILL.md\`.
This DevNexus adaptation changes the workflow to use initiative surfaces,
component ownership, tracker anchors, approval gates, and DevNexus verification
records directly.
`,
);

const prepareDevNexusWorktreeSkill = adaptedSuperpowersSkill(
  "prepare-dev-nexus-worktree",
  "prepare-dev-nexus-worktree",
  "DevNexus worktree preparation workflow adapted from Superpowers using-git-worktrees. Use before mutating component source or workspace metadata so work happens in an owned isolated surface with preserved context and verification.",
  ["skills/using-git-worktrees/SKILL.md"],
  `
# Prepare DevNexus Worktree

Use this skill before mutating component source, workspace metadata, generated
skills, planning documents, or another durable project surface.

## Workflow

1. Identify the owning surface: component source, workspace metadata, docs,
   tracker state, or another artifact. Confirm the tracker anchor or initiative
   surface when one exists.
2. Inspect Git status, branch, remotes, upstream, and ahead/behind state before
   editing. Preserve unrelated dirty changes and report blockers instead of
   reverting them.
3. Detect whether the current checkout is already an owned isolated worktree. If
   it is, adopt it and continue there. Do not create nested worktrees.
4. In a DevNexus workspace, use DevNexus worktree tooling such as
   \`worktree_prepare\` or \`dev-nexus worktree prepare\`. Use a component
   worktree for source changes and a workspace/meta worktree for files such as
   \`dev-nexus.project.json\`, \`.dev-nexus/**\`, projected skills,
   \`PLAN.md\`, \`CONTEXT.md\`, target state, or dogfood docs.
5. Choose a branch name that matches the initiative or tracker item and the
   workspace branch policy. Keep one long-lived initiative branch when slices
   should accumulate before final publication.
6. Let configured setup do its job. Prefer projected dependencies, generated
   context bundles, and skill projection over ad hoc package installation.
7. Run the smallest useful baseline verification for the planned work. If the
   baseline fails, record the failure and decide whether the current slice owns
   the fix before proceeding.
8. Record the prepared surface where the workspace can find it: work-item
   comment, coordination handoff, target-cycle facts, or initiative notes.

## Guardrails

- Do not hand-roll \`git worktree add\` in a DevNexus-managed workspace when
  DevNexus worktree tooling is available.
- Do not mutate a shared checkout for work that should happen in an isolated
  worktree.
- Do not install dependencies or run live services unless workspace policy and
  runner safety allow it.
- Do not delete or clean up an owned worktree until integration status and
  publication policy are clear.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/using-git-worktrees/SKILL.md\`.
This DevNexus adaptation replaces generic worktree fallback behavior with
DevNexus component worktrees, workspace/meta worktrees, setup projection,
coordination handoffs, and shared-checkout guards.
`,
);

const finishDevNexusBranchSkill = adaptedSuperpowersSkill(
  "finish-dev-nexus-branch",
  "finish-dev-nexus-branch",
  "DevNexus branch completion workflow adapted from Superpowers finishing-a-development-branch. Use when implementation is ready to verify, record, publish, hand off, or clean up under component policy and human approval gates.",
  ["skills/finishing-a-development-branch/SKILL.md"],
  `
# Finish DevNexus Branch

Use this skill when a slice or initiative branch is ready for verification,
handoff, publication, or cleanup.

## Workflow

1. Run fresh focused verification first, then the nearest broader relevant
   check. Read the output before making any completion claim.
2. Inspect Git status, diff, commits ahead of the base branch, remotes, and
   upstream. Separate owned changes from unrelated dirty state.
3. Confirm durable records are current: work item status or comment, initiative
   notes, coordination handoff, target-cycle facts, and verification summary.
4. Read the component publication policy and current authority. Do not silently
   fall back to a human account when policy expects an automation actor.
5. If publication is allowed, use the configured remote, credential profile,
   target branch, and review path. For green-main policy, prefer branch or pull
   request validation and required checks before merge.
6. If publication authority is blocked, leave a human handoff with branch name,
   commit ids, verification commands and outcomes, target branch, and the exact
   PR or review action needed.
7. Ask for explicit human approval before merge, release, destructive cleanup,
   force deletion, live-runtime action, or provider mutation that policy marks
   approval-required.
8. Clean up only after integration is factual: fetched target branch, branch is
   merged or intentionally preserved, worktree ownership is clear, and no
   unrelated changes would be lost.
9. Close or move the tracker item only when the publication state matches the
   workspace definition of done, or when the user explicitly chooses a different
   terminal state.

## Handoff Checklist

- Branch and worktree path.
- Tracker anchor and initiative surface.
- Commit ids and changed areas.
- Verification commands with pass, fail, or not-run status.
- Publication decision: direct integration, review handoff, local only,
  blocked, or not decided.
- Human action required, if any.

## Guardrails

- Do not claim work is complete without fresh verification evidence.
- Do not merge, push, open a pull request, delete a branch, or remove a
  worktree without the required policy and approval state.
- Do not hide provider-auth problems by using the wrong account.
- Do not clean up worktrees that another chat or host may still own.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/finishing-a-development-branch/SKILL.md\`.
This DevNexus adaptation changes the finish flow to use component publication
policy, authority checks, App/bot credential expectations, coordination
handoffs, target-cycle facts, and human-in-the-loop approval gates.
`,
);

const executeInitiativePlanSkill = adaptedSuperpowersSkill(
  "execute-initiative-plan",
  "execute-initiative-plan",
  "Plan execution workflow adapted from Superpowers executing-plans. Use when an approved plan should be carried through in the current session with checkpoints, verification, and DevNexus records.",
  ["skills/executing-plans/SKILL.md"],
  `
# Execute Initiative Plan

Use this skill when an approved plan is ready to execute and the work should
accumulate on one initiative or delivery surface.

## Workflow

1. Load the plan and its durable context: tracker anchor, initiative notes,
   Product Requirements Document (PRD), design record, current branch, and
   relevant workspace state.
2. Review the plan before acting. Stop and raise concerns when tasks are
   ambiguous, unsafe, out of date, missing verification, or split across the
   wrong component, artifact, or publication surface.
3. Confirm the current checkout is the intended owned surface. If not, use the
   worktree preparation workflow before editing.
4. Execute one slice at a time. Keep status current, follow referenced companion
   skills, and preserve unrelated dirty changes.
5. Run the verification named by the slice before marking it complete. If the
   named check is unavailable, record why and choose the nearest useful check
   only when the plan permits that substitution.
6. Record progress through the configured DevNexus surface: work-item comment,
   target-cycle fact, coordination handoff, initiative note, or pull request.
7. Stop instead of guessing when a blocker, repeated verification failure,
   unclear requirement, unsafe action, or publication authority issue appears.
8. When all slices are complete, use the branch finishing workflow to verify,
   publish or hand off, and clean up according to policy.

## Guardrails

- Do not start implementation from a plan you have not read critically.
- Do not treat a plan as approval for destructive cleanup, live runtime actions,
  provider writes, cost changes, or publication unless it says so explicitly.
- Do not split one initiative into many unrelated final publications.
- Do not continue after verification fails unless the next step is diagnosis.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/executing-plans/SKILL.md\`.
This DevNexus adaptation changes plan execution to use initiative surfaces,
component ownership, worktree policy, tracker records, and publication gates.
`,
);

const parallelWorkDispatchSkill = adaptedSuperpowersSkill(
  "parallel-work-dispatch",
  "parallel-work-dispatch",
  "Parallel work coordination workflow adapted from Superpowers dispatching-parallel-agents and subagent-driven-development. Use only when independent slices can be delegated safely and the user has asked for subagents or parallel agent work.",
  [
    "skills/dispatching-parallel-agents/SKILL.md",
    "skills/subagent-driven-development/SKILL.md",
  ],
  `
# Parallel Work Dispatch

Use this skill when the user has explicitly asked for subagents or parallel
agent work, and the work can be split into independent domains.

## Workflow

1. Identify the independent domains. Good boundaries are separate components,
   disjoint files, separate tracker items, unrelated failures, or independent
   artifacts with no shared mutable state.
2. Keep the coordinator local to the initiative surface. The coordinator owns
   the plan, branch or artifact set, tracker anchor, integration order, and
   final verification.
3. Assign each worker one bounded task with an explicit write scope, expected
   output, verification command, and handoff format. Tell workers they are not
   alone in the codebase and must not revert edits made by others.
4. Use isolated DevNexus worktrees, disjoint files, or non-overlapping artifact
   paths for mutating work. Avoid parallel edits to the same file unless one
   agent is explicitly the integrator.
5. Dispatch only sidecar work that can progress while the coordinator continues
   useful non-overlapping work. Keep immediate blockers local when waiting would
   stall the critical path.
6. Review returned work before integration: spec fit first, then implementation
   quality, then conflict risk. Ask the worker to fix its own slice when review
   finds issues.
7. Integrate deliberately. Use DevNexus coordination status or integration
   planning when multiple branches or handoffs exist, then run focused and
   broader verification from the integration surface.
8. Record the result in the tracker, target-cycle facts, coordination handoff,
   or pull request so the parallel work does not vanish into chat history.

## Guardrails

- Do not dispatch subagents unless the user explicitly requested subagents,
  delegation, or parallel agent work.
- Do not delegate urgent blocking work when the coordinator's next action
  depends on the result.
- Do not give a worker the whole chat transcript when a focused prompt with
  exact context would be safer.
- Do not accept worker success reports without reviewing diffs and running the
  relevant verification.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source paths:
\`skills/dispatching-parallel-agents/SKILL.md\` and
\`skills/subagent-driven-development/SKILL.md\`.
This DevNexus adaptation adds explicit user authorization for subagents,
DevNexus worktree ownership, disjoint write scopes, integration handoffs, and
target-cycle records.
`,
);

const requestWorkReviewSkill = adaptedSuperpowersSkill(
  "request-work-review",
  "request-work-review",
  "Review-request workflow adapted from Superpowers requesting-code-review. Use before merging, publishing, or proceeding past a meaningful slice to verify requirements, risks, and implementation quality.",
  ["skills/requesting-code-review/SKILL.md"],
  `
# Request Work Review

Use this skill when a slice, artifact, or branch needs independent review
before it becomes the basis for more work, publication, or cleanup.

## Workflow

1. Define the review target: branch range, changed files, document, artifact,
   tracker item, or decision record.
2. Gather review context without dumping history: objective, requirements,
   plan slice, acceptance criteria, base revision, head revision, verification
   already run, and known concerns.
3. Choose the reviewer path that fits the workspace: subagent review when the
   user has asked for subagents, human review when approval is required, or
   provider-native pull request review when publication policy expects it.
4. Ask the reviewer to report findings by severity with concrete file, line,
   artifact, or requirement references. Require blockers to include the
   smallest verification or change that would resolve them.
5. Evaluate the feedback technically before acting. Fix critical and important
   issues before proceeding, document rejected findings with evidence, and keep
   minor follow-ups separate from the current done criteria.
6. Re-run the relevant verification after fixes and update the durable record
   with the review outcome.

## Guardrails

- Do not ask for review without a crisp target and requirements.
- Do not use review as a substitute for running verification.
- Do not proceed past critical or important findings without fixing them or
  recording a reasoned rejection.
- Do not hide required human approval inside an agent-only review.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/requesting-code-review/SKILL.md\`.
This DevNexus adaptation broadens review beyond code while preserving concrete
requirements, revision ranges, severity ordering, and verification evidence.
`,
);

const receiveReviewFeedbackSkill = adaptedSuperpowersSkill(
  "receive-review-feedback",
  "receive-review-feedback",
  "Review-feedback handling workflow adapted from Superpowers receiving-code-review. Use when responding to human, agent, or provider review feedback without blind agreement or unverified changes.",
  ["skills/receiving-code-review/SKILL.md"],
  `
# Receive Review Feedback

Use this skill when review feedback arrives from a human, subagent, pull
request, issue comment, external reviewer, or automated check.

## Workflow

1. Read all feedback before editing. Group items by blocker, correctness,
   requirement gap, quality concern, and optional follow-up.
2. Restate unclear items in technical terms and ask for clarification before
   implementing partial guesses.
3. Verify each suggestion against code, documents, workspace policy, prior
   decisions, and current requirements. External feedback is input to evaluate,
   not an order to follow blindly.
4. Push back with evidence when a suggestion is wrong, harmful, out of scope,
   violates the initiative decision, or adds unused complexity.
5. Implement accepted feedback in a safe order: blockers first, simple fixes,
   then complex changes. Keep unrelated improvements out of the feedback patch.
6. Test each meaningful fix with the smallest relevant verification, then run
   the nearest broader check before claiming the feedback is resolved.
7. Reply or record the outcome where the feedback lives, especially for
   provider-native review threads, work-item comments, and pull requests.

## Guardrails

- Do not use performative agreement as a substitute for technical evaluation.
- Do not batch unclear feedback with understood fixes.
- Do not silently accept suggestions that conflict with prior user decisions.
- Do not mark feedback resolved without fresh verification evidence or a clear
  explanation of why verification was not run.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/receiving-code-review/SKILL.md\`.
This DevNexus adaptation keeps the technical rigor of the upstream review flow
while adding workspace policy, initiative decisions, and provider-thread
recordkeeping.
`,
);

const verifyBeforeCompletionSkill = adaptedSuperpowersSkill(
  "verify-before-completion",
  "verify-before-completion",
  "Verification gate adapted from Superpowers verification-before-completion. Use before claiming work is complete, fixed, ready, published, or safe to hand off.",
  ["skills/verification-before-completion/SKILL.md"],
  `
# Verify Before Completion

Use this skill before claiming that work is complete, fixed, ready, published,
or safe to hand off.

## Workflow

1. Name the claim you are about to make.
2. Identify the command, inspection, review, or artifact check that can prove
   that claim. Use the plan's verification when one exists.
3. Run or perform the check freshly from the owning worktree or artifact
   surface. Read the output, exit code, and failure count before summarizing.
4. If verification fails, state the actual status with evidence and switch to
   diagnosis or feedback handling. Do not soften the failure into a success
   claim.
5. If verification passes, report the command and outcome in the relevant
   durable record: tracker item, target-cycle fact, handoff, pull request, or
   final response.
6. When verification cannot be run, say why, name the residual risk, and avoid
   claiming the unverified property.

## Claim Examples

- "Tests pass" requires fresh test output.
- "Build passes" requires a fresh build command.
- "Bug fixed" requires the original reproduction or an equivalent regression
  check.
- "Requirements met" requires checking the plan or issue criteria, not just a
  green test suite.
- "Ready for review" requires a clean owned diff, current verification, and a
  clear handoff.

## Guardrails

- Do not rely on previous runs, worker reports, assumptions, or partial logs for
  a completion claim. Require fresh verification evidence.
- Do not commit, push, open a pull request, close a work item, or request merge
  while knowingly skipping the verification required by the claim.
- Do not hide failed or skipped verification in optimistic language.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/verification-before-completion/SKILL.md\`.
This DevNexus adaptation routes verification evidence into tracker records,
target-cycle facts, handoffs, pull requests, and final responses.
`,
);

const diagnoseSkill = adaptedSuperpowersSkill(
  "diagnose",
  "diagnose",
  "Systematic debugging workflow adapted from Superpowers systematic-debugging. Use for defects, failed checks, regressions, or unexpected behavior before proposing fixes.",
  ["skills/systematic-debugging/SKILL.md"],
  `
# Diagnose

Use this skill when a defect, failed check, confusing behavior, or broken
workflow needs root-cause analysis before a fix.

## Workflow

1. Reproduce the problem with the smallest command, scenario, fixture, or
   artifact check available. Capture the exact input, output, error, and
   environment.
2. Read the full error and relevant recent changes before proposing fixes.
3. Trace the failing boundary. In a DevNexus workspace, include component
   source roots, generated support state, tracker/provider calls, MCP routing,
   worktree setup, credentials, and publication policy when relevant.
4. Compare against nearby working examples and project patterns. Prefer the
   existing architecture unless evidence shows it is the cause.
5. Form one concrete hypothesis and test it with the smallest change or probe
   that can disprove it.
6. Once the root cause is known, add or identify the failing test, reproduction,
   or verification that proves the problem before implementing the fix.
7. Make the smallest fix that addresses the cause, then verify the reproduction
   and the nearest broader check.
8. Record root cause, fix, verification, and residual risk in the tracker,
   handoff, target-cycle fact, or pull request.

## Guardrails

- Do not patch symptoms before locating the cause.
- Do not stack multiple speculative fixes in one test run.
- Do not skip the reproduction because the issue looks obvious.
- After repeated failed fixes, stop and question the architecture or task
  boundary instead of trying one more guess.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/systematic-debugging/SKILL.md\`.
This DevNexus adaptation adds multi-component workspace boundaries, generated
support state, provider credentials, worktree setup, and durable root-cause
records.
`,
);

const tddSkill = adaptedSuperpowersSkill(
  "tdd",
  "tdd",
  "Test-driven development workflow adapted from Superpowers test-driven-development. Use when adding or changing behavior that can be covered by an automated test or comparable executable check.",
  ["skills/test-driven-development/SKILL.md"],
  `
# Test-Driven Development (TDD)

Use this skill when adding or changing behavior that can be covered by an
automated test or comparable executable check.

## Workflow

1. Identify the behavior, regression, or contract before editing production
   code. If a test framework exists, use the closest focused test file.
2. Write the smallest failing test that expresses one behavior. Use real code
   and realistic fixtures; mock only when the boundary cannot be exercised
   directly.
3. Run the focused test and confirm it fails for the expected reason. A passing
   test or unrelated error is not a valid red state.
4. Implement the smallest change that makes the focused test pass. Avoid
   unrelated cleanup, extra options, or speculative generalization.
5. Run the focused test again and read the output. Fix production code when it
   fails; do not weaken the test to match the implementation.
6. Refactor only while the test remains green. Keep behavior changes and
   structural cleanup distinguishable in the diff.
7. Run the nearest broader relevant check before handoff, commit, or
   publication.
8. Summarize the behavior protected by the test and the verification evidence.

## Guardrails

- Do not write production behavior first and then backfill tests as if that were
  Test-Driven Development (TDD).
- Do not keep untested reference implementation around after deciding TDD is
  required.
- Do not add broad abstractions before a failing test creates pressure for
  them.
- If the work is documentation, operations, or research, choose the equivalent
  executable or reviewable check rather than pretending a unit test is required.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/test-driven-development/SKILL.md\`.
This DevNexus adaptation keeps red-green-refactor discipline while allowing
non-code work to use the nearest executable or reviewable verification.
`,
);

const writeAgentSkillSkill = adaptedSuperpowersSkill(
  "write-agent-skill",
  "write-agent-skill",
  "Agent skill authoring workflow adapted from Superpowers writing-skills. Use when creating or revising DevNexus, component, or plugin skills with concise triggers, metadata, verification, and attribution.",
  ["skills/writing-skills/SKILL.md"],
  `
# Write Agent Skill

Use this skill when creating or revising DevNexus, component, plugin, or
project-local agent skills.

## Workflow

1. Define the trigger first. A skill should activate for a specific recurring
   situation, not because it is an interesting document.
2. Read existing nearby skills before writing. Match local naming, frontmatter,
   scope, supported agents, and projection expectations.
3. Keep the skill short enough to use during real work. Put workflow steps,
   guardrails, required tools, and handoff shape ahead of background rationale.
4. Make it generic when the workflow is generic. Avoid coupling a project-wide
   skill to one component, branch, tracker, or programming-only assumption
   unless that is the point of the skill.
5. Include attribution when adapted from another source: license, upstream
   repository, tag or version, exact commit hash, and source path.
6. Verify the skill materializes through DevNexus support state and projects
   into configured agent-native directories. Add or update focused tests when
   the skill is part of the curated pack.
7. Try the skill on the current workflow if possible, then record notes for the
   next refinement separately from the active skill text.

## Guardrails

- Do not create a bridge skill when the workflow belongs cleanly in the core or
  component skill pack.
- Do not make the skill verbose enough that agents will ignore it.
- Do not import licensed text without preserving the required notice and exact
  provenance.
- Do not write a skill that conflicts with higher-priority agent, workspace, or
  safety instructions.

## Attribution

Adapted from \`obra/superpowers\` version \`5.1.0\` at commit
\`f2cbfbefebbfef77321e4c9abc9e949826bea9d7\`, licensed under MIT by Jesse
Vincent / Prime Radiant. Source path:
\`skills/writing-skills/SKILL.md\`.
This DevNexus adaptation adds curated-pack metadata, projection verification,
license provenance, and generic workflow constraints.
`,
);

export const defaultCoreSkillPack: readonly NexusSkillDefinition[] = [
  curatedCoreSkill(
    "dev-nexus",
    "dev-nexus",
    "DevNexus-managed workspace workflow for using DevNexus infrastructure to plan, triage, slice, implement, verify, publish, automate, coordinate isolated worktrees, and advance work items across components. Use when an agent is asked to work in a DevNexus workspace, use DevNexus, run a DevNexus workflow, advance tracker work, coordinate parallel chats or subagents, or combine DevNexus with companion skills such as to-prd, to-issues, triage, tdd, diagnose, or architecture review.",
    `
# DevNexus

Use this skill when working inside a DevNexus-managed workspace.

1. Read project instructions first: agent context file when set, \`AGENTS.md\` or equivalent, durable workspace context, plan, and target state.
2. Use DevNexus MCP or CLI surfaces for workspace status, component metadata, work-item services, eligible work, agent profiles, worktrees, target-cycle facts, and result contracts. Avoid ad hoc discovery when DevNexus already exposes the fact.
3. Select the right companion skill for the current mode: \`to-prd\` for Product Requirements Document (PRD) synthesis, \`to-issues\` for issue slicing, \`triage\` for vague work, \`tdd\` for Test-Driven Development (TDD), \`diagnose\` for defects, and architecture skills for boundary or refactor decisions.
4. Work through configured component work-item services. Prefer component-qualified work-item ids when a workspace has multiple components, and do not assume a tracker provider; use the provider configured for the owning component.
5. Run a Git freshness preflight before editing a checkout: inspect status, remotes, upstream, and ahead/behind state. Fetch configured remotes when policy allows, fast-forward clean branches with an upstream, and record blockers.
6. Preserve unrelated changes. Treat a shared checkout as read-mostly context unless the task is clearly read-only or already owns that checkout.
7. For mutating parallel work, prepare an isolated Git worktree before editing. Use component-scoped worktrees for component source changes, and use a workspace/meta worktree for DevNexus workspace files such as \`AGENTS.md\`, \`PLAN.md\`, \`CONTEXT.md\`, \`.dev-nexus/**\`, projected skills, target state, or dogfood docs. Prefer DevNexus worktree tools such as \`worktree_prepare\` or \`dev-nexus worktree prepare\` over hand-rolled \`git worktree\` commands.
8. Let configured setup make prepared worktrees usable. For example, JavaScript/TypeScript projects should expose reusable dependencies through a plugin \`dependency_projection\` such as \`node_modules\` -> \`node_modules\`, instead of teaching every agent to repair missing dependencies manually.
9. Choose a bounded batch with clear ownership, acceptance criteria, verification, and publication expectations. Parallelize independent work when safe: split by work item, component, worktree, or disjoint write scope; respect the configured subagent cap; keep each worker's ownership explicit.
10. Run source and Git commands from the assigned worktree. Stage only files owned by that worktree and avoid committing unrelated workspace-state or tracker files from another chat.
11. Record progress through DevNexus: set work-item state when starting or finishing, add concise progress or blocker comments, record target-cycle facts, and use coordination handoffs for \`working\`, \`ready\`, \`blocked\`, or \`merged\` worktree branches.
12. Before integrating parallel chat branches, use DevNexus coordination status or integration planning to check related branches, stale handoffs, unpushed commits, conflicts, and verification order.
13. Verify with focused checks first, then broader relevant checks when feasible. Publish only according to component publication policy.
14. After direct integration or merge, fetch/prune, confirm work branches are ancestors of the target branch, remove disposable worktrees, and delete merged local and remote review branches. Preserve dirty or ambiguous branches with an explicit handoff.
15. When running under a DevNexus-launched cycle, write the configured result file with status, summary, commits, verification, publication decision, and error or blocker details before exiting.
`,
  ),
  curatedCoreSkill(
    "initiative-workflow",
    "initiative-workflow",
    "Long-lived initiative workflow for multi-step work across code, docs, research, operations, planning, or coordination where slices should accumulate under one durable objective, tracker anchor, and integration or publication surface. Use when the user says initiative, feature, bugfix campaign, release train, research project, documentation rewrite, long-running workflow, or asks to avoid scattered pull requests, artifacts, or status threads.",
    `
# Initiative Workflow

Use this skill when work should continue across multiple slices, turns,
agents, artifacts, approvals, or review surfaces before final delivery. Do not
use it for small one-turn tasks that can be finished and verified directly.

An initiative is a durable work frame with one objective, one tracker anchor,
one integration surface, and explicit done criteria. It is the outer frame for
coherent long-running work, not a separate "take the lead" persona or a
project-management ceremony. The surface may be a Git branch, pull request,
artifact directory, document set, tracker epic, release train, coordination
record, or another project-owned place where slices accumulate.

## Workflow

1. Establish the frame: objective, reason, owner or coordinator, tracker
   anchor, expected outputs, constraints, non-goals, and done criteria.
2. Choose the integration surface before the first slice. For Git-backed work,
   use one branch or review surface; for non-code work, choose the document set,
   artifact directory, tracker, release train, or coordination record.
3. Inventory current state: prior decisions, active branches or artifacts,
   verification already run, blockers, and unrelated work that must be
   preserved.
4. Slice by independently reviewable progress. Each slice needs one owner, one
   scope, one verification path, and a clear contribution to the initiative
   surface.
5. Route every slice back to the initiative surface. If a slice wants a new
   surface or objective, decide whether it belongs here or should become a
   separate initiative.
6. Keep a compact initiative log: decisions, blockers, provenance, review
   state, verification, publication status, and handoffs. In a DevNexus
   workspace, prefer work items, target-cycle facts, coordination handoffs, and
   publication policy over ad hoc notes.
7. Make recommendations at scope, risk, approval, and publication gates, but
   the user decides. Do not infer approval from silence or unrelated status
   changes.
8. Reassess periodically. If the objective, risk, or done criteria changed,
   update the frame, split the work, or stop before more slices accumulate.
9. Publish or close only when the initiative is coherent, reviewed, verified,
   approved where required, and meets its done criteria.
10. Close with a compact handoff: what shipped, what was verified, what remains,
    and where the durable record lives.

## Companion Skills

Use this as the outer frame. Use design, planning, worktree, execution, review,
verification, diagnosis, and handoff skills for the slices themselves.

## Guardrails

- Keep the initiative generic; do not force all work into a programming model.
- Prefer one final publication path over many unrelated final publications,
  unless the initiative explicitly owns multiple coordinated surfaces.
- Do not let the initiative hide unrelated work, unresolved blockers, or
  unreviewed risky changes.
- Do not turn a small direct fix into ceremony.
- Do not couple the workflow to a generic "take the lead" skill; normal
  collaboration rules still apply.
- Refine the workflow notes separately when the skill needs more detail.
`,
  ),
  curatedCoreSkill(
    "take-the-lead",
    "take-the-lead",
    "Agent-led collaboration workflow for when the user asks the agent to lead, drive, coordinate, decide the next steps, or act like a team lead while the user keeps final decision authority. Use when the user says take the lead, drive this, lead the work, be the team lead, keep us moving, or asks for role reversal where the agent recommends and executes while the user decides at gates.",
    `
# Take The Lead

Use this skill when the user explicitly asks the agent to lead the work or
reverse the usual roles. Agent leads the process; the user decides goals,
constraints, approvals, and final direction.

## Operating Contract

1. State the objective, your recommended next step, and the assumptions you are
   making.
2. Gather context before asking questions. Ask only for decisions the user must
   make, and include your recommendation when you have one.
3. Keep momentum: choose the next reversible action, execute it, then report the
   result and next decision point.
4. Make tradeoffs explicit. Prefer "I recommend X because Y; the cost is Z" over
   open-ended option dumps.
5. Track commitments, blockers, verification, and the next action so the user
   can decide from state, not from memory.
6. Pause for human-in-the-loop decisions at scope, risk, cost, safety,
   credentials, external provider writes, publication, destructive cleanup, or
   live runtime gates.
7. Close loops. When a decision is made, record what changed and continue from
   that decision instead of relitigating it.

## Pairing

- Use \`initiative-workflow\` when the led work spans multiple slices or surfaces.
- Use design, planning, diagnosis, review, verification, and handoff skills for
  the actual work mode.
- In a DevNexus workspace, record durable facts through work items,
  target-cycle facts, coordination handoffs, and publication policy.

## Guardrails

- Do not seize control when the user asked for a direct answer, review, or small
  fix.
- Do not treat your recommendation as approval. The user decides at gates.
- Do not hide uncertainty; lead by making uncertainty explicit and reducing it.
- Do not override higher-priority instructions, workspace policy, or safety
  gates.
- Do not create status theater. Keep updates short, concrete, and tied to the
  next decision or action.

## Reference

OpenAI's Agents SDK human-in-the-loop guide describes the approval pattern this
skill follows at decision gates: pause sensitive action, surface the pending
decision, approve or reject, then resume from durable state.
Source: openai/openai-agents-python docs/human_in_the_loop.md at
45effb4b7d7de1226ebba7ba304bccfcf0a37fdf.
https://github.com/openai/openai-agents-python/blob/45effb4b7d7de1226ebba7ba304bccfcf0a37fdf/docs/human_in_the_loop.md
https://openai.github.io/openai-agents-python/human_in_the_loop/
`,
  ),
  designWithUserSkill,
  grillMeSkill,
  writeImplementationPlanSkill,
  executeInitiativePlanSkill,
  prepareDevNexusWorktreeSkill,
  parallelWorkDispatchSkill,
  requestWorkReviewSkill,
  receiveReviewFeedbackSkill,
  verifyBeforeCompletionSkill,
  finishDevNexusBranchSkill,
  diagnoseSkill,
  tddSkill,
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

1. Identify the owning workspace component, source root, and work-item service.
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
3. Record where work items live for each relevant component: configured DevNexus tracker, GitHub Issues, GitLab Issues, Jira, Linear, local work items, or another workspace-specific tracker.
4. Record triage labels or status values for the canonical flow: needs triage, needs information, autonomous agent-ready (AFK), ready for human, and will not fix.
5. Record domain-document layout: single-context \`CONTEXT.md\`, multi-context \`CONTEXT-MAP.md\`, and where Architecture Decision Records (ADRs) live.
6. Draft the exact changes before writing: an \`Agent skills\` section in the existing agent instruction file, plus \`docs/agents/issue-tracker.md\`, \`docs/agents/triage-labels.md\`, and \`docs/agents/domain.md\`.
7. Edit the existing agent instruction file. If both \`CLAUDE.md\` and \`AGENTS.md\` exist, prefer the one already used by the project; if neither exists, ask before creating one.
8. Preserve unrelated instructions and update an existing \`Agent skills\` section in place rather than appending a duplicate.
9. Keep generated setup docs local to the project. Do not include external catalog or author names in generated skill names, headings, or operational instructions.
`,
  ),
  writeAgentSkillSkill,
  curatedCoreSkill(
    "grill-with-docs",
    "grill-with-docs",
    "Evidence-backed plan-grilling workflow for stress-testing product or architecture decisions against code, domain vocabulary, glossary docs, and Architecture Decision Records. Use when the challenge depends on durable project knowledge, not for general plan interrogation.",
    `
# Grill With Docs

Use this skill when a plan, design, or feature direction needs to be challenged
against durable project knowledge before implementation. This is not the
general "grill me" interview mode; it is the docs, vocabulary, Architecture
Decision Record (ADR), and code-reality variant.

1. Read existing domain documentation first: root \`CONTEXT.md\`, \`CONTEXT-MAP.md\`, and nearby \`docs/adr\` files when they exist.
2. Cross-check the user's plan against code reality, existing glossary terms, and Architecture Decision Records (ADRs).
3. Ask one evidence-backed question at a time. Include your recommended answer, and explore the codebase instead of asking when the answer is discoverable.
4. Challenge overloaded or vague words immediately. Propose one canonical term and record avoided aliases when the user confirms it.
5. Capture resolved domain vocabulary in \`CONTEXT.md\` as a glossary, not a specification or implementation note.
6. Offer an Architecture Decision Record only for decisions that are hard to reverse, surprising without context, and based on a real trade-off.
7. Keep documentation updates small and inline with the conversation so decisions are not lost between runs.

Use \`grill-me\` for a general one-question-at-a-time interrogation of a plan.
Use \`design-with-user\` when the goal is collaborative shaping rather than
challenge. Use \`architecture-review\` when the main task is evaluating module
boundaries or long-lived contracts.

Glossary entries should define workspace-specific concepts in one sentence, list avoided aliases where useful, and describe important relationships. Architecture Decision Records should briefly state the context, decision, and reason; optional sections belong only when they add real value.
`,
  ),
  curatedCoreSkill(
    "documentation",
    "documentation",
    "Documentation writing and README maintenance workflow for creating, auditing, and updating clear user-facing technical docs. Use when writing or revising README files, getting-started guides, user docs, agent onboarding docs, CLI examples, terminology sections, or docs that need a final anti-AI style pass.",
    `
# Documentation

Use this skill when creating, auditing, or updating README files, getting-started guides, user docs, agent onboarding docs, CLI examples, terminology sections, or release-facing documentation.

## Workflow

1. Identify the reader and their first successful action. A README should answer what this is, why it is useful, how to start, where to get help, and where deeper docs live.
2. Read the current code, CLI help, tests, package metadata, and nearby docs before writing. Do not invent commands, options, support status, provider behavior, or product claims.
3. Put the fastest credible path early. Installation and the first runnable command usually belong before long terminology, architecture, or provider detail.
4. Define terms before relying on them. Use one canonical term consistently and avoid overloaded words when a simpler noun works.
5. Keep README content short and skimmable. Move reference detail, provider-specific setup, edge cases, and long rationale into linked docs.
6. Prefer general examples over dogfood, internal, or unusually specialized examples. Use specific names only when they help the target reader recognize the shape.
7. Keep examples copyable and truthful. Use placeholders only when the user must substitute a value. If a wizard asks for a value, do not also require it in the quick-start command unless scripting needs it.
8. Update docs with code and tests when behavior changes. Delete stale docs rather than preserving half-correct history in the active path.
9. Validate links, command examples, and generated output where feasible. Add focused documentation tests when the project already has docs guardrails.
10. Finish by using the \`humanizer\` companion skill for the prose-polish pass, then re-check that technical claims, commands, warnings, and terms stayed precise.

## README Shape

Use this shape by default, then adapt to the project:

1. One-sentence purpose.
2. Short explanation of what the project creates or enables.
3. Install.
4. Minimal terms only if the quick start needs them.
5. Quick start with the shortest working path.
6. A small example that matches common industry use, not an internal edge case.
7. Common next steps and readiness checks.
8. Links to deeper documentation, contribution, support, and maintainer information.

Long architecture, all command variants, provider-specific auth, historical design notes, and troubleshooting matrices belong in docs, not the README fast path.

## Style Rules

- Use direct, ordinary language. Prefer "is", "has", "uses", and "run" over inflated verbs.
- Start sections with the answer, not a throat-clearing sentence.
- Use sentence case headings unless the project style says otherwise.
- Keep paragraphs short. Use bullets for scanning, not for every sentence.
- Preserve necessary repetition when it helps readers succeed. Documentation is allowed to repeat important facts that code already encodes.
- Link with descriptive text. Avoid "click here" and broken multiline links.
- Keep version-sensitive facts either generated, tested, or clearly scoped.
- When using an external style guide, follow workspace-specific style first, then the external guide.

## Humanizer Pairing

Use the vendored \`humanizer\` skill after the documentation structure is correct.
Documentation decides what belongs where; humanizer improves how the prose
sounds. Do not let polish change commands, facts, warnings, status, provider
support, or project vocabulary.

## Sources To Consult When Needed

- [GitHub Docs, "About READMEs"](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes): README files should explain what the project does, why it is useful, how to get started, where to get help, and who maintains it.
- [Google README guidance](https://google.github.io/styleguide/docguide/READMEs.html): README files are short directory summaries; package READMEs should explain use, status, contacts, and links to deeper docs.
- [Write the Docs documentation principles](https://www.writethedocs.org/guide/writing/docs-principles/): docs should be skimmable, current, discoverable, addressable, and close to the code they describe.
- [Google developer documentation style guide](https://developers.google.com/style): prefer workspace-specific style first; clarity and consistency matter more than rigid rules.
- [Google documentation best practices](https://google.github.io/styleguide/docguide/best_practices.html): update docs with code, keep minimum viable documentation fresh, and treat design docs as archives once implementation lands.
- [blader/humanizer](https://github.com/blader/humanizer) and [Wikipedia "Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing): use the vendored \`humanizer\` companion skill to remove inflated, vague, formulaic, and chatbot-like prose.
`,
  ),
  humanizerSkill,
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
        ? "skill is installed but is not selected by workspace configuration"
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
  const configuredAgentTargets =
    options.agentTargets ?? options.skillsConfig?.agentTargets ?? [];
  const agentTargets = configuredAgentTargets
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
