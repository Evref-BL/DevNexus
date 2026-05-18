# DevNexus Dogfood Target State

Current target: use DevNexus to work on itself and related components until the
live plan is represented as component-owned work items, then advance eligible
work through the DevNexus agent-launch loop.

Current cycle:

- Run `coordinator-loop-20260518-t054231-514-z-1` completed on 2026-05-18.
- Selected `dev-nexus:local-50` as the only eligible dogfood item.
- Published verified DevNexus commit `7fdbe92` to `origin/main` for
  coordination tracker id/role targeting across status, handoff, integrate, and
  request flows.
- Closed `dev-nexus:local-50` as `done` with tracker comments.
- Target-cycle final record
  `target-cycle-coordinator-loop-20260518-t054231-514-z-1-final` records
  `completed` with current eligible count `0`.
- Post-cycle reflection found the tracker entry for `dev-nexus:local-50` still
  marked `in_progress` even though the result, target state, and comments all
  said it completed. The local tracker was reconciled to `done`, and
  `dev-nexus:local-65` now tracks hardening coordinator completion/status
  reconciliation.
- User-authorized PLexus cleanup `plexus:local-22` completed on 2026-05-18.
  PLexus commits `6d75f4f` and `840d9d3` were published to `origin/main`,
  removing legacy gateway compatibility concepts and leaving the clean
  `gateway` plus `route-control` surfaces.

Verification for this cycle:

- `npm test -- src/nexusCoordination.test.ts src/nexusCoordinationRequest.test.ts`
  passed in the `dev-nexus:local-50` worktree with 22 tests.
- `npm test -- src/cli.test.ts src/nexusMcpServer.test.ts` passed in the
  worktree with 52 tests.
- `npm test -- src/workItemService.test.ts src/workItemTrackerLinks.test.ts src/workTrackingProviderService.test.ts`
  passed in the worktree with 19 tests.
- `git diff --check` passed in the worktree before publication.
- `npm run check` passed in both the worktree and
  `C:\dev\code\sources\dev-nexus` main checkout with build plus 52 test files
  and 382 tests.
- `git diff --check origin/main..HEAD` passed in
  `C:\dev\code\sources\dev-nexus` before publication.
- PLexus cleanup verification passed: focused core/gateway tests,
  `npm run typecheck --workspaces`, `npm test`, `npm run build`,
  `npm run test:smoke-policy`, `git diff --check`, and a retired gateway
  terminology scan.

Near-term direction:

- Current ready dogfood eligible work after reflection is:
  `dev-nexus:local-47`, `dev-nexus:local-49`, and `dev-nexus:local-65`.
- `dev-nexus:local-47` is ready because tracker link records and tracker role
  targeting have landed. Keep it dry-run only with no provider mutation.
- `dev-nexus:local-49` is ready because tracker bindings and link records have
  landed. Keep it reporting/context only with no sync execution.
- `dev-nexus:local-65` is ready because the latest heartbeat exposed a concrete
  coordinator completion/status reconciliation gap.
- Keep `dev-nexus:local-48` parked until the dry-run planner in
  `dev-nexus:local-47` lands. Keep `dev-nexus:local-51` parked until the sync
  and status/reporting shape is stable. Live sync policy remains blocked on
  `dev-nexus:local-52`.
- Final PLexus legacy gateway support removal is no longer blocked; the
  authorized cleanup is complete and tracked by `plexus:local-22`.

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
