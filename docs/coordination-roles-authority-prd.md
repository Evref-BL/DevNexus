# Coordination Roles And Authority Product Requirements Document (PRD)

## Problem

DevNexus now records publication identity, component publication policy,
coordination handoffs, tracker roles, and provider-backed requests. Those
pieces are necessary, but they do not yet answer a basic operational question:
what is the current actor allowed to do?

The dogfood project exposed the gap directly. A bot-created pull request was
useful, but the next decision was unclear: should the bot wait for a human to
merge, or can it integrate verified work itself? The answer is not a Git
mechanic. It is a coordination authority decision that varies by project,
component, provider, environment, and actor role.

Without an explicit authority model, agents must rely on informal chat or
target-state notes. That is fragile. It can cause unnecessary waiting, human
account mix-ups, accidental provider writes, or unsafe merges. DevNexus needs a
small, explicit policy layer that tells agents whether they are acting as a
maintainer, contributor, reviewer, observer, or another configured role.

## Goals

- Let a DevNexus project declare actor roles and authority rules for Git,
  work-item, coordination, review, and publication actions.
- Make the current actor's effective permissions visible in project status,
  agent launch context, target reports, and coordination commands.
- Keep implementation work selection separate from authority. A coordinator
  still chooses work; authority only gates what actions may be taken.
- Support project, component, provider, tracker, branch, and environment
  scopes without requiring users to configure every case up front.
- Prevent human-account fallback for bot actions and bot-account fallback for
  human/manual actions.
- Let a project choose direct integration, pull-request handoff, draft-only
  provider requests, or read-only observation per actor.
- Use provider-native approval signals where possible, such as pull request
  review approval, required checks, branch protection, issue labels, project
  status moves, or Jira transitions.
- Keep live external writes and merges testable with mocked providers before
  requiring credentials.

## Non-Goals

- Do not make DevNexus choose implementation work or supervise engineering
  decisions.
- Do not infer approval from issue assignment, a casual comment, or silence.
- Do not bypass provider permissions, branch protection, required checks, or
  repository settings.
- Do not store secrets, private keys, browser sessions, or raw tokens in the
  portable project configuration.
- Do not require GitHub, GitLab, Jira, or any other provider to support every
  authority capability.
- Do not make direct integration the default for open-source contribution
  workflows.

## Users

- A project owner configuring how agents may act in a DevNexus project.
- A coordinator agent deciding whether to merge, open a pull request, request
  review, or hand off.
- A worker agent that needs to know whether it can push a branch, update a work
  item, or post a provider request.
- A human maintainer reviewing what an automation actor is allowed to do.
- A bot account or machine user used for agent-created Git and provider
  actions.
- A contributor agent preparing changes for a repository it does not maintain.

## Product Vocabulary

- Actor: the current human, bot, machine user, service account, external agent,
  or anonymous local process attempting an action.
- Auth profile: the host-local credential profile used to act as an actor, such
  as a GitHub CLI configuration directory or Secure Shell (SSH) host alias.
- Role: a named authority bundle such as maintainer, contributor, reviewer, or
  observer.
- Authority: a specific allowed action or action class, such as push branch,
  open pull request, approve review, merge pull request, update work item, or
  post provider comment.
- Scope: the project, component, provider, tracker, repository, branch, target
  branch, environment, or runtime boundary where a role applies.
- Effective authority: the result of combining actor identity, role bindings,
  component policy, provider capability, runtime safety policy, and provider
  state.

## Role Model

DevNexus should ship with a small recommended role vocabulary while allowing
projects to define their own roles.

Recommended roles:

- Maintainer: may push non-protected branches, open pull requests, update work
  items, request review, merge approved work, and directly integrate verified
  work when component publication policy allows it.
- Contributor: may create worktrees, commit, push feature branches, open pull
  requests, update owned work items, and request review, but cannot approve or
  merge.
- Reviewer: may inspect work, comment, request changes, approve or reject
  review requests where provider policy allows it, but does not publish source
  changes by default.
- Observer: may read status, record notes, and produce handoffs, but cannot
  mutate source, trackers, providers, or runtime state.
- Runtime operator: may perform approved live runtime or host-local actions
  such as starting services, running Docker jobs, or cleaning isolated runtime
  state, without automatically gaining merge authority.
- Release operator: may tag, publish packages, or run release commands when
  release policy allows it, without automatically gaining implementation
  authority.

Roles should be composable. For example, a bot can be a maintainer for the
private dogfood meta-project and a contributor for a third-party open-source
repository.

## Authority Actions

The first implementation should model authority as explicit action names rather
than only broad roles. Roles expand into actions, and policy checks reason
about actions.

Initial action classes:

- Read project state, work items, provider state, and Git status.
- Create or update local work items.
- Comment on local work items.
- Create local worktrees and branches.
- Commit local changes.
- Push non-protected branches.
- Push directly to a target branch.
- Open or update pull requests or merge requests.
- Request human or provider review.
- Post provider comments, labels, assignments, or status transitions.
- Approve or reject provider review requests.
- Merge pull requests or merge requests.
- Close work items or provider issues.
- Publish packages or releases.
- Run live runtime, dependency install, or host mutation actions.

Each action should have a clear blocked result when disallowed. The result
should say which policy blocked the action and what safer action is available,
such as "open a pull request" or "record a handoff."

## Configuration Direction

The portable project configuration should describe logical actors, roles, and
scope rules. Host-local overlays should bind those logical actors to local
credential material.

Conceptual configuration:

- Actors have stable ids, provider identities, display names, and kind values
  such as human, machine_user, service_account, external_agent, or local.
- Auth profiles map an actor id to host-local credential mechanisms.
- Role bindings assign roles or action grants to actors in scoped contexts.
- Component publication policy references required roles or actions for direct
  integration, pull request creation, merge, and publish.
- Provider policy maps provider-specific signals to neutral authority events.
- Default project policy defines a safe fallback when no binding matches.

Recommended defaults:

- Unknown actor: observer.
- Human manual profile: governed by manual project policy, not automation
  policy.
- Automation bot profile: no authority unless explicitly bound.
- Open-source external repository: contributor unless explicitly configured as
  maintainer.
- Direct integration: disabled unless both component publication policy and
  actor authority allow it.

The dogfood project can bind the configured bot actor as maintainer for
DevNexus-managed components where direct integration is already allowed, while
keeping review-handoff components as contributor or observer until policy is
updated.

## Effective Authority Resolution

Before a command mutates state, DevNexus should resolve effective authority.

Resolution inputs:

- Current actor and auth profile.
- Current project and component.
- Requested action.
- Target provider, tracker, remote, repository, branch, or runtime boundary.
- Component publication policy.
- Automation safety profile.
- Provider capabilities and provider state.
- Required checks, approval state, branch protection, and mergeability when
  available.
- Work-item or coordination state, such as waiting, approved, blocked, or
  changes requested.

The result should include:

- Allowed or blocked.
- Matched role and policy rule.
- Required missing actions or provider signals.
- Recommended fallback action.
- A compact explanation suitable for target-cycle facts and agent context.

## User-Facing Surfaces

### Project Status

Project status should show a concise authority summary:

- Current actor identity when detectable.
- Current auth profile name.
- Roles bound for each component.
- Direct integration, pull request, review, merge, and publish authority.
- Warnings for missing auth, ambiguous account, or mismatched remote profile.

### Agent Launch Context

Agent context should include the selected actor profile and effective authority
for assigned components. Workers should know up front whether they are expected
to integrate, open a pull request, request review, or only hand off.

### Coordination Commands

Coordination status and handoff should report authority alongside Git and work
state. Coordination integrate should refuse to merge when the actor lacks
authority, but can still produce a mutation-free integration plan. Coordination
request should know whether it may draft, post, label, assign, or transition a
provider item.

### Publication Commands

Publication helpers should check authority before pushing, opening a pull
request, approving, merging, tagging, or publishing. When blocked, they should
record a clear handoff or provider request instead of failing silently.

## Provider Signals

Provider-native state should map into neutral DevNexus authority signals.

Useful neutral signals:

- waiting_for_approval.
- approved.
- changes_requested.
- rejected.
- checks_pending.
- checks_failed.
- checks_passed.
- branch_policy_blocked.
- mergeable.
- merge_conflict.
- timed_out.

Examples:

- GitHub pull request review approval plus required checks can satisfy merge
  approval when component policy allows provider-approved merge.
- GitHub issue labels or GitHub Projects status moves can approve issue-level
  design decisions when configured.
- Jira workflow transitions can unlock continuation or close a waiting request
  when configured.
- Assignment remains ownership or expected-responder metadata. It is not an
  approval signal by default.

## State Machine Effects

Authority decisions should update DevNexus state in a factual way:

- Disallowed mutation: record blocked action, required authority, and suggested
  fallback.
- Pull request opened: mark work as waiting for review when policy requires
  review before merge.
- Provider approval observed: record actor, provider object, timestamp, and
  signal that unlocked the action.
- Merge completed: record publication decision, merge commit or head commit,
  verification evidence, and provider link.
- Ambiguous provider state: keep the work item waiting or blocked rather than
  assuming approval.
- Direct integration allowed: record the matching role and policy rule that
  allowed it.

## User Stories

- As a project owner, I can declare that the bot account is a maintainer for my
  private DevNexus project and a contributor for external repositories.
- As a coordinator agent, I can see that I may merge verified DevNexus work
  directly but must open a pull request for MCP-Pharo.
- As a worker agent, I can finish work and know whether to push a branch,
  create a pull request, request review, or only write a handoff.
- As a human maintainer, I can inspect a target report and see why an agent
  merged a change without manual intervention.
- As an open-source contributor, I can use DevNexus without contaminating the
  target project with DevNexus artifacts or requiring maintainer permissions.
- As a reviewer, I can approve or request changes without also granting the
  agent merge permission.

## Implementation Decisions

- DevNexus core owns the neutral actor, role, action, and authority model.
- Provider adapters own provider-specific identity, permission, approval, and
  branch-policy mapping.
- Authority checks should be pure and unit-testable wherever possible.
- The first implementation should gate DevNexus command behavior and status
  reporting before adding live provider mutation.
- Existing publication strategy remains, but it becomes one input to authority
  resolution rather than the whole decision.
- Dogfood account names should stay in project configuration and docs examples
  only when they are explicitly dogfood-specific. Generic docs should use
  placeholder names.
- A blocked authority check should be non-interactive by default and should
  provide a machine-readable result for automation.

## Testing Decisions

- Unit-test role expansion into action grants.
- Unit-test scope precedence: project default, component override, provider
  override, branch override, and environment override.
- Unit-test effective authority for maintainer direct integration, contributor
  pull-request-only flow, reviewer approval-only flow, and observer read-only
  flow.
- Unit-test account mismatch detection for human versus bot remotes and auth
  profiles.
- Unit-test publication gating for direct push, pull request creation, merge,
  and release publish.
- Unit-test coordination request gating for draft-only, provider-comment
  allowed, label allowed, assignment allowed, and transition allowed.
- Unit-test provider signal mapping with mocked GitHub, GitLab, and Jira
  responses.
- Unit-test target-cycle facts and target reports so authority decisions are
  auditable.
- Avoid live credentials in core tests. Optional provider smoke tests can run
  only under explicit approved profiles.

## Acceptance Criteria

- Project configuration can declare actors, roles, action grants, and scoped
  role bindings.
- Host-local auth profile resolution can identify the current actor or report
  an ambiguous actor safely.
- Project status and agent context show effective authority for relevant
  components.
- Publication and coordination commands block disallowed push, pull request,
  approval, merge, provider mutation, and publish actions with actionable
  messages.
- Direct integration requires both component publication policy and actor
  authority.
- Pull request review approval and issue-level decision approval are distinct
  concepts.
- Assignment is not treated as approval unless a project explicitly overrides
  that default.
- Tests cover maintainer, contributor, reviewer, observer, account mismatch,
  and provider-signal cases with mocked providers.
- Documentation explains how to configure private-project maintainer bots and
  open-source contributor workflows.

## Out Of Scope For The First Implementation

- Automatic live provider permission discovery across every provider.
- User interface beyond command-line interface, Model Context Protocol (MCP),
  status, report, and generated agent context.
- Automatic semantic review, code ownership inference, or branch conflict
  resolution.
- Automatic approval on silence, assignment, or casual comments.
- Secret management beyond referencing named host-local auth profiles.
- Real-time provider webhooks.

## Implementation Slicing

After this Product Requirements Document is accepted, use the issue-slicing
workflow to create or refine component-owned DevNexus work items. Expected
slices:

- Actor, role, action, and scoped authority schema.
- Host-local auth profile and current-actor detection.
- Effective authority resolver with project/component/provider precedence.
- Project status, target report, and agent context authority summaries.
- Publication gating for direct push, pull request creation, merge, and publish.
- Coordination gating for handoff, request, integrate, provider mutation, and
  review approval.
- Provider signal mapping with mocked GitHub, GitLab, and Jira adapters.
- User-facing configuration and onboarding documentation.

## Open Questions

- Should DevNexus ship only recommended role names, or also built-in role
  definitions that projects can override?
- Should direct integration require a separate maintainer role and publish role,
  or is one role enough for normal projects?
- How much provider permission should DevNexus probe live versus relying on
  configured policy and provider failure results?
- Should a maintainer bot be allowed to self-approve a pull request, or should
  approval and merge authority require different actors by default?
- How should DevNexus represent temporary authority elevation for a single
  target cycle?
- Should project-local role policy be mirrored to shared trackers for external
  participants, or kept only in the DevNexus meta-project?
