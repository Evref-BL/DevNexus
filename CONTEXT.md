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
- `dev-nexus-typescript`: TypeScript/JavaScript plugin for DevNexus.
- `plexus`: runtime gateway dependency for the Pharo plugin.
- `pharo-launcher-mcp`: launcher-side MCP dependency.
- `mcp-pharo`: in-image MCP dependency.

## Decisions

- This project is the clean dogfood root. The older staging roots remain
  historical context.
- DevNexus plugins are additive project capabilities, not alternate project
  runners. A project can load multiple plugins, such as DevNexus-Pharo for Pharo
  work and DevNexus-TypeScript for TypeScript/JavaScript work.
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
- The standalone cron is currently paused because Codex cron shell commands run
  with restricted workspace/no-network permissions; nested `codex.exe`
  coordinator launch can fail there. DevNexus source commit `af0b300` adds the
  managed `automation coordinator-loop`; the active heartbeat should use that
  loop as a temporary wake-up bridge. Current-agent adoption for already-running
  coordinators is tracked separately by `dev-nexus:local-29`.
- DevNexus source commit `7aa035d` fixes MCP work-item tools so
  component-qualified ids such as `dev-nexus:local-27` route to the component
  work tracker before provider selection.
- DevNexus-Pharo source commit `ec14934` bundles MCP-Pharo domain skills for
  Pharo-capable subagents: `pharo-ci-repro`, `pharo-image-git-handoff`,
  `pharo-project-load`, and `pharo-version-compat`.
- DevNexus-TypeScript source commit `bf19839` creates the standalone
  TypeScript/JavaScript plugin repo and declares dependency projection plus
  worker guidance for reusable package dependencies in generated worktrees.
