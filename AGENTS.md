# Agent Guide For DevNexus Dogfood

This is the clean DevNexus dogfood managed project. It is intentionally
separate from the older staging root.

## Operating Boundary

- Use DevNexus as infrastructure: project metadata, component graph, work-item
  service, target state, target cycle records, agent launch records, and
  factual target reports.
- The launched coordinator agent chooses work. DevNexus does not choose or
  supervise implementation work.
- Do not create Vibe Kanban workspaces, sessions, or executions for
  implementation. Vibe may be inspected only as a tracker/system-of-record
  when a component is explicitly configured for it.
- Prefer local DevNexus MCP/CLI tools for project, automation, target, and
  work-item operations.
- Do not mutate another DevNexus project's local metadata or local work-item
  stores unless the user explicitly authorizes that project for the current
  task. If the target is not a local component of this project, use the
  configured provider-native tracker, such as GitHub Issues, or leave a
  provider-backed coordination request instead.
- Human account defaults are for manual human actions only. Agent-created Git
  and GitHub activity, including pushes, issues, comments, and bridge messages,
  must use the configured bot/automation profile unless the user explicitly
  instructs otherwise.

## Per-Cycle Workflow

1. Read `DEV_NEXUS_AGENT_CONTEXT_FILE`, this file, `CONTEXT.md`, `PLAN.md`,
   and `.dev-nexus/automation/target-state.md`.
2. Inspect component working trees and preserve unrelated changes.
3. Choose the largest safe bounded batch from eligible work items, respecting
   `DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS`.
4. For each selected work item, advance state or leave a clear blocker/progress
   comment through the component work-item service.
5. Record target cycle facts with DevNexus target-cycle tooling.
6. Run focused verification first, then broader relevant checks when feasible.
7. Commit and push source changes in the owning component when policy allows.
8. Keep this project state concise: update target state with current decisions,
   active blockers, and next direction; remove stale detail.
9. Write `DEV_NEXUS_AGENT_RESULT_FILE` as JSON before exiting.

## Plan Handoff

`PLAN.md` is the durable handoff from the older staging project into this clean
dogfood project. Treat it as the forward plan for new targets. The old control
handoff remains historical reference, not the primary source for future dogfood
cycles.

## Document Loading

Use `docs/README.md` as the index for planning documents. Product Requirements
Documents (PRDs), audits, and onboarding notes are design/history artifacts, not
default live context. Load them only when the selected work item or current
question names them directly.

## Result File Shape

Write a JSON object like:

```json
{
  "status": "completed",
  "summary": "Short factual result.",
  "commitIds": [],
  "verification": [
    {
      "command": "npm run check",
      "status": "passed",
      "summary": "All checks passed."
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

Use `blocked` when a user decision, missing credential, dirty unrelated change,
or unsafe boundary prevents progress.
