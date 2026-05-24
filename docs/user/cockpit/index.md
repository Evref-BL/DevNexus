# DevNexus Cockpit

The DevNexus cockpit is an operator cockpit for human-in-the-loop agent work.
It should show what needs attention first, then let the user drill into the
workspace, thread, branch, issue, pull request, or plugin behind it.

Use the cockpit for:

- host-wide status across registered workspaces
- approvals, blockers, dirty state, and unfinished threads
- workspace drill-down without losing host context
- provider links and assistant chat actions
- plugin visibility and setup state

Do not use the default cockpit as a diagnostics dump. Raw ids, full timestamps,
large event bodies, and JSON-shaped evidence belong behind details or a
diagnostics mode.

## Scopes

| Scope | Job |
| --- | --- |
| Host cockpit | Answer "what needs me now?" across local registered workspaces. |
| Workspace cockpit | Show one workspace's components, work map, actions, threads, and plugins. |
| Selected item | Explain one signal, blocker, thread, branch, work item, or provider record. |

## Documentation

- [Product model](product-model.md) defines the scope model, page order, and
  vocabulary for the redesign.
- [UX principles](ux-principles.md) records source-backed design constraints.
- [Host cockpit](host-cockpit.md) describes the host-wide page.
- [Workspace cockpit](workspace-cockpit.md) describes the workspace drill-down.
- [History widget](history-widget.md) records the reusable write-event graph
  model for project history.
- [Cockpit actions](actions.md) describes approvals, provider links, and chat
  actions.
- [Data contracts](data-contracts.md) describes routes and embeddable payloads.
- [Visual QA](visual-qa.md) describes repeatable visual guardrails and the
  remaining human review step.
- [Plugin source notes](plugin-source-notes.md) parks marketplace research that
  is useful later but not active scope.

## Commands

```bash
dev-nexus cockpit serve
dev-nexus cockpit serve <workspace-root>
dev-nexus cockpit snapshot <workspace-root> --json
dev-nexus cockpit weave <workspace-root> --json
```

`cockpit serve` opens the host cockpit. Passing a workspace root starts the
same cockpit with that workspace selected.
