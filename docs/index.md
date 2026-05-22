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

- [Getting started](user/getting-started.md) walks through the first workspace.
- [Concepts](user/concepts.md) defines the workspace model and vocabulary.
- [First workspace from existing components](user/first-workspace-existing-components.md)
  shows how to coordinate several existing folders in one workspace.

## Common Workflows

- [Agent workflows](user/agent-workflows.md) covers worktrees, automation loops,
  result files, and coordination handoffs.
- [Providers, auth, and hosting](user/providers-auth-hosting.md) covers GitHub
  Apps, GitHub CLI profiles, GitLab, Jira, user accounts, machine-user accounts,
  and workspace repository hosting.
- [Multi-tracker work tracking](user/multi-tracker.md) covers local and
  provider-backed trackers.
- [Dashboard cockpit](user/dashboard/index.md) covers the host dashboard,
  workspace drill-downs, HITL actions, plugins, and embeddable data contracts.

## Project Internals

- [Architecture notes](dev/architecture.md) covers the internal design.
- [Agent-client plugin policy](dev/agent-client-plugins.md) records the
  current Codex and Claude plugin exposure, runtime, distribution, and uninstall
  decisions.
- [Agent-client plugin smoke tests](dev/agent-client-plugin-smoke.md) records
  the no-network smoke boundary and the gated live-client checklist.
