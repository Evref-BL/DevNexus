# Host Cockpit

The host cockpit is the default page for `dev-nexus dashboard serve`. It is
host-scoped, not workspace-scoped.

The page should answer:

- what needs human attention now
- which workspaces are healthy, blocked, dirty, or active
- which threads or branches are unfinished
- which plugins are installed or need setup
- where the user can click next

## Main Regions

| Region | Job |
| --- | --- |
| Signal row | Give a quick status read: workspaces, attention, threads, dirty state, plugins. |
| Action queue | Rank approvals, blockers, dirty components, stale threads, and workspace load failures. |
| Workspaces | Show registered workspaces with compact state and drill-down links. |
| Threads | Surface unfinished chats or branches that need continue, archive, forget, or rescue. |
| Plugins | Show installed and known DevNexus plugins without burying them in diagnostics. |

## Action Queue Items

Each queue item should fit in a compact card:

- workspace
- reason
- age
- state
- primary action
- optional provider action

The default card should not show raw evidence. Put raw command output, JSON,
long ids, and full timestamps in the selected item or diagnostics.

## Data Sources

The host cockpit can use the DevNexus home registry, workspace snapshots,
thread summaries, plugin projections, provider links, and diagnostics. Advisory
leases can contribute hints, but they should not be the only source of active
work.
