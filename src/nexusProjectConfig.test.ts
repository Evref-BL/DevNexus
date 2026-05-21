import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeNexusProjectMcpAgentTargets,
  activeNexusProjectSkillAgentTargets,
  devNexusProjectConfigFileName,
  loadProjectConfig,
  NexusConfigError,
  projectConfigPath,
  projectWorktreesRootPath,
  normalizeComponentWorkTrackers,
  normalizeNexusProjectAgentTargets,
  resolveNexusAgentConfig,
  saveProjectConfig,
  selectNexusProjectMcpAgentTargets,
  validateProjectConfig,
} from "./nexusProjectConfig.js";
import {
  normalizeNexusAuthorityPolicy,
  recommendedNexusAuthorityRoleIds,
  resolveNexusAuthorityForActor,
} from "./nexusAuthority.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("workspace config", () => {
  it("validates and persists workspace config files", () => {
    const projectRoot = path.join(makeTempDir("dev-nexus-project-"), "project");
    const config = {
      version: 1 as const,
      id: "my-project",
      name: "My Project",
      home: "C:\\dev\\code\\.dev-nexus",
      repo: {
        kind: "git" as const,
        remoteUrl: "https://github.com/example/my-project.git",
        defaultBranch: "main",
        sourceRoot: "source",
      },
      components: [
        {
          id: "core",
          name: "Core",
          kind: "git" as const,
          role: "primary" as const,
          remoteUrl: "https://github.com/example/my-project.git",
          defaultBranch: "main",
          sourceRoot: "source",
          worktreesRoot: "worktrees/core",
          workTracking: {
            provider: "github" as const,
            repository: {
              owner: "example",
              name: "my-project",
            },
          },
          verification: {
            focusedCommands: ["npm test"],
            requirePassing: true,
          },
          publication: {
            strategy: "review_handoff" as const,
            remote: "origin",
            targetBranch: "main",
          },
          relationships: [],
        },
        {
          id: "addon",
          name: "Addon",
          kind: "local" as const,
          role: "addon" as const,
          remoteUrl: null,
          defaultBranch: null,
          sourceRoot: "components/addon",
          relationships: [
            {
              kind: "extends" as const,
              componentId: "core",
            },
          ],
        },
      ],
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban" as const,
        projectId: "vk-project-1",
      },
      workTracking: {
        provider: "github" as const,
        repository: {
          owner: "example",
          name: "my-project",
        },
      },
      extensions: {
        "example-module": {
          enabled: true,
        },
      },
      agent: {
        executor: "CODEX",
        model: "gpt-5.4",
        reasoning: "high",
      },
      mcp: {
        sourceControl: "support" as const,
        serverName: "dev_nexus",
        command: "dev-nexus",
        args: ["mcp-stdio"],
        defaultToolsApprovalMode: "approve",
        agentTargets: [
          {
            agent: "codex",
            configPath: ".codex/config.toml",
          },
          {
            agent: "claude",
            provider: "claude",
            configPath: ".mcp.json",
            configFormat: "json",
            configSchema: "claude.mcpServers",
            sourceControl: "source" as const,
            defaultToolsApprovalMode: "approve",
            activationNotes: ["Open a fresh Claude workspace session."],
            trustSemantics: "Claude provider-managed approval prompts.",
            manualInstructions: ["Confirm the server is visible in Claude."],
          },
        ],
      },
      skills: {
        materialization: "copy" as const,
        sourceControl: "support" as const,
        agentTargets: [
          {
            agent: "codex",
          },
          {
            agent: "claude",
            directory: ".claude/skills",
            sourceControl: "source" as const,
          },
        ],
        items: [
          {
            id: "diagnose",
            enabled: true,
          },
          {
            id: "experimental-review",
            enabled: false,
            version: "0.2.0",
            materialization: "reference" as const,
          },
        ],
      },
      hosts: [
        {
          id: "mac-builder",
          displayName: "Mac Builder",
          platformTags: ["macos"],
          capabilityTags: ["dev-nexus", "node", "pharo-launcher"],
          enabled: true,
          notes: "Shared logical host declaration only.",
        },
        {
          id: "windows-builder",
          displayName: "Windows Builder",
          platformTags: ["windows"],
          capabilityTags: ["dev-nexus", "powershell"],
          enabled: false,
        },
      ],
      authority: {
        actors: [
          {
            id: "example-bot-actor",
            kind: "machine_user" as const,
            provider: "github",
            providerIdentity: "Example-Bot",
            displayName: "Example Bot",
            handles: {
              github: "Example-Bot",
            },
          },
        ],
        roles: [
          {
            id: "docs_operator",
            name: "Docs Operator",
            actions: ["project.read", "work_item.comment"],
          },
        ],
        roleBindings: [
          {
            actorId: "example-bot-actor",
            roles: ["maintainer", "docs_operator"],
            scope: {
              project: "my-project",
              component: "core",
              provider: "github",
              tracker: "default",
              repository: "example/my-project",
              targetBranch: "main",
              environment: "dogfood",
            },
          },
        ],
      },
    };

    expect(validateProjectConfig(config)).toEqual(config);
    expect(saveProjectConfig(projectRoot, config)).toBe(
      path.join(projectRoot, devNexusProjectConfigFileName),
    );
    expect(loadProjectConfig(projectRoot)).toEqual(config);
    expect(projectConfigPath(projectRoot)).toBe(
      path.join(projectRoot, devNexusProjectConfigFileName),
    );
  });

  it("defaults legacy workspace configs to the current explicit JSON shape", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "legacy-project",
      name: "Legacy Project",
      kanban: {
        provider: "vibe-kanban",
      },
    });

    expect(config).toEqual({
      version: 1,
      id: "legacy-project",
      name: "Legacy Project",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      components: [
        {
          id: "primary",
          name: "Legacy Project",
          kind: "local",
          role: "primary",
          remoteUrl: null,
          defaultBranch: null,
          sourceRoot: ".",
          relationships: [],
        },
      ],
      worktreesRoot: "worktrees",
      hosts: [],
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });
    expect(normalizeNexusAuthorityPolicy(config.authority)).toMatchObject({
      unknownActorFallbackRole: "observer",
    });
  });

  it("normalizes recommended authority roles and actor bindings", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "authority-project",
      name: "Authority Project",
      authority: {
        actors: [
          {
            id: "example-bot-actor",
            kind: "machine_user",
            provider: "github",
            providerIdentity: "Example-Bot",
            displayName: "Example Bot",
            handles: {
              github: "Example-Bot",
              git: "example-bot@example.invalid",
            },
          },
        ],
        roleBindings: [
          {
            actorId: "example-bot-actor",
            roles: ["maintainer", "release_operator"],
            scope: {
              project: "authority-project",
              component: "dev-nexus",
              provider: "github",
              tracker: "default",
              repository: "Evref-BL/DevNexus",
              targetBranch: "main",
              environment: "dogfood",
            },
          },
        ],
      },
    });

    const policy = normalizeNexusAuthorityPolicy(config.authority);

    expect(recommendedNexusAuthorityRoleIds).toEqual([
      "maintainer",
      "contributor",
      "reviewer",
      "observer",
      "runtime_operator",
      "release_operator",
    ]);
    expect(policy.roles.map((role) => role.id)).toEqual(
      expect.arrayContaining(recommendedNexusAuthorityRoleIds),
    );
    expect(policy.roleBindings[0]).toMatchObject({
      actorId: "example-bot-actor",
      roles: ["maintainer", "release_operator"],
      scope: {
        project: "authority-project",
        component: "dev-nexus",
        provider: "github",
        tracker: "default",
        repository: "Evref-BL/DevNexus",
        targetBranch: "main",
        environment: "dogfood",
      },
    });

    const exampleBotAuthority = resolveNexusAuthorityForActor(
      config.authority,
      "example-bot-actor",
    );
    expect(exampleBotAuthority).toMatchObject({
      actorId: "example-bot-actor",
      knownActor: true,
      roles: ["maintainer", "release_operator"],
    });
    expect(exampleBotAuthority.actions).toEqual(
      expect.arrayContaining([
        "git.push_target_branch",
        "provider.pull_request.merge",
        "release.publish",
      ]),
    );

    expect(resolveNexusAuthorityForActor(config.authority, "unknown")).toMatchObject({
      actorId: "unknown",
      knownActor: false,
      roles: ["observer"],
      actions: expect.arrayContaining(["project.read"]),
    });
  });

  it("supports project-configured unknown actor authority fallback", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "authority-project",
      name: "Authority Project",
      authority: {
        unknownActorFallbackRole: "contributor",
      },
    });

    const authority = resolveNexusAuthorityForActor(config.authority, "unlisted");
    expect(authority).toMatchObject({
      actorId: "unlisted",
      knownActor: false,
      roles: ["contributor"],
    });
    expect(authority.actions).toEqual(
      expect.arrayContaining([
        "git.commit",
        "git.push_branch",
        "provider.pull_request.open",
      ]),
    );
    expect(authority.actions).not.toContain("provider.pull_request.merge");
  });

  it("rejects invalid authority policies", () => {
    const configWithAuthority = (authority: unknown) => ({
      version: 1,
      id: "invalid-authority-project",
      name: "Invalid Authority Project",
      authority,
    });

    expect(() =>
      validateProjectConfig(
        configWithAuthority({
          actors: [
            {
              id: "example-bot-actor",
              kind: "machine_user",
              providerIdentity: "Example-Bot",
              displayName: "Example Bot",
            },
            {
              id: "example-bot-actor",
              kind: "machine_user",
              providerIdentity: "Example-Bot",
              displayName: "Example Bot Duplicate",
            },
          ],
        }),
      ),
    ).toThrow(/authority\.actors contains duplicate id: example-bot-actor/);

    expect(() =>
      validateProjectConfig(
        configWithAuthority({
          roles: [
            {
              id: "publisher",
              actions: ["release.publish"],
            },
            {
              id: "publisher",
              actions: ["project.read"],
            },
          ],
        }),
      ),
    ).toThrow(/authority\.roles contains duplicate id: publisher/);

    expect(() =>
      validateProjectConfig(
        configWithAuthority({
          roleBindings: [
            {
              actorId: "example-bot-actor",
              roles: ["unknown_role"],
              scope: {
                project: "invalid-authority-project",
              },
            },
          ],
        }),
      ),
    ).toThrow(/roleBindings\[0\]\.roles\[0\] references unknown role: unknown_role/);

    expect(() =>
      validateProjectConfig(
        configWithAuthority({
          roles: [
            {
              id: "bad_action",
              actions: ["merge_everything"],
            },
          ],
        }),
      ),
    ).toThrow(/authority\.roles\[0\]\.actions\[0\]/);

    expect(() =>
      validateProjectConfig(
        configWithAuthority({
          roleBindings: [
            {
              actorId: "example-bot-actor",
              roles: ["observer"],
              scope: {},
            },
          ],
        }),
      ),
    ).toThrow(/authority\.roleBindings\[0\]\.scope must contain at least one scope/);
  });

  it("normalizes project host registry config without host-local details", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "hosted-project",
        name: "Hosted Project",
        hosts: [
          {
            id: "linux-ci",
            displayName: "Linux CI",
            platformTags: ["linux"],
            capabilityTags: ["dev-nexus", "node"],
          },
        ],
      }).hosts,
    ).toEqual([
      {
        id: "linux-ci",
        displayName: "Linux CI",
        platformTags: ["linux"],
        capabilityTags: ["dev-nexus", "node"],
        enabled: true,
      },
    ]);
  });

  it("accepts explicit active agent targets and normalizes projection settings", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "agent-target-project",
      name: "Agent Target Project",
      agentTargets: {
        active: [
          {
            provider: "Codex",
            sourceControl: "support",
            mcp: {
              configPath: ".codex/config.toml",
              defaultToolsApprovalMode: "approve",
            },
            skills: {
              directory: ".agents/skills",
            },
            setupNotes: ["Codex is the active provider for this project."],
          },
        ],
      },
    });

    expect(config.agentTargets).toEqual({
      active: [
        {
          provider: "codex",
          sourceControl: "support",
          mcp: {
            configPath: ".codex/config.toml",
            defaultToolsApprovalMode: "approve",
          },
          skills: {
            directory: ".agents/skills",
          },
          setupNotes: ["Codex is the active provider for this project."],
        },
      ],
    });

    expect(normalizeNexusProjectAgentTargets(config)).toMatchObject({
      explicit: true,
      recommendations: [],
      targets: [
        {
          provider: "codex",
          sourceControl: "support",
          mcp: {
            enabled: true,
            source: "explicit",
            target: {
              agent: "codex",
              provider: "codex",
              configPath: ".codex/config.toml",
              defaultToolsApprovalMode: "approve",
            },
          },
          skills: {
            enabled: true,
            source: "explicit",
            target: {
              agent: "codex",
              directory: ".agents/skills",
            },
          },
          setupNotes: ["Codex is the active provider for this project."],
          compatibilitySource: "explicit",
        },
      ],
    });
  });

  it("preserves multi-provider active target configuration", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "multi-agent-project",
      name: "Multi Agent Project",
      agentTargets: {
        active: [
          {
            provider: "codex",
            skills: {
              enabled: false,
            },
          },
          {
            provider: "claude",
            mcp: {
              enabled: false,
            },
            skills: {
              directory: ".claude/skills",
              sourceControl: "source",
            },
          },
        ],
      },
    });

    expect(normalizeNexusProjectAgentTargets(config).targets).toMatchObject([
      {
        provider: "codex",
        mcp: {
          enabled: true,
          target: {
            agent: "codex",
            provider: "codex",
          },
        },
        skills: {
          enabled: false,
          target: null,
        },
      },
      {
        provider: "claude",
        mcp: {
          enabled: false,
          target: null,
        },
        skills: {
          enabled: true,
          target: {
            agent: "claude",
            directory: ".claude/skills",
            sourceControl: "source",
          },
        },
      },
    ]);
  });

  it("derives active MCP and skill targets from the active agent policy", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "active-target-project",
      name: "Active Target Project",
      agentTargets: {
        active: [
          {
            provider: "codex",
            mcp: {
              configPath: ".codex/project.toml",
            },
            skills: {
              directory: ".agents/project-skills",
            },
          },
          {
            provider: "claude",
            mcp: {
              enabled: false,
            },
          },
        ],
      },
      mcp: {
        agentTargets: [{ agent: "claude" }],
      },
      skills: {
        agentTargets: [{ agent: "claude" }],
      },
    });

    expect(activeNexusProjectMcpAgentTargets(config)).toMatchObject([
      {
        agent: "codex",
        provider: "codex",
        configPath: ".codex/project.toml",
      },
    ]);
    expect(activeNexusProjectSkillAgentTargets(config)).toMatchObject([
      {
        agent: "codex",
        directory: ".agents/project-skills",
      },
      {
        agent: "claude",
      },
    ]);
    expect(selectNexusProjectMcpAgentTargets(config, [])).toMatchObject([
      {
        agent: "codex",
        configPath: ".codex/project.toml",
      },
    ]);
    expect(selectNexusProjectMcpAgentTargets(config, ["claude"])).toMatchObject([
      {
        agent: "claude",
      },
    ]);
    expect(selectNexusProjectMcpAgentTargets(config, ["opencode"])).toEqual([
      { agent: "opencode" },
    ]);
  });

  it("normalizes legacy MCP and skill targets into compatibility policy", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "legacy-agent-project",
      name: "Legacy Agent Project",
      mcp: {
        agentTargets: [
          {
            agent: "codex",
          },
        ],
      },
      skills: {
        agentTargets: [
          {
            agent: "codex",
          },
          {
            agent: "claude",
            directory: ".claude/skills",
          },
        ],
      },
    });

    expect(normalizeNexusProjectAgentTargets(config)).toMatchObject({
      explicit: false,
      recommendations: [
        expect.stringContaining("legacy mcp.agentTargets and skills.agentTargets"),
      ],
      targets: [
        {
          provider: "codex",
          mcp: {
            enabled: true,
            source: "legacy",
          },
          skills: {
            enabled: true,
            source: "legacy",
          },
        },
        {
          provider: "claude",
          mcp: {
            enabled: false,
            source: "disabled",
          },
          skills: {
            enabled: true,
            source: "legacy",
            target: {
              agent: "claude",
              directory: ".claude/skills",
            },
          },
        },
      ],
    });
  });

  it("normalizes legacy MCP-only and skills-only workspace configs", () => {
    const mcpOnly = validateProjectConfig({
      version: 1,
      id: "mcp-only-project",
      name: "MCP Only Project",
      mcp: {
        agentTargets: [
          {
            agent: "codex",
          },
        ],
      },
    });
    const skillsOnly = validateProjectConfig({
      version: 1,
      id: "skills-only-project",
      name: "Skills Only Project",
      mcp: {
        enabled: false,
      },
      skills: {
        agentTargets: [
          {
            agent: "claude",
          },
        ],
      },
    });

    expect(normalizeNexusProjectAgentTargets(mcpOnly).targets).toMatchObject([
      {
        provider: "codex",
        mcp: { enabled: true },
        skills: { enabled: false },
      },
    ]);
    expect(normalizeNexusProjectAgentTargets(skillsOnly).targets).toMatchObject([
      {
        provider: "claude",
        mcp: { enabled: false },
        skills: { enabled: true },
      },
    ]);
  });

  it("rejects invalid active agent target policies", () => {
    const configWithAgentTargets = (active: unknown[]) => ({
      version: 1,
      id: "invalid-agent-target-project",
      name: "Invalid Agent Target Project",
      agentTargets: {
        active,
      },
    });

    expect(() =>
      validateProjectConfig(configWithAgentTargets([])),
    ).toThrow(/agentTargets\.active must not be empty/);

    expect(() =>
      validateProjectConfig(
        configWithAgentTargets([
          {
            provider: "codex",
          },
          {
            provider: "Codex",
          },
        ]),
      ),
    ).toThrow(/duplicate provider: codex/);

    expect(() =>
      validateProjectConfig(
        configWithAgentTargets([
          {
            provider: "unknown-agent",
          },
        ]),
      ),
    ).toThrow(/provider must be codex, claude, opencode, manual, or custom/);

    expect(() =>
      validateProjectConfig(
        configWithAgentTargets([
          {
            provider: "codex",
            enabled: false,
          },
        ]),
      ),
    ).toThrow(/enabled must not be false/);

    expect(() =>
      validateProjectConfig(
        configWithAgentTargets([
          {
            provider: "codex",
            skills: {
              sourceControl: "shared",
            },
          },
        ]),
      ),
    ).toThrow(/agentTargets\.active\[0\]\.skills\.sourceControl/);
  });

  it("accepts generic runner profiles across safety classes", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "runner-project",
        name: "Runner Project",
        hosts: [
          {
            id: "linux-verifier",
            capabilityTags: ["node", "git", "runtime"],
          },
        ],
        runnerProfiles: [
          {
            id: "read-only",
            allowedOperationClasses: ["read_only"],
            mutationClass: "none",
          },
          {
            id: "verify",
            requiredCapabilities: ["node"],
            allowedOperationClasses: ["read_only", "verification"],
            commandProfileRefs: ["npm-check"],
            limits: {
              timeoutMs: 120000,
              outputLineLimit: 2000,
              outputByteLimit: 1000000,
            },
            artifactRetention: {
              mode: "logs",
              ttlDays: 7,
            },
            credentialIdentity: {
              kind: "automation",
              identityRef: "github-bot",
            },
            mutationClass: "verification",
          },
          {
            id: "workspace-local",
            allowedOperationClasses: [
              "read_only",
              "verification",
              "project_local_mutation",
            ],
            mutationClass: "project_local",
          },
          {
            id: "live-runtime",
            requiredCapabilities: ["runtime"],
            allowedOperationClasses: ["read_only", "live_runtime"],
            mutationClass: "live_runtime",
            approval: {
              required: true,
              policyGateIds: ["runner.live-runtime.approved"],
              reason: "Bounded live runtime smoke profile.",
            },
          },
          {
            id: "destructive-cleanup",
            allowedOperationClasses: ["destructive"],
            mutationClass: "destructive",
            artifactRetention: {
              mode: "summary",
              ttlDays: 30,
            },
            approval: {
              required: true,
              approvalRef: "approval://cleanup/2026-05-18",
            },
          },
        ],
      }).runnerProfiles,
    ).toEqual([
      {
        id: "read-only",
        displayName: "read-only",
        enabled: true,
        requiredCapabilities: [],
        allowedOperationClasses: ["read_only"],
        commandProfileRefs: [],
        limits: {
          timeoutMs: null,
          outputLineLimit: null,
          outputByteLimit: null,
        },
        artifactRetention: {
          mode: "none",
          ttlDays: null,
        },
        credentialIdentity: {
          kind: "none",
          identityRef: null,
        },
        mutationClass: "none",
        approval: {
          required: false,
          policyGateIds: [],
          approvalRef: null,
          reason: null,
        },
      },
      expect.objectContaining({
        id: "verify",
        requiredCapabilities: ["node"],
        commandProfileRefs: ["npm-check"],
        mutationClass: "verification",
      }),
      expect.objectContaining({
        id: "workspace-local",
        mutationClass: "project_local",
      }),
      expect.objectContaining({
        id: "live-runtime",
        mutationClass: "live_runtime",
        approval: expect.objectContaining({
          required: true,
          policyGateIds: ["runner.live-runtime.approved"],
        }),
      }),
      expect.objectContaining({
        id: "destructive-cleanup",
        mutationClass: "destructive",
        approval: expect.objectContaining({
          required: true,
          approvalRef: "approval://cleanup/2026-05-18",
        }),
      }),
    ]);
  });

  it("rejects unsafe or contradictory runner profile combinations", () => {
    const configWithRunnerProfile = (profile: Record<string, unknown>) => ({
      version: 1,
      id: "invalid-runner-project",
      name: "Invalid Runner Project",
      runnerProfiles: [
        {
          id: "runner",
          ...profile,
        },
      ],
    });

    expect(() =>
      validateProjectConfig(
        configWithRunnerProfile({
          allowedOperationClasses: ["live_runtime"],
          mutationClass: "live_runtime",
        }),
      ),
    ).toThrow(/approval\.required must be true/);

    expect(() =>
      validateProjectConfig(
        configWithRunnerProfile({
          allowedOperationClasses: ["destructive"],
          mutationClass: "destructive",
          approval: {
            required: true,
          },
        }),
      ),
    ).toThrow(/policyGateIds or approvalRef/);

    expect(() =>
      validateProjectConfig(
        configWithRunnerProfile({
          allowedOperationClasses: ["read_only"],
          mutationClass: "project_local",
        }),
      ),
    ).toThrow(/mutationClass must be none/);

    expect(() =>
      validateProjectConfig(
        configWithRunnerProfile({
          allowedOperationClasses: ["verification"],
          mutationClass: "verification",
          credentialIdentity: {
            kind: "automation",
          },
        }),
      ),
    ).toThrow(/credentialIdentity\.identityRef/);

    expect(() =>
      validateProjectConfig(
        configWithRunnerProfile({
          allowedOperationClasses: ["read_only"],
          mutationClass: "none",
          artifactRetention: {
            mode: "none",
            ttlDays: 7,
          },
        }),
      ),
    ).toThrow(/artifactRetention\.ttlDays/);
  });

  it("resolves agent configuration using issue, project, home, then fallback precedence", () => {
    expect(
      resolveNexusAgentConfig({
        fallback: {
          executor: "CODEX",
          model: "profile-default",
          reasoning: "medium",
        },
        home: {
          agent: {
            model: "gpt-5.4",
          },
        },
        project: {
          agent: {
            reasoning: "high",
          },
        },
        issue: {
          model: "gpt-5.5",
        },
      }),
    ).toEqual({
      executor: "CODEX",
      model: "gpt-5.5",
      reasoning: "high",
    });
  });

  it("accepts supported work tracking providers", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "local-tracked-project",
        name: "Local Tracked Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        workTracking: {
          provider: "local",
          storePath: ".dev-nexus/work-items.json",
        },
      }).workTracking,
    ).toEqual({
      provider: "local",
      storePath: ".dev-nexus/work-items.json",
    });

    expect(
      validateProjectConfig({
        version: 1,
        id: "jira-tracked-project",
        name: "Jira Tracked Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        workTracking: {
          provider: "jira",
          host: "example.atlassian.net",
          projectKey: "NEX",
          issueType: "Bug",
          board: {
            kind: "jira-workflow",
            statusOptions: {
              blocked: "31",
              done: "41",
            },
          },
        },
      }).workTracking,
    ).toEqual({
      provider: "jira",
      host: "example.atlassian.net",
      projectKey: "NEX",
      issueType: "Bug",
      board: {
        kind: "jira-workflow",
        statusOptions: {
          blocked: "31",
          done: "41",
        },
      },
    });
  });

  it("accepts component work tracker bindings with an explicit default", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "multi-tracker-project",
        name: "Multi Tracker Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        components: [
          {
            id: "core",
            name: "Core",
            kind: "git",
            role: "primary",
            remoteUrl: null,
            defaultBranch: "main",
            sourceRoot: "components/core",
            defaultWorkTrackerId: "issues",
            workTrackers: [
              {
                id: "issues",
                name: "Issue Tracker",
                enabled: true,
                roles: ["primary", "planning"],
                workTracking: {
                  provider: "github",
                  repository: {
                    owner: "example",
                    name: "core",
                  },
                },
              },
              {
                id: "audit",
                enabled: false,
                roles: ["archive"],
                workTracking: {
                  provider: "local",
                  storePath: ".dev-nexus/audit-items.json",
                },
              },
            ],
          },
        ],
      }).components[0],
    ).toMatchObject({
      defaultWorkTrackerId: "issues",
      workTrackers: [
        {
          id: "issues",
          name: "Issue Tracker",
          enabled: true,
          roles: ["primary", "planning"],
          workTracking: {
            provider: "github",
            repository: {
              owner: "example",
              name: "core",
            },
          },
        },
        {
          id: "audit",
          name: "audit",
          enabled: false,
          roles: ["archive"],
          workTracking: {
            provider: "local",
            storePath: ".dev-nexus/audit-items.json",
          },
        },
      ],
    });
  });

  it("normalizes tracker discovery roles and effective default policy", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "tracker-discovery-project",
      name: "Tracker Discovery Project",
      components: [
        {
          id: "core",
          name: "Core",
          kind: "git",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          defaultWorkTrackerId: "local",
          trackerDiscovery: {
            scannedRoles: ["eligible_source", "external_inbox"],
            directExternalSelection: "allowed",
            importRequiredFirst: false,
            providerFilters: ["github", "jira"],
            queryLimit: 25,
            conflictWinner: "scanned_tracker",
            missingCredentialBehavior: "skip",
          },
          workTrackers: [
            {
              id: "local",
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
            {
              id: "github-inbox",
              roles: ["eligible_source", "external_inbox"],
              workTracking: {
                provider: "github",
                repository: {
                  owner: "example",
                  name: "core",
                },
              },
            },
          ],
        },
      ],
    });

    expect(config.components[0].trackerDiscovery).toEqual({
      scannedRoles: ["eligible_source", "external_inbox"],
      directExternalSelection: "allowed",
      importRequiredFirst: false,
      providerFilters: ["github", "jira"],
      queryLimit: 25,
      trackerLimits: {},
      finalLimit: null,
      statuses: [],
      labels: [],
      milestones: [],
      assignees: [],
      providerQuery: null,
      fingerprints: [],
      conflictWinner: "scanned_tracker",
      missingCredentialBehavior: "skip",
    });
    expect(normalizeComponentWorkTrackers(config.components[0]).discoveryPolicy).toEqual({
      scannedRoles: ["eligible_source", "external_inbox"],
      directExternalSelection: "allowed",
      importRequiredFirst: false,
      providerFilters: ["github", "jira"],
      queryLimit: 25,
      trackerLimits: {},
      finalLimit: null,
      statuses: [],
      labels: [],
      milestones: [],
      assignees: [],
      providerQuery: null,
      fingerprints: [],
      conflictWinner: "scanned_tracker",
      missingCredentialBehavior: "skip",
      defaultTrackerOnly: false,
    });
  });

  it("preserves default-tracker-only discovery when no discovery policy is declared", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "legacy-discovery-project",
      name: "Legacy Discovery Project",
      components: [
        {
          id: "core",
          kind: "git",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          workTracking: {
            provider: "local",
          },
        },
      ],
    });

    expect(config.components[0].trackerDiscovery).toBeUndefined();
    expect(normalizeComponentWorkTrackers(config.components[0]).discoveryPolicy).toEqual({
      scannedRoles: ["primary"],
      directExternalSelection: "disabled",
      importRequiredFirst: true,
      providerFilters: [],
      queryLimit: 50,
      trackerLimits: {},
      finalLimit: null,
      statuses: [],
      labels: [],
      milestones: [],
      assignees: [],
      providerQuery: null,
      fingerprints: [],
      conflictWinner: "default_tracker",
      missingCredentialBehavior: "block",
      defaultTrackerOnly: true,
    });
  });

  it("rejects invalid component work tracker bindings", () => {
    const configWithComponentTracker = (
      componentPatch: Record<string, unknown>,
    ) => ({
      version: 1,
      id: "invalid-component-tracker-project",
      name: "Invalid Component Tracker Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
      components: [
        {
          id: "core",
          kind: "git",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          ...componentPatch,
        },
      ],
    });

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          defaultWorkTrackerId: "issues",
          workTrackers: [],
        }),
      ),
    ).toThrow(/workTrackers must not be empty/);

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          defaultWorkTrackerId: "issues",
          workTrackers: [
            {
              id: "issues",
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
            {
              id: "issues",
              roles: ["mirror"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        }),
      ),
    ).toThrow(/workTrackers contains duplicate id: issues/);

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          workTrackers: [
            {
              id: "issues",
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        }),
      ),
    ).toThrow(/defaultWorkTrackerId must reference/);

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          defaultWorkTrackerId: "missing",
          workTrackers: [
            {
              id: "issues",
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        }),
      ),
    ).toThrow(/defaultWorkTrackerId references unknown tracker: missing/);

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          defaultWorkTrackerId: "issues",
          workTrackers: [
            {
              id: "issues",
              enabled: false,
              roles: ["primary"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        }),
      ),
    ).toThrow(/workTrackers must contain at least one enabled tracker/);

    expect(() =>
      validateProjectConfig(
        configWithComponentTracker({
          defaultWorkTrackerId: "issues",
          workTrackers: [
            {
              id: "issues",
              roles: ["external-sync"],
              workTracking: {
                provider: "local",
              },
            },
          ],
        }),
      ),
    ).toThrow(/roles\[0\]/);
  });

  it("rejects invalid tracker discovery policies", () => {
    const configWithDiscovery = (
      trackerDiscovery: Record<string, unknown>,
    ) => ({
      version: 1,
      id: "invalid-discovery-project",
      name: "Invalid Discovery Project",
      components: [
        {
          id: "core",
          kind: "git",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          workTracking: {
            provider: "local",
          },
          trackerDiscovery,
        },
      ],
    });

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          scannedRoles: ["external-sync"],
        }),
      ),
    ).toThrow(/trackerDiscovery\.scannedRoles\[0\]/);

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          directExternalSelection: "allowed",
          importRequiredFirst: true,
        }),
      ),
    ).toThrow(/directExternalSelection cannot be allowed when importRequiredFirst is true/);

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          providerFilters: ["github", "trello"],
        }),
      ),
    ).toThrow(/trackerDiscovery\.providerFilters\[1\]/);

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          queryLimit: 0,
        }),
      ),
    ).toThrow(/trackerDiscovery\.queryLimit/);

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          conflictWinner: "latest_update",
        }),
      ),
    ).toThrow(/trackerDiscovery\.conflictWinner/);

    expect(() =>
      validateProjectConfig(
        configWithDiscovery({
          missingCredentialBehavior: "prompt",
        }),
      ),
    ).toThrow(/trackerDiscovery\.missingCredentialBehavior/);
  });

  it("accepts workspace repository hosting config with portable auth profile references", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "hosted-project",
        name: "Hosted Project",
        hosting: {
          provider: "github",
          namespace: "ExampleOrg",
          repository: {
            nameTemplate: "{projectId}-meta",
            visibility: "private",
            defaultBranch: "main",
          },
          authProfile: "human-github",
          remotes: [
            {
              name: "origin",
              role: "human",
              protocol: "ssh",
            },
            {
              name: "bot",
              role: "automation",
              protocol: "ssh",
              authProfile: "bot-github",
              sshHost: "github.com-example-bot",
            },
          ],
          access: [
            {
              kind: "human",
              providerIdentity: "alice",
              role: "human",
              requiredPermission: "admin",
              authProfile: "human-github",
              invitationPolicy: "auto_accept",
            },
            {
              kind: "machine_user",
              providerIdentity: "example-bot",
              role: "automation",
              requiredPermission: "admin",
              authProfile: "bot-github",
              invitationPolicy: "require_accepted",
            },
            {
              kind: "app",
              providerIdentity: "devnexus-automation",
              role: "automation",
              requiredPermission: "write",
              requiredProviderPermissions: {
                contents: "write",
                issues: "write",
              },
              authProfile: "devnexus-app",
              invitationPolicy: "manual",
            },
          ],
          provisioning: {
            allowCreate: false,
            allowLocalRemoteRepair: true,
            allowAccessRepair: false,
            allowInvitationAcceptance: true,
            allowDefaultBranchRepair: false,
            allowVisibilityRepair: false,
            providerMutationAuthProfile: "bot-github",
          },
        },
      }).hosting,
    ).toEqual({
      provider: "github",
      namespace: "ExampleOrg",
      repository: {
        nameTemplate: "{projectId}-meta",
        visibility: "private",
        defaultBranch: "main",
      },
      authProfile: "human-github",
      remotes: [
        {
          name: "origin",
          role: "human",
          protocol: "ssh",
        },
        {
          name: "bot",
          role: "automation",
          protocol: "ssh",
          authProfile: "bot-github",
          sshHost: "github.com-example-bot",
        },
      ],
      access: [
        {
          kind: "human",
          providerIdentity: "alice",
          role: "human",
          requiredPermission: "admin",
          authProfile: "human-github",
          invitationPolicy: "auto_accept",
        },
        {
          kind: "machine_user",
          providerIdentity: "example-bot",
          role: "automation",
          requiredPermission: "admin",
          authProfile: "bot-github",
          invitationPolicy: "require_accepted",
        },
        {
          kind: "app",
          providerIdentity: "devnexus-automation",
          role: "automation",
          requiredPermission: "write",
          requiredProviderPermissions: {
            contents: "write",
            issues: "write",
          },
          authProfile: "devnexus-app",
          invitationPolicy: "manual",
        },
      ],
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: true,
        allowAccessRepair: false,
        allowInvitationAcceptance: true,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
        providerMutationAuthProfile: "bot-github",
      },
    });

    expect(
      validateProjectConfig({
        version: 1,
        id: "hosted-default-project",
        name: "Hosted Default Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        hosting: {
          provider: "github",
          namespace: "machine-user",
        },
      }).hosting,
    ).toEqual({
      provider: "github",
      namespace: "machine-user",
      repository: {
        visibility: "private",
        defaultBranch: "main",
      },
      remotes: [
        {
          name: "origin",
          role: "human",
          protocol: "ssh",
        },
      ],
      access: [],
      provisioning: {
        allowCreate: false,
        allowLocalRemoteRepair: false,
        allowAccessRepair: false,
        allowInvitationAcceptance: false,
        allowDefaultBranchRepair: false,
        allowVisibilityRepair: false,
      },
    });
  });

  it("accepts generic automation policy with safe defaults", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "automated-project",
        name: "Automated Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          selector: {
            statuses: ["ready"],
            labels: ["automation"],
            limit: 3,
          },
          verification: {
            focusedCommands: ["npm test"],
            fullCommands: ["npm run check"],
          },
          setup: {
            dependencyLinks: [
              {
                source: "node_modules",
                target: "node_modules",
                required: false,
              },
            ],
          },
          executor: {
            command: "node task.js",
            timeoutMs: 120000,
            runFullVerification: true,
          },
          publication: {
            strategy: "direct_integration",
            targetBranch: "main",
            push: true,
          },
        },
      }).automation,
    ).toEqual({
      enabled: true,
      mode: "run_once",
      eligibleWorkMode: "default",
      selector: {
        statuses: ["ready"],
        labels: ["automation"],
        excludeLabels: [],
        assignees: [],
        search: null,
        limit: 3,
      },
      verification: {
        focusedCommands: ["npm test"],
        fullCommands: ["npm run check"],
        requirePassing: true,
      },
      ledger: {
        path: ".dev-nexus/automation/runs.json",
        retention: 200,
      },
      lock: {
        path: ".dev-nexus/automation/run.lock",
        staleAfterMs: 3600000,
      },
      workItemClaims: {
        enabled: true,
        leaseDurationMs: 3600000,
        staleClaimPolicy: "report",
      },
      backoff: {
        failureLimit: 3,
        baseDelayMs: 300000,
        maxDelayMs: 3600000,
      },
      schedule: {
        enabled: true,
        intervalMs: 900000,
      },
      setup: {
        dependencyLinks: [
          {
            source: "node_modules",
            target: "node_modules",
            required: false,
          },
        ],
      },
      executor: {
        command: "node task.js",
        timeoutMs: 120000,
        runFullVerification: true,
      },
      agent: {
        command: null,
        timeoutMs: null,
        coordinatorProfileId: null,
        maxConcurrentSubagents: 1,
        profiles: [],
        relaunch: {
          whileEligible: false,
        },
      },
      target: {
        id: null,
        objective: null,
        statePath: ".dev-nexus/automation/target-state.md",
        cycleLedgerPath: ".dev-nexus/automation/target-cycles.json",
        stopWhenNoEligibleWork: true,
        maxCycles: null,
        maxWorkItems: null,
      },
      safety: {
        profile: "local",
        allowHostMutation: false,
        allowDependencyInstall: false,
        allowLiveServices: false,
      },
      publication: {
        strategy: "direct_integration",
        remote: "origin",
        targetBranch: "main",
        push: true,
        remoteUrl: null,
        pushUrl: null,
        sshHostAlias: null,
        packagePublish: false,
        releasePublish: false,
        actor: null,
        gitIdentity: null,
        manualRemote: null,
        manualActor: null,
        commandEnvironment: {},
      },
    });
  });

  it("accepts CI tier policy in workspace and component verification config", () => {
    const ciTiers = {
      defaultTier: "remote_smoke" as const,
      fullMatrixBudget: {
        minimumIntervalMinutes: 60,
        minimumChangeCount: 3,
      },
    };
    const config = validateProjectConfig({
      version: 1,
      id: "tiered-ci-project",
      name: "Tiered CI Project",
      automation: {
        verification: {
          ciTiers,
        },
      },
      components: [
        {
          id: "core",
          name: "Core",
          kind: "git",
          role: "primary",
          remoteUrl: "https://github.com/example/project.git",
          defaultBranch: "main",
          verification: {
            ciTiers,
          },
        },
      ],
    });

    expect(config.automation?.verification.ciTiers).toMatchObject({
      defaultTier: "remote_smoke",
      fullMatrixBudget: {
        minimumIntervalMinutes: 60,
        minimumChangeCount: 3,
      },
    });
    expect(config.components[0]?.verification?.ciTiers).toMatchObject({
      defaultTier: "remote_smoke",
      tiers: expect.arrayContaining([
        expect.objectContaining({ id: "protected_target" }),
      ]),
    });
  });

  it("accepts optional publication train policy without requiring public labels", () => {
    const ciTiers = {
      defaultTier: "remote_smoke" as const,
      fullMatrixBudget: {
        minimumIntervalMinutes: 60,
        minimumChangeCount: 3,
      },
    };
    const config = validateProjectConfig({
      version: 1,
      id: "publication-train-project",
      name: "Publication Train Project",
      automation: {
        publication: {
          strategy: "green_main",
          targetBranch: "main",
          publicationTrain: {
            enabled: true,
            activeVersionId: "0.2.0",
            branchNaming: {
              integrationPrefix: "integration",
              candidatePrefix: "candidate",
              unscopedName: "manual",
            },
            ciTiers,
            selector: {
              statuses: ["ready"],
            },
          },
        },
      },
      components: [
        {
          id: "core",
          name: "Core",
          kind: "git",
          role: "primary",
          remoteUrl: "https://github.com/example/project.git",
          defaultBranch: "main",
          publication: {
            publicationTrain: {
              enabled: false,
            },
          },
        },
      ],
    });

    expect(config.automation?.publication.publicationTrain).toMatchObject({
      enabled: true,
      activeVersionId: "0.2.0",
      branchNaming: {
        integrationPrefix: "integration",
        candidatePrefix: "candidate",
        unscopedName: "manual",
      },
      selector: {
        statuses: ["ready"],
        labels: [],
      },
      ciTiers: {
        defaultTier: "remote_smoke",
        fullMatrixBudget: {
          minimumIntervalMinutes: 60,
          minimumChangeCount: 3,
        },
      },
    });
    expect(config.components[0]?.publication?.publicationTrain).toMatchObject({
      enabled: false,
      selector: {
        labels: [],
      },
    });
  });

  it("accepts publication identity and remote guardrails", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "publication-project",
        name: "Publication Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          publication: {
            strategy: "direct_integration",
            remote: "bot",
            remoteUrl: "git@github.com-bot:example/project.git",
            sshHostAlias: "github.com-bot",
            targetBranch: "main",
            push: true,
            actor: {
              kind: "machine_user",
              provider: "github",
              handle: "example-bot",
            },
            gitIdentity: {
              name: "Example Bot",
              email: "bot@example.invalid",
            },
            manualRemote: "origin",
            manualActor: {
              kind: "human",
              provider: "github",
              handle: "example-human",
            },
            commandEnvironment: {
              GH_CONFIG_DIR: "home:.config/gh-example-bot",
            },
          },
        },
      }).automation?.publication,
    ).toEqual({
      strategy: "direct_integration",
      remote: "bot",
      remoteUrl: "git@github.com-bot:example/project.git",
      pushUrl: null,
      sshHostAlias: "github.com-bot",
      packagePublish: false,
      releasePublish: false,
      targetBranch: "main",
      push: true,
      actor: {
        kind: "machine_user",
        provider: "github",
        handle: "example-bot",
        id: null,
      },
      gitIdentity: {
        name: "Example Bot",
        email: "bot@example.invalid",
      },
      manualRemote: "origin",
      manualActor: {
        kind: "human",
        provider: "github",
        handle: "example-human",
        id: null,
      },
      commandEnvironment: {
        GH_CONFIG_DIR: "home:.config/gh-example-bot",
      },
    });
  });

  it("accepts green-main publication defaults and branch-first check selectors", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "green-main-project",
        name: "Green Main Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          publication: {
            strategy: "green_main",
            targetBranch: "main",
            greenMain: {
              requiredChecks: ["build", "test"],
            },
          },
        },
      }).automation?.publication,
    ).toMatchObject({
      strategy: "green_main",
      remote: "origin",
      targetBranch: "main",
      push: false,
      greenMain: {
        integrationPreference: "pull_request",
        integrationBranch: null,
        directTargetPush: "blocked",
        mergeAuthority: "handoff",
        requiredChecks: ["build", "test"],
        staleChecks: "block",
      },
    });
  });

  it("rejects invalid green-main publication combinations", () => {
    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "green-main-project",
        name: "Green Main Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          publication: {
            strategy: "green_main",
          },
        },
      }),
    ).toThrow(/targetBranch is required/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "green-main-project",
        name: "Green Main Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          publication: {
            strategy: "green_main",
            targetBranch: "main",
            greenMain: {
              integrationPreference: "branch",
            },
          },
        },
      }),
    ).toThrow(/integrationBranch is required/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "green-main-project",
        name: "Green Main Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          publication: {
            strategy: "green_main",
            targetBranch: "main",
            push: true,
          },
        },
      }),
    ).toThrow(/push must be false/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "green-main-project",
        name: "Green Main Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          publication: {
            strategy: "review_handoff",
            greenMain: {
              requiredChecks: ["build"],
            },
          },
        },
      }),
    ).toThrow(/greenMain requires strategy green_main/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "green-main-project",
        name: "Green Main Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          publication: {
            strategy: "green_main",
            targetBranch: "main",
            greenMain: {
              mergeAuthority: "automatic",
            },
          },
        },
      }),
    ).toThrow(/mergeAuthority must be handoff or authorized_merge/);
  });

  it("rejects secret-like publication command environment keys", () => {
    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "publication-project",
        name: "Publication Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          publication: {
            commandEnvironment: {
              GITHUB_TOKEN: "token",
            },
          },
        },
      }),
    ).toThrow(/must not store secrets/);
  });

  it("accepts agent launch automation mode", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "agent-launch-project",
        name: "Agent Launch Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          mode: "agent_launch",
          agent: {
            coordinatorProfileId: "codex-heavy",
            timeoutMs: 600000,
            maxConcurrentSubagents: 4,
            profiles: [
              {
                id: "codex-heavy",
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
                args: [
                  "exec",
                  "--model",
                  "gpt-5.5",
                  "--reasoning-effort",
                  "xhigh",
                ],
              },
            ],
            relaunch: {
              whileEligible: true,
            },
          },
          target: {
            id: "dogfood",
            objective: "Use DevNexus to work on itself until no eligible issue remains.",
            statePath: ".dev-nexus/automation/dogfood.md",
            maxCycles: 12,
            maxWorkItems: 40,
          },
        },
      }).automation,
    ).toMatchObject({
      mode: "agent_launch",
      agent: {
        command: null,
        coordinatorProfileId: "codex-heavy",
        timeoutMs: 600000,
        maxConcurrentSubagents: 4,
        profiles: [
          {
            id: "codex-heavy",
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
            args: [
              "exec",
              "--model",
              "gpt-5.5",
              "--reasoning-effort",
              "xhigh",
            ],
          },
        ],
        relaunch: {
          whileEligible: true,
        },
      },
      target: {
        id: "dogfood",
        objective: "Use DevNexus to work on itself until no eligible issue remains.",
        statePath: ".dev-nexus/automation/dogfood.md",
        stopWhenNoEligibleWork: true,
        maxCycles: 12,
        maxWorkItems: 40,
      },
    });
  });

  it("accepts codex app-server profiles without changing codex exec or Claude profiles", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "app-server-agent-profile-project",
        name: "App Server Agent Profile Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          mode: "agent_launch",
          agent: {
            coordinatorProfileId: "codex-exec",
            profiles: [
              {
                id: "codex-exec",
                executor: "codex",
                model: "gpt-5.5",
                reasoning: "xhigh",
                command: "codex",
                args: ["exec"],
              },
              {
                id: "claude-worker",
                executor: "claude",
                model: "claude-sonnet",
                reasoning: null,
                command: null,
                args: [],
              },
              {
                id: "codex-app-server",
                executor: "codex",
                executorMode: "app_server",
                intendedUse: "subagent",
                model: "gpt-5.5",
                reasoning: "high",
                command: null,
                args: [],
                appServer: {
                  mode: "spawn",
                  command: "C:\\Users\\example\\Codex\\codex-app-server.exe",
                  args: ["--profile", "dogfood"],
                  endpoint: "http://127.0.0.1:17655",
                  ephemeralThreadDefault: true,
                  localPolicy: {
                    hostLocalSafetyHints: [
                      "requires_local_codex_account",
                      "spawns_local_process",
                    ],
                  },
                },
              },
            ],
          },
        },
      }).automation?.agent.profiles,
    ).toEqual([
      {
        id: "codex-exec",
        executor: "codex",
        model: "gpt-5.5",
        version: null,
        variant: null,
        reasoning: "xhigh",
        intelligence: null,
        intendedUse: "any",
        safety: null,
        command: "codex",
        args: ["exec"],
      },
      {
        id: "claude-worker",
        executor: "claude",
        model: "claude-sonnet",
        version: null,
        variant: null,
        reasoning: null,
        intelligence: null,
        intendedUse: "any",
        safety: null,
        command: null,
        args: [],
      },
      {
        id: "codex-app-server",
        executor: "codex",
        executorMode: "app_server",
        model: "gpt-5.5",
        version: null,
        variant: null,
        reasoning: "high",
        intelligence: null,
        intendedUse: "subagent",
        safety: null,
        command: null,
        args: [],
        appServer: {
          mode: "spawn",
          command: "C:\\Users\\example\\Codex\\codex-app-server.exe",
          args: ["--profile", "dogfood"],
          endpoint: "http://127.0.0.1:17655",
          ephemeralThreadDefault: true,
          localPolicy: {
            allowNonLoopbackEndpoint: false,
            hostLocalSafetyHints: [
              "requires_local_codex_account",
              "spawns_local_process",
            ],
          },
        },
      },
    ]);
  });

  it("rejects unsafe codex app-server profile combinations", () => {
    const configWithProfile = (profile: Record<string, unknown>) => ({
      version: 1,
      id: "invalid-app-server-agent-profile",
      name: "Invalid App Server Agent Profile",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
      automation: {
        agent: {
          profiles: [profile],
        },
      },
    });

    expect(() =>
      validateProjectConfig(
        configWithProfile({
          id: "spawn-missing-command",
          executor: "codex",
          executorMode: "app_server",
          appServer: {
            mode: "spawn",
            endpoint: "http://127.0.0.1:17655",
          },
        }),
      ),
    ).toThrow(/appServer\.command must be configured when appServer\.mode is spawn/);

    expect(() =>
      validateProjectConfig(
        configWithProfile({
          id: "non-loopback-without-policy",
          executor: "codex",
          executorMode: "app_server",
          appServer: {
            mode: "connect",
            endpoint: "http://192.168.1.10:17655",
          },
        }),
      ),
    ).toThrow(/non-loopback.*localPolicy\.allowNonLoopbackEndpoint/);

    expect(() =>
      validateProjectConfig(
        configWithProfile({
          id: "claude-app-server",
          executor: "claude",
          executorMode: "app_server",
          appServer: {
            mode: "connect",
            endpoint: "http://127.0.0.1:17655",
          },
        }),
      ),
    ).toThrow(/executorMode app_server requires executor codex/);

    expect(() =>
      validateProjectConfig(
        configWithProfile({
          id: "bad-hint",
          executor: "codex",
          executorMode: "app_server",
          appServer: {
            mode: "connect",
            endpoint: "http://127.0.0.1:17655",
            localPolicy: {
              hostLocalSafetyHints: ["store-token-in-config"],
            },
          },
        }),
      ),
    ).toThrow(/hostLocalSafetyHints\[0\]/);
  });

  it("accepts multiple additive plugin capability records", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "plugin-project",
        name: "Plugin Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        plugins: [
          {
            id: "analysis-tools",
            name: "Analysis Tools",
            version: "0.1.0",
            capabilities: [
              {
                kind: "projected_skill",
                id: "deep-review-skill",
                skillId: "deep-review",
                description: "Project a review skill into configured agents.",
                targetAgents: ["codex", "claude"],
              },
              {
                kind: "mcp_server",
                id: "analysis-mcp",
                serverName: "analysis_tools",
                command: "analysis-tools",
                args: ["mcp"],
                targetAgents: ["codex"],
                tools: [
                  {
                    name: "inspect_facts",
                    description: "Read plugin-supplied facts.",
                  },
                ],
              },
              {
                kind: "worker_context_fragment",
                id: "analysis-context",
                title: "Analysis Context",
                body: "Review the generated analysis facts before editing.",
                provenance: "analysis-tools manifest",
                targetAgents: ["codex"],
                targetComponents: ["core"],
              },
              {
                kind: "dependency_projection",
                id: "node-modules",
                source: "node_modules",
                target: "node_modules",
                targetAgents: ["codex"],
                targetComponents: ["core"],
                reason: "Reuse installed package dependencies in generated workers.",
              },
            ],
          },
          {
            id: "workspace-policy",
            capabilities: [
              {
                kind: "setup_obligation",
                id: "review-local-docs",
                description: "Review workspace-local setup notes before editing.",
                required: true,
              },
              {
                kind: "environment_hint",
                id: "cache-dir",
                variable: "EXAMPLE_CACHE_DIR",
                description: "Optional cache directory used by plugin tools.",
                valueHint: ".cache/example",
              },
              {
                kind: "cleanup_hook",
                id: "remove-temporary-cache",
                description: "Remove temporary cache files created by plugin tools.",
                trigger: "after_run",
              },
              {
                kind: "agent_affordance",
                id: "read-only-inspection",
                description: "Agents can inspect plugin facts without mutating source.",
              },
              {
                kind: "worker_briefing_fragment",
                id: "workspace-briefing",
                title: "Workspace Policy",
                body: "Treat the plugin workspace notes as setup context only.",
                provenance: "workspace-policy manifest",
              },
            ],
          },
        ],
      }).plugins,
    ).toEqual([
      {
        id: "analysis-tools",
        name: "Analysis Tools",
        version: "0.1.0",
        enabled: true,
        capabilities: [
          {
            kind: "projected_skill",
            id: "deep-review-skill",
            skillId: "deep-review",
            description: "Project a review skill into configured agents.",
            targetAgents: ["codex", "claude"],
          },
          {
            kind: "mcp_server",
            id: "analysis-mcp",
            serverName: "analysis_tools",
            command: "analysis-tools",
            args: ["mcp"],
            targetAgents: ["codex"],
            tools: [
              {
                name: "inspect_facts",
                description: "Read plugin-supplied facts.",
              },
            ],
          },
          {
            kind: "worker_context_fragment",
            id: "analysis-context",
            title: "Analysis Context",
            body: "Review the generated analysis facts before editing.",
            provenance: "analysis-tools manifest",
            targetAgents: ["codex"],
            targetComponents: ["core"],
          },
          {
            kind: "dependency_projection",
            id: "node-modules",
            source: "node_modules",
            target: "node_modules",
            required: false,
            sourceControl: "support",
            targetAgents: ["codex"],
            targetComponents: ["core"],
            reason: "Reuse installed package dependencies in generated workers.",
          },
        ],
      },
      {
        id: "workspace-policy",
        enabled: true,
        capabilities: [
          {
            kind: "setup_obligation",
            id: "review-local-docs",
            description: "Review workspace-local setup notes before editing.",
            required: true,
          },
          {
            kind: "environment_hint",
            id: "cache-dir",
            variable: "EXAMPLE_CACHE_DIR",
            description: "Optional cache directory used by plugin tools.",
            valueHint: ".cache/example",
            required: false,
          },
          {
            kind: "cleanup_hook",
            id: "remove-temporary-cache",
            description: "Remove temporary cache files created by plugin tools.",
            trigger: "after_run",
            required: false,
          },
          {
            kind: "agent_affordance",
            id: "read-only-inspection",
            description: "Agents can inspect plugin facts without mutating source.",
          },
          {
            kind: "worker_briefing_fragment",
            id: "workspace-briefing",
            title: "Workspace Policy",
            body: "Treat the plugin workspace notes as setup context only.",
            provenance: "workspace-policy manifest",
          },
        ],
      },
    ]);
  });

  it("accepts additive plugin MCP tools that do not duplicate core DevNexus tools", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "plugin-project",
        name: "Plugin Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        plugins: [
          {
            id: "analysis-tools",
            capabilities: [
              {
                kind: "mcp_server",
                id: "analysis-mcp",
                serverName: "analysis_tools",
                targetAgents: ["codex"],
                tools: [
                  {
                    name: "inspect_facts",
                    description: "Read plugin-supplied facts.",
                  },
                ],
              },
            ],
          },
        ],
      }).plugins?.[0]?.capabilities[0],
    ).toMatchObject({
      kind: "mcp_server",
      id: "analysis-mcp",
      serverName: "analysis_tools",
      targetAgents: ["codex"],
      tools: [
        {
          name: "inspect_facts",
          description: "Read plugin-supplied facts.",
        },
      ],
    });
  });

  it("rejects plugin MCP tools that duplicate work_item_list", () => {
    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "plugin-project",
        name: "Plugin Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        plugins: [
          {
            id: "analysis-tools",
            capabilities: [
              {
                kind: "mcp_server",
                id: "analysis-mcp",
                serverName: "analysis_tools",
                tools: [{ name: "work_item_list" }],
              },
            ],
          },
        ],
      }),
    ).toThrow(
      /plugin id analysis-tools server analysis_tools duplicate tools: work_item_list/,
    );
  });

  it("rejects plugin MCP tools that duplicate project_status", () => {
    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "plugin-project",
        name: "Plugin Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        plugins: [
          {
            id: "status-tools",
            capabilities: [
              {
                kind: "mcp_server",
                id: "status-mcp",
                serverName: "status_tools",
                tools: [{ name: "project_status" }],
              },
            ],
          },
        ],
      }),
    ).toThrow(
      /Plugin MCP server tool overlap is not allowed: plugin id status-tools server status_tools duplicate tools: project_status\. Generic DevNexus operations belong to dev_nexus\./,
    );
  });

  it("reports duplicate core tools across multiple plugin MCP servers", () => {
    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "plugin-project",
        name: "Plugin Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        plugins: [
          {
            id: "analysis-tools",
            capabilities: [
              {
                kind: "mcp_server",
                id: "analysis-safe",
                serverName: "analysis_safe",
                tools: [{ name: "inspect_facts" }],
              },
              {
                kind: "mcp_server",
                id: "analysis-status",
                serverName: "analysis_status",
                tools: [{ name: "project_status" }],
              },
            ],
          },
          {
            id: "workflow-tools",
            capabilities: [
              {
                kind: "mcp_server",
                id: "workflow-work-items",
                serverName: "workflow_items",
                tools: [
                  { name: "work_item_list" },
                  { name: "work_item_get" },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow(
      /plugin id analysis-tools server analysis_status duplicate tools: project_status; plugin id workflow-tools server workflow_items duplicate tools: work_item_get, work_item_list/,
    );
  });

  it("rejects invalid plugin dependency projection config", () => {
    const configWithDependencyProjection = (
      projection: Record<string, unknown>,
    ) => ({
      version: 1,
      id: "plugin-project",
      name: "Plugin Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
      plugins: [
        {
          id: "typescript-tools",
          capabilities: [
            {
              kind: "dependency_projection",
              id: "node-modules",
              source: "node_modules",
              target: "node_modules",
              ...projection,
            },
          ],
        },
      ],
    });

    expect(() =>
      validateProjectConfig(
        configWithDependencyProjection({
          source: "",
        }),
      ),
    ).toThrow(/workspace config\.plugins\[0\]\.capabilities\[0\]\.source/);

    expect(() =>
      validateProjectConfig(
        configWithDependencyProjection({
          source: "C:\\dev\\node_modules",
        }),
      ),
    ).toThrow(/source must be a project-relative path/);

    expect(() =>
      validateProjectConfig(
        configWithDependencyProjection({
          source: "packages/../node_modules",
        }),
      ),
    ).toThrow(/source must be a project-relative path/);

    expect(() =>
      validateProjectConfig(
        configWithDependencyProjection({
          target: "../node_modules",
        }),
      ),
    ).toThrow(/target must be a project-relative path/);

    expect(() =>
      validateProjectConfig(
        configWithDependencyProjection({
          sourceControl: "tracked",
        }),
      ),
    ).toThrow(
      /workspace config\.plugins\[0\]\.capabilities\[0\]\.sourceControl/,
    );
  });

  it("accepts dependency projections sourced from configured related components", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "pharo-project",
        name: "Pharo Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        components: [
          {
            id: "dev-nexus-pharo",
            kind: "git",
            role: "primary",
            remoteUrl: null,
            defaultBranch: "main",
            sourceRoot: "components/DevNexus-Pharo",
          },
          {
            id: "dev-nexus",
            kind: "git",
            role: "dependency",
            remoteUrl: null,
            defaultBranch: "main",
            sourceRoot: "components/DevNexus",
          },
        ],
        plugins: [
          {
            id: "pharo-tools",
            capabilities: [
              {
                kind: "dependency_projection",
                id: "dev-nexus-sibling",
                sourceComponentId: "dev-nexus",
                source: ".",
                target: "../DevNexus",
                required: true,
              },
            ],
          },
        ],
      }).plugins?.[0]?.capabilities[0],
    ).toMatchObject({
      kind: "dependency_projection",
      id: "dev-nexus-sibling",
      sourceComponentId: "dev-nexus",
      source: ".",
      target: "../DevNexus",
      required: true,
    });

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "pharo-project",
        name: "Pharo Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        components: [
          {
            id: "dev-nexus-pharo",
            kind: "git",
            role: "primary",
            remoteUrl: null,
            defaultBranch: "main",
          },
        ],
        plugins: [
          {
            id: "pharo-tools",
            capabilities: [
              {
                kind: "dependency_projection",
                id: "dev-nexus-sibling",
                sourceComponentId: "dev-nexus",
                source: ".",
                target: "../DevNexus",
              },
            ],
          },
        ],
      }),
    ).toThrow(/sourceComponentId references unknown component: dev-nexus/);
  });

  it("rejects invalid project and work tracking config", () => {
    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-repo",
        name: "Invalid Repo",
        repo: {
          kind: "svn",
        },
        kanban: {
          provider: "vibe-kanban",
        },
      }),
    ).toThrow(/repo\.kind/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-provider",
        name: "Invalid Provider",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        workTracking: {
          provider: "trello",
        },
      }),
    ).toThrow(/workTracking\.provider/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-github",
        name: "Invalid GitHub",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        workTracking: {
          provider: "github",
          repository: {
            owner: "example",
          },
        },
      }),
    ).toThrow(/workTracking\.repository\.name/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-hosting-provider",
        name: "Invalid Hosting Provider",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        hosting: {
          provider: "gitlab",
          namespace: "example",
        },
      }),
    ).toThrow(/workspace config\.hosting\.provider/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-hosting-remote",
        name: "Invalid Hosting Remote",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        hosting: {
          provider: "github",
          namespace: "example",
          remotes: [
            {
              name: "origin",
            },
            {
              name: "origin",
            },
          ],
        },
      }),
    ).toThrow(/duplicate name: origin/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-hosting-name-policy",
        name: "Invalid Hosting Name Policy",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        hosting: {
          provider: "github",
          namespace: "example",
          repository: {
            name: "fixed",
            nameTemplate: "{projectId}",
          },
        },
      }),
    ).toThrow(/either name or nameTemplate/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-hosting-access-kind",
        name: "Invalid Hosting Access Kind",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        hosting: {
          provider: "github",
          namespace: "example",
          access: [
            {
              kind: "person",
              providerIdentity: "alice",
              role: "human",
              requiredPermission: "read",
            },
          ],
        },
      }),
    ).toThrow(/hosting\.access\[0\]\.kind/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-hosting-access-permission",
        name: "Invalid Hosting Access Permission",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        hosting: {
          provider: "github",
          namespace: "example",
          access: [
            {
              kind: "human",
              providerIdentity: "alice",
              role: "human",
              requiredPermission: "owner",
            },
          ],
        },
      }),
    ).toThrow(/hosting\.access\[0\]\.requiredPermission/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-hosting-app-permissions",
        name: "Invalid Hosting App Permissions",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        hosting: {
          provider: "github",
          namespace: "example",
          access: [
            {
              kind: "app",
              providerIdentity: "devnexus-automation",
              role: "automation",
              requiredPermission: "write",
              requiredProviderPermissions: {
                contents: true,
              },
            },
          ],
        },
      }),
    ).toThrow(/hosting\.access\[0\]\.requiredProviderPermissions\.contents/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-hosting-access-policy",
        name: "Invalid Hosting Access Policy",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        hosting: {
          provider: "github",
          namespace: "example",
          access: [
            {
              kind: "human",
              providerIdentity: "alice",
              role: "human",
              requiredPermission: "read",
              invitationPolicy: "maybe_later",
            },
          ],
        },
      }),
    ).toThrow(/hosting\.access\[0\]\.invitationPolicy/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-hosting-duplicate-access",
        name: "Invalid Hosting Duplicate Access",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        hosting: {
          provider: "github",
          namespace: "example",
          access: [
            {
              kind: "human",
              providerIdentity: "Alice",
              role: "human",
              requiredPermission: "read",
            },
            {
              kind: "human",
              providerIdentity: "alice",
              role: "reviewer",
              requiredPermission: "read",
            },
          ],
        },
      }),
    ).toThrow(/duplicate principal: human:alice/i);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-hosting-secret",
        name: "Invalid Hosting Secret",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        hosting: {
          provider: "github",
          namespace: "example",
          accessToken: "gho_secret",
        },
      }),
    ).toThrow(/must not be stored in shared hosting config/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-skills",
        name: "Invalid Skills",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        skills: {
          materialization: "install",
        },
      }),
    ).toThrow(/workspace config\.skills\.materialization/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-skill-agent-targets",
        name: "Invalid Skill Agent Targets",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        skills: {
          agentTargets: "codex",
        },
      }),
    ).toThrow(/workspace config\.skills\.agentTargets must be an array/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-skill-agent-target",
        name: "Invalid Skill Agent Target",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        skills: {
          agentTargets: [
            {
              agent: "codex",
              sourceControl: "shared",
            },
          ],
        },
      }),
    ).toThrow(/workspace config\.skills\.agentTargets\[0\]\.sourceControl/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-mcp-agent-targets",
        name: "Invalid MCP Agent Targets",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        mcp: {
          agentTargets: "codex",
        },
      }),
    ).toThrow(/workspace config\.mcp\.agentTargets must be an array/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-mcp-agent-target",
        name: "Invalid MCP Agent Target",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        mcp: {
          agentTargets: [
            {
              agent: "codex",
              args: "mcp-stdio",
            },
          ],
        },
      }),
    ).toThrow(/workspace config\.mcp\.agentTargets\[0\]\.args/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-automation",
        name: "Invalid Automation",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          selector: {
            statuses: ["open"],
          },
        },
      }),
    ).toThrow(/workspace config\.automation\.selector\.statuses/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-automation-target",
        name: "Invalid Automation Target",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          target: {
            statePath: "../outside.md",
          },
        },
      }),
    ).toThrow(/workspace config\.automation\.target\.statePath/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-automation-work-item-claims",
        name: "Invalid Automation Work Item Claims",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          workItemClaims: {
            staleClaimPolicy: "steal",
          },
        },
      }),
    ).toThrow(/project config\.automation\.workItemClaims\.staleClaimPolicy/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-automation-target-cycle",
        name: "Invalid Automation Target Cycle",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          target: {
            cycleLedgerPath: "../target-cycles.json",
          },
        },
      }),
    ).toThrow(/workspace config\.automation\.target\.cycleLedgerPath/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-subagent-cap",
        name: "Invalid Subagent Cap",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          agent: {
            maxConcurrentSubagents: 0,
          },
        },
      }),
    ).toThrow(/workspace config\.automation\.agent\.maxConcurrentSubagents/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-agent-profile",
        name: "Invalid Agent Profile",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          agent: {
            coordinatorProfileId: "missing",
            profiles: [
              {
                id: "codex",
                executor: "codex",
              },
            ],
          },
        },
      }),
    ).toThrow(/coordinatorProfileId/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-agent-profile-use",
        name: "Invalid Agent Profile Use",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          agent: {
            profiles: [
              {
                id: "codex",
                executor: "codex",
                intendedUse: "planner",
              },
            ],
          },
        },
      }),
    ).toThrow(/workspace config\.automation\.agent\.profiles\[0\]\.intendedUse/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-agent-profile-safety",
        name: "Invalid Agent Profile Safety",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        automation: {
          agent: {
            profiles: [
              {
                id: "codex",
                executor: "codex",
                safety: {
                  profile: "host",
                },
              },
            ],
          },
        },
      }),
    ).toThrow(/workspace config\.automation\.agent\.profiles\[0\]\.safety\.profile/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-plugin-capability",
        name: "Invalid Plugin Capability",
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
        plugins: [
          {
            id: "plugin-a",
            capabilities: [
              {
                kind: "mcp_server",
                id: "missing-server-name",
              },
            ],
          },
        ],
      }),
    ).toThrow(/workspace config\.plugins\[0\]\.capabilities\[0\]\.serverName/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-host-registry",
        name: "Invalid Host Registry",
        hosts: [
          {
            id: "mac",
            displayName: "Mac",
            platformTags: ["macos"],
            capabilityTags: ["dev-nexus"],
          },
          {
            id: "mac",
            displayName: "Mac Duplicate",
          },
        ],
      }),
    ).toThrow(/workspace config\.hosts contains duplicate id: mac/);
  });

  it("resolves configured worktree roots from the project directory", () => {
    const projectRoot = path.join(makeTempDir("dev-nexus-project-"), "project");
    const config = validateProjectConfig({
      version: 1,
      id: "custom-worktrees",
      name: "Custom Worktrees",
      worktreesRoot: path.join(".nexus", "worktrees"),
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });

    expect(projectWorktreesRootPath(projectRoot, config)).toBe(
      path.join(projectRoot, ".nexus", "worktrees"),
    );
  });

  it("reports missing workspace config with the generic project name", () => {
    const projectRoot = makeTempDir("dev-nexus-missing-project-");

    expect(() => loadProjectConfig(projectRoot)).toThrow(NexusConfigError);
    expect(() => loadProjectConfig(projectRoot)).toThrow(
      `DevNexus workspace is not initialized: ${path.join(
        projectRoot,
        devNexusProjectConfigFileName,
      )}`,
    );
  });
});
