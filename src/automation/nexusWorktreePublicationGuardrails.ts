import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveNexusCommandPath } from "../runtime/nexusCommandPath.js";

export const nexusPublicationCommandGuardrailId =
  "publication-command-guard" as const;

export type NexusWorktreePublicationGuardrailStatus =
  | "materialized"
  | "skipped";

export interface NexusWorktreePublicationGuardrailCommand {
  command: "git" | "gh" | "glab";
  realPath: string | null;
  launcherPath: string;
}

export interface NexusWorktreePublicationGuardrailResult {
  id: typeof nexusPublicationCommandGuardrailId;
  status: NexusWorktreePublicationGuardrailStatus;
  rootDirectoryPath: string;
  binDirectoryPath: string;
  guardScriptPath: string;
  commands: NexusWorktreePublicationGuardrailCommand[];
  environment: Record<string, string>;
  message: string;
}

const guardedCommands = ["git", "gh", "glab"] as const;

export function materializeNexusWorktreePublicationGuardrails(options: {
  worktreePath: string;
  env?: NodeJS.ProcessEnv;
  nodePath?: string;
  platform?: NodeJS.Platform;
}): NexusWorktreePublicationGuardrailResult {
  const worktreePath = path.resolve(requiredNonEmptyString(
    options.worktreePath,
    "worktreePath",
  ));
  const rootDirectoryPath = path.join(worktreePath, ".dev-nexus", "guardrails");
  const binDirectoryPath = path.join(rootDirectoryPath, "bin");
  const guardScriptPath = path.join(
    rootDirectoryPath,
    "publication-command-guard.mjs",
  );
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const nodePath = options.nodePath ?? process.execPath;
  const commands = guardedCommands.map((command) => ({
    command,
    realPath: resolveGuardedCommandRealPath(command, binDirectoryPath, env),
    launcherPath: guardedCommandLauncherPath(binDirectoryPath, command, platform),
  }));

  fs.mkdirSync(binDirectoryPath, { recursive: true });
  fs.writeFileSync(
    guardScriptPath,
    renderPublicationCommandGuardScript(commands),
    "utf8",
  );
  if (platform !== "win32") {
    fs.chmodSync(guardScriptPath, 0o755);
  }

  for (const command of commands) {
    writeGuardLauncher({
      command: command.command,
      launcherPath: command.launcherPath,
      guardScriptPath,
      nodePath,
      platform,
    });
  }

  return {
    id: nexusPublicationCommandGuardrailId,
    status: "materialized",
    rootDirectoryPath,
    binDirectoryPath,
    guardScriptPath,
    commands,
    environment: publicationGuardrailEnvironment(binDirectoryPath, env),
    message:
      "Prepared worktree-local wrappers that block raw publication mutations and delegate read-only diagnostics to the real tools.",
  };
}

export function publicationGuardrailEnvironment(
  binDirectoryPath: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return {
    PATH: prependPathDirectory(binDirectoryPath, baseEnv),
    DEV_NEXUS_PUBLICATION_GUARD_BIN: binDirectoryPath,
  };
}

function resolveGuardedCommandRealPath(
  command: string,
  guardBinDirectory: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const filteredPath = pathValue
    .split(path.delimiter)
    .filter((entry) => path.resolve(entry) !== path.resolve(guardBinDirectory))
    .join(path.delimiter);

  try {
    return resolveNexusCommandPath(command, {
      ...env,
      PATH: filteredPath,
    });
  } catch {
    return null;
  }
}

function guardedCommandLauncherPath(
  binDirectoryPath: string,
  command: NexusWorktreePublicationGuardrailCommand["command"],
  platform: NodeJS.Platform,
): string {
  return path.join(
    binDirectoryPath,
    platform === "win32" ? `${command}.cmd` : command,
  );
}

function writeGuardLauncher(options: {
  command: NexusWorktreePublicationGuardrailCommand["command"];
  launcherPath: string;
  guardScriptPath: string;
  nodePath: string;
  platform: NodeJS.Platform;
}): void {
  const content =
    options.platform === "win32"
      ? renderWindowsLauncher(options)
      : renderPosixLauncher(options);
  fs.writeFileSync(options.launcherPath, content, "utf8");
  if (options.platform !== "win32") {
    fs.chmodSync(options.launcherPath, 0o755);
  }
}

function renderPosixLauncher(options: {
  command: NexusWorktreePublicationGuardrailCommand["command"];
  guardScriptPath: string;
  nodePath: string;
}): string {
  return [
    "#!/usr/bin/env sh",
    `exec ${shellSingleQuote(options.nodePath)} ${shellSingleQuote(
      options.guardScriptPath,
    )} ${shellSingleQuote(options.command)} "$@"`,
    "",
  ].join("\n");
}

function renderWindowsLauncher(options: {
  command: NexusWorktreePublicationGuardrailCommand["command"];
  guardScriptPath: string;
  nodePath: string;
}): string {
  return [
    "@echo off",
    `"${options.nodePath}" "${options.guardScriptPath}" ${options.command} %*`,
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

function renderPublicationCommandGuardScript(
  commands: NexusWorktreePublicationGuardrailCommand[],
): string {
  const commandConfig = Object.fromEntries(
    commands.map((command) => [
      command.command,
      {
        realPath: command.realPath,
      },
    ]),
  );

  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const commandConfig = ${JSON.stringify(commandConfig, null, 2)};
const tool = process.argv[2];
const args = process.argv.slice(3);
const config = commandConfig[tool];

if (!config) {
  console.error(\`DevNexus publication guard does not manage command: \${tool ?? "unknown"}\`);
  process.exit(127);
}

const decision = publicationCommandDecision(tool, args);
if (!decision.allowed) {
  console.error(decision.message);
  process.exit(126);
}

if (!config.realPath) {
  console.error(\`DevNexus publication guard could not find the real \${tool} command on PATH.\`);
  process.exit(127);
}

const spawnTarget = guardedSpawnTarget(config.realPath, args);
const result = spawnSync(spawnTarget.command, spawnTarget.args, {
  env: process.env,
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(127);
}

process.exit(result.status ?? (result.signal ? 128 : 1));

function guardedSpawnTarget(realPath, args) {
  if (process.platform === "win32" && /\\.(?:cmd|bat)$/iu.test(realPath)) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", realPath, ...args],
    };
  }

  return {
    command: realPath,
    args,
  };
}

function publicationCommandDecision(tool, args) {
  if (process.env.DEV_NEXUS_PUBLICATION_FACADE === "1") {
    return { allowed: true };
  }

  if (tool === "git") {
    return args[0] === "push"
      ? blocked("raw git push", "Use publication_branch_push or publication_review_handoff through the DevNexus publication facade.")
      : { allowed: true };
  }

  if (tool === "gh") {
    return isGitHubCliReadOnly(args)
      ? { allowed: true }
      : blocked("raw gh provider mutation", "Use DevNexus publication or work-item MCP tools for provider writes.");
  }

  if (tool === "glab") {
    return isGitLabCliReadOnly(args)
      ? { allowed: true }
      : blocked("raw glab provider mutation", "Use DevNexus publication or work-item MCP tools for provider writes.");
  }

  return blocked(\`raw \${tool} provider command\`, "Use the DevNexus facade for provider writes.");
}

function blocked(operation, nextAction) {
  return {
    allowed: false,
    message: \`DevNexus blocked \${operation} from this worktree. \${nextAction} Read-only diagnostics remain allowed.\`,
  };
}

function isGitHubCliReadOnly(args) {
  const normalized = stripLeadingGlobalOptions(args);
  if (isHelpOrVersion(normalized)) {
    return true;
  }

  const [group, action] = normalized;
  if (group === "auth") {
    return action === "status";
  }
  if (group === "api") {
    return isReadOnlyApiInvocation(normalized.slice(1));
  }

  return readOnlyAction({
    group,
    action,
    allowed: {
      issue: ["list", "status", "view"],
      pr: ["checks", "diff", "list", "status", "view"],
      repo: ["list", "view"],
      run: ["list", "view", "watch"],
      workflow: ["list", "view"],
    },
  });
}

function isGitLabCliReadOnly(args) {
  const normalized = stripLeadingGlobalOptions(args);
  if (isHelpOrVersion(normalized)) {
    return true;
  }

  const [group, action] = normalized;
  if (group === "auth") {
    return action === "status";
  }
  if (group === "api") {
    return isReadOnlyApiInvocation(normalized.slice(1));
  }

  return readOnlyAction({
    group,
    action,
    allowed: {
      ci: ["list", "status", "view"],
      issue: ["list", "view"],
      mr: ["diff", "list", "view"],
      pipeline: ["list", "status", "view"],
      repo: ["view"],
    },
  });
}

function readOnlyAction(options) {
  const allowedActions = options.allowed[options.group] ?? [];
  return allowedActions.includes(options.action);
}

function isHelpOrVersion(args) {
  return args.length === 0 ||
    args.includes("--help") ||
    args.includes("-h") ||
    args.includes("--version") ||
    args[0] === "help" ||
    args[0] === "version";
}

function stripLeadingGlobalOptions(args) {
  const optionsWithValues = new Set([
    "--config",
    "--hostname",
    "--repo",
    "-R",
  ]);
  const result = [...args];
  while (result[0]?.startsWith("-")) {
    const option = result.shift();
    if (!option) {
      break;
    }
    if (optionsWithValues.has(option)) {
      result.shift();
    }
  }
  return result;
}

function isReadOnlyApiInvocation(args) {
  if (args[0] === "graphql") {
    return false;
  }

  const method = apiMethod(args).toUpperCase();
  return (method === "GET" || method === "HEAD") && !hasApiBodyOption(args);
}

function apiMethod(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--method" || arg === "-X") {
      return args[index + 1] ?? "GET";
    }
    if (arg?.startsWith("--method=")) {
      return arg.slice("--method=".length);
    }
  }
  return hasApiBodyOption(args) ? "POST" : "GET";
}

function hasApiBodyOption(args) {
  return args.some((arg) =>
    arg === "--field" ||
    arg === "-f" ||
    arg === "--raw-field" ||
    arg === "-F" ||
    arg === "--input" ||
    arg.startsWith("--field=") ||
    arg.startsWith("--raw-field=") ||
    arg.startsWith("--input=")
  );
}
`;
}

function prependPathDirectory(
  directoryPath: string,
  env: NodeJS.ProcessEnv,
): string {
  const currentPath = env.PATH ?? env.Path ?? env.path ?? "";
  return currentPath
    ? `${directoryPath}${path.delimiter}${currentPath}`
    : directoryPath;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function requiredNonEmptyString(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}
