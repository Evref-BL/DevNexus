# DevNexus Dogfood Target State

Current target: use DevNexus to work on itself and related components until the
live plan is represented as component-owned work items, and then use the
DevNexus agent-launch loop to advance eligible work.

Immediate direction:

- Seed the initial local work-item stores from the live plan.
- Verify the native DevNexus MCP config and local Codex coordinator profile in
  this fresh project.
- Use the `to-issues` skill to refine the seeded plan into clear, bounded
  component-owned work items.
- Start with DevNexus core work that improves dogfooding reliability before
  touching live runtime/image boundaries.

Active boundaries:

- Do not run live Pharo images, PLexus open/close, Docker launches, destructive
  Git cleanup, package installs, or privileged host mutation without an
  explicit isolated runner and cleanup plan.
- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation.
- Preserve unrelated changes in component working trees.
