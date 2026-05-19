# DevNexus

DevNexus is a language-neutral project orchestration toolkit for
agent-assisted software work. It keeps project structure, work tracking, agent
launch policy, coordination records, verification facts, and publication
handoffs in one predictable place.

Use DevNexus when a project has multiple components, multiple work trackers,
or repeatable agent workflows. DevNexus supplies the infrastructure and
records; the human or launched agent still chooses the work, supervises
implementation, verifies changes, and decides what to publish.

## Install

DevNexus requires Node.js 24 or newer.

```bash
npm install -g @evref-bl/dev-nexus
dev-nexus --help
```

The online README on `main` can move ahead of the latest npm release. When an
agent installs from npm, verify the installed command surface with
`dev-nexus diagnostics cli-version-skew --json` before following newer
source-branch examples. If the diagnostic reports missing documented commands,
upgrade the npm package, install DevNexus from the source checkout, or use the
docs that shipped with the installed package version.

For source development:

```bash
npm install
npm run check
```

## Quick Start

Start by choosing three different locations:

- The **DevNexus home** is user-local registry and host setup state. It is not
  the project you work in.
- The **DevNexus project root** is the shared orchestration directory. Open
  this directory as the Codex or Claude project/session.
- **Component source roots** are the actual repositories or folders the project
  coordinates. The default layout puts stable component checkouts under
  `components/<component-id>` inside the project root.

For a first DevNexus project, prefer the guided setup command. It accepts a
small JSON answer file, previews local writes by default, and applies only when
`--yes` is present:

```bash
dev-nexus project setup "$HOME/dev-nexus/example-suite" --answers ./dev-nexus.setup.json --json
dev-nexus project setup "$HOME/dev-nexus/example-suite" --answers ./dev-nexus.setup.json --yes
dev-nexus project status "$HOME/dev-nexus/example-suite"
```

`project setup` defaults the DevNexus home to `DEV_NEXUS_HOME` or
`~/.dev-nexus` and creates the local home registry when needed. It then collects
the project root, component sources, primary component, agent targets, local
tracker choice, hosting intent, auth-profile references, and publication
posture. Provider mutations, such as creating a GitHub repository or repairing
access, are left as explicit next-phase hosting actions.

Use `project create` as a low-level local scaffold command. Use `project
import` only when one existing source checkout should become the primary
component of a new DevNexus project. Do not run `project import` once per
repository if the goal is one DevNexus project with several components; use
`project setup` with multiple component answers instead. The full example is
in [Getting started](docs/user/getting-started.md#first-project-from-existing-components).

To add components later without manual JSON editing, preview and apply a
component answer file:

```bash
dev-nexus project component add "$HOME/dev-nexus/example-suite" --answers ./component-add.json --json
dev-nexus project component add "$HOME/dev-nexus/example-suite" --answers ./component-add.json --yes
```

Setup and component-add previews warn about common topology mistakes, including
container folders with nested repositories, non-Git folders, branch or remote
drift, and source roots placed under generated `worktrees/`.

Setup previews also include an auth inventory for referenced GitHub, GitLab,
Jira, and generic Git profiles. The inventory reports whether a profile is
needed now, later, or only for provider mutations, and it checks host-local
credential handles such as provider CLIs or environment-variable names without
recording raw secret values.

When meta-project hosting intent is configured, setup previews include a
hosting handoff with the exact `project hosting status`, `project hosting
plan`, and `project hosting apply` commands. `project setup` never creates
provider repositories, pushes branches, repairs collaborators, or accepts
invitations.

List registered projects:

```bash
dev-nexus project list --home "$HOME/.dev-nexus"
```

Inspect declared repository hosting before onboarding or publication:

```bash
dev-nexus project hosting status <project-root>
dev-nexus project hosting plan <project-root>
```

Configure authority roles for humans, automation accounts, reviewers, runtime
operators, and release operators with the
[authority roles guide](docs/user/authority-roles.md).

Configure local work tracking and create a work item:

```bash
dev-nexus project tracker configure <project-root> --provider local
dev-nexus work-item create <project-root> --title "Implement focused task" --status ready
dev-nexus work-item list <project-root>
```

Refresh agent Model Context Protocol (MCP) configuration:

```bash
dev-nexus project mcp refresh <project-root> --agent codex
dev-nexus mcp-stdio
```

For Codex Desktop, also create or open a Codex project whose root is the same
DevNexus project root. DevNexus writes project-local `.codex/config.toml`; it
does not switch the desktop app to that project for you.

Check automation readiness:

```bash
dev-nexus automation status <project-root>
dev-nexus automation eligible-work <project-root> --json
dev-nexus automation agent-profiles <project-root> --json
dev-nexus automation heartbeat prepare <project-root> --json
```

## Core Concepts

- A **project** is the shared DevNexus orchestration context. It is configured
  by `dev-nexus.project.json` and stores project-level support records under
  `.dev-nexus/`.
- A **component** is a source or support unit in a project. Each component can
  have its own source root, Git defaults, generated worktree root, work-item
  service, verification hints, publication policy, and relationships.
- A **work tracker** is a named provider binding configured for a component,
  such as a local store, GitHub Issues, GitLab issues, Jira, or another
  provider adapter. One enabled tracker is the component default for ordinary
  work-item commands; other trackers can serve mirror, coordination, planning,
  feedback, migration, or archive roles.
- A **target** is the user-requested outcome for an automation loop. DevNexus
  records target state and cycle facts, but it does not decide which work is
  selected.
- An **agent profile** describes launch infrastructure: executor, model or
  variant, command template, safety posture, and intended use.
- A **plugin** contributes additive capabilities such as projected skills, MCP
  servers, setup obligations, dependency projections, worker context, or
  cleanup guidance.

## Common Workflows

For mutating interactive chats, start from a shared checkout only long enough
to inspect status and prepare or adopt an isolated component or project-meta
worktree. Keep shared checkouts and stable component source roots read-mostly
unless the chat explicitly owns integration or project-state mutation.

Prepare an isolated component worktree for parallel work:

```bash
dev-nexus worktree prepare <project-root> --component <component-id> --work-item <work-item-id>
```

Record coordination facts for other agents:

```bash
dev-nexus coordination status <project-root> --component <component-id> --work-item <work-item-id>
dev-nexus coordination handoff <project-root> <work-item-id> --component <component-id> --status ready --worktree <path>
dev-nexus coordination integrate <project-root> --component <component-id> --work-item <work-item-id>
```

Run an agent launch loop when the project is configured for automation:

```bash
dev-nexus automation run-once <project-root>
dev-nexus automation schedule <project-root> --max-runs 1
dev-nexus automation coordinator-loop <project-root> --max-runs 1
```

For chat-driven runs where final JSON is still needed, keep stdout machine
readable and stream low-volume progress events to stderr:

```bash
dev-nexus automation coordinator-loop <project-root> --max-runs 1 --json --progress-jsonl
```

Use current-agent adoption when an already-running agent should proceed under
the same result-file contract without spawning a child process:

```bash
dev-nexus automation current-agent adopt <project-root> --run-id current-1 --json
dev-nexus automation current-agent record <project-root> --run-id current-1 --status completed --summary "Completed requested work."
```

## More Documentation

- [Getting started](docs/user/getting-started.md) covers installation, project
  layout, setup checks, portable paths, and tracker basics.
- [Multi-tracker work tracking](docs/user/multi-tracker.md) covers tracker
  bindings, default tracker behavior, link records, dry-run sync planning,
  one-way sync limits, and local-to-shared-provider migration guidance.
- [Agent workflows](docs/user/agent-workflows.md) covers MCP tools, work-item
  commands, worktree-first chat workflows, automation loops, result files, and
  coordination handoffs.
- [Architecture notes](docs/dev/architecture.md) covers project boundaries,
  components, plugin capabilities, worker context, automation internals, and
  source development.

## Project Boundary

DevNexus is infrastructure. It launches configured tools, exposes project
context, prepares support files, and records reported facts. It does not choose
implementation work, assign subagents, review code, or bypass provider safety
policy. Those decisions belong to the human operator or the launched
coordinator agent.
