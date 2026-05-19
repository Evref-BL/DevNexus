# Version-Scoped Planning Product Requirements Document

## Problem Statement

DevNexus can track work items, milestones, target cycles, authority decisions,
publication policy, package publication, and release publication, but it does
not yet have a first-class planning object for a product version. As dogfood
usage grows, the project needs a way to answer which work belongs to a version,
what must be true before that version is ready, and how agent work, branch
validation, release decisions, and follow-up planning relate.

The current milestone field is useful as a provider-compatible label, but it is
too thin to carry version intent, readiness gates, cross-component scope,
release policy, and target reporting. Without a version model, agents can
complete individual work items while the project still lacks a durable view of
version scope, progress, blockers, release readiness, and post-release follow-up.

## Present State

Work items already carry status, labels, assignees, and an optional milestone.
Provider adapters expose milestone capability when the provider supports it, and
eligible-work discovery can filter by milestones. Target cycles and target
reports summarize selected work, run outcomes, blockers, verification, and
publication decisions. Authority policy distinguishes implementation authority,
review authority, target-branch integration, package publication, and release
publication.

Publication policy is evolving toward a green-main model where agents produce
candidate branches, CI validates those candidates, and integration to main is a
separate authority-controlled step. That gives DevNexus the right execution
boundary for version work, but not yet a planning boundary for deciding which
candidate branches and work items belong to a version.

## Proposed Solution

Add a version-scoped planning model that treats a version as a durable planning
and readiness object. A version should define scope, target branch or release
branch, readiness gates, owning components, related work items, release policy,
and reporting expectations.

The version object should not replace work items, milestones, target cycles, or
release authority. It should coordinate them:

- Work items remain the unit of implementation.
- Milestones remain provider-compatible grouping fields.
- Target cycles remain execution history.
- Green-main publication remains candidate validation and integration gating.
- Release authority remains the gate for tags, packages, and release publishing.
- The version object becomes the durable product planning frame that ties these
  facts together.

## Product Goals

- Show which work items are in scope for a version and why.
- Distinguish committed version scope from candidate or stretch scope.
- Report version readiness using work status, CI or validation state, blockers,
  documentation readiness, migration readiness, and release authority state.
- Let agents choose work for a target version without confusing version scope
  with permission to merge or release.
- Support cross-component versions where DevNexus, DevNexus-Pharo, and related
  plugins may contribute to the same release objective.
- Preserve provider compatibility by mapping version identity to milestones
  where appropriate without requiring all providers to support rich version
  objects.

## User Stories

- As a project coordinator, I can define a planned version with objective,
  target branch, expected release artifact, and readiness gates.
- As an agent, I can see whether a work item is in scope for the current
  version, stretch scope, blocked for the version, or unrelated.
- As a maintainer, I can see which work remains before a version can be
  considered ready for merge, release, or publication.
- As a release operator, I can see release-specific gates without gaining
  implementation or merge authority.
- As a dogfood operator, I can keep future version ideas aside without mixing
  them into the active green-main publication work.

## Core Concepts

- Version: a named planning object such as `0.2.0`, `2026.05`, or
  `dogfood-auth-hardening`.
- Version scope: the set of work items, components, labels, milestones, or
  provider queries that define intended work.
- Scope status: committed, candidate, stretch, deferred, or excluded.
- Version target: main, a release branch, or another configured target branch.
- Readiness gate: a condition that must be true before the version can advance.
- Release policy: whether the version expects tags, package publication,
  release notes, changelog updates, or provider release creation.
- Version report: a factual summary of scope, progress, blockers, gates, and
  release readiness.

## Implementation Decisions

The first implementation should be read-only and planning-oriented. It should
define a project configuration shape and reporting model before introducing
write workflows or release automation.

Milestones should remain usable as a compatibility bridge. A version may map to
one or more provider milestones, but DevNexus should not require every tracker
to support milestones. Labels, explicit work-item links, tracker queries, or
local project state can also define scope.

Version readiness should be computed from existing facts where possible:
work-item status, target-cycle history, verification records, publication
decisions, green-main validation state, blockers, and authority summaries. The
model should avoid new background provider writes.

Green-main integration belongs in the readiness model as candidate validation.
A green candidate branch or pull request may satisfy a version gate, but merge
to main and release publication remain separate authority decisions.

Version scope should be explicit enough for agents to select work, but it should
not give agents permission to widen scope silently. Scope changes should be
recorded as planning updates or work-item comments.

## Testing Decisions

The first version should use mocked local and provider-backed work-item data.
Tests should cover:

- Version config validation and normalization.
- Scope resolution from explicit work items, milestones, labels, and tracker
  queries.
- Cross-component version reporting.
- Readiness summaries for complete, blocked, failed, deferred, and stretch
  work.
- Green-main candidate validation represented as a readiness gate without merge
  authority.
- Provider capability differences where milestones exist for GitHub or GitLab
  but not every tracker.
- Serialization stability for target reports and agent context.

Live provider reads or writes are out of scope for the first version-scoped
planning slice.

## Out Of Scope

- Automatic merge to main.
- Automatic release tagging or package publication.
- Live provider milestone creation or mutation.
- Replacing existing work-item statuses with version-specific statuses.
- Full roadmap management, capacity planning, or calendar scheduling.
- Multi-version dependency solving.

## Further Notes

This Product Requirements Document intentionally keeps version planning separate
from the green-main publication refinement. Green-main answers how candidate
work proves it is safe for the protected target. Version-scoped planning answers
what work belongs to a release objective and how readiness is reported.

After review, this document should be sliced into implementation issues for the
version config model, scope resolver, readiness report, agent-context exposure,
and dogfood configuration.
