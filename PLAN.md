# DevNexus Dogfood Plan

This file is the durable handoff from the older staging project into this clean
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
- DevNexus supports additive plugins. Plugins are loaded into a DevNexus
  project to contribute capabilities, setup policy, skills, MCP wiring, and
  component-specific agent affordances. Plugins do not replace DevNexus and do
  not choose or supervise implementation work.
- DevNexus projects are multi-component by default. Component arity one is
  only the smallest normal case, not a special architecture.
- Each component can have its own source root, generated worktree root,
  work tracker, verification policy, publication policy, and relationships.
- Work trackers are component-level systems of record, such as local work
  items, GitHub Issues, GitHub Projects, GitLab Issues, Jira, or Vibe Kanban.
- DevNexus should expose a simple agent-facing MCP and CLI surface so agents
  spend fewer tokens discovering project state, eligible work, target progress,
  and publication expectations.

## Plugin Direction

Plugins should compose inside one DevNexus project. For example, a project may
load a Pharo plugin and a TypeScript plugin at the same time, with each plugin
contributing only the tools and setup policy needed for its domain.

DevNexus-Pharo is the Pharo plugin for DevNexus. It should supply Pharo-specific
agent setup rather than act as an alternate project runner. In particular,
DevNexus-Pharo should prepare scoped PLexus project context for subagents, project
the MCP configuration they need, expose safe scoped launcher operations, and
route image-side Pharo MCP calls through the PLexus gateway.

The intended Pharo agent setup is:

- DevNexus remains the generic project, target, work-item, agent-profile, and
  relaunch infrastructure.
- DevNexus-Pharo contributes the Pharo plugin manifest, setup hooks, skills, and
  MCP projection needed by Pharo work.
- PLexus supplies scoped project/workspace/image lifecycle and gateway routing
  capabilities for those Pharo agents.
- pharo-launcher-mcp supplies launcher-owned image and VM operations, without
  DevNexus, DevNexus-Pharo, or PLexus policy.
- MCP-Pharo supplies the image-side Pharo MCP server. Agents working on
  MCP-Pharo should use the Pharo MCP directly, not edit Smalltalk source files
  from disk as a substitute for image-side work.

## Shared Coordination Direction

Mac and Windows agents should be able to work in parallel using Git worktrees
and branches without hard locks. The shared source of truth should be work-item
intent, structured handoffs, pushed branches, and explicit integration records.

The agent-facing coordination API should stay deliberately small:

- `coordination_status` reports current host/worktree/branch state, related
  active work, unpushed commits, stale handoffs, and likely next action.
- `coordination_handoff` records the current agent's branch, commits, changed
  areas, decisions, verification, and intended merge direction with minimal
  user-authored input.
- `coordination_integrate` fetches related branches, forecasts conflicts,
  reads handoff decisions, and produces an integration plan before any
  configured mutation.
- `coordination_request` asks external humans or agents for approval, feedback,
  a choice, or review through configured provider surfaces, then tracks and
  summarizes the response.

The tool should infer as much as possible from Git, the DevNexus component
graph, target cycle facts, and the shared work tracker. Tailscale may expose a
private DevNexus coordination MCP between machines, but durable coordination
must live in Git remotes and the shared tracker so either machine can go
offline.

External coordination should use provider-native systems such as GitHub Issues,
GitHub pull requests, GitLab issues or merge requests, Jira issues, and review
comments. DevNexus should keep the generic API neutral and let provider
adapters handle where questions are posted, how responses are read, and how
states such as waiting, approved, changes requested, answered, timed out, or
blocked are mapped.

See `docs/shared-multi-host-coordination-prd.md` for the feature plan.

## Dependency Direction

Keep project knowledge flowing downward:

- `pharo-launcher-mcp` knows only about its own launcher MCP contract and Pharo
  Launcher behavior. It must not mention DevNexus, DevNexus-Pharo, PLexus, or Pharo
  MCP project policy.
- `mcp-pharo` knows only about its own Pharo image-side MCP server. It must not
  mention DevNexus, DevNexus-Pharo, PLexus, or pharo-launcher-mcp policy.
- `plexus` may know about `pharo-launcher-mcp` and the Pharo MCP contract,
  because it scopes launcher operations and routes image MCP calls. It must not
  depend on DevNexus or DevNexus-Pharo concepts.
- `dev-nexus-pharo` may know about DevNexus, PLexus, pharo-launcher-mcp, and Pharo
  MCP because it is the DevNexus plugin that composes them for Pharo work.
- DevNexus remains generic and must not contain plugin-specific source, docs,
  or comments.

## Current Dogfood Project

Project root:

```text
C:\dev\code\dev-nexus-dogfood
```

This project is intentionally separate from the historical staging roots. The
old roots remain useful historical evidence, but this root is the clean dogfood
context for new targets.

Configured components:

- `dev-nexus`: generic core and primary component.
- `dev-nexus-pharo`: Pharo plugin for DevNexus.
- `plexus`: runtime gateway dependency for the Pharo plugin.
- `pharo-launcher-mcp`: launcher-side MCP dependency.
- `mcp-pharo`: in-image MCP dependency.

Current component publication state:

- DevNexus is clean and pushed to `origin/main` through `af0b300` (`Add
  managed coordinator loop`).
- DevNexus-Pharo is clean and pushed to `origin/main` through `ec14934`
  (`Bundle MCP-Pharo domain skills`); the GitHub repository has been renamed to
  `Evref-BL/DevNexus-Pharo`.
- PLexus is clean and pushed to `origin/main` through `a616dd4` (`Merge PLexus
  portability coverage`).
- pharo-launcher-mcp is clean and pushed to `origin/main` through `8a8b5eb`
  (`Detach Pharo image launches`).
- MCP-Pharo is clean and aligned with `origin/main` through `faef856`
  (`Stabilize Pharo 13 repository tests`).

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
  surfaces. Generic DevNexus workflows should not depend on a plugin adapter.
- DevNexus project configs support `components[]` with source roots,
  relationships, per-component work trackers, verification hints, publication
  hints, and generated worktree roots.
- Work-item operations are component-aware through CLI/MCP selectors.
- Target state, target cycles, target reports, agent launch records, and the
  agent result-file contract exist.
- Agent launch mode can use a configured coordinator profile. The current
  Codex profile uses the user-local Codex binary because the Windows app alias
  is not executable from this shell.
- The cron scheduler command and dogfood MCP projection should use the
  user-local Codex Node executable directly. A plain `node` alias can resolve
  to an inaccessible app package runtime, and the previous Winget-managed Node
  path returned access denied from the scheduler shell.
- Codex standalone cron shells can be more restricted than the interactive
  coordinator thread. DevNexus should support a current-agent coordinator
  adoption flow so an already-running agent can use DevNexus launch context,
  target-cycle facts, result contracts, and subagent cap policy without
  spawning a nested model process.
- DevNexus now has a managed `automation coordinator-loop` foundation. Host
  schedulers should wake that loop rather than deciding work directly. The
  separate current-agent adoption contract remains tracked by
  `dev-nexus:local-29`.
- DevNexus MCP work-item tools support component-qualified ids such as
  `dev-nexus:local-27`, selecting the component work tracker before provider
  lookup so agents do not need CLI fallbacks for component-local work items.
- DevNexus-Pharo now bundles MCP-Pharo domain skills for Pharo-capable
  subagents, with provenance back to MCP-Pharo and plugin projected-skill
  capabilities for worker context.
- Target reports now expose relaunch decisions from durable target/run facts.

## Next Target Direction

Use the curated `to-issues` skill to split this plan into the next
component-owned work-item batch. Do not keep relying on chat history or the old
control handoff. The next batch should be larger than a token step, but still
bounded enough that verification and publication can complete cleanly.

Priority candidates:

1. Add the generic DevNexus plugin capability/projection contract so multiple
   plugins can contribute agent setup without replacing DevNexus or supervising
   work.
2. Make DevNexus-Pharo an explicit DevNexus plugin that provisions scoped PLexus
   project context, safe launcher affordances, gateway routes, and image-side
   Pharo MCP access for subagents.
3. Add the PLexus scoped project/image context needed by plugins, while keeping
   live image create/start/stop/delete behind the approved isolated runner
   boundary.
4. Verify that a subagent in a component worktree receives direct Pharo MCP
   access through DevNexus-Pharo-provided setup before resuming MCP-Pharo source
   items.
5. Add shared multi-host coordination status and handoff records so Mac and
   Windows agents can publish current branch intent without hard locks.
6. Add shared coordination integration planning so either host can merge with
   visibility into the other host's current design direction.
7. Add external coordination requests so agents can ask provider-backed
   humans/agents for approval, feedback, review, or choices and then continue
   from durable responses.
8. MCP-Pharo has moved to `main`; keep new MCP-Pharo review handoffs and
   automatic loads aligned with `origin/main`.
9. Split the remaining DevNexus plan into component-owned local work items,
   with each item carrying readiness, blocker, acceptance, verification, and
   publication notes.
10. Implement coordinator/subagent dispatch semantics so a coordinator can
   launch one subagent per selected work item, obey a configured subagent cap,
   and keep work-item progress visible.
11. Add or harden DevNexus worktree-parallel support for multi-component
   targets, including component-scoped generated worktrees and clear ownership
   records.
12. Improve target observability and final reporting so DevNexus can produce a
   factual JSON report for target completion, active blockers, per-component
   progress, commits, verification, and publication decisions.
13. Improve the generic MCP/CLI surface for agent use: simple project status,
   target report, eligible work listing, work-item update/comment, cycle
   record, and agent profile inspection should be obvious and low-token.
14. Expand work tracker support beyond the local provider when needed:
   GitHub Issues, GitHub Projects, GitLab Issues, Jira, and Vibe Kanban should
   all map to neutral component work items without forcing one project equals
   one repository.
15. Harden agent profile configuration for Codex and Claude, including model,
   version, reasoning or intelligence level, sandbox/safety policy, and
   per-target subagent caps.
16. Before live PLexus, launcher, Docker, or image work, define and approve the
   isolated runner, disposable image/runtime boundary, timeout budget, artifact
   retention, process ownership, cleanup sequence, and failure policy.
17. Once the dogfood loop is reliable, create a fresh production-quality
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
- Keep DevNexus generic. Plugin-specific behavior belongs in plugin components
  or their dependencies.
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
