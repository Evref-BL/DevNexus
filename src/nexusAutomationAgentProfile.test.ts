import { describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
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
});
