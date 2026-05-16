# DevNexus Dogfood Target State

Current target: use DevNexus to work on itself and related components until the
live plan is represented as component-owned work items, and then use the
DevNexus agent-launch loop to advance eligible work.

Immediate direction:

- The forward plan has been handed into this clean dogfood project as
  `PLAN.md`. New cycles should use that file instead of relying on chat memory
  or the older PharoNexus-Control handoff.
- New ready work item `dev-nexus:local-5` should use the curated `to-issues`
  skill to split `PLAN.md` into the next component-owned work-item batch.
- `dev-nexus:local-3` has been corrected to `done`; its implementation was
  already published as `1863d04` and had a completion comment.

- The seeded local work-item stores have been refined with component ownership,
  acceptance criteria, readiness labels, blockers, and safe verification notes.
- DevNexus core result-file contract hardening and component worktree guidance
  were implemented and published as `95cec72`.
- DevNexus core target-report/relaunch readiness was completed and published as
  `1863d04`; focused target-report/CLI/MCP tests and the full check are green.
- PharoNexus specialization alignment was completed and published as `c6629df`;
  the adapter now delegates DevNexus automation target/report and neutral
  work-item tools to native DevNexus MCP surfaces.
- Runtime/image boundary planning is complete:
  - PLexus isolated live-smoke runner boundary was documented and published as
    `916e1d5`.
  - pharo-launcher-mcp cleanup hook boundary was documented and published as
    `1f3070b`.
  - MCP-Pharo static/live verification boundary was documented as local
    review-handoff commit `0a38755` on `develop`.
- The first seeded dogfood target completed, but the transferred-plan handoff
  intentionally creates one new `ready` + `dogfood` planning item so the next
  cycle can split the current plan from durable local state.
- Remaining runtime dogfood work is intentionally blocked live-runtime
  follow-up work:
  - `plexus:local-2` run the approved isolated PLexus live-smoke.
  - `mcp-pharo:local-2` run MCP-Pharo verification through the isolated runner.
- Next direction requires human approval of the isolated runner inputs,
  timeout budget, cleanup sequence, retained artifacts, and failure policy
  before any live image/runtime verification is enabled.

Active boundaries:

- Do not run live Pharo images, PLexus open/close, Docker launches, destructive
  Git cleanup, package installs, or privileged host mutation without an
  explicit isolated runner and cleanup plan.
- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation.
- Preserve unrelated changes in component working trees.
