import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  createNexusAutomationCommandExecutor,
  defaultNexusAutomationCommandRunner,
  parseNexusAutomationCommandExpression,
  type NexusAutomationCommandRunner,
} from "../../src/automation/nexusAutomationCommandExecutor.js";
import {
  nexusPublicationCommandGuardrailId,
} from "../../src/automation/nexusWorktreePublicationGuardrails.js";
import {
  defaultNexusAutomationConfig,
  type NexusAutomationConfig,
} from "../../src/automation/nexusAutomationConfig.js";
import type { GitRunner } from "../../src/worktrees/gitWorktreeService.js";
import type {
  NexusAutomationExecutorInput,
} from "../../src/automation/nexusAutomationRunOnce.js";

function automationConfig(
  overrides: Partial<NexusAutomationConfig> = {},
): NexusAutomationConfig {
  return {
    ...defaultNexusAutomationConfig,
    verification: {
      ...defaultNexusAutomationConfig.verification,
      focusedCommands: ["npm test"],
      fullCommands: ["npm run check"],
      requirePassing: true,
    },
    publication: {
      ...defaultNexusAutomationConfig.publication,
      strategy: "local_only",
      targetBranch: "main",
      push: false,
    },
    ...overrides,
  };
}

function executorInput(config: NexusAutomationConfig): NexusAutomationExecutorInput {
  return {
    runId: "run-1",
    startedAt: "2026-05-16T10:00:00.000Z",
    projectRoot: path.resolve("project"),
    sourceRoot: path.resolve("source"),
    projectConfig: {
      version: 1,
      id: "demo-project",
      name: "Demo Project",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: null,
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      automation: config,
    },
    automationConfig: config,
    workItem: {
      id: "local-1",
      title: "Implement task",
      provider: "local",
      status: "ready",
    },
    worktree: {
      sourceRoot: path.resolve("source"),
      worktreesRoot: path.resolve("project", "worktrees"),
      worktreePath: path.resolve("project", "worktrees", "task"),
      branchName: "codex/demo/local-1/run-1",
      baseRef: "main",
      git: {
        commands: [],
      },
    },
    setup: {
      links: [],
    },
  };
}

describe("nexus automation command executor", () => {
  it("runs the executor command, focused and full verification, and records commits", async () => {
    const commands: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commands.push(command);
      expect(options.env.DEV_NEXUS_WORK_ITEM_ID).toBe("local-1");
      expect(options.env.GIT_EDITOR).toBe("true");
      expect(options.env.GIT_SEQUENCE_EDITOR).toBe("true");
      expect(options.env.GIT_MERGE_AUTOEDIT).toBe("no");
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };
    const gitRunner: GitRunner = (args, cwd) => {
      expect(cwd).toBe(path.resolve("project", "worktrees", "task"));
      return {
        args: [...args],
        stdout: "abc123\n",
        stderr: "",
        exitCode: 0,
      };
    };
    const config = automationConfig();
    const executor = createNexusAutomationCommandExecutor({
      command: "node task.js",
      commandRunner,
      gitRunner,
      env: {},
      runFullVerification: true,
    });

    const result = await executor(executorInput(config));

    expect(commands).toEqual(["node task.js", "npm test", "npm run check"]);
    expect(result).toMatchObject({
      status: "completed",
      commitIds: ["abc123"],
      publicationDecision: {
        type: "local_only",
        targetBranch: "main",
      },
    });
    expect(result.verification).toHaveLength(3);
  });

  it("prepends worktree publication guardrails to executor commands", async () => {
    const guardBinDirectory = path.resolve("project", "worktrees", "task", ".dev-nexus", "guardrails", "bin");
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      expect(command).toBe("npm test");
      expect(options.env.DEV_NEXUS_PUBLICATION_GUARD_BIN)
        .toBe(guardBinDirectory);
      expect(options.env.PATH?.split(path.delimiter)[0]).toBe(guardBinDirectory);
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };
    const config = automationConfig();
    const input = executorInput(config);
    input.setup.guardrails = [
      {
        id: nexusPublicationCommandGuardrailId,
        status: "materialized",
        rootDirectoryPath: path.dirname(guardBinDirectory),
        binDirectoryPath: guardBinDirectory,
        guardScriptPath: path.join(
          path.dirname(guardBinDirectory),
          "publication-command-guard.mjs",
        ),
        commands: [],
        environment: {},
        message: "guarded",
      },
    ];
    const executor = createNexusAutomationCommandExecutor({
      command: "npm test",
      commandRunner,
      env: {
        PATH: "/usr/bin",
      },
    });

    await expect(executor(input)).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("fails without running verification when the executor command fails", async () => {
    const commands: string[] = [];
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      commands.push(command);
      return {
        command,
        cwd: options.cwd,
        stdout: "",
        stderr: "boom",
        exitCode: 2,
      };
    };
    const executor = createNexusAutomationCommandExecutor({
      command: "node task.js",
      commandRunner,
      gitRunner: () => ({
        args: [],
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    });

    const result = await executor(executorInput(automationConfig()));

    expect(commands).toEqual(["node task.js"]);
    expect(result.status).toBe("failed");
    expect(result.publicationDecision).toMatchObject({
      type: "blocked",
    });
    expect(result.verification).toEqual([
      {
        command: "node task.js",
        status: "failed",
        summary: "exit 2: boom",
      },
    ]);
  });

  it("preserves explicit Git prompt environment values for executor commands", async () => {
    const commandRunner: NexusAutomationCommandRunner = (command, options) => {
      expect(options.env.GIT_EDITOR).toBe("custom-editor");
      expect(options.env.GIT_SEQUENCE_EDITOR).toBe("custom-sequence-editor");
      expect(options.env.GIT_MERGE_AUTOEDIT).toBe("yes");
      return {
        command,
        cwd: options.cwd,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      };
    };
    const executor = createNexusAutomationCommandExecutor({
      command: "node task.js",
      commandRunner,
      gitRunner: () => ({
        args: [],
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
      env: {
        GIT_EDITOR: "custom-editor",
        GIT_SEQUENCE_EDITOR: "custom-sequence-editor",
        GIT_MERGE_AUTOEDIT: "yes",
      },
    });

    const result = await executor(executorInput(automationConfig()));

    expect(result.status).toBe("completed");
  });

  it("keeps stdout and stderr tails in failed command summaries", async () => {
    const executor = createNexusAutomationCommandExecutor({
      command: "node noisy-task.js",
      commandRunner: (command, options) => ({
        command,
        cwd: options.cwd,
        stdout: "stdout first\nstdout tail\n",
        stderr: "stderr first\nstderr tail\n",
        exitCode: 2,
      }),
      gitRunner: () => ({
        args: [],
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    });

    const result = await executor(executorInput(automationConfig()));

    expect(result.verification?.[0]).toMatchObject({
      command: "node noisy-task.js",
      status: "failed",
      summary: "exit 2: stderr tail: stderr tail; stdout tail: stdout tail",
    });
    expect(result.error).toBe(
      "exit 2: stderr tail: stderr tail; stdout tail: stdout tail",
    );
  });

  it("runs verbose default commands without overflowing the child output buffer", () => {
    const script = [
      "process.stdout.write('first line\\n');",
      "process.stdout.write('x'.repeat(2 * 1024 * 1024));",
      "process.stderr.write('warning line\\n');",
    ].join("");
    const result = defaultNexusAutomationCommandRunner(
      `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
      {
        cwd: process.cwd(),
        env: process.env,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain("first line");
    expect(result.stdout).toContain("[dev-nexus output truncated:");
    expect(result.stderr).toContain("warning line");
  });

  it("runs default commands without implicit shell interpretation", () => {
    const script = [
      "if (!process.argv.includes('literal;echo injected')) process.exit(2);",
      "process.stdout.write('argv ok\\n');",
    ].join("");
    const result = defaultNexusAutomationCommandRunner(
      `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)} "literal;echo injected"`,
      {
        cwd: process.cwd(),
        env: process.env,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain("argv ok");
  });

  it.runIf(process.platform === "win32")(
    "runs PATH-resolved Windows command shims",
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-nexus-cmd-shim-"));
      const bin = path.join(root, "bin");
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(
        path.join(bin, "dev-nexus.cmd"),
        "@echo off\r\necho shim ok\r\n",
        "utf8",
      );

      const result = defaultNexusAutomationCommandRunner("dev-nexus --help", {
        cwd: root,
        env: {
          ...process.env,
          PATH: bin,
          PATHEXT: ".CMD",
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.error).toBeUndefined();
      expect(result.stdout).toContain("shim ok");
    },
  );

  it("rejects legacy command strings that rely on implicit shell control syntax", () => {
    const result = defaultNexusAutomationCommandRunner(
      `${JSON.stringify(process.execPath)} -e "process.exit(0)" && echo injected`,
      {
        cwd: process.cwd(),
        env: process.env,
      },
    );

    expect(result.exitCode).toBeNull();
    expect(result.error).toMatch(/unsupported shell control syntax/);
  });

  it("parses profile-style quoted command strings into argv pieces", () => {
    expect(
      parseNexusAutomationCommandExpression(
        '"C:\\\\Program Files\\\\OpenAI\\\\Codex\\\\codex.exe" exec --model "GPT 5" ""',
      ),
    ).toEqual({
      command: "C:\\Program Files\\OpenAI\\Codex\\codex.exe",
      args: ["exec", "--model", "GPT 5", ""],
      display:
        '"C:\\\\Program Files\\\\OpenAI\\\\Codex\\\\codex.exe" exec --model "GPT 5" ""',
    });
  });
});
