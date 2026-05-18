# DevNexus Dogfood Target State

Current target: use DevNexus to work on itself and related components until the
live plan is represented as component-owned work items, then advance eligible
work through the DevNexus agent-launch loop.

Current cycle:

- Follow-up issue `dev-nexus:local-66` completed on 2026-05-18.
- Published verified DevNexus commit `b0f2cfd` to `origin/main`:
  `Stream coordinator loop progress events`.
- The coordinator loop now supports `--progress-jsonl`, which streams
  low-volume progress events to `stderr` while preserving final `--json` output
  on `stdout`.
- Closed `dev-nexus:local-66` as `done` with tracker comments and target-cycle
  facts.
- `dev-nexus automation eligible-work . --json` reports `idle` with eligible
  count `0`.

Previous completed cycle:

- Run `coordinator-loop-20260518-t084038-156-z-1` completed on 2026-05-18.
- Selected the largest safe bounded batch from eligible DevNexus work:
  `dev-nexus:local-47`, `dev-nexus:local-49`, and `dev-nexus:local-65`.
- Ran `local-47` and `local-65` in parallel isolated worktrees, then integrated
  `local-49` reporting/context changes after those surfaces were settled.
- Published verified DevNexus commits to `origin/main`:
  - `04e4451` Add dry-run work item sync planner.
  - `0e1e580` Harden coordinator completion reconciliation.
  - `bf89471` Expose tracker context in automation status.
- Closed `dev-nexus:local-47`, `dev-nexus:local-49`, and `dev-nexus:local-65`
  as `done` with tracker comments.
- Target-cycle final record
  `target-cycle-coordinator-loop-20260518-t084038-156-z-1-final` records
  `completed`, per-item `completed` facts, selected tracker `default`, logical
  item ids, and current eligible count `0`.

Verification for this cycle:

- `npm test -- src/nexusAutomationCoordinatorLoop.test.ts src/cli.test.ts`
  passed in the `local-66` worktree.
- `npm run check` passed in the `local-66` worktree with build plus 53 test
  files and 394 tests.
- `npm run check` passed again in `C:\dev\code\sources\dev-nexus` after
  integration with build plus 53 test files and 394 tests.
- `git diff --check origin/main..HEAD` passed before publication.

Verification for the previous completed cycle:

- Focused integration tests passed:
  `npm test -- src/workItemSyncPlanner.test.ts src/cli.test.ts src/nexusMcpServer.test.ts src/nexusAutomationStatus.test.ts src/nexusAutomationAgentLaunch.test.ts src/nexusAutomationCoordinatorLoop.test.ts src/nexusAutomationTargetReport.test.ts src/nexusAutomationTargetCycle.test.ts`
  with 94 tests.
- Registry focused test passed:
  `npm test -- src/nexusProjectRegistry.test.ts` with 6 tests.
- `npm run build` passed.
- `npm run check` passed in `C:\dev\code\sources\dev-nexus` with build plus
  53 test files and 392 tests.
- `git diff --check origin/main..HEAD` passed before publication.

Near-term direction:

- Re-triage parked sync follow-ups before promotion:
  `dev-nexus:local-48`, `dev-nexus:local-51`, and `dev-nexus:local-52`.
  The dry-run planner has landed, but live sync remains policy-gated.
- Use the new coordinator completion reconciliation and stale in-progress
  reporting to catch mismatches between result files, target-cycle facts, and
  tracker state.
- Follow-up `dev-nexus:local-67` now tracks the target-cycle ledger idempotency
  gap: repeated `target-cycle record` calls currently append duplicate ids
  instead of rejecting or replacing them. Historical duplicates already exist in
  the ignored local ledger, so the item starts as `todo` pending a policy choice
  for reject versus upsert behavior.

Active boundaries:

- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation. Vibe may only be inspected as a tracker/system of record when
  a component explicitly configures it.
- Preserve unrelated changes in component working trees.
- Live Pharo images, PLexus open/close, Docker launches, package installs, and
  destructive runtime cleanup require an approved isolated runner profile.
- Live external provider posting remains policy-gated unless a work item
  records explicit approval.

Known operational notes:

- The generic DevNexus MCP config entry exists, but this Windows Codex session
  still lacks a visible `mcp__dev_nexus` namespace. Use the project-local
  DevNexus CLI until that provider-session issue is isolated.
- The heartbeat `devnexus-dogfood-heartbeat` is a temporary wake-up bridge. It
  should invoke `dev-nexus automation coordinator-loop . --max-ticks 1
  --max-runs 1 --json` and let DevNexus decide wait, launch, stop, completion,
  blocked, and failed outcomes.
