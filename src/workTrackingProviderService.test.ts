import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkTrackerProvider,
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

  it("creates forge providers without specialization project config", () => {
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
});
