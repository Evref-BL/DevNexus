# Getting Started

This guide is the normal first-project path. A DevNexus project is the
directory you open in an agent such as Codex. Components are the source folders
or artifacts that project coordinates.

Read [Concepts](concepts.md) when a term is unfamiliar.

## Requirements

- Node.js 24 or newer.
- Git, if any component is a Git repository.
- An agent you plan to use, such as Codex or Claude.

Install DevNexus:

```bash
npm install -g @evref-bl/dev-nexus
dev-nexus --help
```

If the README or docs are from GitHub `main` but the installed npm package is
older, check for command differences:

```bash
dev-nexus diagnostics cli-version-skew --json
```

## Create The First Project

Start with the guided setup command:

```bash
dev-nexus project setup "$HOME/dev-nexus/example-suite"
```

For a human in a terminal, setup should ask the minimum first-project
questions. The DevNexus home defaults to `~/.dev-nexus`, so most users do not
need to choose one.

Setup creates or updates:

- `dev-nexus.project.json`
- `.dev-nexus/` support state
- `AGENTS.md`
- project-local agent configuration, such as `.codex/config.toml`
- local work-item stores when local tracking is enabled
- the home registry entry under `~/.dev-nexus`

Provider mutations are not part of setup. Creating GitHub repositories,
repairing collaborators, accepting invitations, pushing branches, or publishing
packages are explicit later steps.

## Open The Right Directory

Open the DevNexus project root in the agent:

```text
$HOME/dev-nexus/example-suite
```

Do not open a component repository when you expect DevNexus tools and generated
agent context. Components are the things the project coordinates. The DevNexus
project root is the agent workspace.

After opening the project, ask the agent to:

1. read `AGENTS.md`
2. verify DevNexus readiness
3. inspect the components
4. create or triage the first work item

Useful checks:

```bash
dev-nexus project status "$HOME/dev-nexus/example-suite"
dev-nexus setup check "$HOME/dev-nexus/example-suite" join-existing-project
```

## Add Existing Components

A DevNexus project can coordinate several existing folders. For example, one
project might point to a benchmark repository, two support repositories, and a
paper.

Use one DevNexus project with several components. Do not run `project import`
once per repository if the goal is one shared agent workspace.

See [First project from existing components](first-project-existing-components.md)
for a full example.

## Add Components Later

After the first setup, add components with the component-add flow instead of
manual JSON editing:

```bash
dev-nexus project component add <project-root> --answers ./component-add.json --json
dev-nexus project component add <project-root> --answers ./component-add.json --yes
```

The preview reports common topology mistakes before writing. It checks for
container folders with nested repositories, non-Git folders, branch or remote
drift, and stable component source roots placed under generated `worktrees/`.

## Work Items

Create tasks on the component that owns the work:

```bash
dev-nexus work-item create <project-root> --component <component-id> --title "Implement focused task" --status ready
dev-nexus work-item list <project-root> --component <component-id>
```

Local tracking is enough for a first project. Provider-backed trackers such as
GitHub, GitLab, or Jira can be added later.

## Agent Configuration

Setup generates agent files. When project configuration changes, refresh them:

```bash
dev-nexus project mcp refresh <project-root> --agent codex
dev-nexus project mcp refresh <project-root> --agent claude
```

Codex targets write `.codex/config.toml`. Claude targets write `.mcp.json`.

Model Context Protocol, or MCP, is the protocol agents use to call DevNexus
tools. A raw `dev-nexus mcp-stdio` smoke test only proves the server command can
start. The agent session is ready when the active agent exposes those tools in
the opened DevNexus project.

## Answer Files

Answer files are useful for agents, CI, repeatable onboarding, and documented
examples:

```bash
dev-nexus project setup <project-root> --answers ./dev-nexus.setup.json --json
dev-nexus project setup <project-root> --answers ./dev-nexus.setup.json --yes
```

The preview command prints planned local writes. The apply command writes local
project files. Raw tokens, passwords, private keys, SSH keys, and provider CLI
state do not belong in answer files.

Answer files may reference host-local credential context by id, such as a
GitHub CLI profile, GitLab CLI profile, environment-variable name, or token
store id. See [Providers, auth, and hosting](providers-auth-hosting.md).

## Low-Level Commands

`project setup` is the first-project command.

Use `project create` only when you want a low-level local scaffold. Use
`project import <source-root>` only when one existing source checkout should
become the primary component of a new DevNexus project.

## Advanced Workflows

- [Agent workflows](agent-workflows.md) explains worktrees, automation loops,
  result files, and coordination handoffs.
- [Multi-tracker work tracking](multi-tracker.md) explains local and provider
  trackers, link records, and sync planning.
- [Providers, auth, and hosting](providers-auth-hosting.md) explains human
  accounts, bot accounts, provider CLI profiles, and meta-repository hosting.
