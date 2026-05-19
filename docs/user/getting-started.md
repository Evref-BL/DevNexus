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

If you are reading documentation from the GitHub `main` branch while using an
older npm release, verify each command with `dev-nexus --help`. The docs in
the installed package and the CLI help are the authority for that installed
version.

## Homes And Projects

A DevNexus home stores user-local configuration. A DevNexus project is the
shared orchestration root for one or more components.

Use the nouns precisely:

- The **home** is local registry and host setup state. It can hold references
  to many DevNexus projects.
- The **project root** is the shared DevNexus orchestration directory. It
  contains `dev-nexus.project.json`, `AGENTS.md`, planning files, and
  `.dev-nexus/` support state.
- A **component source root** is an actual repository or folder that the
  project coordinates.
- A **generated worktree** is an isolated implementation checkout under
  `worktrees/<component-id>/`.
- An **agent project or session** is the provider-side workspace, such as a
  Codex Desktop project, opened at the DevNexus project root.

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

`project import <source-root>` creates a DevNexus project whose primary
component is that source root. It is not a command for adding a component to an
existing project. If you have three existing repositories that should be worked
on together, create one DevNexus project and declare three components.

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

Do not put primary editable component clones under `.dev-nexus/`. That
directory is for support records, local ledgers, generated setup, and runtime
state. Component source roots should be visible project layout, normally under
`components/`, or explicit advanced external paths.

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

## First Project From Existing Components

Suppose the user wants one DevNexus project named `graphrag-research-suite`
that coordinates these existing folders:

```text
/Users/alice/projects/benchmark-graphRag
/Users/alice/projects/GraphRag-Projects/json-java-moose
/Users/alice/projects/GraphRag-Projects/json-java-no-moose
/Users/alice/papers/2026-iwst-modelsandllms
```

Create one DevNexus project first:

```bash
dev-nexus home init "$HOME/.dev-nexus"
dev-nexus project create graphrag-research-suite --home "$HOME/.dev-nexus" --root "$HOME/dev-nexus/graphrag-research-suite"
```

Then edit `dev-nexus.project.json` so the existing folders are components of
that one project. Until a component-add command exists, this explicit config is
the supported path for multi-component first projects:

```json
{
  "version": 1,
  "id": "graphrag-research-suite",
  "name": "GraphRAG Research Suite",
  "worktreesRoot": "worktrees",
  "components": [
    {
      "id": "benchmark-graphrag",
      "name": "Benchmark GraphRAG",
      "kind": "git",
      "role": "primary",
      "sourceRoot": "/Users/alice/projects/benchmark-graphRag",
      "worktreesRoot": "worktrees/benchmark-graphrag",
      "workTracking": {
        "provider": "local",
        "storePath": ".dev-nexus/work-items/benchmark-graphrag.json"
      },
      "relationships": []
    },
    {
      "id": "json-java-moose",
      "name": "JSON Java Moose",
      "kind": "git",
      "role": "dependency",
      "sourceRoot": "/Users/alice/projects/GraphRag-Projects/json-java-moose",
      "worktreesRoot": "worktrees/json-java-moose",
      "workTracking": {
        "provider": "local",
        "storePath": ".dev-nexus/work-items/json-java-moose.json"
      },
      "relationships": [
        {
          "kind": "supports",
          "componentId": "benchmark-graphrag"
        }
      ]
    },
    {
      "id": "json-java-no-moose",
      "name": "JSON Java No Moose",
      "kind": "git",
      "role": "dependency",
      "sourceRoot": "/Users/alice/projects/GraphRag-Projects/json-java-no-moose",
      "worktreesRoot": "worktrees/json-java-no-moose",
      "workTracking": {
        "provider": "local",
        "storePath": ".dev-nexus/work-items/json-java-no-moose.json"
      },
      "relationships": [
        {
          "kind": "supports",
          "componentId": "benchmark-graphrag"
        }
      ]
    },
    {
      "id": "iwst-paper",
      "name": "IWST Paper",
      "kind": "git",
      "role": "addon",
      "sourceRoot": "/Users/alice/papers/2026-iwst-modelsandllms",
      "worktreesRoot": "worktrees/iwst-paper",
      "workTracking": {
        "provider": "local",
        "storePath": ".dev-nexus/work-items/iwst-paper.json"
      },
      "relationships": [
        {
          "kind": "documents",
          "componentId": "benchmark-graphrag"
        }
      ]
    }
  ],
  "mcp": {
    "command": "dev-nexus",
    "args": ["mcp-stdio"],
    "agentTargets": [
      {
        "agent": "codex"
      }
    ]
  },
  "skills": {
    "defaultCorePack": true,
    "sourceControl": "support",
    "agentTargets": [
      {
        "agent": "codex"
      }
    ]
  }
}
```

Use absolute existing paths only when you deliberately want DevNexus to
reference those external checkouts in place. The project-local default is to
clone or move component source roots under
`$HOME/dev-nexus/graphrag-research-suite/components/<component-id>` and use
`componentsRoot:<component-id>` in shared config.

After saving the config, refresh support and inspect readiness:

```bash
dev-nexus project status "$HOME/dev-nexus/graphrag-research-suite"
dev-nexus project mcp refresh "$HOME/dev-nexus/graphrag-research-suite" --agent codex
dev-nexus setup check "$HOME/dev-nexus/graphrag-research-suite" join-existing-project --platform macos
```

For Codex Desktop, create or open the Codex project at
`$HOME/dev-nexus/graphrag-research-suite`. DevNexus creates the project-local
`.codex/config.toml`; it does not change the desktop app's selected project.

Create the first component-scoped work item:

```bash
dev-nexus work-item create "$HOME/dev-nexus/graphrag-research-suite" --component benchmark-graphrag --title "Define GraphRAG benchmark protocol" --status ready
dev-nexus work-item list "$HOME/dev-nexus/graphrag-research-suite" --component benchmark-graphrag
```

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
