# Agent Workflows

DevNexus gives agents a concise workspace surface: read workspace state, inspect
eligible work, prepare worktrees, record progress, and report factual results.
It does not decide what should be implemented. The user or launched
coordinator agent owns that judgment.

## Skill Role Chains

DevNexus skills should compose as workflow verbs. A chain can describe the
agent's operating mode without making every step a new process.

Common chains:

- New long-lived effort:
  `initiative-workflow` -> `design-with-user` -> `grill-me` or
  `grill-with-docs` -> `to-prd` -> `to-issues` ->
  `write-implementation-plan` -> `execute-initiative-plan`.
- Code change:
  `prepare-dev-nexus-worktree` -> `tdd` or `diagnose` ->
  `verify-before-completion` -> `request-work-review` ->
  `finish-dev-nexus-branch`.
- Architecture change:
  `zoom-out` -> `architecture-review` -> `grill-with-docs` ->
  `architecture-deepening` -> `write-implementation-plan`.
- Documentation change:
  `documentation` -> `humanizer` -> `verify-before-completion`.

Some skills are overlays rather than phases. `dev-nexus` provides workspace
infrastructure. `take-the-lead` changes the collaboration contract while the
user keeps decision authority. `initiative-workflow` holds a durable objective
and integration surface across slices.

The decision skills have distinct roles:

- `design-with-user` shapes unclear work collaboratively.
- `grill-me` stress-tests an existing plan by asking one decision-tree question
  at a time.
- `grill-with-docs` stress-tests an existing plan against code, glossary terms,
  domain docs, and Architecture Decision Records.

## MCP Server

Start the generic stdio Model Context Protocol (MCP) server with:

```bash
dev-nexus mcp-stdio
```

The server exposes the same boundaries as the CLI. Current tools include:

```text
project_status
automation_status
eligible_work
agent_profiles
setup_flow_list
setup_plan
setup_check
setup_record
target_cycle_list
target_cycle_record
target_report
current_agent_adopt
current_agent_record
coordination_status
coordination_handoff
coordination_integrate
coordination_request
work_item_create
work_item_list
work_item_get
work_item_update
work_item_comment
work_item_set_status
work_item_link
work_item_show_links
work_item_unlink
work_item_sync_plan
work_item_sync_execute
```

Work-item tools accept a component id when a workspace has multiple component
trackers. Omitting it uses the primary component for compatibility. When a
component has multiple tracker bindings, work-item tools use the component
default tracker unless a tracker id is explicit.

## Low-Token Coordinator Cycle

A coordinator can start with these read-only commands:

```bash
dev-nexus automation eligible-work <workspace-root> --json
dev-nexus automation agent-profiles <workspace-root> --json
dev-nexus automation target-report <workspace-root> --json
```

These JSON commands are compact by default. Use `--full --json` only when you
need raw workspace config, full ledgers, target-state markdown, or complete
handoff details for diagnostics.

## Dashboard Cockpit

The dashboard commands expose a read-only project cockpit for humans and for
GUI hosts that want to embed DevNexus project pages. Use the JSON commands as
the stable data contract, and use the local server for an operator-facing web
view:

```bash
dev-nexus dashboard snapshot <workspace-root> --json
dev-nexus dashboard weave <workspace-root> --json
dev-nexus dashboard serve <workspace-root>
```

`dashboard snapshot` combines project components, automation status, eligible
work, target reports, worktree leases, publication and authority blockers, an
event stream, and the current work weave. `dashboard weave` returns only the
graph-shaped lineage data so another app can render it with its own navigation,
auth, tenant, and project shell.

The served cockpit uses the same snapshot but intentionally folds the weave into
an interactive work-history view with click-to-inspect details. The API keeps
the full graph; the browser view defaults to a curated overview.

The local server exposes:

```text
GET /api/projects
GET /api/dashboard
GET /api/snapshot
GET /api/weave
GET /api/events
GET /assets/dev-nexus-dashboard.js
```

The browser module exports `mountDevNexusDashboard(root, options)` and
`fetchDevNexusDashboard(baseUrl)`. A multi-tenant orchestration app should treat
these as embeddable cockpit primitives: the host owns tenant selection,
authentication, persistence, and policy; DevNexus owns the project-specific
workspace facts and capability-gated next actions. The mounted dashboard
includes a persisted `system` / `light` / `dark` theme control; hosts can set
the initial mode with `mountDevNexusDashboard(root, { theme: "light" })`.

Then record the work it selected:

```bash
dev-nexus work-item update <workspace-root> local-1 --component core --status in_progress
dev-nexus work-item comment <workspace-root> local-1 --component core --body "Started focused verification."
dev-nexus automation target-cycle record <workspace-root> --status dispatched --work-item core:local-1 --work-item-status in_progress
```

Target-cycle facts are caller-reported. DevNexus stores them for durable
continuation, reporting, and relaunch decisions, but it does not assign agents
or supervise implementation.

## Canonical And Mirrored Work Items

Multi-tracker components distinguish the canonical work item from supporting
provider records. Coordinators should select eligible work from the component
default tracker unless the target explicitly names another tracker. Mirror,
coordination, planning, external-feedback, migration, and archive trackers are
supporting surfaces unless the component owner changes `defaultWorkTrackerId`.

Agents can use link records to connect a canonical item to existing provider
issues before any sync plan:

```bash
dev-nexus work-item link <workspace-root> local-1 --component core --tracker forge --item-id 42 --item-number 42
dev-nexus work-item show-links <workspace-root> local-1 --component core
```

Use dry-run sync planning as the review surface for mirrored fields:

```bash
dev-nexus work-item sync-plan <workspace-root> --component core --source-tracker primary --target-tracker forge --open --label onboarding --field title --field status
```

Do not update a mirror as if it were canonical unless the assignment names that
tracker. Do not run sync execution unless the dry-run plan has been reviewed
and the workspace policy explicitly allows the provider mutation and automation
identity. See [multi-tracker work tracking](multi-tracker.md) for configuration
and migration guidance.

## Generated Worktrees

Before editing a Git checkout, run a freshness preflight:

- Inspect status, remotes, upstream, and ahead/behind state.
- Fetch configured remotes when policy allows.
- Fast-forward clean branches with an upstream.
- Record a blocker when freshness cannot be checked.

Prepare a component-scoped worktree when implementation should be isolated:

```bash
dev-nexus worktree prepare <workspace-root> --component core --work-item local-1
```

For a single provider-native issue, keep the default workflow provider-neutral:
select the canonical work item, prepare an isolated worktree, run the component
verification, then record the provider request and check facts through the
configured tracker or publication policy:

```bash
dev-nexus worktree prepare <workspace-root> --component core --work-item local-1
dev-nexus work-item comment <workspace-root> local-1 --component core --body "Prepared an isolated worktree and started verification."
```

The older `quick-fix` helper is a specialized GitHub path. Keep it in
provider-specific runbooks or CLI help until DevNexus has a neutral provider
facade for issue status, request creation, checks, and merge decisions.

The default publication posture is `review_handoff`: an agent prepares a branch
and records verification, then a user or maintainer decides what to publish. See
[Publication workflows](publication-workflows.md) before opting into
green-main, CI tiers, merge queues, or publication trains.

For green-main publication, save provider check data and let DevNexus classify
the pull request or merge request before any merge attempt. Check collection is
provider-specific until DevNexus has a neutral collector adapter, but the
DevNexus planning surface should consume saved check facts:

```bash
dev-nexus publication green-main plan <workspace-root> --component core --pr <pr-number> --checks-file checks.json
```

Use the configured provider CLI, provider API, or CI system export to produce
equivalent saved check facts. DevNexus should classify those facts rather than
making onboarding depend on one forge command.

The plan reports required-check state, failed job names, platform labels,
available failing step or test details, merge refusal reasons, and the exact
merge or rerun command only when policy allows it. Unknown failures stay manual
investigation items.

Advanced publication helpers are opt-in planning commands. Use them only after
the workspace policy enables the matching workflow:

```bash
dev-nexus publication train-readiness <workspace-root> --version v-next
dev-nexus publication candidate-plan <workspace-root> --version v-next
dev-nexus publication merge-queue-readiness <workspace-root> --component core
```

Prepared worktrees carry ownership metadata: component id, source root,
generated path, branch, base ref, and owning work item. The generated path must
resolve inside the component worktrees root.

Generated worktrees can receive setup-only dependency projections. DevNexus
links existing reviewed paths such as `node_modules` into the worktree, records
the target in the worktree Git exclude file, and does not run an installer.

Generated worktrees also receive `.dev-nexus/context/` support files:

- `context.json` for machine-readable workspace, component, ownership, and plugin
  capability facts.
- `briefing.md` for agent-readable setup notes and worker briefing fragments.

Source edits, verification commands, and Git commands still run from the
component checkout root.

## Interactive Chat Worktrees

Mutating interactive DevNexus or Codex chats should prepare or adopt an
isolated worktree before editing. Use a component worktree for component source
changes. Use a workspace-meta worktree for durable workspace files such as
`dev-nexus.project.json`, `.dev-nexus/**`, target state, planning documents, or
agent instructions. A chat that starts in a shared checkout can read status,
inspect Git state, and prepare or adopt the right worktree, but it should not
make source or workspace-state edits there unless it explicitly owns integration
or workspace-state mutation.

The workflow uses a small checkout vocabulary:

- Stable component source root: the configured component `sourceRoot`. Treat it
  as the durable baseline and normal user checkout, not as disposable worker
  state.
- Shared checkout: any workspace or component checkout opened by multiple chats.
  Treat it as a read-mostly control room for status, coordination, setup, and
  integration planning.
- Worker worktree: an isolated branch and filesystem path for one bounded work
  item, component, or workspace-meta surface. Run edits, verification, and Git
  commands for that work from this path.
- Integration branch: a temporary branch used to serialize or batch ready
  worker branches before publishing to a target branch.
- Rescue branch: a preservation branch for useful, ambiguous, or abandoned work
  discovered during status checks or cleanup. Creating one preserves evidence;
  it does not by itself prove that cleanup is safe.

Worker and integrator are workflow behaviors, not a second authority model. A
worker owns one bounded surface, keeps edits inside the adopted worktree,
verifies the result, commits useful work before ending when possible, and leaves
a handoff that names the branch, head commit, changed areas, verification, and
remaining decisions. An integrator serializes ready work by reading handoffs,
Git state, verification, active related work, and recoverability before merging
or preparing a publishable result.

Actor identity, direct integration, pull requests, provider mutation, approval,
and publication permission belong to the authority model described in
[authority roles](authority-roles.md). Worktree coordination should consume the
effective authority result before mutating shared checkouts, pushing, opening
provider requests, merging, approving, publishing, or deleting branches and
worktrees. Authority checks do not make unsupported provider behavior
available; publication policy, provider adapters, credentials, review state,
checks, mergeability, and branch policy can still block a command.

The no-loss default is conservative. Commit or hand off useful work before
ending a mutating chat. Do not delete branches or worktrees when ownership,
dirty state, pushed state, merge state, or publication state is ambiguous. Run
a cleanup dry-run or equivalent read-only status review first, and preserve
uncertain work with a rescue branch or explicit handoff instead of guessing.
After a direct integration or merge, fetch and prune, confirm the work branch is
an ancestor of the target branch, remove the disposable worktree, and delete the
local and remote review branches. If any check is ambiguous, leave a handoff
instead of deleting.

## Coordination

Coordination commands record advisory handoff facts in the configured
component work-item service and inspect Git state.

```bash
dev-nexus coordination status <workspace-root> --component core --work-item local-1 --worktree <path>
dev-nexus coordination handoff <workspace-root> local-1 --component core --status ready --worktree <path>
dev-nexus coordination integrate <workspace-root> --component core --work-item local-1 --target-branch main --worktree <path>
```

`coordination integrate` builds a read-only plan from related handoff branches,
recorded decisions, merge bases, merge-tree output, changed files, and
range-diff output when useful. `--fetch` fetches the configured remote only
when workspace automation safety allows host mutation.

## Automation

Workspaces opt into automation through `dev-nexus.project.json`. The automation
schema describes launch gates, selector filters, verification hints, ledgers,
locks, retry backoff, safety policy, publication policy, targets, and agent
profiles.

Useful commands:

```bash
dev-nexus automation status <workspace-root>
dev-nexus automation enqueue <workspace-root> --title "Implement focused task"
dev-nexus automation heartbeat prepare <workspace-root> --json
dev-nexus automation run-once <workspace-root>
dev-nexus automation schedule <workspace-root> --max-runs 1
dev-nexus automation coordinator-loop <workspace-root> --max-runs 1
```

Use `--progress-jsonl` with `--json` when the caller needs final JSON on
stdout but should still see that a long nested coordinator run is alive:

```bash
dev-nexus automation coordinator-loop <workspace-root> --max-runs 1 --json --progress-jsonl
```

The progress stream is JSON Lines on stderr. It is intentionally low-volume and
event-based, with records for loop start, decisions, launch dispatch, run start,
run finish, and loop stop.

`automation status` is read-only. It reports whether automation is disabled,
locked, in retry backoff, blocked by preflight, idle, or ready to launch an
agent. It also reports publication policy status for each component when
configured.

`automation enqueue` creates a work item that matches the configured launch
filter and refuses inputs that would be invisible to that filter.

`automation heartbeat prepare` renders a Codex heartbeat automation recipe
without mutating Codex or any provider state. The recipe includes a suggested
heartbeat name, thread destination, hourly default schedule, active/paused state,
and a self-contained prompt generated from workspace metadata. The prompt tells a
wake-up agent to read DevNexus workspace context, use automation and tracker
surfaces, prepare isolated worktrees, respect component tracker roles including
direct external issue selection, record target-cycle facts, verify work, and use
the idle path to remove blockers or capture focused component-owned issues.

`automation run-once` and `automation coordinator-loop` launch the configured
agent command when the workspace is ready. The launched agent receives
`DEV_NEXUS_AGENT_CONTEXT_FILE` and `DEV_NEXUS_AGENT_RESULT_FILE`.

## Result File Contract

A launched agent must write JSON to `DEV_NEXUS_AGENT_RESULT_FILE` before it
exits. Minimal shape:

```json
{
  "status": "completed",
  "summary": "Completed requested work.",
  "commitIds": [],
  "verification": [
    {
      "command": "npm run check",
      "status": "passed",
      "summary": "Build and tests passed."
    }
  ],
  "publicationDecision": {
    "type": "direct_integration",
    "remote": "origin",
    "targetBranch": "main",
    "reason": "Published verified source change."
  },
  "error": null
}
```

Allowed launch statuses are exposed in the context file and environment. Use
`blocked` when a user decision, missing credential, dirty unrelated change, or
unsafe boundary prevents progress.

## Current-Agent Adoption

Current-agent adoption uses the same result contract without starting a child
process.

```bash
dev-nexus automation current-agent adopt <workspace-root> --run-id current-1 --json
dev-nexus automation current-agent record <workspace-root> --run-id current-1 --status completed --summary "Completed requested work."
```

If adoption returns `shouldProceed: false`, the current agent must not continue
the automation run. If it returns `true`, the agent proceeds under the returned
`DEV_NEXUS_*` environment values and records the terminal result.

## Publication Boundary

Publication policy can separate manual and automation identities. For example,
`origin` can remain the user remote while `bot` points at an SSH host alias for
an automation account. Tokens, private keys, GitHub CLI state, app keys, and
absolute credential paths should stay in host-local configuration, not in
shared workspace config.

Before a DevNexus-owned push or live provider mutation, mismatched remotes, SSH
aliases, push URLs, or observed actors become blocking preflight failures.
