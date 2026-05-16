import { describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  normalizeNexusAutomationAgentPolicy,
  resolveNexusAutomationAgentCommand,
  shellCommandFromProfile,
} from "./index.js";

describe("nexus automation agent profile command resolution", () => {
  it("prefers the explicit command override", () => {
    const resolved = resolveNexusAutomationAgentCommand({
      automationConfig: {
        ...defaultNexusAutomationConfig,
        agent: {
          ...defaultNexusAutomationConfig.agent,
          command: "codex configured",
          coordinatorProfileId: "codex-deep",
          profiles: [
            {
              id: "codex-deep",
              executor: "codex",
              model: "gpt-5.5",
              reasoning: "xhigh",
              command: "codex",
              args: ["exec"],
            },
          ],
        },
      },
      overrideCommand: "codex override",
      commandName: "run-once",
    });

    expect(resolved).toMatchObject({
      command: "codex override",
      source: "override",
      profile: null,
    });
  });

  it("uses the raw agent command before a coordinator profile", () => {
    const resolved = resolveNexusAutomationAgentCommand({
      automationConfig: {
        ...defaultNexusAutomationConfig,
        agent: {
          ...defaultNexusAutomationConfig.agent,
          command: "codex configured",
          coordinatorProfileId: "codex-deep",
          profiles: [
            {
              id: "codex-deep",
              executor: "codex",
              model: "gpt-5.5",
              reasoning: "xhigh",
              command: "codex",
              args: ["exec"],
            },
          ],
        },
      },
    });

    expect(resolved).toMatchObject({
      command: "codex configured",
      source: "agent_command",
      profile: null,
    });
  });

  it("builds a command from the configured coordinator profile", () => {
    const resolved = resolveNexusAutomationAgentCommand({
      automationConfig: {
        ...defaultNexusAutomationConfig,
        agent: {
          ...defaultNexusAutomationConfig.agent,
          coordinatorProfileId: "codex-deep",
          profiles: [
            {
              id: "codex-deep",
              executor: "codex",
              model: "gpt-5.5",
              reasoning: "xhigh",
              command: "codex",
              args: [
                "exec",
                "--model",
                "gpt-5.5",
                "--reasoning-effort",
                "xhigh",
                "Use DEV_NEXUS_AGENT_CONTEXT_FILE.",
              ],
            },
          ],
        },
      },
      commandName: "schedule",
    });

    expect(resolved).toMatchObject({
      command:
        'codex exec --model gpt-5.5 --reasoning-effort xhigh "Use DEV_NEXUS_AGENT_CONTEXT_FILE."',
      source: "coordinator_profile",
      profile: {
        id: "codex-deep",
      },
    });
  });

  it("quotes profile arguments that need shell grouping", () => {
    expect(
      shellCommandFromProfile({
        id: "claude",
        executor: "claude",
        model: null,
        reasoning: null,
        command: "claude",
        args: ["--model", "Claude Sonnet", "say \"hi\""],
      }),
    ).toBe('claude --model "Claude Sonnet" "say \\"hi\\""');
  });

  it("blocks unresolved coordinator profile commands", () => {
    expect(() =>
      resolveNexusAutomationAgentCommand({
        automationConfig: defaultNexusAutomationConfig,
        commandName: "run-once",
      }),
    ).toThrow(/requires --command/);

    expect(() =>
      resolveNexusAutomationAgentCommand({
        automationConfig: {
          ...defaultNexusAutomationConfig,
          agent: {
            ...defaultNexusAutomationConfig.agent,
            coordinatorProfileId: "codex-deep",
            profiles: [
              {
                id: "codex-deep",
                executor: "codex",
                model: "gpt-5.5",
                reasoning: "xhigh",
                command: null,
                args: [],
              },
            ],
          },
        },
      }),
    ).toThrow(/command must be configured/);
  });

  it("normalizes profile policy for coordinator and subagent selection", () => {
    const policy = normalizeNexusAutomationAgentPolicy({
      ...defaultNexusAutomationConfig,
      safety: {
        profile: "host-authorized",
        allowHostMutation: true,
        allowDependencyInstall: false,
        allowLiveServices: true,
      },
      agent: {
        ...defaultNexusAutomationConfig.agent,
        coordinatorProfileId: "codex-coordinator",
        maxConcurrentSubagents: 2,
        profiles: [
          {
            id: "codex-coordinator",
            executor: "codex",
            model: "gpt-5.5",
            version: "2026-05",
            variant: "pro",
            reasoning: "xhigh",
            intelligence: "deep",
            intendedUse: "coordinator",
            safety: {
              profile: "isolated",
              allowHostMutation: false,
              allowDependencyInstall: false,
              allowLiveServices: false,
            },
            command: "codex",
            args: ["exec"],
          },
          {
            id: "claude-subagent",
            executor: "claude",
            model: "claude-sonnet",
            reasoning: null,
            intendedUse: "subagent",
            command: null,
            args: [],
          },
        ],
      },
    });

    expect(policy).toEqual({
      coordinatorProfileId: "codex-coordinator",
      maxConcurrentSubagents: 2,
      safety: {
        profile: "host-authorized",
        allowHostMutation: true,
        allowDependencyInstall: false,
        allowLiveServices: true,
      },
      coordinatorProfile: {
        id: "codex-coordinator",
        executor: "codex",
        model: "gpt-5.5",
        version: "2026-05",
        variant: "pro",
        reasoning: "xhigh",
        intelligence: "deep",
        intendedUse: "coordinator",
        safety: {
          profile: "isolated",
          allowHostMutation: false,
          allowDependencyInstall: false,
          allowLiveServices: false,
        },
        command: "codex",
        args: ["exec"],
      },
      profiles: [
        {
          id: "codex-coordinator",
          executor: "codex",
          model: "gpt-5.5",
          version: "2026-05",
          variant: "pro",
          reasoning: "xhigh",
          intelligence: "deep",
          intendedUse: "coordinator",
          safety: {
            profile: "isolated",
            allowHostMutation: false,
            allowDependencyInstall: false,
            allowLiveServices: false,
          },
          command: "codex",
          args: ["exec"],
        },
        {
          id: "claude-subagent",
          executor: "claude",
          model: "claude-sonnet",
          version: null,
          variant: null,
          reasoning: null,
          intelligence: null,
          intendedUse: "subagent",
          safety: {
            profile: "host-authorized",
            allowHostMutation: true,
            allowDependencyInstall: false,
            allowLiveServices: true,
          },
          command: null,
          args: [],
        },
      ],
    });
  });
});
