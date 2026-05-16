import { describe, expect, it } from "vitest";
import { projectPluginWorkerFragments } from "./nexusPluginCapabilities.js";

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
