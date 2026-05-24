import { describe, expect, it } from "vitest";
import {
  gitDirectoryFromGitFileContent,
  gitDirectoryFromGitFileLine,
} from "../../src/git/nexusGitFile.js";

describe("nexus git file parsing", () => {
  it("extracts linked worktree git directories without regex parsing", () => {
    expect(gitDirectoryFromGitFileLine("gitdir: ../.git/worktrees/demo\n"))
      .toBe("../.git/worktrees/demo");
    expect(gitDirectoryFromGitFileLine("GitDir: /tmp/repo/.git/worktrees/demo"))
      .toBe("/tmp/repo/.git/worktrees/demo");
  });

  it("ignores non-gitdir lines and empty values", () => {
    expect(gitDirectoryFromGitFileLine("not-gitdir: /tmp/repo/.git")).toBeNull();
    expect(gitDirectoryFromGitFileLine("gitdir:   ")).toBeNull();
  });

  it("finds a gitdir line in multi-line content", () => {
    expect(gitDirectoryFromGitFileContent("ignored\r\ngitdir: ./actual.git\r\n"))
      .toBe("./actual.git");
  });
});
