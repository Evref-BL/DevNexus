# Dashboard Cockpit

The DevNexus dashboard is an operator cockpit for human-in-the-loop agent work.
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

- [UX principles](ux-principles.md) records source-backed design constraints.
- [Host cockpit](host-cockpit.md) describes the host-wide page.
- [Workspace cockpit](workspace-cockpit.md) describes the workspace drill-down.
- [Cockpit actions](actions.md) describes approvals, provider links, and chat
  actions.
- [Data contracts](data-contracts.md) describes routes and embeddable payloads.

## Commands

```bash
dev-nexus dashboard serve
dev-nexus dashboard serve <workspace-root>
dev-nexus dashboard snapshot <workspace-root> --json
dev-nexus dashboard weave <workspace-root> --json
```

`dashboard serve` opens the host cockpit. Passing a workspace root starts the
same cockpit with that workspace selected.
