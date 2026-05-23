import { describe, expect, it } from "vitest";
import {
  buildNexusProjectSetupProposal,
  renderNexusProjectSetupProposalSummary,
  validateNexusProjectSetupAnswers,
  type NexusProjectSetupAnswers,
} from "./nexusProjectSetupModel.js";

function richAnswers(): NexusProjectSetupAnswers {
  return {
    home: {
      path: "/Users/example/.dev-nexus",
    },
    project: {
      id: "research-suite",
      name: "Research Suite",
      root: "/Users/example/dev/research-suite",
      initializeGit: true,
      defaultBranch: "main",
    },
    components: [
      {
        id: "benchmark",
        name: "Benchmark",
        role: "primary",
        source: {
          kind: "reference_existing",
          path: "/Users/example/src/benchmark",
          defaultBranch: "main",
        },
      },
      {
        id: "graphrag",
        role: "dependency",
        source: {
          kind: "clone_project_local",
          remoteUrl: "git@github.com:Example/GraphRag.git",
          defaultBranch: "main",
        },
      },
      {
        id: "paper",
        role: "addon",
        source: {
          kind: "create_local",
          path: "components/paper",
          initializeGit: true,
        },
      },
    ],
    agentTargets: [
      {
        provider: "codex",
        configPath: ".codex/config.toml",
      },
      {
        provider: "opencode",
        configPath: ".opencode/mcp.json",
      },
    ],
    localWorkTracking: {
      enabled: true,
      provider: "local",
      storePath: ".dev-nexus/work-items/dev-nexus.json",
    },
    workTrackers: [
      {
        id: "github",
        provider: "github",
        role: "eligible_source",
        repositoryOwner: "Example",
        repositoryName: "research-suite",
      },
    ],
    authProfiles: [
      {
        id: "human-github",
        provider: "github",
        actorKind: "human",
        account: "alice",
        credentialMethod: {
          kind: "provider_cli",
          cli: "gh",
          configDir: "home:.config/gh",
        },
      },
      {
        id: "bot-github",
        provider: "github",
        actorKind: "machine_user",
        account: "research-bot",
        credentialMethod: {
          kind: "environment_variable",
          variable: "GITHUB_TOKEN",
        },
      },
      {
        id: "jira-work",
        provider: "jira",
        actorKind: "service_account",
        account: "jira-bot@example.test",
        credentialMethod: {
          kind: "http_api_token_reference",
          reference: "host-local:jira-work",
        },
      },
    ],
    hostingIntent: {
      provider: "github",
      namespace: "Example",
      repositoryName: "research-suite-meta",
      defaultBranch: "main",
      humanAuthProfileId: "human-github",
      automationAuthProfileId: "bot-github",
      providerMutationAuthProfileId: "bot-github",
    },
    publication: {
      posture: "direct_integration",
      remote: "bot",
      targetBranch: "main",
      automationAuthProfileId: "bot-github",
      humanAuthProfileId: "human-github",
    },
    readinessChecks: [
      {
        id: "github-issues",
        title: "Read GitHub issue summary",
        provider: "github",
        requiresAuthProfileId: "bot-github",
      },
      {
        id: "jira-issues",
        title: "Read Jira issue summary",
        provider: "jira",
        requiresAuthProfileId: "jira-work",
      },
    ],
  };
}

describe("workspace setup answer model", () => {
  it("builds a local setup proposal with explicit mutation classes and hosting handoff", () => {
    const proposal = buildNexusProjectSetupProposal(richAnswers());

    expect(proposal.status).toBe("ready");
    expect(proposal.diagnostics).toEqual([]);
    expect(new Set(proposal.operations.map((operation) => operation.mutationClass)))
      .toEqual(new Set([
        "local_file_write",
        "local_git_operation",
        "host_local_auth_check",
        "provider_read",
        "provider_mutation",
      ]));

    const providerMutation = proposal.operations.find(
      (operation) => operation.mutationClass === "provider_mutation",
    );
    expect(providerMutation).toMatchObject({
      id: "apply-hosting-intent",
      phase: "next_phase",
      allowedDuringLocalSetup: false,
      authProfileId: "bot-github",
    });
    expect(proposal.nextPhaseActions).toEqual([providerMutation]);

    const summary = renderNexusProjectSetupProposalSummary(proposal);
    expect(summary).toContain("Project setup proposal: Research Suite");
    expect(summary).toContain("[next:provider_mutation] Apply workspace repository hosting intent");
  });

  it("validates required project topology and component source strategies", () => {
    const diagnostics = validateNexusProjectSetupAnswers({
      ...richAnswers(),
      components: [
        {
          id: "duplicate",
          role: "primary",
          source: {
            kind: "reference_existing",
          },
        },
        {
          id: "duplicate",
          role: "primary",
          source: {
            kind: "clone_project_local",
          },
        },
      ],
    });

    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining([
        "components[0].source.path",
        "components[1].id",
        "components[1].source.remoteUrl",
        "components",
      ]),
    );
  });

  it("keeps raw secrets out of the rendered setup proposal", () => {
    const rawTokenFixture = "example-token-redaction-fixture";
    const rawPrivateKeyFixture = "example-private-key-redaction-fixture";
    const unsafeAnswers = {
      ...richAnswers(),
      authProfiles: [
        {
          id: "bad-token",
          provider: "github",
          actorKind: "machine_user",
          credentialMethod: {
            kind: "provider_cli",
            cli: "gh",
          },
          token: rawTokenFixture,
        },
      ],
      hostingIntent: {
        ...richAnswers().hostingIntent,
        privateKey: rawPrivateKeyFixture,
      },
    } as unknown as NexusProjectSetupAnswers;

    const proposal = buildNexusProjectSetupProposal(unsafeAnswers);

    expect(proposal.status).toBe("blocked");
    expect(proposal.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining([
        "$.authProfiles[0].token",
        "$.hostingIntent.privateKey",
      ]),
    );
    expect(JSON.stringify(proposal)).not.toContain(rawTokenFixture);
    expect(JSON.stringify(proposal)).not.toContain(rawPrivateKeyFixture);
  });
});
