import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildVibeKanbanWorkspaceSetupScript } from "../../../src/integrations/vibe-kanban/vibeKanbanWorkspaceSetup.js";

describe("Vibe Kanban workspace setup script", () => {
  it("generates the Windows setup script for managed support files", () => {
    const managedRoot = path.join("C:", "dev", "nexus", "Managed Project");
    const sourceRoot = path.join("C:", "dev", "src", "Tool");

    const script = buildVibeKanbanWorkspaceSetupScript(
      managedRoot,
      sourceRoot,
      "win32",
    );

    expect(script).toContain("$managedRoot = '");
    expect(script).toContain("Copy-Item -LiteralPath $agentsSource");
    expect(script).toContain("Copy-Item -Path (Join-Path $codexSource '*')");
    expect(script).toContain("New-Item -ItemType Junction");
    expect(script).toContain("Add-GitInfoExclude 'AGENTS.md'");
    expect(script).toContain("Add-GitInfoExclude '.codex/'");
    expect(script).toContain("Add-GitInfoExclude 'node_modules/'");
    expect(script).toContain(
      "Vibe workspace setup complete for DevNexus-managed workspace.",
    );
  });

  it("generates the POSIX setup script for managed support files", () => {
    const managedRoot = "/workspace/managed";
    const sourceRoot = "/workspace/source";
    const script = buildVibeKanbanWorkspaceSetupScript(
      managedRoot,
      sourceRoot,
      "linux",
    );

    expect(script).toContain(`managed_root='${path.resolve(managedRoot)}'`);
    expect(script).toContain("cp \"$managed_root/AGENTS.md\"");
    expect(script).toContain("cp -R \"$managed_root/.codex/.\"");
    expect(script).toContain("ln -s \"$source_root/node_modules\"");
    expect(script).toContain("add_git_info_exclude 'AGENTS.md'");
    expect(script).toContain("add_git_info_exclude '.codex/'");
    expect(script).toContain("add_git_info_exclude 'node_modules/'");
    expect(script).toContain(
      "Vibe workspace setup complete for DevNexus-managed workspace.",
    );
  });
});
