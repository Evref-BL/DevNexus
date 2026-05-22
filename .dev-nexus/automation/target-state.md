# DevNexus Dogfood Target State

Current target: keep the clean DevNexus dogfood workspace current, reproducible,
and ready for coordinator-driven work across its components.

## Live State

- The dogfood workspace uses GitHub Issues as the primary shared tracker for
  configured components. Local tracker stores are archive/history only.
- PLexus and pharo-launcher-mcp are present as manual-only dependency
  components for explicit coordination, packaging, publication, and security
  maintenance. They are not `eligible_source` trackers for heartbeat work.
- Open local `ready`, `todo`, and `blocked` work was one-way synced to GitHub
  on 2026-05-20 and linked in `.dev-nexus/work-item-links.json`. Completed
  local history was not fully backfilled.
- DevNexus source `main` is synced through PR #126 / merge commit `eba69df`,
  which includes the coordination handoff guard recovery fix.
- Dogfood metadata `main` is synced through PR #19 / merge commit `79b3407`,
  which refreshed local archive statuses for GitHub #50 and #55.
- The active automation selector is `status:ready`, excluding `blocked` and
  `unsafe-live-runtime`; it does not require a public dogfood label.
- The primary DevNexus component has a publication-train policy for the active
  version-planning scope. It defaults candidate work to smoke-first CI and
  budgets full matrix CI by time or change count.
- Re-run eligible-work discovery after selector or issue-status changes before
  assuming the heartbeat queue is empty.
- DevNexus runtime projection policy is source-current: fresh shells should use
  the refreshed global `dev-nexus` command built from
  `/Users/gabriel.darbord/dev-nexus/sources/dev-nexus`, while generated MCP
  config should pin the active CLI script path from `workspace mcp refresh`
  instead of inheriting stale global `dev-nexus mcp-stdio` behavior.
- The DevNexus Automation GitHub App installation token is available for
  Evref-BL component repositories such as `Evref-BL/DevNexus`.

## Current Decisions

- Agent-created GitHub activity for Evref-BL repositories must use the
  DevNexus Automation GitHub App installation identity
  (`devnexus-automation[bot]`) through the host-local App profile and
  installation-token helper. Do not silently fall back to `Gabriel-Darbord`
  user tokens or the former `Gabot-Darbot` machine-user identity for autonomous
  push/PR publication.
- App-backed branch push and PR creation are the dogfood default for
  agent-created review handoffs. If App installation auth is unavailable, block
  and record the auth problem instead of publishing through a personal account.
- Component source publication uses green-main policy: branch/PR validation,
  required Node 24 checks on Ubuntu, Windows, and macOS, and authorized merge
  only after checks are green.
- Human maintainers, normally `Gabriel-Darbord`, retain manual merge authority
  after PR validation. Agents should stop at PR/handoff unless explicitly
  instructed to perform a merge action.
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
- Routine quick fixes do not need dogfood metadata PRs unless workspace
  configuration, policy, plan, target state, or durable coordination facts
  changed.

## Active Blockers

- Heartbeat selection needs a fresh eligible-work check after selector or
  issue-status changes; do not assume public dogfood labels are required.
- Several remaining items are blocked on human policy decisions, especially
  live runtime/remote-host policy, advanced authority/self-approval policy,
  DevNexus-Research license posture, and sync/mirroring policy.
- Windows source roots still use host-local external checkouts. Treat the
  source-root migration issues as the path to clean workspace-local component
  clones.
- Provider-native coordination remains incomplete enough that GitHub comments
  and GitHub issues should be treated as the durable human-visible record when
  coordination handoff readback is unavailable.
- DevNexus MCP authority or credential brokering may still misreport App actor
  readiness. Treat that as an auth/tooling blocker; use the App
  installation-token path when explicitly available, but do not substitute a
  personal GitHub App user token for agent-created publication.
- The DevNexus Automation GitHub App is not currently installed on
  `Gabot-Darbot/dev-nexus-dogfood`; dogfood metadata branch/PR publication by
  the App is blocked until that installation exists. Do not use a personal
  account as a silent fallback for dogfood metadata publication.

## Next Direction

- Keep this file concise. Do not append completed cycle narratives; derive
  history from target cycles, run ledgers, GitHub issues, PRs, and commits.
- Re-check eligible work after any issue status/label changes.
- Prefer small, explicit mode choices:
  - quick manual fix for one provider-native issue;
  - explicit PLexus or pharo-launcher-mcp maintenance such as npm publishing
    setup;
  - heartbeat batch for ready dogfood work;
  - workspace/meta cleanup for context, docs, target state, tracker archives, and
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
- Use isolated workspace/meta worktrees for workspace-state mutations from
  interactive chats.
