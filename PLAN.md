# DevNexus Dogfood Plan

This file is the durable handoff from the older
`C:\dev\code\pharo-nexus\PharoNexus-Control` staging project into this clean
DevNexus dogfood project. Future coordinator agents should treat this file,
`AGENTS.md`, `CONTEXT.md`, `dev-nexus.project.json`, and
`.dev-nexus/automation/target-state.md` as the local source of truth before
consulting older control-project notes.

## Product Direction

- DevNexus is infrastructure and schedule. It records project metadata,
  component graphs, work trackers, target/run facts, worktree metadata,
  verification records, publication decisions, skills, MCP configuration, and
  configured agent launch policy.
- DevNexus does not choose, plan, or supervise implementation work. A user
  does. The user can be a human, or an agent acting under human instruction.
- A coordinator agent launched by DevNexus chooses the work item or items,
  decides whether to launch subagents, chooses worktrees, supervises
  implementation, verifies results, and reports facts back to DevNexus.
- DevNexus may relaunch the configured coordinator while eligible work remains
  when the project target says to do so.
- DevNexus projects are multi-component by default. Component arity one is
  only the smallest normal case, not a special architecture.
- Each component can have its own source root, generated worktree root,
  work tracker, verification policy, publication policy, and relationships.
- Work trackers are component-level systems of record, such as local work
  items, GitHub Issues, GitHub Projects, GitLab Issues, Jira, or Vibe Kanban.
- DevNexus should expose a simple agent-facing MCP and CLI surface so agents
  spend fewer tokens discovering project state, eligible work, target progress,
  and publication expectations.

## Current Dogfood Project

Project root:

```text
C:\dev\code\dev-nexus-dogfood
```

This project is intentionally separate from the historical
`PharoNexus-Control` and `DevNexusProject` staging roots. The old roots remain
useful historical evidence, but this root is the clean dogfood context for new
targets.

Configured components:

- `dev-nexus`: generic core and primary component.
- `pharo-nexus`: specialization adapter over DevNexus.
- `plexus`: runtime gateway dependency for the specialization.
- `pharo-launcher-mcp`: launcher-side MCP dependency.
- `mcp-pharo`: in-image MCP dependency.

Current component publication state:

- DevNexus is clean and pushed to `origin/main` through `1863d04` (`Fix target
  report relaunch run ids`).
- PharoNexus is clean and pushed to `origin/main` through `c6629df` (`Align MCP
  adapter with DevNexus automation tools`).
- PLexus is clean and pushed to `origin/main` through `916e1d5` (`Document
  isolated live-smoke runner boundary`).
- pharo-launcher-mcp is clean and pushed to `origin/main` through `1f3070b`
  (`Document launcher cleanup hook boundary`).
- MCP-Pharo is clean but ahead of `origin/develop` by local review-handoff
  commit `0a38755` (`Document DevNexus verification boundary`).

The first seeded dogfood target completed through real user-local Codex launch
cycles. The target report reached `completed` with relaunch decision `stop`
because there were no remaining ready `dogfood` work items. Runtime/image
follow-ups remain blocked until an isolated runner is approved.

## Implemented Foundation

- Generic DevNexus package boundary and product vocabulary are established.
- Curated skills exist and include `grill-with-docs`, `to-issues`, and the
  locally renamed setup skill concept. Acronyms must be expanded on first use,
  including Product Requirements Document (PRD), Architecture Decision Record
  (ADR), human-in-the-loop (HITL), and autonomous agent-ready (AFK).
- Skill material is DevNexus-managed under `.dev-nexus/skills` and projected
  into agent-native targets such as `.agents/skills` for Codex and
  `.claude/skills` for Claude.
- Native DevNexus MCP exposes generic project/status/automation/work-item
  surfaces. Generic DevNexus workflows should not depend on the specialization
  adapter.
- DevNexus project configs support `components[]` with source roots,
  relationships, per-component work trackers, verification hints, publication
  hints, and generated worktree roots.
- Work-item operations are component-aware through CLI/MCP selectors.
- Target state, target cycles, target reports, agent launch records, and the
  agent result-file contract exist.
- Agent launch mode can use a configured coordinator profile. The current
  Codex profile uses the user-local Codex binary because the Windows app alias
  is not executable from this shell.
- Target reports now expose relaunch decisions from durable target/run facts.

## Next Target Direction

Use the curated `to-issues` skill to split this plan into the next
component-owned work-item batch. Do not keep relying on chat history or the old
control handoff. The next batch should be larger than a token step, but still
bounded enough that verification and publication can complete cleanly.

Priority candidates:

1. Decide MCP-Pharo publication path for `0a38755`: keep it as local review
   handoff, push a review branch, or publish it to `develop` after the needed
   review.
2. Split the remaining DevNexus plan into component-owned local work items,
   with each item carrying readiness, blocker, acceptance, verification, and
   publication notes.
3. Implement coordinator/subagent dispatch semantics so a coordinator can
   launch one subagent per selected work item, obey a configured subagent cap,
   and keep work-item progress visible.
4. Add or harden DevNexus worktree-parallel support for multi-component
   targets, including component-scoped generated worktrees and clear ownership
   records.
5. Improve target observability and final reporting so DevNexus can produce a
   factual JSON report for target completion, active blockers, per-component
   progress, commits, verification, and publication decisions.
6. Improve the generic MCP/CLI surface for agent use: simple project status,
   target report, eligible work listing, work-item update/comment, cycle
   record, and agent profile inspection should be obvious and low-token.
7. Expand work tracker support beyond the local provider when needed:
   GitHub Issues, GitHub Projects, GitLab Issues, Jira, and Vibe Kanban should
   all map to neutral component work items without forcing one project equals
   one repository.
8. Harden agent profile configuration for Codex and Claude, including model,
   version, reasoning or intelligence level, sandbox/safety policy, and
   per-target subagent caps.
9. Before live PLexus, launcher, Docker, or image work, define and approve the
   isolated runner, disposable image/runtime boundary, timeout budget, artifact
   retention, process ownership, cleanup sequence, and failure policy.
10. Once the dogfood loop is reliable, create a fresh production-quality
    DevNexus project shape from this evidence instead of carrying forward
    historical staging-project clutter.

## Boundaries

- Do not run live images, PLexus open/close, Docker, package installs, process
  kills, image deletion, destructive Git cleanup, or privileged host mutation
  without a documented isolated runner and explicit approval.
- Do not create Vibe Kanban workspaces, sessions, executions, or workers for
  implementation. Vibe can be inspected or updated only as a tracker/system of
  record when a component is configured for it.
- Preserve unrelated changes in every component working tree.
- Keep DevNexus generic. Specialization-specific behavior belongs in the
  specialization component or its dependencies.
- Prefer substantial bounded batches over tiny symbolic steps. A normal
  automated cycle should be allowed to spend meaningful time, roughly
  30-40 minutes when there is enough safe eligible work.

## Expected Coordinator Workflow

1. Read the project instructions, context, this plan, target state, component
   graph, and eligible work items.
2. Choose an ambitious bounded batch from eligible work across components.
3. For each selected item, advance the work-item state to in progress or leave
   a clear progress/blocker comment.
4. Use component-scoped worktrees or source roots according to the component
   publication policy and the current safety boundary.
5. Run focused verification first, then broader relevant checks when feasible.
6. Commit and push direct-integration components when policy allows. Leave
   review-handoff components local or on review branches according to policy.
7. Update work items, target cycles, target state, and the result JSON so the
   next relaunch can continue without chat memory.
