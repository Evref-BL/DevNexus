# Concepts

DevNexus is infrastructure for agent-assisted development work. It gives users and
agents one place to find workspace structure, component relationships, work
items, generated agent context, setup checks, and recorded coordination facts.

DevNexus does not decide what to build. The human operator or the agent working
in the workspace chooses the work and reports results back.

## Workspace

A DevNexus workspace is the directory you open in an agent.

The workspace root contains:

- `dev-nexus.project.json`, the shared workspace configuration
- `AGENTS.md`, the first file agents should read
- `.dev-nexus/`, support state such as work items, target facts, and setup
  records
- generated agent configuration, such as `.codex/config.toml` or `.mcp.json`

One DevNexus workspace can coordinate one component or many components.

## Component

A component is something the workspace works on. Common components are Git
repositories, documentation folders, datasets, spreadsheets, release assets, or
generated support folders.

Each component can have its own:

- source root
- worktree root
- work-item tracker
- verification commands
- publication policy
- relationships to other components

Use one DevNexus workspace with several components when one agent workspace needs
to understand related repositories or artifacts together.

## Home

The DevNexus home is user-local state. The default is `~/.dev-nexus`.

The home can store a registry of workspaces and host-local setup facts. It is not
the workspace root and it is not where component source code normally lives.

Most users should let DevNexus use the default home.

## Runtime State

DevNexus also records host-local runtime facts that should not dirty the
workspace checkout. Worktree leases are in this category: they are advisory
ownership hints for active branches and generated worktrees, not durable project
history. When the workspace is a Git repository, DevNexus stores worktree lease
state under Git metadata. It can still read the old tracked
`.dev-nexus/worktree-leases.json` file for migration compatibility.

## Work Item

A work item is a task or issue owned by a component.

DevNexus supports a lightweight local tracker for immediate use. Components can
also use provider-backed trackers such as GitHub Issues, GitLab issues, or
Jira. A component can have several trackers when local work, shared provider
issues, feedback, planning, or migration need separate roles.

## Agent Files

Agent files are generated support files that make the workspace usable from an
agent session.

Examples include:

- `AGENTS.md`
- projected skills
- workspace context files
- `.codex/config.toml`
- `.mcp.json`

Model Context Protocol, or MCP, is how agents call DevNexus tools from inside a
workspace session.

## Agent Target

An agent target is a provider this workspace actively prepares generated support
for. DevNexus can support several providers, but a workspace can intentionally
select only Codex, only Claude, OpenCode/manual setup, or several providers.

Active targets decide which MCP config files, skill directories, and
provider-specific setup notes should exist in the workspace. Stale generated
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

Provider credentials are host-local. Shared workspace config should reference
credential profiles by id, not store raw tokens or private keys.

## Target And Automation

A target is the requested outcome for an automation loop.

DevNexus can record target state, eligible work, cycle facts, agent launch
records, verification, and publication decisions. It still does not choose work
by itself; the coordinator or human does.
