import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWorkTrackerCapability,
  createWorkTrackerProvider,
  workTrackerCapabilityReportForConfig,
  workTrackerCapabilitiesForConfig,
  WorkTrackingProviderServiceError,
} from "./workTrackingProviderService.js";

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

describe("work tracking provider service", () => {
  it("creates the local provider from generic config", async () => {
    const projectRoot = makeTempDir("dev-nexus-provider-");
    const provider = createWorkTrackerProvider(
      {
        provider: "local",
      },
      {
        projectRoot,
        now: () => "2026-05-15T10:00:00.000Z",
      },
    );

    await expect(
      provider.createWorkItem({ title: "Local core item" }),
    ).resolves.toMatchObject({
      id: "local-1",
      title: "Local core item",
      createdAt: "2026-05-15T10:00:00.000Z",
    });
  });

  it("creates forge providers without specialization workspace config", () => {
    expect(
      createWorkTrackerProvider({
        provider: "github",
        repository: { owner: "owner", name: "repo" },
      }).capabilities.createItem,
    ).toBe(true);
    expect(
      createWorkTrackerProvider({
        provider: "gitlab",
        repository: { id: "group/project" },
      }).capabilities.createItem,
    ).toBe(true);
    expect(
      createWorkTrackerProvider({
        provider: "jira",
        host: "https://example.atlassian.net",
        projectKey: "NEX",
      }).capabilities.createItem,
    ).toBe(true);
  });

  it("creates the Vibe provider when API options are available", () => {
    expect(
      createWorkTrackerProvider(
        {
          provider: "vibe-kanban",
          projectId: "project-1",
        },
        {
          vibeKanban: {
            port: 3000,
          },
        },
      ).capabilities.board,
    ).toBe(true);
  });

  it("requires Vibe API options for Vibe providers", () => {
    expect(() =>
      createWorkTrackerProvider({
        provider: "vibe-kanban",
        projectId: "project-1",
      }),
    ).toThrow(WorkTrackingProviderServiceError);
  });

  it("reports configured capabilities without requiring provider credentials", () => {
    expect(
      workTrackerCapabilityReportForConfig({
        provider: "local",
      }),
    ).toMatchObject({
      provider: "local",
      capabilities: {
        create: true,
        list: true,
        get: true,
        update: true,
        comment: true,
        labels: true,
        assignees: true,
        milestones: true,
        board: false,
        boardStatus: false,
      },
      unsupported: ["board", "boardStatus"],
    });
    expect(
      workTrackerCapabilitiesForConfig({
        provider: "vibe-kanban",
        projectId: "project-1",
      }),
    ).toMatchObject({
      board: true,
      listItems: false,
    });
    expect(
      workTrackerCapabilitiesForConfig({
        provider: "github",
        repository: { owner: "owner", name: "repo" },
        board: {
          kind: "github-project-v2",
          projectId: "project-node",
          statusFieldId: "field-node",
          statusOptions: {
            ready: "option-node",
          },
        },
      }),
    ).toMatchObject({
      listItems: true,
      board: true,
      boardStatus: true,
    });
    expect(
      workTrackerCapabilityReportForConfig({
        provider: "jira",
        host: "https://example.atlassian.net",
        projectKey: "NEX",
        board: {
          kind: "jira-workflow",
          statusOptions: {
            blocked: "31",
          },
        },
      }),
    ).toMatchObject({
      provider: "jira",
      capabilities: {
        board: true,
        boardStatus: true,
        milestones: false,
      },
      unsupported: ["milestones"],
    });
  });

  it("uses explicit capability names in unsupported-operation diagnostics", () => {
    const provider = createWorkTrackerProvider(
      {
        provider: "vibe-kanban",
        projectId: "project-1",
      },
      {
        vibeKanban: {
          port: 3000,
        },
      },
    );

    expect(() =>
      assertWorkTrackerCapability(provider, "list", "discover eligible work"),
    ).toThrow(
      /provider "vibe-kanban" cannot discover eligible work; required capability "list" is disabled/,
    );
  });
});
