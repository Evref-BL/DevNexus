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

## Current Operating State

- Component work is tracked through local component-owned work-item stores under
  `.dev-nexus/work-items/` and through GitHub Issues tracker bindings on each
  configured component.
- Current eligible-work discovery uses `automation.eligibleWorkMode:
  discovery`, scans each component's local primary tracker and GitHub Issues
  `eligible_source` tracker, and allows direct selection of matching external
  issues without import-first migration. The automation selector still controls
  which local or GitHub issues are eligible for coordinator work.
- PLexus, pharo-launcher-mcp, and MCP-Pharo work moved to the sibling
  `/Users/gabriel.darbord/dev-nexus/dev-nexus-plexus` DevNexus project.
- The dogfood meta repository records explicit GitHub hosting metadata:
  `origin` is the human remote and `bot` is the automation remote through the
  generic `github.com-bot` SSH alias.
- Automation publication is expected to run as GitHub machine user
  `Gabot-Darbot` with `GH_CONFIG_DIR=home:.config/gh-automation-github`;
  manual human work remains `Gabriel-Darbord` through the normal `origin`
  remote.
- Direct-integration component publication policies use component `bot`
  remotes; `origin` remains the normal human/manual remote.
- User policy as of 2026-05-18: agents may integrate verified dogfood
  component work into main without waiting for manual human review, using the
  configured bot/automation profile when permissions allow. Components that
  still have an explicit non-integration publication policy must be updated
  before automation treats them as direct-integration targets.
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
- Parallel interactive chats should use isolated worktrees for mutating work;
  shared checkouts are read-mostly control rooms unless an agent explicitly owns
  integration or project-state mutation.
- DevNexus-controlled mutations should fail closed before writing a shared
  project or component checkout. Branch name alone is not proof of isolation;
  writable worker surfaces need an owned worktree or an explicit
  bootstrap/integration classification.
- External coordination should use provider-native systems such as GitHub
  Issues, GitHub pull requests, GitLab, or Jira while DevNexus stores neutral
  request and response state.
- Cross-tracker discovery and inbound provider issue import are planned in
  `docs/tracker-discovery-inbound-sync-prd.md` and sliced into
  `dev-nexus:local-129` through `local-137`. Dogfood policy now permits direct
  selection from configured GitHub eligible-source trackers, while provider
  comments and scheduled import remain separate explicit policy decisions.
  Keep inbound import policy-gated because it mutates local tracker state.
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
- Windows automation publication has a host-local
  `GH_CONFIG_DIR=home:.config/gh-automation-github` profile authenticated as
  `Gabot-Darbot`; keep agent-created Git/GitHub activity on the configured
  automation remotes and profile to prevent human-account fallback.
- Fresh Mac onboarding proved generic `dev_nexus` and `dev_nexus_pharo` stdio
  MCP servers can list tools. PLexus-backed runtime work now belongs in the
  sibling `dev-nexus-plexus` project.
- DevNexus main now includes the latest aggressive source batches:
  `ce9b7d2` rejects duplicate explicit target-cycle ids, `ff981bc` documents
  worktree-first parallel chat workflow, `4ca4362` adds host-local and
  remote-host registry overlays, `90e1b18`/`baace6a` stabilize full-suite
  Windows verification, `69fad6f` adds runner profile safety policy,
  `0cf0571` adds plugin MCP overlap guardrails, and `dfaf1ca` adds mocked
  one-way work-item sync execution. The newest batch added multi-tracker
  migration docs as `b748694`, advisory worktree leases as `2e8b64f`, and
  Codex app-server JSONL/JSON-RPC-lite compatibility as `7898d11`, cleanup
  dry-run safety classification as `6d10c72`, and active agent target config
  normalization as `3b6b755`. Follow-up slices `dev-nexus:local-81`,
  `local-87`, and `local-127` landed through `ba9976e`; the newest source
  integration adds tracker discovery policy in `dev-nexus:local-129` as
  `3de4635`, Codex app-server routing in `dev-nexus:local-114` as `0d871d7`,
  safe Codex app-server initialize probes in `local-115` as `f98bede`, and
  active agent target projection filtering in `local-106` as `c73f347`. The
  next source integrations published current-actor authority resolution in
  `local-88` and read-only tracker discovery status in `local-130` together as
  `e946039`, effective authority resolution in `local-89` as `0bc80d9`, and
  eligible-work discovery aggregation in `local-131` as `c7928f1`. The latest
  source integrations published linked tracker work-item deduplication in
  `local-132` as `d3df60c` and scoped authority summaries in `local-90` as
  `f315a66`. The latest source integrations published publication authority
  gating in `local-91` and inbound import planning in `local-133` through
  `08b700c`, including post-review import identity-matching fixes, then
  published coordination/provider mutation authority gates in `local-92` and
  policy-gated inbound import execution in `local-134` through `793a162`.
  The authority/profile mismatch fix landed as `8735a73`; `local-94`
  authority-role docs merged as `b218118`, and `local-107` stale projection
  diagnostics merged through source main `3753adf`.
- DevNexus-Pharo no longer exposes delegated generic DevNexus MCP tools,
  generic tracker wrappers, generic worktree compatibility tools, MCP naming
  overlap with core `dev_nexus`, or old DevNexus-Pharo config migration paths.
