# DevNexus Dogfood Context

## Purpose

This repository is the clean dogfood meta-project for DevNexus. It stores the
portable project graph, local component work items, planning documents,
agent-facing instructions, target state, and setup projections used to work on
DevNexus and its related components.

DevNexus is infrastructure. It records project state, work items, agent launch
policy, target-cycle facts, worktree metadata, verification, publication
decisions, skills, and Model Context Protocol (MCP) configuration. A human or
coordinator agent chooses and supervises implementation work.

## Components

- `dev-nexus`: generic core and primary component.
- `dev-nexus-pharo`: Pharo plugin for DevNexus.
- `dev-nexus-typescript`: TypeScript/JavaScript plugin for DevNexus.
- `plexus`: project-scoped Pharo runtime and gateway dependency.
- `pharo-launcher-mcp`: launcher-side MCP dependency.
- `mcp-pharo`: in-image Pharo MCP dependency.

## Current Operating State

- Component work is tracked through local component-owned work-item stores under
  `.dev-nexus/work-items/`.
- The dogfood meta repository records explicit GitHub hosting metadata:
  `origin` is the human remote and `bot` is the automation remote through the
  generic `github.com-bot` SSH alias.
- Automation publication is expected to run as GitHub machine user
  `Gabot-Darbot` with `GH_CONFIG_DIR=home:.config/gh-automation-github`;
  manual human work remains `Gabriel-Darbord` through the normal `origin`
  remote.
- Direct-integration component publication policies use component `bot`
  remotes; `origin` remains the normal human/manual remote.
- The active scheduler path is DevNexus `automation coordinator-loop`.
  Heartbeats may wake that loop, but DevNexus owns lock, backoff, run facts, and
  relaunch decisions.
- The coordinator profile uses the user-local Codex binary because Windows app
  package aliases can be inaccessible from automation shells.
- The project-local runtime package install under `.dev-nexus/runtime/npm-tools`
  is intentionally retained because generated MCP config uses those binaries.

## Decisions

- Plugins are additive DevNexus capabilities, not alternate project runners.
- DevNexus-Pharo supplies Pharo-specific setup, scoped PLexus context, launcher
  affordances, gateway routing, and image-side Pharo MCP access for Pharo work.
- DevNexus-TypeScript supplies TypeScript/JavaScript setup policy, especially
  reusable dependency projection for generated worktrees.
- Mac and Windows agents coordinate through shared work-item intent, Git
  branches, structured handoffs, target-cycle facts, and provider-backed
  requests. Hard locks are avoided by default.
- External coordination should use provider-native systems such as GitHub
  Issues, GitHub pull requests, GitLab, or Jira while DevNexus stores neutral
  request and response state.
- Live Pharo images, PLexus open/close, Docker, package installs, and
  destructive runtime cleanup require an approved isolated runner profile.

## Active Cleanup Notes

- Completed historical runtime profiles are not current approval policy.
- Generated worktrees are disposable once their branches have been integrated or
  their commits are otherwise preserved.
- Windows source roots currently use host-local junctions to older checkout
  locations. `dev-nexus:local-69` tracks migration to cleaner source roots or an
  explicit host-local indirection policy.
- The active Codex session may still lack visible generic DevNexus MCP tools
  even when config and stdio probes work. Use the project-local DevNexus CLI for
  project operations until provider-session visibility is fixed.
- Windows automation publication currently blocks until the host-local
  `GH_CONFIG_DIR=home:.config/gh-automation-github` profile is authenticated as
  `Gabot-Darbot`; this is intentional to prevent human-account fallback.
- Fresh Mac onboarding proved generic `dev_nexus` and `dev_nexus_pharo` stdio
  MCP servers can list tools, but PLexus-backed MCP was unavailable because
  `plexus` was not on `PATH` and direct Pharo HTTP MCP was not live. Treat that
  Mac as ready for non-live DevNexus coordination only until runtime tooling is
  explicitly enabled.
