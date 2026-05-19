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
state under `.dev-nexus/`. By default, put stable component source checkouts
under `components/<component-id>` inside the project root, and put generated
implementation worktrees under `worktrees/<component-id>`.

Stable component source roots are durable checkouts. They are useful for human
inspection, baseline status, and integration, but mutating parallel chats
should prepare or adopt isolated worker worktrees before editing. Project-meta
changes should use the same worktree-first expectation for project support
files and durable planning documents.

Common generated or support paths:

| Area | Typical path | Notes |
| --- | --- | --- |
| Project config | `dev-nexus.project.json` | User-authored shared configuration. |
| Project state | `.dev-nexus/` | DevNexus support records, local ledgers, setup state, and generated files. |
| Component sources | `components/<component-id>` | Stable component source checkouts, not disposable worker paths. |
| Target state | `.dev-nexus/automation/target-state.md` | Concise user-authored memory for an automation target. |
| Generated worktrees | `<worktreesRoot>/<component-id>/` | Component-scoped worker worktrees for parallel source work. |
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
      "sourceRoot": "componentsRoot:core",
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

- `componentsRoot:core`
- `projectRoot:components/core`
- `projectParent:sources/core`
- `sourcesRoot:core`
- `home:dev-nexus/core`

`componentsRoot:` resolves to the project-local `components` directory and is
the preferred source-root base for normal projects. `sourcesRoot:` resolves to a
sibling `sources` directory beside the project root and is useful for advanced
external layouts. Setup checks report foreign absolute paths as blocked on a
different operating system instead of treating them as valid.

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

When a project declares `hosting`, setup checks summarize the same hosting
status and plan used by the dedicated hosting commands. Normal onboarding
should inspect these generic commands before touching provider-specific tools:

```bash
dev-nexus project hosting status <project-root> --json
dev-nexus project hosting plan <project-root> --json
dev-nexus project hosting apply <project-root> --json
```

The shared project config records portable intent only: provider, namespace,
repository name or template, visibility, default branch, declared remotes,
required principals, and provisioning gates. Host-local auth profiles point to
local credential context, but tokens, private keys, GitHub CLI state, SSH key
paths, and wrapper scripts stay outside shared project config.

Authority roles describe who may use those profiles for project work. Add
shared actor and role-binding records for maintainers, contributors, reviewers,
runtime operators, and release operators, then keep each machine's credential
details in its own DevNexus home. See
[authority roles](authority-roles.md) for complete examples and open-source
contributor guidance.

```json
{
  "hosting": {
    "provider": "github",
    "namespace": "ExampleOrg",
    "repository": {
      "nameTemplate": "{projectId}",
      "visibility": "private",
      "defaultBranch": "main"
    },
    "remotes": [
      {
        "name": "origin",
        "role": "human",
        "protocol": "ssh",
        "authProfile": "human-github"
      },
      {
        "name": "bot",
        "role": "automation",
        "protocol": "ssh",
        "authProfile": "bot-github",
        "sshHost": "github.com-bot"
      }
    ],
    "access": [
      {
        "kind": "human",
        "providerIdentity": "alice",
        "role": "human",
        "requiredPermission": "admin",
        "authProfile": "human-github",
        "invitationPolicy": "auto_accept"
      },
      {
        "kind": "machine_user",
        "providerIdentity": "example-bot",
        "role": "automation",
        "requiredPermission": "write",
        "authProfile": "bot-github",
        "invitationPolicy": "require_accepted"
      }
    ],
    "provisioning": {
      "allowCreate": false,
      "allowLocalRemoteRepair": true,
      "allowAccessRepair": false,
      "allowInvitationAcceptance": true,
      "allowDefaultBranchRepair": false,
      "allowVisibilityRepair": false,
      "providerMutationAuthProfile": "bot-github"
    }
  }
}
```

Provider adapters own repository creation, collaborator invitations, access
repair, and invitation acceptance. Setup status reports repository, remote,
auth-profile, actor, access, and invitation drift, but setup checks do not
mutate provider state.

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

For onboarding, distinguish a raw stdio smoke test from provider readiness.
`tools/list` against `dev-nexus mcp-stdio` proves the server command can start;
the agent session is ready only after the active provider, such as Codex
Desktop, exposes those tools in the project session. Plugin MCP servers must
also have their configured commands available on the host `PATH`.

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

For components with more than one tracker, configure `workTrackers` and
`defaultWorkTrackerId` on the owning component. Work-item commands use the
default tracker when `--tracker` is omitted, and non-default trackers can be
used for mirror, coordination, planning, feedback, migration, or archive roles.
Read [multi-tracker work tracking](multi-tracker.md) before linking external
issues or planning sync from local work items to a shared provider.

## Next Steps

Read [agent workflows](agent-workflows.md) for automation, result files, MCP
tools, generated worktrees, and coordination handoffs.
