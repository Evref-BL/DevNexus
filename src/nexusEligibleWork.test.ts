import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildNexusAutomationWorkItemQuery } from "./nexusAutomation.js";
import { defaultNexusAutomationConfig } from "./nexusAutomationConfig.js";
import {
  listNexusEligibleWorkByComponent,
  type NexusEligibleWorkProviderFactory,
} from "./nexusEligibleWork.js";
import {
  resolveProjectComponents,
} from "./nexusProjectLifecycle.js";
import {
  defaultWorkItemTrackerLinkStorePath,
  saveProjectConfig,
  saveWorkItemTrackerLinkStore,
  type NexusProjectConfig,
  type WorkItem,
  type WorkItemQuery,
  type WorkTrackerProvider,
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

describe("eligible work discovery", () => {
  it("preserves default mode by listing only component default trackers", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["primary", "eligible_source"],
        directExternalSelection: "allowed",
        importRequiredFirst: false,
        providerFilters: [],
        queryLimit: 25,
        conflictWinner: "scanned_tracker",
        missingCredentialBehavior: "skip",
      },
    });
    saveProjectConfig(projectRoot, config);
    const providers = providerFactory({
      local: [
        workItem("local-1", "Local task", {
          status: "ready",
          labels: ["automation"],
        }),
      ],
      inbox: [
        workItem("inbox-1", "External task", {
          provider: "github",
          status: "ready",
          labels: ["automation"],
        }),
      ],
    });

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "default",
      providerFactory: providers.factory,
    });

    expect(result.mode).toBe("default");
    expect(providers.queries.map((query) => query.trackerId)).toEqual(["local"]);
    expect(result.componentEligibleWorkItems).toMatchObject([
      {
        componentId: "core",
        workItems: [
          {
            id: "local-1",
            title: "Local task",
            trackerRef: {
              trackerId: "local",
              default: true,
            },
          },
        ],
        importCandidateWorkItems: [],
      },
    ]);
  });

  it("uses automation command environment to keep external provider discovery selectable", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const automation = {
      ...automationConfig(),
      publication: {
        ...automationConfig().publication,
        commandEnvironment: {
          GH_CONFIG_DIR: "home:.config/gh-example-bot",
        },
      },
    };
    const config = {
      ...projectConfig({
        trackerDiscovery: {
          scannedRoles: ["primary", "eligible_source"],
          directExternalSelection: "allowed",
          importRequiredFirst: false,
          providerFilters: ["local", "github"],
          queryLimit: 25,
          conflictWinner: "scanned_tracker",
          missingCredentialBehavior: "skip",
        },
      }),
      automation,
    };
    saveProjectConfig(projectRoot, config);
    const fetchCalls: Array<{ url: string; authorization: string | null }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const headers = init?.headers as Record<string, string>;
      fetchCalls.push({
        url: String(input),
        authorization: headers.Authorization ?? headers.authorization ?? null,
      });
      return new Response(
        JSON.stringify([
          {
            id: 42,
            number: 42,
            title: "GitHub task",
            body: null,
            state: "open",
            labels: ["automation", "status:ready"],
            assignees: [],
            milestone: null,
            created_at: "2026-05-18T09:00:00.000Z",
            updated_at: "2026-05-18T09:00:00.000Z",
            closed_at: null,
            html_url: "https://github.com/example/demo/issues/42",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automation,
      selectorQuery: buildNexusAutomationWorkItemQuery(automation),
      mode: "discovery",
      env: {},
      providerOptions: {
        github: {
          fetch: fakeFetch,
          credentialRunner: () => ({
            status: 0,
            stdout: [
              "protocol=https",
              "host=github.com",
              "username=example-bot",
              "password=credential-token",
              "",
            ].join("\n"),
            stderr: "",
          }),
        },
      },
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toMatchObject({
      authorization: "Bearer credential-token",
    });
    expect(result.eligibleWorkItems).toMatchObject([
      {
        id: "github-42",
        componentId: "core",
        title: "GitHub task",
        sourceTrackerRef: {
          trackerId: "inbox",
          provider: "github",
        },
      },
    ]);
  });

  it("passes discovery environment variables to external providers", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["eligible_source"],
        directExternalSelection: "allowed",
        importRequiredFirst: false,
        providerFilters: ["github"],
        queryLimit: 25,
        conflictWinner: "scanned_tracker",
        missingCredentialBehavior: "skip",
      },
    });
    saveProjectConfig(projectRoot, config);
    const fetchCalls: Array<{ authorization: string | null }> = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      fetchCalls.push({
        authorization: headers.Authorization ?? headers.authorization ?? null,
      });
      return new Response(
        JSON.stringify([
          {
            id: 43,
            number: 43,
            title: "Token-backed GitHub task",
            state: "open",
            labels: ["automation", "status:ready"],
            assignees: [],
            milestone: null,
            created_at: "2026-05-18T09:00:00.000Z",
            updated_at: "2026-05-18T09:00:00.000Z",
            html_url: "https://github.com/example/demo/issues/43",
          },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: config.automation!,
      selectorQuery: buildNexusAutomationWorkItemQuery(config.automation!),
      mode: "discovery",
      env: {
        GH_TOKEN: "runtime-token",
      },
      providerOptions: {
        github: {
          fetch: fakeFetch,
          credentialRunner: false,
        },
      },
    });

    expect(fetchCalls).toEqual([
      {
        authorization: "Bearer runtime-token",
      },
    ]);
    expect(result.eligibleWorkItems).toMatchObject([
      {
        id: "github-43",
        sourceTrackerRef: {
          trackerId: "inbox",
          provider: "github",
        },
      },
    ]);
  });

  it("aggregates discovery sources with policy filters and final limits", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["primary", "eligible_source"],
        directExternalSelection: "allowed",
        importRequiredFirst: false,
        providerFilters: ["local", "github"],
        queryLimit: 5,
        trackerLimits: {
          inbox: 2,
        },
        finalLimit: 2,
        statuses: ["ready"],
        labels: ["automation", "inbox"],
        assignees: ["bot"],
        milestones: ["m1"],
        providerQuery: "provider-filter",
        conflictWinner: "default_tracker",
        missingCredentialBehavior: "skip",
      },
    });
    saveProjectConfig(projectRoot, config);
    const providers = providerFactory({
      local: [
        workItem("local-1", "Local task", {
          status: "ready",
          labels: ["automation", "inbox"],
          assignees: ["bot"],
          milestone: "m1",
          description: "provider-filter",
        }),
      ],
      inbox: [
        workItem("42", "Inbox task", {
          provider: "github",
          status: "ready",
          labels: ["automation", "inbox"],
          assignees: ["bot"],
          milestone: "m1",
          description: "provider-filter",
          externalRef: {
            provider: "github",
            repositoryOwner: "example",
            repositoryName: "demo",
            itemId: "42",
            itemNumber: 42,
          },
        }),
        workItem("43", "Limited out", {
          provider: "github",
          status: "ready",
          labels: ["automation", "inbox"],
          assignees: ["bot"],
          milestone: "m1",
          description: "provider-filter",
        }),
      ],
    });

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "discovery",
      providerFactory: providers.factory,
      credentialResolver: () => ({
        status: "available",
        required: false,
        message: "credentials available",
      }),
    });

    expect(providers.queries).toMatchObject([
      {
        trackerId: "local",
        query: {
          status: ["ready"],
          labels: ["automation", "inbox"],
          assignees: ["bot"],
          search: "provider-filter",
          limit: 5,
        },
      },
      {
        trackerId: "inbox",
        query: {
          status: ["ready"],
          labels: ["automation", "inbox"],
          assignees: ["bot"],
          search: "provider-filter",
          limit: 2,
        },
      },
    ]);
    expect(result.eligibleWorkItems.map((item) => item.id)).toEqual([
      "local-1",
      "42",
    ]);
    expect(result.componentEligibleWorkItems[0]).toMatchObject({
      workItems: [
        {
          id: "local-1",
          selectable: true,
          importOnly: false,
          sourceTrackerRef: {
            trackerId: "local",
          },
          canonicalTrackerRef: {
            trackerId: "local",
          },
        },
        {
          id: "42",
          selectable: true,
          importOnly: false,
          sourceTrackerRef: {
            trackerId: "inbox",
          },
          canonicalTrackerRef: {
            trackerId: "inbox",
          },
        },
      ],
    });
  });

  it("reports imported external links as canonical work and unimported external items as import-only", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["eligible_source"],
        directExternalSelection: "disabled",
        importRequiredFirst: true,
        providerFilters: ["github"],
        queryLimit: 10,
        conflictWinner: "default_tracker",
        missingCredentialBehavior: "skip",
      },
    });
    saveProjectConfig(projectRoot, config);
    saveWorkItemTrackerLinkStore(defaultWorkItemTrackerLinkStorePath(projectRoot), {
      version: 1,
      nextAuditNumber: 1,
      updatedAt: "2026-05-18T10:00:00.000Z",
      records: [
        {
          projectId: "eligible-demo",
          componentId: "core",
          logicalItemId: "local-7",
          createdAt: "2026-05-18T10:00:00.000Z",
          updatedAt: "2026-05-18T10:00:00.000Z",
          references: [
            trackerReference("local", "local", "local-7"),
            trackerReference("inbox", "github", "42", 42),
          ],
          audit: [],
        },
      ],
    });
    const providers = providerFactory({
      inbox: [
        workItem("42", "Imported inbox task", {
          provider: "github",
          status: "ready",
          labels: ["automation"],
          externalRef: {
            provider: "github",
            repositoryOwner: "example",
            repositoryName: "demo",
            itemId: "42",
            itemNumber: 42,
          },
        }),
        workItem("99", "Needs import", {
          provider: "github",
          status: "ready",
          labels: ["automation"],
          externalRef: {
            provider: "github",
            repositoryOwner: "example",
            repositoryName: "demo",
            itemId: "99",
            itemNumber: 99,
          },
        }),
      ],
    });

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "discovery",
      providerFactory: providers.factory,
      credentialResolver: () => ({
        status: "available",
        required: true,
        message: "credentials available",
      }),
    });

    expect(result.componentEligibleWorkItems[0]).toMatchObject({
      workItems: [
        {
          id: "local-7",
          logicalItemId: "local-7",
          selectable: true,
          importOnly: false,
          canonicalTrackerRef: {
            trackerId: "local",
          },
          sourceTrackerRef: {
            trackerId: "inbox",
          },
        },
      ],
      importCandidateWorkItems: [
        {
          id: "99",
          logicalItemId: null,
          selectable: false,
          importOnly: true,
          canonicalTrackerRef: null,
          sourceTrackerRef: {
            trackerId: "inbox",
          },
        },
      ],
    });
  });

  it("deduplicates linked local and external tracker representations to one canonical assignment", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["primary", "eligible_source"],
        directExternalSelection: "disabled",
        importRequiredFirst: true,
        providerFilters: [],
        queryLimit: 10,
        conflictWinner: "default_tracker",
        missingCredentialBehavior: "skip",
      },
    });
    saveProjectConfig(projectRoot, config);
    saveWorkItemTrackerLinkStore(defaultWorkItemTrackerLinkStorePath(projectRoot), {
      version: 1,
      nextAuditNumber: 1,
      updatedAt: "2026-05-18T10:00:00.000Z",
      records: [
        {
          projectId: "eligible-demo",
          componentId: "core",
          logicalItemId: "local-7",
          createdAt: "2026-05-18T10:00:00.000Z",
          updatedAt: "2026-05-18T10:00:00.000Z",
          references: [
            trackerReference("local", "local", "local-7"),
            trackerReference("inbox", "github", "42", 42),
          ],
          audit: [],
        },
      ],
    });
    const providers = providerFactory({
      local: [
        workItem("local-7", "Local canonical task", {
          status: "ready",
          labels: ["automation"],
        }),
      ],
      inbox: [
        workItem("42", "GitHub mirror task", {
          provider: "github",
          status: "ready",
          labels: ["automation"],
          externalRef: {
            provider: "github",
            repositoryOwner: "example",
            repositoryName: "demo",
            itemId: "42",
            itemNumber: 42,
          },
        }),
      ],
    });

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "discovery",
      providerFactory: providers.factory,
      credentialResolver: () => ({
        status: "available",
        required: true,
        message: "credentials available",
      }),
    });

    expect(result.eligibleWorkItems).toMatchObject([
      {
        id: "local-7",
        logicalItemId: "local-7",
        canonicalTrackerRef: {
          trackerId: "local",
        },
        dedupe: {
          reason: "tracker_link",
          linkId: "local-7",
          collapsedCount: 2,
        },
      },
    ]);
    expect(result.importCandidateWorkItems).toEqual([]);
  });

  it("deduplicates local external references against provider-native issues", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["primary", "eligible_source"],
        directExternalSelection: "disabled",
        importRequiredFirst: true,
        providerFilters: [],
        queryLimit: 10,
        conflictWinner: "default_tracker",
        missingCredentialBehavior: "skip",
      },
    });
    saveProjectConfig(projectRoot, config);
    const externalRef = {
      provider: "github" as const,
      repositoryOwner: "example",
      repositoryName: "demo",
      itemId: "42",
      itemNumber: 42,
    };
    const providers = providerFactory({
      local: [
        workItem("local-42", "Imported task", {
          status: "ready",
          labels: ["automation"],
          externalRef,
        }),
      ],
      inbox: [
        workItem("gh-42", "Provider task", {
          provider: "github",
          status: "ready",
          labels: ["automation"],
          externalRef: {
            ...externalRef,
            itemId: "gh-42",
          },
        }),
      ],
    });

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "discovery",
      providerFactory: providers.factory,
      credentialResolver: () => ({
        status: "available",
        required: true,
        message: "credentials available",
      }),
    });

    expect(result.eligibleWorkItems).toMatchObject([
      {
        id: "local-42",
        logicalItemId: "local-42",
        dedupe: {
          reason: "external_ref",
          collapsedCount: 2,
        },
      },
    ]);
    expect(result.importCandidateWorkItems).toEqual([]);
  });

  it("uses configured fingerprints when provider identity is otherwise not stable", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["primary", "eligible_source"],
        directExternalSelection: "disabled",
        importRequiredFirst: true,
        providerFilters: [],
        queryLimit: 10,
        conflictWinner: "default_tracker",
        missingCredentialBehavior: "skip",
        fingerprints: [
          {
            id: "github-issue-42",
            trackerId: "local",
            provider: "github",
            itemId: "local-external-42",
          },
          {
            id: "github-issue-42",
            trackerId: "inbox",
            provider: "github",
            itemId: "provider-issue-42",
          },
        ],
      },
    });
    saveProjectConfig(projectRoot, config);
    const providers = providerFactory({
      local: [
        workItem("local-42", "Fingerprint local task", {
          status: "ready",
          labels: ["automation"],
          externalRef: {
            provider: "github",
            itemId: "local-external-42",
          },
        }),
      ],
      inbox: [
        workItem("provider-issue-42", "Fingerprint provider task", {
          provider: "github",
          status: "ready",
          labels: ["automation"],
          externalRef: {
            provider: "github",
            itemId: "provider-issue-42",
          },
        }),
      ],
    });

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "discovery",
      providerFactory: providers.factory,
      credentialResolver: () => ({
        status: "available",
        required: true,
        message: "credentials available",
      }),
    });

    expect(result.eligibleWorkItems).toMatchObject([
      {
        id: "local-42",
        dedupe: {
          reason: "configured_fingerprint",
          key: "fingerprint:core:github-issue-42",
          collapsedCount: 2,
        },
      },
    ]);
  });

  it("reports missing canonical targets for stale tracker links", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["primary", "eligible_source"],
        directExternalSelection: "disabled",
        importRequiredFirst: true,
        providerFilters: [],
        queryLimit: 10,
        conflictWinner: "default_tracker",
        missingCredentialBehavior: "skip",
      },
    });
    saveProjectConfig(projectRoot, config);
    saveWorkItemTrackerLinkStore(defaultWorkItemTrackerLinkStorePath(projectRoot), {
      version: 1,
      nextAuditNumber: 1,
      updatedAt: "2026-05-18T10:00:00.000Z",
      records: [
        {
          projectId: "eligible-demo",
          componentId: "core",
          logicalItemId: "local-7",
          createdAt: "2026-05-18T10:00:00.000Z",
          updatedAt: "2026-05-18T10:00:00.000Z",
          references: [
            trackerReference("local", "local", "local-7"),
            trackerReference("inbox", "github", "42", 42),
          ],
          audit: [],
        },
      ],
    });
    const providers = providerFactory({
      local: [],
      inbox: [
        workItem("42", "Stale linked inbox task", {
          provider: "github",
          status: "ready",
          labels: ["automation"],
          externalRef: {
            provider: "github",
            repositoryOwner: "example",
            repositoryName: "demo",
            itemId: "42",
            itemNumber: 42,
          },
        }),
      ],
    });

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "discovery",
      providerFactory: providers.factory,
      credentialResolver: () => ({
        status: "available",
        required: true,
        message: "credentials available",
      }),
    });

    expect(result.warnings).toEqual([
      expect.stringContaining(
        'Linked canonical tracker item "local-7" from tracker "local" was not returned',
      ),
    ]);
    expect(result.eligibleWorkItems).toMatchObject([
      {
        id: "local-7",
        warnings: [
          expect.stringContaining("Linked canonical tracker item"),
        ],
      },
    ]);
  });

  it("blocks conflicting link records without silently selecting a canonical item", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["eligible_source"],
        directExternalSelection: "disabled",
        importRequiredFirst: true,
        providerFilters: [],
        queryLimit: 10,
        conflictWinner: "block",
        missingCredentialBehavior: "skip",
      },
    });
    saveProjectConfig(projectRoot, config);
    saveWorkItemTrackerLinkStore(defaultWorkItemTrackerLinkStorePath(projectRoot), {
      version: 1,
      nextAuditNumber: 1,
      updatedAt: "2026-05-18T10:00:00.000Z",
      records: [
        {
          projectId: "eligible-demo",
          componentId: "core",
          logicalItemId: "local-7",
          createdAt: "2026-05-18T10:00:00.000Z",
          updatedAt: "2026-05-18T10:00:00.000Z",
          references: [trackerReference("inbox", "github", "42", 42)],
          audit: [],
        },
        {
          projectId: "eligible-demo",
          componentId: "core",
          logicalItemId: "local-8",
          createdAt: "2026-05-18T10:00:00.000Z",
          updatedAt: "2026-05-18T10:00:00.000Z",
          references: [trackerReference("inbox", "github", "42", 42)],
          audit: [],
        },
      ],
    });
    const providers = providerFactory({
      inbox: [
        workItem("42", "Conflicting link task", {
          provider: "github",
          status: "ready",
          labels: ["automation"],
          externalRef: {
            provider: "github",
            repositoryOwner: "example",
            repositoryName: "demo",
            itemId: "42",
            itemNumber: 42,
          },
        }),
      ],
    });

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "discovery",
      providerFactory: providers.factory,
      credentialResolver: () => ({
        status: "available",
        required: true,
        message: "credentials available",
      }),
    });

    expect(result.blockers).toEqual([
      expect.stringContaining("matches conflicting link records"),
    ]);
    expect(result.eligibleWorkItems).toEqual([]);
    expect(result.importCandidateWorkItems).toMatchObject([
      {
        id: "42",
        logicalItemId: null,
        warnings: expect.arrayContaining([
          expect.stringContaining("matches conflicting link records"),
        ]),
      },
    ]);
  });

  it("does not collapse ambiguous unlinked provider matches", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["primary", "eligible_source"],
        directExternalSelection: "disabled",
        importRequiredFirst: true,
        providerFilters: [],
        queryLimit: 10,
        conflictWinner: "block",
        missingCredentialBehavior: "skip",
      },
    });
    saveProjectConfig(projectRoot, config);
    const duplicateRef = {
      provider: "github" as const,
      repositoryOwner: "example",
      repositoryName: "demo",
      itemId: "42",
      itemNumber: 42,
    };
    const providers = providerFactory({
      local: [
        workItem("local-7", "First possible import", {
          status: "ready",
          labels: ["automation"],
          externalRef: duplicateRef,
        }),
        workItem("local-8", "Second possible import", {
          status: "ready",
          labels: ["automation"],
          externalRef: duplicateRef,
        }),
      ],
      inbox: [
        workItem("42", "Provider source", {
          provider: "github",
          status: "ready",
          labels: ["automation"],
          externalRef: duplicateRef,
        }),
      ],
    });

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "discovery",
      providerFactory: providers.factory,
      credentialResolver: () => ({
        status: "available",
        required: true,
        message: "credentials available",
      }),
    });

    expect(result.blockers).toEqual([
      expect.stringContaining("Ambiguous unlinked provider identity"),
    ]);
    expect(result.eligibleWorkItems.map((item) => item.id)).toEqual([
      "local-7",
      "local-8",
    ]);
    expect(result.importCandidateWorkItems.map((item) => item.id)).toEqual([
      "42",
    ]);
  });

  it("reports disabled trackers, capability gaps, missing credentials, and provider read errors without crashing", async () => {
    const projectRoot = makeTempDir("dev-nexus-eligible-work-");
    const config = projectConfig({
      trackerDiscovery: {
        scannedRoles: ["eligible_source"],
        directExternalSelection: "disabled",
        importRequiredFirst: true,
        providerFilters: [],
        queryLimit: 10,
        conflictWinner: "default_tracker",
        missingCredentialBehavior: "block",
      },
      workTrackers: [
        tracker("disabled", "Disabled", false, ["eligible_source"], {
          provider: "local",
          storePath: "disabled.json",
        }),
        tracker("no-list", "No List", true, ["eligible_source"], {
          provider: "vibe-kanban",
          projectId: "vk-1",
        }),
        tracker("missing-creds", "Missing Credentials", true, ["eligible_source"], {
          provider: "github",
          repository: {
            owner: "example",
            name: "demo",
          },
        }),
        tracker("throws", "Throws", true, ["eligible_source"], {
          provider: "local",
          storePath: "throws.json",
        }),
      ],
      defaultWorkTrackerId: "throws",
    });
    saveProjectConfig(projectRoot, config);
    const providers = providerFactory(
      {
        throws: [],
      },
      {
        throws: new Error("provider read failed"),
      },
    );

    const result = await listNexusEligibleWorkByComponent({
      projectRoot,
      projectConfig: config,
      components: resolveProjectComponents(projectRoot, config),
      automationConfig: automationConfig(),
      selectorQuery: buildNexusAutomationWorkItemQuery(automationConfig()),
      mode: "discovery",
      providerFactory: providers.factory,
      credentialResolver: ({ trackerId }) =>
        trackerId === "missing-creds"
          ? {
              status: "missing",
              required: true,
              message: "missing github token",
            }
          : {
              status: "not_required",
              required: false,
              message: "credentials not required",
            },
    });

    expect(result.eligibleWorkItems).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining("disabled skipped"),
    ]);
    expect(result.blockers).toEqual([
      expect.stringContaining("no-list blocked"),
      expect.stringContaining("missing-creds blocked"),
      expect.stringContaining("throws blocked"),
    ]);
  });
});

function automationConfig() {
  return {
    ...defaultNexusAutomationConfig,
    selector: {
      ...defaultNexusAutomationConfig.selector,
      statuses: ["ready"],
      labels: ["automation"],
      limit: 5,
    },
  };
}

function projectConfig(
  overrides: Partial<NexusProjectConfig["components"][number]> = {},
): NexusProjectConfig {
  return {
    version: 1,
    id: "eligible-demo",
    name: "Eligible Demo",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: null,
      defaultBranch: "main",
      sourceRoot: "source",
    },
    components: [
      {
        id: "core",
        name: "Core",
        kind: "git",
        role: "primary",
        remoteUrl: null,
        defaultBranch: "main",
        sourceRoot: "source",
        defaultWorkTrackerId: "local",
        workTrackers: [
          tracker("local", "Local", true, ["primary"], {
            provider: "local",
          }),
          tracker("inbox", "Inbox", true, ["eligible_source", "external_inbox"], {
            provider: "github",
            repository: {
              owner: "example",
              name: "demo",
            },
          }),
        ],
        relationships: [],
        ...overrides,
      },
    ],
    worktreesRoot: "worktrees",
    automation: automationConfig(),
  };
}

function tracker(
  id: string,
  name: string,
  enabled: boolean,
  roles: NexusProjectConfig["components"][number]["workTrackers"][number]["roles"],
  workTracking: NexusProjectConfig["components"][number]["workTrackers"][number]["workTracking"],
): NexusProjectConfig["components"][number]["workTrackers"][number] {
  return {
    id,
    name,
    enabled,
    roles,
    workTracking,
  };
}

function workItem(
  id: string,
  title: string,
  overrides: Partial<WorkItem> = {},
): WorkItem {
  const provider = overrides.provider ?? "local";
  return {
    id,
    title,
    description: overrides.description ?? null,
    status: overrides.status ?? "ready",
    provider,
    labels: overrides.labels ?? [],
    assignees: overrides.assignees ?? [],
    milestone: overrides.milestone ?? null,
    createdAt: "2026-05-18T09:00:00.000Z",
    updatedAt: "2026-05-18T09:00:00.000Z",
    closedAt: null,
    webUrl: null,
    externalRef:
      overrides.externalRef ??
      (provider === "local"
        ? {
            provider: "local",
            itemId: id,
          }
        : {
            provider,
            itemId: id,
          }),
    ...overrides,
  };
}

function trackerReference(
  trackerId: string,
  provider: string,
  itemId: string,
  itemNumber: number | null = null,
) {
  return {
    trackerId,
    trackerName: trackerId,
    provider,
    host: null,
    repositoryId: null,
    repositoryOwner: provider === "github" ? "example" : null,
    repositoryName: provider === "github" ? "demo" : null,
    projectId: null,
    boardId: null,
    itemId,
    itemNumber,
    itemKey: null,
    nodeId: null,
    webUrl: null,
    firstObservedAt: "2026-05-18T10:00:00.000Z",
    lastObservedAt: "2026-05-18T10:00:00.000Z",
  };
}

function providerFactory(
  itemsByTrackerId: Record<string, WorkItem[]>,
  errorsByTrackerId: Record<string, Error> = {},
): {
  factory: NexusEligibleWorkProviderFactory;
  queries: Array<{ trackerId: string; query: WorkItemQuery }>;
} {
  const queries: Array<{ trackerId: string; query: WorkItemQuery }> = [];
  return {
    queries,
    factory: ({ tracker }) =>
      new MemoryProvider(
        tracker.provider,
        itemsByTrackerId[tracker.id] ?? [],
        (query) => {
          queries.push({ trackerId: tracker.id, query });
          const error = errorsByTrackerId[tracker.id];
          if (error) {
            throw error;
          }
        },
      ),
  };
}

class MemoryProvider implements WorkTrackerProvider {
  readonly capabilities = {
    createItem: true,
    listItems: true,
    getItem: true,
    updateItem: true,
    comment: true,
    labels: true,
    assignees: true,
    milestones: true,
    board: false,
    boardStatus: false,
    draftItems: false,
    webhooks: false,
  };

  constructor(
    readonly provider: string,
    private readonly items: WorkItem[],
    private readonly beforeList: (query: WorkItemQuery) => void,
  ) {}

  async createWorkItem(): Promise<WorkItem> {
    throw new Error("not implemented");
  }

  async listWorkItems(query: WorkItemQuery): Promise<WorkItem[]> {
    this.beforeList(query);
    return this.items.filter((item) => matchesQuery(item, query)).slice(
      0,
      query.limit,
    );
  }

  async getWorkItem(): Promise<WorkItem> {
    throw new Error("not implemented");
  }

  async updateWorkItem(): Promise<WorkItem> {
    throw new Error("not implemented");
  }

  async addComment(): Promise<never> {
    throw new Error("not implemented");
  }
}

function matchesQuery(item: WorkItem, query: WorkItemQuery): boolean {
  const statuses = Array.isArray(query.status)
    ? query.status
    : query.status
      ? [query.status]
      : [];
  if (statuses.length > 0 && !statuses.includes(item.status)) {
    return false;
  }
  if (query.labels?.some((label) => !item.labels?.includes(label))) {
    return false;
  }
  if (query.assignees?.some((assignee) => !item.assignees?.includes(assignee))) {
    return false;
  }
  const search = query.search?.toLowerCase();
  if (
    search &&
    ![item.id, item.title, item.description ?? ""].some((value) =>
      value.toLowerCase().includes(search),
    )
  ) {
    return false;
  }

  return true;
}
