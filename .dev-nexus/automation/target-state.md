# DevNexus Dogfood Target State

Current target: keep the clean DevNexus dogfood project current, reproducible,
and ready for coordinator-driven work across its components.

## Current State

- The latest completed source work is `dev-nexus:local-71`, merged into
  DevNexus main as `b4aa3af` from PR
  https://github.com/Evref-BL/DevNexus/pull/2. It added the
  `componentsRoot:` portable path base for project-local component clones.
- The dogfood meta-project now records GitHub hosting remotes and automation
  publication actors explicitly: human manual work uses `origin`, while
  agent-created Git/GitHub activity uses the `bot` remote and
  `Gabot-Darbot` machine-user profile. Direct-integration components also use
  component `bot` remotes for publication.
- User policy as of 2026-05-18: agents may integrate verified dogfood
  component work into main without waiting for manual human review, using the
  configured bot/automation profile when permissions allow. Components that
  still have an explicit non-integration publication policy must be configured
  before automation treats them as direct-integration targets.
- Reusable DevNexus support for join-existing auth checks and portable
  `GH_CONFIG_DIR` resolution is proposed as
  https://github.com/Evref-BL/DevNexus/pull/1 because the bot account has read
  but not direct write access to `Evref-BL/DevNexus`.
- Windows automation publication is intentionally blocked until the host-local
  bot GitHub CLI profile is authenticated at
  `home:.config/gh-automation-github`; the Mac bot profile is authenticated.
- Fresh Mac onboarding showed the project was synced and ready for non-live
  coordinator work. Generic `dev_nexus` and `dev_nexus_pharo` stdio MCP
  `tools/list` probes worked, but PLexus-backed MCP lacked the `plexus`
  command on `PATH` and direct Pharo HTTP MCP was not live.
- Cleanup work `dev-nexus:local-68` is complete.
- Local stale `codex/*` branches in DevNexus, DevNexus-Pharo, and PLexus have
  been pruned after verifying they were merged or superseded by completed work
  items.
- Re-triage promoted `dev-nexus:local-48` and `dev-nexus:local-67` to `ready`.
  `local-48` remains mocked/local-provider only with no live external writes.
  `local-67` should reject duplicate explicit target-cycle ids with an
  actionable non-interactive error.
- Remote host execution PRD slicing is complete. `dev-nexus:local-77` created
  `dev-nexus:local-79` through `local-86`, `dev-nexus-pharo:local-14`, and
  `plexus:local-23`; `dev-nexus:local-79` is the first ready source slice.
- Verification for `local-71` found that default `npm run check` repeatedly
  times out in an existing full-suite coordination test under parallel load.
  `dev-nexus:local-76` tracks stabilizing that check; focused tests and a
  serialized full test run passed on the `local-71` branch.
- `dev-nexus:local-78` tracks the policy layer behind the user's integration
  decision: project/component/provider-specific agent roles such as maintainer,
  contributor, reviewer, and observer should determine whether an agent may
  push, open PRs, approve, merge, or only hand off.
- `docs/coordination-roles-authority-prd.md` now captures the PRD for
  `dev-nexus:local-78` and is attached to the work item through a local
  DevNexus comment.
- The authority PRD has been sliced: start with `dev-nexus:local-87` for the
  actor/role/action configuration model, then promote dependent slices
  `local-88` through `local-94` as their prerequisites land. `local-95` is a
  blocked HITL decision item for self-approval, temporary elevation, and
  advanced role-policy questions.
- Parallel-agent Git workflow slicing is complete. `dev-nexus:local-96`
  recorded the authority cross-check and created `local-97` through
  `local-103`. Ready slices are `local-97` for authority-aware worktree-first
  docs, `local-99` for advisory worktree leases, and `local-102` for cleanup
  dry-run safety classification. Publication and provider mutation gating stay
  with the authority items `local-91` and `local-92`.
- No active implementation subagents are expected.

## Near-Term Direction

- Run the next coordinator cycle on ready work such as `dev-nexus:local-48`,
  `dev-nexus:local-67`, `dev-nexus:local-72`, `dev-nexus:local-76`, and
  `dev-nexus:local-78`/`local-79` if they remain ready.
- Keep remote host execution ordered: implement `dev-nexus:local-79` before
  runner profiles, request/result records, SSH transport, or live dogfood
  smokes.
- Keep parallel-agent workflow ordered: implement documentation and read-only
  or advisory slices first (`local-97`, `local-99`, `local-102`), then promote
  shared-checkout enforcement, status expansion, start/adopt, and cleanup
  execution as their authority and lease dependencies land.
- Revisit `dev-nexus:local-51` after the sync execution shape from
  `dev-nexus:local-48` lands.
- Keep `dev-nexus:local-52` and live runtime items blocked until policy or
  runner approval is explicit.
- Complete `dev-nexus:local-72` before promoting `local-73` through
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
