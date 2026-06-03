import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadProjectConfig,
  saveProjectConfig,
  startNexusDashboardServer,
} from "../../src/index.js";
import {
  cleanupDashboardTestTempDirs,
  extractDashboardActionToken,
  makeTempDir,
  projectConfig,
} from "./nexusDashboardTestHelpers.js";

afterEach(cleanupDashboardTestTempDirs);

describe("nexus dashboard project config mutation routes", () => {
  it("previews and applies typed project config mutations through cockpit routes", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-config-mutation-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const server = await startNexusDashboardServer({ projectRoot });

    try {
      const html = await fetch(server.url).then((response) => response.text());
      const actionToken = extractDashboardActionToken(html);
      const previewResponse = await fetch(
        `${server.url}api/cockpit/project-config/preview`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dev-nexus-action-token": actionToken!,
          },
          body: JSON.stringify({
            intent: {
              kind: "edit_component",
              componentId: "primary",
              patch: {
                name: "Primary Renamed",
              },
            },
          }),
        },
      );
      const previewBody = await previewResponse.json();

      expect(previewResponse.status).toBe(200);
      expect(previewBody).toMatchObject({
        ok: true,
        proposal: {
          status: "ready",
          mutation: {
            kind: "edit_component",
            componentIds: ["primary"],
          },
        },
      });
      expect(loadProjectConfig(projectRoot).components[0]?.name).toBe(
        "Dashboard Demo",
      );

      const applyResponse = await fetch(
        `${server.url}api/cockpit/project-config/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dev-nexus-action-token": actionToken!,
          },
          body: JSON.stringify({
            expectedRevision: previewBody.proposal.revision,
            intent: previewBody.proposal.intent,
          }),
        },
      );
      const applyBody = await applyResponse.json();

      expect(applyResponse.status).toBe(200);
      expect(applyBody).toMatchObject({
        ok: true,
        result: {
          proposal: {
            mutation: {
              kind: "edit_component",
            },
          },
        },
      });
      expect(loadProjectConfig(projectRoot).components[0]?.name).toBe(
        "Primary Renamed",
      );
    } finally {
      await server.close();
    }
  });

  it("rejects missing tokens, client-controlled roots, and stale apply requests", async () => {
    const projectRoot = makeTempDir("dev-nexus-dashboard-config-guard-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());
    const server = await startNexusDashboardServer({ projectRoot });

    try {
      const html = await fetch(server.url).then((response) => response.text());
      const actionToken = extractDashboardActionToken(html);
      const missingToken = await fetch(
        `${server.url}api/cockpit/project-config/preview`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            intent: {
              kind: "edit_component",
              componentId: "primary",
              patch: {
                name: "Primary Renamed",
              },
            },
          }),
        },
      );
      expect(missingToken.status).toBe(403);

      const clientRoot = await fetch(
        `${server.url}api/cockpit/project-config/preview`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dev-nexus-action-token": actionToken!,
          },
          body: JSON.stringify({
            projectRoot: "/tmp/other",
            intent: {
              kind: "edit_component",
              componentId: "primary",
              patch: {
                name: "Primary Renamed",
              },
            },
          }),
        },
      );
      const clientRootBody = await clientRoot.json();
      expect(clientRoot.status).toBe(400);
      expect(clientRootBody.error.message).toContain("projectRoot is server-controlled");

      const preview = await fetch(`${server.url}api/cockpit/project-config/preview`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-nexus-action-token": actionToken!,
        },
        body: JSON.stringify({
          intent: {
            kind: "edit_component",
            componentId: "primary",
            patch: {
              name: "Primary Renamed",
            },
          },
        }),
      }).then((response) => response.json());
      const config = loadProjectConfig(projectRoot);
      saveProjectConfig(projectRoot, {
        ...config,
        name: "Changed Elsewhere",
      });

      const stale = await fetch(`${server.url}api/cockpit/project-config/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dev-nexus-action-token": actionToken!,
        },
        body: JSON.stringify({
          expectedRevision: preview.proposal.revision,
          intent: preview.proposal.intent,
        }),
      });
      const staleBody = await stale.json();

      expect(stale.status).toBe(409);
      expect(staleBody.error.code).toBe("project_config_stale");
      expect(loadProjectConfig(projectRoot).components[0]?.name).toBe(
        "Dashboard Demo",
      );
    } finally {
      await server.close();
    }
  });
});
