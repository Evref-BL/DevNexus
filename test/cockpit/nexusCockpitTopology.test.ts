import { describe, expect, it } from "vitest";

import {
  buildNexusDashboardHistoryLayout as canonicalHistoryLayout,
  renderNexusDashboardHistoryLayoutClientSource,
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
    const source = renderNexusDashboardHistoryLayoutClientSource();

    expect(source).not.toContain("HistoryBranch");
    expect(source).not.toContain("HistoryVertex");
    expect(source).not.toContain("getNextParent");
    expect(source).not.toContain("registerUnavailablePoint");
  });
});
