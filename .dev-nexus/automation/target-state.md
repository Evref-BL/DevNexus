# DevNexus Dogfood Target State

Current target: keep the clean DevNexus dogfood project current, reproducible,
and ready for coordinator-driven work across its components.

## Live State

- The dogfood project uses GitHub Issues as the primary shared tracker for
  configured components. Local tracker stores are archive/history only.
- PLexus and pharo-launcher-mcp are present as manual-only dependency
  components for explicit coordination, packaging, publication, and security
  maintenance. They are not `eligible_source` trackers for heartbeat work.
- Open local `ready`, `todo`, and `blocked` work was one-way synced to GitHub
  on 2026-05-20 and linked in `.dev-nexus/work-item-links.json`. Completed
  local history was not fully backfilled.
- DevNexus source `main` is synced through PR #73 / merge commit `7c7ae9f`,
  which includes the UTF-16 CLI JSON input fix.
- Dogfood metadata `main` is synced through PR #19 / merge commit `79b3407`,
  which refreshed local archive statuses for GitHub #50 and #55.
- The active automation selector is `status:ready` plus `dogfood`, excluding
  `blocked` and `unsafe-live-runtime`.
- Current eligible-work discovery reports no matching work item. Open GitHub
  issues still exist, but they are `todo`, `blocked`, missing `dogfood`, or
  excluded by safety labels.
- The project-local DevNexus CLI is the source-current fallback when the active
  MCP runtime reports a stale process.

## Current Decisions

- Agent-created Git/GitHub activity must use the configured `Gabot-Darbot`
  automation identity and `bot` remotes unless the user explicitly says
  otherwise.
- Component source publication uses green-main policy: branch/PR validation,
  required Node 24 checks on Ubuntu, Windows, and macOS, and authorized merge
  only after checks are green.
- Provider-native GitHub issues are the work items of record. Do not copy new
  provider-native issues into local tracker state unless a policy-gated import
  explicitly requires it.
- PLexus and pharo-launcher-mcp default to provider-native GitHub issue
  trackers when explicitly selected, while their normal implementation backlog
  remains in the sibling `dev-nexus-plexus` project.
- Local tracker refresh from GitHub should use inbound import
  (`work-item import-plan/import-execute`) with creates skipped unless the user
  explicitly asks to backfill local archive items.
- PRDs and audit documents under `docs/` are design/history artifacts. Use
  `docs/README.md` as the index and load individual PRDs only when the selected
  work item or current question names them directly.
- Routine quick fixes do not need dogfood metadata PRs unless project
  configuration, policy, plan, target state, or durable coordination facts
  changed.

## Active Blockers

- No work is currently eligible for the heartbeat selector. A human or
  coordinator must promote a dependency-satisfied issue to `status:ready`, or
  explicitly choose work outside the selector.
- Several remaining items are blocked on human policy decisions, especially
  live runtime/remote-host policy, advanced authority/self-approval policy,
  DevNexus-Research license posture, and sync/mirroring policy.
- Windows source roots still use host-local external checkouts. Treat the
  source-root migration issues as the path to clean project-local component
  clones.
- Provider-native coordination remains incomplete enough that GitHub comments
  and GitHub issues should be treated as the durable human-visible record when
  coordination handoff readback is unavailable.

## Next Direction

- Keep this file concise. Do not append completed cycle narratives; derive
  history from target cycles, run ledgers, GitHub issues, PRs, and commits.
- Re-check eligible work after any issue status/label changes.
- Prefer small, explicit mode choices:
  - quick manual fix for one provider-native issue;
  - explicit PLexus or pharo-launcher-mcp maintenance such as npm publishing
    setup;
  - heartbeat batch for ready dogfood work;
  - project-meta cleanup for context, docs, target state, tracker archives, and
    generated support;
  - source worktree for component source changes.
- Continue context hygiene by archiving or indexing historical docs rather than
  loading all PRDs as live context.

## Boundaries

- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation.
- Do not treat PLexus or pharo-launcher-mcp as automatic heartbeat development
  components.
- Do not run live Pharo images, PLexus open/close, Docker, package installs, or
  destructive host cleanup without a current approved isolated runner profile.
- Preserve unrelated changes in component working trees.
- Use isolated project-meta worktrees for project-state mutations from
  interactive chats.
