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
- `pharo-nexus`: specialization adapter over DevNexus.
- `plexus`: runtime gateway dependency for the specialization.
- `pharo-launcher-mcp`: launcher-side MCP dependency.
- `mcp-pharo`: in-image MCP dependency.

## Decisions

- This project is the clean dogfood root. The older PharoNexus-Control and
  DevNexusProject roots remain staging history.
- Work items are local per component for immediate dogfooding. They can later
  move to GitHub Issues, GitHub Projects, Jira, GitLab Issues, or Vibe Kanban
  once those providers can list and update neutral work items well enough for
  the target loop.
- The coordinator profile uses the user-local Codex CLI binary because the
  Windows app package alias is not executable from this shell.
