# Codex Architecture Design Audit Product Requirements Document (PRD)

## Problem

DevNexus is beginning to use Codex not only as a command-line executor, but as
one of its primary dogfood agent environments. Codex has evolved into a shared
harness with a local Desktop App, command-line interface, Software Development
Kits (SDKs), Model Context Protocol (MCP) surfaces, app-server protocol, thread
store, permission model, and event stream. DevNexus can benefit from those
design choices, but only if it adopts the stable architectural lessons instead
of coupling itself to private Desktop behavior or stale assumptions.

The current DevNexus Codex app-server plan is directionally right, but the audit
found a protocol-level mismatch that should become the first implementation
requirement: current Codex app-server stdio speaks newline-delimited
"JSON-RPC lite" messages and omits the `jsonrpc` field, while the existing
DevNexus app-server transport code appears to use Language Server Protocol
(LSP)-style `Content-Length` framing and strict `jsonrpc: "2.0"` envelopes.
Until that is corrected, higher-level app-server worker features are at risk of
failing or creating confusing side effects.

DevNexus also needs a clearer product model for Codex-inspired concepts:
threads, turns, events, approvals, capabilities, generated schemas, permission
profiles, and spawned agents. These should improve DevNexus' infrastructure
quality without changing the boundary that DevNexus does not choose or
supervise implementation work.

## Goals

- Use the Codex harness architecture as a reference model for agent execution
  infrastructure.
- Make Codex app-server integration reliable by matching the current wire
  protocol, capability discovery, and event model.
- Preserve DevNexus' product boundary: DevNexus provides infrastructure,
  project state, worktree isolation, launch context, result contracts, and
  factual records; the human or coordinator agent chooses and supervises work.
- Improve DevNexus run records so they can represent thread, turn, event,
  approval, capability, and permission facts without storing noisy chat logs.
- Standardize generated protocol/schema handling so provider adapters can be
  tested against versioned contracts rather than ad hoc JSON shapes.
- Use Codex's permission and approval model as a design reference for
  DevNexus authority, runner profiles, and host-local safety policy.
- Treat Codex app-server, `codex exec`, current-agent adoption, and future
  remote execution as different executor modes behind one DevNexus launch
  abstraction.
- Keep DevNexus portable across macOS, Windows, and Linux by avoiding
  Desktop-private storage, host-specific absolute paths, and implicit account
  assumptions in shared project configuration.

## Non-Goals

- Do not make DevNexus a Codex Desktop controller.
- Do not write directly to private Codex app databases, chat storage, heartbeat
  storage, or automation files.
- Do not require Codex app-server for all DevNexus automation; `codex exec`
  remains appropriate for simple one-shot coordinator launches.
- Do not turn DevNexus target cycles into full chat transcripts.
- Do not make DevNexus choose subagents, assign work, or interpret agent
  progress beyond caller-reported facts.
- Do not copy Codex implementation internals into DevNexus core.
- Do not make generic DevNexus depend on Codex-only concepts when a
  provider-neutral abstraction is sufficient.
- Do not add Pharo, PLexus, or language-specific behavior to the generic Codex
  provider.

## Evidence Reviewed

- OpenAI Codex app-server documentation, including the recommendation to
  generate TypeScript or JSON Schema artifacts from the exact installed Codex
  version.
- OpenAI's Codex harness architecture article, especially the split between
  core thread runtime, message processor, thread manager, and client surfaces.
- Official `openai/codex` source at commit
  `4ca60ef9fffe76fb4f86d606f7d4a2f727f6cd25`.
- Installed local Codex CLI `0.130.0` and its generated app-server JSON Schema.
- Existing DevNexus architecture docs, automation docs, app-server PRD, and
  current Codex app-server adapter source.

## Current State

DevNexus already has the right strategic pieces:

- Multi-component project configuration.
- Component-owned work trackers.
- Generated worktree setup and support context.
- Agent profiles with executor, model, reasoning, safety, and provider-specific
  connection fields.
- Current-agent adoption.
- Target-cycle records and target reports.
- Coordination handoffs and integration planning.
- A first Codex app-server provider PRD.
- Initial source modules for Codex app-server JSON-RPC, capability discovery,
  MCP relay, and launch metadata.

The current implementation is still too shallow compared with Codex's actual
protocol shape:

- The app-server transport should use newline-delimited JSON messages, not
  `Content-Length` framing.
- The app-server protocol is "JSON-RPC lite" and does not send or expect the
  `jsonrpc: "2.0"` member.
- App-server notifications and server-initiated approval requests are
  first-class, but DevNexus currently models the launch mostly as two requests
  followed by reading a result file.
- Codex schemas expose richer permission and approval controls than DevNexus
  currently maps.
- Codex events distinguish lossless events from best-effort progress; DevNexus
  target-cycle notes currently have no equivalent event severity or durability
  tier.
- Codex has explicit thread and turn concepts; DevNexus run records have
  launch records and target cycles but do not yet model worker-thread lifecycle
  cleanly.

## Codex Design Principles To Adopt

### 1. Thread And Turn Are Separate Product Concepts

Codex treats a thread as durable conversational/runtime state and a turn as one
bounded unit of agent activity inside that thread. DevNexus should mirror this
distinction in provider-neutral terms:

- A DevNexus launch may create or resume a provider session.
- A DevNexus run may start one or more provider turns.
- A DevNexus work item can reference provider session ids without making chat
  history the source of truth.
- Ephemeral provider sessions should be the default for probes and temporary
  workers.
- Durable provider sessions should be explicit user or project policy.

### 2. Event Streams Beat Polling And Log Scraping

Codex app-server exposes server notifications for turn started, item started,
item completed, deltas, errors, approval requests, status changes, and turn
completion. DevNexus should prefer event ingestion over log scraping when a
provider offers it.

DevNexus should not store every event forever. It should classify provider
events into:

- Durable facts: started, completed, failed, interrupted, approvals requested,
  approvals denied, permission changes, result contract satisfied.
- Diagnostic summaries: selected commands, failed tools, skipped events,
  capability gaps.
- Ephemeral progress: streaming text, low-value output deltas, transient
  progress notifications.

### 3. Capability Discovery Must Be Runtime Truth

Codex app-server method availability changes across versions and surfaces.
DevNexus should not assume that an installed Codex binary supports the same
methods as a PRD or prior schema.

The app-server adapter should:

- Initialize with a named DevNexus client identity.
- Read advertised capabilities when available.
- Fall back to schema/version checks when initialize capabilities are sparse.
- Report actionable missing capabilities before starting a worker turn.
- Treat optional surfaces such as MCP relay, plugin APIs, hooks, filesystem
  APIs, command execution, review, and remote control separately.

### 4. Generated Schemas Are Part Of The Product Contract

Codex can generate TypeScript and JSON Schema artifacts from the installed
binary, and those artifacts match that binary exactly. DevNexus should adopt
the same discipline for provider protocols:

- Keep generated protocol snapshots out of hand-written runtime logic unless a
  specific adapter version owns them.
- Use generated schemas in tests and compatibility reports.
- Record the installed provider version and schema generation time in local
  diagnostics.
- Prefer tolerant runtime parsing for optional fields and strict validation for
  DevNexus-owned output contracts.

### 5. Permission Policy Is More Than Sandbox Mode

Codex exposes approval policy, approval reviewer, sandbox policy, permission
profile selection, granular approval flags, and tool or MCP elicitation
controls. DevNexus currently has safety profiles and publication authority, but
those are not yet rich enough to describe all provider execution risks.

DevNexus should split policy into:

- Actor authority: who may push, merge, comment, create issues, mutate trackers,
  or publish.
- Runtime safety: filesystem, network, process, dependency install, live
  services, Docker, Pharo, PLexus, and remote host permissions.
- Provider approvals: how provider-side approval requests are routed and
  whether auto-review is allowed.
- Session persistence: ephemeral, durable, archived, or adopted.
- Capability gates: which app-server surfaces can be used by a profile.

### 6. Client Identity And Source Metadata Matter

Codex records source and service metadata for threads and requests. DevNexus
should use this deliberately:

- `serviceName` should identify DevNexus and the component or workflow.
- Thread metadata should distinguish probes, coordinator launches, temporary
  workers, durable handoffs, and current-agent adoption.
- DevNexus should record provider thread id, turn id, source type, cwd,
  profile id, model, reasoning effort, sandbox, and ephemeral status.
- Diagnostic probes must not appear as user-visible work chats unless durable
  persistence is explicitly requested.

### 7. Backpressure And Lossless Events Need A Policy

Codex separates events that must not be dropped, such as transcript deltas and
turn completion, from lower-value progress events that can be summarized or
dropped under backpressure. DevNexus should adopt the principle without copying
the exact event categories.

For DevNexus:

- Completion, failure, approval, permission, publication, and result-contract
  events are lossless.
- Progress output and verbose tool deltas are best-effort.
- If events are skipped, record a bounded diagnostic fact instead of silently
  losing context.

### 8. Provider-Specific Richness Belongs Behind Neutral Records

Codex app-server exposes many useful surfaces: MCP status, MCP tool calls,
skills, plugins, config, hooks, filesystem, commands, models, account state,
thread metadata, thread rollback, and review. DevNexus should not expose all of
that as generic DevNexus core behavior.

Instead:

- Provider adapters can expose provider diagnostics.
- DevNexus core stores neutral launch, run, capability, approval, and result
  facts.
- MCP relay through Codex app-server remains optional and capability-gated.
- Plugin and skill projection remain DevNexus concepts, even when Codex has
  native plugin and skill APIs.

## Product Requirements

### R1. Codex App-Server Wire Protocol Compatibility

The Codex app-server adapter must speak the current app-server transport:

- Newline-delimited JSON over stdio.
- JSON-RPC lite request, response, notification, and error shapes.
- No required `jsonrpc: "2.0"` field.
- Bidirectional message handling, including server notifications and
  server-initiated requests.
- Clear errors when a configured Codex binary speaks an unsupported protocol.

Acceptance:

- A local smoke test can call `initialize` against the installed Codex
  app-server without creating a durable user chat.
- A mocked transport test verifies JSONL framing and JSON-RPC lite envelopes.
- A regression test proves LSP-style `Content-Length` framing is not used for
  Codex app-server stdio.

### R2. App-Server Client Identity And Probe Hygiene

Every DevNexus app-server connection must identify itself as DevNexus and must
separate probes from real worker launches.

Acceptance:

- Status probes use ephemeral or non-materialized behavior where the provider
  supports it.
- Diagnostic method names are never submitted as user prompts.
- Provider thread ids created by DevNexus are recorded with purpose, source,
  profile id, and persistence mode.
- Probe failures report capability or auth blockers without creating stray
  user-visible chats.

### R3. Provider Session And Turn Records

DevNexus should add a provider-neutral session/turn record shape attached to
launch records, target cycles, or coordination handoffs.

Minimum fields:

- Provider id and executor mode.
- Session id and turn id when present.
- Source purpose: probe, coordinator, worker, fork, adoption, or durable
  handoff.
- Component id, work item id, cwd, and worktree id when present.
- Model, reasoning effort, sandbox, approval policy, and permission profile
  summary.
- Ephemeral or durable persistence.
- Terminal status, failure summary, and result-contract status.

Acceptance:

- `target_report` can summarize active and recent provider sessions without
  reading provider-private storage.
- A failed provider turn can be traced back to the DevNexus profile and work
  surface that launched it.

### R4. Capability Profiles

Agent profiles should separate executor identity from provider capabilities.

Suggested capability groups:

- `thread_control`
- `turn_control`
- `event_stream`
- `approval_requests`
- `mcp_status`
- `mcp_tool_call`
- `skills`
- `plugins`
- `hooks`
- `filesystem`
- `command_execution`
- `remote_control`
- `schema_generation`

Acceptance:

- `agent_profiles` reports supported, required, optional, and blocked
  capabilities without printing local secrets or endpoints.
- A profile can require basic thread/turn control while leaving MCP relay or
  remote control disabled.
- Non-loopback app-server endpoints remain blocked unless host-local policy
  explicitly permits them.

### R5. Event Ingestion With Durability Tiers

DevNexus should ingest provider events through a bounded event reducer rather
than raw transcript storage.

Acceptance:

- Lossless events update durable DevNexus records.
- Best-effort progress events are summarized or dropped safely.
- Skipped event counts are recorded when backpressure occurs.
- Server approval requests are either surfaced to an approved caller or marked
  blocked; they must not hang silently.

### R6. Result Contract Over Chat Transcript

A provider turn is not a completed DevNexus run merely because the model
finished speaking. DevNexus completion should require the configured result
contract.

Acceptance:

- A Codex turn that exits without writing or returning the expected
  `DEV_NEXUS_AGENT_RESULT_FILE` remains failed or blocked.
- App-server final assistant text can be used as a diagnostic summary, but not
  as the authoritative result.
- Current-agent adoption and app-server launches share the same result status
  vocabulary.

### R7. Codex-Inspired Schema Discipline For DevNexus

DevNexus should adopt generated or exported schemas for its own provider-facing
contracts where practical.

Candidates:

- DevNexus MCP tool input/output contracts.
- Automation agent profile schema.
- Target-cycle record schema.
- Provider session and turn record schema.
- Worktree context bundle schema.
- Codex app-server adapter compatibility schema.

Acceptance:

- Tests can validate representative fixtures against exported schemas.
- Schema compatibility failures are reported as setup or adapter blockers, not
  as obscure runtime errors.

### R8. Provider-Neutral Subagent Model

Codex has first-class collaborative agent events and source kinds. DevNexus
should represent spawned workers in neutral terms before adding
Codex-specific controls.

Acceptance:

- DevNexus records worker identity, parent run, work item, component, worktree,
  provider session id, and terminal status.
- The coordinator remains responsible for choosing and supervising worker
  scope.
- Provider-native subagent spawning is optional and must be compared with
  DevNexus-prepared worktrees and external chat launching before being made a
  default path.

## User Stories

- As a DevNexus user, I can run a Codex app-server readiness check and know
  whether the installed binary supports the required DevNexus executor
  capabilities.
- As a coordinator, I can start a temporary Codex worker in a prepared worktree
  without creating a stray durable chat.
- As a maintainer, I can inspect a target report and see which provider thread
  and turn correspond to a failed DevNexus run.
- As a multi-host user, I can keep shared project configuration portable while
  host-local Codex app-server endpoints, tokens, and account state remain local.
- As an integrator, I can trust that a completed DevNexus run satisfied the
  result contract, not merely that a Codex turn produced text.
- As a plugin author, I can contribute Codex-specific projection or MCP
  capabilities without forcing Codex concepts into generic DevNexus core.

## Implementation Decisions

- Keep Codex app-server support in a Codex provider adapter.
- Replace the current stdio transport with JSONL JSON-RPC-lite support before
  adding higher-level worker behavior.
- Add a bidirectional app-server client loop that can route responses,
  notifications, and server requests independently.
- Generate app-server schema snapshots during tests or diagnostics, not during
  normal project setup.
- Keep `codex exec` as the default non-interactive launcher until app-server
  transport, event routing, and result-contract handling are reliable.
- Use app-server only for profiles that explicitly select `executorMode:
  "app_server"`.
- Store provider ids and summaries in DevNexus records; do not store full
  provider transcripts unless a later feature explicitly adds archival policy.
- Make MCP relay through Codex app-server a separate capability after
  thread/turn lifecycle works.

## Testing Decisions

- Unit-test JSONL transport parsing and writing.
- Unit-test JSON-RPC-lite request, response, notification, and error routing.
- Unit-test early notifications that arrive before the caller starts waiting
  for a turn stream.
- Unit-test server approval request routing and timeout behavior.
- Unit-test capability detection with missing, renamed, and optional methods.
- Unit-test ephemeral thread creation and durable thread opt-in.
- Unit-test result-contract failure when a turn completes but the DevNexus
  result file is missing.
- Add an optional local smoke test that starts the installed Codex app-server,
  calls `initialize`, reads capability shape, then exits without starting a
  durable worker turn.
- Keep continuous integration able to skip live Codex smoke tests cleanly.

## Migration Plan

1. Mark the existing app-server provider as experimental and not operational
   until the wire protocol is corrected.
2. Replace transport and message routing with JSONL JSON-RPC-lite support.
3. Add initialization, capability report, and ephemeral probe hygiene.
4. Add provider session and turn records.
5. Add event reducer and result-contract handling.
6. Enable one local temporary worker smoke under explicit profile opt-in.
7. Slice MCP relay, provider-native subagents, hooks, plugins, and remote
   app-server control as later work.

## Open Questions

- Should DevNexus expose a general provider-session ledger, or attach provider
  session facts only to target cycles and launch records?
- Should DevNexus support Codex's Python or TypeScript SDKs as an adapter
  implementation option, or keep a small direct JSON-RPC client?
- What is the right policy for durable Codex chats created by DevNexus: always
  user opt-in, project opt-in, or work-item-level opt-in?
- Should app-server capability reports be stored in host-local DevNexus state
  for diagnostics, or computed on demand?
- How should DevNexus represent provider-native subagents compared with
  DevNexus-created worktrees and separate Codex chats?

## Out Of Scope For The First Slice

- Codex Desktop automation management.
- Codex heartbeat or cron creation.
- Remote app-server control over non-loopback endpoints.
- Provider-native plugin installation or marketplace management.
- Provider-native filesystem or command execution outside the normal Codex
  agent turn.
- Full transcript archival.
- Live Pharo or PLexus integration.

## References

- OpenAI Codex App Server documentation:
  https://developers.openai.com/codex/app-server
- OpenAI Codex harness architecture article:
  https://openai.com/index/unlocking-the-codex-harness/
- OpenAI Codex source repository:
  https://github.com/openai/codex
- Codex MCP interface documentation:
  https://github.com/openai/codex/blob/main/codex-rs/docs/codex_mcp_interface.md
