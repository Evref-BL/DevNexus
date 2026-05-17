# DevNexus Dogfood Context

## Current Goal

Use DevNexus itself to drive continued work on DevNexus and its related
components until the live plan has been split into component-owned work items
and the remaining eligible work can be advanced through the DevNexus
launch/relaunch workflow.

The transferred plan now lives in `PLAN.md`. Use it as the source for the next
target and for `to-issues` splitting instead of relying on chat history or the
older control-project handoff.

## Components

- `dev-nexus`: generic core and primary component.
- `dev-nexus-pharo`: Pharo plugin for DevNexus.
- `plexus`: runtime gateway dependency for the Pharo plugin.
- `pharo-launcher-mcp`: launcher-side MCP dependency.
- `mcp-pharo`: in-image MCP dependency.

## Decisions

- This project is the clean dogfood root. The older staging roots remain
  historical context.
- DevNexus plugins are additive project capabilities, not alternate project
  runners. A project can load multiple plugins, such as DevNexus-Pharo for Pharo
  work and a future TypeScript plugin for TypeScript work.
- DevNexus-Pharo is responsible for Pharo agent setup: scoped PLexus project
  context, safe launcher affordances, gateway routing, and direct Pharo MCP
  access for subagents.
- Mac and Windows agents should coordinate through shared work-item intent,
  structured handoffs, pushed branches, and integration records. Avoid hard
  locks by default; keep Git worktrees useful for parallel work.
- The planned shared coordination API is intentionally small:
  `coordination_status`, `coordination_handoff`, `coordination_integrate`, and
  `coordination_request`. DevNexus should automate host/worktree/branch
  detection, handoff facts, conflict forecasting, integration planning, and
  external approval/feedback requests behind those simple calls.
- External coordination should use provider-native systems such as GitHub
  Issues, GitHub pull requests, GitLab issues or merge requests, Jira issues,
  and review comments while mapping their states into neutral DevNexus
  coordination records.
- Work items are local per component for immediate dogfooding. They can later
  move to GitHub Issues, GitHub Projects, Jira, GitLab Issues, or Vibe Kanban
  once those providers can list and update neutral work items well enough for
  the target loop.
- The coordinator profile uses the user-local Codex CLI binary because the
  Windows app package alias is not executable from this shell.
- The cron automation and dogfood MCP projection use the user-local Codex Node
  executable directly. The previous Winget-managed Node path was executable
  interactively but returned access denied from the scheduler shell.
