import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import {
  materializeNexusWorktreePublicationGuardrails,
} from "../../src/automation/nexusWorktreePublicationGuardrails.js";

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

describe("nexus worktree publication guardrails", () => {
  it("blocks raw publication mutations while preserving read-only diagnostics", () => {
    const worktreePath = makeTempDir("dev-nexus-guard-worktree-");
    const fakeBin = makeTempDir("dev-nexus-guard-real-bin-");
    for (const command of ["git", "gh", "glab"]) {
      writeFakeCommand(fakeBin, command);
    }
    const basePath = `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`;

    const guardrails = materializeNexusWorktreePublicationGuardrails({
      worktreePath,
      env: {
        ...process.env,
        PATH: basePath,
      },
    });

    expect(guardrails.status).toBe("materialized");
    expect(guardrails.environment.PATH.startsWith(guardrails.binDirectoryPath))
      .toBe(true);

    expect(runGuarded(guardrails.binDirectoryPath, "git", ["status"]))
      .toMatchObject({
        status: 0,
        stdout: expect.stringContaining("fake-git status"),
      });
    expect(runGuarded(guardrails.binDirectoryPath, "git", ["push"]))
      .toMatchObject({
        status: 126,
        stderr: expect.stringContaining("DevNexus blocked raw git push"),
      });
    expect(
      runGuarded(guardrails.binDirectoryPath, "git", ["push"], {
        DEV_NEXUS_PUBLICATION_FACADE: "1",
      }),
    ).toMatchObject({
      status: 0,
      stdout: expect.stringContaining("fake-git push"),
    });

    expect(runGuarded(guardrails.binDirectoryPath, "gh", ["pr", "view"]))
      .toMatchObject({
        status: 0,
        stdout: expect.stringContaining("fake-gh pr view"),
      });
    expect(runGuarded(guardrails.binDirectoryPath, "gh", ["pr", "create"]))
      .toMatchObject({
        status: 126,
        stderr: expect.stringContaining("DevNexus blocked raw gh provider mutation"),
      });
    expect(
      runGuarded(guardrails.binDirectoryPath, "gh", [
        "api",
        "repos/example/project",
        "--method",
        "GET",
      ]),
    ).toMatchObject({
      status: 0,
      stdout: expect.stringContaining("fake-gh api repos/example/project"),
    });
    expect(
      runGuarded(guardrails.binDirectoryPath, "gh", [
        "api",
        "repos/example/project",
        "--field",
        "title=demo",
      ]),
    ).toMatchObject({
      status: 126,
      stderr: expect.stringContaining("DevNexus blocked raw gh provider mutation"),
    });

    expect(runGuarded(guardrails.binDirectoryPath, "glab", ["mr", "view"]))
      .toMatchObject({
        status: 0,
        stdout: expect.stringContaining("fake-glab mr view"),
      });
    expect(runGuarded(guardrails.binDirectoryPath, "glab", ["mr", "create"]))
      .toMatchObject({
        status: 126,
        stderr: expect.stringContaining(
          "DevNexus blocked raw glab provider mutation",
        ),
      });
  });
});

function runGuarded(
  binDirectoryPath: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): ReturnType<typeof spawnSync> {
  return spawnSync(guardedCommandPath(binDirectoryPath, command), args, {
    env: {
      ...process.env,
      PATH: `${binDirectoryPath}${path.delimiter}${process.env.PATH ?? ""}`,
      ...env,
    },
    encoding: "utf8",
    windowsHide: true,
  });
}

function guardedCommandPath(binDirectoryPath: string, command: string): string {
  return path.join(
    binDirectoryPath,
    process.platform === "win32" ? `${command}.cmd` : command,
  );
}

function writeFakeCommand(binDirectoryPath: string, command: string): void {
  fs.mkdirSync(binDirectoryPath, { recursive: true });
  const commandPath = path.join(
    binDirectoryPath,
    process.platform === "win32" ? `${command}.cmd` : command,
  );
  const content =
    process.platform === "win32"
      ? `@echo off\r\necho fake-${command} %*\r\n`
      : `#!/bin/sh\nprintf '%s\\n' "fake-${command} $*"\n`;
  fs.writeFileSync(commandPath, content, "utf8");
  if (process.platform !== "win32") {
    fs.chmodSync(commandPath, 0o755);
  }
}
