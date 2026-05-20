# DevNexus

DevNexus helps you work with agents on real projects.

It creates a small directory for agent collaboration. That directory contains
the files agents need to understand the work, the list of source folders or
artifacts they may need, a task list, and the support configuration for tools
such as Codex or Claude.

Think of it like a Maven or Gradle project root, but for agent-assisted work
instead of a single build. You open the DevNexus project root in your agent, and
the project root points to the repositories, documents, or other folders you
want to work on.

DevNexus records structure and facts. A human or agent still chooses the work,
edits code, reviews changes, verifies results, and decides what to publish.

## Terms

- A **DevNexus project** is the directory you open in Codex, Claude, or another
  agent. It contains `dev-nexus.project.json`, `AGENTS.md`, generated agent
  files, and `.dev-nexus/` support state.
- A **component** is something the project works on, such as a Git repository,
  paper, dataset, spreadsheet, or support folder. One DevNexus project can have
  many components.
- A **provider** is an external tool or service DevNexus can reference, such as
  GitHub, GitLab, Jira, Codex, or Claude.
- A **work item** is a task or issue owned by a component. Work items can live
  in DevNexus' local tracker or in providers such as GitHub, GitLab, or Jira.
- The **DevNexus home** is user-local state, normally `~/.dev-nexus`. Most
  users do not need to choose or manage it.
- **Agent files** are generated files such as `AGENTS.md`, skills, context, and
  Model Context Protocol configuration. Model Context Protocol, or MCP, is how
  agents can call DevNexus tools from a project session.
- A **worktree** is an isolated Git checkout for a focused change. Agents use
  worktrees so parallel chats do not edit the same checkout.

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

## Quick Start

Create one DevNexus project for the work you want agents to understand.

```bash
dev-nexus project setup "$HOME/dev-nexus/example-suite"
```

The setup command guides you through the first project. It uses `~/.dev-nexus`
as the default home, asks for the project root, asks which components belong to
the project, creates local work tracking by default, and generates agent files.

After setup:

```bash
dev-nexus project status "$HOME/dev-nexus/example-suite"
```

Then open this directory in Codex, Claude, or your agent:

```text
$HOME/dev-nexus/example-suite
```

Do not open the component repository as the agent project when you want
DevNexus support. Open the DevNexus project root. The component repositories
are the things DevNexus points to.

Copy-paste prompt for Codex or Claude:

```text
Open $HOME/dev-nexus/example-suite as the DevNexus project root. Read AGENTS.md.
Run dev-nexus project status "$HOME/dev-nexus/example-suite" and dev-nexus setup check "$HOME/dev-nexus/example-suite" join-existing-project.
Then inspect the components and create or triage the first component work item. Treat DevNexus as infrastructure; I still choose the work.
```

Ready means `dev-nexus project status` succeeds, `dev-nexus setup check` is not
blocked, `AGENTS.md` exists, and an agent MCP config such as
`.codex/config.toml` or `.mcp.json` was generated.

## Example

If you want one agent workspace for a benchmark repository, two supporting
repositories, and a paper, create one DevNexus project with four components:

```text
DevNexus project: ~/dev-nexus/graphrag-research-suite

Components:
- benchmark-graphrag
- json-java-moose
- json-java-no-moose
- iwst-paper
```

Use one `project setup` run for that shape. Do not create four DevNexus
projects unless you truly want four separate agent workspaces.

For a detailed version of this example, see
[First project from existing components](docs/user/first-project-existing-components.md).

## Agent And CI Setup

Humans should usually start with the interactive command:

```bash
dev-nexus project setup <project-root>
```

Agents, CI jobs, and reproducible onboarding scripts can use answer files:

```bash
dev-nexus project setup <project-root> --answers ./dev-nexus.setup.json --json
dev-nexus project setup <project-root> --answers ./dev-nexus.setup.json --yes
```

The first command previews local writes. The second applies them. Provider
mutations, such as creating GitHub repositories or repairing collaborator
access, stay behind separate hosting commands.

## Common Next Steps

Check that the project is ready:

```bash
dev-nexus project status <project-root>
dev-nexus setup check <project-root> join-existing-project
dev-nexus host check <project-root> --json
```

`host check` is read-only. It summarizes the current or configured host's
platform, shell kind, DevNexus, Git, Node, configured host capabilities, and
visible MCP server configuration without printing host-local paths.

Create a component-scoped work item:

```bash
dev-nexus work-item create <project-root> --component <component-id> --title "Implement focused task" --status ready
dev-nexus work-item list <project-root> --component <component-id>
```

Prepare an isolated worktree for implementation:

```bash
dev-nexus worktree prepare <project-root> --component <component-id> --work-item <work-item-id>
```

For a one-issue provider-native fix, preview the compact quick-fix path:

```bash
dev-nexus quick-fix plan <project-root> --component <component-id> --work-item github-50
dev-nexus quick-fix start <project-root> --component <component-id> --work-item github-50
dev-nexus quick-fix finish <project-root> --component <component-id> --work-item github-50 --pr-url <url> --merge-commit <sha> --verification "npm run check passed"
```

After opening a green-main pull request, evaluate required checks from saved
GitHub check data before merging:

```bash
gh pr checks <pr-number> --repo <owner/repo> --required --json name,state,bucket,conclusion,link,workflow > checks.json
dev-nexus publication green-main plan <project-root> --component <component-id> --pr <pr-number> --checks-file checks.json
```

The helper refuses merge commands while required checks are pending, failed,
stale, missing, or unknown. A single failed-run rerun is proposed only when the
caller passes `--allow-rerun --rerun-reason <text>`.

Refresh generated agent configuration when project settings change:

```bash
dev-nexus project mcp refresh <project-root> --agent codex
```

## Documentation

- [Getting started](docs/user/getting-started.md) gives the full first-project
  path.
- [Concepts](docs/user/concepts.md) explains the project model and vocabulary.
- [First project from existing components](docs/user/first-project-existing-components.md)
  shows how to coordinate several existing folders in one project.
- [Providers, auth, and hosting](docs/user/providers-auth-hosting.md) covers
  GitHub, GitLab, Jira, bot accounts, human accounts, and meta-repository
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
not replace human judgment, project ownership, verification, or publication
policy.
