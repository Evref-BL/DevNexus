import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  coordinationRequestCommentMarker,
  createLocalWorkTrackerProvider,
  createNexusCoordinationRequest,
  defaultNexusAutomationConfig,
  loadLocalWorkTrackingStore,
  parseNexusCoordinationRequestIntent,
  parseNexusCoordinationRequestStatus,
  saveProjectConfig,
  type GitCommandResult,
  type GitRunner,
  type NexusAuthorityConfig,
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

function authorityProjectConfig(
  sourceRoot: string,
  worktreesRoot: string,
  storePath: string,
  actorId: "observer-bot" | "contributor-bot",
): NexusProjectConfig {
  return {
    ...projectConfig(sourceRoot, worktreesRoot, storePath),
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "local_only",
        actor: {
          id: actorId,
          kind: "machine_user",
          provider: "github",
          handle: actorId,
        },
      },
    },
    authority: coordinationRequestAuthority(),
  };
}

function coordinationRequestAuthority(): NexusAuthorityConfig {
  return {
    actors: [
      {
        id: "observer-bot",
        kind: "machine_user",
        provider: "github",
        providerIdentity: "observer-bot",
        displayName: "Observer Bot",
      },
      {
        id: "contributor-bot",
        kind: "machine_user",
        provider: "github",
        providerIdentity: "contributor-bot",
        displayName: "Contributor Bot",
      },
    ],
    roleBindings: [
      {
        actorId: "observer-bot",
        roles: ["observer"],
        scope: { component: "dev-nexus" },
      },
      {
        actorId: "contributor-bot",
        roles: ["contributor"],
        scope: { component: "dev-nexus" },
      },
    ],
  };
}

function externalFeedbackTrackerProjectConfig(options: {
  sourceRoot: string;
  worktreesRoot: string;
  primaryStorePath: string;
  feedbackStorePath?: string;
  feedbackProvider?: "local" | "github";
}): NexusProjectConfig {
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
        sourceRoot: options.sourceRoot,
        worktreesRoot: options.worktreesRoot,
        defaultWorkTrackerId: "primary",
        workTrackers: [
          {
            id: "primary",
            name: "Primary",
            enabled: true,
            roles: ["primary"],
            workTracking: {
              provider: "local",
              storePath: options.primaryStorePath,
            },
          },
          {
            id: "feedback",
            name: "External Feedback",
            enabled: true,
            roles: ["external_feedback"],
            workTracking:
              options.feedbackProvider === "github"
                ? {
                    provider: "github",
                    repository: {
                      owner: "example",
                      name: "coordination",
                    },
                  }
                : {
                    provider: "local",
                    storePath:
                      options.feedbackStorePath ??
                      ".dev-nexus/work-items-feedback.json",
                  },
          },
        ],
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

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function writeTrackerLink(options: {
  projectRoot: string;
  logicalItemId: string;
  trackerId: string;
  trackerName: string;
  itemId: string;
  timestamp: string;
}): void {
  writeText(
    path.join(options.projectRoot, ".dev-nexus", "work-item-links.json"),
    `${JSON.stringify(
      {
        version: 1,
        nextAuditNumber: 1,
        updatedAt: options.timestamp,
        records: [
          {
            projectId: "coordination-request-demo",
            componentId: "dev-nexus",
            logicalItemId: options.logicalItemId,
            createdAt: options.timestamp,
            updatedAt: options.timestamp,
            references: [
              {
                trackerId: options.trackerId,
                trackerName: options.trackerName,
                provider: "local",
                host: null,
                repositoryId: null,
                repositoryOwner: null,
                repositoryName: null,
                projectId: null,
                boardId: null,
                itemId: options.itemId,
                itemNumber: null,
                itemKey: null,
                nodeId: null,
                webUrl: null,
                firstObservedAt: options.timestamp,
                lastObservedAt: options.timestamp,
              },
            ],
            audit: [],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
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

  it("records request comments on a linked external-feedback tracker", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-request-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(
      projectRoot,
      "worktrees",
      "dev-nexus",
      "local-50",
    );
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const feedbackStorePath = ".dev-nexus/work-items-feedback.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      externalFeedbackTrackerProjectConfig({
        sourceRoot,
        worktreesRoot: "worktrees/dev-nexus",
        primaryStorePath,
        feedbackStorePath,
      }),
    );
    const primaryItem = await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: () => "2026-05-18T08:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Primary feedback item",
      status: "in_progress",
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: feedbackStorePath },
      now: () => "2026-05-18T08:01:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Unrelated feedback item",
      status: "ready",
    });
    const feedbackItem = await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: feedbackStorePath },
      now: () => "2026-05-18T08:02:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Feedback mirror item",
      status: "in_progress",
    });
    writeTrackerLink({
      projectRoot,
      logicalItemId: primaryItem.id,
      trackerId: "feedback",
      trackerName: "External Feedback",
      itemId: feedbackItem.id,
      timestamp: "2026-05-18T08:03:00.000Z",
    });

    const result = await createNexusCoordinationRequest({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: primaryItem.id,
      intent: "feedback",
      question: "Can this request use the feedback tracker?",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath),
      now: () => "2026-05-18T08:10:00.000Z",
    });

    expect(result).toMatchObject({
      requestTracker: {
        trackerId: "feedback",
        selection: "role",
      },
      workItem: {
        id: primaryItem.id,
        title: "Primary feedback item",
        trackerRef: {
          trackerId: "primary",
        },
      },
      record: {
        logicalItemId: primaryItem.id,
        selectedWorkItemRef: {
          trackerId: "primary",
          itemId: primaryItem.id,
        },
        requestRecordTargetRef: {
          trackerId: "feedback",
          itemId: feedbackItem.id,
        },
      },
      comment: {
        trackerRef: {
          trackerId: "feedback",
          default: false,
        },
      },
    });
    expect(
      loadLocalWorkTrackingStore(path.join(projectRoot, primaryStorePath))
        .comments[primaryItem.id],
    ).toEqual([]);
    expect(
      loadLocalWorkTrackingStore(path.join(projectRoot, feedbackStorePath))
        .comments[feedbackItem.id],
    ).toHaveLength(1);
  });

  it("keeps live external-feedback posting as a mocked draft", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-request-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(
      projectRoot,
      "worktrees",
      "dev-nexus",
      "local-51",
    );
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      externalFeedbackTrackerProjectConfig({
        sourceRoot,
        worktreesRoot: "worktrees/dev-nexus",
        primaryStorePath,
        feedbackProvider: "github",
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: () => "2026-05-18T08:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Primary GitHub feedback item",
      status: "in_progress",
    });

    const result = await createNexusCoordinationRequest({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      intent: "review",
      question: "Review the external-feedback draft?",
      target: "github-issue:17",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath),
      now: () => "2026-05-18T08:10:00.000Z",
    });

    expect(result).toMatchObject({
      requestTracker: {
        trackerId: "feedback",
        provider: "github",
      },
      record: {
        target: {
          kind: "github_issue",
          provider: "github",
          value: "17",
          externalRef: {
            repositoryOwner: "example",
            repositoryName: "coordination",
            itemNumber: 17,
            webUrl: "https://github.com/example/coordination/issues/17",
          },
        },
        provider: {
          provider: "github",
          surface: "issue",
          mode: "draft",
          posted: false,
          credentialsUsed: false,
        },
      },
      comment: null,
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("live external provider posting is disabled"),
      ]),
    );
  });

  it("keeps coordination request drafts when provider and comment authority are blocked", async () => {
    const { projectRoot, sourceRoot, worktreePath, storePath } =
      await createFixture();
    saveProjectConfig(
      projectRoot,
      authorityProjectConfig(
        sourceRoot,
        "worktrees/dev-nexus",
        storePath,
        "observer-bot",
      ),
    );

    const result = await createNexusCoordinationRequest({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      intent: "feedback",
      question: "Can an observer post this provider comment?",
      target: "github-issue:17",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath),
      now: () => "2026-05-18T08:20:00.000Z",
    });

    expect(result.record.provider).toMatchObject({
      provider: "github",
      surface: "issue",
      mode: "draft",
      posted: false,
      postingDisposition: "draft_authority_blocked",
      blockedMutation: {
        action: "provider.comment",
        fallbackAction: "coordination.handoff",
      },
    });
    expect(result.comment).toBeNull();
    expect(result.blockedMutations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "provider.comment" }),
        expect.objectContaining({ action: "work_item.comment" }),
      ]),
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("authority blocked provider.comment"),
        expect.stringContaining("authority blocked work_item.comment"),
      ]),
    );
    const store = loadLocalWorkTrackingStore(path.join(projectRoot, storePath));
    expect(store.comments["local-1"]).toEqual([]);
  });

  it("allows coordination request comments while leaving permitted provider posting as a draft", async () => {
    const { projectRoot, sourceRoot, worktreePath, storePath } =
      await createFixture();
    saveProjectConfig(
      projectRoot,
      authorityProjectConfig(
        sourceRoot,
        "worktrees/dev-nexus",
        storePath,
        "contributor-bot",
      ),
    );

    const result = await createNexusCoordinationRequest({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      intent: "feedback",
      question: "Can a contributor draft this provider comment?",
      target: "github-issue:17",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath),
      now: () => "2026-05-18T08:25:00.000Z",
    });

    expect(result.record.provider).toMatchObject({
      provider: "github",
      surface: "issue",
      mode: "draft",
      posted: false,
      postingDisposition: "draft_live_posting_disabled",
      authority: {
        allowed: true,
        requestedAction: "provider.comment",
      },
      blockedMutation: null,
    });
    expect(result.comment?.body).toContain(coordinationRequestCommentMarker);
    expect(result.blockedMutations).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("live external provider posting is disabled"),
      ]),
    );
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
