# Host Cockpit

The host cockpit is the default page for `dev-nexus cockpit serve`. It is
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
| Tracked work | Surface ready provider or local issues without opening diagnostics. |
| Threads | Surface unfinished chats or branches that need continue, archive, forget, or rescue. |
| Plugins | Show installed and known DevNexus plugins without burying them in diagnostics. |
| Diagnostics | Stay on demand; do not compete with the action queue. |

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

## Host And Workspace Scope

The default served cockpit is host-scoped. It can start without a workspace root,
then drill into a workspace by id.

Workspace routes keep the host context through `?workspace=<id>`. A selected
workspace response marks that workspace as `current` and keeps the rest of the
host registry visible.

## Data Sources

The host cockpit can use the DevNexus home registry, workspace snapshots,
thread summaries, plugin projections, provider links, and diagnostics. Advisory
leases can contribute hints, but they should not be the only source of active
work.
