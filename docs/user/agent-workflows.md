# Agent Workflows

DevNexus gives agents a concise project surface: read project state, inspect
eligible work, prepare worktrees, record progress, and report factual results.
It does not decide what should be implemented. The human or launched
coordinator agent owns that judgment.

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
```

Work-item tools accept a component id when a project has multiple component
trackers. Omitting it uses the primary component for compatibility.

## Low-Token Coordinator Cycle

A coordinator can start with these read-only commands:

```bash
dev-nexus automation eligible-work <project-root> --json
dev-nexus automation agent-profiles <project-root> --json
dev-nexus automation target-report <project-root> --json
```

Then record the work it selected:

```bash
dev-nexus work-item update <project-root> local-1 --component core --status in_progress
dev-nexus work-item comment <project-root> local-1 --component core --body "Started focused verification."
dev-nexus automation target-cycle record <project-root> --status dispatched --work-item core:local-1 --work-item-status in_progress
```

Target-cycle facts are caller-reported. DevNexus stores them for durable
continuation, reporting, and relaunch decisions, but it does not assign agents
or supervise implementation.

## Generated Worktrees

Prepare a component-scoped worktree when implementation should be isolated:

```bash
dev-nexus worktree prepare <project-root> --component core --work-item local-1
```

Prepared worktrees carry ownership metadata: component id, source root,
generated path, branch, base ref, and owning work item. The generated path must
resolve inside the component worktrees root.

Generated worktrees can receive setup-only dependency projections. DevNexus
links existing reviewed paths such as `node_modules` into the worktree, records
the target in the worktree Git exclude file, and does not run an installer.

Generated worktrees also receive `.dev-nexus/context/` support files:

- `context.json` for machine-readable project, component, ownership, and plugin
  capability facts.
- `briefing.md` for agent-readable setup notes and worker briefing fragments.

Source edits, verification commands, and Git commands still run from the
component checkout root.

## Coordination

Coordination commands record advisory handoff facts in the configured
component work-item service and inspect Git state.

```bash
dev-nexus coordination status <project-root> --component core --work-item local-1 --worktree <path>
dev-nexus coordination handoff <project-root> local-1 --component core --status ready --worktree <path>
dev-nexus coordination integrate <project-root> --component core --work-item local-1 --target-branch main --worktree <path>
```

`coordination integrate` builds a read-only plan from related handoff branches,
recorded decisions, merge bases, merge-tree output, changed files, and
range-diff output when useful. `--fetch` fetches the configured remote only
when project automation safety allows host mutation.

## Automation

Projects opt into automation through `dev-nexus.project.json`. The automation
schema describes launch gates, selector filters, verification hints, ledgers,
locks, retry backoff, safety policy, publication policy, targets, and agent
profiles.

Useful commands:

```bash
dev-nexus automation status <project-root>
dev-nexus automation enqueue <project-root> --title "Implement focused task"
dev-nexus automation run-once <project-root>
dev-nexus automation schedule <project-root> --max-runs 1
dev-nexus automation coordinator-loop <project-root> --max-runs 1
```

Use `--progress-jsonl` with `--json` when the caller needs final JSON on
stdout but should still see that a long nested coordinator run is alive:

```bash
dev-nexus automation coordinator-loop <project-root> --max-runs 1 --json --progress-jsonl
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

`automation run-once` and `automation coordinator-loop` launch the configured
agent command when the project is ready. The launched agent receives
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
dev-nexus automation current-agent adopt <project-root> --run-id current-1 --json
dev-nexus automation current-agent record <project-root> --run-id current-1 --status completed --summary "Completed requested work."
```

If adoption returns `shouldProceed: false`, the current agent must not continue
the automation run. If it returns `true`, the agent proceeds under the returned
`DEV_NEXUS_*` environment values and records the terminal result.

## Publication Boundary

Publication policy can separate manual and automation identities. For example,
`origin` can remain the human remote while `bot` points at an SSH host alias for
an automation account. Tokens, private keys, GitHub CLI state, app keys, and
absolute credential paths should stay in host-local configuration, not in
shared project config.

Before a DevNexus-owned push or live provider mutation, mismatched remotes, SSH
aliases, push URLs, or observed actors become blocking preflight failures.
