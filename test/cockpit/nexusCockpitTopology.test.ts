import { describe, expect, it } from "vitest";

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
});
