---
name: dev-nexus-handoff
description: Record DevNexus progress, verification, blockers, branches, commits, and review gates.
---

# DevNexus Handoff

Use this skill when Codex is pausing, finishing a slice, requesting review, or
leaving progress for another agent or human.

## Workflow

1. Capture the work item, component, branch, worktree, commit ids, changed
   areas, and current status.
2. Record verification commands and whether each passed, failed, or was not
   run.
3. State blockers and human approval gates explicitly.
4. Record the publication decision: local only, direct integration, review
   handoff, blocked, or not decided.
5. Leave tracker and coordination records through DevNexus tools when policy
   allows.

## Guardrails

- Do not claim work is complete without verification evidence.
- Do not hide failed checks, dirty unrelated changes, or missing approvals.
