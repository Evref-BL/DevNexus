# Component Multi-Tracker Work Tracking Product Requirements Document (PRD)

## Problem

DevNexus currently treats work tracking as a component-scoped system of record.
That boundary is correct: components own source roots, worktrees, verification,
publication, and work items independently. The current model, however, allows
only one neutral work tracker per component. A component can use a local store,
GitHub Issues, GitLab issues, Jira, or another configured provider, but it
cannot model the common case where one component needs more than one work-item
surface at the same time.

The dogfood project already points at several real needs:

- Local work items are fast and safe for immediate dogfooding.
- GitHub Issues or GitHub Projects are the likely shared source for multi-host
  Mac and Windows coordination.
- External coordination requests may need to post or read provider-native
  threads while local automation continues to use a local component tracker.
- Provider migration should not require an unsafe cutover from one tracker to
  another.
- Some items should sync externally, but not every local task, blocker, runtime
  note, or planning detail belongs in a shared provider.

The absence of named tracker bindings forces a false choice: either keep
everything local and lose durable shared coordination, or move the component to
an external tracker and lose safe local/offline staging. DevNexus needs a model
that can represent multiple trackers, decide which one is canonical for each
operation, and sync selected work items between them deliberately.

## Goals

- Allow each component to configure multiple named work trackers.
- Preserve the existing single-tracker component behavior without breaking old
  project configurations.
- Let a component declare one default tracker for ordinary work-item operations.
- Let a component use different tracker roles, such as primary, mirror,
  coordination, external feedback, planning, or migration.
- Support selective work-item sync between trackers based on labels, statuses,
  explicit item ids, provider queries, or policy-defined scopes.
- Track identity links between copies of the same logical work item across
  providers.
- Make sync dry-run and reviewable before it mutates external providers.
- Keep provider capabilities visible so agents know whether a tracker can list,
  create, update, comment, set labels, assign people, use milestones, or manage
  board status.
- Keep live external writes behind explicit provider, identity, and publication
  policy.
- Keep DevNexus generic. Provider adapters own provider-specific mapping, while
  DevNexus owns neutral configuration, linking, planning, and sync policy.

## Non-Goals

- Do not make DevNexus choose implementation work. Coordinators still choose
  work-item batches.
- Do not make all configured trackers equal sources of truth by default.
- Do not start with unrestricted two-way sync.
- Do not propagate deletes by default.
- Do not infer approval, merge permission, or publication permission from sync
  alone.
- Do not store provider tokens, private keys, browser auth state, or host-local
  secret paths in shared project configuration.
- Do not require Vibe Kanban, GitHub Projects, Jira, or any other provider to
  support every neutral work-item capability before it can be configured for a
  narrower role.

## Current State

DevNexus project configuration stores component work tracking as one optional
provider configuration. Legacy project-level work tracking is normalized onto
the generated primary component for compatibility.

The work-item service resolves one component, creates one provider instance,
checks that provider's capabilities, then performs create, list, get, update,
comment, or status operations against that single provider.

The neutral work-item shape has one provider and one external reference. That is
enough when an item lives in only one tracker. It is not enough when the same
logical item is represented as a local item, a GitHub issue, and a Jira issue.

The existing provider adapters are already capability-oriented. Local, GitHub,
GitLab, and Jira providers can map many neutral work-item operations. Vibe
Kanban currently advertises board-oriented capability without neutral item CRUD.
GitHub Project v2 board status can be configured as part of a GitHub tracker,
but it is not a second tracker binding.

Automation in agent-launch mode can list eligible work by component across
configured component trackers. It does not currently list across multiple
trackers inside one component or deduplicate linked copies.

Coordination handoffs are tracker-backed comments. Reading related handoffs is
currently reliable for local stores and intentionally limited when providers do
not expose comments through the current DevNexus core path.

## Users

- A DevNexus user who wants local dogfood items mirrored to a private GitHub
  coordination repository.
- A coordinator agent selecting work from the component's canonical tracker.
- A worker agent updating the work item it was assigned.
- A Mac or Windows agent reading shared coordination state from a provider that
  both machines can access.
- A maintainer migrating a component from local work items to GitHub Issues or
  Jira without losing history.
- An external reviewer responding in GitHub, GitLab, Jira, or a review thread.

## User Stories

- As a project maintainer, I can keep a local component tracker as primary and
  mirror only `dogfood` items to GitHub.
- As a coordinator, I can list eligible work without seeing duplicate copies of
  the same logical item from multiple trackers.
- As a worker, I can update the canonical work item and have configured mirrors
  receive safe status and comment updates.
- As a Mac agent, I can read shared handoff state from a GitHub-backed
  coordination tracker even if the Windows agent selected work from a local
  tracker.
- As a maintainer, I can dry-run a sync and see which items would be created,
  updated, skipped, or blocked before DevNexus writes to an external provider.
- As a migration owner, I can link existing GitHub issues to local items before
  enabling sync.
- As an external reviewer, I can answer in a provider-native issue or pull
  request while DevNexus records the neutral effect on the local work item.

## Product Model

### Tracker Binding

A tracker binding is a named provider configuration inside one component. It
needs a stable id, display name, provider config, enabled flag, role, capability
summary, and optional policy references.

Useful roles:

- `primary`: the canonical tracker for ordinary create, list, update, comment,
  and automation selection.
- `mirror`: receives selected synced fields from another tracker.
- `coordination`: stores handoffs, external requests, integration records, or
  shared multi-host state.
- `planning`: stores Product Requirements Documents, issue-slicing notes, or
  larger backlog artifacts.
- `external_feedback`: stores reviewer questions and responses in a provider
  audience.
- `migration`: participates in import or link operations during tracker moves.
- `archive`: read-mostly historical tracker.

Roles are advisory and policy-backed. A tracker may have more than one role only
when that is explicit. For example, a GitHub tracker may be both mirror and
coordination, but DevNexus should not infer that automatically.

### Default Tracker

Each component should have one default work tracker. Existing commands and MCP
tools continue to use the default when no tracker id is provided. Existing
single `workTracking` configuration should be normalized into one default
tracker binding.

### Work-Item Identity Links

DevNexus needs a neutral link model for work items represented in more than one
tracker. A link record should connect:

- DevNexus project id and component id.
- A neutral logical work-item id.
- One or more tracker references.
- The tracker id, provider, host, repository or project identity, item id,
  item number or key, node id, and web URL when available.
- The last observed provider timestamps or sync fingerprints.
- The last sync direction and status.

The link model should not require every provider item to have a DevNexus-owned
id. Existing external items can be linked later.

### Field Ownership

Sync must be explicit about which fields are owned by which side. At minimum,
policies should reason about:

- Title.
- Description.
- Status.
- Labels.
- Assignees.
- Milestone.
- Comments.
- External URLs and cross-links.
- Provider-native board or workflow status.

For the first version, one-way ownership is simpler and safer. Example: local
owns title, description, neutral status, and labels; GitHub receives mirrors and
provider-native discussion.

### Sync Policy

A sync policy defines which items move between trackers and how.

Policy concepts:

- Source tracker and target tracker.
- Direction: dry-run, one-way, manual reverse, or two-way gated.
- Filter: labels, statuses, item ids, provider query, milestone, or search.
- Field set: the fields this policy may create or update.
- Comment policy: none, append selected comments, append DevNexus-generated
  sync comments, or provider-native request comments.
- Status mapping: neutral statuses to provider labels, workflow states, board
  fields, or issue states.
- Conflict policy: skip, block, choose source, choose target, or require manual
  resolution.
- Write policy: draft-only, local-only, external-write allowed, or approval
  required.
- Quiet period and ping policy for external waiting states.

The policy should support "all items" by using an explicit broad filter, but
the default examples should show selective sync because that is safer for
dogfood.

## Proposed User-Facing Surface

### Project and Component Status

Project status, automation status, and agent launch context should report all
tracker bindings for each component:

- Tracker id.
- Provider.
- Roles.
- Enabled state.
- Default state.
- Capability report.
- Sync policy names that reference it.
- Last known sync health when available.

The low-token agent surfaces should still summarize this tightly. Agents need
to know the default tracker, whether coordination is shared, and which provider
writes are allowed.

### Work-Item Operations

Work-item CLI and MCP operations should accept an optional tracker id. When it
is omitted, DevNexus uses the component default.

Needed behavior:

- Create on a specific tracker or the default tracker.
- List from a specific tracker, the default tracker, or a policy-defined
  aggregate view.
- Get by component-qualified id, tracker-qualified id, external reference, or
  neutral logical id.
- Update the default/canonical item unless a tracker id is explicit.
- Comment on the configured target according to role and policy.
- Return enough reference metadata for agents to avoid ambiguity.

### Link Operations

DevNexus should expose link-oriented operations before automatic sync:

- Link a local item to an existing external item.
- Show all tracker references for a logical item.
- Unlink a mistaken reference with audit metadata.
- Detect likely matches by title, labels, provider URLs, or explicit references,
  but do not auto-link without policy.

### Sync Operations

DevNexus should expose sync as a planned operation first:

- Build a sync plan.
- Show creates, updates, skips, conflicts, missing capabilities, and missing
  credentials.
- Execute only when the policy and command allow mutation.
- Record a sync run summary.
- Emit provider object links for created or updated items.

Sync execution should be idempotent. Re-running a sync should not duplicate
issues, comments, or handoff records when link state already exists.

## Automation Behavior

Automation should continue to select work from the component default tracker
unless the project config explicitly says otherwise.

Agent-launch context should include:

- Component default tracker id.
- Configured tracker bindings and roles.
- Eligible work grouped by logical item, not duplicated provider copies.
- The tracker id used to select each eligible item.
- Sync status or warnings when an eligible item has stale mirrors.

Run and target-cycle records should include the selected tracker id and any
neutral logical item id when available. That lets later sync or coordination
tools update the right external mirror without guessing.

## Coordination Behavior

The shared coordination feature should be able to use a tracker role rather
than assuming the component's work tracker is the only backing store.

Preferred behavior:

- Work selection uses the component default tracker.
- Handoffs can be written to the coordination tracker when configured.
- Handoff records include the selected work item, logical item id, branch facts,
  and provider target references.
- Integration plans can read handoffs from the coordination tracker and work
  details from the primary tracker.
- External requests can post to an external-feedback tracker or provider-native
  review target when policy allows.

This lets a component keep local work items while using GitHub for shared
multi-host coordination.

## Sync Semantics

### Initial Direction

The first implementation should support dry-run and one-way sync. The safest
dogfood path is local primary to GitHub mirror or local primary to GitHub
coordination.

Two-way sync should remain gated until DevNexus can reliably store sync
fingerprints, detect concurrent edits, map provider state transitions, and
present conflict plans.

### Create

When a source item matches a sync policy and has no linked target item, sync can
create a target item if the target provider supports create and policy allows
external writes. The created item must be linked immediately.

### Update

When a linked target exists, sync can update only fields owned by the source
policy. Fields outside the policy are left alone. Provider capability gaps
produce skipped fields, not silent partial success.

### Comments

Comments should be append-only by default. DevNexus-generated comments need a
stable marker or metadata fingerprint to prevent echo loops and duplicate
comments. Human/provider comments can be summarized back only when a policy
explicitly enables that direction.

### Status

Neutral status remains `todo`, `ready`, `in_progress`, `blocked`, `done`, or
`wont_do`. Provider adapters map those states into labels, issue states,
workflow transitions, or board fields according to provider config.

If the provider cannot represent a state precisely, sync should record a
warning and use the configured fallback. It should not invent provider workflow
states.

### Delete and Close

Deletes should not propagate in the first version. Closing or marking
`wont_do` is the neutral way to end work. External provider deletion remains a
manual/provider-native action unless a future policy explicitly allows it.

### Conflicts

A conflict exists when both sides changed a synced field since the last
successful sync or when provider state cannot be mapped safely.

First-version conflict behavior:

- Detect and report conflicts.
- Skip conflicting fields.
- Keep non-conflicting fields eligible for sync only if doing so cannot hide
  the conflict.
- Record enough detail for a human or coordinator to choose a resolution.
- Do not auto-resolve two-way conflicts.

## Configuration Direction

The component config should evolve from one optional tracker to multiple named
trackers. Existing `workTracking` remains accepted and is normalized to a single
default tracker binding.

The eventual component shape should express:

- `workTrackers`: named tracker bindings.
- `defaultWorkTrackerId`: default for normal operations.
- `workItemSync`: sync policies for that component.

Project-level defaults can supply common provider policy, auth profile names,
or sync defaults, but the actual tracker ownership remains component-scoped.

Host-local overlays should hold credentials, command paths, auth profiles, and
machine-specific provider wrappers. Shared project config should reference
those by stable names only.

## Provider Policy and Identity

External sync must respect publication identity and provider-write guardrails.
Before any live external write, DevNexus should know:

- Which provider target is allowed.
- Which host-local auth profile or bot identity should be used.
- Which remote or repository namespace is expected.
- Which operations are allowed: draft, create, update, comment, label, assign,
  transition, close, or sync board status.
- Whether the operation is dry-run, draft-only, or live.

This feature should compose with the meta-project hosting and publication
identity work. It should not assume the active browser account, default GitHub
CLI account, or default Git credential helper is the correct automation actor.

## Migration Plan

### Phase 1: Additive Schema

Add tracker bindings to component configuration while preserving existing
`workTracking`. Resolve old configs into one default binding. Project status
surfaces report both the compatibility field and the normalized tracker list.

### Phase 2: Provider Registry

Introduce a component tracker registry that can resolve a tracker by component
id and tracker id. Existing work-item operations continue to call the default
tracker unless a tracker id is provided.

### Phase 3: Link Store

Add neutral work-item link records. Support explicit link, unlink, and show
operations. Keep the first storage backend simple and project-local.

### Phase 4: Sync Planning

Implement dry-run sync planning. The planner reads source and target trackers,
applies filters, detects creates/updates/skips/conflicts, checks provider
capabilities, and returns a mutation-free report.

### Phase 5: One-Way Sync Execution

Enable one-way sync execution for a narrow provider pair with mocked tests
first. Local to GitHub is the likely dogfood path because GitHub is already the
leading shared coordination candidate.

### Phase 6: Coordination Integration

Allow coordination tools to target a tracker role such as coordination or
external feedback. Keep work selection on the default tracker.

### Phase 7: Two-Way and Provider Expansion

After dogfood evidence, add gated two-way sync, richer provider event reading,
and broader provider pairs.

## Testing Decisions

- Unit-test config validation for single-tracker compatibility and multi-tracker
  component configs.
- Unit-test duplicate tracker ids, missing default tracker ids, unsupported
  roles, and invalid sync policies.
- Unit-test provider registry resolution by component and tracker id.
- Unit-test work-item CLI and MCP selection with omitted tracker id, explicit
  tracker id, component-qualified id, tracker-qualified id, and external ref.
- Unit-test neutral link records and idempotent link updates.
- Unit-test dry-run sync planning for create, update, skip, missing capability,
  missing credential, and conflict cases.
- Unit-test one-way sync execution with mocked providers and no live network.
- Unit-test comment echo prevention and idempotent DevNexus-generated comments.
- Unit-test status mapping and board-status capability gaps.
- Unit-test automation eligible-work grouping so linked items are not duplicated.
- Unit-test coordination tools writing handoffs to a configured coordination
  tracker.
- Add integration-style fixture tests for local primary plus GitHub mirror.
- Keep live provider smoke tests optional and policy-gated.

## Acceptance Criteria

- Existing projects with only `workTracking` continue to load, report status,
  and run work-item operations without config changes.
- A component can declare multiple named trackers and one default tracker.
- Project status and agent-facing summaries show tracker ids, providers, roles,
  defaults, and capabilities.
- Work-item CLI and MCP operations can target a specific tracker.
- DevNexus can link one logical work item to references in multiple trackers.
- DevNexus can produce a dry-run sync plan for selected items.
- DevNexus can execute one-way sync for an approved narrow provider path with
  idempotent creates and updates.
- Provider capability gaps and credential gaps are reported before mutation.
- Automation and coordination can distinguish primary work selection from
  coordination or external-feedback tracker writes.
- Tests cover compatibility, schema validation, provider selection, linking,
  dry-run planning, one-way sync, and no-live-network defaults.

## Out Of Scope For The First Implementation

- Unrestricted two-way sync.
- Provider webhooks.
- Real-time background sync daemons.
- Automatic external issue deletion.
- Automatic migration of all historical comments.
- Automatic provider approval or merge decisions.
- Vibe Kanban neutral item CRUD, unless that provider gains the required
  capabilities separately.
- User interface beyond CLI, MCP, and existing status/report surfaces.

## Implementation Slicing

After this PRD is accepted, use the issue-slicing workflow to create
component-owned DevNexus work items. Expected slices:

- Component tracker binding schema and compatibility normalization.
- Tracker registry and explicit tracker selection for work-item operations.
- Work-item link records and link/show/unlink commands.
- Dry-run sync planner.
- One-way sync executor for local primary to GitHub mirror with mocked provider
  tests.
- Agent status and automation context updates for multiple trackers.
- Coordination role integration for handoff and external-feedback trackers.
- Documentation and migration guidance.

## Open Questions

- Should the first dogfood sync target be GitHub Issues only, or GitHub Issues
  plus GitHub Project v2 board status?
- Should local remain primary for the dogfood project until shared GitHub bot
  identity work is complete?
- Should a mirrored external issue receive every DevNexus-generated progress
  comment, or only high-signal state transitions and handoffs?
- Should sync policies live entirely in component config, or should project
  defaults define reusable policy templates?
- How should DevNexus expose aggregate list views without encouraging agents to
  update non-canonical mirrors accidentally?
- Which provider event reading should arrive before gated two-way sync:
  comments, labels/status, assignees, or review states?
