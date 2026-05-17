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
      platform: "linux",
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

  it("resolves portable project paths in coordinator profile commands", () => {
    const resolved = resolveNexusAutomationAgentCommand({
      projectRoot: "/Users/me/dev-nexus/dogfood",
      platform: "macos",
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
                "--cd",
                "projectRoot:",
                "--add-dir",
                "sourcesRoot:dev-nexus",
                "--add-dir",
                "projectParent:sources/plexus",
                "Use DEV_NEXUS_AGENT_CONTEXT_FILE.",
              ],
            },
          ],
        },
      },
      commandName: "run-once",
    });

    expect(resolved.command).toBe(
      'codex exec --cd /Users/me/dev-nexus/dogfood --add-dir /Users/me/dev-nexus/sources/dev-nexus --add-dir /Users/me/dev-nexus/sources/plexus "Use DEV_NEXUS_AGENT_CONTEXT_FILE."',
    );
  });

  it("resolves bare Codex profile commands to the local Windows Desktop CLI", () => {
    const homePath = "C:\\Users\\example";
    const codexPath =
      "C:\\Users\\example\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe";
    const resolved = resolveNexusAutomationAgentCommand({
      projectRoot: "C:\\dev\\dogfood",
      platform: "windows",
      homePath,
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
              args: ["exec"],
            },
          ],
        },
      },
      commandName: "coordinator-loop",
    });

    expect(resolved.command).toBe(
      `"${codexPath.replace(/(["\\])/gu, "\\$1")}" exec`,
    );
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

  it("quotes resolved profile command paths that need shell grouping", () => {
    expect(
      shellCommandFromProfile({
        id: "codex-local",
        executor: "codex",
        model: "gpt-5.5",
        reasoning: "xhigh",
        command: "C:\\Program Files\\OpenAI\\Codex\\codex.exe",
        args: ["exec"],
      }),
    ).toBe('"C:\\\\Program Files\\\\OpenAI\\\\Codex\\\\codex.exe" exec');
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

  it("normalizes codex app-server policy as host-local profile policy", () => {
    const policy = normalizeNexusAutomationAgentPolicy({
      ...defaultNexusAutomationConfig,
      agent: {
        ...defaultNexusAutomationConfig.agent,
        profiles: [
          {
            id: "codex-app-server",
            executor: "codex",
            executorMode: "app_server",
            model: "gpt-5.5",
            reasoning: "high",
            intendedUse: "subagent",
            command: null,
            args: [],
            appServer: {
              mode: "connect",
              command: null,
              args: [],
              endpoint: "http://127.0.0.1:17655",
              ephemeralThreadDefault: false,
              localPolicy: {
                allowNonLoopbackEndpoint: false,
                hostLocalSafetyHints: ["connects_to_local_service"],
              },
            },
          },
        ],
      },
    });

    expect(policy.profiles[0]).toMatchObject({
      id: "codex-app-server",
      executor: "codex",
      executorMode: "app_server",
      appServer: {
        mode: "connect",
        endpoint: "http://127.0.0.1:17655",
        ephemeralThreadDefault: false,
        localPolicy: {
          allowNonLoopbackEndpoint: false,
          hostLocalSafetyHints: ["connects_to_local_service"],
        },
      },
    });
  });
});
