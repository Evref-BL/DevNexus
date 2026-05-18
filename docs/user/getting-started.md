# Getting Started

This guide covers the normal user-facing DevNexus setup path: installing the
CLI, creating or importing a project, configuring component paths, and checking
that the project is ready for agents.

## Requirements

- Node.js 24 or newer.
- Git for component checkouts and generated worktrees.
- Any agent CLI or desktop application you plan to integrate, such as Codex or
  Claude.

Install the CLI:

```bash
npm install -g @evref-bl/dev-nexus
dev-nexus --help
```

## Homes And Projects

A DevNexus home stores user-local configuration. A DevNexus project is the
shared orchestration root for one or more components.

```bash
dev-nexus home init <home-path>
dev-nexus project create <name> --home <home-path>
dev-nexus project import <source-root> --home <home-path> --name <name>
dev-nexus project list --home <home-path>
```

Commands that need a registry accept `--home`. When `--home` is omitted,
DevNexus falls back to `DEV_NEXUS_HOME` and then to the default user home path.
Commands that only inspect an initialized project root can use the root
directly:

```bash
dev-nexus project status <project-root>
```

## Project Layout

The shared project root contains `dev-nexus.project.json` and project support
state under `.dev-nexus/`. Component source checkouts can live inside the
project or beside it. The important part is that each component has a stable
`sourceRoot`.

Common generated or support paths:

| Area | Typical path | Notes |
| --- | --- | --- |
| Project config | `dev-nexus.project.json` | User-authored shared configuration. |
| Project state | `.dev-nexus/` | DevNexus support records, local ledgers, setup state, and generated files. |
| Target state | `.dev-nexus/automation/target-state.md` | Concise user-authored memory for an automation target. |
| Generated worktrees | `<worktreesRoot>/<component-id>/` | Component-scoped worktrees for parallel work. |
| Agent MCP config | `.codex/config.toml`, `.mcp.json`, or another configured target | Generated from `mcp.agentTargets`. |

## Components

Projects are multi-component by default. A one-component project uses the same
shape as a larger project.

```json
{
  "version": 1,
  "id": "example-suite",
  "name": "Example Suite",
  "components": [
    {
      "id": "core",
      "name": "Core",
      "kind": "git",
      "role": "primary",
      "sourceRoot": "components/core",
      "worktreesRoot": "worktrees/core",
      "workTracking": {
        "provider": "local",
        "storePath": ".dev-nexus/work-items/core.json"
      },
      "verification": {
        "focusedCommands": ["npm test"],
        "fullCommands": ["npm run check"],
        "requirePassing": true
      },
      "publication": {
        "strategy": "direct_integration",
        "remote": "origin",
        "targetBranch": "main",
        "push": true
      },
      "relationships": []
    }
  ],
  "worktreesRoot": "worktrees"
}
```

Older project-level work tracking config is still accepted for compatibility,
but new projects should put work tracking on the owning component.

## Portable Paths

Prefer portable component paths over machine-specific absolute paths.
`sourceRoot` and `worktreesRoot` accept project-relative paths and explicit
bases:

- `projectRoot:components/core`
- `projectParent:sources/core`
- `sourcesRoot:core`
- `home:dev-nexus/core`

`sourcesRoot:` resolves to a sibling `sources` directory beside the project
root. Setup checks report foreign absolute paths as blocked on a different
operating system instead of treating them as valid.

## Guided Setup

Guided setup produces host-local steps and records progress under
`.dev-nexus/host-setup/` without writing machine-local secrets into shared
project configuration.

```bash
dev-nexus setup list
dev-nexus setup plan <project-root> join-existing-project --platform macos
dev-nexus setup check <project-root> join-existing-project --platform macos
dev-nexus setup record <project-root> join-existing-project <step-id> --status completed
```

Setup checks cover prerequisite tools, meta-project remotes and hosting auth
profiles, component paths, agent MCP projections, configured plugin capability
projections, and host-local readiness. If a plugin declares projected skills or
MCP servers, setup reports whether the generated agent-facing files and server
entries are present.

When setup depends on recently published npm packages, DevNexus distinguishes
registry propagation delay, network failure, missing versions, and damaged
local `node_modules` state so agents do not discover package fetch failures in
the middle of implementation work.

## Agent MCP Setup

DevNexus can generate project-local Model Context Protocol (MCP) configuration
for supported agents.

```bash
dev-nexus project mcp refresh <project-root> --agent codex
dev-nexus project mcp refresh <project-root> --agent claude
```

Codex targets write `.codex/config.toml`. Claude targets write `.mcp.json`.
Other providers can be represented as manual targets that document the command,
arguments, trust notes, and config location.

Start the MCP server with:

```bash
dev-nexus mcp-stdio
```

## Work Tracking

Configure local tracking for a project or component:

```bash
dev-nexus project tracker configure <project-root> --provider local
dev-nexus work-item create <project-root> --title "Implement focused task" --status ready
dev-nexus work-item list <project-root>
dev-nexus work-item get <project-root> local-1
dev-nexus work-item update <project-root> local-1 --status in_progress
dev-nexus work-item comment <project-root> local-1 --body "Started focused verification."
dev-nexus work-item set-status <project-root> local-1 --status done
```

For multi-component projects, pass `--component <component-id>` to target the
owning component work-item service.

## Next Steps

Read [agent workflows](agent-workflows.md) for automation, result files, MCP
tools, generated worktrees, and coordination handoffs.
