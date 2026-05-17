import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  coordinationRequestCommentMarker,
  createLocalWorkTrackerProvider,
  createNexusCoordinationRequest,
  loadLocalWorkTrackingStore,
  parseNexusCoordinationRequestIntent,
  parseNexusCoordinationRequestStatus,
  saveProjectConfig,
  type GitCommandResult,
  type GitRunner,
  type NexusProjectConfig,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(
  sourceRoot: string,
  worktreesRoot: string,
  storePath: string,
): NexusProjectConfig {
  return {
    version: 1,
    id: "coordination-request-demo",
    name: "Coordination Request Demo",
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    components: [
      {
        id: "dev-nexus",
        name: "DevNexus",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/dev-nexus.git",
        defaultBranch: "main",
        sourceRoot,
        worktreesRoot,
        workTracking: {
          provider: "local",
          storePath,
        },
        relationships: [],
      },
    ],
  };
}

function fakeGitRunner(repositoryPath: string): GitRunner {
  return (args: readonly string[]): GitCommandResult => {
    const argsArray = [...args];
    const joined = argsArray.join(" ");
    if (joined === "rev-parse --show-toplevel") {
      return ok(argsArray, `${repositoryPath}\n`);
    }
    if (joined === "symbolic-ref --short HEAD") {
      return ok(argsArray, "codex/external-coordination\n");
    }
    if (joined === "rev-parse HEAD") {
      return ok(argsArray, "abc123def456\n");
    }
    if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return ok(argsArray, "origin/codex/external-coordination\n");
    }
    if (joined === "status --porcelain=v1") {
      return ok(argsArray, "");
    }
    if (joined === "rev-list --left-right --count HEAD...@{u}") {
      return ok(argsArray, "0\t0\n");
    }

    return ok(argsArray, "");
  };
}

function ok(args: string[], stdout: string): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

async function createFixture(): Promise<{
  projectRoot: string;
  sourceRoot: string;
  worktreePath: string;
  storePath: string;
}> {
  const projectRoot = makeTempDir("dev-nexus-coordination-request-project-");
  const sourceRoot = path.join(projectRoot, "source");
  const worktreePath = path.join(
    projectRoot,
    "worktrees",
    "dev-nexus",
    "local-17",
  );
  const storePath = ".dev-nexus/work-items-dev-nexus.json";
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(worktreePath, { recursive: true });
  saveProjectConfig(projectRoot, projectConfig(sourceRoot, "worktrees/dev-nexus", storePath));
  await createLocalWorkTrackerProvider({
    projectRoot,
    config: { provider: "local", storePath },
    now: () => "2026-05-17T09:00:00.000Z",
  }).createWorkItem({
    projectRoot,
    title: "External coordination request",
    status: "in_progress",
  });

  return { projectRoot, sourceRoot, worktreePath, storePath };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus coordination requests", () => {
  it("records draft provider-neutral approval requests as local coordination comments", async () => {
    const { projectRoot, worktreePath, storePath } = await createFixture();

    const result = await createNexusCoordinationRequest({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      intent: "approval",
      question: "Approve the provider-neutral request shape?",
      note: "Live posting is not approved, so draft only.",
      target: "github-pr:42",
      hostId: "windows-devbox",
      agentId: "codex",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath),
      now: () => "2026-05-17T10:00:00.000Z",
    });

    expect(result.record).toMatchObject({
      kind: "dev-nexus.coordination.request",
      version: 1,
      projectId: "coordination-request-demo",
      componentId: "dev-nexus",
      workItemId: "local-1",
      hostId: "windows-devbox",
      agentId: "codex",
      intent: "approval",
      status: "waiting",
      question: "Approve the provider-neutral request shape?",
      target: {
        kind: "github_pull_request",
        provider: "github",
        value: "42",
      },
      provider: {
        provider: "github",
        surface: "pull_request",
        mode: "draft",
        posted: false,
        credentialsUsed: false,
        mockFlow: [
          {
            action: "draft_review_request",
          },
          {
            action: "read_reviews",
          },
        ],
      },
      git: {
        branch: "codex/external-coordination",
        headCommit: "abc123def456",
        pushed: true,
      },
      response: null,
    });
    expect(result.comment?.body).toContain(coordinationRequestCommentMarker);
    const store = loadLocalWorkTrackingStore(path.join(projectRoot, storePath));
    expect(store.comments["local-1"]?.[0]?.body).toContain(
      "DevNexus coordination request",
    );
  });

  it("normalizes component-qualified request work item ids before local tracker lookup", async () => {
    const { projectRoot, worktreePath, storePath } = await createFixture();

    const result = await createNexusCoordinationRequest({
      projectRoot,
      workItemId: "dev-nexus:local-1",
      intent: "feedback",
      question: "Does the qualified id route to the component tracker?",
      currentPath: projectRoot,
      gitRunner: fakeGitRunner(worktreePath),
      now: () => "2026-05-17T10:00:00.000Z",
    });

    expect(result).toMatchObject({
      component: {
        id: "dev-nexus",
      },
      workItem: {
        id: "local-1",
        title: "External coordination request",
      },
      record: {
        componentId: "dev-nexus",
        workItemId: "local-1",
        target: {
          kind: "work_item",
          value: "local-1",
        },
      },
      comment: {
        id: "local-comment-1",
      },
    });
    const store = loadLocalWorkTrackingStore(path.join(projectRoot, storePath));
    expect(store.comments["local-1"]?.[0]?.body).toContain(
      "Does the qualified id route to the component tracker?",
    );
  });

  it.each([
    ["github-issue:17", "github", "issue", "draft_comment", "read_comments"],
    ["github-pr:18", "github", "pull_request", "draft_review_request", "read_reviews"],
    ["gitlab-issue:19", "gitlab", "issue", "draft_note", "read_notes"],
    ["gitlab-mr:20", "gitlab", "merge_request", "draft_note", "read_notes"],
    ["jira:DN-21", "jira", "issue", "draft_comment", "read_comments"],
  ])(
    "maps %s to a mocked provider draft/read flow",
    async (target, provider, surface, draftAction, readAction) => {
      const { projectRoot, worktreePath } = await createFixture();

      const result = await createNexusCoordinationRequest({
        projectRoot,
        workItemId: "local-1",
        intent: "feedback",
        question: "What should the next agent know?",
        target,
        currentPath: worktreePath,
        gitRunner: fakeGitRunner(worktreePath),
        now: () => "2026-05-17T10:00:00.000Z",
      });

      expect(result.record.provider).toMatchObject({
        provider,
        surface,
        mode: "draft",
        posted: false,
        credentialsUsed: false,
        mockFlow: [
          {
            action: draftAction,
          },
          {
            action: readAction,
          },
        ],
      });
    },
  );

  it("summarizes mocked provider responses into neutral request records", async () => {
    const { projectRoot, worktreePath } = await createFixture();

    const result = await createNexusCoordinationRequest({
      projectRoot,
      workItemId: "local-1",
      intent: "review",
      question: "Is the draft API acceptable?",
      target: "jira:DN-21",
      responseStatus: "changes_requested",
      responseSummary: "Reviewer asked for explicit response status mapping.",
      responder: "reviewer-a",
      requestedChanges: ["Document all neutral statuses."],
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath),
      now: () => "2026-05-17T10:30:00.000Z",
    });

    expect(result.record).toMatchObject({
      status: "changes_requested",
      response: {
        status: "changes_requested",
        responder: "reviewer-a",
        summary: "Reviewer asked for explicit response status mapping.",
        requestedChanges: ["Document all neutral statuses."],
      },
    });
    expect(result.comment?.body).toContain(
      "Response: Reviewer asked for explicit response status mapping.",
    );
  });

  it("accepts the provider-neutral intent and status vocabulary", () => {
    expect(
      ["approval", "feedback", "choice", "review"].map((value) =>
        parseNexusCoordinationRequestIntent(value, "intent"),
      ),
    ).toEqual(["approval", "feedback", "choice", "review"]);
    expect(
      [
        "waiting",
        "answered",
        "approved",
        "changes_requested",
        "timed_out",
        "blocked",
      ].map((value) => parseNexusCoordinationRequestStatus(value, "status")),
    ).toEqual([
      "waiting",
      "answered",
      "approved",
      "changes_requested",
      "timed_out",
      "blocked",
    ]);
  });
});
