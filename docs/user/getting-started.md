# Getting Started

This guide is the normal first-workspace path. A DevNexus workspace is the
directory you open in an agent such as Codex. Components are the source folders
or artifacts that workspace coordinates.

Read [Concepts](concepts.md) when a term is unfamiliar.

## Requirements

- Node.js 22 or newer.
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

If you are running from a newer source checkout and need to check whether the
shell command is stale, run the source CLI and inspect `dev-nexus` on `PATH`:

```bash
node /path/to/dev-nexus/dist/cli.js diagnostics cli-version-skew --installed-command dev-nexus --json
```

## Create The First Workspace

Create or choose the directory you want to use as the DevNexus workspace root.
From that directory, start the guided init command:

```bash
dev-nexus workspace init
```

For a user in a terminal, init asks the minimum first-workspace questions. The
DevNexus home defaults to `~/.dev-nexus`, so most users do not need to choose
one.

Choose what you are setting up:

The wizard asks this early because it controls whether the primary component
starts at `.` or under `components/<id>`.

- **Embedded project layout:** run init where the workspace root should also be
  the primary component source root and accept `.` as the primary component
  source path. DevNexus files live next to the project files, like Maven,
  Gradle, Cargo, or editor configuration. You can still add related components.
- **Coordination workspace layout:** run init from a new workspace directory and
  accept `components/<id>` for new workspace-local components, or type existing
  paths for repositories and folders you want the workspace to coordinate.

Setup creates or updates:

- `dev-nexus.project.json`
- `.dev-nexus/` support state
- `AGENTS.md`
- workspace-local agent configuration, such as `.codex/config.toml`
- local work-item stores when local tracking is enabled
- the home registry entry under `~/.dev-nexus`

Provider mutations are not part of setup. Creating provider repositories,
repairing collaborators, accepting invitations, pushing branches, or publishing
packages are explicit later steps.

## Open The Right Directory

Open the DevNexus workspace root in the agent:

```text
the directory where you ran dev-nexus workspace init
```

Use the DevNexus workspace root as the agent workspace when you expect DevNexus
tools and generated agent context. Components are the things the workspace
coordinates.

After opening the workspace, ask the agent to:

1. read `AGENTS.md`
2. verify DevNexus readiness
3. inspect the components
4. create or triage the first work item

Copy-paste prompt:

```text
Open this directory as the DevNexus workspace root. Read AGENTS.md.
Run dev-nexus workspace status . and dev-nexus setup check . join-existing-project.
Then inspect the components and create or triage the first component work item. Treat DevNexus as infrastructure; I still choose the work.
```

Useful checks:

```bash
dev-nexus workspace status .
dev-nexus setup check . join-existing-project
```

The workspace is ready when `workspace status` succeeds, setup check is not
blocked, `AGENTS.md` exists, and your agent config was generated, such as
`.codex/config.toml` for Codex or `.mcp.json` for Claude.

In embedded project layout, setup check may warn that DevNexus setup files are
uncommitted. Review and commit those files when the embedded workspace
configuration is correct. Unrelated dirty product files still block readiness.

## Add Existing Components

A DevNexus workspace can coordinate several existing folders. For example, one
workspace might point to an API repository, a frontend repository, a shared
library, and a load-test harness.

Use one DevNexus workspace with several components for a shared agent workspace.
`workspace import` fits the narrower case where one existing source checkout
becomes the primary component of a new workspace.

See [First workspace from existing components](first-workspace-existing-components.md)
for a full example.

## Add Components Later

After the first setup, add components with the component-add flow instead of
manual JSON editing:

```bash
dev-nexus workspace component add <workspace-root> --answers ./component-add.json --dry-run --json
dev-nexus workspace component add <workspace-root> --answers ./component-add.json --json
```

The preview reports common topology mistakes before writing. It checks for
container folders with nested repositories, non-Git folders, branch or remote
drift, and stable component source roots placed under generated `worktrees/`.

## Work Items

Create tasks on the component that owns the work:

```bash
dev-nexus work-item create <workspace-root> --component <component-id> --title "Implement focused task" --status ready
dev-nexus work-item list <workspace-root> --component <component-id>
```

Local tracking is enough for a first workspace. Provider-backed trackers such as
GitHub, GitLab, or Jira can be added later.

## Agent Configuration

Setup generates files only for the active agent targets selected by the
workspace. Choose the providers this workspace actually uses, such as Codex-only,
Claude-only, OpenCode/manual, or a deliberate multi-provider setup.

When workspace configuration changes, refresh generated support:

```bash
dev-nexus workspace mcp refresh <workspace-root> --agent codex
dev-nexus workspace mcp refresh <workspace-root> --agent claude
```

Codex targets write `.codex/config.toml`. Claude targets write `.mcp.json`.

Model Context Protocol, or MCP, is the protocol agents use to call DevNexus
tools. A raw `dev-nexus mcp-stdio` smoke test only proves the server command can
start. The agent session is ready when the active agent exposes those tools in
the opened DevNexus workspace.

See [Agent targets and projection cleanup](agent-targets.md) for provider
examples, active target configuration, and stale generated support cleanup.

## Answer Files

Answer files are useful for agents, CI, repeatable onboarding, and documented
examples:

```bash
dev-nexus workspace init <workspace-root> --answers ./dev-nexus.setup.json --dry-run --json
dev-nexus workspace init <workspace-root> --answers ./dev-nexus.setup.json --json
```

The preview command prints planned local writes. The apply command writes local
workspace files. Raw tokens, passwords, private keys, SSH keys, and provider CLI
state do not belong in answer files.

Answer files may reference host-local credential context by id, such as a
GitHub App installation profile, GitHub App user-to-server profile, GitHub CLI
profile, GitLab CLI profile, environment-variable name, or token store id. See
[Providers, auth, and hosting](providers-auth-hosting.md).

## Low-Level Commands

`workspace init` is the first-workspace command.

Use `workspace create` only when you want a low-level local scaffold. Use
`workspace import <source-root>` only when one existing source checkout should
become the primary component of a new DevNexus workspace.

## Advanced Workflows

- [Agent workflows](agent-workflows.md) explains worktrees, automation loops,
  result files, and coordination handoffs.
- [Agent targets and projection cleanup](agent-targets.md) explains supported
  providers, active targets, generated support, and stale provider files.
- [Multi-tracker work tracking](multi-tracker.md) explains local and provider
  trackers, link records, and sync planning.
- [Providers, auth, and hosting](providers-auth-hosting.md) explains GitHub
  Apps, user accounts, machine-user accounts, provider CLI profiles, and
  workspace repository hosting.
