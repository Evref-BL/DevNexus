import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyWorktreeExecutionUpdate,
  emptyWorktreeExecutionMetadata,
  normalizeWorktreeExecutionMetadata,
  readWorktreeExecutionMetadata,
  updateWorktreeExecutionMetadata,
  worktreeExecutionMetadataPath,
  WorktreeExecutionMetadataError,
  writeWorktreeExecutionMetadata,
} from "../src/worktreeExecutionMetadata.js";

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

describe("worktree execution metadata", () => {
  it("creates and normalizes empty execution metadata", () => {
    expect(emptyWorktreeExecutionMetadata()).toEqual({
      worktree: null,
      commitIds: [],
      verification: [],
      publicationDecision: null,
      updatedAt: null,
    });
    expect(normalizeWorktreeExecutionMetadata(undefined)).toEqual(
      emptyWorktreeExecutionMetadata(),
    );
  });

  it("applies commit, verification, and publication updates", () => {
    const updated = applyWorktreeExecutionUpdate(
      {
        commitIds: ["abc123"],
        verification: [
          {
            command: "npm test",
            status: "passed",
            summary: "37 tests passed",
            recordedAt: "2026-05-15T09:00:00.000Z",
          },
        ],
        publicationDecision: null,
        updatedAt: "2026-05-15T09:00:00.000Z",
      },
      {
        commitIds: ["def456", "abc123"],
        verification: {
          command: "npm run check",
          summary: null,
        },
        publicationDecision: {
          type: "review_handoff",
          prUrl: "https://example.test/pull/1",
          reason: "Needs review",
        },
      },
      "2026-05-15T10:00:00.000Z",
    );

    expect(updated).toEqual({
      worktree: null,
      commitIds: ["abc123", "def456"],
      verification: [
        {
          command: "npm test",
          status: "passed",
          summary: "37 tests passed",
          recordedAt: "2026-05-15T09:00:00.000Z",
        },
        {
          command: "npm run check",
          status: "passed",
          summary: null,
          recordedAt: "2026-05-15T10:00:00.000Z",
        },
      ],
      publicationDecision: {
        type: "review_handoff",
        targetBranch: null,
        remote: null,
        prUrl: "https://example.test/pull/1",
        reason: "Needs review",
        decidedAt: "2026-05-15T10:00:00.000Z",
      },
      updatedAt: "2026-05-15T10:00:00.000Z",
    });
  });

  it("normalizes persisted records with nullable optional fields", () => {
    expect(
      normalizeWorktreeExecutionMetadata({
        commitIds: ["abc123"],
        verification: [
          {
            command: "npm test",
            status: "not_run",
            summary: null,
            recordedAt: "2026-05-15T09:00:00.000Z",
          },
        ],
        publicationDecision: {
          type: "blocked",
          targetBranch: null,
          remote: null,
          prUrl: null,
          reason: "Missing credentials",
          decidedAt: "2026-05-15T09:01:00.000Z",
        },
      }),
    ).toMatchObject({
      commitIds: ["abc123"],
      verification: [
        {
          command: "npm test",
          status: "not_run",
          summary: null,
        },
      ],
      publicationDecision: {
        type: "blocked",
        reason: "Missing credentials",
      },
      updatedAt: null,
    });
  });

  it("normalizes and persists component-scoped worktree ownership", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const sourceRoot = path.join(projectRoot, "components", "dev-nexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
    const worktreePath = path.join(worktreesRoot, "local-7");
    fs.mkdirSync(worktreePath, { recursive: true });

    writeWorktreeExecutionMetadata(worktreePath, {
      worktree: {
        componentId: "dev-nexus",
        sourceRoot,
        worktreesRoot,
        worktreePath,
        branchName: "codex/dev-nexus-local-7-worktree-records",
        baseRef: "main",
        workItem: {
          id: "local-7",
          title: "Support component-scoped parallel worktree records",
        },
      },
      commitIds: [],
      verification: [],
      publicationDecision: null,
      updatedAt: "2026-05-16T09:00:00.000Z",
    });

    expect(readWorktreeExecutionMetadata(worktreePath)).toMatchObject({
      worktree: {
        componentId: "dev-nexus",
        sourceRoot,
        worktreesRoot,
        worktreePath,
        branchName: "codex/dev-nexus-local-7-worktree-records",
        baseRef: "main",
        workItem: {
          id: "local-7",
          title: "Support component-scoped parallel worktree records",
        },
      },
    });
    expect(() =>
      normalizeWorktreeExecutionMetadata({
        worktree: {
          componentId: "dev-nexus",
          sourceRoot,
          worktreesRoot,
          worktreePath: path.join(projectRoot, "outside", "local-7"),
          branchName: "codex/dev-nexus-local-7-worktree-records",
          baseRef: "main",
          workItem: {
            id: "local-7",
            title: null,
          },
        },
      }),
    ).toThrow(/inside worktreesRoot/);
  });

  it("reads, writes, and updates metadata under the worktree support directory", () => {
    const worktreePath = makeTempDir("dev-nexus-worktree-");

    expect(readWorktreeExecutionMetadata(worktreePath)).toEqual(
      emptyWorktreeExecutionMetadata(),
    );
    expect(worktreeExecutionMetadataPath(worktreePath)).toBe(
      path.join(worktreePath, ".dev-nexus", "execution.json"),
    );

    writeWorktreeExecutionMetadata(worktreePath, {
      commitIds: ["abc123"],
      verification: [],
      publicationDecision: null,
      updatedAt: "2026-05-16T09:00:00.000Z",
    });
    const updated = updateWorktreeExecutionMetadata(
      worktreePath,
      {
        verification: {
          command: "npm test",
          status: "passed",
          summary: "ok",
        },
        publicationDecision: {
          type: "local_only",
          reason: "recorded locally",
        },
      },
      "2026-05-16T10:00:00.000Z",
    );

    expect(updated).toMatchObject({
      commitIds: ["abc123"],
      verification: [
        {
          command: "npm test",
          status: "passed",
          summary: "ok",
          recordedAt: "2026-05-16T10:00:00.000Z",
        },
      ],
      publicationDecision: {
        type: "local_only",
        reason: "recorded locally",
      },
      updatedAt: "2026-05-16T10:00:00.000Z",
    });
    expect(readWorktreeExecutionMetadata(worktreePath)).toEqual(updated);
  });

  it("rejects invalid or empty updates", () => {
    expect(() =>
      applyWorktreeExecutionUpdate(
        emptyWorktreeExecutionMetadata(),
        {},
        "2026-05-15T10:00:00.000Z",
      ),
    ).toThrow(WorktreeExecutionMetadataError);
    expect(() =>
      normalizeWorktreeExecutionMetadata({
        commitIds: "abc123",
      }),
    ).toThrow(/commitIds must be an array/);
    expect(() =>
      normalizeWorktreeExecutionMetadata({
        publicationDecision: {
          type: "unknown",
          decidedAt: "2026-05-15T09:01:00.000Z",
        },
      }),
    ).toThrow(/publicationDecision\.type/);
  });
});
