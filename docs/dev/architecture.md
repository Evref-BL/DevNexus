# Architecture Notes

These notes describe the workspace boundaries behind the user-facing CLI.
They are intended for contributors changing DevNexus itself or adding provider
adapters and plugins.

## Product Boundary

DevNexus is orchestration infrastructure. It owns workspace metadata, component
graphs, work-tracker access, setup projections, agent launch context, locks,
run ledgers, target-cycle facts, verification records, publication policy, and
handoff records.

DevNexus does not choose implementation work, decide how many subagents to run,
review code, or supervise execution after launch. Those choices belong to the
human operator or the launched coordinator agent.

This boundary keeps the core generic. Runtime, language, framework, tracker,
and provider-specific behavior belongs in adapters or plugins.

## Workspace Config

`dev-nexus.project.json` is the shared workspace contract. Important top-level
areas are:

- `components`: source, tracker, verification, publication, and relationship
  configuration for each component.
- `mcp`: agent-facing Model Context Protocol (MCP) projection settings.
- `skills`: curated skill source and agent target projection settings.
- `plugins`: additive capability declarations.
- `automation`: launch policy, target policy, agent profiles, safety policy,
  ledgers, locks, and publication defaults.
- `hosting`: optional portable repository intent, declared remotes, required
  access, auth profile references, and provisioning gates. Provider mechanics
  such as repository creation, collaborator repair, pending invitations, and
  invitation acceptance stay behind hosting adapters.

Workspace support state lives under `.dev-nexus/`. Shared user-authored state and
generated local/runtime state should stay distinguishable so refresh commands
do not overwrite durable user intent.

## Components

Components are first-class. Each component can have its own:

- Stable `id` and display `name`.
- `sourceRoot` and component `worktreesRoot`.
- Git defaults and remote URL.
- Work-item service configuration.
- Verification hints.
- Publication policy.
- Relationships to other components.

Commands that predate multi-component support target the primary component
when no component id is provided. New code should preserve component ownership
and avoid collapsing component work into workspace-level state.

## Work-Tracking Providers

Work tracking is component-scoped. Provider adapters should expose neutral
work-item operations and capability flags instead of leaking provider-specific
workflow assumptions into coordinator code.

Useful capability questions include whether a provider can list, create, get,
update, comment, manage labels, manage assignees, use milestones, use a board,
or update board status. A provider can support neutral status updates without
supporting a board-status field.

## MCP Server

The generic MCP server should stay low-token and provider-neutral. It exposes
workspace status, setup, automation, coordination, target-cycle, target-report,
and work-item tools. It should report factual state and caller-submitted facts,
not infer hidden work or choose next actions.

When adding an MCP tool, keep the same boundary as the CLI:

- Validate workspace and component selection explicitly.
- Prefer stable ids and component-qualified refs.
- Return concise structured data that agents can use directly.
- Avoid live provider mutation unless the workspace policy and command path make
  that mutation explicit.

Agent-client plugins for Codex and Claude use a narrower default exposure
policy than the full core MCP server. The current policy is in
[Agent-client plugin policy](agent-client-plugins.md).

The MCP gateway is the low-context routing surface for large tool sets. It is a
small MCP server that exposes status, search, describe, call, and result-fetch
tools. Configured upstream MCP servers remain explicit workspace/plugin
capabilities; the gateway does not auto-run arbitrary local commands. For
plugin MCP servers without declared tool metadata, the gateway can initialize
stdio or HTTP upstream servers, call `tools/list`, and cache discovered metadata
under `.dev-nexus/runtime/mcp-gateway/`. Workspace and agent-level gateway
groups filter which configured servers and tools are searchable or callable.

## Plugin Capabilities

Plugins are additive capability records inside a DevNexus workspace. They do not
replace the core and they do not own orchestration decisions. Plugin MCP
servers expose additive domain surfaces; they are not alternate generic
DevNexus servers. Generic workspace, setup, coordination, worktree, automation,
and work-item operations belong to the core `dev_nexus` MCP server.

Core exposes a curated plugin catalogue for DevNexus-maintained plugin packages.
The catalogue is hardcoded metadata, not a scan of component source roots or a
public marketplace. This keeps install and refresh guidance behind a reviewed
allowlist until DevNexus has stronger plugin trust controls such as signed or
pinned artifacts, permission diffs, update review, and revocation.

Supported capability kinds include:

- `projected_skill`
- `mcp_server`
- `setup_obligation`
- `environment_hint`
- `cleanup_hook`
- `agent_affordance`
- `dependency_projection`
- `worker_context_fragment`
- `worker_briefing_fragment`

DevNexus validates and projects these records into agent context and setup
results. A plugin MCP server capability may declare its expected tool names as
metadata; if it omits them and the server has a callable `stdio` command or
`http` URL, the MCP gateway can discover them dynamically through `tools/list`.
DevNexus rejects any declared tool name that overlaps a core `dev_nexus` MCP
tool. Plugin-specific packages own the provider-specific commands or endpoints
that materialize or start specialized runtime surfaces.

For the Codex and Claude adapter split, see
[Agent-client plugin compatibility](agent-client-plugin-compatibility.md).

Example:

```json
{
  "plugins": [
    {
      "id": "analysis-tools",
      "name": "Analysis Tools",
      "version": "0.1.0",
      "enabled": true,
      "capabilities": [
        {
          "kind": "projected_skill",
          "id": "deep-review",
          "skillId": "deep-review",
          "targetAgents": ["codex"]
        },
        {
          "kind": "mcp_server",
          "id": "analysis-mcp",
          "serverName": "analysis_tools",
          "tools": [
            {
              "name": "inspect_facts",
              "description": "Read plugin-supplied facts."
            }
          ]
        }
      ]
    }
  ]
}
```

Fragment projection must remain deterministic. DevNexus filters fragments by
target component and agent, then orders them by plugin id, capability id, kind,
and provenance. Duplicate fragment ids from different plugins are retained
with their source metadata.

## Generated Worktree Setup

Generated worktrees are component-scoped and must remain inside the configured
component worktrees root. Worktree setup can workspace support-only dependencies,
agent skills, and worker context files without changing tracked source.

Dependency projections link existing reviewed paths such as `node_modules`
into the generated worktree. They do not install packages. Required projections
are checked before mutation so setup failures are visible early.

Worker context is written under `.dev-nexus/context/` in the generated
worktree:

- `context.json` contains workspace, component, ownership, setup, and plugin
  capability facts.
- `briefing.md` contains concise agent-readable setup and policy notes.

The context bundle does not change command roots. Source edits and verification
still run from the component checkout root.

Worktree-first coordination is an operating expectation for mutating
interactive chats. Shared checkouts and stable component source roots remain
useful for read-mostly status, setup, and integration planning. Worker
worktrees, integration branches, and rescue branches model where work happens
and how it is preserved; they do not define who is allowed to push, merge,
approve, mutate providers, or publish.

Those permissions belong to the separate authority model tracked by
`dev-nexus:local-87` through `dev-nexus:local-95`. Source changes for worktree
coordination should consume the effective authority result instead of adding a
second role system. Until those authority and guardrail changes are implemented,
documentation should describe the expected workflow without implying automatic
enforcement.

## Automation Internals

Automation has two supported launch shapes:

- `agent_launch`: DevNexus prepares context, checks gates, starts a configured
  agent command, and records the result JSON reported by that agent.
- Current-agent adoption: DevNexus creates or reuses the same context and
  result contract for an already-running coordinator without spawning a child
  process.

Older generated-worktree executor paths remain available for compatibility,
but new coordinator workflows should prefer `agent_launch` or adoption.

Target-cycle records are factual caller reports. They can record selected,
dispatched, in-progress, completed, blocked, skipped, or failed work, plus
bounded notes and blockers. `target_report` synthesizes factual status from
target state, target cycles, run ledgers, and locally recorded work-item state.
It should not call external trackers just to invent missing context.

## Agent Profiles

Agent profiles describe infrastructure policy, not supervision decisions. A
profile may define:

- Executor and execution mode.
- Model, reasoning, variant, or intelligence setting.
- Command and args.
- Intended use such as coordinator, subagent, or any.
- Safety overrides.
- Provider-specific local connection policy.

Profile permission policy must not be weakened when switching between command
execution, current-agent adoption, and app-server style launches.

## Curated Skills

DevNexus stores reviewed skill definitions under `.dev-nexus/skills/` and can
project them into agent-native locations such as:

- `.agents/skills/<skill-id>/SKILL.md` for Codex.
- `.claude/skills/<skill-id>/SKILL.md` for Claude.

Prepared component worktrees receive their own generated skill projection when
configured. Generated skill and context files are support state and should be
excluded from component Git indexes unless workspace config explicitly requests
source-controlled projection.

The default core pack includes skills for DevNexus usage, diagnosis,
Test-Driven Development (TDD), handoff, triage, architecture review, setup,
documentation writing, humanizer prose polishing, planning, prototyping, and
unfamiliar-code exploration.

## Source Development

Run the full local check before publishing source changes:

```bash
npm run check
```

Focused test runs are useful while iterating:

```bash
npm test -- test/project/nexusProjectConfig.test.ts
npm test -- test/mcp/nexusMcpServer.test.ts
```

Keep README and user docs concise. Put implementation details, invariants, and
provider-adapter notes in developer docs or source comments near the relevant
code.
