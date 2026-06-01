import { describe, expect, it } from "vitest";
import {
  getNexusWorkflowModeChecklist,
  listNexusWorkflowModeChecklists,
  parseNexusWorkflowModeId,
} from "../../src/index.js";

describe("nexus workflow mode checklists", () => {
  it("defines explicit closeout rules for the approved workflow modes", () => {
    const modes = listNexusWorkflowModeChecklists();

    expect(modes.map((mode) => mode.id)).toEqual([
      "quick_fix",
      "heartbeat",
      "cleanup",
      "investigation",
      "release",
    ]);
    expect(getNexusWorkflowModeChecklist("quick_fix")).toMatchObject({
      skippedByDefault: expect.arrayContaining([
        "target-cycle record",
        "target-state rewrite",
        "workspace metadata pull request",
      ]),
      targetStateRequiredWhen: expect.arrayContaining([
        "current objective changes",
        "current decision or policy changes",
      ]),
      finalSummaryMustReport: expect.arrayContaining([
        "verification commands and outcomes",
        "skipped bookkeeping that would be required in heartbeat mode",
      ]),
    });
    expect(getNexusWorkflowModeChecklist("heartbeat").requiredArtifacts)
      .toContain("target-cycle facts");
    expect(getNexusWorkflowModeChecklist("release").forbiddenArtifacts)
      .toContain("self-approval by the same bot actor under default policy");
  });

  it("parses dashed and underscored mode ids", () => {
    expect(parseNexusWorkflowModeId("quick-fix")).toBe("quick_fix");
    expect(parseNexusWorkflowModeId("heartbeat")).toBe("heartbeat");
    expect(() => parseNexusWorkflowModeId("ad hoc")).toThrow(/workflow mode/);
  });
});
