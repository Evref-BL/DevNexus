import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type QualityGateResult = {
  status: "passed" | "failed";
  failures: string[];
  warnings: string[];
  summary: Record<string, number | null>;
};

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/sonar-quality-gate.mjs",
);

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
    const result = runQualityGate({
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

    expect(result.exitCode).toBe(0);
    expect(result.output.status).toBe("passed");
    expect(result.output.failures).toEqual([]);
    expect(result.output.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("security hotspots"),
        expect.stringContaining("critical/blocker code-smell"),
      ]),
    );
  });

  it("fails when coverage was not imported", () => {
    const result = runQualityGate({
      measures: measures({
        coverage: "0.0",
        branch_coverage: "0.0",
        duplicated_lines_density: "4.8",
        vulnerabilities: "0",
      }),
      issues: { issues: [] },
    });

    expect(result.exitCode).toBe(1);
    expect(result.output.status).toBe("failed");
    expect(result.output.failures).toEqual(
      expect.arrayContaining([expect.stringContaining("coverage")]),
    );
  });

  it("fails on vulnerability measures", () => {
    const result = runQualityGate({
      measures: measures({
        coverage: "80",
        branch_coverage: "70",
        duplicated_lines_density: "4.8",
        vulnerabilities: "1",
      }),
      issues: { issues: [] },
    });

    expect(result.exitCode).toBe(1);
    expect(result.output.status).toBe("failed");
    expect(result.output.failures).toEqual(
      expect.arrayContaining([expect.stringContaining("vulnerabilities")]),
    );
  });

  it("fails on bug measures", () => {
    const result = runQualityGate({
      measures: measures({
        coverage: "80",
        branch_coverage: "70",
        duplicated_lines_density: "4.8",
        vulnerabilities: "0",
        bugs: "1",
      }),
      issues: { issues: [] },
    });

    expect(result.exitCode).toBe(1);
    expect(result.output.status).toBe("failed");
    expect(result.output.failures).toEqual(
      expect.arrayContaining([expect.stringContaining("bugs")]),
    );
  });

  it("fails on any bug issue", () => {
    const result = runQualityGate({
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

    expect(result.exitCode).toBe(1);
    expect(result.output.status).toBe("failed");
    expect(result.output.failures).toEqual(
      expect.arrayContaining([expect.stringContaining("BUG")]),
    );
  });
});

function runQualityGate(input: {
  measures: unknown;
  issues?: unknown;
}): {
  exitCode: number | null;
  output: QualityGateResult;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-nexus-sonar-gate-"));
  const measuresPath = path.join(root, "measures.json");
  const issuesPath = path.join(root, "issues.json");
  fs.writeFileSync(measuresPath, JSON.stringify(input.measures), "utf8");
  fs.writeFileSync(issuesPath, JSON.stringify(input.issues ?? { issues: [] }), "utf8");

  const result = spawnSync(
    process.execPath,
    [scriptPath, "--measures", measuresPath, "--issues", issuesPath],
    { encoding: "utf8" },
  );
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toBe("");

  return {
    exitCode: result.status,
    output: JSON.parse(result.stdout) as QualityGateResult,
  };
}
