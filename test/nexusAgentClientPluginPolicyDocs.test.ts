import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("agent-client plugin policy docs", () => {
  it("records the approved MCP exposure and distribution policies", () => {
    const policy = readRepoFile("docs/dev/agent-client-plugins.md");

    expect(policy).toContain("The default profile is read-mostly and setup-safe.");
    expect(policy).toContain("A full or write-capable profile is explicit opt-in.");
    expect(policy).toContain("Plugins must not assume a global `dev-nexus` command silently.");
    expect(policy).toContain("Repo-local dogfood plugins.");
    expect(policy).toContain(
      "Disabling or uninstalling a plugin removes only plugin client integration",
    );
    expect(policy).toContain(
      "No live client smoke, package install, workspace sharing, or marketplace",
    );
  });

  it("links the policy from the docs index and plugin READMEs", () => {
    const docsIndex = readRepoFile("docs/index.md");
    const codexReadme = readRepoFile("plugins/dev-nexus-codex/README.md");
    const claudeReadme = readRepoFile("plugins/dev-nexus-claude/README.md");

    expect(docsIndex).toContain("dev/agent-client-plugins.md");
    expect(codexReadme).toContain("../../docs/dev/agent-client-plugins.md");
    expect(claudeReadme).toContain("../../docs/dev/agent-client-plugins.md");
  });
});
