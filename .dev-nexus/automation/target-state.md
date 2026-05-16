# DevNexus Dogfood Target State

Current target: use DevNexus to work on itself and related components until the
live plan is represented as component-owned work items, and then use the
DevNexus agent-launch loop to advance eligible work.

Immediate direction:

- `dev-nexus:local-5` split `PLAN.md` into component-owned local work items
  using the curated `to-issues` skill. New work items include readiness,
  blocker, acceptance, verification, and publication notes.
- The next eligible ready dogfood batch is DevNexus core:
  - `dev-nexus:local-6` coordinator subagent dispatch progress surfaces.
  - `dev-nexus:local-7` component-scoped parallel worktree records.
  - `dev-nexus:local-8` component-aware target completion reporting.
  - `dev-nexus:local-9` low-token agent-facing status and eligible-work
    commands.
  - `dev-nexus:local-10` neutral work-tracker provider conformance.
  - `dev-nexus:local-11` Codex and Claude agent profile policy schema.
- The coordinator should choose the largest safe bounded subset of the ready
  DevNexus batch, respecting `DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS` when running
  under agent launch.
- Later or dependent non-eligible work:
  - `dev-nexus:local-12` production-quality project template after the dogfood
    loop is reliable.
  - `pharo-nexus:local-2` adapter alignment after new DevNexus coordination
    surfaces stabilize.
  - `pharo-launcher-mcp:local-2` launcher cleanup/status hook follow-up only
    after the approved runner harness identifies a concrete hook need.
- Human-in-the-loop blocked work:
  - `mcp-pharo:local-3` decide the publication path for local review-handoff
    commit `0a38755`.
  - `plexus:local-3` build the approved isolated PLexus live-smoke runner
    harness after runner inputs and cleanup policy are approved.
  - `plexus:local-2` run the approved isolated PLexus live-smoke.
  - `mcp-pharo:local-2` run MCP-Pharo verification through the approved
    isolated runner.

Durable completed foundation:

- DevNexus core result-file contract hardening and component worktree guidance
  were implemented and published as `95cec72`.
- DevNexus core target-report/relaunch readiness was completed and published as
  `1863d04`.
- PharoNexus specialization alignment was completed and published as `c6629df`.
- PLexus isolated live-smoke runner boundary was documented and published as
  `916e1d5`.
- pharo-launcher-mcp cleanup hook boundary was documented and published as
  `1f3070b`.
- MCP-Pharo static/live verification boundary was documented as local
  review-handoff commit `0a38755` on `develop`.

Active boundaries:

- Do not run live Pharo images, PLexus open/close, Docker launches, destructive
  Git cleanup, package installs, or privileged host mutation without an
  explicit isolated runner and cleanup plan.
- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation.
- Preserve unrelated changes in component working trees.
