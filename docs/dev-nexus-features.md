---
id: dev-nexus-features
title: DevNexus Feature Overview
sidebar_label: Feature Overview
sidebar_position: 2
---

# DevNexus Feature Overview

DevNexus is a workspace layer for agent-assisted projects. It records structure,
policy, work, and coordination facts so people and agents use the same project
state.

This page is the short version. It points to the detailed docs instead of
repeating them.

## Project Model

| Feature | In a few words | More |
| --- | --- | --- |
| Workspaces | A directory to open in an agent, with shared project state. | [Concepts](user/concepts.md#workspace) |
| Components | Repositories, docs, datasets, and support folders in one model. | [Concepts](user/concepts.md#component) |
| Work items | Local tasks, GitHub issues, GitLab issues, or Jira items. | [Concepts](user/concepts.md#work-item) |
| Multi-tracker work | Canonical tasks plus provider mirrors, archives, feedback, and migration records. | [Multi-tracker work tracking](user/multi-tracker.md) |

## Agent Setup

| Feature | In a few words | More |
| --- | --- | --- |
| Agent files | `AGENTS.md`, skills, context files, and provider config generated from workspace state. | [Concepts](user/concepts.md#agent-files) |
| Agent targets | Codex, Claude, OpenCode, or custom/manual setup per workspace. | [Agent targets](user/agent-targets.md) |
| MCP tools | Workspace status, setup, work items, automation, and coordination from agent sessions. | [Agent workflows](user/agent-workflows.md#mcp-server) |
| MCP gateway | A small routing surface for large tool sets and plugin-provided MCP servers. | [Agent targets](user/agent-targets.md#mcp-exposure-and-gateway-groups) |

## Software Development Workflow

DevNexus projects can include skill chains for common engineering work. The
chains are routing maps for agents: feature work, bugfixes, architecture
changes, documentation changes, and version or release work each follow a
different path.

`take-the-lead` is the companion collaboration mode. When the user asks the
agent to lead, the agent recommends the next step, chooses the relevant chain,
uses parallel work only when it has clear boundaries, and pauses at human
decision gates for scope, risk, credentials, provider writes, publication, or
live runtime work.

The chains are not a separate workflow engine. They are documented practice that
agents can follow while DevNexus records the workspace state, work items,
branches, checks, and results.

See [Skill Chains](user/skill-chains.md).

## Plugins

Plugins add domain-specific support without replacing the DevNexus core. A
plugin can contribute projected skills, MCP servers, setup obligations,
environment hints, cleanup hooks, agent affordances, dependency projections, and
worker context or briefing fragments.

DevNexus exposes a curated plugin catalogue for known DevNexus-maintained
plugins: DevNexus TypeScript, DevNexus-Pharo, and DevNexus Research. Catalogue
entries provide package install guidance and `workspace plugin refresh` command
guidance, but they are not installed automatically. DevNexus does not expose a
public plugin marketplace; new catalogue entries require an explicit core
allowlist change.

Generic workspace, setup, coordination, automation, worktree, and work-item
operations still belong to the core `dev_nexus` MCP server.

See [Architecture notes](dev/architecture.md#plugin-capabilities) and
[Agent-client plugin policy](dev/agent-client-plugins.md).

## Execution And Coordination

| Feature | In a few words | More |
| --- | --- | --- |
| Worktrees | Isolated Git checkouts for focused agent work and parallel chats. | [Agent workflows](user/agent-workflows.md#generated-worktrees) |
| Setup checks | Readiness reports for hosts, tools, paths, auth profiles, and generated support. | [Getting started](user/getting-started.md) |
| Automation context | Target state, eligible work, agent profiles, run records, and result contracts. | [Agent workflows](user/agent-workflows.md#automation) |
| Current-agent adoption | The active chat can adopt a DevNexus run context and record its result. | [Agent workflows](user/agent-workflows.md#current-agent-adoption) |
| Coordination records | Branch status, decisions, verification, review requests, and integration plans. | [Agent workflows](user/agent-workflows.md#coordination) |
| Reports | Compact target reports built from recorded facts, not guessed status. | [Agent workflows](user/agent-workflows.md#low-token-coordinator-cycle) |

## Policy And Publication

| Feature | In a few words | More |
| --- | --- | --- |
| Authority roles | Separation between human accounts, automation actors, and provider permissions. | [Authority roles](user/authority-roles.md) |
| Credential boundaries | Shared config references host-local profiles instead of storing secrets. | [Providers, auth, and hosting](user/providers-auth-hosting.md) |
| Verification | Component-specific focused and full checks, recorded as evidence. | [Agent workflows](user/agent-workflows.md#result-file-contract) |
| Publication | Human review by default; green-main, CI tiers, merge queues, and release trains when enabled. | [Publication workflows](user/publication-workflows.md) |
| Hosting checks | Repository intent, remotes, access requirements, and safe repair planning. | [Providers, auth, and hosting](user/providers-auth-hosting.md#meta-repository-hosting) |
| Remote execution | Request and result records for trusted hosts, behind explicit runner policy. | [Agent workflows](user/agent-workflows.md#automation) |

## Default Posture

DevNexus does not choose work, replace code review, store secrets, or bypass
provider policy. It gives agents a shared operating surface; people and
configured policies keep authority.
