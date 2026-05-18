# DevNexus Dogfood Target State

Current target: use DevNexus to work on itself and related components until the
live plan is represented as component-owned work items, then advance eligible
work through the DevNexus agent-launch loop.

Current cycle:

- Run `coordinator-loop-20260518-t051011-392-z-1` completed on 2026-05-18.
- Selected `dev-nexus:local-35` and `dev-nexus:local-46` as the safe bounded
  parallel batch. Left `dev-nexus:local-50` ready for the next cycle because it
  builds on link records and overlaps coordination tracker-role surfaces.
- Published verified DevNexus commits to `origin/main`:
  - `5aa008f` for `dev-nexus:local-35`, optional Codex app-server MCP status
    listing/checking and bounded MCP tool relay with mocked protocol coverage.
  - `9ae0a41` for `dev-nexus:local-46`, neutral work-item tracker link
    records plus CLI and MCP link/show/unlink surfaces.
- Closed `dev-nexus:local-35` and `dev-nexus:local-46` as `done` with tracker
  comments.
- Target-cycle final record
  `target-cycle-coordinator-loop-20260518-t051011-392-z-1-final` records
  `completed` with current eligible count `1`.

Verification for this cycle:

- `npm test -- src/codexAppServerMcpRelay.test.ts src/codexAppServerCapabilityAdapter.test.ts src/nexusAutomationCodexAppServerLaunch.test.ts src/workItemTrackerLinks.test.ts src/workItemService.test.ts src/cli.test.ts src/nexusMcpServer.test.ts`
  passed in `C:\dev\code\sources\dev-nexus` with 7 test files and 86 tests.
- `git diff --check origin/main..HEAD` passed before publication.
- `npm run check` passed in `C:\dev\code\sources\dev-nexus` with build plus
  52 test files and 379 tests.

Near-term direction:

- Next coordinator-loop should pick up `dev-nexus:local-50`, coordination tools
  targeting configured tracker roles, now that neutral link records exist.
- Keep `dev-nexus:local-47`, `dev-nexus:local-48`, `dev-nexus:local-49`, and
  `dev-nexus:local-51` parked until later sync or coordination shape lands.
  Live sync policy remains blocked on `dev-nexus:local-52`.
- Final PLexus legacy gateway support removal remains human-in-the-loop and
  must not be performed without a separate explicit decision.

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
