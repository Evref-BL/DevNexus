# Project-Scoped PLexus Runtime Product Requirements Document (PRD)

## Problem

PLexus is meant to let several projects and workspaces use Pharo images through
safe project-owned runtime boundaries. The current design is close, but the
operational model still mixes three concerns that should be named separately:
project runtime state, gateway deployment, and host port ownership.

Project runtime state should remain project-scoped. A project owns its
configuration, workspaces, target identities, image handles, startup scripts,
and cleanup policy. Users naturally reason about "this project" or "this
workspace", not a machine-wide PLexus brain.

Ports are different. Image Model Context Protocol (MCP) ports and gateway ports
are host resources. Two isolated project states can still collide on the same
host if they both choose the same default port range. The current allocator
prevents collisions among sibling workspaces that share one project state root,
but it does not reliably protect separate projects, separate state roots, stale
listener processes, or two project opens racing at the same time.

The gateway surface split is directionally correct: normal agents should see a
Pharo tool gateway, while PLexus lifecycle code uses route-control. However,
legacy names and compatibility paths are still present in live configuration and
documentation. They are useful during migration, but they should not become a
permanent source of ambiguity.

## Goals

- Keep PLexus state and lifecycle policy project-first.
- Make a PLexus runtime scope explicit: project, workspace, target, state root,
  gateway endpoint, route-control endpoint, image handles, and port policy.
- Allow several PLexus projects to run concurrently on one host without MCP port
  collisions.
- Support multiple workspaces for the same project through a shared
  project-owned state root when that is the right project policy.
- Let separate projects use separate state roots and separate gateway processes
  without losing safe host port allocation.
- Treat host port coordination as a narrow local resource concern, not as shared
  PLexus project state.
- Make the normal gateway deployment shape one gateway process with two MCP
  paths: one agent-facing path and one route-control path over the same route
  table.
- Make project-local gateway deployment the default mental model, while still
  allowing an explicitly configured shared gateway for advanced control-plane
  deployments.
- Remove legacy gateway names, combined surfaces, and legacy environment
  variables after a short documented migration window.
- Keep DevNexus-Pharo and generated Codex configuration aligned with the clean
  PLexus surfaces.

## Non-Goals

- Do not introduce a machine-wide PLexus project database.
- Do not make gateway route tables discover projects by reading project state
  from disk.
- Do not require all projects on a host to share one PLexus state root.
- Do not require all projects on a host to share one gateway process.
- Do not coordinate ports across different machines. Ports are host-local.
- Do not expose raw host-wide Pharo Launcher mutation to implementation agents.
- Do not run live Pharo image or gateway smoke tests except through the approved
  isolated live-smoke runner.
- Do not preserve legacy aliases indefinitely.

## Current State

PLexus core owns project configuration, workspace and image lifecycle, runtime
state, image MCP port allocation, startup script generation, image health
polling, scoped `pharo-launcher`, and route registration through the gateway
route-control API.

PLexus Gateway owns route registration, route status, stale-route cleanup, and
forwarding project Pharo MCP calls to image MCP servers by explicit `imageId`.
The gateway must not depend on PLexus core or read project configuration from
disk.

The raw Pharo Launcher MCP owns Pharo Launcher command integration and host
process discovery. PLexus wraps it with a scoped facade so agents operate on
project-owned image handles instead of arbitrary host images.

Runtime state is currently stored under a state root by project id and
workspace id. This is correct for project-owned state. The current dynamic port
allocator scans sibling workspace state under the same project state root and
reserves ports used by non-stopped images. This is not enough when separate
projects use separate state roots but share one host.

The current gateway source supports one Hypertext Transfer Protocol (HTTP)
gateway process with separate agent-facing and route-control MCP paths that
share one in-memory route table. Live configuration may still use older server
names, combined surfaces, or a legacy gateway MCP URL.

## Users

- A project maintainer configuring PLexus for one Pharo project.
- A Mac or Windows worker agent operating inside one PLexus-managed project.
- A DevNexus-Pharo plugin generating project-specific Codex MCP configuration.
- A coordinator agent checking whether a project runtime is operational.
- A maintainer running multiple PLexus projects on the same development host.
- A migration owner removing legacy gateway names and endpoint variables.

## User Stories

- As a maintainer, I can configure PLexus for one project without thinking about
  another project's runtime state.
- As a worker agent, I can list project-scoped Pharo images and use `gateway`
  with an `imageId` without seeing route-control tools.
- As a coordinator, I can run two unrelated PLexus projects on one host and have
  image MCP ports and gateway ports remain unique.
- As a project owner, I can choose a project-local gateway port or port range
  and keep that gateway independent from other projects.
- As an advanced operator, I can deliberately use a shared gateway control plane
  for several projects, with explicit route identities and no accidental
  coupling.
- As a maintainer, I can see a clear diagnostic when a configured or dynamically
  chosen port is already occupied by another process.
- As a migration owner, I can update old `pharo` or combined gateway
  configuration to `gateway` plus route-control and know when the compatibility
  window ends.
- As a DevNexus-Pharo user, I can open a fresh project with no images yet and
  still keep the PLexus setup ready for future Pharo work.

## Product Model

### PLexus Project

A PLexus project owns source-local configuration, image declarations, image name
templates, runtime policy, and default verification expectations. A project may
have zero images. Zero images means "no active Pharo runtime yet", not "remove
PLexus".

### PLexus Workspace

A workspace is one project runtime instance, usually tied to one worktree or
task. The workspace owns a state file, image handles, rendered image names,
startup scripts, assigned image MCP ports, process facts, and cleanup metadata.

Sibling workspaces for the same project should usually share the same project
state root so PLexus can reason about project-owned runtime state and avoid
collisions among that project's workspaces.

### Runtime Target

A runtime target is the routable identity for one project workspace. Gateway
routes should be keyed by `targetId`, with `projectId` and `workspaceId`
available for diagnostics and disambiguation.

### Gateway Deployment

The default deployment model is a project-local gateway process. One gateway
process exposes an agent-facing MCP path for `gateway` tools and a route-control
MCP path for PLexus lifecycle route registration, status, and cleanup. Both
paths share the same route table.

A host-shared gateway is allowed only when it is explicitly configured as a
shared control plane. In that mode, project and workspace identity must be
unambiguous, and generated project configuration must make the shared gateway
choice visible.

### Host Port Coordination

Host port coordination is a narrow resource allocator. It is not shared PLexus
project state and it is not a source of truth for routes, images, workspaces, or
project lifecycle.

The allocator should combine project policy, project state, operating-system
port availability checks, and a small host-local lock or lease mechanism that
prevents two concurrent project opens from selecting the same free port. Lease
records should contain enough project and workspace identity to make diagnostics
useful, but the project state file remains authoritative for the project
runtime.

## Requirements

### Project Runtime Configuration

PLexus should support an explicit runtime configuration model. It should cover:

- State root selection.
- Project-local gateway policy, including host, port or port range, agent MCP
  path, and route-control MCP path.
- Optional shared-gateway policy that is visibly different from the
  project-local default.
- Image MCP port policy, including fixed ports, project-owned ranges, and
  dynamic allocation.
- Host-local port coordination root or mode when concurrency-safe allocation is
  enabled.
- Legacy compatibility mode, disabled for newly generated configuration.

Existing project configurations should continue to load during migration, but
new generated configuration should use the explicit model.

### Port Allocation

Port allocation should proceed in project-first order:

1. Respect an explicit fixed image MCP port only if it is free, not reserved by
   sibling project workspace state, and not locked by another current PLexus
   open.
2. Prefer the project's configured image MCP port range when dynamic allocation
   is needed.
3. Reuse a previous workspace port only if it still satisfies project policy and
   is currently available.
4. Probe operating-system availability before assigning a port.
5. Acquire a host-local transient lock or lease before persisting an assignment.
6. Persist the assigned port in the workspace state after the image is launched
   or after a dry-run allocation is explicitly requested.
7. Release locks on project close or failed open, and reap stale locks when the
   owning process no longer exists or the state file is gone.

Fixed ports should be treated as a single-workspace convenience. They should
produce clear errors when they collide with another workspace, another project,
or an unrelated host process.

### Gateway Port Allocation

Project-local gateway processes need the same host-awareness as image MCP
ports. DevNexus-Pharo and PLexus setup tooling should allocate or validate a
unique gateway port for each project-local gateway. The generated Codex config
must point `gateway` to the agent-facing path and lifecycle route registration
to the route-control path.

When a project chooses a shared gateway, PLexus should not start a second
gateway process. It should register routes into the configured shared gateway
and report that deployment choice in diagnostics.

### Gateway Surface Cleanup

New generated configuration should expose:

- `plexus_project` for project lifecycle.
- `pharo-launcher` for scoped image lifecycle.
- `gateway` for project Pharo MCP tools routed by explicit `imageId`.

Route registration, route status, route cleanup, and raw image routing should
remain on the trusted route-control surface, not in ordinary implementation
agent configuration.

Legacy `pharo` server names, `pharo` gateway surfaces, combined gateway
surfaces, and legacy gateway MCP environment variables should move through a
defined removal path:

1. Current migration release: accept legacy inputs, emit diagnostics, and
   generate only clean configuration.
2. Next dogfood release: require an explicit compatibility flag for legacy
   inputs.
3. Removal release: reject legacy inputs with a migration message.

### Diagnostics

PLexus status and setup checks should report:

- Project id, workspace id, target id, project root, and state root.
- Gateway deployment mode, gateway port, agent-facing path, and route-control
  path.
- Image MCP port policy and assigned ports.
- Active host-local port leases for this project and conflicting leases from
  other projects.
- Occupied ports that are not owned by the current project.
- Gateway route table status for the target.
- Mismatches between project state, gateway routes, Pharo Launcher processes,
  and actual listening ports.
- Legacy configuration detected and the exact clean replacement.

Diagnostics should distinguish "project has no images yet" from failure.

### DevNexus-Pharo Integration

DevNexus-Pharo should use PLexus project runtime configuration when preparing
Codex projects and subagents. It should:

- Preserve unrelated user MCP entries.
- Generate clean `plexus_project`, `pharo-launcher`, and `gateway` entries.
- Configure route-control separately from the agent-facing gateway.
- Allocate or validate a project-local gateway port.
- Avoid deleting PLexus setup for projects that currently have no images.
- Record enough project scope metadata that a subagent can choose an image and
  pass the correct `imageId` to gateway tools.

## Implementation Decisions

- PLexus remains project-first. Project state stays in project-selected state
  roots.
- Host port coordination is the only host-local cross-project mechanism
  required for this work. It should be treated as a lock service or lease file,
  not as runtime state.
- Project-local gateways are the default because they match how users think
  about projects and reduce accidental coupling.
- Shared gateways remain possible, but only by explicit configuration.
- The gateway process should continue to expose two MCP paths over one route
  table.
- PLexus core should not gain a package dependency on PLexus Gateway. It should
  use the route-control API.
- The raw Pharo Launcher MCP remains host-wide; PLexus owns the scoped
  `pharo-launcher` facade.
- New generated config should not introduce legacy names.
- Legacy removal should be tracked as first-class work, not left as background
  cleanup.

## Testing Decisions

Add unit and integration-style tests that do not require live Pharo images for:

- Runtime config parsing and migration from existing project config.
- Dynamic image MCP allocation across sibling workspaces with a shared project
  state root.
- Dynamic image MCP allocation across two separate projects with separate state
  roots on the same host.
- Fixed image MCP port collision with a sibling workspace.
- Fixed image MCP port collision with an unrelated host listener.
- Concurrent allocation attempts using host-local locks or leases.
- Stale lock or lease cleanup.
- Project-local gateway port allocation and conflict diagnostics.
- Shared gateway configuration that does not start a second gateway.
- Generated Codex MCP config with clean `gateway` and route-control wiring.
- Rejection or warning behavior for legacy names and environment variables at
  each migration stage.
- Status output for a project with zero images.

Live verification should use the approved isolated live-smoke runner. It should
cover at least:

- Two separate PLexus projects active on one host without port collisions.
- One project with multiple sibling workspaces.
- Gateway route registration through route-control and Pharo tool calls through
  the agent-facing gateway.
- Cleanup of routes, processes, images, and host-local port leases.

## Out Of Scope

- Persisting gateway route tables as durable project state.
- Cross-host port allocation.
- A general machine-wide PLexus supervisor.
- Replacing Pharo Launcher.
- Building the prepared image cache feature.
- Implementing arbitrary image deletion from agent-facing tools.
- Keeping `pharo`, combined gateway surfaces, or legacy gateway MCP variables
  forever.

## Further Notes

The implementation should be sliced into separate work items:

- Project runtime configuration and migration model.
- Host-local port coordination for image MCP ports.
- Project-local gateway port allocation and generated setup.
- Clean Codex MCP config generation through DevNexus-Pharo.
- Legacy gateway alias deprecation and removal.
- Diagnostics for split-brain state, stale listeners, and zero-image projects.
- Live smoke coverage for two concurrent projects and multiple workspaces.

This PRD is ready to hand to the issue-slicing workflow.
