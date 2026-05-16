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
- `pharo-nexus`: Pharo plugin for DevNexus.
- `plexus`: runtime gateway dependency for the Pharo plugin.
- `pharo-launcher-mcp`: launcher-side MCP dependency.
- `mcp-pharo`: in-image MCP dependency.

## Decisions

- This project is the clean dogfood root. The older PharoNexus-Control and
  DevNexusProject roots remain staging history.
- DevNexus plugins are additive project capabilities, not alternate project
  runners. A project can load multiple plugins, such as PharoNexus for Pharo
  work and a future TypeScript plugin for TypeScript work.
- PharoNexus is responsible for Pharo agent setup: scoped PLexus project
  context, safe launcher affordances, gateway routing, and direct Pharo MCP
  access for subagents.
- Mac and Windows agents should coordinate through shared work-item intent,
  structured handoffs, pushed branches, and integration records. Avoid hard
  locks by default; keep Git worktrees useful for parallel work.
- The planned shared coordination API is intentionally small:
  `coordination_status`, `coordination_handoff`, and `coordination_integrate`.
  DevNexus should automate host/worktree/branch detection, handoff facts,
  conflict forecasting, and integration planning behind those simple calls.
- Work items are local per component for immediate dogfooding. They can later
  move to GitHub Issues, GitHub Projects, Jira, GitLab Issues, or Vibe Kanban
  once those providers can list and update neutral work items well enough for
  the target loop.
- The coordinator profile uses the user-local Codex CLI binary because the
  Windows app package alias is not executable from this shell.
