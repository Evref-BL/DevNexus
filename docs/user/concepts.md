# Concepts

DevNexus is infrastructure for agent-assisted project work. It gives humans and
agents one place to find project structure, component relationships, work
items, generated agent context, setup checks, and recorded coordination facts.

DevNexus does not decide what to build. The human operator or the agent working
in the project chooses the work and reports results back.

## Project

A DevNexus project is the directory you open in an agent.

The project root contains:

- `dev-nexus.project.json`, the shared project configuration
- `AGENTS.md`, the first file agents should read
- `.dev-nexus/`, support state such as work items, target facts, leases, and
  setup records
- generated agent configuration, such as `.codex/config.toml` or `.mcp.json`

One DevNexus project can coordinate one component or many components.

## Component

A component is something the project works on. Common components are Git
repositories, documentation folders, research papers, datasets, spreadsheets,
or generated support folders.

Each component can have its own:

- source root
- worktree root
- work-item tracker
- verification commands
- publication policy
- relationships to other components

Use one DevNexus project with several components when one agent workspace needs
to understand related repositories or artifacts together.

## Home

The DevNexus home is user-local state. The default is `~/.dev-nexus`.

The home can store a registry of projects and host-local setup facts. It is not
the project root and it is not where component source code normally lives.

Most users should let DevNexus use the default home.

## Work Item

A work item is a task or issue owned by a component.

DevNexus supports a lightweight local tracker for immediate use. Components can
also use provider-backed trackers such as GitHub Issues, GitLab issues, or
Jira. A component can have several trackers when local work, shared provider
issues, feedback, planning, or migration need separate roles.

## Agent Files

Agent files are generated support files that make the project usable from an
agent session.

Examples include:

- `AGENTS.md`
- projected skills
- project context files
- `.codex/config.toml`
- `.mcp.json`

Model Context Protocol, or MCP, is how agents call DevNexus tools from inside a
project session.

## Agent Target

An agent target is a provider this project actively prepares generated support
for. DevNexus can support several providers, but a project can intentionally
select only Codex, only Claude, OpenCode/manual setup, or several providers.

Active targets decide which MCP config files, skill directories, and
provider-specific setup notes should exist in the project. Stale generated
support for inactive providers should be reviewed before cleanup instead of
deleted blindly.

See [Agent targets and projection cleanup](agent-targets.md).

## Worktree

A worktree is an isolated Git checkout for a focused change.

Shared component checkouts are useful for inspection and integration. Mutating
agent work should normally happen in a prepared worktree so multiple chats can
work without editing the same files.

## Provider

A provider is an external system DevNexus can reference through a neutral
configuration model. Examples include GitHub, GitLab, Jira, Codex, Claude, and
future agent or tracker providers.

Provider credentials are host-local. Shared project config should reference
credential profiles by id, not store raw tokens or private keys.

## Target And Automation

A target is the requested outcome for an automation loop.

DevNexus can record target state, eligible work, cycle facts, agent launch
records, verification, and publication decisions. It still does not choose work
by itself; the coordinator or human does.
