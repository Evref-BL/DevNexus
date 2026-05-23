#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const keepTemp = process.argv.includes("--keep-temp");
const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

if (nodeMajor < 22) {
  throw new Error(
    `DevNexus onboarding smoke requires Node.js 22 or newer; current runtime is ${process.version}.`,
  );
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dev-nexus-onboarding-smoke-"));
const checks = [];

try {
  const packageJson = readJson(path.join(repoRoot, "package.json"));
  ensureBuilt();

  const packRoot = path.join(tempRoot, "pack");
  fs.mkdirSync(packRoot, { recursive: true });
  const packOutput = run(npmCommand, ["pack", "--pack-destination", packRoot, "--json"], {
    cwd: repoRoot,
    label: "npm pack",
  });
  const packEntries = parseJson(packOutput.stdout, "npm pack JSON output");
  const packEntry = Array.isArray(packEntries) ? packEntries.at(-1) : null;
  if (!packEntry || typeof packEntry.filename !== "string") {
    throw new Error(`npm pack did not report a tarball filename: ${packOutput.stdout}`);
  }
  const tarballPath = path.join(packRoot, packEntry.filename);
  assertFile(tarballPath, "packed npm tarball");
  record("npm-pack", `Packed ${packageJson.name}@${packageJson.version}.`);

  const runtimeRoot = path.join(tempRoot, "runtime");
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(
    path.join(runtimeRoot, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  run(
    npmCommand,
    ["install", tarballPath, "--no-audit", "--no-fund", "--ignore-scripts"],
    {
      cwd: runtimeRoot,
      label: "install packed package",
    },
  );
  assertInstalledBin(runtimeRoot);
  record("npm-install", "Installed the packed package into an isolated temp project.");

  const smokeEnv = {
    ...process.env,
    DEV_NEXUS_HOME: path.join(tempRoot, "home"),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };

  runDevNexus(runtimeRoot, ["--help"], smokeEnv);
  record("cli-help", "Installed dev-nexus --help completed.");

  const skew = parseJson(
    runDevNexus(
      runtimeRoot,
      ["diagnostics", "cli-version-skew", "--installed-command", "dev-nexus", "--json"],
      smokeEnv,
    ).stdout,
    "cli-version-skew JSON output",
  );
  assertEqual(skew.ok, true, "packaged CLI/docs version skew check should pass");
  assertNonEmptyArray(
    skew.diagnostic?.expectedCommands,
    "packaged CLI/docs version skew expected commands",
  );
  record("cli-doc-skew", "Packaged docs match the installed CLI command surface.");

  const workspaceRoot = path.join(tempRoot, "workspace", "rocket-shop-suite");
  const answersPath = path.join(tempRoot, "dev-nexus.setup.json");
  writeJsonFile(answersPath, {
    project: {
      id: "rocket-shop-suite",
      name: "Rocket Shop Suite",
      root: workspaceRoot,
      initializeGit: true,
      defaultBranch: "main",
    },
    components: [
      {
        id: "checkout-api",
        name: "Checkout API",
        role: "primary",
        source: {
          kind: "create_local",
          path: "components/checkout-api",
          initializeGit: true,
          defaultBranch: "main",
        },
      },
    ],
    agentTargets: [
      {
        provider: "codex",
        configPath: ".codex/config.toml",
      },
    ],
    localWorkTracking: {
      enabled: true,
      provider: "local",
    },
  });

  const dryRun = parseJson(
    runDevNexus(
      runtimeRoot,
      ["workspace", "init", workspaceRoot, "--answers", answersPath, "--dry-run", "--json"],
      smokeEnv,
    ).stdout,
    "workspace init dry-run JSON output",
  );
  assertEqual(dryRun.ok, true, "workspace init dry-run should be ready");
  assertEqual(dryRun.applied, false, "workspace init --dry-run must not apply writes");
  assertEqual(
    fs.existsSync(path.join(workspaceRoot, "dev-nexus.project.json")),
    false,
    "workspace init --dry-run wrote dev-nexus.project.json",
  );
  record("workspace-init-dry-run", "Answer-file preview succeeded without local writes.");

  const applied = parseJson(
    runDevNexus(
      runtimeRoot,
      ["workspace", "init", workspaceRoot, "--answers", answersPath, "--json"],
      smokeEnv,
    ).stdout,
    "workspace init apply JSON output",
  );
  assertEqual(applied.ok, true, "workspace init apply should succeed");
  assertEqual(applied.applied, true, "workspace init without --dry-run should apply writes");
  record("workspace-init-apply", "Answer-file setup applied local workspace writes.");

  for (const [filePath, label] of [
    [path.join(workspaceRoot, "dev-nexus.project.json"), "workspace config"],
    [path.join(workspaceRoot, "AGENTS.md"), "generated AGENTS.md"],
    [path.join(workspaceRoot, ".dev-nexus", "README.md"), "DevNexus support README"],
    [path.join(workspaceRoot, ".codex", "config.toml"), "Codex MCP config"],
    [
      path.join(workspaceRoot, ".dev-nexus", "work-items", "checkout-api.json"),
      "local work-item store",
    ],
    [path.join(workspaceRoot, "components", "checkout-api"), "workspace-local component"],
    [path.join(smokeEnv.DEV_NEXUS_HOME, "dev-nexus.home.json"), "home registry"],
  ]) {
    assertFile(filePath, label);
  }
  record("generated-files", "Workspace, component, home, tracker, and agent files exist.");

  const status = parseJson(
    runDevNexus(
      runtimeRoot,
      ["workspace", "status", workspaceRoot, "--json"],
      smokeEnv,
    ).stdout,
    "workspace status JSON output",
  );
  assertEqual(status.ok, true, "workspace status should succeed");
  assertEqual(
    status.project?.id,
    "rocket-shop-suite",
    "workspace status should report the created workspace",
  );
  record("workspace-status", "Created workspace is readable through workspace status.");

  const setupCheck = parseJson(
    runDevNexus(
      runtimeRoot,
      ["setup", "check", workspaceRoot, "join-existing-project", "--json"],
      smokeEnv,
    ).stdout,
    "setup check JSON output",
  );
  assertEqual(setupCheck.ok, true, "setup check command should succeed");
  if (setupCheck.check?.status === "blocked") {
    throw new Error(
      `setup check is blocked: ${JSON.stringify(setupCheck.check.nextActions ?? [], null, 2)}`,
    );
  }
  record(
    "setup-check",
    `join-existing-project setup check is ${setupCheck.check?.status ?? "unknown"}.`,
  );

  runEmbeddedWorkspaceSmoke({ runtimeRoot, smokeEnv });

  const result = {
    ok: true,
    package: {
      name: packageJson.name,
      version: packageJson.version,
    },
    checks,
    tempRoot: keepTemp ? tempRoot : null,
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (!keepTemp) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runEmbeddedWorkspaceSmoke({ runtimeRoot, smokeEnv }) {
  const productRoot = path.join(tempRoot, "workspace", "embedded-service");
  fs.mkdirSync(path.join(productRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(productRoot, "src", "app.txt"), "demo\n");
  run("git", ["init", "--initial-branch=main"], {
    cwd: productRoot,
    label: "initialize embedded product repo",
  });
  run("git", ["add", "src/app.txt"], {
    cwd: productRoot,
    label: "stage embedded product source",
  });
  run(
    "git",
    [
      "-c",
      "user.name=DevNexus Smoke",
      "-c",
      "user.email=dev-nexus-smoke@example.invalid",
      "commit",
      "-m",
      "Initial product source",
    ],
    {
      cwd: productRoot,
      label: "commit embedded product source",
    },
  );

  const embeddedAnswersPath = path.join(tempRoot, "embedded.setup.json");
  writeJsonFile(embeddedAnswersPath, {
    project: {
      id: "embedded-service",
      name: "Embedded Service",
      root: productRoot,
      initializeGit: false,
      defaultBranch: "main",
    },
    components: [
      {
        id: "embedded-service",
        name: "Embedded Service",
        role: "primary",
        source: {
          kind: "reference_existing",
          path: ".",
          defaultBranch: "main",
        },
      },
    ],
    agentTargets: [
      {
        provider: "codex",
        configPath: ".codex/config.toml",
      },
    ],
    localWorkTracking: {
      enabled: true,
      provider: "local",
    },
  });

  const applied = parseJson(
    runDevNexus(
      runtimeRoot,
      ["workspace", "init", productRoot, "--answers", embeddedAnswersPath, "--json"],
      smokeEnv,
    ).stdout,
    "embedded workspace init apply JSON output",
  );
  assertEqual(applied.ok, true, "embedded workspace init should succeed");
  assertEqual(applied.applied, true, "embedded workspace init should apply writes");

  const embeddedConfig = readJson(path.join(productRoot, "dev-nexus.project.json"));
  assertEqual(
    embeddedConfig.components?.[0]?.sourceRoot,
    ".",
    "embedded workspace primary component sourceRoot should remain project-relative",
  );

  const setupCheck = parseJson(
    runDevNexus(
      runtimeRoot,
      ["setup", "check", productRoot, "join-existing-project", "--json"],
      smokeEnv,
    ).stdout,
    "embedded setup check JSON output",
  );
  assertEqual(setupCheck.ok, true, "embedded setup check command should succeed");
  if (setupCheck.check?.status === "blocked") {
    throw new Error(
      `embedded setup check is blocked: ${JSON.stringify(setupCheck.check.nextActions ?? [], null, 2)}`,
    );
  }
  const sourceRootCheck = setupCheck.check?.checks?.find(
    (check) => check.id === "component-embedded-service-source-root",
  );
  assertEqual(
    sourceRootCheck?.details?.sourceRootTopology?.layout,
    "embedded",
    "embedded setup check should classify the root component as embedded",
  );
  record("embedded-workspace", "Embedded project-root workspace initialized and checked.");
}

function ensureBuilt() {
  const cliPath = path.join(repoRoot, "dist", "cli.js");
  if (fs.existsSync(cliPath)) {
    return;
  }

  run(npmCommand, ["run", "build"], {
    cwd: repoRoot,
    label: "npm run build",
  });
}

function runDevNexus(runtimeRoot, args, env) {
  return run(npmCommand, ["exec", "--", "dev-nexus", ...args], {
    cwd: runtimeRoot,
    env,
    label: `dev-nexus ${args.join(" ")}`,
  });
}

function run(command, args, options) {
  const spawnTarget = commandSpawnTarget(command, args);
  const result = spawnSync(spawnTarget.command, spawnTarget.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${options.label} failed with exit code ${result.status}.`,
        `Command: ${command} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
      ].filter(Boolean).join("\n\n"),
    );
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function commandSpawnTarget(command, args) {
  if (
    process.platform === "win32" &&
    [".bat", ".cmd"].includes(path.extname(command).toLowerCase())
  ) {
    return {
      command: envValue("COMSPEC") ?? "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }

  return { command, args };
}

function envValue(key) {
  const match = Object.entries(process.env).find(
    ([envKey]) => envKey.toLowerCase() === key.toLowerCase(),
  );

  return match?.[1];
}

function readJson(filePath) {
  return parseJson(fs.readFileSync(filePath, "utf8"), filePath);
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse ${source} as JSON: ${error.message}\n${text}`);
  }
}

function assertInstalledBin(runtimeRoot) {
  const binName = process.platform === "win32" ? "dev-nexus.cmd" : "dev-nexus";
  assertFile(path.join(runtimeRoot, "node_modules", ".bin", binName), "dev-nexus npm bin");
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertNonEmptyArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} should be a non-empty array.`);
  }
}

function record(id, summary) {
  checks.push({ id, summary });
}
