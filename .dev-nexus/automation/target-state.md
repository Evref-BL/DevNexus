# DevNexus Dogfood Target State

Current target: keep the clean DevNexus dogfood project current, reproducible,
and ready for coordinator-driven work across its components.

## Current State

- The latest completed source work is `dev-nexus:local-70`, published as
  DevNexus commit `62610fe` with generic automation identity examples in setup
  guidance and tests.
- Cleanup work `dev-nexus:local-68` is complete.
- Local stale `codex/*` branches in DevNexus, DevNexus-Pharo, and PLexus have
  been pruned after verifying they were merged or superseded by completed work
  items.
- Re-triage promoted `dev-nexus:local-48` and `dev-nexus:local-67` to `ready`.
  `local-48` remains mocked/local-provider only with no live external writes.
  `local-67` should reject duplicate explicit target-cycle ids with an
  actionable non-interactive error.
- `dev-nexus:local-69` is now an umbrella for the project-local component
  source layout. It was split into `local-71` through `local-75`; only
  `local-71` is ready now so the path base lands before setup, diagnostics,
  docs, and dogfood migration slices.
- No active implementation subagents are expected.

## Near-Term Direction

- Run the next coordinator cycle on `dev-nexus:local-48`,
  `dev-nexus:local-67`, and `dev-nexus:local-71` if they remain ready.
- Revisit `dev-nexus:local-51` after the sync execution shape from
  `dev-nexus:local-48` lands.
- Keep `dev-nexus:local-52` and live runtime items blocked until policy or
  runner approval is explicit.
- Complete `dev-nexus:local-71` before promoting `local-72` through
  `local-75`; resolve the full `local-69` umbrella before relying on Windows
  source roots as clean onboarding examples.

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
