# DevNexus

DevNexus helps you work with agents on real projects.

It creates a small directory for agent collaboration. That directory contains
the files agents need to understand the work, the list of source folders or
artifacts they may need, a task list, and the support configuration for tools
such as Codex or Claude.

Think of it like a Maven or Gradle workspace root, but for agent-assisted work
instead of a single build. The DevNexus workspace root can be the project
repository itself, or a separate directory that points to several repositories,
documents, or other folders.

DevNexus records structure and facts. A user or agent still chooses the work,
edits code, reviews changes, verifies results, and decides what to publish.

## Install

DevNexus requires Node.js 22 or newer.

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
- A **work item** is the neutral tracker record owned by a component. It can
  represent a task, bug, story, Product Backlog Item, epic, feature, or
  impediment, depending on the component's tracker conventions. Work items can
  live in DevNexus' local tracker or in providers such as GitHub, GitLab, or
  Jira.
- The **DevNexus home** is user-local state, normally `~/.dev-nexus`. Most
  users do not need to choose or manage it.
- **Agent files** are generated files such as `AGENTS.md`, skills, context, and
  Model Context Protocol configuration. Model Context Protocol, or MCP, is how
  agents can call DevNexus tools from a workspace session.
- A **worktree** is an isolated Git checkout for a focused change. Agents use
  worktrees so parallel chats do not edit the same checkout.

When working from a newer source checkout while the shell `dev-nexus` command
may still point at an older global install, run the source CLI and inspect the
shell command explicitly:

```bash
node /path/to/dev-nexus/dist/cli.js diagnostics cli-version-skew --installed-command dev-nexus --json
```

Generated MCP config pins the active CLI script path during `workspace mcp
refresh`, so agent sessions do not silently inherit a stale global
`dev-nexus mcp-stdio` runtime.

## Quick Start

Create or choose a directory for the DevNexus workspace. From that directory,
run:

```bash
dev-nexus workspace init
```

The init command uses `~/.dev-nexus` as the default home, uses or asks for the
workspace root, asks what you are setting up, creates local work tracking by
default, and generates agent files.
Choose `project` when the workspace root is also the primary component source
root, usually an existing Git repository. You can still add related components.
Choose `workspace` when a separate DevNexus root should coordinate components;
the primary component defaults to `components/<id>` unless you type another path.
See [Getting started](docs/user/getting-started.md) for what those choices mean.

After init:

```bash
dev-nexus workspace status .
```

Open the DevNexus workspace root when you want DevNexus support in the agent.
Component repositories stay as components the workspace points to.

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

Use one `workspace init` run for that shape. Create separate DevNexus workspaces
only when you want separate agent workspaces and separate workspace state.

For a detailed version of this example, see
[First workspace from existing components](docs/user/first-workspace-existing-components.md).

## Agent And CI Setup

Users should usually start with the interactive command:

```bash
dev-nexus workspace init
```

Agents, CI jobs, and reproducible onboarding scripts can use answer files:

```bash
dev-nexus workspace init <workspace-root> --answers ./dev-nexus.setup.json --dry-run --json
dev-nexus workspace init <workspace-root> --answers ./dev-nexus.setup.json --json
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
publication policy, see [Agent workflows](docs/user/agent-workflows.md) and
[Publication workflows](docs/user/publication-workflows.md).

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
  GitHub Apps, user-to-server profiles, GitHub CLI profiles, GitLab, Jira, user
  accounts, machine-user accounts, and workspace repository hosting.
- [Publication workflows](docs/user/publication-workflows.md) explains the
  simple review-handoff default and the optional green-main, CI tier, and
  release train paths.
- [Agent targets and projection cleanup](docs/user/agent-targets.md) explains
  supported providers, active targets, generated support, and stale provider
  files.
- [Agent workflows](docs/user/agent-workflows.md) covers MCP tools, worktrees,
  automation loops, result files, and coordination handoffs.
- [PostgreSQL claim authority](docs/user/postgresql-claim-authority.md) explains
  the opt-in shared claim backend, setup steps, lease policy, and references for
  the heartbeat defaults.
- [Multi-tracker work tracking](docs/user/multi-tracker.md) covers local and
  provider-backed trackers.
- [Architecture notes](docs/dev/architecture.md) covers internal design.

## Source Development

```bash
npm install
npm run check
```

`npm run check` includes `npm run smoke:onboarding`, which packs the local
package, installs it into a fresh temporary npm project, initializes a first
workspace from an answer file, and verifies `workspace status` plus `setup
check`.

DevNexus is infrastructure. It gives agents a shared operating context; it does
not replace user judgment, workspace ownership, verification, or publication
policy.
