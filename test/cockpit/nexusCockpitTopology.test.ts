import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildNexusDashboardHistoryLayout as canonicalHistoryLayout,
} from "../../src/cockpit/server/nexusDashboardHistoryLayout.js";
import {
  startNexusDashboardServer as canonicalServerStarter,
} from "../../src/cockpit/server/nexusDashboardServer.js";
import {
  buildNexusDashboardHistoryLayout as legacyHistoryLayout,
} from "../../src/dashboard/nexusDashboardHistoryLayout.js";
import {
  startNexusDashboardServer as legacyServerStarter,
} from "../../src/dashboard/nexusDashboardServer.js";

describe("nexus cockpit topology", () => {
  it("keeps dashboard import facades compatible with cockpit server modules", () => {
    expect(legacyHistoryLayout).toBe(canonicalHistoryLayout);
    expect(legacyServerStarter).toBe(canonicalServerStarter);
  });

  it("keeps cockpit snapshot orchestration split from server model builders", () => {
    const facade = fs.readFileSync(
      fileURLToPath(new URL("../../src/cockpit/server/nexusDashboard.ts", import.meta.url)),
      "utf8",
    );
    const serverModuleNames = [
      "nexusDashboardHost.ts",
      "nexusDashboardLocalOpen.ts",
      "nexusDashboardServerHttp.ts",
      "nexusDashboardWorktreeModel.ts",
      "nexusDashboardThreadModel.ts",
      "nexusDashboardPluginModel.ts",
      "nexusDashboardTrackedWorkModel.ts",
      "nexusDashboardEvents.ts",
      "nexusDashboardWeaveModel.ts",
    ];

    expect(facade).not.toContain("function summarizeThreads(");
    expect(facade).not.toContain("function summarizePlugins(");
    expect(facade).not.toContain("function summarizeTrackedWork(");
    expect(facade).not.toContain("function buildNexusDashboardHostSnapshot(");
    for (const moduleName of serverModuleNames) {
      const moduleUrl = new URL(
        `../../src/cockpit/server/${moduleName}`,
        import.meta.url,
      );
      expect(fs.existsSync(fileURLToPath(moduleUrl))).toBe(true);
    }
  });

  it("keeps local cockpit resource adapters outside the route file", () => {
    const routeFile = fs.readFileSync(
      fileURLToPath(new URL("../../src/cockpit/server/nexusDashboardServer.ts", import.meta.url)),
      "utf8",
    );
    const adapterUrl = new URL(
      "../../src/cockpit/server/nexusDashboardLocalOpen.ts",
      import.meta.url,
    );

    expect(routeFile).not.toContain("function dashboardLocalOpenCommand(");
    expect(routeFile).not.toContain("function fallbackLocalAppIconSvg(");
    expect(fs.existsSync(fileURLToPath(adapterUrl))).toBe(true);
  });

  it("keeps cockpit HTTP helpers outside the route file", () => {
    const routeFile = fs.readFileSync(
      fileURLToPath(new URL("../../src/cockpit/server/nexusDashboardServer.ts", import.meta.url)),
      "utf8",
    );
    const helperUrl = new URL(
      "../../src/cockpit/server/nexusDashboardServerHttp.ts",
      import.meta.url,
    );

    expect(routeFile).not.toContain("function readJsonBody(");
    expect(routeFile).not.toContain("function requireDashboardMutationRequest(");
    expect(routeFile).not.toContain("function sendJson(");
    expect(routeFile).not.toContain("function listen(");
    expect(fs.existsSync(fileURLToPath(helperUrl))).toBe(true);
  });

  it("keeps cockpit client chrome helpers outside the browser entrypoint", () => {
    const entrypoint = fs.readFileSync(
      fileURLToPath(new URL("../../src/cockpit/client/nexusCockpitClient.ts", import.meta.url)),
      "utf8",
    );
    const clientModuleNames = [
      "nexusCockpitHostViews.ts",
      "nexusCockpitRenderState.ts",
      "nexusCockpitTheme.ts",
    ];

    expect(entrypoint).not.toContain("function renderHostDashboard(");
    expect(entrypoint).not.toContain("function renderProjectHeaderActions(");
    expect(entrypoint).not.toContain("function dashboardRenderSignature(");
    expect(entrypoint).not.toContain("function renderThemeToggle(");
    for (const moduleName of clientModuleNames) {
      const moduleUrl = new URL(
        `../../src/cockpit/client/${moduleName}`,
        import.meta.url,
      );
      expect(fs.existsSync(fileURLToPath(moduleUrl))).toBe(true);
    }
  });

  it("keeps history layout internals in DevNexus event-model terms", () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL("../../src/cockpit/server/nexusDashboardHistoryLayout.ts", import.meta.url)),
      "utf8",
    );

    expect(source).not.toContain("HistoryBranch");
    expect(source).not.toContain("HistoryVertex");
    expect(source).not.toContain("getNextParent");
    expect(source).not.toContain("registerUnavailablePoint");
  });
});
