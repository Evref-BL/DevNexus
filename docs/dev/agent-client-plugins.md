# Agent-client plugin policy

This policy covers the repo-local Codex and Claude Code plugin prototypes for
DevNexus. It records the approved defaults for MCP exposure, runtime setup,
distribution, and uninstall behavior.

The goal is to make DevNexus easy to diagnose from an agent client without
turning every plugin install into a broad write-capable control plane.

## Current status

The Codex and Claude Code plugins are local prototypes in this source tree.
They are not public marketplace packages, and they are not approved for
workspace-shared distribution yet.

The active plugin directories are:

- `plugins/dev-nexus-codex`
- `plugins/dev-nexus-claude`

Each plugin has its own manifest, MCP config, wrapper script, README, and
agent-native skills. They share DevNexus source code and adapter behavior.

Smoke-test scope and live-client gates are recorded in
[`agent-client-plugin-smoke.md`](agent-client-plugin-smoke.md).

## Default MCP profile

The default profile is read-mostly and setup-safe. It should help a user or
agent answer these questions before work starts:

- Is this a DevNexus workspace?
- Which components, trackers, targets, and blockers are configured?
- Is agent support projected correctly?
- Is the selected runtime present and current enough?
- Is MCP configuration missing, stale, or unsupported?
- What is the next approval-required repair action?

The default profile should expose status, setup, diagnosis, target-report,
coordination-status, and read-only work-item operations. It may expose handoff
or comment operations only when the client approval model clearly presents the
mutation and the workspace policy allows it.

The default profile must not silently expose broad write or live-runtime
surfaces just because the local `dev_nexus` MCP server supports them.

## Full profile

A full or write-capable profile is explicit opt-in. It may include mutation
tools for experienced users and controlled automation, but it must not be the
default install shape.

The full profile can include:

- work-item claim, update, status, sync, and import operations
- worktree preparation and coordination mutations
- hosting plan/apply paths
- publication and pull-request operations
- remote execution request/result operations
- package/runtime repair commands
- live runtime or provider-writing actions

The client must still enforce approval, authority, credential, and provider
policy. A full profile does not bypass DevNexus authority checks.

## Tools kept behind explicit commands

These actions stay behind explicit CLI commands, explicit full-profile
selection, or a human approval gate:

- global or plugin-local package installation
- shell profile edits
- provider credential writes
- provider-side issue, PR, repository, collaborator, or invitation writes
- workspace sharing
- public marketplace publication
- destructive cleanup
- remote execution
- live Codex or Claude Code client smoke tests

The plugin wrapper can report recovery commands, but it must not run them
without approval.

## Runtime policy

Plugins must not assume a global `dev-nexus` command silently. Runtime
resolution remains explicit and visible.

Supported runtime modes are:

- source-current runtime from a built DevNexus checkout
- project-local runtime
- plugin-local runtime under an explicit plugin data root
- `PATH` runtime
- manually configured global command

Missing runtime is a setup problem, not a reason to install automatically. The
setup and doctor paths should report the missing mode and the exact command a
user can approve.

For Claude Code, plugin-local runtime data belongs under
`${CLAUDE_PLUGIN_DATA}` when that mode is chosen. The baseline prototype reads
that location but does not install packages into it.

## Context budget

The default profile should stay small. Prefer grouped status and setup checks
over exposing many specialized tools in the first install shape. When a plugin
has a broad MCP surface, prefer routing it through the DevNexus MCP gateway and
using gateway groups to expose only the server or tools that belong in the
default profile.

Diagnostics should flag:

- plugin MCP tools that duplicate core `dev_nexus` tools
- stale or unexpected MCP command lines or HTTP endpoints
- missing MCP config
- stale MCP gateway discovery metadata
- gateway groups that hide every routed tool
- missing projected skills
- unsupported client targets
- excessive or write-heavy plugin surfaces in a default profile

Plugin MCP servers are for additive domain behavior. Generic workspace,
setup, worktree, automation, coordination, and work-item operations belong to
the core `dev_nexus` server.

## Distribution policy

The approved distribution sequence is:

1. Repo-local dogfood plugins.
2. Personal local install or side-load testing.
3. Team or workspace-shared distribution after no-network and live-client
   smoke tests pass.
4. Public marketplace publication only after a separate release approval.

Codex and Claude ship as separate plugin folders in one source tree for now.
They can later become separate packages if marketplace rules or client
install mechanics require it.

Version compatibility should be tied to the `@evref-bl/dev-nexus` package and
the adapter wrapper API. A plugin release must state the compatible DevNexus
version range and should fail loudly when the local runtime is missing or too
old.

## Security and authority

Plugins do not weaken DevNexus authority policy. Provider writes still require
the configured actor, auth profile, and policy path.

Human-account defaults are for manual human actions. Agent-created Git,
GitHub, tracker, bridge, publication, or package activity must use the
configured automation actor unless the user explicitly chooses otherwise.

Plugin manifests, skills, and wrapper scripts must not contain credentials,
tokens, private key paths, or host-local secrets.

## Disable and uninstall

Disabling or uninstalling a plugin removes only plugin client integration
state. It must preserve durable DevNexus workspace state:

- `dev-nexus.project.json`
- `.dev-nexus/` workspace metadata
- work-item records and tracker links
- target-cycle facts
- coordination handoffs
- worktrees and source checkouts
- setup records

Cleanup may remove generated agent-native support files only when DevNexus can
classify them as generated cleanup-safe support state. Manual files and
source-controlled files need separate human review.

## Live smoke gate

Live Codex and Claude Code client execution remains a human-in-the-loop gate.
Before running a live smoke, record:

- client name and version
- plugin path or install source
- runtime mode
- workspace root
- commands run
- approval scope
- outcome and classified failures

No live client smoke, package install, workspace sharing, or marketplace
publication is approved by this policy note.

Use [`agent-client-plugin-smoke.md`](agent-client-plugin-smoke.md) for the
current no-network smoke command, live-client checklist, and failure
classification rules.
