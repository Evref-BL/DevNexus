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

describe("cockpit component configuration workflow", () => {
  it("adds and removes a component through guarded cockpit preview/apply routes", async () => {
    const projectRoot = makeTempDir("dev-nexus-cockpit-component-config-");
    fs.mkdirSync(path.join(projectRoot, "source"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "addon"), { recursive: true });
    saveProjectConfig(projectRoot, projectConfig());

    const server = await startNexusDashboardServer({ projectRoot });

    try {
      const html = await fetch(server.url).then((response) => response.text());
      const actionToken = extractDashboardActionToken(html);
      expect(actionToken).toBeTruthy();

      const addPreviewResponse = await fetch(
        `${server.url}api/cockpit/project-config/preview`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dev-nexus-action-token": actionToken!,
          },
          body: JSON.stringify({
            intent: {
              kind: "add_component",
              answers: {
                components: [
                  {
                    id: "addon",
                    name: "Addon",
                    role: "addon",
                    source: {
                      kind: "reference_existing",
                      path: "addon",
                    },
                  },
                ],
                localWorkTracking: { enabled: true, provider: "local" },
              },
            },
          }),
        },
      );
      const addPreview = await addPreviewResponse.json();

      expect(addPreviewResponse.status).toBe(200);
      expect(addPreview).toMatchObject({
        ok: true,
        proposal: {
          status: "ready",
          mutation: { kind: "add_component", componentIds: ["addon"] },
          changedComponentIds: ["addon"],
        },
      });

      const addApplyResponse = await fetch(
        `${server.url}api/cockpit/project-config/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dev-nexus-action-token": actionToken!,
          },
          body: JSON.stringify({
            expectedRevision: addPreview.proposal.revision,
            intent: addPreview.proposal.intent,
          }),
        },
      );
      const addApply = await addApplyResponse.json();

      expect(addApplyResponse.status).toBe(200);
      expect(addApply.ok).toBe(true);
      expect(
        loadProjectConfig(projectRoot).components.map((component) => component.id),
      ).toEqual(["primary", "addon"]);

      const removePreviewResponse = await fetch(
        `${server.url}api/cockpit/project-config/preview`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dev-nexus-action-token": actionToken!,
          },
          body: JSON.stringify({
            intent: { kind: "remove_component", componentId: "addon" },
          }),
        },
      );
      const removePreview = await removePreviewResponse.json();

      expect(removePreviewResponse.status).toBe(200);
      expect(removePreview).toMatchObject({
        ok: true,
        proposal: {
          status: "ready",
          mutation: { kind: "remove_component", componentIds: ["addon"] },
          changedComponentIds: ["addon"],
        },
      });

      const removeApplyResponse = await fetch(
        `${server.url}api/cockpit/project-config/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dev-nexus-action-token": actionToken!,
          },
          body: JSON.stringify({
            expectedRevision: removePreview.proposal.revision,
            intent: removePreview.proposal.intent,
          }),
        },
      );
      const removeApply = await removeApplyResponse.json();

      expect(removeApplyResponse.status).toBe(200);
      expect(removeApply.ok).toBe(true);
      expect(
        loadProjectConfig(projectRoot).components.map((component) => component.id),
      ).toEqual(["primary"]);
      expect(fs.existsSync(path.join(projectRoot, "addon"))).toBe(true);
    } finally {
      await server.close();
    }
  });
});
