# DevNexus Dogfood Target State

Current target: keep the clean DevNexus dogfood project current, reproducible,
and ready for coordinator-driven work across its components.

## Current State

- The latest completed source work is `dev-nexus:local-66`, published as
  DevNexus commit `b0f2cfd` with `automation coordinator-loop --progress-jsonl`.
- Cleanup work `dev-nexus:local-68` is complete.
- Re-triage promoted `dev-nexus:local-48` and `dev-nexus:local-67` to `ready`.
  `local-48` remains mocked/local-provider only with no live external writes.
  `local-67` should reject duplicate explicit target-cycle ids with an
  actionable non-interactive error.
- No active implementation subagents are expected.

## Near-Term Direction

- Run the next coordinator cycle on `dev-nexus:local-48` and
  `dev-nexus:local-67`.
- Revisit `dev-nexus:local-51` after the sync execution shape from
  `dev-nexus:local-48` lands.
- Keep `dev-nexus:local-52` and live runtime items blocked until policy or
  runner approval is explicit.
- Resolve `dev-nexus:local-69` before relying on Windows source roots as clean
  onboarding examples.

## Boundaries

- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation.
- Do not run live Pharo images, PLexus open/close, Docker, package installs, or
  destructive host cleanup without a current approved isolated runner profile.
- Preserve component source roots and source branches unless a work item
  explicitly owns their migration or deletion.
- The generic DevNexus MCP entry may still be configured but not visible in the
  active Codex tool namespace; use the project-local DevNexus CLI until that
  provider-session issue is resolved.
