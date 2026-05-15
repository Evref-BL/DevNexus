import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldNexusProject } from "./nexusProjectScaffold.js";

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

describe("nexus project scaffold", () => {
  it("creates the worktrees root and runs extension project-file hooks", () => {
    const projectRoot = makeTempDir("dev-nexus-project-");
    const worktreesRoot = path.join(projectRoot, "worktrees");

    const result = scaffoldNexusProject({
      homePath: makeTempDir("dev-nexus-home-"),
      projectRoot,
      worktreesRoot,
      projectConfig: {
        id: "project-1",
      },
      extensions: [
        {
          id: "example",
          name: "Example",
          installProjectFiles(context) {
            return {
              projectRoot: context.projectRoot,
              projectId: context.projectConfig.id,
            };
          },
        },
      ],
    });

    expect(fs.existsSync(worktreesRoot)).toBe(true);
    expect(result).toEqual({
      projectRoot,
      worktreesRoot,
      extensionResults: {
        example: {
          projectRoot,
          projectId: "project-1",
        },
      },
    });
  });
});
