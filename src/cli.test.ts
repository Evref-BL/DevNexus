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
  type ProjectGitCommandResult,
  type ProjectGitRunner,
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

function fakeProjectGitRunner(
  calls: string[][],
  options: { branch?: string; remoteUrl?: string | null } = {},
): ProjectGitRunner {
  return (args: readonly string[]): ProjectGitCommandResult => {
    const argsArray = [...args];
    calls.push(argsArray);

    if (argsArray[0] === "clone") {
      fs.mkdirSync(argsArray[2]!, { recursive: true });
    }
    if (argsArray.includes("rev-parse")) {
      return {
        args: argsArray,
        stdout: "true\n",
        stderr: "",
        exitCode: 0,
      };
    }
    if (argsArray.includes("remote.origin.url")) {
      return {
        args: argsArray,
        stdout: options.remoteUrl ? `${options.remoteUrl}\n` : "",
        stderr: "",
        exitCode: options.remoteUrl ? 0 : 1,
      };
    }
    if (argsArray.includes("symbolic-ref")) {
      return {
        args: argsArray,
        stdout: `${options.branch ?? "main"}\n`,
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

    expect(output.output()).toContain("dev-nexus home init");
    expect(output.output()).toContain("dev-nexus project status");
    expect(output.output()).toContain("dev-nexus work-item create");
    expect(output.output()).toContain("dev-nexus automation enqueue");
    expect(output.output()).toContain("dev-nexus automation run-once");
    expect(output.output()).toContain("dev-nexus automation schedule");
  });

  it("initializes a home and manages projects through the CLI", async () => {
    const homePath = makeTempDir("dev-nexus-cli-home-");
    const initOutput = captureOutput();
    const createOutput = captureOutput();
    const listOutput = captureOutput();
    const registryStatusOutput = captureOutput();
    const pathStatusOutput = captureOutput();
    const gitCalls: string[][] = [];

    await main(
      [
        "home",
        "init",
        homePath,
        "--projects-root",
        "projects",
        "--workspaces-root",
        "workspaces",
        "--json",
      ],
      {
        stdout: initOutput.writer,
      },
    );
    await main(["project", "create", "HomeTool", "--home", homePath, "--json"], {
      stdout: createOutput.writer,
      projectGitRunner: fakeProjectGitRunner(gitCalls),
    });
    await main(["project", "list", "--home", homePath, "--json"], {
      stdout: listOutput.writer,
    });

    const created = JSON.parse(createOutput.output());
    await main(
      ["project", "status", "home-tool", "--home", homePath, "--json"],
      {
        stdout: registryStatusOutput.writer,
      },
    );
    await main(["project", "status", created.projectRoot, "--json"], {
      stdout: pathStatusOutput.writer,
    });

    expect(JSON.parse(initOutput.output())).toMatchObject({
      ok: true,
      homePath,
      config: {
        projects: [],
      },
    });
    expect(created).toMatchObject({
      ok: true,
      projectConfig: {
        id: "home-tool",
        name: "HomeTool",
      },
      reference: {
        id: "home-tool",
      },
    });
    expect(JSON.parse(listOutput.output()).projects).toMatchObject([
      {
        id: "home-tool",
        projectConfigExists: true,
      },
    ]);
    expect(JSON.parse(registryStatusOutput.output()).project).toMatchObject({
      id: "home-tool",
      projectRoot: created.projectRoot,
    });
    expect(JSON.parse(pathStatusOutput.output()).project).toMatchObject({
      id: "home-tool",
      projectRoot: created.projectRoot,
    });
    expect(gitCalls).toEqual([
      ["init", created.projectRoot],
      ["-C", created.projectRoot, "symbolic-ref", "--short", "HEAD"],
    ]);
  });

  it("imports projects and configures trackers through the CLI", async () => {
    const homePath = makeTempDir("dev-nexus-cli-home-");
    const sourceRoot = path.join(makeTempDir("dev-nexus-cli-source-"), "Imported");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const importOutput = captureOutput();
    const configureOutput = captureOutput();
    const linkOutput = captureOutput();
    const gitCalls: string[][] = [];

    await main(["home", "init", homePath], {
      stdout: captureOutput().writer,
    });
    await main(
      [
        "project",
        "import",
        sourceRoot,
        "--home",
        homePath,
        "--name",
        "Imported",
        "--json",
      ],
      {
        stdout: importOutput.writer,
        projectGitRunner: fakeProjectGitRunner(gitCalls, {
          branch: "trunk",
          remoteUrl: "https://example.invalid/imported.git",
        }),
      },
    );
    await main(
      [
        "project",
        "tracker",
        "configure",
        "imported",
        "--home",
        homePath,
        "--provider",
        "local",
        "--store-path",
        ".dev-nexus/work-items.json",
        "--json",
      ],
      {
        stdout: configureOutput.writer,
      },
    );
    await main(
      [
        "project",
        "tracker",
        "link",
        "imported",
        "--home",
        homePath,
        "--tracker-project-id",
        "tracker-1",
        "--json",
      ],
      {
        stdout: linkOutput.writer,
      },
    );

    expect(JSON.parse(importOutput.output())).toMatchObject({
      ok: true,
      projectConfig: {
        id: "imported",
        repo: {
          kind: "git",
          remoteUrl: "https://example.invalid/imported.git",
          defaultBranch: "trunk",
          sourceRoot,
        },
      },
    });
    expect(JSON.parse(configureOutput.output())).toMatchObject({
      ok: true,
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus/work-items.json",
      },
    });
    expect(JSON.parse(linkOutput.output())).toMatchObject({
      ok: true,
      vibeKanbanProjectId: "tracker-1",
      project: {
        id: "imported",
      },
    });
    expect(gitCalls).toContainEqual([
      "-C",
      sourceRoot,
      "rev-parse",
      "--is-inside-work-tree",
    ]);
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

  it("enqueues work items that match the automation selector", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        selector: {
          ...config.automation!.selector,
          statuses: ["ready"],
          labels: ["automation"],
          assignees: ["agent-a"],
          search: "queue",
        },
      },
    });
    const enqueueOutput = captureOutput();
    const statusOutput = captureOutput();

    await main(
      [
        "automation",
        "enqueue",
        projectRoot,
        "--title",
        "Queue runnable task",
        "--description",
        "Created by automation enqueue.",
        "--label",
        "dogfood",
        "--json",
      ],
      {
        stdout: enqueueOutput.writer,
        now: fixedClock("2026-05-16T10:00:00.000Z"),
      },
    );
    await main(["automation", "status", projectRoot, "--json"], {
      stdout: statusOutput.writer,
      now: fixedClock("2026-05-16T10:05:00.000Z"),
    });

    expect(JSON.parse(enqueueOutput.output()).workItem).toMatchObject({
      id: "local-1",
      title: "Queue runnable task",
      status: "ready",
      labels: ["automation", "dogfood"],
      assignees: ["agent-a"],
    });
    expect(JSON.parse(statusOutput.output())).toMatchObject({
      ok: true,
      status: "ready",
      selectedWorkItem: {
        id: "local-1",
        title: "Queue runnable task",
      },
    });
  });

  it("refuses to enqueue work items outside the automation selector", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        selector: {
          ...config.automation!.selector,
          statuses: ["ready"],
          excludeLabels: ["blocked"],
        },
      },
    });

    await expect(
      main(
        [
          "automation",
          "enqueue",
          projectRoot,
          "--title",
          "Bad task",
          "--status",
          "todo",
          "--json",
        ],
        {
          stdout: captureOutput().writer,
        },
      ),
    ).rejects.toThrow("--status must match automation selector statuses: ready");
    await expect(
      main(
        [
          "automation",
          "enqueue",
          projectRoot,
          "--title",
          "Blocked task",
          "--label",
          "blocked",
          "--json",
        ],
        {
          stdout: captureOutput().writer,
        },
      ),
    ).rejects.toThrow("labels conflict with automation selector exclusions: blocked");
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
        path.join(
          projectRoot,
          "worktrees",
          "primary",
          "codex-demo-project-local-1-run-cli",
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

  it("uses the configured automation executor command when omitted", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        executor: {
          command: "node configured-task.js",
          timeoutMs: 1234,
          runFullVerification: true,
        },
        verification: {
          ...config.automation!.verification,
          fullCommands: ["npm run check"],
        },
      },
    });
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Configured task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();
    const commandRuns: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commandRuns.push(command);
      expect(options.timeoutMs).toBe(1234);
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };

    await main(["automation", "run-once", projectRoot, "--json"], {
      stdout: output.writer,
      commandRunner,
      gitRunner: fakeGitRunner([]),
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
        "2026-05-16T10:02:00.000Z",
        "2026-05-16T10:03:00.000Z",
      ),
    });

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      status: "completed",
      workItem: {
        id: "local-1",
      },
    });
    expect(commandRuns).toEqual([
      "node configured-task.js",
      "npm test",
      "npm run check",
    ]);
  });

  it("runs agent launch automation through the command launcher", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        mode: "agent_launch",
        agent: {
          command: "codex run",
          timeoutMs: 4321,
          relaunch: {
            whileEligible: false,
          },
        },
      },
    });
    const tracker = createLocalWorkTrackerProvider({
      projectRoot,
      now: fixedClock("2026-05-16T09:00:00.000Z"),
    });
    await tracker.createWorkItem({
      projectRoot,
      title: "Agent-launch task",
      status: "ready",
      labels: ["automation"],
    });
    const output = captureOutput();
    const commandRuns: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commandRuns.push(command);
      expect(options.cwd).toBe(projectRoot);
      expect(options.timeoutMs).toBe(4321);
      expect(options.env.DEV_NEXUS_AUTOMATION_MODE).toBe("agent_launch");
      fs.writeFileSync(
        options.env.DEV_NEXUS_AGENT_RESULT_FILE!,
        `${JSON.stringify({
          status: "blocked",
          summary: "Agent recorded a blocker",
          error: "needs user decision",
        })}\n`,
        "utf8",
      );
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };

    await main(["automation", "run-once", projectRoot, "--json"], {
      stdout: output.writer,
      commandRunner,
      now: fixedClock(
        "2026-05-16T10:00:00.000Z",
        "2026-05-16T10:01:00.000Z",
      ),
    });

    expect(JSON.parse(output.output())).toMatchObject({
      ok: true,
      status: "blocked",
      summary: "Agent recorded a blocker",
      eligibleWorkItems: [
        {
          id: "local-1",
        },
      ],
    });
    expect(commandRuns).toEqual(["codex run"]);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(false);
    expect(
      loadLocalWorkTrackingStore(defaultLocalWorkTrackingStorePath(projectRoot))
        .items[0],
    ).toMatchObject({
      id: "local-1",
      status: "ready",
    });
  });

  it("schedules bounded automation through the command executor", async () => {
    const projectRoot = makeTempDir("dev-nexus-cli-project-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    const config = projectConfig();
    saveProjectConfig(projectRoot, {
      ...config,
      automation: {
        ...config.automation!,
        executor: {
          ...config.automation!.executor,
          command: "node scheduled-task.js",
        },
      },
    });
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
    expect(commandRuns).toEqual(["node scheduled-task.js", "npm test"]);
    expect(gitCalls[0]).toMatchObject({
      args: [
        "worktree",
          "add",
          "-b",
          "codex/demo-project/local-1/scheduled-20260516-t100000-000-z-1",
          path.join(
            projectRoot,
            "worktrees",
            "primary",
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
