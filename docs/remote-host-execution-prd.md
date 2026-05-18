# Remote Host Execution Product Requirements Document (PRD)

## Problem

DevNexus can coordinate Mac and Windows agents through work items, branches,
handoffs, target-cycle facts, and provider-backed requests. That durable
coordination model is necessary, but it is not enough when a task needs
evidence from a specific operating system or host-local toolchain.

Linux verification is easy to automate through normal Continuous Integration
(CI). Mac and Windows verification is harder because those machines are often
personal workstations with GUI-adjacent tools, host-local credentials, Pharo
Launcher state, Model Context Protocol (MCP) configuration, Tailscale
connectivity, and platform-specific shell behavior. A Windows agent may need a
Mac to run a Pharo Launcher smoke, and a Mac agent may need Windows to verify
PowerShell quoting or path handling.

Without a product surface for remote host execution, agents have two bad
choices: ask a human to relay commands manually, or SSH into another machine in
an ad hoc way that loses auditability, safety policy, and durable result
records.

## Goals

- Let one DevNexus agent request bounded work from another trusted host.
- Keep durable intent and results in DevNexus coordination records, work items,
  target-cycle facts, or provider-backed requests.
- Use Tailscale and Secure Shell (SSH) as an initial private execution
  transport when both hosts allow it.
- Represent remote machines by capabilities, not by hard-coded personal host
  names.
- Support Mac, Windows, and Linux hosts as peers for platform-specific
  verification.
- Keep execution requests structured: repository, ref, command profile, timeout,
  expected artifacts, and publication identity.
- Preserve host-local boundaries for paths, secrets, credentials, runtime ports,
  Pharo images, and MCP endpoints.
- Make dry-run, read-only, and verification-only modes useful before any live
  runtime mutation is allowed.
- Let plugins such as DevNexus-Pharo contribute domain-specific host
  capabilities without leaking those details into DevNexus core.

## Non-Goals

- Do not make freeform cross-machine chat the source of truth.
- Do not let arbitrary agents run arbitrary shell commands on every trusted
  host.
- Do not store private keys, Tailscale addresses, passwords, tokens, absolute
  personal paths, live ports, runtime logs, or machine-local artifacts in shared
  project configuration.
- Do not bypass Git, work-item, or publication identity policy.
- Do not require SSH as the only future transport.
- Do not make DevNexus core understand Pharo Launcher, PLexus, or image-side MCP
  semantics.
- Do not start live Pharo images, Docker, GUI automation, package installs, or
  destructive cleanup unless an approved runner profile explicitly allows it.

## Users

- A Windows coordinator that needs Mac-specific verification.
- A Mac coordinator that needs Windows-specific verification.
- A worker agent that needs a remote host to answer an operating-system question
  before continuing.
- A human maintainer reviewing what remote commands were run and why.
- A plugin maintainer exposing safe domain-specific runner profiles, such as
  DevNexus-Pharo profiles for Pharo Launcher and MCP checks.

## Product Model

### Host Registry

A host registry describes trusted execution targets without committing secrets
or fragile machine details to the shared project.

Shared project state may declare logical host ids and required capabilities.
Host-local overlays provide transport details such as SSH user, hostname,
Tailscale Internet Protocol (IP) address, shell kind, command paths, credential
profiles, and local workspace roots.

Useful capability examples:

- `macos`
- `windows`
- `linux`
- `node`
- `pharo`
- `pharo-launcher`
- `mcp`
- `dev-nexus`
- `dev-nexus-pharo`
- `tailscale`
- `ssh`
- `gui-adjacent`

Capabilities are facts reported by setup checks or runner probes. They are not
permissions by themselves.

### Runner Profile

A runner profile defines what a host is allowed to execute for a project.

Profile fields should include:

- Logical profile id and display name.
- Required host capabilities.
- Allowed operation classes: status, setup check, test, smoke, artifact capture,
  package install, live runtime, cleanup, or publication.
- Default shell and command wrapper.
- Workspace resolution rules for the project and component source roots.
- Allowed command templates or verification profile ids.
- Timeout and output-size limits.
- Artifact retention policy.
- Credential and GitHub identity policy.
- Whether mutation is read-only, project-local, live-runtime, or destructive.
- Whether human approval is required before use.

The default runner profile should be read-only status and verification. Live
runtime profiles stay blocked until a human approves their boundary.

### Execution Request

A remote execution request is a durable coordination object. It should be small
enough to store in a work-item comment or provider-backed coordination record.

Fields:

- Project id, component id, and optional work item id.
- Requesting host id and optional requesting agent id.
- Required capabilities or explicit target host id.
- Runner profile id.
- Repository identity and source ref, branch, commit, or pull request.
- Command profile id or command template id.
- Timeout, expected result shape, and artifact expectations.
- Read-only or mutation class.
- Approval status and approving actor when needed.
- Request status: queued, accepted, running, completed, failed, blocked,
  timed_out, or cancelled.
- Result summary, exit code, stdout/stderr tail, artifact references, and
  verification outcome.
- Created, started, and completed timestamps.

### Execution Result

The remote host records a structured result back through DevNexus. The result
should include enough evidence for the requesting agent to continue without
reading a remote terminal.

Minimum result fields:

- Status and exit code.
- Host id and runner profile id.
- Repository path classification, not absolute personal path unless stored only
  in host-local logs.
- Checked-out ref and actual commit.
- Commands run.
- Verification outcomes.
- Relevant output tail.
- Artifact ids or provider links.
- Cleanup status.
- Any safety boundary that prevented execution.

## User Stories

- As a Windows agent, I can request `macos + pharo-launcher` verification for a
  DevNexus-Pharo branch and receive a structured pass/fail result.
- As a Mac agent, I can request Windows path and PowerShell verification for a
  DevNexus branch before asking for integration.
- As a coordinator, I can ask for a remote setup check and see whether generic
  DevNexus MCP and plugin MCP tools are visible on that host.
- As a maintainer, I can see which bot or human identity was used for every
  remote Git or GitHub operation.
- As a plugin author, I can define a safe runner profile for a domain-specific
  smoke without adding plugin concepts to DevNexus core.
- As a human, I can approve one live-runtime runner profile without granting
  broad arbitrary shell access.

## User-Facing Surface

DevNexus should expose a small runner API through CLI and MCP:

- `host list`: show known hosts, capabilities, reachability, and approval state.
- `host check`: run a read-only setup and capability probe on a local or remote
  host.
- `host request`: create a durable execution request for a capability or host.
- `host run`: execute an approved request locally or through a configured
  transport.
- `host result`: read or record execution results.

The API should support dry-run planning. An agent should be able to ask what
would run, on which host, through which identity, and which boundary blocks it
before any remote command starts.

## Transport Direction

Tailscale plus Secure Shell is the first practical transport for the dogfood
project. It is simple, private, already available between the Mac and Windows
machines, and good enough for bounded command execution.

Transport-specific details remain host-local:

- Tailscale IP address or MagicDNS name.
- SSH user and key alias.
- Shell bootstrap details.
- Remote project root and component root paths.
- Host-local credential profile names.

Future transports should fit the same execution request and result model:

- Self-hosted GitHub Actions runner.
- Local DevNexus runner daemon.
- Codex app-server transport.
- PLexus or plugin-specific MCP transport.

## Implementation Decisions

- Durable coordination remains provider-backed or DevNexus-backed. SSH is only
  an execution transport.
- DevNexus core owns generic host, runner, request, result, policy, and
  capability concepts.
- Plugins contribute capability probes, setup checks, command profiles, and
  runner profile templates.
- Remote execution should prefer checking out or updating the requested Git ref
  on the remote host before running verification.
- Agent-created Git and GitHub activity must use the configured automation
  identity. Manual human work keeps the human default identity.
- The first dogfood path should support read-only remote status checks and
  verification commands only.
- Live runtime profiles require explicit approval and must record cleanup
  evidence.

## Testing Decisions

- Unit-test host registry normalization with shared config plus host-local
  overlays.
- Unit-test capability matching and runner profile selection.
- Unit-test approval gates for read-only, project-local mutation, live runtime,
  and destructive cleanup classes.
- Unit-test SSH command planning without making a network connection.
- Unit-test output tailing, timeout handling, exit-code mapping, and artifact
  reference recording.
- Unit-test identity policy so automation cannot silently fall back to a human
  GitHub account.
- Unit-test plugin-contributed capability probes with mocked providers.
- Keep live Tailscale and SSH smoke tests optional, explicit, and
  policy-gated.

## Out Of Scope For First Version

- A long-running cross-host chat service.
- Arbitrary remote shell access from generic agent prompts.
- Remote desktop or Apple Remote Desktop control.
- Full remote GUI automation.
- Two-way live log streaming beyond bounded output tails.
- Automatic package installs on a fresh machine.
- Automatic live Pharo image or Docker work without approved runner profiles.
- Remote publication or merge operations before verification-only use is proven.

## Rollout Plan

1. Add host registry and host-local overlay schema.
2. Add read-only capability probes for local and SSH targets.
3. Add runner profile schema with safety classes and approval gates.
4. Add execution request and result records.
5. Add SSH command planning and mocked transport tests.
6. Enable one dogfood remote status check between Windows and Mac.
7. Enable verification-only remote execution for selected DevNexus component
   checks.
8. Let DevNexus-Pharo contribute plugin-specific Mac and MCP capability probes.
9. Define live-runtime runner profiles only after read-only and verification
   flows are stable.

## Implementation Slicing

The first issue-slicing pass created these component-owned work items:

- `dev-nexus:local-79`: add remote host registry and host-local overlay model.
- `dev-nexus:local-80`: add runner profile schema with safety classes and
  approval gates.
- `dev-nexus:local-81`: record remote execution requests and results.
- `dev-nexus:local-82`: add read-only host capability check command.
- `dev-nexus:local-83`: plan SSH transport execution without live network
  dependency.
- `dev-nexus:local-84`: execute verification-only remote commands through
  approved runner profiles.
- `dev-nexus:local-85`: choose first Mac Windows remote runner dogfood policy.
- `dev-nexus:local-86`: run first read-only Mac Windows remote host status
  smoke.
- `dev-nexus-pharo:local-14`: contribute DevNexus-Pharo host capability probes
  and runner profile templates.
- `plexus:local-23`: align isolated live-smoke runner boundary with generic
  remote runner profiles.

`dev-nexus:local-79` is the first autonomous implementation slice. Live SSH,
Tailscale, Pharo runtime, Docker, package install, GUI, publication, and
destructive cleanup behavior remain gated by later dependent or blocked items.

## Open Questions

- Should the first shared host registry live entirely in the dogfood meta
  project, or should DevNexus provide a reusable home-level host registry?
- Should remote execution requests be stored in component work items,
  target-cycle facts, or a separate coordination record store?
- Should SSH execution be pull-based, where the remote host polls for approved
  requests, or push-based, where the requester opens SSH and runs the command?
- How should a host advertise temporary unavailability without being treated as
  broken?
- Which command profiles should be enabled first for the Mac and Windows
  dogfood machines?
