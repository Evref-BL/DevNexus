import type {
  NexusAutomationAgentProfileIntendedUse,
  NexusAutomationAgentProfileConfig,
  NexusAutomationConfig,
  NexusAutomationSafetyConfig,
} from "./nexusAutomationConfig.js";

export type NexusAutomationAgentCommandSource =
  | "override"
  | "agent_command"
  | "coordinator_profile";

export interface ResolvedNexusAutomationAgentCommand {
  command: string;
  source: NexusAutomationAgentCommandSource;
  profile: NexusAutomationAgentProfileConfig | null;
}

export interface NexusAutomationAgentProfilePolicy {
  id: string;
  executor: string;
  model: string | null;
  version: string | null;
  variant: string | null;
  reasoning: string | null;
  intelligence: string | null;
  intendedUse: NexusAutomationAgentProfileIntendedUse;
  safety: NexusAutomationSafetyConfig;
  command: string | null;
  args: string[];
}

export interface NexusAutomationAgentPolicy {
  coordinatorProfileId: string | null;
  maxConcurrentSubagents: number;
  safety: NexusAutomationSafetyConfig;
  coordinatorProfile: NexusAutomationAgentProfilePolicy | null;
  profiles: NexusAutomationAgentProfilePolicy[];
}

export interface ResolveNexusAutomationAgentCommandOptions {
  automationConfig: NexusAutomationConfig;
  overrideCommand?: string;
  commandName?: "run-once" | "schedule";
}

export class NexusAutomationAgentProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationAgentProfileError";
  }
}

export function resolveNexusAutomationAgentCommand(
  options: ResolveNexusAutomationAgentCommandOptions,
): ResolvedNexusAutomationAgentCommand {
  const overrideCommand = optionalNonEmptyString(options.overrideCommand);
  if (overrideCommand) {
    return {
      command: overrideCommand,
      source: "override",
      profile: null,
    };
  }

  const configuredCommand = optionalNonEmptyString(
    options.automationConfig.agent.command,
  );
  if (configuredCommand) {
    return {
      command: configuredCommand,
      source: "agent_command",
      profile: null,
    };
  }

  const coordinatorProfileId =
    options.automationConfig.agent.coordinatorProfileId;
  if (!coordinatorProfileId) {
    throw new NexusAutomationAgentProfileError(
      `automation ${options.commandName ?? "run"} requires --command, project config automation.agent.command, or automation.agent.coordinatorProfileId with a command-capable profile`,
    );
  }

  const profile = options.automationConfig.agent.profiles.find(
    (item) => item.id === coordinatorProfileId,
  );
  if (!profile) {
    throw new NexusAutomationAgentProfileError(
      `automation.agent.coordinatorProfileId references missing profile: ${coordinatorProfileId}`,
    );
  }
  if (!profile.command) {
    throw new NexusAutomationAgentProfileError(
      `automation.agent.profiles.${coordinatorProfileId}.command must be configured for coordinator launch`,
    );
  }

  return {
    command: shellCommandFromProfile(profile),
    source: "coordinator_profile",
    profile,
  };
}

export function normalizeNexusAutomationAgentPolicy(
  automationConfig: NexusAutomationConfig,
): NexusAutomationAgentPolicy {
  const profiles = automationConfig.agent.profiles.map((profile) =>
    normalizeNexusAutomationAgentProfilePolicy(
      profile,
      automationConfig.safety,
    ),
  );
  const coordinatorProfile =
    profiles.find(
      (profile) => profile.id === automationConfig.agent.coordinatorProfileId,
    ) ?? null;

  return {
    coordinatorProfileId: automationConfig.agent.coordinatorProfileId,
    maxConcurrentSubagents: automationConfig.agent.maxConcurrentSubagents,
    safety: automationConfig.safety,
    coordinatorProfile,
    profiles,
  };
}

function normalizeNexusAutomationAgentProfilePolicy(
  profile: NexusAutomationAgentProfileConfig,
  fallbackSafety: NexusAutomationSafetyConfig,
): NexusAutomationAgentProfilePolicy {
  return {
    id: requiredNonEmptyString(profile.id, "profile.id"),
    executor: requiredNonEmptyString(profile.executor, "profile.executor"),
    model: optionalNullableString(profile.model, "profile.model") ?? null,
    version: optionalNullableString(profile.version, "profile.version") ?? null,
    variant: optionalNullableString(profile.variant, "profile.variant") ?? null,
    reasoning: optionalNullableString(profile.reasoning, "profile.reasoning") ??
      null,
    intelligence:
      optionalNullableString(profile.intelligence, "profile.intelligence") ??
      null,
    intendedUse: profile.intendedUse ?? "any",
    safety: profile.safety ?? fallbackSafety,
    command: optionalNullableString(profile.command, "profile.command") ?? null,
    args: profile.args.map((arg) =>
      requiredNonEmptyString(arg, "profile.args[]"),
    ),
  };
}

export function shellCommandFromProfile(
  profile: NexusAutomationAgentProfileConfig,
): string {
  const command = requiredNonEmptyString(profile.command, "profile.command");
  return [command, ...profile.args.map(shellQuoteArgument)].join(" ");
}

export function shellQuoteArgument(value: string): string {
  const arg = requiredNonEmptyString(value, "profile.args[]");
  if (/[\r\n]/u.test(arg)) {
    throw new NexusAutomationAgentProfileError(
      "profile args must not contain line breaks",
    );
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/(["\\])/gu, "\\$1")}"`;
}

function optionalNonEmptyString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requiredNonEmptyString(value, "value");
}

function optionalNullableString(
  value: string | null | undefined,
  name: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return requiredNonEmptyString(value, name);
}

function requiredNonEmptyString(
  value: string | null | undefined,
  name: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusAutomationAgentProfileError(
      `${name} must be a non-empty string`,
    );
  }

  return value.trim();
}
