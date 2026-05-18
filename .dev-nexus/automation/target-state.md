# DevNexus Dogfood Target State

Current target: use DevNexus to work on itself and related components until the
live plan is represented as component-owned work items, then advance eligible
work through the DevNexus agent-launch loop.

Current cycle:

- Run `coordinator-loop-20260518-t041042-357-z-1` completed on 2026-05-18.
- Selected all three eligible `dev-nexus` work items and ran them in separate
  component worktrees under profile `codex-5-5-xhigh`.
- Published verified DevNexus commits to `origin/main`:
  - `a5ccde4` for `dev-nexus:local-34`, Codex app-server launch facts,
    result-contract validation, target-cycle notes, and target-report facts.
  - `9069ae6` for `dev-nexus:local-36`, operator guidance for `codex exec`,
    current-agent adoption, and Codex app-server profiles.
  - `d66a1d7` for `dev-nexus:local-45`, explicit tracker selection and
    tracker reference metadata for work-item service, CLI, and MCP operations.
- Closed `dev-nexus:local-34`, `dev-nexus:local-36`, and
  `dev-nexus:local-45` as `done` with tracker comments.
- Target-cycle final record
  `target-cycle-coordinator-loop-20260518-t041042-357-z-1-final` records
  `completed` with current eligible count `0`.
- Follow-up reflection promoted three dependency-unblocked items for the next
  coordinator-loop:
  - `dev-nexus:local-35`, optional Codex app-server MCP relay, now that
    app-server launch and target-cycle fact recording are stable.
  - `dev-nexus:local-46`, neutral work-item tracker link records, now that
    tracker registry and explicit tracker selection landed.
  - `dev-nexus:local-50`, coordination tools targeting configured tracker
    roles, using local or mocked providers only.
- `automation target-report` should relaunch while those three ready `dogfood`
  selector items remain.

Verification for this cycle:

- `npm test -- src/nexusAutomationCodexAppServerLaunch.test.ts src/nexusAutomationAgentLaunch.test.ts src/nexusAutomationCoordinatorLoop.test.ts src/nexusAutomationTargetReport.test.ts src/nexusAutomationTargetCycle.test.ts`
  passed in `C:\dev\code\sources\dev-nexus`.
- `npm test -- src/workItemService.test.ts src/cli.test.ts src/nexusMcpServer.test.ts`
  passed in `C:\dev\code\sources\dev-nexus`.
- `git diff --check origin/main..HEAD` passed before publication.
- `npm run check` passed in `C:\dev\code\sources\dev-nexus`.

Near-term direction:

- Next coordinator-loop should choose from `dev-nexus:local-35`,
  `dev-nexus:local-46`, and `dev-nexus:local-50`, respecting overlapping
  DevNexus write scopes.
- Keep `dev-nexus:local-47`, `dev-nexus:local-48`, `dev-nexus:local-49`, and
  `dev-nexus:local-51` parked until link records or later sync/coordination
  shape land. Live sync policy remains blocked on `dev-nexus:local-52`.
- Final PLexus legacy gateway support removal remains human-in-the-loop and
  must not be performed without a separate explicit decision.

Active boundaries:

- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation. Vibe may only be inspected as a tracker/system of record when
  a component explicitly configures it.
- Preserve unrelated changes in component working trees.
- Live Pharo images, PLexus open/close, Docker launches, package installs, and
  destructive runtime cleanup require an approved isolated runner profile.
- Live external provider posting remains policy-gated unless a work item records
  explicit approval.

Known operational notes:

- The generic DevNexus MCP config entry exists, but this Windows Codex session
  still lacks a visible `mcp__dev_nexus` namespace. Use the project-local
  DevNexus CLI until that provider-session issue is isolated.
- The heartbeat `devnexus-dogfood-heartbeat` is a temporary wake-up bridge. It
  should invoke `dev-nexus automation coordinator-loop . --max-ticks 1
  --max-runs 1 --json` and let DevNexus decide wait, launch, stop, completion,
  blocked, and failed outcomes.
