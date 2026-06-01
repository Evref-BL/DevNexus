import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNexusSharedCheckoutMutationAllowed,
  classifyNexusCheckout,
  createOrRefreshNexusWorktreeLease,
  evaluateNexusSharedCheckoutMutation,
  NexusSharedCheckoutGuardError,
  saveProjectConfig,
  type GitCommandResult,
  type GitRunner,
  type NexusProjectConfig,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "guard-demo",
    name: "Guard Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:guard/demo.git",
      defaultBranch: "main",
      sourceRoot: ".",
    },
    components: [
      {
        id: "core",
        name: "Core",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:guard/core.git",
        defaultBranch: "main",
        sourceRoot: "components/core",
        worktreesRoot: "worktrees/core",
        workTracking: {
          provider: "local",
        },
        relationships: [],
      },
    ],
    worktreesRoot: "worktrees",
    workTracking: {
      provider: "local",
    },
    ...overrides,
  };
}

function overlappingResearchProjectConfig(): NexusProjectConfig {
  return projectConfig({
    id: "dev-nexus-research",
    components: [
      {
        id: "dev-nexus-research",
        name: "DevNexus-Research",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:guard/research.git",
        defaultBranch: "main",
        sourceRoot: "source",
        worktreesRoot: "worktrees/dev-nexus-research",
        workTracking: {
          provider: "local",
        },
        relationships: [],
      },
    ],
  });
}

function fakeGitRunner(repositoryByCwd: Map<string, string>): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    const joined = argsArray.join(" ");
    if (joined === "rev-parse --show-toplevel") {
      const repositoryPath = repositoryByCwd.get(canonical(cwd ?? ""));
      return repositoryPath
        ? ok(argsArray, `${repositoryPath}\n`)
        : fail(argsArray, "not a git repository");
    }
    if (joined === "worktree list --porcelain") {
      const repositoryPath = repositoryByCwd.get(canonical(cwd ?? ""));
      return repositoryPath
        ? ok(argsArray, `worktree ${repositoryPath}\nHEAD abc123\nbranch refs/heads/main\n`)
        : fail(argsArray, "not a git repository");
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

function fail(args: string[], stderr: string): GitCommandResult {
  return {
    args,
    stdout: "",
    stderr,
    exitCode: 128,
  };
}

function canonical(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("shared checkout mutation guard", () => {
  it("refuses local tracker mutation from the shared project checkout", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(projectRoot), projectRoot]]));

    const decision = evaluateNexusSharedCheckoutMutation({
      projectRoot,
      mutationClass: "local_tracker",
      command: "work-item set-status",
      gitRunner,
    });

    expect(decision).toMatchObject({
      ok: false,
      classification: "shared_project_checkout",
      mutationClass: "local_tracker",
      recoveryAction: {
        kind: "prepare_workspace_meta_worktree",
        mcpTool: {
          name: "worktree_prepare",
          arguments: {
            projectRoot,
            projectMeta: true,
          },
        },
      },
    });
    expect(decision.saferNextAction).toContain("workspace/meta worktree");
  });

  it("allows provider work item mutation from the shared project checkout", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(projectRoot), projectRoot]]));

    const decision = evaluateNexusSharedCheckoutMutation({
      projectRoot,
      mutationClass: "provider_tracker",
      command: "work-item create",
      gitRunner,
    });

    expect(decision).toMatchObject({
      ok: true,
      classification: "shared_project_checkout",
      mutationClass: "provider_tracker",
    });
  });

  it("refuses target-state mutation from the shared project checkout", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(projectRoot), projectRoot]]));

    expect(() =>
      assertNexusSharedCheckoutMutationAllowed({
        projectRoot,
        mutationClass: "target_state",
        command: "automation target-cycle record",
        gitRunner,
      }),
    ).toThrow(NexusSharedCheckoutGuardError);
  });

  it("refuses component source mutation from the shared component checkout", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    const sourceRoot = path.join(projectRoot, "components", "core");
    fs.mkdirSync(sourceRoot, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(sourceRoot), sourceRoot]]));

    const decision = evaluateNexusSharedCheckoutMutation({
      projectRoot,
      targetPath: sourceRoot,
      mutationClass: "component_source",
      command: "source edit",
      gitRunner,
    });

    expect(decision).toMatchObject({
      ok: false,
      classification: "shared_component_checkout",
      componentId: "core",
    });
  });

  it("allows component source mutation in a generated component worktree", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "core", "codex-core-1");
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(worktreePath), worktreePath]]));

    expect(
      evaluateNexusSharedCheckoutMutation({
        projectRoot,
        targetPath: worktreePath,
        mutationClass: "component_source",
        command: "source edit",
        gitRunner,
      }),
    ).toMatchObject({
      ok: true,
      classification: "generated_component_worktree",
      componentId: "core",
    });
  });

  it("allows cleanup execution against generated worktrees", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "core", "codex-core-1");
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(worktreePath), worktreePath]]));

    expect(
      evaluateNexusSharedCheckoutMutation({
        projectRoot,
        targetPath: worktreePath,
        mutationClass: "cleanup_execution",
        command: "coordination cleanup-execute",
        gitRunner,
      }),
    ).toMatchObject({
      ok: true,
      classification: "generated_component_worktree",
      componentId: "core",
    });
  });

  it("refuses coordination records from generated component worktrees with meta recovery", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    const worktreePath = path.join(projectRoot, "worktrees", "core", "codex-core-1");
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(worktreePath), worktreePath]]));

    const decision = evaluateNexusSharedCheckoutMutation({
      projectRoot,
      targetPath: worktreePath,
      mutationClass: "coordination_record",
      command: "coordination handoff",
      gitRunner,
    });

    expect(decision).toMatchObject({
      ok: false,
      classification: "generated_component_worktree",
      componentId: "core",
      targetPath: worktreePath,
      recoveryAction: {
        kind: "prepare_workspace_meta_worktree",
        mcpTool: {
          name: "worktree_prepare",
          arguments: {
            projectRoot,
            projectMeta: true,
          },
        },
      },
    });
    expect(decision.saferNextAction).toContain(
      "coordination_record requires a workspace/meta worktree",
    );
  });

  it("allows project-state mutation in a generated workspace-meta worktree", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    const metaWorktree = path.join(
      projectRoot,
      "worktrees",
      "guard-demo",
      "codex-meta-1",
    );
    fs.mkdirSync(metaWorktree, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(metaWorktree), metaWorktree]]));

    expect(
      evaluateNexusSharedCheckoutMutation({
        projectRoot,
        targetPath: metaWorktree,
        mutationClass: "project_state",
        command: "workspace state write",
        gitRunner,
      }),
    ).toMatchObject({
      ok: true,
      classification: "generated_project_meta_worktree",
    });
  });

  it("prefers recorded workspace-meta leases over overlapping component worktree roots", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    const metaWorktree = path.join(
      projectRoot,
      "worktrees",
      "dev-nexus-research",
      "quality-audit-tracker",
    );
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(metaWorktree, { recursive: true });
    saveProjectConfig(projectRoot, overlappingResearchProjectConfig());
    createOrRefreshNexusWorktreeLease({
      projectRoot,
      projectMeta: true,
      worktreePath: metaWorktree,
      branchName: "codex/dev-nexus-research/quality-audit-tracker",
      gitFacts: {
        repositoryPath: metaWorktree,
        headCommit: "abc123",
        dirty: false,
      },
      now: "2026-05-24T10:00:00.000Z",
    });
    const gitRunner = fakeGitRunner(new Map([[canonical(metaWorktree), metaWorktree]]));

    expect(
      evaluateNexusSharedCheckoutMutation({
        projectRoot,
        targetPath: metaWorktree,
        mutationClass: "project_state",
        command: "work-item create",
        gitRunner,
      }),
    ).toMatchObject({
      ok: true,
      classification: "generated_project_meta_worktree",
      componentId: null,
      reason: expect.stringContaining("recorded workspace/meta worktree lease"),
    });
  });

  it.each([
    { command: "work-item create", status: "merged" },
    { command: "work-item update", status: "stale" },
    { command: "work-item comment", status: "merged" },
  ] as const)(
    "keeps $command on the shared project checkout when a $status component project_root lease exists",
    ({ command, status }) => {
      const projectRoot = makeTempDir("dev-nexus-guard-project-");
      saveProjectConfig(projectRoot, projectConfig());
      createOrRefreshNexusWorktreeLease({
        projectRoot,
        componentId: "core",
        worktreePath: projectRoot,
        branchName: "codex/core/stale-project-root",
        status,
        gitFacts: {
          repositoryPath: projectRoot,
          headCommit: "abc123",
          dirty: false,
        },
        now: "2026-06-01T10:00:00.000Z",
      });
      const gitRunner = fakeGitRunner(new Map([[canonical(projectRoot), projectRoot]]));

      const decision = evaluateNexusSharedCheckoutMutation({
        projectRoot,
        mutationClass: "local_tracker",
        command,
        gitRunner,
      });

      expect(decision).toMatchObject({
        ok: false,
        classification: "shared_project_checkout",
        componentId: null,
        recoveryAction: {
          kind: "prepare_workspace_meta_worktree",
          mcpTool: {
            name: "worktree_prepare",
            arguments: {
              projectRoot,
              projectMeta: true,
            },
          },
        },
      });
      expect(decision.reason).toContain("shared DevNexus workspace checkout");
    },
  );

  it("keeps unrecorded overlapping paths classified as component worktrees", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    const worktreePath = path.join(
      projectRoot,
      "worktrees",
      "dev-nexus-research",
      "component-task",
    );
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, overlappingResearchProjectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(worktreePath), worktreePath]]));

    expect(
      evaluateNexusSharedCheckoutMutation({
        projectRoot,
        targetPath: worktreePath,
        mutationClass: "project_state",
        command: "work-item create",
        gitRunner,
      }),
    ).toMatchObject({
      ok: false,
      classification: "generated_component_worktree",
      componentId: "dev-nexus-research",
    });
  });

  it("allows bootstrap worktree preparation from a shared checkout", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(projectRoot), projectRoot]]));

    expect(
      evaluateNexusSharedCheckoutMutation({
        projectRoot,
        mutationClass: "worktree_bootstrap",
        command: "worktree prepare",
        gitRunner,
      }),
    ).toMatchObject({
      ok: true,
      classification: "bootstrap_setup_operation",
    });
  });

  it("refuses unknown checkout mutations", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    const externalPath = makeTempDir("dev-nexus-guard-external-");
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(externalPath), externalPath]]));

    expect(
      evaluateNexusSharedCheckoutMutation({
        projectRoot,
        targetPath: externalPath,
        mutationClass: "local_tracker",
        command: "work-item update",
        gitRunner,
      }),
    ).toMatchObject({
      ok: false,
      classification: "unknown",
    });
  });

  it("allows explicit override and integration override", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(projectRoot), projectRoot]]));

    expect(
      evaluateNexusSharedCheckoutMutation({
        projectRoot,
        mutationClass: "local_tracker",
        command: "work-item update",
        override: "allow",
        gitRunner,
      }),
    ).toMatchObject({
      ok: true,
      override: "allow",
      classification: "shared_project_checkout",
    });
    expect(
      evaluateNexusSharedCheckoutMutation({
        projectRoot,
        mutationClass: "publication_integration",
        command: "coordination integrate",
        override: "integration",
        gitRunner,
      }),
    ).toMatchObject({
      ok: true,
      override: "integration",
      classification: "integration_worktree",
    });
  });

  it("does not trust branch names as isolation proof", () => {
    const projectRoot = makeTempDir("dev-nexus-guard-project-");
    saveProjectConfig(projectRoot, projectConfig());
    const gitRunner = fakeGitRunner(new Map([[canonical(projectRoot), projectRoot]]));

    expect(
      classifyNexusCheckout({
        projectRoot,
        targetPath: projectRoot,
        componentId: "core",
        gitRunner,
      }),
    ).toMatchObject({
      classification: "shared_project_checkout",
    });
  });
});
