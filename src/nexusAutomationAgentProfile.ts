import type {
  NexusAutomationAgentProfileConfig,
  NexusAutomationConfig,
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
