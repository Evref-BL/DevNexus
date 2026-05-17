import fs from "node:fs";
import path from "node:path";
import type {
  NexusProjectAgentMcpTarget,
  NexusProjectMcpConfig,
} from "./nexusProjectConfig.js";
import type { NexusSkillSourceControl } from "./nexusSkills.js";

export const defaultNexusMcpServerName = "dev_nexus";
export const defaultNexusMcpCommand = "dev-nexus";
export const defaultNexusMcpArgs = ["mcp-stdio"] as const;

export interface MaterializeNexusProjectAgentMcpConfigOptions {
  projectRoot: string;
  mcpConfig?: NexusProjectMcpConfig;
  agentTargets?: NexusProjectAgentMcpTarget[];
  excludeFromGit?: boolean;
}

export interface MaterializedNexusAgentMcpTarget {
  agent: string;
  serverName: string;
  command: string;
  args: string[];
  defaultToolsApprovalMode?: string;
  sourceControl: NexusSkillSourceControl;
  configPath: string;
  configFormat: "toml" | "json";
}

export interface MaterializeNexusProjectAgentMcpConfigResult {
  agentTargets: MaterializedNexusAgentMcpTarget[];
  gitExcludePath: string | null;
  gitExcludeEntries: string[];
}

interface ResolvedNexusAgentMcpTarget extends MaterializedNexusAgentMcpTarget {}

export class NexusAgentMcpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAgentMcpConfigError";
  }
}

export function emptyNexusProjectAgentMcpConfigResult(): MaterializeNexusProjectAgentMcpConfigResult {
  return {
    agentTargets: [],
    gitExcludePath: null,
    gitExcludeEntries: [],
  };
}

export function materializeNexusProjectAgentMcpConfig(
  options: MaterializeNexusProjectAgentMcpConfigOptions,
): MaterializeNexusProjectAgentMcpConfigResult {
  if (options.mcpConfig?.enabled === false) {
    return emptyNexusProjectAgentMcpConfigResult();
  }

  const projectRoot = path.resolve(options.projectRoot);
  const targets = resolveAgentMcpTargets(projectRoot, options);
  for (const target of targets) {
    if (target.configFormat === "toml") {
      writeCodexMcpConfig(target);
    } else {
      writeClaudeMcpConfig(target);
    }
  }

  const supportEntries = targets
    .filter((target) => target.sourceControl === "support")
    .map((target) => gitExcludeEntryForPath(projectRoot, target.configPath));
  const gitExclude =
    options.excludeFromGit === false
      ? { gitExcludePath: null, gitExcludeEntries: [] }
      : addGitExcludeEntries(projectRoot, supportEntries);

  return {
    agentTargets: targets,
    gitExcludePath: gitExclude.gitExcludePath,
    gitExcludeEntries: gitExclude.gitExcludeEntries,
  };
}

function resolveAgentMcpTargets(
  projectRoot: string,
  options: MaterializeNexusProjectAgentMcpConfigOptions,
): ResolvedNexusAgentMcpTarget[] {
  const configuredTargets =
    options.agentTargets ?? options.mcpConfig?.agentTargets ?? [{ agent: "codex" }];

  return configuredTargets
    .filter((target) => target.enabled !== false)
    .map((target) => {
      const serverName =
        target.serverName ??
        options.mcpConfig?.serverName ??
        defaultNexusMcpServerName;
      assertTomlBareKey(serverName, `mcp agent target ${target.agent}.serverName`);
      const command =
        target.command ?? options.mcpConfig?.command ?? defaultNexusMcpCommand;
      const args = [
        ...(target.args ?? options.mcpConfig?.args ?? defaultNexusMcpArgs),
      ];
      const defaultToolsApprovalMode =
        target.defaultToolsApprovalMode ??
        options.mcpConfig?.defaultToolsApprovalMode;
      const sourceControl =
        target.sourceControl ?? options.mcpConfig?.sourceControl ?? "support";
      const configFormat = configFormatForAgent(target.agent);
      const configPath = path.join(
        projectRoot,
        assertProjectRelativeFilePath(
          target.configPath ?? defaultConfigPathForAgent(target.agent),
          `mcp agent target ${target.agent}.configPath`,
        ),
      );

      return {
        agent: target.agent,
        serverName,
        command,
        args,
        ...(defaultToolsApprovalMode !== undefined
          ? { defaultToolsApprovalMode }
          : {}),
        sourceControl,
        configPath,
        configFormat,
      };
    });
}

function configFormatForAgent(agent: string): "toml" | "json" {
  if (agent === "codex") {
    return "toml";
  }
  if (agent === "claude") {
    return "json";
  }

  throw new NexusAgentMcpConfigError(
    `Agent MCP target is not supported: ${agent}`,
  );
}

function defaultConfigPathForAgent(agent: string): string {
  if (agent === "codex") {
    return path.join(".codex", "config.toml");
  }
  if (agent === "claude") {
    return ".mcp.json";
  }

  throw new NexusAgentMcpConfigError(
    `Agent MCP target is not supported: ${agent}`,
  );
}

function assertProjectRelativeFilePath(filePath: string, pathName: string): string {
  if (
    !filePath ||
    path.isAbsolute(filePath) ||
    filePath
      .split(/[\\/]/u)
      .some((part) => part === ".." || part === "." || part === "")
  ) {
    throw new NexusAgentMcpConfigError(
      `${pathName} must be a project-relative file path`,
    );
  }

  return filePath;
}

function assertTomlBareKey(value: string, pathName: string): void {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new NexusAgentMcpConfigError(
      `${pathName} must contain only letters, digits, underscores, and hyphens`,
    );
  }
}

function writeCodexMcpConfig(target: ResolvedNexusAgentMcpTarget): void {
  const existing = fs.existsSync(target.configPath)
    ? fs.readFileSync(target.configPath, "utf8")
    : "";
  const nextContent = upsertCodexMcpServerBlock(existing, {
    ...target,
    defaultToolsApprovalMode:
      target.defaultToolsApprovalMode ??
      codexMcpServerStringSetting(
        existing,
        target.serverName,
        "default_tools_approval_mode",
      ),
  });

  fs.mkdirSync(path.dirname(target.configPath), { recursive: true });
  fs.writeFileSync(target.configPath, nextContent, "utf8");
}

function upsertCodexMcpServerBlock(
  existing: string,
  target: Pick<
    ResolvedNexusAgentMcpTarget,
    "serverName" | "command" | "args" | "defaultToolsApprovalMode"
  >,
): string {
  const retainedLines = removeTomlServerTable(existing, target.serverName);
  const retained = trimTrailingBlankLines(retainedLines).join("\n");
  const serverBlockLines = [
    `[mcp_servers.${target.serverName}]`,
    `command = ${tomlString(target.command)}`,
    `args = ${tomlStringArray(target.args)}`,
  ];
  if (target.defaultToolsApprovalMode) {
    serverBlockLines.push(
      `default_tools_approval_mode = ${tomlString(target.defaultToolsApprovalMode)}`,
    );
  }
  const serverBlock = serverBlockLines.join("\n");

  return retained.length > 0
    ? `${retained}\n\n${serverBlock}\n`
    : `${serverBlock}\n`;
}

function codexMcpServerStringSetting(
  existing: string,
  serverName: string,
  settingName: string,
): string | undefined {
  const lines = existing.replace(/\r\n/gu, "\n").split("\n");
  let insideServer = false;
  const settingPattern = new RegExp(
    `^\\s*${escapeRegExp(settingName)}\\s*=\\s*(\"(?:[^\"\\\\]|\\\\.)*\")\\s*(?:#.*)?$`,
    "u",
  );

  for (const line of lines) {
    const tableName = tomlTableName(line);
    if (tableName) {
      insideServer = tableName === `mcp_servers.${serverName}`;
      continue;
    }

    if (!insideServer) {
      continue;
    }

    const match = line.match(settingPattern);
    if (match) {
      try {
        return JSON.parse(match[1]) as string;
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

function removeTomlServerTable(existing: string, serverName: string): string[] {
  const lines = existing.replace(/\r\n/gu, "\n").split("\n");
  const retained: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const tableName = tomlTableName(line);
    if (tableName) {
      skipping = isMcpServerTable(tableName, serverName);
      if (skipping) {
        continue;
      }
    }

    if (!skipping) {
      retained.push(line);
    }
  }

  return retained;
}

function tomlTableName(line: string): string | null {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
  return match?.[1]?.trim() ?? null;
}

function isMcpServerTable(tableName: string, serverName: string): boolean {
  return (
    tableName === `mcp_servers.${serverName}` ||
    tableName.startsWith(`mcp_servers.${serverName}.`)
  );
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed.at(-1)?.trim() === "") {
    trimmed.pop();
  }

  return trimmed;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function writeClaudeMcpConfig(target: ResolvedNexusAgentMcpTarget): void {
  const existing = readJsonObject(target.configPath);
  const existingServers = existing.mcpServers;
  if (
    existingServers !== undefined &&
    (!existingServers ||
      typeof existingServers !== "object" ||
      Array.isArray(existingServers))
  ) {
    throw new NexusAgentMcpConfigError(
      `Claude MCP config mcpServers must be an object: ${target.configPath}`,
    );
  }

  const mcpServers = {
    ...((existingServers as Record<string, unknown> | undefined) ?? {}),
    [target.serverName]: {
      command: target.command,
      args: target.args,
    },
  };

  fs.mkdirSync(path.dirname(target.configPath), { recursive: true });
  fs.writeFileSync(
    target.configPath,
    `${JSON.stringify({ ...existing, mcpServers }, null, 2)}\n`,
    "utf8",
  );
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new NexusAgentMcpConfigError(
      `MCP config must be a JSON object: ${filePath}`,
    );
  }

  return parsed as Record<string, unknown>;
}

function addGitExcludeEntries(
  projectRoot: string,
  entries: readonly string[],
): { gitExcludePath: string | null; gitExcludeEntries: string[] } {
  const gitInfoDir = path.join(projectRoot, ".git", "info");
  if (!fs.existsSync(gitInfoDir) || !fs.statSync(gitInfoDir).isDirectory()) {
    return {
      gitExcludePath: null,
      gitExcludeEntries: [],
    };
  }

  const excludePath = path.join(gitInfoDir, "exclude");
  const existing = fs.existsSync(excludePath)
    ? fs.readFileSync(excludePath, "utf8")
    : "";
  const existingLines = new Set(
    existing
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const appended: string[] = [];
  for (const entry of entries) {
    if (!existingLines.has(entry)) {
      appended.push(entry);
      existingLines.add(entry);
    }
  }

  if (appended.length > 0) {
    fs.mkdirSync(gitInfoDir, { recursive: true });
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(excludePath, `${prefix}${appended.join("\n")}\n`, "utf8");
  }

  return {
    gitExcludePath: excludePath,
    gitExcludeEntries: appended,
  };
}

function gitExcludeEntryForPath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, filePath).replace(/\\/gu, "/");
}
