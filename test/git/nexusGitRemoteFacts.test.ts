import { describe, expect, it } from "vitest";
import { parseNexusGitRemoteFacts } from "../../src/git/nexusGitRemoteFacts.js";

describe("nexus git remote facts", () => {
  it("parses remote URLs and push URLs from git config text", () => {
    expect(
      parseNexusGitRemoteFacts(`
[core]
  repositoryformatversion = 0
[remote "origin"]
  url = git@example.invalid:demo/project.git
  pushurl = git@example.invalid:bot/project.git
[branch "main"]
  remote = origin
[remote "backup"]
  url = https://example.invalid/demo/project.git
`),
    ).toEqual({
      urls: {
        origin: "git@example.invalid:demo/project.git",
        backup: "https://example.invalid/demo/project.git",
      },
      pushUrls: {
        origin: "git@example.invalid:bot/project.git",
      },
    });
  });
});
