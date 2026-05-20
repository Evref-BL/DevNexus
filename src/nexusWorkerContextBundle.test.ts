import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultNexusAutomationConfig,
  materializeNexusWorkerContextBundle,
  nexusWorkerBriefingPath,
  nexusWorkerContextJsonPath,
  summarizeNexusAuthorityForComponent,
  type WorkItem,
} from "./index.js";

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

describe("nexus worker context bundle", () => {
  it("materializes a normalized component worktree context bundle", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "dev-nexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
    const worktreePath = path.join(worktreesRoot, "local-19");
    fs.mkdirSync(worktreePath, { recursive: true });
    const workItem: WorkItem = {
      id: "local-19",
      title: "Materialize worker context bundles for component worktrees",
      status: "ready",
      provider: "local",
      labels: ["dogfood"],
    };
    const publication = {
      ...defaultNexusAutomationConfig.publication,
      remote: "bot",
      actor: {
        kind: "machine_user" as const,
        provider: "github",
        handle: "example-bot",
        id: "example-bot-actor",
      },
      manualRemote: "origin",
      manualActor: {
        kind: "human" as const,
        provider: "github",
        handle: "example-human",
        id: null,
      },
      commandEnvironment: {
        GH_CONFIG_DIR: "home:.config/gh-example-bot",
      },
    };

    const result = materializeNexusWorkerContextBundle({
      projectRoot: path.join(projectRoot, "."),
      componentId: "dev-nexus",
      sourceRoot: path.join(sourceRoot, "..", "dev-nexus"),
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-19-worker-context",
      baseRef: "origin/main",
      workItem,
      publication,
      authority: summarizeNexusAuthorityForComponent({
        projectId: "worker-demo",
        componentId: "dev-nexus",
        componentName: "DevNexus",
        publication,
        authority: {
          actors: [
            {
              id: "example-bot-actor",
              kind: "machine_user",
              provider: "github",
              providerIdentity: "example-bot",
              displayName: "Example Bot",
            },
          ],
          roleBindings: [
            {
              actorId: "example-bot-actor",
              roles: ["maintainer"],
              scope: {
                component: "dev-nexus",
              },
            },
          ],
        },
        authProfiles: [
          {
            id: "bot-github",
            actorId: "example-bot-actor",
            provider: "github",
            kind: "automation",
            account: "example-bot",
            githubCliConfigDir: "home:.config/gh-example-bot",
            environmentKeys: ["GH_CONFIG_DIR"],
          },
        ],
      }),
      runnerProfiles: [
        {
          id: "runtime-smoke",
          displayName: "Runtime Smoke",
          enabled: true,
          requiredCapabilities: ["runtime"],
          allowedOperationClasses: ["live_runtime"],
          commandProfileRefs: ["runtime-smoke-command"],
          limits: {
            timeoutMs: 60000,
            outputLineLimit: 1000,
            outputByteLimit: 500000,
          },
          artifactRetention: {
            mode: "summary",
            ttlDays: 3,
          },
          credentialIdentity: {
            kind: "automation",
            identityRef: "github-bot",
          },
          mutationClass: "live_runtime",
          approvalRequired: true,
          approvalState: "policy_gated",
          policyGateIds: ["runner.runtime.approved"],
          missingHostCapabilities: ["runtime"],
          runnableHostIds: [],
        },
      ],
    });

    const contextJsonPath = nexusWorkerContextJsonPath(worktreePath);
    const briefingPath = nexusWorkerBriefingPath(worktreePath);
    expect(result.contextJsonPath).toBe(contextJsonPath);
    expect(result.briefingPath).toBe(briefingPath);
    expect(fs.existsSync(contextJsonPath)).toBe(true);
    expect(fs.existsSync(briefingPath)).toBe(true);

    const context = JSON.parse(fs.readFileSync(contextJsonPath, "utf8"));
    expect(context).toMatchObject({
      version: 1,
      projectRoot,
      component: {
        id: "dev-nexus",
        sourceRoot,
      },
      worktree: {
        componentId: "dev-nexus",
        sourceRoot,
        worktreesRoot,
        worktreePath,
        branchName: "codex/local-19-worker-context",
        baseRef: "origin/main",
        workItem: {
          id: "local-19",
          title: "Materialize worker context bundles for component worktrees",
          status: "ready",
          provider: "local",
          labels: ["dogfood"],
        },
      },
      publication: {
        remote: "bot",
        actor: {
          kind: "machine_user",
          provider: "github",
          handle: "example-bot",
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
      authority: {
        actor: {
          actorId: "example-bot-actor",
          status: "matched",
        },
        authProfile: {
          id: "bot-github",
        },
        keyAllowedActions: expect.arrayContaining([
          "git.commit",
          "git.push_branch",
          "provider.pull_request.open",
        ]),
        blockedActions: expect.arrayContaining(["git.push_target_branch"]),
      },
      runnerProfiles: [
        {
          id: "runtime-smoke",
          mutationClass: "live_runtime",
          approvalState: "policy_gated",
          requiredCapabilities: ["runtime"],
          commandProfileRefs: ["runtime-smoke-command"],
          missingHostCapabilities: ["runtime"],
        },
      ],
      projectContext: {
        agentsPath: path.join(projectRoot, "AGENTS.md"),
        contextPath: path.join(projectRoot, "CONTEXT.md"),
        planPath: path.join(projectRoot, "PLAN.md"),
        targetStatePath: path.join(
          projectRoot,
          ".dev-nexus",
          "automation",
          "target-state.md",
        ),
      },
      boundaries: {
        commandWorkingDirectory: worktreePath,
        gitWorkingDirectory: worktreePath,
        write: {
          roots: [worktreePath],
        },
        read: {
          roots: [sourceRoot, projectRoot],
        },
      },
    });
    expect(context.projectContext.files).toEqual([
      {
        id: "agents",
        path: path.join(projectRoot, "AGENTS.md"),
        access: "read_only",
      },
      {
        id: "context",
        path: path.join(projectRoot, "CONTEXT.md"),
        access: "read_only",
      },
      {
        id: "plan",
        path: path.join(projectRoot, "PLAN.md"),
        access: "read_only",
      },
      {
        id: "target-state",
        path: path.join(projectRoot, ".dev-nexus", "automation", "target-state.md"),
        access: "read_only",
      },
    ]);

    const briefing = fs.readFileSync(briefingPath, "utf8");
    expect(briefing).toContain("# DevNexus Worker Context");
    expect(briefing).toContain(`Run source and git commands in: ${worktreePath}`);
    expect(briefing).toContain(
      "Treat project context files as read-only unless the coordinator explicitly assigns project-state ownership.",
    );
    expect(briefing).toContain(`- AGENTS.md: ${path.join(projectRoot, "AGENTS.md")}`);
    expect(briefing).toContain("- mode: review_handoff");
    expect(briefing).toContain("- direct target push: blocked");
    expect(briefing).toContain("- merge authority: none");
    expect(briefing).toContain("- automation remote: bot");
    expect(briefing).toContain(
      "- automation actor: machine_user:github:example-bot",
    );
    expect(briefing).toContain("Authority:");
    expect(briefing).toContain(
      "- current actor: example-bot-actor status=matched profile=bot-github",
    );
    expect(briefing).toContain("- allowed actions:");
    expect(briefing).toContain(
      "- runtime-smoke: mutation=live_runtime approval=policy_gated capabilities=runtime missingHostCapabilities=runtime",
    );
    expect(briefing).toContain("- manual remote: origin");
    expect(briefing).toContain("- manual actor: human:github:example-human");
    expect(briefing).toContain("- command environment keys: GH_CONFIG_DIR");
    expect(briefing).not.toContain("home:.config/gh-example-bot");
  });

  it("uses an explicit target state path when one is supplied", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "dev-nexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
    const worktreePath = path.join(worktreesRoot, "local-19");
    const targetStatePath = path.join(projectRoot, "state", "target.md");

    const result = materializeNexusWorkerContextBundle({
      projectRoot,
      componentId: "dev-nexus",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-19-worker-context",
      baseRef: null,
      workItem: null,
      targetStatePath,
    });

    expect(result.context.projectContext.targetStatePath).toBe(targetStatePath);
    expect(result.context.projectContext.files.at(-1)).toEqual({
      id: "target-state",
      path: targetStatePath,
      access: "read_only",
    });
  });

  it("records planning docs referenced by work item descriptions as read-only root context", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "dev-nexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
    const worktreePath = path.join(worktreesRoot, "local-44");
    const prdPath = path.join(projectRoot, "docs", "component-multi-tracker-prd.md");
    fs.mkdirSync(path.dirname(prdPath), { recursive: true });
    fs.writeFileSync(prdPath, "# Component Multi-Tracker PRD\n", "utf8");
    const workItem: WorkItem = {
      id: "local-44",
      title: "Add component multi-tracker schema",
      description: "Source PRD: `docs/component-multi-tracker-prd.md`.",
      status: "ready",
      provider: "local",
      labels: ["dogfood"],
    };

    const result = materializeNexusWorkerContextBundle({
      projectRoot,
      componentId: "dev-nexus",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-44-component-trackers",
      baseRef: "origin/main",
      workItem,
    });

    const context = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(worktreePath), "utf8"),
    );
    const expectedReference = {
      id: "project-doc:docs/component-multi-tracker-prd.md",
      path: prdPath,
      access: "read_only",
    };
    expect(context.projectContext.files).toContainEqual(expectedReference);
    expect(context.projectContext.referencedFiles).toEqual([expectedReference]);
    expect(context.boundaries.read.files).toContainEqual(expectedReference);
    expect(result.briefingMarkdown).toContain("Referenced project docs:");
    expect(result.briefingMarkdown).toContain(
      `- docs/component-multi-tracker-prd.md: ${prdPath}`,
    );
  });

  it("records component docs referenced by work item descriptions as read-only component context", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "plexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "plexus");
    const worktreePath = path.join(worktreesRoot, "local-31");
    const componentDocPath = path.join(
      sourceRoot,
      "docs",
      "kanban-agent-pharo-access.md",
    );
    fs.mkdirSync(path.dirname(componentDocPath), { recursive: true });
    fs.writeFileSync(componentDocPath, "# Kanban Agent Pharo Access\n", "utf8");
    const workItem: WorkItem = {
      id: "local-31",
      title: "Fix component doc context",
      description:
        "Component reference: `docs/kanban-agent-pharo-access.md`.",
      status: "ready",
      provider: "local",
      labels: ["dogfood"],
    };

    const result = materializeNexusWorkerContextBundle({
      projectRoot,
      componentId: "plexus",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-31-context-resolution",
      baseRef: "origin/main",
      workItem,
    });

    const expectedReference = {
      id: "component-doc:docs/kanban-agent-pharo-access.md",
      path: componentDocPath,
      access: "read_only",
    };
    expect(result.context.projectContext.files).toContainEqual(
      expectedReference,
    );
    expect(result.context.projectContext.referencedFiles).toEqual([
      expectedReference,
    ]);
    expect(result.context.boundaries.read.files).toContainEqual(
      expectedReference,
    );
    expect(result.briefingMarkdown).toContain("Referenced component docs:");
    expect(result.briefingMarkdown).toContain(
      `- docs/kanban-agent-pharo-access.md: ${componentDocPath}`,
    );
  });

  it("fails before worker launch when a referenced planning doc is missing", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "dev-nexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
    const worktreePath = path.join(worktreesRoot, "local-44");
    const workItem: WorkItem = {
      id: "local-44",
      title: "Add component multi-tracker schema",
      description: "Source PRD: `docs/component-multi-tracker-prd.md`.",
      status: "ready",
      provider: "local",
    };

    expect(() =>
      materializeNexusWorkerContextBundle({
        projectRoot,
        componentId: "dev-nexus",
        sourceRoot,
        worktreesRoot,
        worktreePath,
        branchName: "codex/local-44-component-trackers",
        baseRef: "origin/main",
        workItem,
      }),
    ).toThrow(/Referenced context file is missing/);
  });

  it("records project-managed skills and worker-local agent projections", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "dev-nexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
    const worktreePath = path.join(worktreesRoot, "local-20");
    const projectManagedRoot = path.join(projectRoot, ".dev-nexus", "skills");
    const skillsDirectory = path.join(worktreePath, ".agents", "skills");

    const result = materializeNexusWorkerContextBundle({
      projectRoot,
      componentId: "dev-nexus",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-20-project-local-skills",
      baseRef: "origin/main",
      workItem: null,
      skills: {
        projectManagedRoot,
        agentNativeProjections: [
          {
            agent: "codex",
            skillsDirectory,
            sourceControl: "support",
            skills: [
              {
                id: "tdd",
                sourceSkillRoot: path.join(projectManagedRoot, "tdd"),
                projectedSkillRoot: path.join(skillsDirectory, "tdd"),
                skillPath: path.join(skillsDirectory, "tdd", "SKILL.md"),
              },
            ],
          },
        ],
      },
    });

    expect(result.context.skills).toEqual({
      projectManagedRoot,
      agentNativeProjections: [
        {
          agent: "codex",
          skillsDirectory,
          sourceControl: "support",
          skills: [
            {
              id: "tdd",
              sourceSkillRoot: path.join(projectManagedRoot, "tdd"),
              projectedSkillRoot: path.join(skillsDirectory, "tdd"),
              skillPath: path.join(skillsDirectory, "tdd", "SKILL.md"),
            },
          ],
        },
      ],
    });

    const contextJson = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(worktreePath), "utf8"),
    );
    expect(contextJson.skills.projectManagedRoot).toBe(projectManagedRoot);
    expect(contextJson.skills.agentNativeProjections[0]).toMatchObject({
      agent: "codex",
      skillsDirectory,
      sourceControl: "support",
    });
    expect(fs.readFileSync(nexusWorkerBriefingPath(worktreePath), "utf8"))
      .toContain(`Project-managed skills: ${projectManagedRoot}`);
    expect(result.briefingMarkdown).toContain(
      `- codex skills: ${skillsDirectory}`,
    );
  });

  it("records dependency support projections in context and briefing surfaces", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "dev-nexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus");
    const worktreePath = path.join(worktreesRoot, "local-23");
    const sourceDependency = path.join(sourceRoot, "node_modules");
    const targetDependency = path.join(worktreePath, "node_modules");
    const dependencyWarning =
      "Projected node_modules may resolve workspace packages from the source checkout.";

    const result = materializeNexusWorkerContextBundle({
      projectRoot,
      componentId: "dev-nexus",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-23-dependency-projections",
      baseRef: "origin/main",
      workItem: {
        id: "local-23",
        title: "Let toolchain plugins project dependencies into worker worktrees",
      },
      dependencyProjections: [
        {
          id: "typescript-node-modules",
          source: "node_modules",
          target: "node_modules",
          sourcePath: sourceDependency,
          targetPath: targetDependency,
          required: true,
          sourceControl: "support",
          reason: "Reuse already-installed JavaScript dependencies.",
          status: "linked",
          message: `Linked plugin dependency projection ${sourceDependency} -> ${targetDependency}`,
          warnings: [dependencyWarning],
          sourceMetadata: {
            pluginId: "typescript-dev-nexus",
            pluginName: "TypeScript DevNexus",
            version: "0.1.0",
            capabilityId: "node-modules",
          },
        },
      ],
    });

    expect(result.context.dependencySupport.pluginDependencyProjections).toEqual([
      {
        id: "typescript-node-modules",
        source: "node_modules",
        target: "node_modules",
        sourcePath: sourceDependency,
        targetPath: targetDependency,
        required: true,
        sourceControl: "support",
        reason: "Reuse already-installed JavaScript dependencies.",
        status: "linked",
        message: `Linked plugin dependency projection ${sourceDependency} -> ${targetDependency}`,
        warnings: [dependencyWarning],
        sourceMetadata: {
          pluginId: "typescript-dev-nexus",
          pluginName: "TypeScript DevNexus",
          version: "0.1.0",
          capabilityId: "node-modules",
        },
      },
    ]);

    const contextJson = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(worktreePath), "utf8"),
    );
    expect(contextJson.dependencySupport.pluginDependencyProjections[0])
      .toMatchObject({
        id: "typescript-node-modules",
        status: "linked",
        warnings: [dependencyWarning],
        sourceMetadata: {
          pluginId: "typescript-dev-nexus",
          capabilityId: "node-modules",
        },
      });
    expect(result.briefingMarkdown).toContain("Dependency support:");
    expect(result.briefingMarkdown).toContain(
      "- linked typescript-node-modules: node_modules",
    );
    expect(result.briefingMarkdown).toContain(
      "Source: typescript-dev-nexus:node-modules",
    );
    expect(result.briefingMarkdown).toContain(`Warning: ${dependencyWarning}`);
    expect(result.briefingMarkdown).toContain(
      "Package fetch and install are setup-owned; workers should report missing package dependencies as setup blockers instead of running ad hoc npm install or npx fetches.",
    );
  });

  it("records related component dependency projection sources in context and briefing surfaces", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "DevNexus-Pharo");
    const relatedSourceRoot = path.join(projectRoot, "components", "DevNexus");
    const worktreesRoot = path.join(projectRoot, "worktrees", "dev-nexus-pharo");
    const worktreePath = path.join(worktreesRoot, "local-24");
    const targetDependency = path.join(worktreesRoot, "DevNexus");

    const result = materializeNexusWorkerContextBundle({
      projectRoot,
      componentId: "dev-nexus-pharo",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-24-related-dependency-projections",
      baseRef: "origin/main",
      workItem: {
        id: "local-24",
        title: "Support related component dependency projections",
      },
      dependencyProjections: [
        {
          id: "dev-nexus-sibling",
          source: ".",
          target: "../DevNexus",
          sourcePath: relatedSourceRoot,
          targetPath: targetDependency,
          required: true,
          sourceControl: "support",
          reason: "Pharo baselines resolve the sibling DevNexus checkout.",
          status: "linked",
          message: `Linked plugin dependency projection ${relatedSourceRoot} -> ${targetDependency}`,
          sourceMetadata: {
            pluginId: "pharo-tools",
            pluginName: "Pharo Tools",
            version: "0.1.0",
            capabilityId: "dev-nexus-sibling",
          },
          sourceComponent: {
            id: "dev-nexus",
            sourceRoot: relatedSourceRoot,
          },
        },
      ],
    });

    const contextJson = JSON.parse(
      fs.readFileSync(nexusWorkerContextJsonPath(worktreePath), "utf8"),
    );
    expect(contextJson.dependencySupport.pluginDependencyProjections[0])
      .toMatchObject({
        id: "dev-nexus-sibling",
        source: ".",
        target: "../DevNexus",
        sourceComponent: {
          id: "dev-nexus",
          sourceRoot: relatedSourceRoot,
        },
      });
    expect(result.briefingMarkdown).toContain(
      "- linked dev-nexus-sibling: ../DevNexus",
    );
    expect(result.briefingMarkdown).toContain(
      `Source component: dev-nexus (${relatedSourceRoot})`,
    );
  });

  it("renders generic plugin fragments into worker context and briefing surfaces", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const sourceRoot = path.join(projectRoot, "components", "core");
    const worktreesRoot = path.join(projectRoot, "worktrees", "core");
    const worktreePath = path.join(worktreesRoot, "local-21");

    const result = materializeNexusWorkerContextBundle({
      projectRoot,
      componentId: "core",
      sourceRoot,
      worktreesRoot,
      worktreePath,
      branchName: "codex/local-21-plugin-fragments",
      baseRef: "origin/main",
      workItem: {
        id: "local-21",
        title: "Allow plugins to contribute worker briefing fragments",
      },
      pluginFragments: {
        context: [
          {
            kind: "worker_context_fragment",
            id: "facts",
            title: "Fake Plugin Facts",
            body: "Read these fake facts before changing source.",
            provenance: "fake-context-plugin manifest",
            advisory: true,
            targetAgents: ["codex"],
            targetComponents: ["core"],
            source: {
              pluginId: "fake-context-plugin",
              pluginName: "Fake Context Plugin",
              version: "1.0.0",
              capabilityId: "facts",
            },
          },
        ],
        briefing: [
          {
            kind: "worker_briefing_fragment",
            id: "setup-note",
            title: "Fake Setup Note",
            body: "Treat this note as setup context only.",
            provenance: "fake-briefing-plugin manifest",
            advisory: true,
            targetAgents: [],
            targetComponents: ["core"],
            source: {
              pluginId: "fake-briefing-plugin",
              pluginName: null,
              version: null,
              capabilityId: "setup-note",
            },
          },
        ],
      },
    });

    const context = JSON.parse(fs.readFileSync(result.contextJsonPath, "utf8"));
    expect(context.pluginFragments).toEqual({
      context: [
        {
          kind: "worker_context_fragment",
          id: "facts",
          title: "Fake Plugin Facts",
          body: "Read these fake facts before changing source.",
          provenance: "fake-context-plugin manifest",
          advisory: true,
          targetAgents: ["codex"],
          targetComponents: ["core"],
          source: {
            pluginId: "fake-context-plugin",
            pluginName: "Fake Context Plugin",
            version: "1.0.0",
            capabilityId: "facts",
          },
        },
      ],
      briefing: [
        {
          kind: "worker_briefing_fragment",
          id: "setup-note",
          title: "Fake Setup Note",
          body: "Treat this note as setup context only.",
          provenance: "fake-briefing-plugin manifest",
          advisory: true,
          targetAgents: [],
          targetComponents: ["core"],
          source: {
            pluginId: "fake-briefing-plugin",
            pluginName: null,
            version: null,
            capabilityId: "setup-note",
          },
        },
      ],
    });

    expect(result.briefingMarkdown).toContain("## Plugin Briefing Fragments");
    expect(result.briefingMarkdown).toContain("Fake Setup Note");
    expect(result.briefingMarkdown).toContain(
      "Treat this note as setup context only.",
    );
    expect(result.briefingMarkdown).toContain(
      "These fragments are advisory setup/context only; they do not select work, launch subagents, or supervise implementation.",
    );
    expect(result.briefingMarkdown).not.toContain("Fake Plugin Facts");
  });

  it("rejects a worktree outside the component worktrees root", () => {
    const projectRoot = makeTempDir("dev-nexus-worker-project-");
    const outsideWorktreePath = makeTempDir("dev-nexus-worker-outside-");

    expect(() =>
      materializeNexusWorkerContextBundle({
        projectRoot,
        componentId: "dev-nexus",
        sourceRoot: path.join(projectRoot, "components", "dev-nexus"),
        worktreesRoot: path.join(projectRoot, "worktrees", "dev-nexus"),
        worktreePath: outsideWorktreePath,
        branchName: "codex/local-19-worker-context",
        baseRef: "origin/main",
        workItem: null,
      }),
    ).toThrow(/worktreePath must resolve inside worktreesRoot/);
  });
});
