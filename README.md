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

For source development:

```bash
npm install
npm run check
```

## Quick Start

Initialize a DevNexus home and create or import a project:

```bash
dev-nexus home init <home-path>
dev-nexus project create <name> --home <home-path>
dev-nexus project import <source-root> --home <home-path> --name <name>
dev-nexus project list --home <home-path>
```

Inspect a project root:

```bash
dev-nexus project status <project-root>
```

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

Check automation readiness:

```bash
dev-nexus automation status <project-root>
dev-nexus automation eligible-work <project-root> --json
dev-nexus automation agent-profiles <project-root> --json
```

## Core Concepts

- A **project** is the shared DevNexus orchestration context. It is configured
  by `dev-nexus.project.json` and stores project-level support records under
  `.dev-nexus/`.
- A **component** is a source or support unit in a project. Each component can
  have its own source root, Git defaults, generated worktree root, work-item
  service, verification hints, publication policy, and relationships.
- A **work-item service** is the tracker configured for a component, such as a
  local store, GitHub Issues, GitLab issues, Jira, or another provider adapter.
- A **target** is the user-requested outcome for an automation loop. DevNexus
  records target state and cycle facts, but it does not decide which work is
  selected.
- An **agent profile** describes launch infrastructure: executor, model or
  variant, command template, safety posture, and intended use.
- A **plugin** contributes additive capabilities such as projected skills, MCP
  servers, setup obligations, dependency projections, worker context, or
  cleanup guidance.

## Common Workflows

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
- [Agent workflows](docs/user/agent-workflows.md) covers MCP tools, work-item
  commands, automation loops, result files, and coordination handoffs.
- [Architecture notes](docs/dev/architecture.md) covers project boundaries,
  components, plugin capabilities, worker context, automation internals, and
  source development.

## Project Boundary

DevNexus is infrastructure. It launches configured tools, exposes project
context, prepares support files, and records reported facts. It does not choose
implementation work, assign subagents, review code, or bypass provider safety
policy. Those decisions belong to the human operator or the launched
coordinator agent.
