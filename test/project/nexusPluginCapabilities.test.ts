import { describe, expect, it } from "vitest";
import {
  devNexusPluginCatalogueSecurityRationale,
  findDevNexusPluginCatalogueEntry,
  listDevNexusPluginCatalogue,
  nexusPluginCatalogueRefreshCommand,
  projectPluginAgentPackages,
  projectPluginCapabilityProjections,
  projectPluginDependencyProjections,
  projectPluginWorkerFragments,
} from "../../src/project/nexusPluginCapabilities.js";

describe("nexus plugin catalogue", () => {
  it("exposes curated DevNexus plugin package metadata and refresh guidance", () => {
    const catalogue = listDevNexusPluginCatalogue();

    expect(catalogue.map((entry) => entry.id)).toEqual([
      "dev-nexus-typescript",
      "dev-nexus-pharo",
      "dev-nexus-research",
    ]);
    expect(catalogue).toEqual([
      expect.objectContaining({
        id: "dev-nexus-typescript",
        packageName: "@evref-bl/dev-nexus-typescript",
        configExportName: "devNexusTypeScriptDevNexusPluginConfig",
        sourcePath: null,
      }),
      expect.objectContaining({
        id: "dev-nexus-pharo",
        packageName: "@evref-bl/dev-nexus-pharo",
        configExportName: "devNexusPharoDevNexusPluginConfig",
        sourcePath: null,
      }),
      expect.objectContaining({
        id: "dev-nexus-research",
        packageName: "@evref-bl/dev-nexus-research",
        configExportName: "devNexusResearchDevNexusPluginConfig",
        sourcePath: null,
      }),
    ]);
    expect(catalogue.every((entry) => entry.sourcePath === null)).toBe(true);
    expect(devNexusPluginCatalogueSecurityRationale).toContain("curated");
    expect(devNexusPluginCatalogueSecurityRationale).toContain("allowlist");
  });

  it("builds package-backed refresh commands from catalogue entries", () => {
    const entry = findDevNexusPluginCatalogueEntry("@evref-bl/dev-nexus-pharo");

    expect(entry).toMatchObject({
      id: "dev-nexus-pharo",
      packageName: "@evref-bl/dev-nexus-pharo",
    });
    expect(nexusPluginCatalogueRefreshCommand("/tmp/demo project", entry!)).toBe(
      "dev-nexus workspace plugin refresh '/tmp/demo project' --from '@evref-bl/dev-nexus-pharo' --export devNexusPharoDevNexusPluginConfig",
    );
  });
});

describe("nexus plugin capability projections", () => {
  it("includes provider-native agent package records in plugin capability summaries", () => {
    expect(
      projectPluginCapabilityProjections({
        plugins: [
          {
            id: "agent-tools",
            name: "Agent Tools",
            version: "0.1.0",
            enabled: true,
            capabilities: [
              {
                kind: "agent_package",
                id: "codex-helper-pack",
                description: "Use the Codex helper package.",
                packageKind: "shim",
                packageName: "@example/codex-helper-pack",
                repositoryUrl: "https://example.invalid/codex-helper-pack",
                installCommand: "codex skill install @example/codex-helper-pack",
                checkCommand: "codex skill list",
                versionPolicy: "Track approved releases.",
                license: "MIT",
                provenance: "Synthetic plugin fixture",
                required: false,
                targetAgents: ["codex"],
                surfaces: ["skills", "commands", "references"],
                setupInstructions: [
                  "Install explicitly after confirming the project policy.",
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        pluginId: "agent-tools",
        pluginName: "Agent Tools",
        version: "0.1.0",
        capabilityCount: 1,
        capabilities: [
          {
            kind: "agent_package",
            id: "codex-helper-pack",
            description: "Use the Codex helper package.",
            packageKind: "shim",
            packageName: "@example/codex-helper-pack",
            repositoryUrl: "https://example.invalid/codex-helper-pack",
            installCommand: "codex skill install @example/codex-helper-pack",
            checkCommand: "codex skill list",
            versionPolicy: "Track approved releases.",
            license: "MIT",
            provenance: "Synthetic plugin fixture",
            required: false,
            targetAgents: ["codex"],
            surfaces: ["skills", "commands", "references"],
            setupInstructions: [
              "Install explicitly after confirming the project policy.",
            ],
          },
        ],
      },
    ]);
  });

  it("includes dependency projection records in plugin capability summaries", () => {
    expect(
      projectPluginCapabilityProjections({
        plugins: [
          {
            id: "typescript-tools",
            name: "TypeScript Tools",
            version: "0.1.0",
            enabled: true,
            capabilities: [
              {
                kind: "dependency_projection",
                id: "node-modules",
                source: "node_modules",
                target: "node_modules",
                reason: "Reuse the component package tree for local tests.",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        pluginId: "typescript-tools",
        pluginName: "TypeScript Tools",
        version: "0.1.0",
        capabilityCount: 1,
        capabilities: [
          {
            kind: "dependency_projection",
            id: "node-modules",
            description: null,
            source: "node_modules",
            target: "node_modules",
            required: false,
            sourceControl: "support",
            targetAgents: [],
            targetComponents: [],
            reason: "Reuse the component package tree for local tests.",
          },
        ],
      },
    ]);
  });

  it("includes related component sources in dependency projection summaries", () => {
    expect(
      projectPluginCapabilityProjections({
        plugins: [
          {
            id: "pharo-tools",
            name: "Pharo Tools",
            enabled: true,
            capabilities: [
              {
                kind: "dependency_projection",
                id: "dev-nexus-sibling",
                sourceComponentId: "dev-nexus",
                source: ".",
                target: "../DevNexus",
                required: true,
                reason: "Pharo baselines resolve the sibling DevNexus checkout.",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        pluginId: "pharo-tools",
        pluginName: "Pharo Tools",
        version: null,
        capabilityCount: 1,
        capabilities: [
          {
            kind: "dependency_projection",
            id: "dev-nexus-sibling",
            description: null,
            sourceComponentId: "dev-nexus",
            source: ".",
            target: "../DevNexus",
            required: true,
            sourceControl: "support",
            targetAgents: [],
            targetComponents: [],
            reason: "Pharo baselines resolve the sibling DevNexus checkout.",
          },
        ],
      },
    ]);
  });
});

describe("nexus plugin agent packages", () => {
  it("filters package guidance by active agent provider and keeps plugin source metadata", () => {
    expect(
      projectPluginAgentPackages(
        {
          plugins: [
            {
              id: "agent-tools",
              name: "Agent Tools",
              version: "0.1.0",
              enabled: true,
              capabilities: [
                {
                  kind: "agent_package",
                  id: "claude-native",
                  packageKind: "native",
                  packageName: "@example/claude-agent-pack",
                  repositoryUrl: "https://example.invalid/claude-agent-pack",
                  required: true,
                  targetAgents: ["claude"],
                  surfaces: ["skills", "commands"],
                },
                {
                  kind: "agent_package",
                  id: "codex-shim",
                  description: "Use the Codex agent package shim.",
                  packageKind: "shim",
                  packageName: "@example/codex-agent-shim",
                  repositoryUrl: "https://example.invalid/codex-agent-shim",
                  installCommand: "codex skill install @example/codex-agent-shim",
                  checkCommand: "codex skill list",
                  targetAgents: ["codex"],
                  surfaces: ["skills", "commands", "references"],
                },
                {
                  kind: "agent_package",
                  id: "opencode-manual",
                  packageKind: "manual_guidance",
                  packageName: "@example/opencode-agent-plan",
                  targetAgents: ["opencode"],
                  setupInstructions: [
                    "Use the project-local package plan until a native package exists.",
                  ],
                },
                {
                  kind: "agent_package",
                  id: "fallback",
                  packageKind: "bundled_fallback",
                  packageName: "@example/bundled-agent-fallback",
                  targetAgents: ["manual", "custom"],
                },
              ],
            },
            {
              id: "disabled-tools",
              enabled: false,
              capabilities: [
                {
                  kind: "agent_package",
                  id: "disabled",
                  packageKind: "native",
                  packageName: "disabled",
                  targetAgents: ["codex"],
                },
              ],
            },
          ],
        },
        { activeAgents: ["codex", "opencode", "custom"] },
      ),
    ).toEqual([
      expect.objectContaining({
        id: "codex-shim",
        packageKind: "shim",
        packageName: "@example/codex-agent-shim",
        targetAgents: ["codex"],
        pluginSource: {
          pluginId: "agent-tools",
          pluginName: "Agent Tools",
          version: "0.1.0",
          capabilityId: "codex-shim",
        },
      }),
      expect.objectContaining({
        id: "fallback",
        packageKind: "bundled_fallback",
        packageName: "@example/bundled-agent-fallback",
        targetAgents: ["manual", "custom"],
      }),
      expect.objectContaining({
        id: "opencode-manual",
        packageKind: "manual_guidance",
        packageName: "@example/opencode-agent-plan",
        setupInstructions: [
          "Use the project-local package plan until a native package exists.",
        ],
      }),
    ]);
  });
});

describe("nexus plugin dependency projections", () => {
  it("filters disabled plugins and target scopes while keeping plugin source metadata", () => {
    expect(
      projectPluginDependencyProjections(
        {
          plugins: [
            {
              id: "zeta-tools",
              enabled: true,
              capabilities: [
                {
                  kind: "dependency_projection",
                  id: "node-modules",
                  description: "Project npm dependencies.",
                  source: "node_modules",
                  target: "node_modules",
                  required: true,
                  sourceControl: "support",
                  targetAgents: ["codex"],
                  targetComponents: ["core"],
                  reason: "Let generated workers run local package scripts.",
                },
              ],
            },
            {
              id: "disabled-tools",
              enabled: false,
              capabilities: [
                {
                  kind: "dependency_projection",
                  id: "disabled",
                  source: "disabled",
                  target: "disabled",
                },
              ],
            },
            {
              id: "alpha-tools",
              name: "Alpha Tools",
              version: "1.2.3",
              enabled: true,
              capabilities: [
                {
                  kind: "dependency_projection",
                  id: "cache",
                  source: ".cache/tooling",
                  target: ".dev-nexus/support/tooling-cache",
                  sourceControl: "source",
                },
                {
                  kind: "dependency_projection",
                  id: "dev-nexus-sibling",
                  sourceComponentId: "dev-nexus",
                  source: ".",
                  target: "../DevNexus",
                  required: true,
                  targetComponents: ["core"],
                },
                {
                  kind: "dependency_projection",
                  id: "other-agent",
                  source: "other",
                  target: "other",
                  targetAgents: ["claude"],
                },
                {
                  kind: "dependency_projection",
                  id: "other-component",
                  source: "other-component",
                  target: "other-component",
                  targetComponents: ["other"],
                },
              ],
            },
          ],
        },
        { componentId: "core", agent: "codex" },
      ),
    ).toEqual([
      {
        kind: "dependency_projection",
        id: "cache",
        description: null,
        source: ".cache/tooling",
        target: ".dev-nexus/support/tooling-cache",
        required: false,
        sourceControl: "source",
        targetAgents: [],
        targetComponents: [],
        reason: null,
        pluginSource: {
          pluginId: "alpha-tools",
          pluginName: "Alpha Tools",
          version: "1.2.3",
          capabilityId: "cache",
        },
      },
      {
        kind: "dependency_projection",
        id: "dev-nexus-sibling",
        description: null,
        sourceComponentId: "dev-nexus",
        source: ".",
        target: "../DevNexus",
        required: true,
        sourceControl: "support",
        targetAgents: [],
        targetComponents: ["core"],
        reason: null,
        pluginSource: {
          pluginId: "alpha-tools",
          pluginName: "Alpha Tools",
          version: "1.2.3",
          capabilityId: "dev-nexus-sibling",
        },
      },
      {
        kind: "dependency_projection",
        id: "node-modules",
        description: "Project npm dependencies.",
        source: "node_modules",
        target: "node_modules",
        required: true,
        sourceControl: "support",
        targetAgents: ["codex"],
        targetComponents: ["core"],
        reason: "Let generated workers run local package scripts.",
        pluginSource: {
          pluginId: "zeta-tools",
          pluginName: null,
          version: null,
          capabilityId: "node-modules",
        },
      },
    ]);
  });

  it("filters dependency projections by compatible active agents", () => {
    expect(
      projectPluginDependencyProjections(
        {
          plugins: [
            {
              id: "agent-tools",
              enabled: true,
              capabilities: [
                {
                  kind: "dependency_projection",
                  id: "codex-only",
                  source: "codex",
                  target: "codex",
                  targetAgents: ["codex"],
                },
                {
                  kind: "dependency_projection",
                  id: "claude-only",
                  source: "claude",
                  target: "claude",
                  targetAgents: ["claude"],
                },
                {
                  kind: "dependency_projection",
                  id: "all-active",
                  source: "all",
                  target: "all",
                },
              ],
            },
          ],
        },
        { activeAgents: ["codex"] },
      ).map((projection) => projection.id),
    ).toEqual(["all-active", "codex-only"]);
  });
});

describe("nexus plugin worker fragments", () => {
  it("orders enabled plugin fragments deterministically and keeps provenance for duplicate ids", () => {
    expect(
      projectPluginWorkerFragments(
        {
          plugins: [
            {
              id: "zeta-plugin",
              enabled: true,
              capabilities: [
                {
                  kind: "worker_briefing_fragment",
                  id: "shared",
                  title: "Zeta Shared",
                  body: "Zeta briefing body.",
                  provenance: "zeta manifest",
                },
              ],
            },
            {
              id: "disabled-plugin",
              enabled: false,
              capabilities: [
                {
                  kind: "worker_briefing_fragment",
                  id: "disabled",
                  title: "Disabled",
                  body: "This fragment should not render.",
                  provenance: "disabled manifest",
                },
              ],
            },
            {
              id: "alpha-plugin",
              name: "Alpha Plugin",
              version: "1.0.0",
              enabled: true,
              capabilities: [
                {
                  kind: "worker_briefing_fragment",
                  id: "shared",
                  title: "Alpha Shared",
                  body: "Alpha briefing body.",
                  provenance: "alpha manifest",
                  targetComponents: ["core"],
                },
                {
                  kind: "worker_context_fragment",
                  id: "facts",
                  title: "Alpha Facts",
                  body: "Alpha context body.",
                  provenance: "alpha manifest",
                  targetAgents: ["codex"],
                  targetComponents: ["core"],
                },
                {
                  kind: "worker_context_fragment",
                  id: "other-component",
                  title: "Other Component",
                  body: "This fragment is intended elsewhere.",
                  provenance: "alpha manifest",
                  targetComponents: ["other"],
                },
              ],
            },
          ],
        },
        { componentId: "core", agent: "codex" },
      ),
    ).toEqual({
      context: [
        {
          kind: "worker_context_fragment",
          id: "facts",
          title: "Alpha Facts",
          body: "Alpha context body.",
          provenance: "alpha manifest",
          advisory: true,
          targetAgents: ["codex"],
          targetComponents: ["core"],
          source: {
            pluginId: "alpha-plugin",
            pluginName: "Alpha Plugin",
            version: "1.0.0",
            capabilityId: "facts",
          },
        },
      ],
      briefing: [
        {
          kind: "worker_briefing_fragment",
          id: "shared",
          title: "Alpha Shared",
          body: "Alpha briefing body.",
          provenance: "alpha manifest",
          advisory: true,
          targetAgents: [],
          targetComponents: ["core"],
          source: {
            pluginId: "alpha-plugin",
            pluginName: "Alpha Plugin",
            version: "1.0.0",
            capabilityId: "shared",
          },
        },
        {
          kind: "worker_briefing_fragment",
          id: "shared",
          title: "Zeta Shared",
          body: "Zeta briefing body.",
          provenance: "zeta manifest",
          advisory: true,
          targetAgents: [],
          targetComponents: [],
          source: {
            pluginId: "zeta-plugin",
            pluginName: null,
            version: null,
            capabilityId: "shared",
          },
        },
      ],
    });
  });

  it("filters worker fragments by compatible active agents", () => {
    expect(
      projectPluginWorkerFragments(
        {
          plugins: [
            {
              id: "agent-fragments",
              enabled: true,
              capabilities: [
                {
                  kind: "worker_context_fragment",
                  id: "codex-facts",
                  title: "Codex Facts",
                  body: "Codex context.",
                  provenance: "agent-fragments",
                  targetAgents: ["codex"],
                },
                {
                  kind: "worker_context_fragment",
                  id: "claude-facts",
                  title: "Claude Facts",
                  body: "Claude context.",
                  provenance: "agent-fragments",
                  targetAgents: ["claude"],
                },
                {
                  kind: "worker_briefing_fragment",
                  id: "shared-briefing",
                  title: "Shared Briefing",
                  body: "Shared briefing.",
                  provenance: "agent-fragments",
                },
              ],
            },
          ],
        },
        { activeAgents: ["codex"] },
      ),
    ).toMatchObject({
      context: [
        {
          id: "codex-facts",
        },
      ],
      briefing: [
        {
          id: "shared-briefing",
        },
      ],
    });
  });
});
