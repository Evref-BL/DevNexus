# Tracker Discovery And Inbound Sync Product Requirements Document (PRD)

## Problem

DevNexus can configure multiple work trackers for a component, and it can sync
selected local work items to GitHub. That is not enough for a project where
work may be created on any host or directly in an external tracker.

The immediate dogfood question is simple: if a human creates a GitHub Issue on
this Mac, will a Windows worker eventually notice it and pick it up without
being told? Today the answer is no unless GitHub is the component's selected
default tracker, the worker explicitly lists that tracker, or a separate manual
process turns the external issue into a local work item.

That behavior is too implicit for multi-host work. DevNexus should make tracker
visibility explicit. A maintainer should be able to declare which trackers are
eligible-work sources, which trackers are mirrors, which trackers are external
inboxes, and whether external issues should be imported into the local canonical
tracker before agents select work.

## Goals

- Make issue discovery behavior visible and predictable across all configured
  work trackers.
- Let eligible-work and coordinator surfaces scan configured tracker roles
  instead of only the component default tracker when policy asks for it.
- Let projects keep local work items as the canonical tracker while still
  noticing new provider-native GitHub Issues.
- Add an explicit inbound import path from GitHub or another external tracker
  into local work items.
- Avoid duplicate work when the same logical item appears in multiple trackers.
- Keep read-only discovery separate from mutating sync or import operations.
- Make cross-host behavior deterministic: a worker on another machine should
  know whether it must fetch the meta-project, query a provider, run inbound
  import, or wait for a scheduled sync.
- Keep live provider reads and writes behind configured credentials,
  capability checks, and authority policy.

## Non-Goals

- Do not make every configured tracker an eligible-work source by default.
- Do not replace the local tracker as canonical for dogfood unless the project
  explicitly chooses that migration.
- Do not add unrestricted two-way sync as the first implementation.
- Do not make a GitHub Issue created by a random repository automatically enter
  a DevNexus project without a configured tracker binding and filter.
- Do not import provider-native noise, stale issues, closed issues, or
  unrelated repository issues by default.
- Do not store provider credentials or host-local authentication paths in shared
  project configuration.
- Do not let inbound import bypass shared-checkout mutation guards, actor
  authority, or external write policy.

## Current State

DevNexus normalizes each component to a default work tracker. Existing
work-item operations select one tracker at a time: an explicit tracker id, a
tracker-qualified item id, an external-reference match, or the component
default tracker.

Automation status, eligible-work listing, current-agent adoption, and agent
launch selection currently list work from each component's default
`workTracking` provider. They do not aggregate every configured tracker within
the component. They also do not deduplicate linked copies across trackers when
selecting work.

Work-item sync exists, but execution currently supports one direction: local
source tracker to GitHub target tracker. That is useful for publishing selected
local items outward, but it does not make provider-native GitHub Issues appear
as local work.

The practical consequence is:

- Local work items become visible across machines after the meta-project
  repository is synchronized.
- GitHub Issues become visible only to commands that explicitly query the
  GitHub tracker, or to projects that make GitHub the selected default tracker.
- A Windows worker will not naturally pick up a GitHub Issue created on a Mac
  when the local tracker remains the default eligible-work source.

## Users

- A maintainer creating a GitHub Issue from one host and expecting another host
  to see it.
- A coordinator agent selecting eligible work across component trackers.
- A worker agent that should receive one canonical work item, not duplicate
  local and provider copies.
- A project owner who wants local work items for fast dogfood iteration while
  using GitHub Issues for shared intake.
- A migration owner moving a component from local work items to an external
  tracker without losing links or creating duplicates.
- A bot or machine user that can read or write provider issues according to
  project authority.

## Product Vocabulary

- Work tracker: a configured provider-backed work-item surface, such as a local
  JSON store, GitHub Issues, GitLab issues, or Jira.
- Default tracker: the tracker used by ordinary work-item operations when no
  tracker id is supplied.
- Discovery source: a tracker that DevNexus may query when building
  eligible-work or status summaries.
- External inbox: a provider-native tracker where humans or external systems
  may create new work before DevNexus imports it.
- Canonical tracker: the tracker whose item id is selected for worker
  assignment and durable local progress.
- Mirror tracker: a tracker that receives selected updates from another
  tracker.
- Logical work item: the DevNexus identity for one piece of work, independent
  of how many tracker representations it has.
- Inbound import: a policy-gated operation that creates or updates canonical
  local work items from external provider items.
- Discovery snapshot: a read-only result describing what each configured
  tracker currently reports.

## User Stories

- As a maintainer, I can add a GitHub Issue to a configured project inbox and
  know whether DevNexus will import it, list it directly, or ignore it.
- As a Windows worker, I can run eligible-work and see the same eligible issue
  set that a Mac worker would see, assuming both have the same project revision
  and provider access.
- As a coordinator, I can list eligible work across configured discovery
  sources without seeing duplicate copies of linked local and GitHub items.
- As a project owner, I can keep local work items canonical while importing
  selected GitHub Issues using a safe, explicit policy.
- As a bot account, I can read a GitHub inbox using configured credentials, but
  I cannot mutate local tracker state or provider state unless authority and
  checkout safety allow it.
- As a migration owner, I can dry-run external-to-local import and review
  creates, updates, skips, conflicts, and missing links before any local tracker
  file changes.

## Product Model

### Tracker Roles

Tracker bindings should support role declarations that affect discovery:

- `primary`: canonical tracker for ordinary operations and worker assignment.
- `eligible_source`: a tracker included in eligible-work scans.
- `external_inbox`: a provider-native intake surface for newly created work.
- `mirror`: a target or source for selected replicated fields.
- `coordination`: a tracker used for handoffs, decisions, and provider-backed
  coordination.
- `archive`: a read-mostly tracker not considered eligible by default.

Roles should be explicit. A tracker may be both `external_inbox` and
`eligible_source`, but DevNexus should not infer that from provider type alone.

### Discovery Policy

Each component should be able to declare a discovery policy:

- Which tracker roles are scanned for status and eligible-work.
- Whether direct selection from external trackers is allowed.
- Whether external tracker items must first be imported into a canonical local
  item.
- Which labels, statuses, milestones, assignees, or provider query filters
  qualify external items.
- Which tracker wins when multiple linked representations disagree.
- How many items to query from each tracker, and how the final limit is applied.
- Whether missing provider credentials are warnings, blockers, or skipped
  trackers.

The default policy should preserve current behavior: list the component default
tracker only.

### Inbound Import Policy

Inbound import should be separate from discovery because it mutates local
project state. A policy should declare:

- Source tracker and target canonical tracker.
- Direction, starting with external-to-local.
- Provider query or filters.
- Field mapping for title, description, labels, assignees, milestone, status,
  and source URL.
- Status mapping from provider-native state to neutral DevNexus status.
- Link behavior for existing local items and existing provider references.
- Conflict policy: block, source wins, target wins, or manual resolution.
- Write policy: dry-run only, local write allowed, provider write allowed, or
  explicit approval required.
- Comment policy for recording imported source references and future sync runs.

Inbound import should be idempotent. Re-running it should update the same local
logical item when a link exists or a configured fingerprint matches.

### Logical Item Deduplication

Eligible-work aggregation should deduplicate by:

- Existing tracker links.
- Provider external references stored on local items.
- Stable provider repository and item number or key.
- Optional configured fingerprints for imported items.

When DevNexus cannot prove two items are the same, it should not collapse them
silently. It should report an ambiguity and choose the configured canonical
source or skip the ambiguous item.

## User-Facing Surface

### Status And Discovery

DevNexus status surfaces should show:

- Default tracker for each component.
- All configured tracker bindings and roles.
- Which trackers participate in eligible-work discovery.
- Last discovery result or last error when available.
- Whether an external tracker is readable by the current actor.
- Whether inbound import is configured, dry-run only, or executable.

The concise agent context should answer the operational question directly:
whether workers should expect external issues to appear automatically, after an
import step, or only when explicitly queried.

### Eligible Work

Eligible-work should support two modes:

- Default mode: current behavior, using the component default tracker.
- Discovery mode: aggregate configured discovery sources, deduplicate logical
  items, and return canonical assignment references.

If a policy says external items must be imported first, eligible-work should
report import candidates separately from selectable work. It should not assign
an unimported external item as local canonical work unless direct external
selection is explicitly allowed.

Each returned item should include:

- Component id.
- Logical item id.
- Canonical tracker reference.
- Source tracker reference when discovered externally.
- Deduplication reason or link id when applicable.
- Warnings for stale links, missing provider access, or ambiguous matches.

### Inbound Import Plan And Apply

The command and Model Context Protocol (MCP) surface should be intentionally
small:

- `work_item_discovery_status`
- `work_item_inbound_sync_plan`
- `work_item_inbound_sync_execute`

Planning must be read-only. It should report creates, updates, skips,
conflicts, missing credentials, capability gaps, and the exact local files that
would change.

Execution must require:

- Explicit source and target tracker ids.
- Explicit write policy allowing local tracker mutation.
- Successful checkout mutation guard classification.
- Effective actor authority for local work-item writes and provider reads.

Provider writes are not required for the first inbound implementation. Reading
GitHub Issues and writing local tracker files is enough to answer the dogfood
cross-host visibility problem.

## Implementation Decisions

- Preserve local-first dogfood behavior unless a project config opts into
  additional discovery sources.
- Extend existing multi-tracker configuration rather than introducing a second
  tracker model.
- Reuse existing tracker link records for logical identity.
- Keep local-to-GitHub sync and external-to-local import as distinct policies,
  even if they share planning and conflict machinery.
- Treat read-only discovery as safe in shared checkouts, but treat inbound
  import execution as a DevNexus-controlled mutation that must run in an owned
  project-meta worktree or explicit integration context.
- Make missing provider credentials visible but not fatal for trackers whose
  policy marks them optional.
- Prefer canonical local assignment for dogfood so worker result recording,
  target reports, and local project history remain stable across machines.

## Testing Decisions

- Unit test tracker-role normalization and discovery-policy defaults.
- Unit test eligible-work default mode to prove existing behavior is preserved.
- Unit test discovery mode with local plus GitHub trackers and linked duplicate
  items.
- Unit test missing GitHub credentials as warning, skipped tracker, or blocker
  according to policy.
- Unit test inbound import planning for create, update, skip, conflict,
  ambiguous duplicate, and stale link cases.
- Unit test inbound import execution with mocked GitHub provider and local
  tracker writes only.
- Unit test checkout mutation guard integration for inbound import execution.
- Add a dogfood smoke that runs discovery status without live provider writes.

## Out Of Scope

- Full unrestricted two-way synchronization.
- Provider-native board status writes for inbound import.
- Automatic import from unconfigured repositories.
- Webhooks, background daemons, or push-based provider callbacks.
- Deleting local items when external issues close.
- Reassigning work already leased to an active worker.
- Direct provider issue mutation during the first inbound path.

## Rollout Plan

1. Add read-only discovery status for configured tracker roles and capability
   visibility.
2. Extend eligible-work with opt-in discovery aggregation and deduplication,
   preserving default-tracker behavior by default.
3. Add inbound import dry-run planning from GitHub to local.
4. Add policy-gated inbound import execution that writes only local tracker
   state.
5. Add target report and agent-context summaries that state whether external
   issues are automatically visible.
6. Dogfood with a fake or disposable GitHub issue source before relying on live
   active project issues.

## Open Questions

- Should direct external issue selection ever be allowed for dogfood, or should
  all external work become local canonical items first?
- Should imported GitHub Issues receive a provider comment linking back to the
  local DevNexus item, or should the first implementation avoid provider writes
  entirely?
- What is the minimum provider query vocabulary needed for useful inbox
  filtering without exposing provider-specific complexity in the common case?
- Should scheduled automation run inbound import before every coordinator
  cycle, or should import remain a separate explicit step until authority and
  mutation guards are fully landed?
- How should imported issues be ordered relative to locally authored ready
  items when both match the automation selector?

## Further Notes

This Product Requirements Document (PRD) deliberately separates three ideas
that are easy to conflate:

- Listing a configured tracker.
- Selecting work from a configured tracker.
- Mutating the canonical tracker by importing external items.

The safe default is to keep those steps separate and visible. The useful
product behavior is not "scan everything everywhere." It is "tell me exactly
which trackers DevNexus considers, why, and what action makes an external issue
eligible for workers on every host."
