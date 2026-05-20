# DevNexus Dogfood Context

## Purpose

This repository is the clean dogfood meta-project for DevNexus. It stores the
portable project graph, component tracker bindings, archive data, planning
handoff, agent instructions, automation target state, generated setup support,
and lightweight project documentation used to work on DevNexus and related
components.

DevNexus is infrastructure. It records project state, components, work trackers,
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
  The automation selector still requires `status:ready` plus `dogfood`, and
  excludes `blocked` and `unsafe-live-runtime`.
- There are currently visible GitHub issues, but no issue matches the automation
  selector. Most remaining visible issues are `todo`, `blocked`, missing
  `dogfood`, or excluded by safety labels.
- The dogfood meta repository records `origin` and `bot` remotes. Agent-created
  Git/GitHub activity must use the `Gabot-Darbot` automation identity via
  `GH_CONFIG_DIR=home:.config/gh-automation-github` and the `bot` remote unless
  the user explicitly says otherwise.
- Dogfood component publication uses green-main policy: branch or pull-request
  validation first, required Node 24 checks on Ubuntu, Windows, and macOS, then
  authorized merge after checks are green.
- The active scheduler path is DevNexus `automation coordinator-loop`.
  Heartbeats may wake that loop, but DevNexus owns lock, backoff, run facts, and
  relaunch decisions.
- The project-local runtime package install under `.dev-nexus/runtime/npm-tools`
  is intentionally retained because generated MCP config uses those binaries.

## Decisions

- Plugins are additive DevNexus capabilities, not alternate project runners.
- DevNexus-Pharo supplies Pharo-specific setup, scoped PLexus context, launcher
  affordances, gateway routing, and image-side Pharo MCP access for Pharo work.
- DevNexus-TypeScript supplies TypeScript/JavaScript setup policy, especially
  reusable dependency projection for generated worktrees.
- PLexus and pharo-launcher-mcp implementation backlogs still belong in the
  sibling `dev-nexus-plexus` DevNexus project by default. This dogfood root may
  act on them explicitly for cross-project coordination, packaging, publication,
  and security maintenance when a human selects that work.
- MCP-Pharo implementation work remains owned by the sibling
  `dev-nexus-plexus` project unless explicitly authorized here.
- Mac and Windows agents coordinate through work-item intent, Git branches,
  structured handoffs, target-cycle facts, and provider-backed requests.
- Parallel interactive chats should use isolated worktrees for mutating work.
  Shared checkouts are read-mostly control rooms unless an agent explicitly owns
  integration or project-state mutation.
- DevNexus-controlled mutations fail closed before writing a shared project or
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

- The active MCP server may be stale after DevNexus source integrations. Prefer
  the project-local DevNexus CLI from `C:\dev\code\sources\dev-nexus` when the
  MCP runtime reports it predates source `HEAD`.
- Windows source roots still use host-local external checkouts. Treat
  `dev-nexus:local-69` / GitHub #29 and related source-root issues as the path
  to cleaner project-local component clones.
- Provider-native sync and coordination paths are improving but still need
  explicit policy care. Local archive refresh from GitHub should use
  `work-item import-plan/import-execute`; generic `sync-execute` currently
  executes local-to-GitHub only.
- Routine quick fixes should not require dogfood metadata PRs unless they
  change project configuration, policy, plan, target state, or durable
  coordination facts.
