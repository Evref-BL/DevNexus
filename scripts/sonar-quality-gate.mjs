#!/usr/bin/env node
import fs from "node:fs";

const DEFAULT_OPTIONS = {
  minCoverage: 70,
  minBranchCoverage: 60,
  maxDuplicatedLinesDensity: 10,
};

export function evaluateQualityGate(input, options = {}) {
  const gateOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const measures = normalizeMeasures(input.measures ?? input);
  const issues = Array.isArray(input.issues?.issues) ? input.issues.issues : [];
  const failures = [];
  const warnings = [];

  requireAtLeast(measures, "coverage", gateOptions.minCoverage, "overall coverage", failures);
  requireAtLeast(measures, "branch_coverage", gateOptions.minBranchCoverage, "branch coverage", failures);
  requireAtMost(
    measures,
    "duplicated_lines_density",
    gateOptions.maxDuplicatedLinesDensity,
    "duplicated-line density",
    failures,
  );

  if ((measures.vulnerabilities ?? 0) > 0) {
    failures.push(`Sonar reported ${measures.vulnerabilities} vulnerabilities.`);
  }

  if ((measures.bugs ?? 0) > 0) {
    failures.push(`Sonar reported ${measures.bugs} bugs.`);
  }

  const vulnerabilityIssues = issues.filter((issue) => issue.type === "VULNERABILITY");
  if (vulnerabilityIssues.length > 0) {
    failures.push(`Sonar reported ${vulnerabilityIssues.length} vulnerability issues.`);
  }

  const bugIssues = issues.filter((issue) => issue.type === "BUG");
  if (bugIssues.length > 0) {
    failures.push(`Sonar reported ${bugIssues.length} BUG issues.`);
  }

  if ((measures.security_hotspots ?? 0) > 0) {
    warnings.push(`Sonar reported ${measures.security_hotspots} security hotspots for review.`);
  }

  const seriousCodeSmells = issues.filter(
    (issue) => issue.type === "CODE_SMELL" && (issue.severity === "BLOCKER" || issue.severity === "CRITICAL"),
  );
  if (seriousCodeSmells.length > 0) {
    warnings.push(
      `Sonar reported ${seriousCodeSmells.length} critical/blocker code-smell issues; track as refactor debt.`,
    );
  }

  return {
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    warnings,
    summary: {
      coverage: measures.coverage ?? null,
      branchCoverage: measures.branch_coverage ?? null,
      duplicatedLinesDensity: measures.duplicated_lines_density ?? null,
      bugs: measures.bugs ?? null,
      vulnerabilities: measures.vulnerabilities ?? null,
      securityHotspots: measures.security_hotspots ?? null,
      codeSmells: measures.code_smells ?? null,
    },
  };
}

function normalizeMeasures(rawMeasures) {
  if (rawMeasures?.component?.measures) {
    return Object.fromEntries(
      rawMeasures.component.measures.map((measure) => [measure.metric, numberOrNull(measure.value)]),
    );
  }
  if (rawMeasures && typeof rawMeasures === "object") {
    return Object.fromEntries(
      Object.entries(rawMeasures).map(([metric, value]) => [metric, numberOrNull(value)]),
    );
  }
  return {};
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireAtLeast(measures, metric, minimum, label, failures) {
  const value = measures[metric];
  if (value === null || value === undefined) {
    failures.push(`Sonar did not report ${label}.`);
    return;
  }
  if (value < minimum) {
    failures.push(`Sonar ${label} is ${value}; expected at least ${minimum}.`);
  }
}

function requireAtMost(measures, metric, maximum, label, failures) {
  const value = measures[metric];
  if (value === null || value === undefined) {
    failures.push(`Sonar did not report ${label}.`);
    return;
  }
  if (value > maximum) {
    failures.push(`Sonar ${label} is ${value}; expected at most ${maximum}.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return 0;
  }

  const input = await readInput(args);
  const result = evaluateQualityGate(input, {
    minCoverage: Number(args.minCoverage ?? DEFAULT_OPTIONS.minCoverage),
    minBranchCoverage: Number(args.minBranchCoverage ?? DEFAULT_OPTIONS.minBranchCoverage),
    maxDuplicatedLinesDensity: Number(
      args.maxDuplicatedLinesDensity ?? DEFAULT_OPTIONS.maxDuplicatedLinesDensity,
    ),
  });

  console.log(JSON.stringify(result, null, 2));
  return result.status === "passed" ? 0 : 1;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

async function readInput(args) {
  if (args.measures) {
    return {
      measures: readJsonFile(args.measures),
      issues: args.issues ? readJsonFile(args.issues) : { issues: [] },
    };
  }

  const hostUrl = args.hostUrl ?? process.env.SONAR_HOST_URL;
  const projectKey = args.projectKey ?? process.env.SONAR_PROJECT_KEY ?? "Evref-BL_DevNexus";
  const token = args.token ?? process.env.SONAR_TOKEN;
  if (!hostUrl || !token) {
    throw new Error("Provide --measures/--issues files or SONAR_HOST_URL and SONAR_TOKEN.");
  }

  const metricKeys = [
    "coverage",
    "branch_coverage",
    "duplicated_lines_density",
    "bugs",
    "vulnerabilities",
    "security_hotspots",
    "code_smells",
  ].join(",");
  const measures = await sonarGet(
    hostUrl,
    `/api/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=${encodeURIComponent(
      metricKeys,
    )}`,
    token,
  );
  const issues = await sonarRelevantIssues(
    hostUrl,
    projectKey,
    token,
  );
  return { measures, issues };
}

async function sonarRelevantIssues(hostUrl, projectKey, token) {
  const [bugAndVulnerabilityIssues, seriousCodeSmellIssues] = await Promise.all([
    sonarGet(
      hostUrl,
      `/api/issues/search?componentKeys=${encodeURIComponent(
        projectKey,
      )}&types=BUG,VULNERABILITY&ps=500`,
      token,
    ),
    sonarGet(
      hostUrl,
      `/api/issues/search?componentKeys=${encodeURIComponent(
        projectKey,
      )}&types=CODE_SMELL&severities=BLOCKER,CRITICAL&ps=500`,
      token,
    ),
  ]);
  return {
    issues: [
      ...(bugAndVulnerabilityIssues.issues ?? []),
      ...(seriousCodeSmellIssues.issues ?? []),
    ],
  };
}

function readJsonFile(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function sonarGet(hostUrl, path, token) {
  const url = new URL(path, hostUrl.endsWith("/") ? hostUrl : `${hostUrl}/`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Sonar request failed: ${response.status} ${response.statusText} ${url}`);
  }
  return response.json();
}

function printUsage() {
  console.log(`Usage:
  node scripts/sonar-quality-gate.mjs --measures measures.json [--issues issues.json]
  SONAR_HOST_URL=http://localhost:9000 SONAR_TOKEN=... node scripts/sonar-quality-gate.mjs

Defaults:
  --min-coverage 70
  --min-branch-coverage 60
  --max-duplicated-lines-density 10
  failures: any Sonar bug or vulnerability, low coverage, or high duplication`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
