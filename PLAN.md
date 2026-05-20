# DevNexus Dogfood Plan

This is the durable forward plan for the clean dogfood root. Keep it concise:
completed cycle details belong in GitHub issues, target-cycle facts, commits,
pull requests, and generated reports.

## Product Direction

- DevNexus is infrastructure for project metadata, components, work trackers,
  target/run facts, worktree metadata, verification, publication, skills, MCP
  wiring, and agent launch policy.
- DevNexus does not choose, plan, or supervise implementation work. A human or
  coordinator agent does that work and reports facts back to DevNexus.
- DevNexus projects are multi-component by default. Each component can have its
  own source root, generated worktree root, tracker, verification policy,
  publication policy, and relationships.
- Plugins compose into one DevNexus project. Plugins contribute setup policy,
  skills, MCP wiring, and domain affordances without replacing DevNexus.
- GitHub Issues is the dogfood default shared tracker. Local stores remain
  archive/history and migration source material.

## Active Themes

- Multi-tracker work tracking: GitHub primary trackers, local archive stores,
  neutral link records, dry-run planning, policy-gated sync/import, explicit
  discovery sources, and direct provider-native issue selection.
- Shared multi-host coordination: Mac and Windows agents coordinate through
  work-item intent, Git branches, structured handoffs, integration planning, and
  provider-backed approval or feedback requests.
- Parallel interactive chats: default mutating work to isolated worktrees,
  record advisory leases and handoffs, keep shared checkouts read-mostly, and
  serialize cleanup/integration through authority-aware guardrails.
- Remote host execution: trusted hosts can eventually run bounded verification
  requests through capability-based runner profiles, with Tailscale/SSH as an
  initial transport and DevNexus as the durable request/result owner.
- Codex app-server support: optional executor/thread provider for ephemeral
  workers, while retaining `codex exec` where it is simpler.
- Plugin projection: DevNexus-Pharo and DevNexus-TypeScript should set up
  workers with domain tools and skills without leaking plugin concepts into
  DevNexus core.
- DevNexus-Research: prove DevNexus can support research/writing workflows
  through additive skills, setup checks, artifact conventions, integrity gates,
  and human checkpoints.
- Project hygiene: keep this dogfood root free of obsolete staging artifacts,
  stale completed-cycle narration, and unclassified planning documents.

## Current Work Selection

- The automation selector is `status:ready` plus `dogfood`, excluding
  `blocked` and `unsafe-live-runtime`.
- Current GitHub discovery reports no eligible work item. Remaining visible
  dogfood issues are mostly `todo`, `blocked`, or dependency-gated.
- Before heartbeat work can resume automatically, a human or coordinator should
  promote one dependency-satisfied GitHub issue to `status:ready`, or explicitly
  choose a one-off quick-fix/investigation outside the selector.

## Near-Term Candidates

- Context and documentation hygiene: keep root context short, use
  `docs/README.md` as the PRD index, and avoid appending completed history to
  target state.
- Quick-fix workflow: make one provider-native issue runnable without full
  heartbeat bookkeeping when the user asks for a quick manual fix.
- Target-state compaction: implement a DevNexus command that proposes or
  applies concise target-state from durable facts.
- Green-main operations: continue improving CI failure classification, required
  check waiting, merge reporting, and risk-scaled verification.
- Parallel-agent workflow: continue status expansion, start/adopt flows, and
  cleanup execution behind existing authority and mutation guards.
- Agent-target projection: continue safe cleanup of stale generated provider
  support and dogfood migration to explicit Codex-only active targets.
- Remote-host execution: keep host checks, SSH transport, verification
  execution, and live smokes ordered behind completed request/result records and
  explicit runner policy.
- DevNexus-Research: keep license and ARS integration posture blocked until the
  user decides whether ARS is inspiration-only, optional external integration,
  or bundled/adapted content under an explicit license posture.
- Source-root migration: resolve the project-local component clone direction
  before presenting Windows source roots as clean onboarding examples.

## Boundaries

- Do not create Vibe workspaces, sessions, executions, or implementation
  workers from this dogfood root.
- Do not run live Pharo images, PLexus open/close, Docker, package installs,
  process kills, image deletion, or destructive host cleanup without a current
  approved isolated runner profile.
- Preserve component source roots and source branches unless a work item
  explicitly owns their migration or deletion.
- Prefer DevNexus CLI/MCP surfaces for project state, work items, target facts,
  setup, and coordination.
