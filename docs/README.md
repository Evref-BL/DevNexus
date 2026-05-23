# DevNexus Dogfood Docs Index

This directory contains design records, Product Requirements Documents (PRDs),
audits, and onboarding notes. These files are useful, but they are not all live
context.

Default agent context is:

- `AGENTS.md`
- `CONTEXT.md`
- `PLAN.md`
- `.dev-nexus/automation/target-state.md`
- the specific work item or GitHub issue being handled

Load documents from this directory only when the selected work item, current
question, or investigation names them directly.

## Current Reference

- `dev-nexus-operating-model.md` - durable operating model and vocabulary.
- `dev-nexus-quality-audit-baseline.md` - evidence-backed repository and code
  quality audit standard for DevNexus.
- `generic-ide-mcp-findings.md` - research note on generalizing the Pharo MCP
  into language-neutral IDE/code-intelligence capabilities.

## Active Or Partly Active PRDs

These still explain open or blocked work. Keep them available, but do not load
them by default.

- `agent-target-projection-opt-in-prd.md` - active-target projection and stale
  provider-support cleanup.
- `codex-app-server-provider-prd.md` - Codex app-server provider follow-up.
- `coordination-roles-authority-prd.md` - authority roles and unresolved
  advanced policy decisions.
- `dev-nexus-research-plugin-prd.md` - DevNexus-Research direction and blocked
  license/ARS posture.
- `parallel-agent-git-workflow-prd.md` - worktree-first interactive and
  parallel-agent workflow.
- `remote-host-execution-prd.md` - remote host execution model and gated
  follow-up.
- `shared-multi-host-coordination-prd.md` - provider-backed coordination
  decisions and external feedback policy.
- `work-item-claim-coordination-prd.md` - local mirror of DevNexus Discussion
  #90 about claim-time race handling for GitHub-only optimistic claims,
  optional SSH/Tailscale brokers, and mature coordination stores.

## Historical Or Mostly Implemented PRDs

These are valuable for rationale and archaeology, but current status should be
read from GitHub issues, target cycles, PRs, commits, and reports.

- `codex-architecture-design-audit-prd.md`
- `component-multi-tracker-prd.md`
- `dev-nexus-readme-onboarding-prd.md`
- `nicolas-first-user-onboarding-notes.md`
- `plexus-project-scoped-runtime-prd.md`
- `project-hosting-provisioning-prd.md`
- `tracker-discovery-inbound-sync-prd.md`
- `version-scoped-planning-prd.md`

## Retention Policy

- Keep PRDs while they explain open issues, blocked decisions, or non-obvious
  product vocabulary.
- Move a PRD to an archive directory only after all active work has migrated to
  GitHub issues or user-facing docs.
- Do not duplicate completed implementation history in PRDs, `CONTEXT.md`,
  `PLAN.md`, or target state. Completed history belongs in durable facts:
  issues, target cycles, runs, PRs, commits, and release notes.
- New design notes should start as issues or comments when the work is concrete.
  Create a PRD only when the problem needs product vocabulary, tradeoffs, or
  multi-issue slicing.
