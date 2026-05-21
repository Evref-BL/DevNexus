# DevNexus Dogfood Context

## Purpose

This repository is the clean dogfood workspace repository for DevNexus. It stores the
portable workspace graph, component tracker bindings, archive data, planning
handoff, agent instructions, automation target state, generated setup support,
and lightweight workspace documentation used to work on DevNexus and related
components.

DevNexus is infrastructure. It records workspace state, components, work trackers,
target/run facts, worktree metadata, verification policy, publication policy,
skills, and Model Context Protocol (MCP) wiring. A human or coordinator agent
chooses implementation work.

## Components

- `dev-nexus`: generic core and primary component.
- `dev-nexus-pharo`: Pharo plugin for DevNexus.
- `dev-nexus-typescript`: TypeScript/JavaScript plugin for DevNexus.
- `plexus`: manual-only dependency component for PLexus runtime packaging,
  publishing, and coordination tasks.
- `pharo-launcher-mcp`: manual-only dependency component for launcher MCP
  packaging, publishing, and coordination tasks.

## Current Operating State

- Component work defaults to provider-native GitHub Issues through each
  component's `github` tracker.
- PLexus and pharo-launcher-mcp are configured as manual-only dependency
  components. Their GitHub trackers are the default explicit work-item services,
  but they are not marked `eligible_source`, so heartbeat discovery does not
  select their work automatically.
- Local work-item stores under `.dev-nexus/work-items/` are archive/history and
  migration material. They are not the default shared tracker for new work.
- Open local dogfood work was one-way synced to GitHub Issues on 2026-05-20.
  Link records live in `.dev-nexus/work-item-links.json`; completed local
  history was not fully backfilled into GitHub.
- Eligible-work discovery scans configured `primary` and `eligible_source`
  tracker roles and currently lands on GitHub for all configured components.
  The automation selector requires `status:ready`, excludes `blocked` and
  `unsafe-live-runtime`, and does not require a public dogfood label.
- After selector or issue-status changes, run eligible-work discovery before
  assuming the heartbeat queue is empty.
- The dogfood workspace repository records `origin` and `bot` remotes. Agent-created
  Git/GitHub activity must use the `Gabot-Darbot` automation identity via
  `GH_CONFIG_DIR=home:.config/gh-automation-github` and the `bot` remote unless
  the user explicitly says otherwise.
- Dogfood component publication uses green-main policy: branch or pull-request
  validation first, required Node 24 checks on Ubuntu, Windows, and macOS, then
  authorized merge after checks are green.
- The primary DevNexus component can opt into a publication train for the
  active version-planning scope. The train is intended to batch candidate
  changes and use smoke-first CI by default, with full matrix CI budgeted by
  time or change count.
- The active scheduler path is DevNexus `automation coordinator-loop`.
  Heartbeats may wake that loop, but DevNexus owns lock, backoff, run facts, and
  relaunch decisions.
- Current DevNexus runtime policy on this host: the shell `dev-nexus` command is
  refreshed from `/Users/gabriel.darbord/dev-nexus/sources/dev-nexus` for fresh
  terminal use, and generated MCP config should pin the active CLI script path
  produced by `dev-nexus workspace mcp refresh` instead of relying on a stale
  global `dev-nexus mcp-stdio` process.

## Decisions

- Plugins are additive DevNexus capabilities, not alternate workspace runners.
- DevNexus-Pharo supplies Pharo-specific setup, scoped PLexus context, launcher
  affordances, gateway routing, and image-side Pharo MCP access for Pharo work.
- DevNexus-TypeScript supplies TypeScript/JavaScript setup policy, especially
  reusable dependency projection for generated worktrees.
- PLexus and pharo-launcher-mcp implementation backlogs still belong in the
  sibling `dev-nexus-plexus` DevNexus workspace by default. This dogfood root may
  act on them explicitly for cross-workspace coordination, packaging, publication,
  and security maintenance when a human selects that work.
- MCP-Pharo implementation work remains owned by the sibling
  `dev-nexus-plexus` workspace unless explicitly authorized here.
- Mac and Windows agents coordinate through work-item intent, Git branches,
  structured handoffs, target-cycle facts, and provider-backed requests.
- Parallel interactive chats should use isolated worktrees for mutating work.
  Shared checkouts are read-mostly control rooms unless an agent explicitly owns
  integration or workspace-state mutation.
- DevNexus-controlled mutations fail closed before writing a shared workspace or
  component checkout. Writable worker surfaces need an owned worktree or an
  explicit bootstrap/integration classification.
- External coordination should use provider-native systems such as GitHub
  Issues, GitHub pull requests, GitLab, or Jira while DevNexus stores neutral
  request and response state.
- Live Pharo images, PLexus open/close, Docker, package installs, and
  destructive runtime cleanup require an approved isolated runner profile.

## Document Policy

- `docs/README.md` is the index for planning documents.
- PRDs are design snapshots. Keep them for rationale, vocabulary, and issue
  reconstruction, but do not load them by default.
- Current status belongs in GitHub issues, target cycles, run ledgers, PRs, and
  concise context files.
- Completed cycle narration should not be appended to this file. Use durable
  facts and reports for history.

## Active Cleanup Notes

- If DevNexus source integrations move ahead of the shell or MCP runtime, run
  `node /Users/gabriel.darbord/dev-nexus/sources/dev-nexus/dist/cli.js diagnostics cli-version-skew --installed-command dev-nexus --json`,
  rebuild the source, refresh the global install from that source checkout, and
  run `dev-nexus workspace mcp refresh <workspace-root>` so generated MCP config
  points at the current CLI script. Do not downgrade current workspace configs
  such as `automation.publication.strategy: "green_main"` to satisfy stale
  runtimes.
- Windows source roots still use host-local external checkouts. Treat
  `dev-nexus:local-69` / GitHub #29 and related source-root issues as the path
  to cleaner workspace-local component clones.
- Provider-native sync and coordination paths are improving but still need
  explicit policy care. Local archive refresh from GitHub should use
  `work-item import-plan/import-execute`; generic `sync-execute` currently
  executes local-to-GitHub only.
- Routine quick fixes should not require dogfood metadata PRs unless they
  change workspace configuration, policy, plan, target state, or durable
  coordination facts.
