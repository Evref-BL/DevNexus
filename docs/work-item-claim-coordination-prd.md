# Work Item Claim Coordination Product Requirements Document (PRD)

Canonical discussion: https://github.com/Evref-BL/DevNexus/discussions/90

This file is the dogfood project mirror of the GitHub Discussion. Use the
discussion as the shared design surface for DevNexus users and maintainers.
Use GitHub issues for implementation slices.

## Problem

DevNexus can already coordinate parallel Mac and Windows work through GitHub
Issues, Git branches, isolated worktrees, handoff records, and target-cycle
facts. The remaining race is narrower: two coordinator agents can read the same
eligible GitHub issue before either one marks it as claimed.

This race happens at work selection time, not during implementation. Once an
agent has a distinct issue, branch, and worktree, normal Git and pull request
review flows provide useful isolation. The product need is a small, explicit
claim workflow that makes issue selection safe enough for multiple hosts while
keeping DevNexus usable for projects that do not want to operate a coordination
server.

## Current State

- GitHub Issues is the dogfood shared tracker for all configured components.
- The automation selector currently uses `status:ready` plus `dogfood`, and
  excludes `blocked` and `unsafe-live-runtime`.
- The DevNexus GitHub work tracker supports issue creation, listing, reading,
  updates, comments, labels, assignees, and milestones.
- Work status is represented through provider issue state plus `status:` labels.
  GitHub issues with `status:ready` can become `status:in_progress`.
- The selector can filter by status, required labels, excluded labels, required
  assignees, search text, and limit.
- GitHub Project v2 write support exists in the provider when a board is
  configured, including adding an issue to a project and setting a configured
  status field during issue creation or status updates.
- This dogfood project does not currently configure GitHub Project board/status
  support, so project/board status is not available as a live coordination
  surface.
- The local automation run lock is host-local. It prevents two local loops from
  colliding on one machine, but it is not a cross-host lock.
- Provider-backed handoff readback is incomplete for GitHub. DevNexus can post
  comments, but it cannot yet rely on provider comment reads through the generic
  work-tracker interface.

## Product Direction

DevNexus should introduce a generic work-item claim operation. The first
implementation should use GitHub-only optimistic claiming because it is the
least infrastructure-heavy option and matches the current dogfood environment.
The design should leave room for stronger claim backends later:

- GitHub-only optimistic claim for low-contention, two-to-few-machine setups.
- SSH/Tailscale claim broker for private, trusted multi-host setups that want a
  real mutex without a database.
- PostgreSQL, etcd, or Consul claim backend for teams that already have or want
  durable coordination infrastructure.

The public workflow should be stable across backends. A coordinator asks
DevNexus to claim work; DevNexus either returns a claimed work item with a
lease token or reports that no claim could be safely acquired.

## Proposed Workflow

1. A coordinator calls `claim_next_work_item` for a project or component.
2. DevNexus reads eligible work through the configured selector.
3. DevNexus chooses one candidate using deterministic priority.
4. DevNexus attempts to claim the candidate through the configured claim
   backend.
5. The claim operation marks the issue `in_progress`, records the claiming
   host/agent, records a lease token, and leaves a concise provider-visible
   note when policy allows.
6. DevNexus reads the provider state back.
7. If the claim token and owner are still current, DevNexus returns the claim.
8. If another owner won, DevNexus releases or ignores its stale attempt and
   retries the next candidate.
9. Only after a verified claim does the worker prepare a source worktree.

The critical section is small: select, claim, verify, release. The lock should
not be held for the whole implementation.

## Claim State

A claim should include:

- Project id and component id.
- Tracker id, provider, repository, and issue number.
- Work-item status at claim time.
- Claim owner: host id, optional agent id, and optional execution id.
- Lease token: a random unique identifier for this claim attempt.
- Optional fencing token: a monotonic value supplied by strong coordination
  backends.
- Claimed timestamp, expiry timestamp, and last heartbeat timestamp.
- Branch name and worktree path once created.
- Provider objects written during the claim, such as labels, assignee changes,
  comments, or GitHub Project status.

Before publishing, closing, or marking an issue done, an agent should verify
that its claim token is still current. A stale worker should stop and record a
blocker instead of continuing from an expired claim.

## GitHub-Only Optimistic Claim

GitHub-only claiming is the best near-term dogfood path. It should use provider
state as the durable, human-visible claim record.

Required behavior:

- Query only issues that match the automation selector.
- Re-read a candidate immediately before claiming it.
- Skip issues that are no longer `ready`, already assigned to another active
  owner, or already marked `in_progress`.
- Transition the issue to `in_progress`.
- Add an owner marker that can be read back, such as a configured owner label or
  a claim marker in a structured provider comment once comment reads exist.
- Assign the configured automation actor when that is useful and allowed.
- Add a short provider comment containing host id, agent id, lease token, and
  expiry.
- Re-read the issue and verify the expected owner and status before starting
  work.
- Retry with another candidate if the verification fails.

Known weakness:

GitHub issue updates are not a compare-and-swap operation. Two agents can still
race while updating the same issue. The mitigation is read-after-write
verification plus visible ownership state. This is acceptable for the current
two-machine dogfood setup once DevNexus has a first-class claim command, but it
is not a hard distributed lock.

Current readiness:

DevNexus is not quite ready for unattended optimistic claiming. It has the
provider primitives, but it still needs:

- A `claim_next_work_item` operation that combines selection, claim, and
  verification.
- A way to express "unassigned only" or "not claimed by another owner" in the
  selector or claim policy.
- Additive label and assignment operations, or a claim-specific update path, so
  concurrent claims do not accidentally replace each other's provider labels.
- Provider comment readback or another readable owner marker that can carry a
  unique lease token.
- Stale `in_progress` claim detection and either auto-release or human-visible
  blocker reporting.
- Clear policy for whether a claim can be made by a shared automation account,
  host-specific bot accounts, or host-specific labels.

Manual two-machine use is safe enough if a human or coordinator visibly claims
the issue before work starts. Fully autonomous multi-host selection needs the
improvements above.

## GitHub Project Role

A GitHub Project would help visibility. A project board can show `Ready`,
`In progress`, `Waiting`, `Blocked`, and `Done` states across repositories.
GitHub's Project v2 API supports updating custom fields such as a single-select
status field.

However, a GitHub Project should not be the first locking mechanism. It should
be treated as a dashboard and status mirror until DevNexus can read and write
Project status as part of the claim protocol. In this dogfood project, GitHub
Project board/status support is not currently configured, so using it now would
be a separate setup task.

## SSH/Tailscale Claim Broker

An SSH/Tailscale claim broker can work for N machines, not just two. All worker
machines call one broker endpoint over the private tailnet. The broker runs the
claim command locally, serializes the short picker critical section with a
local mutex, updates GitHub, and returns the claimed work item.

This does require a central coordination host. The host can be one of the
worker machines, an always-on desktop, a small virtual machine, or a service
running on a home or office server reachable through Tailscale. It does not
need to be exposed to the public internet.

Strengths:

- Works with any number of machines that can reach the broker.
- Requires no external database.
- Keeps hard locking out of GitHub and keeps GitHub as the human-visible source
  of work state.
- Can use the same DevNexus claim API as other backends.

Weaknesses:

- The broker is a central dependency. If it is offline, no new claims can be
  made, though already claimed workers can continue.
- It is specific to private trusted-host setups.
- It needs host identity, authentication, logging, and operational cleanup.
- High availability would require either broker failover or a stronger
  coordination store.

The broker should be optional. It should not become a mandatory DevNexus setup
requirement.

## PostgreSQL, etcd, Or Consul Claim Backend

A mature coordination store is the stronger long-term option for users who want
harder guarantees.

PostgreSQL can support queue-like claim selection with row locks and
`FOR UPDATE SKIP LOCKED`, or coarse project/component mutexes with advisory
locks. It is familiar infrastructure for many teams, but it requires a server
and schema management.

etcd and Consul are built for coordination. etcd supports leases and mutexes;
Consul supports sessions, key/value locks, and configurable semaphores. These
systems are better aligned with distributed locking semantics, but they add
more operational surface area than a two-machine dogfood setup needs.

This still implies a central service. It can run on one worker machine and be
accessed over Tailscale, but then that worker becomes the coordination host. A
high-availability deployment requires running the store according to that
system's own clustering model.

## Mutex Versus Semaphore

Issue picking needs a mutex: exactly one coordinator should select and claim a
given next issue at a time.

A semaphore is useful for capacity: at most N active workers across a project,
component, repository, label, or runtime class. The claim backend should support
both concepts eventually:

- `pickerMutex`: serialize select-and-claim.
- `activeWorkerSemaphore`: cap total claimed work in a scope.
- `runtimeSemaphore`: cap scarce resources such as live Pharo images, Docker
  jobs, or self-hosted runners.

The first GitHub-only implementation can skip hard semaphores and rely on the
existing selector limit plus issue status. Stronger backends should expose
semaphore capacity explicitly.

## User Stories

- As a Mac coordinator, I can claim the next eligible dogfood issue and know a
  Windows coordinator will not start the same issue after my claim verifies.
- As a Windows coordinator, I can see that a Mac worker owns an issue and choose
  another eligible issue without reading local Mac files.
- As a human, I can inspect a GitHub issue and see who claimed it, when the
  claim expires, and which branch or worktree is expected.
- As a project maintainer, I can use GitHub-only optimistic claiming without
  operating a database.
- As a team with private hosts, I can add an SSH/Tailscale broker to get a real
  picker mutex without exposing services on the public internet.
- As a larger team, I can configure PostgreSQL, etcd, or Consul when I need
  stronger coordination and capacity controls.
- As an agent recovering from interruption, I can verify whether my lease token
  is still current before continuing, publishing, or closing work.

## Implementation Decisions

- Keep GitHub Issues as the default shared tracker and human-visible record.
- Add a provider-neutral claim API before adding a specific strong backend.
- Make GitHub-only optimistic claiming the default first implementation.
- Treat GitHub Project status as optional visibility and workflow state, not as
  a mandatory lock backend.
- Make SSH/Tailscale broker support optional and configuration-driven.
- Model strong coordination stores behind the same claim interface.
- Keep locks short-lived. Implementation work must happen in isolated worktrees
  after the claim is verified.
- Prefer leases with expiry over permanent locks.
- Record enough owner and token data that stale workers can be detected.
- Avoid making a central server a baseline DevNexus requirement.

## Testing Decisions

- Unit-test selector behavior for status, labels, excluded labels, assignees,
  and unclaimed-only policy.
- Unit-test optimistic claim success, lost race, stale claim, release, retry,
  and expired claim paths against a mocked GitHub provider.
- Unit-test that provider updates preserve unrelated labels and assignees.
- Unit-test read-after-write verification before worktree preparation.
- Unit-test lease-token validation before status `done` or publication.
- Add integration-style tests for optional GitHub Project status mapping with a
  mocked GraphQL provider.
- Add backend contract tests so GitHub, SSH broker, PostgreSQL, etcd, and Consul
  implementations share the same claim semantics.
- Avoid live GitHub, Tailscale, database, etcd, or Consul dependencies in core
  tests.

## Out Of Scope

- Mandatory distributed locks for every DevNexus project.
- Holding a lock for the duration of implementation work.
- Replacing GitHub Issues with GitHub Projects.
- High-availability coordination-store deployment automation.
- Automatic semantic conflict resolution between branches.
- Live runtime resource locking for Pharo, Docker, or self-hosted runners beyond
  the claim model described here.
- Provider-specific workflow vocabulary in the generic DevNexus claim API.

## Further Notes And References

- GitHub Issues REST API supports managing issue assignees, labels, comments,
  milestones, and issue updates.
- GitHub Projects v2 can be managed through the GraphQL API, including updating
  project item field values.
- GitHub Actions supports concurrency groups, which is useful precedent for
  named concurrency scopes but is not directly reusable for DevNexus issue
  claiming.
- Tailscale SSH can provide private SSH access between tailnet devices without
  exposing a broker on the public internet.
- PostgreSQL advisory locks and `FOR UPDATE SKIP LOCKED` are mature options for
  central database-backed coordination.
- etcd leases and mutexes, and Consul sessions, locks, and semaphores, are
  mature coordination primitives when a team accepts the operational cost.

References:

- GitHub Issues REST API: https://docs.github.com/en/rest/issues/issues
- GitHub issue assignees API: https://docs.github.com/en/rest/issues/assignees
- GitHub Projects API: https://docs.github.com/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
- GitHub Actions concurrency: https://docs.github.com/actions/using-jobs/using-concurrency
- Tailscale SSH: https://tailscale.com/docs/features/tailscale-ssh
- PostgreSQL advisory locks: https://www.postgresql.org/docs/current/explicit-locking.html
- PostgreSQL `SKIP LOCKED`: https://www.postgresql.org/docs/current/sql-select.html
- etcd leases and locks: https://etcd.io/docs/v3.6/learning/api/
- Consul sessions and distributed locks: https://developer.hashicorp.com/consul/docs/automate/session
