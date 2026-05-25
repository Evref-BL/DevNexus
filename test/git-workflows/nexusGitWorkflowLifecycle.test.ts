import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNexusGitWorkflowRun,
  readNexusGitWorkflowRunStore,
  transitionNexusGitWorkflowRunLifecycle,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus Git workflow lifecycle transitions", () => {
  it("pauses a run with a resumable human handoff", () => {
    const projectRoot = createRunProject();

    const paused = transitionNexusGitWorkflowRunLifecycle({
      projectRoot,
      id: "run-1",
      action: "pause",
      reason: "Waiting for maintainer review.",
      owner: {
        kind: "human",
        id: "maintainer",
      },
      now: "2026-05-25T11:00:00.000Z",
    });

    expect(paused).toMatchObject({
      status: "paused",
      terminalOutcome: null,
      owner: {
        kind: "human",
        id: "maintainer",
      },
      allowedTransitions: [
        {
          id: "resume",
          to: "working",
          requiresApproval: false,
        },
        {
          id: "abandon",
          to: "abandoned",
          requiresApproval: true,
        },
        {
          id: "archive",
          to: "archived",
          requiresApproval: true,
        },
        {
          id: "rescue",
          to: "rescued",
          requiresApproval: true,
        },
      ],
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: "pause",
          kind: "handoff",
          summary: "Waiting for maintainer review.",
        }),
      ]),
    });
  });

  it("aborts a clean run as a terminal cleanup outcome", () => {
    const projectRoot = createRunProject();

    const aborted = transitionNexusGitWorkflowRunLifecycle({
      projectRoot,
      id: "run-1",
      action: "abort",
      reason: "No durable work was created.",
      git: {
        dirty: false,
        unpushedCommits: false,
      },
      now: "2026-05-25T11:05:00.000Z",
    });

    expect(aborted).toMatchObject({
      status: "aborted",
      terminalOutcome: "aborted",
      owner: {
        kind: "none",
        id: null,
      },
      allowedTransitions: [],
    });
  });

  it("requires preservation before abandoning dirty or unpushed work", () => {
    const projectRoot = createRunProject();

    expect(() =>
      transitionNexusGitWorkflowRunLifecycle({
        projectRoot,
        id: "run-1",
        action: "abandon",
        reason: "Stop this attempt.",
        git: {
          dirty: true,
          unpushedCommits: true,
        },
        now: "2026-05-25T11:10:00.000Z",
      }),
    ).toThrow(/requires a rescue branch or archive record/);

    expect(readNexusGitWorkflowRunStore(projectRoot).runs[0]).toMatchObject({
      status: "working",
      terminalOutcome: null,
      preservation: null,
    });
  });

  it("archives and rescues runs only with matching preservation evidence", () => {
    const archiveRoot = createRunProject("archive-run");
    const archived = transitionNexusGitWorkflowRunLifecycle({
      projectRoot: archiveRoot,
      id: "archive-run",
      action: "archive",
      reason: "Saved the patch in the tracker.",
      preservation: {
        kind: "archive_record",
        summary: "Archived patch in issue comment.",
        url: "https://github.example.invalid/issues/1#comment",
      },
      now: "2026-05-25T11:15:00.000Z",
    });

    expect(archived).toMatchObject({
      status: "archived",
      terminalOutcome: "archived",
      preservation: {
        kind: "archive_record",
        summary: "Archived patch in issue comment.",
        url: "https://github.example.invalid/issues/1#comment",
        recordedAt: "2026-05-25T11:15:00.000Z",
      },
    });

    const rescueRoot = createRunProject("rescue-run");
    expect(() =>
      transitionNexusGitWorkflowRunLifecycle({
        projectRoot: rescueRoot,
        id: "rescue-run",
        action: "rescue",
        reason: "Copied work elsewhere.",
        preservation: {
          kind: "archive_record",
          summary: "Wrong preservation kind.",
        },
        now: "2026-05-25T11:20:00.000Z",
      }),
    ).toThrow(/requires rescue_branch preservation/);

    const rescued = transitionNexusGitWorkflowRunLifecycle({
      projectRoot: rescueRoot,
      id: "rescue-run",
      action: "rescue",
      reason: "Copied work to rescue branch.",
      preservation: {
        kind: "rescue_branch",
        ref: "rescue/github-359",
        summary: "Copied work to a rescue branch.",
      },
      now: "2026-05-25T11:25:00.000Z",
    });

    expect(rescued).toMatchObject({
      status: "rescued",
      terminalOutcome: "rescued",
      preservation: {
        kind: "rescue_branch",
        ref: "rescue/github-359",
      },
    });
  });
});

function createRunProject(id = "run-1"): string {
  const projectRoot = makeTempDir("dev-nexus-git-workflow-lifecycle-");
  fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
  createNexusGitWorkflowRun({
    projectRoot,
    id,
    projectId: "demo-project",
    componentId: "core",
    profileId: "protected-feature",
    branchName: "feat/demo/change",
    currentRef: "feat/demo/change",
    baseRef: "origin/main",
    baseCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    targetBranch: "main",
    owner: {
      kind: "agent",
      id: "codex",
    },
    now: "2026-05-25T10:00:00.000Z",
  });
  return projectRoot;
}
