# Codex App-Server Provider Product Requirements Document (PRD)

## Problem

DevNexus can launch Codex through `codex exec`, but that is a process boundary
with limited control once the run starts. It also failed in restricted scheduler
contexts where nested Codex execution exited before work selection. Codex App
heartbeats can wake this thread, but DevNexus should own conditional scheduling,
locking, backoff, run records, and target facts.

Codex also exposes an experimental app-server protocol with thread, turn,
plugin, skill, configuration, process, and Model Context Protocol (MCP) methods.
That protocol appears to support ephemeral threads, thread forking, turn
steering, MCP tool calls, and local configuration reloads. DevNexus should be
able to use that surface when configured, without reverse-engineering private
Codex automation storage and without making DevNexus choose or supervise work.

## Goals

- Add an optional Codex app-server executor provider for DevNexus.
- Let DevNexus start or connect to a Codex app-server through an agent profile.
- Let a coordinator create bounded Codex worker threads or turns with project
  context, current working directory, model, reasoning, permissions, and MCP
  configuration inherited from DevNexus policy.
- Support ephemeral Codex threads for temporary workers when durable chat
  history is not needed.
- Preserve DevNexus' boundary: DevNexus provides infrastructure, launch
  context, locks, target-cycle records, and result contracts; the coordinator
  still chooses and supervises implementation work.
- Keep the current `codex exec` launcher available for hosts where it is the
  simpler or more stable option.
- Avoid app-private automation file mutation. Codex heartbeat or cron creation
  remains outside this provider until Codex exposes a stable protocol for it.

## Non-Goals

- Do not make DevNexus manage Codex App heartbeats, cron automations, or
  scheduled chats in the first version.
- Do not reverse-engineer or write Codex private automation storage as a normal
  feature.
- Do not bypass Codex approval, permission, sandbox, or MCP trust policy.
- Do not make Codex-specific behavior leak into generic DevNexus work-item,
  coordination, plugin, or target concepts.
- Do not create Vibe workspaces, sessions, or executions.
- Do not add Pharo, PLexus, or language-specific behavior to the generic Codex
  provider.

## Current Evidence

Local Codex exposes these relevant commands:

- `codex app-server`
- `codex remote-control`
- `codex app-server generate-ts --experimental`
- `codex app-server generate-json-schema --experimental`

The generated protocol includes:

- `thread/start`, `thread/fork`, `thread/list`, `thread/read`,
  `thread/inject_items`, and `thread/compact/start`
- `turn/start`, `turn/steer`, and `turn/interrupt`
- `mcpServer/tool/call`, `mcpServerStatus/list`, and
  `config/mcpServer/reload`
- `skills/list`, plugin read/install/list surfaces, and configuration read/write
- process and command execution surfaces

The generated thread model includes an `ephemeral` flag, described as a thread
that should not be materialized on disk. The generated protocol did not expose
automation, heartbeat, cron, or schedule management methods.

## Users

- A DevNexus user configuring Codex as an execution backend.
- A coordinator agent that wants to start bounded temporary Codex workers
  without creating unmanaged long-lived chats.
- A restricted host scheduler that can wake DevNexus, while DevNexus decides
  whether any coordinator run should proceed.
- A Mac or Windows agent that wants a consistent DevNexus-managed Codex launch
  path across machines.

## User Stories

- As a coordinator, I can request a temporary Codex worker for one selected work
  item and receive a thread id, turn id, run metadata, and result location.
- As a coordinator, I can fork or start a Codex thread with the correct
  component worktree, project briefing, skills, MCP servers, and permissions.
- As a DevNexus user, I can keep using `codex exec` when app-server is not
  available or too experimental for a project.
- As an automation operator, I can run DevNexus' coordinator loop and see wait,
  skipped, launched, completed, blocked, and failed decisions recorded in target
  facts before any Codex thread is started.
- As a project maintainer, I can see that DevNexus does not silently create or
  mutate Codex App heartbeats.

## Proposed Surface

Agent profiles should gain an optional Codex app-server executor mode. The
profile should remain declarative and host-local:

```json
{
  "id": "codex-app-server-5-5-xhigh",
  "executor": "codex-app-server",
  "model": "gpt-5.5",
  "reasoning": "xhigh",
  "appServer": {
    "mode": "connect-or-spawn",
    "command": "C:\\Users\\example\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe",
    "listen": "stdio://",
    "ephemeralThreadsByDefault": true
  }
}
```

The exact shape can change during implementation, but the concepts should stay
small:

- `mode`: connect to an existing server, spawn a local app-server, or use the
  current thread when adoption is active.
- `listen`: stdio, loopback websocket, or an explicitly approved remote
  endpoint.
- `ephemeralThreadsByDefault`: default temporary worker behavior.
- `permissionProfile` or existing profile permission fields: the DevNexus
  policy to pass into Codex thread or turn start calls.

## Implementation Decisions

- Treat Codex app-server as an executor provider, not as a DevNexus scheduler.
- Keep Codex-specific protocol code in a bounded adapter module behind a small
  DevNexus executor interface.
- Use a small internal JSON-RPC client instead of depending on private Codex
  libraries.
- Generate or snapshot protocol types only for tests and adapter validation;
  runtime code should tolerate missing experimental methods and report
  capability gaps clearly.
- Start with thread and turn control: initialize, thread start or fork, turn
  start, turn status/event handling, interrupt, read result, and cleanup.
- Add MCP tool relay only after basic thread and turn control is reliable.
- Use ephemeral threads for worker turns by default, with an explicit durable
  option when a user wants a visible Codex chat.
- Record Codex thread ids, turn ids, source, ephemeral status, cwd, selected
  model, and failure summaries in DevNexus target-cycle or launch records.
- Never mark a Codex thread as a successful DevNexus run until the configured
  result contract has been satisfied.

## Safety Decisions

- Default websocket access to loopback only.
- Require explicit project or host-local policy for non-loopback app-server
  endpoints, remote-control mode, or capability-token files.
- Do not persist tokens, socket paths, or host-specific app-server endpoints in
  portable project configuration.
- Preserve `approval_policy`, sandbox, permission profile, and MCP approval
  defaults from the selected DevNexus agent profile.
- Surface Codex approval or permission failures as DevNexus launch failures, not
  as implementation blockers selected by DevNexus.

## Testing Decisions

- Unit-test the Codex app-server adapter against a mocked JSON-RPC server.
- Unit-test capability detection when expected methods are missing.
- Unit-test ephemeral thread creation, durable thread opt-in, turn start, turn
  failure, interrupt, and result extraction.
- Unit-test that automation/heartbeat methods are not assumed.
- Unit-test coordinator-loop behavior with app-server profiles: no work,
  active lock, backoff, launch, completed, failed, and blocked outcomes.
- Add one optional local smoke command that uses the installed Codex binary to
  generate schema or start a no-op app-server conversation, gated so continuous
  integration can skip it cleanly.

## Out Of Scope For The First Version

- Creating, editing, or deleting Codex App heartbeats or cron automations.
- Managing the current Codex desktop thread from inside DevNexus unless the
  current-agent adoption contract explicitly provides that context.
- Remote multi-host Codex control over Tailscale, except as a future transport
  after local app-server mode is reliable.
- Provider-native GitHub, GitLab, Jira, or review-thread coordination. That
  remains part of the separate `coordination_request` feature.

## Implementation Slicing

After this PRD is accepted, use the issue-slicing workflow to create
component-owned DevNexus work items. Expected slices:

- Codex app-server capability discovery and JSON-RPC client.
- Codex app-server agent profile schema and validation.
- Thread and turn launch provider for ephemeral worker threads.
- DevNexus launch and target-cycle fact recording for app-server runs.
- Optional MCP tool relay through Codex app-server.
- Documentation for choosing `codex exec`, current-agent adoption, and
  app-server profiles.
