# Parallel Agent Git Workflow Product Requirements Document (PRD)

## Problem

DevNexus and Codex currently share one project directory per machine. When
multiple chats are started in the same project, they usually begin on the same
branch and the same working tree. Agents often make local edits directly on the
shared branch unless the user explicitly asks for a Git worktree or the agent
chooses one itself.

That default creates avoidable coordination risk. Two chats can unknowingly edit
the same source surface, the same DevNexus project state, or the same local
work-item store. Some chats push directly to `main`, some leave unmerged
branches, and some open pull requests. The human then has to remember which
branch contains which work, notice stale or unmerged branches, and prevent
source or planning changes from being lost.

The desired product behavior is the opposite: the user should be able to start
parallel chats freely, even across machines, while DevNexus gives agents strong
default guardrails for ownership, isolation, handoff, integration, and cleanup.
Those guardrails should reduce accidental overlap without turning every small
task into a heavyweight process.

## Goals

- Make isolated worktrees the default for agent-created mutations.
- Make DevNexus-controlled mutations fail closed when the target is a shared
  project or component checkout.
- Keep shared project and component checkouts useful as read-mostly control
  rooms for status, coordination, setup, and integration.
- Let multiple chats work in parallel when they own different work items,
  components, branches, or declared write scopes.
- Make active work visible across hosts before an agent starts editing.
- Prevent accidental work loss from dirty shared checkouts, unpushed commits,
  stale branches, abandoned worktrees, or premature cleanup.
- Keep direct integration fast when a change is small, verified, and
  publication policy allows it.
- Ensure agent-created Git and GitHub activity uses the configured automation
  identity, while manual human activity keeps the human default identity.
- Give the project a single integration path that serializes merges to `main`
  and records the facts needed for later recovery.
- Support local-only dogfood trackers now while fitting future shared trackers
  such as GitHub Issues, GitHub Projects, GitLab, Jira, or a DevNexus
  coordination service.

## Non-Goals

- Do not require a pull request for every small change.
- Do not make long-lived per-machine branches the default isolation mechanism.
- Do not add mandatory hard locks that prevent useful parallel work.
- Do not make DevNexus choose implementation work. Coordinators and humans
  still choose what to work on.
- Do not make freeform chat history the durable source of truth.
- Do not allow automatic branch deletion or worktree cleanup when there are
  dirty files, unpushed commits, missing handoffs, or unknown publication state.
- Do not bypass component publication policy, verification policy, or automation
  identity policy.
- Do not require live Model Context Protocol (MCP), Pharo, PLexus, Docker, or
  remote-host execution for the Git workflow itself.

## Current State

DevNexus already models most of the needed building blocks: components, source
roots, worktree roots, local work-item stores, coordination handoffs,
integration planning, verification commands, publication policy, and automation
actor metadata.

The gap is the default behavior around interactive chats. A chat that starts in
the shared checkout can mutate source or project state before it has claimed a
bounded surface. The shared checkout then becomes both a coordination surface and
an implementation surface. That is the source of drift and surprise.

The local work-item store is also a concurrency weak point. When many agents
edit project state directly, the tracker files can collect unrelated changes
from different chats. This is tolerable for one coordinator but fragile when
multiple interactive chats and multiple hosts are active.

Instructions alone are not enough here. Mistakes happen before a model has time
to reason about policy: a tool writes a tracker file, refreshes projected
skills, stages a change, or commits on `main`. When DevNexus controls the
infrastructure operation, DevNexus should enforce the boundary in code instead
of relying on prompt compliance.

## Relationship To Authority

This workflow is adjacent to the Coordination Roles And Authority Product
Requirements Document (PRD), but it should not duplicate that policy layer.
Authority answers "is this actor allowed to take this action?" Parallel-agent
workflow answers "which work surface does this chat own, where should it edit,
what else is active, and how do we preserve or integrate the result?"

The authority model should own actor identity, roles, action grants, provider
approval signals, direct integration, pull-request behavior, provider mutation,
and publication gating. Parallel-agent workflow should consume the effective
authority result before mutating shared checkouts, writing leases, pushing
branches, integrating branches, or deleting branches and worktrees.

The overlap is intentional at the command boundary. For example,
`coordination integrate` may report both merge conflicts from the parallel-work
model and "merge not allowed" from the authority model. Those facts should be
shown together, but they come from different subsystems.

## Fail-Safe Principle

DevNexus-controlled mutations should fail closed unless the writable surface is
an owned worktree or an explicitly allowed bootstrap or integration operation.

A DevNexus-controlled mutation is any DevNexus CLI, MCP, automation, setup, or
coordination operation that writes Git state, project state, component source,
local work-item stores, projected support files, handoff records, target state,
branches, remotes, provider state, or cleanup results.

The guard should run before mutation, classify the target checkout, and refuse
ambiguous writes. The refusal should be non-interactive and machine-readable:
include the attempted action, target path, checkout classification, reason, and
safe next action such as prepare a project-meta worktree, prepare a component
worktree, adopt an existing owned worktree, or run the operation as an explicit
integrator.

The guard is not a hard lock between independent branches. It is a local
write-surface fail-safe: a worker may proceed in an owned worktree even if
another worker has an advisory lease. Related active work should still be
reported through coordination status and integration planning.

Allowed exceptions should be narrow:

- Read-only status, setup check, planning, and inspection commands.
- Bootstrap commands whose purpose is to create or adopt an owned worktree.
- Explicit integrator operations that serialize verified branches into `main`.
- Explicit rescue operations that preserve discovered work before cleanup.

Branch name is not proof of isolation. A worker branch checked out in the shared
project directory is still a shared-checkout mutation risk.

## Users

- A human maintainer starting several Codex chats in one DevNexus project.
- A Windows coordinator or worker agent.
- A Mac coordinator or worker agent.
- An integration agent responsible for merging ready branches to `main`.
- A worker agent implementing one bounded work item.
- A planning agent editing Product Requirements Documents (PRDs), target state,
  or DevNexus project metadata.
- A cleanup agent pruning stale worktrees and branches without losing work.

## Product Model

### Shared Checkout

A shared checkout is the normal DevNexus or component checkout opened by a human
or by the Codex project. It should be treated as read-mostly by agents.

Allowed default actions:

- Read project state and component status.
- Inspect current Git state.
- Run safe read-only coordination commands.
- Prepare a new worktree.
- Integrate ready work when the agent is explicitly in the integrator role.

Disallowed default actions:

- Edit source files.
- Edit DevNexus project state.
- Commit implementation changes.
- Push directly to `main`.
- Delete branches or worktrees.

An explicit override can allow shared-checkout mutation, but it should be
visible in the run facts or handoff.

### Worktree Lease

A worktree lease is an advisory ownership record for one active agent surface.
It is not a hard lock, but it gives other agents enough information to avoid
unintentional overlap.

Useful fields:

- Project id.
- Host id.
- Agent or chat id when available.
- Component id or project-meta scope.
- Work item id when available.
- Branch name.
- Worktree path classification.
- Base ref and creation time.
- Intended write scope.
- Status: `working`, `ready`, `blocked`, `integrating`, `merged`, `abandoned`,
  or `stale`.
- Last observed head commit.
- Dirty state and pushed state.
- Last verification summary.

Fresh leases are strong signals. Stale leases are warnings that require status
checks before cleanup or conflicting work.

### Branch Types

The workflow needs a small branch vocabulary.

- `main`: protected integration target for published work.
- Work-item branch: short-lived branch for one bounded item or surface.
- Meta branch: short-lived branch for project documents, planning state, or
  DevNexus project configuration.
- Integration branch: temporary branch used to merge several ready branches
  before publishing.
- Rescue branch: branch created to preserve discovered or abandoned work before
  cleanup.

Long-lived per-machine branches are allowed for special cases, but they should
not be the default. They hide drift and make integration slower.

### Worker Role

A worker agent owns one bounded surface. It prepares or uses a worktree, edits
only that worktree, verifies the change, commits before ending the chat when
there is source value to preserve, and records a handoff.

A worker should not push directly to `main`. It may push its own branch when
publication policy allows branch publication.

### Integrator Role

An integrator agent serializes ready work. It reads leases, handoffs, active
branches, dirty worktrees, verification summaries, and publication policy before
merging anything.

The integrator may fast-forward or merge to `main` when:

- The branch has a ready handoff or equivalent explicit intent.
- The branch has no uncommitted work.
- The branch head is recoverable locally or remotely.
- Relevant verification passed or a policy-approved exception is recorded.
- Related active work has been checked for conflicts.
- The automation actor matches publication policy.

### Handoff

Every mutating agent should leave a handoff before ending the chat, switching
tasks, or asking another machine to continue.

A handoff should summarize:

- Status.
- Work item or planning artifact.
- Branch and head commit.
- Changed areas.
- Verification.
- Remaining decisions.
- Integration preference.
- Known conflicts or dependencies.

The handoff should be durable enough that another agent can continue without
reading the original chat transcript.

### Cleanup Guard

Cleanup must be conservative. A branch or worktree is safe to remove only when
DevNexus can prove that one of these is true:

- Its commits are merged into the target branch.
- Its commits are superseded by another recorded branch or commit.
- Its work is explicitly abandoned and preserved in a rescue branch or archive
  record.
- It has no commits, no dirty files, and no active lease.

When proof is missing, cleanup should report a blocker instead of deleting.

## User Stories

- As a human, I can start several chats in one project without remembering which
  branch each chat should use.
- As a worker agent, I can ask DevNexus for a safe starting point and receive a
  prepared worktree, branch, ownership metadata, and write-scope guidance.
- As a worker agent, I am blocked before editing the shared checkout unless I
  explicitly own integration or project-state mutation.
- As a human maintainer, I can rely on DevNexus tools to block shared-checkout
  mutations before they touch `main`, not merely warn an agent after the fact.
- As a Mac agent, I can see that a Windows agent is already working on a related
  component surface before I start editing.
- As an integration agent, I can see all ready branches, their verification
  state, likely conflicts, and suggested merge order.
- As a cleanup agent, I can prune old worktrees and branches without deleting
  unmerged or unpushed work.
- As a maintainer, I can inspect one coordination surface and understand what is
  working, ready, blocked, merged, stale, or abandoned.
- As an agent, I can preserve useful uncommitted work by moving it to a rescue
  branch rather than leaving it hidden in a dirty checkout.

## User-Facing Surface

### Start Or Adopt Work

DevNexus should provide a simple start/adopt flow. The flow should inspect the
current checkout, infer project and component context, check active leases, then
prepare a worktree or adopt an existing owned worktree.

The result should tell the agent:

- Where to run Git and source commands.
- Which branch it owns.
- Which files or areas are in scope.
- Which related active work may conflict.
- What handoff is expected.

### Mutation Guard

Every DevNexus-controlled mutating command should pass through the same checkout
mutation guard. The guard should decide whether the command is read-only,
bootstrap, worker mutation, integration, rescue, cleanup, provider mutation, or
unknown. Unknown mutating commands should be refused until classified.

The first implementation can use explicit command and action allowlists instead
of waiting for the full authority resolver. Authority should later refine who
may use overrides, integrate to `main`, push branches, mutate providers, or run
cleanup.

### Coordination Status

Coordination status should answer the question "what work exists that might
affect me?" without requiring the agent to know every branch name.

It should show:

- Active leases.
- Dirty shared checkouts.
- Dirty generated worktrees.
- Ready handoffs.
- Stale handoffs.
- Unpushed commits.
- Branches ahead of or behind target branches.
- Branches that touch overlapping files or packages.
- Suggested next action.

### Handoff

The handoff command should infer as much as possible from Git state and project
state. A good default handoff requires only status and a short note.

### Integration Plan

The integration plan should be read-only by default. It should fetch when policy
allows, identify related branches, forecast conflicts, and propose a merge order.

Applying the plan should be a separate policy-gated action.

### Cleanup Plan

Cleanup should have a dry-run-first surface. It should explain why each branch
or worktree is safe, blocked, stale, or needs human review.

## Implementation Decisions

- Default mutating chat behavior should be worktree-first and tool-enforced.
- Shared checkouts should be read-mostly. DevNexus-controlled writes to shared
  checkouts should fail closed except for explicit bootstrap, integration,
  rescue, or authority-approved project-state ownership.
- Tool enforcement should happen before a file write, Git mutation, provider
  mutation, or tracker mutation, not after detecting a dirty checkout.
- Worktree leases should be advisory, not hard locks.
- Branch names should include enough component and work-item context for humans
  to scan them.
- Integration to `main` should be serialized by an integrator path.
- Direct push can remain available for the integrator when component policy
  allows it.
- Worker agents should preserve work with commits and handoffs before ending.
- Cleanup should optimize for no work loss over aggressive tidiness.
- Local work-item stores remain acceptable for dogfood, but shared multi-host
  operation should eventually use a provider-backed coordination tracker or
  robust sync layer.
- Automation identity and authority checks should run before agent-created Git,
  GitHub, provider, integration, cleanup, or publication mutations.
- Publication and provider mutation behavior should defer to the authority
  resolver instead of introducing a second role model in the parallel-agent
  workflow.

## Testing Decisions

- Test that mutating commands detect shared checkouts and require explicit
  permission or worktree preparation.
- Test worktree lease creation, refresh, stale detection, and status reporting.
- Test component and project-meta branch naming across Windows and POSIX-style
  paths.
- Test handoff inference from dirty, clean, pushed, unpushed, ahead, and behind
  Git states.
- Test integration planning for clean merges, textual conflicts, stale handoffs,
  and overlapping changed files.
- Test cleanup refusal for dirty files, unpushed commits, missing handoffs, and
  unknown merge state.
- Test cleanup success for merged branches, empty worktrees, and explicitly
  abandoned preserved branches.
- Test automation identity mismatch failures before push or provider mutation.
- Keep network, provider, and live-runtime tests mocked unless an explicit
  runner profile enables a live smoke.

## Rollout Plan

1. Document the worktree-first policy in project instructions and agent
   workflow docs.
2. Add a fail-closed shared-checkout mutation guard for DevNexus-controlled
   mutating flows, starting with local work-item writes, target/project-state
   writes, skill/MCP projection refreshes, coordination handoffs, publication,
   integration, and cleanup execution.
3. Add explicit worktree lease records and coordination status output.
4. Teach handoff and status commands to report dirty shared checkouts,
   unpushed commits, and branch recoverability.
5. Add a cleanup dry-run that classifies branches and worktrees by safety.
6. Add policy-gated cleanup execution.
7. Add integration planning improvements for multiple ready branches and
   overlapping write scopes.
8. Move multi-host coordination records from local-only state to a shared
   provider-backed or sync-backed tracker when the tracker model is ready.

## Out Of Scope For First Version

- Semantic conflict resolution.
- Automatic branch merge based only on naming conventions.
- Fully automatic cleanup of ambiguous work.
- Required pull requests for every direct-integration component.
- Mandatory remote-host execution.
- Live runtime startup, Docker work, Pharo image mutation, or PLexus lifecycle
  work.
- Complete replacement of local work-item stores.

## Open Questions

- Should every interactive chat start by adopting a DevNexus current-agent
  context, even for small planning questions?
- Which legacy mutating commands need temporary explicit overrides while the
  fail-closed guard is rolled out?
- What is the right lease storage location before shared provider-backed
  coordination is enabled?
- Should project-meta edits use a dedicated meta component in the project model?
- When should a worker push its branch automatically, and when should it keep
  the branch local with a handoff?
- Should integration branches be mandatory for batches, or only when multiple
  ready branches touch overlapping areas?
- How long should a lease be quiet before it becomes stale?
