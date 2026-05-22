#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const entrypoints = new Set(["mcp-stdio", "setup", "status", "doctor"]);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDirectory, "..");
const sourceRoot = path.resolve(pluginRoot, "..", "..");
const distIndexPath = path.join(sourceRoot, "dist", "index.js");
const distCliPath = path.join(sourceRoot, "dist", "cli.js");
const entrypoint = entrypoints.has(process.argv[2]) ? process.argv[2] : "doctor";
const extraArgs = entrypoints.has(process.argv[2])
  ? process.argv.slice(3)
  : process.argv.slice(2);

let api;
try {
  api = await import(pathToFileURL(distIndexPath).href);
} catch (error) {
  console.error("DevNexus Codex wrapper could not load the local DevNexus build.");
  console.error("Run npm run build in the DevNexus source checkout before local plugin use.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const plan = api.planNexusAgentClientAdapterCommand({
  client: "codex",
  entrypoint,
  extraArgs,
  startDirectory: process.cwd(),
  sourceRoot,
  sourceCliPath: distCliPath,
  env: process.env,
});

if (!plan.invocation) {
  console.error(JSON.stringify({
    ok: false,
    status: plan.status,
    diagnostics: plan.diagnostics,
    advisory: plan.advisory,
  }, null, 2));
  process.exit(1);
}

const child = spawn(plan.invocation.command, plan.invocation.args, {
  cwd: plan.invocation.cwd,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

await new Promise((resolve) => {
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`DevNexus Codex wrapper child exited from signal ${signal}.`);
      process.exitCode = 1;
      resolve();
      return;
    }
    process.exitCode = code ?? 1;
    resolve();
  });
  child.on("error", (error) => {
    console.error(`DevNexus Codex wrapper failed: ${error.message}`);
    process.exitCode = 1;
    resolve();
  });
});
