#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { evaluateQualityGate } from "./sonar-quality-gate.mjs";

const DEFAULTS = {
  sonarqubeImage: "sonarqube:community",
  scannerImage: "sonarsource/sonar-scanner-cli",
  projectKey: "Evref-BL_DevNexus",
  waitAttempts: 90,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return 0;
  }

  const startedAt = Date.now();
  const suffix = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const serverName = `devnexus-sonar-${suffix}`;
  const networkName = `${serverName}-net`;
  const password = `DevNexusAudit-${suffix}`;
  const tempRoot = path.join(tmpdir(), `devnexus-sonar-audit-${suffix}`);
  let serverStarted = false;
  let networkCreated = false;

  try {
    if (!args.skipCoverage) {
      run("npm", ["run", "coverage:all"], { cwd: process.cwd() });
    }

    run("docker", ["network", "create", networkName]);
    networkCreated = true;
    run("docker", [
      "run",
      "-d",
      "--name",
      serverName,
      "--network",
      networkName,
      "-p",
      "127.0.0.1::9000",
      "-e",
      "SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true",
      args.sonarqubeImage ?? DEFAULTS.sonarqubeImage,
    ]);
    serverStarted = true;

    const port = dockerPort(serverName);
    await waitForSonar(`http://127.0.0.1:${port}`, Number(args.waitAttempts ?? DEFAULTS.waitAttempts));
    await changeAdminPassword(`http://127.0.0.1:${port}`, password);
    const token = await generateToken(`http://127.0.0.1:${port}`, password);

    run("docker", [
      "run",
      "--rm",
      "--network",
      networkName,
      "-e",
      `SONAR_HOST_URL=http://${serverName}:9000`,
      "-e",
      `SONAR_TOKEN=${token}`,
      "-v",
      `${process.cwd()}:/usr/src`,
      args.scannerImage ?? DEFAULTS.scannerImage,
      "-Dsonar.scm.disabled=true",
      "-Dsonar.working.directory=/tmp/.scannerwork",
      "-Dsonar.qualitygate.wait=true",
    ]);

    const hostUrl = `http://127.0.0.1:${port}`;
    const projectKey = args.projectKey ?? DEFAULTS.projectKey;
    const measures = await sonarGet(
      hostUrl,
      `/api/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=${encodeURIComponent(
        [
          "coverage",
          "branch_coverage",
          "duplicated_lines_density",
          "bugs",
          "vulnerabilities",
          "security_hotspots",
          "code_smells",
        ].join(","),
      )}`,
      token,
    );
    const issues = await sonarRelevantIssues(
      hostUrl,
      projectKey,
      token,
    );
    const securityHotspots = args.writeResults
      ? await sonarGet(
        hostUrl,
        `/api/hotspots/search?projectKey=${encodeURIComponent(projectKey)}&ps=500`,
        token,
      )
      : null;
    const result = evaluateQualityGate({ measures, issues });

    if (args.writeResults) {
      run("mkdir", ["-p", tempRoot]);
      writeFileSync(path.join(tempRoot, "measures.json"), JSON.stringify(measures, null, 2));
      writeFileSync(path.join(tempRoot, "issues.json"), JSON.stringify(issues, null, 2));
      writeFileSync(
        path.join(tempRoot, "security-hotspots.json"),
        JSON.stringify(securityHotspots, null, 2),
      );
      writeFileSync(path.join(tempRoot, "quality-gate.json"), JSON.stringify(result, null, 2));
      console.error(`Wrote Sonar audit API results to ${tempRoot}`);
    }

    console.log(JSON.stringify(result, null, 2));
    return result.status === "passed" ? 0 : 1;
  } finally {
    if (!args.keepServer && serverStarted) {
      runAllowFailure("docker", ["rm", "-fv", serverName]);
    }
    if (!args.keepServer && networkCreated) {
      runAllowFailure("docker", ["network", "rm", networkName]);
    }
    if (!args.writeResults) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
    rmSync(".scannerwork", { recursive: true, force: true });
  }
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
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function runAllowFailure(command, args) {
  spawnSync(command, args, { stdio: "ignore" });
}

function dockerPort(serverName) {
  const result = spawnSync("docker", ["port", serverName, "9000/tcp"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Unable to read Docker port for ${serverName}`);
  }
  const output = result.stdout.trim();
  return output.slice(output.lastIndexOf(":") + 1);
}

async function waitForSonar(hostUrl, attempts) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(new URL("/api/system/status", hostUrl));
      if (response.ok) {
        const payload = await response.json();
        if (payload.status === "UP") {
          return;
        }
      }
    } catch {
      // The server is still booting.
    }
    await sleep(2000);
  }
  throw new Error(`SonarQube did not become ready after ${attempts} attempts.`);
}

async function changeAdminPassword(hostUrl, password) {
  const body = new URLSearchParams({
    login: "admin",
    previousPassword: "admin",
    password,
  });
  const response = await fetch(new URL("/api/users/change_password", hostUrl), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from("admin:admin").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok && response.status !== 400) {
    throw new Error(`Unable to set SonarQube admin password: ${response.status} ${response.statusText}`);
  }
}

async function generateToken(hostUrl, password) {
  const body = new URLSearchParams({ name: `devnexus-audit-${Date.now()}` });
  const response = await fetch(new URL("/api/user_tokens/generate", hostUrl), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Unable to create SonarQube token: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return payload.token;
}

async function sonarGet(hostUrl, requestPath, token) {
  const url = new URL(requestPath, hostUrl);
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
        },
      });
      if (response.ok) {
        return response.json();
      }
      lastError = new Error(`Sonar request failed: ${response.status} ${response.statusText} ${requestPath}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw lastError instanceof Error ? lastError : new Error(`Sonar request failed: ${requestPath}`);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printUsage() {
  console.log(`Usage:
  npm run quality:sonar-local

Options:
  --skip-coverage       Reuse existing coverage/lcov.info files.
  --write-results       Write Sonar API JSON to a temporary directory.
  --keep-server         Leave the temporary SonarQube container running.
  --project-key KEY     Sonar project key. Default: ${DEFAULTS.projectKey}
  --sonarqube-image IMG SonarQube Docker image. Default: ${DEFAULTS.sonarqubeImage}
  --scanner-image IMG   SonarScanner Docker image. Default: ${DEFAULTS.scannerImage}`);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
