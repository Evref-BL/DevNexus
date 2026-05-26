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
