---
name: dev-nexus-prepare-worktree
description: Prepare an isolated DevNexus worktree before changing managed files.
---

# DevNexus Prepare Worktree

Use this skill when Codex is asked to implement, document, or otherwise mutate
a DevNexus-managed component or workspace surface.

## Workflow

1. Identify the owning component, tracker item, base branch, and write scope.
2. Inspect status first and preserve unrelated user changes.
3. Use DevNexus worktree tooling for component source or workspace metadata
   rather than editing shared checkouts directly.
4. Record the prepared branch and worktree in the tracker or coordination
   handoff.
5. Run focused verification before marking the work ready.

## Guardrails

- Do not push, open pull requests, publish packages, or run live client smokes
  unless the user approves that gate.
- Do not delete or archive a worktree until integration policy is clear.
