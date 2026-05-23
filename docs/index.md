---
id: index
title: DevNexus
slug: /
sidebar_label: Overview
sidebar_position: 1
---

# DevNexus

DevNexus helps you work with agents on real projects.

It creates a small workspace root for agent collaboration. The workspace records
the source folders, work trackers, context files, generated agent support, and
publication rules agents need before they edit code.

## Start Here

- [Feature overview](dev-nexus-features.md) summarizes what DevNexus provides.
- [Getting started](user/getting-started.md) walks through the first workspace.
- [Concepts](user/concepts.md) defines the workspace model and vocabulary.
- [First workspace from existing components](user/first-workspace-existing-components.md)
  shows how to coordinate several existing folders in one workspace.

## Common Workflows

- [Agent workflows](user/agent-workflows.md) covers worktrees, automation loops,
  result files, and coordination handoffs.
- [PostgreSQL claim authority](user/postgresql-claim-authority.md) explains how
  to opt into strong multi-host work-item claims.
- [Publication workflows](user/publication-workflows.md) covers review handoff,
  green-main checks, release trains, feature branch delivery, and finalization
  gates.
- [Providers, auth, and hosting](user/providers-auth-hosting.md) covers GitHub
  Apps, GitHub CLI profiles, GitLab, Jira, user accounts, machine-user accounts,
  and workspace repository hosting.
- [Multi-tracker work tracking](user/multi-tracker.md) covers local and
  provider-backed trackers.

## Project Internals

- [Architecture notes](dev/architecture.md) covers the internal design.
- [PostgreSQL claim authority initiative](dev/postgresql-claim-authority.md)
  tracks the long-lived design and slice plan for strong multi-host claim
  coordination.
- [Review policy design](dev/review-policy.md) records the source-backed
  concept for local, provider, and gated review behavior.
- [Agent-client plugin policy](dev/agent-client-plugins.md) records the
  current Codex and Claude plugin exposure, runtime, distribution, and uninstall
  decisions.
- [Agent-client plugin smoke tests](dev/agent-client-plugin-smoke.md) records
  the no-network smoke boundary and the gated live-client checklist.
