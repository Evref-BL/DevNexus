import { describe, expect, it } from "vitest";
import {
  NexusVersionPlanningConfigError,
  validateNexusVersionPlanningConfig,
} from "./nexusVersionPlanningConfig.js";
import { validateProjectConfig } from "./nexusProjectConfig.js";

const componentIds = new Set(["dev-nexus", "dev-nexus-pharo"]);

describe("version planning config", () => {
  it("normalizes valid version planning config deterministically", () => {
    const config = validateNexusVersionPlanningConfig(
      {
        versions: [
          {
            id: "0.2.0",
            objective: "Ship read-only version planning.",
            owningComponents: ["dev-nexus", "dev-nexus-pharo"],
            targetBranch: "main",
            scope: [
              {
                kind: "work_item",
                status: "committed",
                componentId: "dev-nexus",
                workItemId: "local-167",
              },
              {
                kind: "label",
                status: "candidate",
                componentId: "dev-nexus",
                label: "version-planning",
              },
              {
                kind: "milestone",
                status: "stretch",
                componentId: "dev-nexus-pharo",
                milestone: "0.2.0",
              },
              {
                kind: "tracker_query",
                status: "deferred",
                componentId: "dev-nexus",
                trackerId: "github",
                query: {
                  provider: "github",
                  text: "label:version-planning is:open",
                  statuses: ["ready", "in_progress"],
                  labels: ["version-planning"],
                  milestones: ["0.2.0"],
                },
              },
            ],
            readinessGates: [
              {
                kind: "work_items_done",
                components: ["dev-nexus"],
              },
              {
                kind: "checks_green",
                components: ["dev-nexus", "dev-nexus-pharo"],
                checkNames: ["Node 24 check (ubuntu-latest)"],
              },
              {
                kind: "release_authority",
                required: false,
              },
            ],
            releasePolicy: {
              tags: "manual",
              packages: "none",
              providerRelease: "none",
              releaseNotes: "required",
              changelog: "optional",
            },
          },
        ],
      },
      {
        componentIds,
        pathName: "workspace config.versionPlanning",
      },
    );

    expect(config).toMatchInlineSnapshot(`
      {
        "versions": [
          {
            "id": "0.2.0",
            "objective": "Ship read-only version planning.",
            "owningComponents": [
              "dev-nexus",
              "dev-nexus-pharo",
            ],
            "readinessGates": [
              {
                "components": [
                  "dev-nexus",
                ],
                "kind": "work_items_done",
                "required": true,
              },
              {
                "checkNames": [
                  "Node 24 check (ubuntu-latest)",
                ],
                "components": [
                  "dev-nexus",
                  "dev-nexus-pharo",
                ],
                "kind": "checks_green",
                "required": true,
              },
              {
                "components": [],
                "kind": "release_authority",
                "required": false,
              },
            ],
            "releasePolicy": {
              "changelog": "optional",
              "packages": "none",
              "providerRelease": "none",
              "releaseNotes": "required",
              "tags": "manual",
            },
            "scope": [
              {
                "componentId": "dev-nexus",
                "kind": "work_item",
                "status": "committed",
                "trackerId": null,
                "workItemId": "local-167",
              },
              {
                "componentId": "dev-nexus",
                "kind": "label",
                "label": "version-planning",
                "status": "candidate",
                "trackerId": null,
              },
              {
                "componentId": "dev-nexus-pharo",
                "kind": "milestone",
                "milestone": "0.2.0",
                "status": "stretch",
                "trackerId": null,
              },
              {
                "componentId": "dev-nexus",
                "kind": "tracker_query",
                "query": {
                  "assignees": [],
                  "labels": [
                    "version-planning",
                  ],
                  "milestones": [
                    "0.2.0",
                  ],
                  "provider": "github",
                  "statuses": [
                    "ready",
                    "in_progress",
                  ],
                  "text": "label:version-planning is:open",
                },
                "status": "deferred",
                "trackerId": "github",
              },
            ],
            "targetBranch": "main",
          },
        ],
      }
    `);
    expect(JSON.stringify(config)).toBe(JSON.stringify(
      validateNexusVersionPlanningConfig(config, { componentIds }),
    ));
  });

  it("validates version planning inside workspace config", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "versioned-project",
      name: "Versioned Project",
      components: [
        {
          id: "dev-nexus",
          kind: "git",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
        },
      ],
      versionPlanning: {
        versions: [
          {
            id: "0.2.0",
            objective: "Dogfood version planning.",
            owningComponents: ["dev-nexus"],
            targetBranch: "main",
            scope: [
              {
                kind: "label",
                status: "committed",
                componentId: "dev-nexus",
                label: "version-planning",
              },
            ],
          },
        ],
      },
    });

    expect(config.versionPlanning?.versions[0]).toMatchObject({
      id: "0.2.0",
      targetBranch: "main",
      releasePolicy: {
        tags: "none",
        packages: "none",
        providerRelease: "none",
      },
    });
  });

  it("reports invalid scope status diagnostics", () => {
    expect(() =>
      validateNexusVersionPlanningConfig(
        {
          versions: [
            {
              id: "0.2.0",
              objective: "Invalid scope.",
              owningComponents: ["dev-nexus"],
              targetBranch: "main",
              scope: [
                {
                  kind: "work_item",
                  status: "active",
                  componentId: "dev-nexus",
                  workItemId: "local-1",
                },
              ],
            },
          ],
        },
        { componentIds },
      ),
    ).toThrow(
      /versionPlanning\.versions\[0\]\.scope\[0\]\.status must be committed, candidate, stretch, deferred, or excluded/,
    );
  });

  it("reports missing component references", () => {
    expect(() =>
      validateNexusVersionPlanningConfig(
        {
          versions: [
            {
              id: "0.2.0",
              objective: "Missing component.",
              owningComponents: ["missing"],
              targetBranch: "main",
              scope: [],
            },
          ],
        },
        { componentIds },
      ),
    ).toThrow(
      /versionPlanning\.versions\[0\]\.owningComponents\[0\] references unknown component: missing/,
    );
  });

  it("reports invalid readiness gates", () => {
    expect(() =>
      validateNexusVersionPlanningConfig(
        {
          versions: [
            {
              id: "0.2.0",
              objective: "Invalid gate.",
              owningComponents: ["dev-nexus"],
              targetBranch: "main",
              scope: [],
              readinessGates: [{ kind: "all_the_things" }],
            },
          ],
        },
        { componentIds },
      ),
    ).toThrow(
      /versionPlanning\.versions\[0\]\.readinessGates\[0\]\.kind must be work_items_done, no_blockers, checks_green, docs_ready, migration_ready, or release_authority/,
    );
  });

  it("reports unsupported release policy fields", () => {
    expect(() =>
      validateNexusVersionPlanningConfig(
        {
          versions: [
            {
              id: "0.2.0",
              objective: "Unsupported release field.",
              owningComponents: ["dev-nexus"],
              targetBranch: "main",
              scope: [],
              releasePolicy: {
                tags: "manual",
                automaticTagging: true,
              },
            },
          ],
        },
        { componentIds },
      ),
    ).toThrow(
      /versionPlanning\.versions\[0\]\.releasePolicy\.automaticTagging is not supported/,
    );
  });

  it("does not accept release automation policy values", () => {
    expect(() =>
      validateNexusVersionPlanningConfig(
        {
          versions: [
            {
              id: "0.2.0",
              objective: "Automated release.",
              owningComponents: ["dev-nexus"],
              targetBranch: "main",
              scope: [],
              releasePolicy: {
                tags: "automated",
              },
            },
          ],
        },
        { componentIds },
      ),
    ).toThrow(NexusVersionPlanningConfigError);
  });
});
