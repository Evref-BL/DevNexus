import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type {
  NexusProjectAgentMcpTarget,
  NexusProjectAgentMcpConfigFormat,
  NexusProjectMcpConfig,
} from "../project/nexusProjectConfig.js";
import {
  resolveNexusMcpExposure,
  type NexusMcpExposureSource,
  type NexusResolvedMcpExposureMode,
} from "../mcp/nexusMcpExposurePolicy.js";
import type { NexusSkillSourceControl } from "./nexusSkills.js";

export const defaultNexusMcpServerName = "dev_nexus";
export const defaultNexusMcpCommand = "dev-nexus";
export const defaultNexusMcpArgs = ["mcp-stdio"] as const;
export const defaultProjectedNexusMcpCommand = "node";

export interface MaterializeNexusProjectAgentMcpConfigOptions {
  projectRoot: string;
  mcpConfig?: NexusProjectMcpConfig;
  agentTargets?: NexusProjectAgentMcpTarget[];
  excludeFromGit?: boolean;
  platform?: NodeJS.Platform;
}

export type NexusAgentMcpConfigSchema = string;

export type NexusAgentMcpConfigStatus =
  | "materialized"
  | "gateway_pending"
  | "hidden"
  | "manual"
  | "unsupported";

export type NexusAgentMcpCapabilityGapSeverity = "warning" | "blocked";

export interface NexusAgentMcpCapabilityGap {
  id: string;
  severity: NexusAgentMcpCapabilityGapSeverity;
  summary: string;
  nextAction: string;
}

export interface NexusAgentMcpTrustSemantics {
  mode:
    | "provider_default"
    | "codex_default_tools_approval_mode"
    | "opencode_permission_config"
    | "manual";
  summary: string;
  settingPath: string | null;
}

export interface NexusAgentMcpCommandResolution {
  originalCommand: string;
  command: string;
  strategy: "unchanged" | "windows_cmd_shim";
  summary: string;
}

export interface MaterializedNexusAgentMcpTarget {
  agent: string;
  provider: string;
  serverName: string;
  command: string;
  args: string[];
  defaultToolsApprovalMode?: string;
  sourceControl: NexusSkillSourceControl;
  configPath: string;
  configPathRelative: string;
  configFormat: NexusProjectAgentMcpConfigFormat;
  configSchema: NexusAgentMcpConfigSchema;
  configStatus: NexusAgentMcpConfigStatus;
  activationNotes: string[];
  trustSemantics: NexusAgentMcpTrustSemantics;
  manualInstructions: string[];
  capabilityGaps: NexusAgentMcpCapabilityGap[];
  commandResolution: NexusAgentMcpCommandResolution;
  effectiveExposure: NexusResolvedMcpExposureMode;
  exposureSource: NexusMcpExposureSource;
  exposurePath: string | null;
  exposureReason: string;
}

export interface MaterializeNexusProjectAgentMcpConfigResult {
  agentTargets: MaterializedNexusAgentMcpTarget[];
  capabilityGaps: Array<NexusAgentMcpCapabilityGap & {
    agent: string;
    provider: string;
  }>;
  gitExcludePath: string | null;
  gitExcludeEntries: string[];
}

interface ResolvedNexusAgentMcpTarget extends MaterializedNexusAgentMcpTarget {}

interface NexusAgentMcpProviderAdapter {
  provider: string;
  configFormat: NexusProjectAgentMcpConfigFormat;
  configSchema: NexusAgentMcpConfigSchema;
  defaultConfigPath: string;
  activationNotes: string[];
  trustSemantics: (
    target: NexusProjectAgentMcpTarget,
  ) => NexusAgentMcpTrustSemantics;
  writer: ((target: ResolvedNexusAgentMcpTarget) => void) | null;
  remover: ((target: ResolvedNexusAgentMcpTarget) => void) | null;
}

export class NexusAgentMcpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAgentMcpConfigError";
  }
}

export function emptyNexusProjectAgentMcpConfigResult(): MaterializeNexusProjectAgentMcpConfigResult {
  return {
    agentTargets: [],
    capabilityGaps: [],
    gitExcludePath: null,
    gitExcludeEntries: [],
  };
}

export function currentNexusCliScriptPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "cli.js"),
    path.join(moduleDir, "..", "dist", "cli.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ??
    path.join(moduleDir, "cli.js");
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
    if (target.configStatus === "materialized") {
      writeNexusAgentMcpConfig(target);
    } else if (
      target.configStatus === "gateway_pending" ||
      target.configStatus === "hidden"
    ) {
      removeNexusAgentMcpConfig(target);
    }
  }

  const supportEntries = targets
    .filter(
      (target) =>
        target.sourceControl === "support" &&
        target.configStatus === "materialized",
    )
    .map((target) => gitExcludeEntryForPath(projectRoot, target.configPath));
  const gitExclude =
    options.excludeFromGit === false
      ? { gitExcludePath: null, gitExcludeEntries: [] }
      : addGitExcludeEntries(projectRoot, supportEntries);

  return {
    agentTargets: targets,
    capabilityGaps: targetCapabilityGaps(targets),
    gitExcludePath: gitExclude.gitExcludePath,
    gitExcludeEntries: gitExclude.gitExcludeEntries,
  };
}

export function resolveNexusProjectAgentMcpTargets(
  options: Omit<MaterializeNexusProjectAgentMcpConfigOptions, "excludeFromGit">,
): MaterializedNexusAgentMcpTarget[] {
  if (options.mcpConfig?.enabled === false) {
    return [];
  }

  return resolveAgentMcpTargets(path.resolve(options.projectRoot), options);
}

function resolveAgentMcpTargets(
  projectRoot: string,
  options: Omit<MaterializeNexusProjectAgentMcpConfigOptions, "excludeFromGit">,
): ResolvedNexusAgentMcpTarget[] {
  const configuredTargets =
    options.agentTargets ?? options.mcpConfig?.agentTargets ?? [{ agent: "codex" }];

  return configuredTargets
    .filter((target) => target.enabled !== false)
    .map((target) => {
      const exposure = resolveNexusMcpExposure({
        workspaceExposure: options.mcpConfig?.exposure,
        agentTarget: target,
      });
      const provider = normalizeAgentProvider(target);
      const adapter = providerAdapterForTarget(target, provider);
      const serverName =
        target.serverName ??
        options.mcpConfig?.serverName ??
        defaultNexusMcpServerName;
      const configuredCommand =
        target.command ?? options.mcpConfig?.command ?? defaultNexusMcpCommand;
      const configuredArgs = [
        ...(target.args ?? options.mcpConfig?.args ?? defaultNexusMcpArgs),
      ];
      const projectedCommandLine = projectNexusMcpCommandLine({
        command: configuredCommand,
        args: configuredArgs,
      });
      const command = projectedCommandLine.command;
      const args = projectedCommandLine.args;
      const defaultToolsApprovalMode =
        target.defaultToolsApprovalMode ??
        options.mcpConfig?.defaultToolsApprovalMode;
      const sourceControl =
        target.sourceControl ?? options.mcpConfig?.sourceControl ?? "support";
      const configFormat = target.configFormat ?? adapter.configFormat;
      const configSchema =
        (target.configSchema as NexusAgentMcpConfigSchema | undefined) ??
        adapter.configSchema;
      const configPathRelative = assertProjectRelativeFilePath(
        target.configPath ?? adapter.defaultConfigPath,
        `mcp agent target ${target.agent}.configPath`,
      );
      if (configSchema === "codex.mcp_servers") {
        assertTomlBareKey(serverName, `mcp agent target ${target.agent}.serverName`);
      }
      const configPath = path.join(projectRoot, configPathRelative);
      const configCapability = configCapabilityForTarget({
        target,
        provider,
        adapter,
        configFormat,
        configSchema,
      });
      const commandResolution = resolveMcpCommandForTarget({
        command,
        platform: options.platform ?? process.platform,
      });
      const configStatus = mcpConfigStatusForExposure(
        exposure.mode,
        configCapability.configStatus,
      );
      const capabilityGaps = [
        ...(exposure.mode === "direct" ? configCapability.capabilityGaps : []),
        ...(exposure.mode === "direct" ? commandResolution.capabilityGaps : []),
        ...mcpExposureCapabilityGaps(exposure),
      ];
      const activationNotes = [
        ...adapter.activationNotes,
        ...(target.activationNotes ?? []),
      ];
      const manualInstructions = exposure.mode === "direct"
        ? [
            ...manualInstructionsForTarget({
              target,
              provider,
              serverName,
              command: commandResolution.command,
              args,
              configPath: configPathRelative,
              configStatus,
            }),
            ...(target.manualInstructions ?? []),
          ]
        : exposure.mode === "gateway"
          ? [
              `Register MCP server ${serverName} through the DevNexus MCP gateway projection once gateway projection is available.`,
              ...(target.manualInstructions ?? []),
            ]
          : [...(target.manualInstructions ?? [])];

      return {
        agent: target.agent,
        provider,
        serverName,
        command: commandResolution.command,
        args,
        ...(defaultToolsApprovalMode !== undefined
          ? { defaultToolsApprovalMode }
          : {}),
        sourceControl,
        configPath,
        configPathRelative,
        configFormat,
        configSchema,
        configStatus,
        activationNotes,
        trustSemantics:
          target.trustSemantics !== undefined
            ? {
                mode: "manual",
                summary: target.trustSemantics,
                settingPath: null,
              }
            : adapter.trustSemantics({
                ...target,
                ...(defaultToolsApprovalMode !== undefined
                  ? { defaultToolsApprovalMode }
                  : {}),
              }),
        manualInstructions,
        capabilityGaps,
        commandResolution: {
          originalCommand: commandResolution.originalCommand,
          command: commandResolution.command,
          strategy: commandResolution.strategy,
          summary: commandResolution.summary,
        },
        effectiveExposure: exposure.mode,
        exposureSource: exposure.source,
        exposurePath: exposure.path,
        exposureReason: exposure.reason,
      };
    });
}

function projectNexusMcpCommandLine(commandLine: {
  command: string;
  args: readonly string[];
}): { command: string; args: string[] } {
  if (!isLegacyDefaultNexusMcpCommandLine(commandLine)) {
    return {
      command: commandLine.command,
      args: [...commandLine.args],
    };
  }

  return {
    command: defaultProjectedNexusMcpCommand,
    args: [currentNexusCliScriptPath(), ...defaultNexusMcpArgs],
  };
}

function isLegacyDefaultNexusMcpCommandLine(commandLine: {
  command: string;
  args: readonly string[];
}): boolean {
  return (
    (commandLine.command === defaultNexusMcpCommand ||
      commandLine.command === `${defaultNexusMcpCommand}.cmd`) &&
    commandLine.args.length === defaultNexusMcpArgs.length &&
    defaultNexusMcpArgs.every((arg, index) => commandLine.args[index] === arg)
  );
}

const providerAdapters: Record<string, NexusAgentMcpProviderAdapter> = {
  codex: {
    provider: "codex",
    configFormat: "toml",
    configSchema: "codex.mcp_servers",
    defaultConfigPath: path.join(".codex", "config.toml"),
    activationNotes: [
      "Open or restart the Codex workspace/session rooted at the DevNexus workspace root after refreshing MCP config.",
    ],
    trustSemantics: (target) => ({
      mode: "codex_default_tools_approval_mode",
      summary: target.defaultToolsApprovalMode
        ? `Codex default MCP tool approval mode is projected as ${target.defaultToolsApprovalMode}.`
        : "Codex MCP tool approval follows the provider default unless defaultToolsApprovalMode is configured.",
      settingPath: "mcp_servers.<server>.default_tools_approval_mode",
    }),
    writer: writeCodexMcpConfig,
    remover: removeCodexMcpConfig,
  },
  claude: {
    provider: "claude",
    configFormat: "json",
    configSchema: "claude.mcpServers",
    defaultConfigPath: ".mcp.json",
    activationNotes: [
      "Open or restart the Claude workspace/session rooted at the DevNexus workspace root after refreshing MCP config.",
    ],
    trustSemantics: () => ({
      mode: "provider_default",
      summary:
        "DevNexus workspaces the MCP server only; Claude tool approval and trust prompts remain provider-managed.",
      settingPath: null,
    }),
    writer: writeClaudeMcpConfig,
    remover: removeClaudeMcpConfig,
  },
  opencode: {
    provider: "opencode",
    configFormat: "json",
    configSchema: "opencode.mcp.local",
    defaultConfigPath: "opencode.json",
    activationNotes: [
      "Start OpenCode from the DevNexus workspace root so it loads the project opencode.json.",
    ],
    trustSemantics: () => ({
      mode: "opencode_permission_config",
      summary:
        "OpenCode manages tool trust through its permission config; DevNexus leaves permission policy unchanged.",
      settingPath: "permission",
    }),
    writer: writeOpenCodeMcpConfig,
    remover: removeOpenCodeMcpConfig,
  },
};

function normalizeAgentProvider(target: NexusProjectAgentMcpTarget): string {
  return (target.provider ?? target.agent).trim().toLowerCase();
}

function providerAdapterForTarget(
  target: NexusProjectAgentMcpTarget,
  provider: string,
): NexusAgentMcpProviderAdapter {
  const adapter = providerAdapters[provider];
  if (adapter) {
    return adapter;
  }

  return {
    provider,
    configFormat: target.configFormat ?? "manual",
    configSchema: target.configSchema ?? "manual",
    defaultConfigPath:
      target.configPath ?? path.join(`.${safeAgentConfigDirectoryName(target.agent)}`, "mcp.md"),
    activationNotes: [
      "Open or restart the configured agent provider workspace/session rooted at the DevNexus workspace root after applying MCP config.",
    ],
    trustSemantics: () => ({
      mode: "manual",
      summary:
        "DevNexus has no provider adapter for this target; tool trust and approval semantics must be configured manually for the provider.",
      settingPath: null,
    }),
    writer: null,
    remover: null,
  };
}

function configCapabilityForTarget(options: {
  target: NexusProjectAgentMcpTarget;
  provider: string;
  adapter: NexusAgentMcpProviderAdapter;
  configFormat: NexusProjectAgentMcpConfigFormat;
  configSchema: NexusAgentMcpConfigSchema;
}): {
  configStatus: NexusAgentMcpConfigStatus;
  capabilityGaps: NexusAgentMcpCapabilityGap[];
} {
  const expectedFormat = options.adapter.configFormat;
  const expectedSchema = options.adapter.configSchema;
  const explicitFormat = options.target.configFormat !== undefined;
  const explicitSchema = options.target.configSchema !== undefined;

  if (!options.adapter.writer) {
    if (options.configFormat === "manual" || !explicitFormat) {
      return {
        configStatus: "manual",
        capabilityGaps: [
          {
            id: "manual-provider-config-required",
            severity: "warning",
            summary:
              `Agent provider ${options.provider} is not supported by a DevNexus MCP writer; manual MCP config is required.`,
            nextAction:
              "Use the reported command, args, server name, config path, activation notes, and trust semantics to configure the provider manually.",
          },
        ],
      };
    }

    return {
      configStatus: "unsupported",
      capabilityGaps: [
        {
          id: "unsupported-provider-config",
          severity: "blocked",
          summary:
            `Agent provider ${options.provider} does not have a DevNexus writer for ${options.configFormat}/${options.configSchema}.`,
          nextAction:
            "Change the target to configFormat manual or add a DevNexus MCP config adapter for this provider schema.",
        },
      ],
    };
  }

  if (
    (explicitFormat && options.configFormat !== expectedFormat) ||
    (explicitSchema && options.configSchema !== expectedSchema)
  ) {
    return {
      configStatus: "unsupported",
      capabilityGaps: [
        {
          id: "unsupported-provider-config",
          severity: "blocked",
          summary:
            `Agent provider ${options.provider} supports ${expectedFormat}/${expectedSchema}, not ${options.configFormat}/${options.configSchema}.`,
          nextAction:
            "Remove the configFormat/configSchema override or add a provider adapter for the requested config shape.",
        },
      ],
    };
  }

  return {
    configStatus: "materialized",
    capabilityGaps: [],
  };
}

function manualInstructionsForTarget(options: {
  target: NexusProjectAgentMcpTarget;
  provider: string;
  serverName: string;
  command: string;
  args: string[];
  configPath: string;
  configStatus: NexusAgentMcpConfigStatus;
}): string[] {
  if (options.configStatus === "materialized") {
    return [];
  }

  return [
    `Add MCP server ${options.serverName} to ${options.configPath} for provider ${options.provider}.`,
    `Use command ${JSON.stringify(options.command)} with args ${JSON.stringify(options.args)}.`,
    "Do not place credentials, tokens, private keys, or provider app database state in the generated workspace config.",
  ];
}

function resolveMcpCommandForTarget(options: {
  command: string;
  platform: NodeJS.Platform;
}): NexusAgentMcpCommandResolution & {
  capabilityGaps: NexusAgentMcpCapabilityGap[];
} {
  if (options.platform !== "win32") {
    return {
      originalCommand: options.command,
      command: options.command,
      strategy: "unchanged",
      summary: "Command left unchanged for this platform.",
      capabilityGaps: [],
    };
  }

  if (isPowerShellScriptPath(options.command)) {
    return {
      originalCommand: options.command,
      command: options.command,
      strategy: "unchanged",
      summary:
        "Command left unchanged because it already names a PowerShell script.",
      capabilityGaps: [
        {
          id: "windows-powershell-shim-command",
          severity: "warning",
          summary:
            `Windows MCP target command ${options.command} names a PowerShell script, which some agent providers cannot execute as an MCP child process.`,
          nextAction:
            "Use the corresponding .cmd npm shim or an executable node command for this provider target.",
        },
      ],
    };
  }

  if (!commandNeedsWindowsCmdShim(options.command)) {
    return {
      originalCommand: options.command,
      command: options.command,
      strategy: "unchanged",
      summary: "Windows command already has an executable suffix or path form.",
      capabilityGaps: [],
    };
  }

  return {
    originalCommand: options.command,
    command: `${options.command}.cmd`,
    strategy: "windows_cmd_shim",
    summary:
      `Windows MCP target command ${options.command} was written as ${options.command}.cmd so providers do not resolve the PowerShell shim first.`,
    capabilityGaps: [],
  };
}

function targetCapabilityGaps(
  targets: readonly ResolvedNexusAgentMcpTarget[],
): Array<NexusAgentMcpCapabilityGap & { agent: string; provider: string }> {
  return targets.flatMap((target) =>
    target.capabilityGaps.map((gap) => ({
      ...gap,
      agent: target.agent,
      provider: target.provider,
    })),
  );
}

function writeNexusAgentMcpConfig(target: ResolvedNexusAgentMcpTarget): void {
  const adapter = providerAdapters[target.provider];
  if (!adapter?.writer) {
    throw new NexusAgentMcpConfigError(
      `Agent MCP target cannot be materialized without a provider writer: ${target.provider}`,
    );
  }

  adapter.writer(target);
}

function removeNexusAgentMcpConfig(target: ResolvedNexusAgentMcpTarget): void {
  const adapter = providerAdapters[target.provider];
  adapter?.remover?.(target);
}

function mcpConfigStatusForExposure(
  exposure: NexusResolvedMcpExposureMode,
  configStatus: NexusAgentMcpConfigStatus,
): NexusAgentMcpConfigStatus {
  if (exposure === "hidden") {
    return "hidden";
  }
  if (exposure === "gateway") {
    return "gateway_pending";
  }
  return configStatus;
}

function mcpExposureCapabilityGaps(
  exposure: ReturnType<typeof resolveNexusMcpExposure>,
): NexusAgentMcpCapabilityGap[] {
  if (exposure.mode !== "gateway") {
    return [];
  }

  return [
    {
      id: "mcp-gateway-projection-pending",
      severity: "warning",
      summary:
        "MCP exposure resolves to gateway, but DevNexus gateway projection is not available yet.",
      nextAction:
        "Keep this server out of direct projection until the DevNexus MCP gateway server can be materialized.",
    },
  ];
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

function safeAgentConfigDirectoryName(agent: string): string {
  const safe = agent.replace(/[^A-Za-z0-9_-]/gu, "-").replace(/-+/gu, "-");
  return safe.length > 0 ? safe : "agent";
}

function assertTomlBareKey(value: string, pathName: string): void {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new NexusAgentMcpConfigError(
      `${pathName} must contain only letters, digits, underscores, and hyphens`,
    );
  }
}

function commandNeedsWindowsCmdShim(command: string): boolean {
  return (
    command === defaultNexusMcpCommand &&
    !command.includes("/") &&
    !command.includes("\\") &&
    path.extname(command) === ""
  );
}

function isPowerShellScriptPath(command: string): boolean {
  return path.extname(command).toLowerCase() === ".ps1";
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

function removeCodexMcpConfig(target: ResolvedNexusAgentMcpTarget): void {
  if (!fs.existsSync(target.configPath)) {
    return;
  }

  const existing = fs.readFileSync(target.configPath, "utf8");
  const retained = trimTrailingBlankLines(
    removeTomlServerTable(existing, target.serverName),
  ).join("\n");
  fs.writeFileSync(
    target.configPath,
    retained.length > 0 ? `${retained}\n` : "",
    "utf8",
  );
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

function removeClaudeMcpConfig(target: ResolvedNexusAgentMcpTarget): void {
  if (!fs.existsSync(target.configPath)) {
    return;
  }

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
  };
  delete mcpServers[target.serverName];

  fs.writeFileSync(
    target.configPath,
    `${JSON.stringify({ ...existing, mcpServers }, null, 2)}\n`,
    "utf8",
  );
}

function writeOpenCodeMcpConfig(target: ResolvedNexusAgentMcpTarget): void {
  const existing = readJsonObject(target.configPath);
  const existingMcp = existing.mcp;
  if (
    existingMcp !== undefined &&
    (!existingMcp || typeof existingMcp !== "object" || Array.isArray(existingMcp))
  ) {
    throw new NexusAgentMcpConfigError(
      `OpenCode MCP config mcp must be an object: ${target.configPath}`,
    );
  }

  const mcp = {
    ...((existingMcp as Record<string, unknown> | undefined) ?? {}),
    [target.serverName]: {
      type: "local",
      command: [target.command, ...target.args],
      enabled: true,
    },
  };
  const next = {
    $schema: "https://opencode.ai/config.json",
    ...existing,
    mcp,
  };

  fs.mkdirSync(path.dirname(target.configPath), { recursive: true });
  fs.writeFileSync(
    target.configPath,
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
}

function removeOpenCodeMcpConfig(target: ResolvedNexusAgentMcpTarget): void {
  if (!fs.existsSync(target.configPath)) {
    return;
  }

  const existing = readJsonObject(target.configPath);
  const existingMcp = existing.mcp;
  if (
    existingMcp !== undefined &&
    (!existingMcp || typeof existingMcp !== "object" || Array.isArray(existingMcp))
  ) {
    throw new NexusAgentMcpConfigError(
      `OpenCode MCP config mcp must be an object: ${target.configPath}`,
    );
  }

  const mcp = {
    ...((existingMcp as Record<string, unknown> | undefined) ?? {}),
  };
  delete mcp[target.serverName];
  const next = {
    $schema: "https://opencode.ai/config.json",
    ...existing,
    mcp,
  };

  fs.writeFileSync(
    target.configPath,
    `${JSON.stringify(next, null, 2)}\n`,
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
