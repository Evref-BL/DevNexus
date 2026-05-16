import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./cli.js";
import {
  createLocalWorkTrackerProvider,
  defaultNexusAutomationConfig,
  loadLocalWorkTrackingStore,
  defaultLocalWorkTrackingStorePath,
  saveProjectConfig,
  type GitCommandResult,
  type GitRunner,
  type NexusAutomationCommandRunner,
  type NexusProjectConfig,
} from "./index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function captureOutput() {
  let output = "";
  return {
    writer: {
      write(chunk: string): boolean {
        output += chunk;
        return true;
      },
    },
    output: () => output,
  };
}

function fixedClock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? timestamps[0]!;
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
  return {
    version: 1,
    id: "demo-project",
    name: "Demo Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@example.invalid:demo/project.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: null,
    },
    workTracking: {
      provider: "local",
    },
    automation: {
      ...defaultNexusAutomationConfig,
      selector: {
        ...defaultNexusAutomationConfig.selector,
        statuses: ["ready"],
        labels: ["automation"],
        limit: 5,
      },
      verification: {
        ...defaultNexusAutomationConfig.verification,
        focusedCommands: ["npm test"],
        fullCommands: [],
      },
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "local_only",
        targetBranch: "main",
      },
    },
    ...overrides,
  };
}

function fakeGitRunner(calls: Array<{ args: string[]; cwd?: string }>): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "worktree" && argsArray[1] === "add") {
      fs.mkdirSync(argsArray[4]!, { recursive: true });
      return {
        args: argsArray,
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    }
    if (argsArray[0] === "rev-list") {
      return {
        args: argsArray,
        stdout: "abc123\n",
        stderr: "",
        exitCode: 0,
      };
    }

    return {
      args: argsArray,
      stdout: "",
      stderr: "",
      exitCode: 0,
    };
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("dev-nexus cli", () => {
  it("prints usage", async () => {
    const output = captureOutput();

    await expect(main(["--help"], { stdout: output.writer })).resolves.toBe(0);

    expect(output.output()).toContain("dev-nexus work-item create");
    expect(output.output()).toContain("dev-nexus automation run-once");
    expect(output.output()).toContain("dev-nexus automation schedule");
  });

  it("creates and lists local work items", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const createOutput = captureOutput();
    const listOutput = captureOutput();

    await main(
      [
        "work-item",
        "create",
        projectRoot,
        "--title",
        "Wire CLI",
        "--status",
        "ready",
        "--label",
        "automation",
        "--json",
      ],
      {
        stdout: createOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(
      ["work-item", "list", projectRoot, "--status", "ready", "--json"],
      {
        stdout: listOutput.writer,
      },
    );

    expect(JSON.parse(createOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Wire CLI",
    });
    expect(JSON.parse(listOutput.output()).workItems).toMatchObject([
      {
        id: "local-1",
        title: "Wire CLI",
      },
    ]);
  });

  it("gets, updates, and comments on local work items", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Draft task",
      description: "Initial",
      status: "todo",
      labels: ["draft"],
      assignees: ["agent-a"],
      milestone: "m1",
    });
    const getOutput = captureOutput();
    const updateOutput = captureOutput();
    const commentOutput = captureOutput();

    await main(["work-item", "get", projectRoot, "local-1", "--json"], {
      stdout: getOutput.writer,
    });
    await main(
      [
        "work-item",
        "update",
        projectRoot,
        "local-1",
        "--title",
        "Ready task",
        "--clear-description",
        "--status",
        "ready",
        "--label",
        "automation",
        "--clear-assignees",
        "--clear-milestone",
        "--json",
      ],
      {
        stdout: updateOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(
      [
        "work-item",
        "comment",
        projectRoot,
        "local-1",
        "--body",
        "Ready for scheduler pickup.",
        "--json",
      ],
      {
        stdout: commentOutput.writer,
        now: fixedClock("2026-05-16T10:05:00.000Z"),
      },
    );

    expect(JSON.parse(getOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Draft task",
      status: "todo",
    });
    expect(JSON.parse(updateOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Ready task",
      description: null,
      status: "ready",
      labels: ["automation"],
      assignees: [],
      milestone: null,
      closedAt: null,
    });
    expect(JSON.parse(commentOutput.output()).comment).toMatchObject({
      id: "local-comment-1",
      body: "Ready for scheduler pickup.",
    });
    const store = loadLocalWorkTrackingStore(
      defaultLocalWorkTrackingStorePath(projectRoot),
    );
    expect(store.comments["local-1"]).toHaveLength(1);
  });

  it("prints read-only automation status", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Runnable task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();

    await main(["automation", "status", projectRoot, "--json"], {
      stdout: output.writer,
      now: fixedClock("2026-05-16T10:00:00.000Z"),
    });

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      status: "ready",
      candidateCount: 1,
      selectedWorkItem: {
        id: "local-1",
        title: "Runnable task",
      },
      lock: {
        status: "none",
      },
    });
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
  });

  it("runs automation once through the command executor", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Runnable task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();
    const commandRuns: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commandRuns.push(command);
      expect(options.env.DEV_NEXUS_RUN_ID).toBe("run-cli");
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    await main(
      [
        "automation",
        "run-once",
        projectRoot,
        "--command",
        "node task.js",
        "--run-id",
        "run-cli",
        "--json",
      ],
      {
        stdout: output.writer,
        commandRunner,
        gitRunner: fakeGitRunner(gitCalls),
        now: fixedClock(
          "2026-05-16T10:00:00.000Z",
          "2026-05-16T10:01:00.000Z",
          "2026-05-16T10:02:00.000Z",
          "2026-05-16T10:03:00.000Z",
        ),
      },
    );

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      status: "completed",
      runId: "run-cli",
      workItem: {
        id: "local-1",
      },
      execution: {
        commitIds: ["abc123"],
      },
    });
    expect(commandRuns).toEqual(["node task.js", "npm test"]);
    expect(gitCalls[0]).toMatchObject({
      args: [
        "worktree",
        "add",
        "-b",
        "codex/demo-project/local-1/run-cli",
        path.join(projectRoot, "worktrees", "codex-demo-project-local-1-run-cli"),
        "main",
      ],
      cwd: path.join(projectRoot, "source"),
    });
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items[0],
    ).toMatchObject({
      id: "local-1",
      status: "done",
    });
  });

  it("schedules bounded automation through the command executor", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Scheduled CLI task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();
    const commandRuns: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commandRuns.push(command);
      expect(options.env.DEV_NEXUS_WORK_ITEM_ID).toBe("local-1");
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    await main(
      [
        "automation",
        "schedule",
        projectRoot,
        "--command",
        "node task.js",
        "--max-runs",
        "1",
        "--json",
      ],
      {
        stdout: output.writer,
        commandRunner,
        gitRunner: fakeGitRunner(gitCalls),
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );

    const payload = JSON.parse(output.output());
    expect(payload).toMatchObject({
      ok: true,
      stoppedReason: "max_runs",
      ticks: [
        {
          action: "ran",
          status: {
            status: "ready",
          },
          run: {
            status: "completed",
            workItem: {
              id: "local-1",
            },
          },
        },
      ],
      runs: [
        {
          status: "completed",
          workItem: {
            id: "local-1",
          },
        },
      ],
    });
    expect(commandRuns).toEqual(["node task.js", "npm test"]);
    expect(gitCalls[0]).toMatchObject({
      args: [
        "worktree",
        "add",
        "-b",
        "codex/demo-project/local-1/scheduled-20260516-t100000-000-z-1",
        path.join(
          projectRoot,
          "worktrees",
          "codex-demo-project-local-1-scheduled-20260516-t100000-000-z-1",
        ),
        "main",
      ],
      cwd: path.join(projectRoot, "source"),
    });
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items[0],
    ).toMatchObject({
      id: "local-1",
      status: "done",
    });
  });
});
