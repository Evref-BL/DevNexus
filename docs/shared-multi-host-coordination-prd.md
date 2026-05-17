# Shared Multi-Host Coordination Product Requirements Document (PRD)

## Problem

Mac and Windows agents can use Git worktrees and branches for parallel work,
but they currently do not share enough intent. The painful moment is
integration: one machine has to merge changes while its agent does not know the
other machine's current design direction, branch state, verification evidence,
or preferred merge order.

Hard locks would reduce parallelism and work against the value of worktrees.
The feature should preserve parallel work while making handoff and integration
state durable, shared, and easy for agents to consume.

## Goals

- Make the agent-facing Application Programming Interface (API) extremely
  small.
- Avoid hard locks by default.
- Let agents keep working in separate worktrees and branches.
- Make shared work-item intent, handoffs, branch state, and merge decisions the
  durable source of truth.
- Automate discovery: infer host, component, work item, branch, commits,
  changed areas, pushed state, related branches, verification, and conflicts
  whenever possible.
- Support Mac and Windows as peers without choosing one permanent integration
  machine.
- Coordinate with external humans and agents through existing provider systems,
  such as GitHub Issues, GitHub pull requests, GitLab issues, GitLab merge
  requests, Jira issues, and review comments.
- Turn approval waits, feedback waits, and design questions into durable
  provider-backed coordination records.
- Keep transport replaceable: Git remotes and the shared work tracker are the
  durable state; Tailscale can expose a private DevNexus coordination MCP for
  faster direct access.

## Non-Goals

- No mandatory hard work locks or exclusive leases in the first version.
- No freeform chat as the primary source of truth.
- No provider-specific workflow vocabulary in the generic agent-facing API.
- No automatic semantic conflict resolution.
- No automatic approval, review dismissal, or merge based only on a comment.
- No live Pharo image, PLexus, Docker, or host process work as part of this
  generic coordination feature.
- No shared absolute source paths, tool binary paths, runtime ports, secrets,
  logs, or worktrees in the portable project definition.

## Users

- A Mac coordinator or worker agent advancing a component work item.
- A Windows coordinator or worker agent advancing a related component work
  item.
- An integration agent that must merge branches from either host using the
  current shared vision instead of stale local context.
- A human reviewing the current multi-host state.
- An external reviewer responding in a GitHub pull request, GitLab merge
  request, Jira issue, or similar provider.
- A third-party agent participating through a provider issue or review thread.

## Dumb API

The DevNexus MCP and CLI should expose four high-level operations. Required
arguments should be minimal; the tool should infer the rest from the current
project, worktree, Git branch, shared tracker, and target state.

### `coordination_status`

Read-only by default.

Inputs:

- Optional component or work item scope.

Automation:

- Fetch configured remotes when policy allows.
- Identify current host, component, worktree, branch, base ref, and dirty state.
- Read shared work items and recent handoffs.
- Detect related active branches by work item, component, changed area, and
  target cycle facts.
- Report stale handoffs, unpushed local commits, missing upstream branches, and
  likely integration order.
- Return the smallest useful next action for the current agent.

### `coordination_handoff`

Records what the current agent wants the next agent to know.

Inputs:

- Optional work item.
- Optional status: `working`, `ready`, `blocked`, or `merged`.
- Optional note.

Automation:

- Infer component, work item, host id, agent id, branch, base ref, head commit,
  changed paths, changed packages, pushed/unpushed state, and recent verification
  evidence.
- Push a non-protected handoff branch when project policy explicitly allows it.
- Write a structured handoff record to the shared work tracker.
- Attach concise branch and verification facts to the work item.
- Suggest related work items or branches that should integrate before or after
  this branch.

### `coordination_integrate`

Plans integration, and later can apply it when explicitly allowed by policy.

Inputs:

- Optional work item, branch, or target branch.

Automation:

- Fetch configured remotes.
- Gather branches and handoffs related to the work item or target.
- Run conflict forecasts using Git merge-base, merge-tree or an equivalent
  temporary worktree trial merge, and range-diff where useful.
- Read recorded decisions and verification notes before suggesting merge
  direction.
- Produce an integration plan with clean merges, conflicts, affected files,
  competing decisions, suggested order, and verification commands.
- Create an integration work item or integration branch only when configured
  policy allows mutation.

### `coordination_request`

Asks for external feedback, records waits, and later summarizes responses.

Inputs:

- Required intent: `approval`, `feedback`, `choice`, or `review`.
- Optional question or short note.
- Optional target: work item, branch, pull request, merge request, issue, or
  reviewer identity.

Automation:

- Infer current component, work item, branch, commits, changed areas, and
  relevant provider object.
- Choose the configured provider channel for the target: issue comment, pull
  request review comment, merge request note, Jira comment, or a DevNexus
  coordination record.
- Draft or post the smallest provider-native question with context, options,
  branch links, verification evidence, and explicit response expectations.
- Mark the local work item, target cycle, or coordination record as waiting for
  external input when policy allows.
- Poll or read provider responses, summarize decisions, unresolved questions,
  approvals, requested changes, and stale waits.
- Convert provider-specific states into neutral statuses: `waiting`,
  `answered`, `approved`, `changes_requested`, `timed_out`, or `blocked`.

## Shared Data Model

Coordination records should be tracker-backed and portable. A record should be
small enough to fit naturally in a work-item comment or provider metadata.

Fields:

- Project id and component id.
- Work item reference.
- Host id and optional agent id.
- Status: `working`, `ready`, `blocked`, `merged`, or `stale`.
- Branch name, base ref, head commit, upstream, and pushed state.
- Changed areas summarized from Git paths and known package/component roots.
- Decisions and assumptions stated by the agent.
- Verification commands and outcomes.
- Related branches or work items.
- Integration preference, when known.
- External request intent and provider target, when present.
- Waiting status, responder identity, response summary, and requested changes.
- Created and updated timestamps.

Freshness is advisory. A stale record means "check before trusting" rather than
"blocked from working."

## Source Of Truth

- Git remotes hold source branches and integration branches.
- The shared work tracker holds work intent, handoffs, decisions, and
  integration records.
- Provider-native issue, pull request, merge request, review, or Jira threads
  hold external feedback where those systems are the right audience.
- The portable DevNexus project repo holds logical project configuration,
  plugin declarations, shared plans, and policy defaults.
- Host-local DevNexus overlays hold absolute paths, local command paths,
  runtime ports, and secrets.
- Tailscale may expose private MCP endpoints between machines, but durable
  coordination must survive either machine being offline.

## User Stories

- As a Windows agent, I can run coordination status before editing and see that
  the Mac agent has a related parser branch with a decision that should land
  first.
- As a Mac agent, I can run coordination handoff at the end of a turn and have
  DevNexus record my branch, commits, changed areas, verification, and design
  notes without hand-writing a long comment.
- As an integration agent, I can run coordination integrate and get a merge
  plan that includes both Mac and Windows branches, likely conflicts, intended
  merge order, and the work-item decisions that explain why.
- As a human, I can inspect one shared work item and understand current work
  across both machines.
- As a coordinator agent, I can ask a reviewer for approval on a design choice
  without manually composing a long provider comment.
- As a worker agent, I can see that an item is waiting on a GitHub pull request
  review or Jira answer and avoid inventing a decision locally.
- As an integration agent, I can summarize external feedback and requested
  changes before merging.

## Implementation Decisions

- DevNexus owns the generic coordination API.
- Shared trackers are the preferred backing store. GitHub Issues or another
  shared provider should be used for real multi-host operation; local JSON is
  acceptable for dogfood only.
- Branch naming should remain conventional rather than enforced by locks. The
  tool should recognize host/item hints when present.
- The first implementation should be read-mostly: status and handoff are safe
  before integration mutation exists.
- Integration mutation should be gated by project policy and should start with
  integration plans before automatic merges.
- External coordination should reuse provider-native discussion surfaces
  instead of creating a separate chat system.
- The generic API should use neutral request intents and statuses while provider
  adapters handle GitHub, GitLab, Jira, or other wording.
- Agents may draft external requests without posting when provider mutation is
  not approved.

## External Coordination Policy Notes

Live external coordination should start from conservative provider policies.
The tool can draft almost anything, but posting, assigning, reviewing, merging,
closing, labeling, and pinging are separate capabilities.

Candidate events that may need coordination:

- Error triage: ask on an issue for help understanding a failure, reproduction
  evidence, affected environment, expected behavior, and likely owner.
- Solution agreement: propose an implementation direction on an issue and wait
  for explicit agreement before editing high-risk behavior.
- Option choice: present two or three concrete alternatives with tradeoffs and
  wait for a chosen option before continuing.
- Ownership transfer: ask whether another human or agent should own the issue,
  component, integration branch, or review.
- Permission request: ask for access, credentials, package publish rights,
  repository settings, runner access, or protected-branch permissions.
- Runtime approval: ask before live service work, Docker jobs, destructive
  cleanup, image deletion, migrations, release publishing, or external posting.
- Merge request or pull request review: open a proposed change, wait for
  provider-native approval, and do not merge when approval, checks, or
  permissions are missing.
- Review response: ask whether requested changes are accepted, disputed,
  deferred, or out of scope, then record the decision.
- Continuous integration failure: ask whether to fix, retry, ignore a flaky
  failure, or split the change when automated evidence is ambiguous.
- Integration conflict: ask which branch, design decision, or source of truth
  should win when branches or handoffs disagree.
- Scope change: ask before expanding an issue beyond its original acceptance
  criteria or moving work into a new issue.
- API or behavior change: ask before changing public contracts, configuration
  names, command behavior, data formats, dependency versions, or migration
  policy.
- Release or rollback decision: ask before tagging, publishing packages,
  merging release branches, reverting published work, or cutting a hotfix.
- Stale wait: ask whether to ping, keep waiting, downgrade to draft-only, or
  mark blocked after a configured quiet period.
- External dependency: ask upstream maintainers or third-party agents for a
  decision when work depends on an upstream issue, pull request, or release.
- Human escalation: ask a human to intervene when an agent is uncertain, the
  provider state is contradictory, or the next action would cross a configured
  safety boundary.

Approval signals should be explicit and provider-native. Assignment can be a
useful ownership signal, but it is ambiguous as an approval signal by itself.
A safer first policy is:

- An issue assignment means the assigned person or agent is the expected
  responder or owner, not that the proposal is approved.
- A proposal is approved by an explicit provider-native approval, an
  `approved` label/comment recognized by policy, or a configured status
  transition.
- A merge request or pull request may be merged only when provider approval,
  required checks, target branch policy, and DevNexus publication policy all
  allow it.
- Silence should become `waiting` and then `timed_out` or `blocked`, not
  implicit approval.
- DevNexus should record the exact provider object, signal, actor, timestamp,
  and summary that justified continuing.

## Testing Decisions

- Unit-test host/worktree/component inference with Windows and POSIX-style
  paths.
- Unit-test handoff record generation from mocked Git state and work tracker
  state.
- Unit-test stale record detection without treating stale state as a lock.
- Unit-test integration planning against synthetic branches with clean merges,
  textual conflicts, and diverging decisions.
- Add CLI and MCP coverage for the three high-level operations.
- Add CLI and MCP coverage for external request draft/post/read/summarize
  behavior with mocked providers.
- Test neutral status mapping from GitHub/GitLab/Jira-style responses.
- Avoid live network, Tailscale, or external tracker dependencies in core tests;
  use provider mocks.

## Open Questions

- Which shared tracker should be first for real Mac/Windows dogfood: GitHub
  Issues, GitHub Projects, or a lightweight DevNexus coordination service?
- Should handoff branch push be automatic for feature branches, or require
  explicit project policy per component?
- How should host identity be named when multiple agents run on one host?
- Should integration planning create a tracker item automatically when
  conflicts are detected, or only suggest one?
- Which provider actions can be performed automatically, and which should be
  draft-only until a human approves?
- How should DevNexus represent silence or stale external waits without
  repeatedly pinging people?
