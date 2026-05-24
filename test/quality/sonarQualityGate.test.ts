import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type QualityGateResult = {
  status: "passed" | "failed";
  failures: string[];
  warnings: string[];
  summary: Record<string, number | null>;
};

type EvaluateQualityGate = (input: unknown, options?: unknown) => QualityGateResult;

let evaluateQualityGate: EvaluateQualityGate;

beforeAll(async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const moduleUrl = pathToFileURL(
    path.resolve(testDirectory, "../../scripts/sonar-quality-gate.mjs"),
  ).href;
  ({ evaluateQualityGate } = (await import(moduleUrl)) as {
    evaluateQualityGate: EvaluateQualityGate;
  });
});

function measures(values: Record<string, string | number>) {
  return {
    component: {
      measures: Object.entries(values).map(([metric, value]) => ({
        metric,
        value: String(value),
      })),
    },
  };
}

describe("evaluateQualityGate", () => {
  it("passes with the current local Sonar baseline shape", () => {
    const result = evaluateQualityGate({
      measures: measures({
        coverage: "76.6",
        branch_coverage: "70.7",
        duplicated_lines_density: "4.8",
        vulnerabilities: "0",
        bugs: "0",
        security_hotspots: "83",
      }),
      issues: {
        issues: [
          {
            type: "CODE_SMELL",
            severity: "CRITICAL",
            rule: "typescript:S3776",
            component: "Evref-BL_DevNexus:src/cli.ts",
          },
        ],
      },
    });

    expect(result.status).toBe("passed");
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("security hotspots"),
        expect.stringContaining("critical/blocker code-smell"),
      ]),
    );
  });

  it("fails when coverage was not imported", () => {
    const result = evaluateQualityGate({
      measures: measures({
        coverage: "0.0",
        branch_coverage: "0.0",
        duplicated_lines_density: "4.8",
        vulnerabilities: "0",
      }),
      issues: { issues: [] },
    });

    expect(result.status).toBe("failed");
    expect(result.failures).toEqual(expect.arrayContaining([expect.stringContaining("coverage")]));
  });

  it("fails on vulnerability measures", () => {
    const result = evaluateQualityGate({
      measures: measures({
        coverage: "80",
        branch_coverage: "70",
        duplicated_lines_density: "4.8",
        vulnerabilities: "1",
      }),
      issues: { issues: [] },
    });

    expect(result.status).toBe("failed");
    expect(result.failures).toEqual(expect.arrayContaining([expect.stringContaining("vulnerabilities")]));
  });

  it("fails on bug measures", () => {
    const result = evaluateQualityGate({
      measures: measures({
        coverage: "80",
        branch_coverage: "70",
        duplicated_lines_density: "4.8",
        vulnerabilities: "0",
        bugs: "1",
      }),
      issues: { issues: [] },
    });

    expect(result.status).toBe("failed");
    expect(result.failures).toEqual(expect.arrayContaining([expect.stringContaining("bugs")]));
  });

  it("fails on any bug issue", () => {
    const result = evaluateQualityGate({
      measures: measures({
        coverage: "80",
        branch_coverage: "70",
        duplicated_lines_density: "4.8",
        vulnerabilities: "0",
        bugs: "0",
      }),
      issues: {
        issues: [
          {
            type: "BUG",
            severity: "MAJOR",
            rule: "typescript:S0000",
            component: "Evref-BL_DevNexus:src/example.ts",
          },
        ],
      },
    });

    expect(result.status).toBe("failed");
    expect(result.failures).toEqual(expect.arrayContaining([expect.stringContaining("BUG")]));
  });
});
