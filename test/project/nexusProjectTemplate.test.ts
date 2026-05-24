import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildNexusProjectTemplateLayout,
  type NexusProjectConfig,
} from "../../src/index.js";

describe("nexus project template", () => {
  it("describes component-scoped worktree roots from the configured project shape", () => {
    const projectRoot = path.resolve("template-project");
    const projectConfig: NexusProjectConfig = {
      version: 1,
      id: "template-project",
      name: "Template Project",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      components: [
        {
          id: "core",
          name: "Core",
          kind: "local",
          role: "primary",
          remoteUrl: null,
          defaultBranch: null,
          sourceRoot: "components/core",
          relationships: [],
        },
        {
          id: "docs",
          name: "Docs",
          kind: "local",
          role: "addon",
          remoteUrl: null,
          defaultBranch: null,
          sourceRoot: "components/docs",
          relationships: [
            {
              kind: "related",
              componentId: "core",
            },
          ],
        },
      ],
      worktreesRoot: ".nexus/worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    };

    const layout = buildNexusProjectTemplateLayout({
      projectRoot,
      worktreesRoot: path.join(projectRoot, ".nexus", "worktrees"),
      projectConfig,
      skillsConfig: false,
      mcpConfig: false,
    });

    expect(layout.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "workspace_state",
          owner: "local_runtime",
          path: ".nexus/worktrees/core/",
        }),
        expect.objectContaining({
          area: "workspace_state",
          owner: "local_runtime",
          path: ".nexus/worktrees/docs/",
        }),
        expect.objectContaining({
          area: "workspace_state",
          owner: "local_runtime",
          path: ".dev-nexus/runtime/",
        }),
        expect.objectContaining({
          area: "workspace_state",
          owner: "local_runtime",
          path: ".dev-nexus/host-setup/",
        }),
      ]),
    );
    expect(layout.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "worktrees/",
        }),
      ]),
    );
    expect(layout.migrationNotes.join("\n")).toContain(
      "migration-only evidence",
    );
  });
});
