# Initiative Delivery Topology PRD

## Problem Statement

DevNexus already has work items, isolated worktrees, green-main publication,
version-scoped readiness, and publication trains. Those pieces let agents do
small reviewed changes safely, but they do not yet model a long-running
initiative as one coherent delivery surface.

The missing behavior shows up in dogfood work: a broad objective gets split into
many pull requests against `main`, even when the user wants human-in-the-loop
review along the way and one final coherent publication. Agents can reason about
this in prompts, but DevNexus should carry the policy, branch targets, review
state, stack order, and final publication gate in tools.

## Proposed Solution

Add an initiative delivery topology model for Git-backed work. An initiative is
the generic planning and reporting object. Git branches keep conventional intent
prefixes such as `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, or
`ci/`.

The default full-feature posture is a hybrid topology:

- one approved integration branch for the initiative, for example
  `feat/codex-goals` or `fix/github-coordination-policy`;
- slice branches that target that integration branch, for example
  `feat/codex-goals/target-projection`;
- optional stacked slice branches when one slice depends directly on another;
- one final pull request from the integration branch to the publication target,
  usually `main`;
- human approval for the topology choice and final publication.

DevNexus should make this a normal workflow. The coordinator still chooses the
work. DevNexus supplies the state model, branch plans, policy checks, reporting,
and safe tool defaults.

## Definitions

- Initiative: a durable objective that spans multiple work items, components,
  review surfaces, or decision cycles.
- Delivery topology: the Git and review route used by slice branches.
- Integration branch: the long-lived branch where initiative slices accumulate
  before final publication.
- Slice branch: a bounded implementation branch for one independently
  reviewable increment.
- Stack: an ordered set of dependent slice branches where each branch has a
  parent branch or review target.
- Review unit: the slice or commit-level change a human reviews. DevNexus
  should model review units explicitly instead of assuming every Git commit is a
  durable product slice.
- Final publication: the authority-controlled merge or handoff from the
  initiative integration branch to the target branch.

## Product Goals

- Let a user select an initiative delivery surface once and keep subsequent
  agent work aligned with it.
- Preserve human-in-the-loop checkpoints without forcing every slice to become a
  final pull request against `main`.
- Support direct, stacked, integration-branch, and hybrid delivery topologies.
- Keep branch names conventional and policy-derived instead of naming every
  branch `initiative/*`.
- Show initiative readiness from work-item progress, branch state, pull request
  state, CI checks, review state, conflicts, stale bases, and blockers.
- Keep provider noise low. Routine status should live in tool output, PR bodies,
  checks, labels, and reports rather than repeated comments.
- Preserve green-main authority: agents can prepare and validate, while final
  publication remains governed by configured merge authority.

## Non-Goals

- Do not make long-lived branches the default for all work.
- Do not require one pull request per commit.
- Do not replace version planning. A version can use an initiative delivery
  topology, but initiatives are not only release versions.
- Do not make DevNexus choose which implementation work to perform.
- Do not bypass provider branch protection, required checks, merge queue policy,
  or human approval gates.
- Do not make GitHub comments the default coordination surface.

## User Stories

- As a maintainer, I can approve an initiative branch once and review slices
  against that branch before a final PR targets `main`.
- As a coordinator agent, I can ask DevNexus where the next slice should branch
  from and which branch or PR it should target.
- As a worker agent, I can prepare a worktree for one slice without guessing the
  initiative branch, parent branch, review target, or publication target.
- As a reviewer, I can inspect one initiative report that lists slice branches,
  stack order, pull requests, checks, review state, conflicts, and final
  readiness.
- As a project owner, I can choose quiet GitHub behavior so routine coordination
  does not create issue or pull request comment noise.
- As an integrator, I can see whether the initiative branch is stale, behind
  `main`, conflicting, partially reviewed, missing checks, or ready for final
  review.

## Implementation Decisions

### Initiative is Generic

Use "initiative" for DevNexus planning, reporting, tracker anchors, and delivery
state. Do not use it as the default branch prefix. Branch naming belongs to a
branch intent policy.

Default branch naming should prefer:

- `feat/<initiative-slug>` for feature initiatives;
- `fix/<initiative-slug>` for bugfix campaigns;
- `chore/<initiative-slug>` for operational or maintenance initiatives;
- `docs/<initiative-slug>` for documentation initiatives;
- `refactor/<initiative-slug>` for refactoring initiatives;
- `test/<initiative-slug>` or `ci/<initiative-slug>` when those are the primary
  user-visible delivery surfaces.

Slice branch names can extend the integration branch with a slice slug, such as
`feat/<initiative-slug>/<slice-slug>`, unless a component policy overrides the
pattern.

### Topology is Policy, Not Prompt Compliance

Add a policy model that can express:

- direct slice topology;
- stacked slice topology;
- initiative integration branch topology;
- hybrid topology, with slice pull requests into an integration branch and one
  final pull request into the target branch;
- throw-away rehearsal branches for compatibility checks.

The policy should answer:

- which branch should the next slice start from;
- which branch or pull request should the slice target;
- whether a slice is independent, stacked, or integration-branch-bound;
- whether an update, rebase, or restack is required before review or final
  publication;
- which actor may push, open pull requests, approve, merge, or update provider
  state.

### Build on Existing Publication Trains

Publication trains already define candidate and integration branch naming for
green-main workflows. Initiative delivery should extend that model rather than
create a parallel publication system.

Backwards compatibility requirements:

- existing `publicationTrain.activeVersionId` keeps its current meaning;
- existing `branchNaming.integrationPrefix` and `candidatePrefix` continue to
  work;
- a future `activeInitiativeId` or generic scope id can coexist with version
  planning;
- existing green-main status and target reports keep working when no initiative
  delivery policy is configured.

### Store Durable Facts, Derive Volatile Facts

Durable state should include the initiative id, tracker anchor, selected
topology, integration branch, target branch, slice branch records, parent branch
links, review units, and publication decisions.

Volatile state should be derived from Git and provider reads where possible:
current head commits, behind/ahead counts, merge conflicts, pull request state,
check state, review state, and merge queue state.

### Quiet Provider Policy

Provider adapters should expose a coordination-noise policy. For GitHub, the
dogfood default should be:

- one initiative or triage issue when a tracker anchor is needed;
- slice pull requests and one final pull request when the topology requires
  them;
- no routine coordination comments;
- PR bodies, status checks, labels, and DevNexus reports for routine state;
- comments only for major redirection, explicit human request, or provider
  surfaces that have no quieter durable field.

### Markdown Rendering Hygiene

Any tool that creates issue bodies, PR bodies, or report markdown should render
from structured paragraphs and lists, then join with real newline characters.
Focused tests should catch accidental escaped newline text such as literal
backslash-n sequences in generated human-facing markdown.

## Expected User Workflow

1. The user or coordinator declares an initiative objective and tracker anchor.
2. DevNexus proposes a delivery topology and branch naming plan.
3. The user approves any long-lived integration branch or external provider
   write.
4. DevNexus prepares slice worktrees using the selected topology.
5. Slice branches target the configured integration branch, parent stack branch,
   or final target branch.
6. DevNexus reports readiness, blockers, stale bases, conflicts, checks, review
   state, and publication authority.
7. The final integration branch gets a final review and green-main validation.
8. A human or authorized actor performs final publication.

## Implementation Slices

### Slice 1: PRD and User-Facing Vocabulary

Document the initiative delivery model, branch terminology, and quiet-provider
expectations. This PRD is the first slice.

Acceptance criteria:

- Docs state that initiatives are generic planning objects.
- Docs state that branches use conventional intent prefixes by policy.
- Docs distinguish direct, stacked, integration-branch, and hybrid topologies.
- Docs capture the low-noise GitHub default.

Verification:

- Static documentation review.
- `git diff --check`.

### Slice 2: Config and Validation Model

Add a typed config model for initiative delivery policy.

Acceptance criteria:

- Config can express allowed topologies, default topology, branch intent
  prefixes, integration branch pattern, slice branch pattern, review mode, and
  quiet-provider policy.
- Existing publication train config remains valid.
- Invalid branch prefixes, unknown topology names, and contradictory final
  publication settings produce clear validation errors.
- Tests cover defaults, backward compatibility, invalid config, and hybrid
  topology config.

Verification:

- Focused config validation tests.
- `npm run check`.

### Slice 3: Branch Plan and Read-Only Status

Add a read-only planner that derives the next branch, target branch, stack
parent, and final publication path for an initiative.

Acceptance criteria:

- Planner returns a structured branch plan for direct, stacked,
  integration-branch, and hybrid topologies.
- Status reports include integration branch, slice branches, parent links, base
  branch, target branch, head commit when available, and missing evidence.
- The planner is read-only and does not require provider credentials.
- CLI and Model Context Protocol surfaces return concise structured output.

Verification:

- Focused service, CLI, and MCP tests.
- `npm run check`.

### Slice 4: Worktree Prepare Integration

Teach worktree preparation to consume an initiative branch plan.

Acceptance criteria:

- A worker can prepare a slice worktree from an initiative id and slice slug.
- Branch names follow the configured intent-prefix pattern.
- The worktree context bundle records initiative id, topology, branch target,
  parent branch, final publication target, and HITL gates.
- Shared-checkout mutation guards still fail closed.

Verification:

- Focused worktree prepare and context bundle tests.
- `npm run check`.

### Slice 5: Initiative Report and Quiet Provider Output

Expose initiative readiness in target reports and provider handoff surfaces.

Acceptance criteria:

- Reports summarize work items, branches, pull requests, checks, review state,
  stale-base state, conflicts, blockers, and final publication authority.
- GitHub output policy can avoid routine comments and prefer PR body/status
  updates where provider support exists.
- Markdown generation tests prevent accidental literal backslash-n strings.

Verification:

- Focused report and provider-output tests.
- `npm run check`.

### Slice 6: Finalization Plan

Add a finalization planner for the approved integration branch.

Acceptance criteria:

- Planner reports whether the integration branch is ready for final review,
  needs update or rebase, has conflicts, is missing checks, or lacks authority.
- Planner distinguishes "safe to review" from "authorized to merge".
- Merge queue readiness is included when provider evidence is available.
- The tool stops at human-in-the-loop publication unless authority explicitly
  allows more.

Verification:

- Focused finalization and green-main integration tests.
- `npm run check`.

## Human-In-The-Loop Gates

- Approving the first long-lived integration branch for an initiative.
- Creating or updating provider-backed tracker anchors when the workspace
  policy treats them as external writes.
- Opening pull requests when the configured actor or provider profile is not
  fully verified.
- Retargeting existing pull requests or force-updating branches after restack or
  rebase.
- Final publication into the target branch.
- Changing the repository default workflow from direct slices to hybrid
  initiative topology.

## Open Questions

- Should `activeInitiativeId` live directly under `publicationTrain`, or should
  publication trains consume a more generic planning scope that can point to a
  version, initiative, milestone, or provider query?
- Should DevNexus store initiative delivery records in workspace metadata,
  provider-native tracker fields, Git notes, or generated run ledgers?
- Should the first code slice support provider pull request reads, or should it
  stay fully local/read-only until the branch planner is stable?
- Should one PR per commit be available as an explicit review mode, or should
  the first version support only slice branches and stacked slice branches?

## Further Notes

This design is informed by common stacked review tools and provider behavior:

- Gerrit models a reviewable change with patch sets and Change-Ids.
- Graphite treats stacks as first-class pull request sequences and handles
  restacking.
- Sapling can create a pull request per commit, but warns that overlapping
  commit stacks do not look natural on plain GitHub.
- GitHub supports updating a pull request branch by merge or rebase and can use
  merge queues, but it does not provide a complete stack-aware workflow by
  itself.
