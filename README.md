# DevNexus

DevNexus helps you work with agents on real projects.

It creates a small directory for agent collaboration. That directory contains
the files agents need to understand the work, the list of source folders or
artifacts they may need, a task list, and the support configuration for tools
such as Codex or Claude.

Think of it like a Maven or Gradle workspace root, but for agent-assisted work
instead of a single build. You open the DevNexus workspace root in your agent, and
the workspace root points to the repositories, documents, or other folders you
want to work on.

DevNexus records structure and facts. A user or agent still chooses the work,
edits code, reviews changes, verifies results, and decides what to publish.

## Install

DevNexus requires Node.js 24 or newer.

```bash
npm install -g @evref-bl/dev-nexus
dev-nexus --help
```

If an agent reads this README from GitHub while using an older npm package, ask
it to check for command skew before following examples:

```bash
dev-nexus diagnostics cli-version-skew --json
```

## Terms

- A **DevNexus workspace** is the directory you open in Codex, Claude, or another
  agent. It contains `dev-nexus.project.json`, `AGENTS.md`, generated agent
  files, and `.dev-nexus/` support state.
- A **component** is something the workspace works on, such as a Git repository,
  service, library, documentation folder, dataset, spreadsheet, or support
  folder. One DevNexus workspace can have many components.
- A **provider** is an external tool or service DevNexus can reference, such as
  GitHub, GitLab, Jira, Codex, or Claude.
- A **work item** is a task or issue owned by a component. Work items can live
  in DevNexus' local tracker or in providers such as GitHub, GitLab, or Jira.
- The **DevNexus home** is user-local state, normally `~/.dev-nexus`. Most
  users do not need to choose or manage it.
- **Agent files** are generated files such as `AGENTS.md`, skills, context, and
  Model Context Protocol configuration. Model Context Protocol, or MCP, is how
  agents can call DevNexus tools from a workspace session.
- A **worktree** is an isolated Git checkout for a focused change. Agents use
  worktrees so parallel chats do not edit the same checkout.

## Quick Start

Create or choose a directory for the DevNexus workspace. From that directory,
run:

```bash
dev-nexus workspace setup
```

The setup command guides you through the first workspace. It uses `~/.dev-nexus`
as the default home, uses or asks for the workspace root, asks for the primary
component and any extra components, creates local work tracking by default, and
generates agent files.

After setup:

```bash
dev-nexus workspace status .
```

Do not open the component repository as the agent workspace when you want
DevNexus support. Open the DevNexus workspace root. The component repositories
are the things DevNexus points to.

Copy-paste prompt for Codex or Claude:

```text
Open this directory as the DevNexus workspace root. Read AGENTS.md.
Run dev-nexus workspace status . and dev-nexus setup check . join-existing-project.
Then inspect the components and create or triage the first component work item. Treat DevNexus as infrastructure; I still choose the work.
```

Ready means `dev-nexus workspace status` succeeds, `dev-nexus setup check` is not
blocked, `AGENTS.md` exists, and an agent MCP config such as
`.codex/config.toml` or `.mcp.json` was generated.

## Example

If you want one agent workspace for an API, a frontend, a shared library, and a
load-test harness, create one DevNexus workspace with four components:

```text
DevNexus workspace: ~/dev-nexus/rocket-shop-suite

Components:
- checkout-api
- storefront
- shared-kernel
- load-test-lab
```

Use one `workspace setup` run for that shape. Do not create four DevNexus
workspaces unless you truly want four separate agent workspaces.

For a detailed version of this example, see
[First workspace from existing components](docs/user/first-workspace-existing-components.md).

## Agent And CI Setup

Users should usually start with the interactive command:

```bash
dev-nexus workspace setup
```

Agents, CI jobs, and reproducible onboarding scripts can use answer files:

```bash
dev-nexus workspace setup <workspace-root> --answers ./dev-nexus.setup.json --json
dev-nexus workspace setup <workspace-root> --answers ./dev-nexus.setup.json --yes
```

The first command previews local writes. The second applies them. Provider
mutations, such as creating provider repositories or repairing collaborator
access, stay behind separate hosting commands.

## Common Next Steps

Check that the workspace is ready:

```bash
dev-nexus workspace status <workspace-root>
dev-nexus setup check <workspace-root> join-existing-project
dev-nexus host check <workspace-root> --json
```

`host check` is read-only. It summarizes the current or configured host's
platform, shell kind, DevNexus, Git, Node, configured host capabilities, and
visible MCP server configuration without printing host-local paths.

Create a component-scoped work item:

```bash
dev-nexus work-item create <workspace-root> --component <component-id> --title "Implement focused task" --status ready
dev-nexus work-item list <workspace-root> --component <component-id>
```

Prepare an isolated worktree for implementation:

```bash
dev-nexus worktree prepare <workspace-root> --component <component-id> --work-item <work-item-id>
```

For provider-native issue fixes, pull requests, required checks, automation, and
publication policy, see [Agent workflows](docs/user/agent-workflows.md).

Refresh generated agent configuration when workspace settings change:

```bash
dev-nexus workspace mcp refresh <workspace-root> --agent codex
```

## Documentation

- [Getting started](docs/user/getting-started.md) gives the full first-workspace
  path.
- [Concepts](docs/user/concepts.md) explains the workspace model and vocabulary.
- [First workspace from existing components](docs/user/first-workspace-existing-components.md)
  shows how to coordinate several existing folders in one workspace.
- [Providers, auth, and hosting](docs/user/providers-auth-hosting.md) covers
  GitHub, GitLab, Jira, bot accounts, user accounts, and workspace repository
  hosting.
- [Agent targets and projection cleanup](docs/user/agent-targets.md) explains
  supported providers, active targets, generated support, and stale provider
  files.
- [Agent workflows](docs/user/agent-workflows.md) covers MCP tools, worktrees,
  automation loops, result files, and coordination handoffs.
- [Multi-tracker work tracking](docs/user/multi-tracker.md) covers local and
  provider-backed trackers.
- [Architecture notes](docs/dev/architecture.md) covers internal design.

## Source Development

```bash
npm install
npm run check
```

DevNexus is infrastructure. It gives agents a shared operating context; it does
not replace user judgment, workspace ownership, verification, or publication
policy.
