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

## Next Work Candidates

- Promote and implement `dev-nexus:local-48` when one-way local-to-GitHub sync
  execution can stay mocked and policy-gated.
- Implement `dev-nexus:local-67` to clarify duplicate target-cycle record
  behavior.
- Implement `dev-nexus:local-79` as the first remote-host execution slice before
  runner profiles, request/result records, SSH transport, or live dogfood
  smokes.
- Promote `dev-nexus:local-51` after the multi-tracker implementation shape is
  stable enough for user-facing migration documentation.
- Resolve `dev-nexus:local-69` before treating Windows source roots as clean
  production examples.
- Keep live-runtime Pharo and PLexus work blocked until an isolated runner
  profile is current and explicit.

## Boundaries

- Do not create Vibe workspaces, sessions, executions, or implementation
  workers from this dogfood root.
- Do not run live images, PLexus open/close, Docker, package installs, process
  kills, image deletion, or destructive host cleanup without a current approved
  isolated runner and cleanup plan.
- Preserve unrelated changes in component working trees.
- Prefer DevNexus CLI/MCP surfaces for project state, work items, target facts,
  setup, and coordination.
