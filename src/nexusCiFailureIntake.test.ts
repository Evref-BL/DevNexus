import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./cli.js";
import {
  planNexusCiFailureIntake,
  type NexusCiFailureIntakePolicy,
  type NexusCiFailureReplay,
} from "./nexusCiFailureIntake.js";

const now = "2026-05-20T03:25:00.000Z";

const policy: NexusCiFailureIntakePolicy = {
  allowed: {
    repositories: [{ owner: "Evref-BL", name: "DevNexus" }],
    branches: ["main", "codex/dev-nexus/local-166-ci-failure-intake"],
    workflows: ["Node 24 check"],
    events: ["pull_request", "workflow_run"],
    checkNames: ["Node 24 check (ubuntu-latest)"],
  },
  workItem: {
    componentId: "dev-nexus",
    trackerId: "local",
    status: "ready",
    labels: ["dogfood", "ci", "github", "automation", "intake"],
    titlePrefix: "CI failure",
  },
  dedupe: {
    suppressRepeatWithinMinutes: 45,
  },
  wakeup: {
    enabled: true,
    requireEligible: true,
    eligibleStatuses: ["ready"],
    requiredLabels: ["dogfood"],
    excludeLabels: ["blocked", "unsafe-live-runtime"],
  },
};

const failure: NexusCiFailureReplay = {
  repository: { owner: "Evref-BL", name: "DevNexus" },
  event: "pull_request",
  runId: "26130000000",
  runUrl: "https://github.com/Evref-BL/DevNexus/actions/runs/26130000000",
  workflowName: "Node 24 check",
  checkName: "Node 24 check (ubuntu-latest)",
  jobName: "Node 24 check (ubuntu-latest)",
  headSha: "abcdef1234567890",
  headBranch: "codex/dev-nexus/local-166-ci-failure-intake",
  conclusion: "failure",
  failureSummary: "src/nexusCiFailureIntake.test.ts failed on ubuntu-latest",
  pullRequests: [
    {
      number: 21,
      url: "https://github.com/Evref-BL/DevNexus/pull/21",
    },
  ],
};

describe("CI failure intake planning", () => {
  it("maps an allowed GitHub Actions failure to a deduped work item and coordinator wakeup", () => {
    const plan = planNexusCiFailureIntake({
      policy,
      failure,
      now,
      existingWorkItems: [],
    });

    expect(plan.accepted).toBe(true);
    expect(plan.action.kind).toBe("create");
    expect(plan.action.workItem).toMatchObject({
      componentId: "dev-nexus",
      trackerId: "local",
      status: "ready",
      title:
        "CI failure: Node 24 check / Node 24 check (ubuntu-latest) on codex/dev-nexus/local-166-ci-failure-intake",
      labels: expect.arrayContaining([
        "dogfood",
        "ci",
        "github",
        "automation",
        "intake",
      ]),
    });
    expect(plan.action.workItem?.description).toContain(
      "CI-Failure-Dedupe-Key: github-actions:Evref-BL/DevNexus:abcdef1234567890:Node 24 check:Node 24 check (ubuntu-latest)",
    );
    expect(plan.action.workItem?.description).toContain(
      "Run: https://github.com/Evref-BL/DevNexus/actions/runs/26130000000",
    );
    expect(plan.action.workItem?.description).toContain(
      "Pull Request: #21 https://github.com/Evref-BL/DevNexus/pull/21",
    );
    expect(plan.wakeup).toMatchObject({
      shouldWake: true,
      reason: "planned work item is eligible for coordinator wakeup",
    });
  });

  it("filters failures outside allowed repository, branch, workflow, event, or check", () => {
    const plan = planNexusCiFailureIntake({
      policy,
      failure: {
        ...failure,
        repository: { owner: "SomeoneElse", name: "OtherRepo" },
        event: "schedule",
        workflowName: "Release",
        checkName: "Release",
        jobName: "Release",
        headBranch: "unconfigured",
      },
      now,
      existingWorkItems: [],
    });

    expect(plan.accepted).toBe(false);
    expect(plan.action.kind).toBe("none");
    expect(plan.blockers).toEqual([
      'repository "SomeoneElse/OtherRepo" is not allowed',
      'branch "unconfigured" is not allowed',
      'workflow "Release" is not allowed',
      'event "schedule" is not allowed',
      'check "Release" is not allowed',
    ]);
    expect(plan.wakeup.shouldWake).toBe(false);
  });

  it("suppresses repeat failures inside the dedupe backoff window", () => {
    const first = planNexusCiFailureIntake({
      policy,
      failure,
      now,
      existingWorkItems: [],
    });
    const repeated = planNexusCiFailureIntake({
      policy,
      failure: {
        ...failure,
        runId: "26130000001",
        runUrl: "https://github.com/Evref-BL/DevNexus/actions/runs/26130000001",
      },
      now: "2026-05-20T03:45:00.000Z",
      existingWorkItems: [
        {
          id: "local-200",
          title: first.action.workItem!.title,
          description: first.action.workItem!.description,
          status: "ready",
          labels: first.action.workItem!.labels,
          updatedAt: now,
        },
      ],
    });

    expect(repeated.action).toMatchObject({
      kind: "suppress",
      existingWorkItemId: "local-200",
      reason: "repeat failure suppressed until 2026-05-20T04:10:00.000Z",
    });
    expect(repeated.wakeup).toMatchObject({
      shouldWake: false,
      reason: "repeat failure suppressed until 2026-05-20T04:10:00.000Z",
    });
  });

  it("updates the existing deduped work item after backoff expires", () => {
    const first = planNexusCiFailureIntake({
      policy,
      failure,
      now,
      existingWorkItems: [],
    });
    const update = planNexusCiFailureIntake({
      policy,
      failure: {
        ...failure,
        runId: "26130099999",
        runUrl: "https://github.com/Evref-BL/DevNexus/actions/runs/26130099999",
        failureSummary: "windows-latest timed out",
      },
      now: "2026-05-20T04:15:00.000Z",
      existingWorkItems: [
        {
          id: "local-200",
          title: first.action.workItem!.title,
          description: first.action.workItem!.description,
          status: "ready",
          labels: first.action.workItem!.labels,
          updatedAt: now,
        },
      ],
    });

    expect(update.action.kind).toBe("update");
    expect(update.action.existingWorkItemId).toBe("local-200");
    expect(update.action.workItem?.description).toContain(
      "Run: https://github.com/Evref-BL/DevNexus/actions/runs/26130099999",
    );
    expect(update.action.workItem?.description).toContain(
      "Failure Summary: windows-latest timed out",
    );
    expect(update.wakeup.shouldWake).toBe(true);
  });

  it("keeps wakeups disabled when the planned item is not selector-eligible", () => {
    const plan = planNexusCiFailureIntake({
      policy: {
        ...policy,
        workItem: {
          ...policy.workItem,
          status: "todo",
        },
      },
      failure,
      now,
      existingWorkItems: [],
    });

    expect(plan.action.kind).toBe("create");
    expect(plan.wakeup).toMatchObject({
      shouldWake: false,
      reason: 'planned work item status "todo" is not eligible',
    });
  });
});

describe("CI failure intake CLI", () => {
  it("prints a dry-run plan from a manual replay file", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-nexus-ci-intake-"));
    const inputPath = path.join(tempDir, "failure.json");
    fs.writeFileSync(
      inputPath,
      JSON.stringify({ policy, failure, existingWorkItems: [], now }),
    );
    const output = captureOutput();

    await expect(
      main(
        [
          "ci-failure-intake",
          "plan",
          tempDir,
          "--input",
          inputPath,
          "--json",
        ],
        { stdout: output.writer },
      ),
    ).resolves.toBe(0);

    const payload = JSON.parse(output.output()) as {
      ok: boolean;
      plan: ReturnType<typeof planNexusCiFailureIntake>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.plan.action.kind).toBe("create");
    expect(payload.plan.wakeup.shouldWake).toBe(true);
  });
});

function captureOutput() {
  let buffer = "";
  return {
    writer: {
      write(chunk: string | Uint8Array) {
        buffer += String(chunk);
        return true;
      },
    },
    output() {
      return buffer;
    },
  };
}
