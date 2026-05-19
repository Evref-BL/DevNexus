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
  mirrored trackers, neutral link records, dry-run sync planning, policy-gated
  one-way sync, explicit discovery sources, and inbound provider issue import.
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
- Non-engineering plugin expansion: DevNexus-Research should prove DevNexus can
  support academic research and writing workflows through additive skills,
  setup checks, artifact conventions, integrity gates, and human checkpoints,
  without making DevNexus core academic-domain-specific.
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

- Continue remote-host execution after the durable `dev-nexus:local-81`
  request/result record model; keep host checks, SSH transport, and live
  verification execution ordered behind explicit runner policy.
- Continue parallel-agent workflow with the fail-closed mutation guard
  `dev-nexus:local-98`; cleanup/read-only slice `dev-nexus:local-102` is
  complete, authority status summaries now exist through `local-90`, and status
  expansion `local-100` can be reconsidered with the newer authority context.
- Continue Codex app-server correction after completed `dev-nexus:local-115`
  safe initialize probes; keep provider-native worker orchestration behind the
  remaining app-server event and capability facts.
- Continue authority configuration after completed `dev-nexus:local-92`
  coordination and provider mutation gating. `local-93` and `local-94` are the
  next authority follow-ons for provider approval/branch-policy signals and
  role documentation; `local-94` has a verified branch ready, but integration
  is held by the current automation auth-profile/provider mismatch.
- Continue agent-target projection after completed `dev-nexus:local-106`
  active-target filtering. `local-107` stale projection diagnostics now has a
  verified branch ready, but integration is held by the same authority/profile
  mismatch as `local-94`; `local-109` worker context propagation is the next
  independent implementation slice after integration. Cleanup and dogfood
  migration remain later.
- Continue DevNexus-Research from `docs/dev-nexus-research-plugin-prd.md`.
  `dev-nexus:local-146` is the blocked human-in-the-loop license and upstream
  ARS integration posture decision; `local-147` is ready for an original
  DevNexus-Research plugin skeleton. Promote `local-148` through `local-151`
  after the skeleton and relevant setup/artifact prerequisites land.
- Cross-tracker discovery and inbound GitHub-to-local import are sliced:
  `dev-nexus:local-129` is complete for tracker roles and discovery-policy
  defaults, and `local-130` is complete for read-only discovery status.
  `local-131` is complete for opt-in eligible-work aggregation, `local-132`
  is complete for linked-item deduplication, `local-133` is complete for
  inbound import planning, and `local-134` is complete for policy-gated import
  execution. `local-135` and `local-136` are ready next.
  `local-137` is the blocked HITL policy decision for direct external
  selection, provider comments, scheduler import, and ordering.
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
