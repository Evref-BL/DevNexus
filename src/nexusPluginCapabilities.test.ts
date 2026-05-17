import { describe, expect, it } from "vitest";
import {
  projectPluginCapabilityProjections,
  projectPluginDependencyProjections,
  projectPluginWorkerFragments,
} from "./nexusPluginCapabilities.js";

describe("nexus plugin capability projections", () => {
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
});
