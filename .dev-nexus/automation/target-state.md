# DevNexus Dogfood Target State

Current target: keep the clean DevNexus dogfood project current, reproducible,
and ready for coordinator-driven work across its components.

## Current State

- The latest completed DevNexus source batches published to main through the
  `bot` remote include `dev-nexus:local-67` as `ce9b7d2` for duplicate
  explicit target-cycle id rejection, `dev-nexus:local-97` as `ff981bc` for
  worktree-first parallel chat documentation, `dev-nexus:local-79` as
  `4ca4362` for host-local and remote-host registry overlays,
  `dev-nexus:local-76` as `90e1b18` plus `baace6a` for deterministic
  full-suite Windows verification, `dev-nexus:local-80` as `69fad6f` for runner
  profile safety policy, `dev-nexus:local-112` as `0cf0571` for plugin MCP
  overlap guardrails, and `dev-nexus:local-48` as `dfaf1ca` for mocked
  one-way work-item sync execution.
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
- Windows and Mac bot publication paths are authenticated for the current
  dogfood flow. Agent-created Git/GitHub activity must continue to use the
  configured `bot` remotes and `Gabot-Darbot` automation profile.
- Fresh Mac onboarding has been remediated for the advertised MCP surface.
  Local source-linked CLIs expose `dev-nexus`, `dev-nexus-pharo`, and `plexus`;
  direct `tools/list` probes pass for `dev_nexus`, `dev_nexus_pharo`,
  `plexus_project`, `pharo_launcher`, `route_control`, and `gateway`. The
  project-local PLexus gateway is pinned to `127.0.0.1:17576` and reports
  operational-but-idle because no Pharo images are declared for this project.
- Cleanup work `dev-nexus:local-68` is complete.
- Local stale `codex/*` branches in DevNexus, DevNexus-Pharo, and PLexus have
  been pruned after verifying they were merged or superseded by completed work
  items.
- Mocked one-way local-to-GitHub sync execution is complete in
  `dev-nexus:local-48`; `dev-nexus:local-51` is ready for multi-tracker
  migration/configuration documentation.
- Remote host execution PRD slicing is complete. `dev-nexus:local-77` created
  `dev-nexus:local-79` through `local-86`, `dev-nexus-pharo:local-14`, and
  `plexus:local-23`; `local-79` and `local-80` are complete, and `local-81` is
  ready for durable request/result records.
- Default `npm run check` now passes on the integrated DevNexus main with 53
  test files and 418 tests after `dev-nexus:local-76` replaced slow
  coordination Git-fixture tests and stabilized the Windows process shim wait.
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
  `local-103`. `local-97` is complete; ready slices are `local-99` for
  advisory worktree leases and `local-102` for cleanup dry-run safety
  classification. Publication and provider mutation gating stay with the
  authority items `local-91` and `local-92`.
- `docs/agent-target-projection-opt-in-prd.md` records the decision that
  provider-native MCP, skills, plugin, and worker projections should be
  generated only for active agent targets. `dev-nexus:local-104` tracks slicing
  and implementation. Current dogfood evidence: MCP is Codex-only, but
  `skills.agentTargets` still includes Claude, so `.claude/skills` is stale
  ignored support state for this Codex-only workflow.
- Agent-target projection opt-in has been sliced: start with
  `dev-nexus:local-105` for active target policy and compatibility
  normalization, then promote `local-106` through `local-111` as prerequisites
  land. Do not remove `.claude/skills` until stale-projection diagnostics and
  cleanup safety behavior are available, unless a separate manual cleanup is
  explicitly approved.
- DevNexus-Pharo MCP/plugin cleanup has completed source deletions
  `dev-nexus-pharo:local-15` through `local-19` and published commits
  `1ef5709`, `eb55b9c`, `c5f7a90`, `be1f866`, and `1dd2141` to
  DevNexus-Pharo main through the bot remote. `dev_nexus_pharo` now lists only
  six Pharo-owned `pharo_project_*` project/skill tools, has no default
  tool-name overlap with core `dev_nexus`, and no longer carries obsolete
  DevNexus-Pharo config migration paths.
- DevNexus core guardrail work `dev-nexus:local-112` is complete; core now
  rejects plugin MCP tool names that overlap `dev_nexus`.
- `docs/codex-architecture-design-audit-prd.md` records the Codex architecture
  audit. It keeps `codex exec` as the practical default while app-server
  support starts with current JSONL JSON-RPC-lite protocol compatibility,
  capability discovery, event routing, and provider session facts.
- The Codex app-server audit has been sliced into corrective DevNexus work:
  start with ready defect `dev-nexus:local-113` for stdio wire protocol
  compatibility, then follow with `local-114` through `local-116` for
  notification/server-request routing, safe capability probes, and provider
  session/turn facts.
- No active implementation subagents are expected.

## Near-Term Direction

- Run the next coordinator cycle on ready work such as `dev-nexus:local-51`,
  `dev-nexus:local-72`, `dev-nexus:local-78`, `dev-nexus:local-81`,
  `dev-nexus:local-87`, `dev-nexus:local-99`, `dev-nexus:local-102`,
  `dev-nexus:local-104`, and `dev-nexus:local-113`, subject to dependency and
  concurrency limits.
- Keep remote host execution ordered: implement `dev-nexus:local-81` before
  host checks, SSH transport, verification execution, or live dogfood smokes.
- Keep parallel-agent workflow ordered: implement documentation and read-only
  or advisory slices first (`local-97`, `local-99`, `local-102`), then promote
  shared-checkout enforcement, status expansion, start/adopt, and cleanup
  execution as their authority and lease dependencies land.
- Continue agent-target projection planning at `dev-nexus:local-104`; `local-111`
  is the dogfood Codex-only migration and should wait for active target
  filtering plus stale cleanup safety.
- Keep `dev-nexus:local-52` and live runtime items blocked until policy or
  runner approval is explicit.
- Complete `dev-nexus:local-72` before promoting `local-73` through
  `local-75`; resolve the full `local-69` umbrella before relying on Windows
  source roots as clean onboarding examples.
- Start Codex app-server correction with `dev-nexus:local-113` before any
  worker-thread orchestration, MCP relay expansion, or provider-native subagent
  features.

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
