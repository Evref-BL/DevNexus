# DevNexus Dogfood Plan

This plan is the durable project direction for the clean dogfood root. It should
stay concise and current; completed cycle details belong in work items,
target-cycle facts, commits, and the target report.

## Product Direction

- DevNexus is infrastructure for project metadata, components, work trackers,
  target/run facts, worktree metadata, verification, publication, skills,
  Model Context Protocol (MCP) wiring, and agent launch policy.
- DevNexus does not choose, plan, or supervise implementation work. A human or a
  coordinator agent does that work and reports facts back to DevNexus.
- DevNexus projects are multi-component by default. Each component can have its
  own source root, generated worktree root, tracker, verification policy,
  publication policy, and relationships.
- Plugins compose into one DevNexus project. Plugins contribute setup policy,
  skills, MCP wiring, and domain affordances without replacing DevNexus.
- Work trackers are component-level systems of record. Local stores are used for
  immediate dogfooding; GitHub, GitLab, Jira, GitHub Projects, and Vibe Kanban
  remain provider options through neutral work-item APIs.

## Active Themes

- Multi-tracker work tracking: local primary trackers, optional shared or
  mirrored trackers, neutral link records, dry-run sync planning, and
  policy-gated one-way sync.
- Shared multi-host coordination: Mac and Windows agents coordinate through
  work-item intent, Git branches, structured handoffs, integration planning, and
  provider-backed approval or feedback requests.
- Parallel interactive chats: default mutating work to isolated worktrees,
  record advisory leases and handoffs, keep shared checkouts read-mostly, and
  serialize cleanup/integration through authority-aware guardrails.
- Remote host execution: trusted Mac, Windows, and Linux hosts can eventually
  run bounded verification requests through capability-based runner profiles,
  with Tailscale/SSH as an initial transport and DevNexus as the durable
  request/result owner.
- Codex app-server support: optional executor/thread provider for ephemeral
  workers, while retaining `codex exec` where it is simpler.
- Plugin projection: DevNexus-Pharo and DevNexus-TypeScript should set up
  workers with domain tools and skills without leaking plugin concepts into
  DevNexus core.
- DevNexus-Pharo MCP cleanup: delegated generic DevNexus MCP tools, generic
  tracker wrappers, generic worktree compatibility tools, remaining MCP naming
  overlap, and old config migration paths have been removed. DevNexus core now
  rejects plugin MCP tool names that overlap core `dev_nexus` tools.
- Project hygiene: keep this dogfood root free of old staging artifacts,
  obsolete local runtime profiles, and stale completed-cycle narration.

## Dependency Direction

- `pharo-launcher-mcp` owns only launcher MCP and Pharo Launcher behavior.
- `mcp-pharo` owns only the image-side Pharo MCP server.
- `plexus` may know about launcher and image-side MCP contracts because it
  scopes runtime lifecycle and routes Pharo MCP calls.
- `dev-nexus-pharo` may know about DevNexus, PLexus, pharo-launcher-mcp, and
  MCP-Pharo because it composes them as a DevNexus plugin.
- `dev-nexus-typescript` may know about DevNexus and JavaScript/TypeScript
  setup policy.
- `dev-nexus` remains generic and must not contain plugin-specific behavior.
- Direct PLexus, pharo-launcher-mcp, and MCP-Pharo work items are owned by the
  sibling `dev-nexus-plexus` DevNexus project, not this dogfood root.

## Next Work Candidates

- Continue remote-host execution with `dev-nexus:local-81` for durable
  request/result records after host registry and runner profile policy landed.
- Continue parallel-agent workflow after completed cleanup/read-only slice
  `dev-nexus:local-102`; keep status expansion `local-100` dependent until
  authority status summaries exist.
- Continue Codex app-server correction with `dev-nexus:local-114` notification
  and server-request routing or `dev-nexus:local-115` safe initialize probes.
- Continue authority configuration at `dev-nexus:local-87` before promoting
  dependent authority slices.
- Continue agent-target projection planning at `dev-nexus:local-104`, then
  implement the active target policy slices beginning with `local-105`.
- Resolve `dev-nexus:local-69` before treating Windows source roots as clean
  production examples.
- Keep live-runtime Pharo and PLexus work in the `dev-nexus-plexus` project and
  blocked there until an isolated runner profile is current and explicit.

## Boundaries

- Do not create Vibe workspaces, sessions, executions, or implementation
  workers from this dogfood root.
- Do not run live images, PLexus open/close, Docker, package installs, process
  kills, image deletion, or destructive host cleanup without a current approved
  isolated runner and cleanup plan.
- Preserve unrelated changes in component working trees.
- Prefer DevNexus CLI/MCP surfaces for project state, work items, target facts,
  setup, and coordination.
