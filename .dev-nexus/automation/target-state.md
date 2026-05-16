# DevNexus Dogfood Target State

Current target: use DevNexus to work on itself and related components until the
live plan is represented as component-owned work items, and then use the
DevNexus agent-launch loop to advance eligible work.

Immediate direction:

- The seeded local work-item stores have been refined with component ownership,
  acceptance criteria, readiness labels, blockers, and safe verification notes.
- DevNexus core result-file contract hardening and component worktree guidance
  were implemented and published as `95cec72`.
- DevNexus core target-report/relaunch readiness was completed and published as
  `1863d04`; focused target-report/CLI/MCP tests and the full check are green.
- Next safe implementation work is the PharoNexus specialization alignment
  item.
- Runtime and image work stays planning-only until the isolated runner,
  disposable runtime boundary, and cleanup plan are explicit.

Active boundaries:

- Do not run live Pharo images, PLexus open/close, Docker launches, destructive
  Git cleanup, package installs, or privileged host mutation without an
  explicit isolated runner and cleanup plan.
- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation.
- Preserve unrelated changes in component working trees.
