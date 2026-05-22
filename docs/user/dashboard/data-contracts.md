# Dashboard Data Contracts

Dashboard data is meant for both the built-in local cockpit and embedders that
provide their own tenant, auth, and navigation shell.

## Local Server Routes

```text
GET /api/host
GET /api/projects
GET /api/dashboard
GET /api/snapshot
GET /api/weave
GET /api/events
GET /api/diagnostics
GET /assets/dev-nexus-dashboard.js
```

`/api/host` is the host cockpit payload. It works without a current workspace
root and carries the workspace list, selected workspace id, and action queue.

`/api/dashboard?workspace=<id>` and `/api/snapshot?workspace=<id>` return the
selected workspace payload. The default workspace payload is meant for UI: it
keeps summaries, threads, plugins, provider actions, events, and the parallel
work map, but leaves raw automation objects out.

`/api/diagnostics?workspace=<id>` returns the raw automation, eligible-work, and
target-report objects for an explicit diagnostics view.

Each host, workspace, and diagnostics payload includes a `contract` object with
the route map, selected workspace context, ownership boundary, and named
surfaces:

| Surface | Host Field | Workspace Field |
| --- | --- | --- |
| Host summary | `workspaces` | not default |
| Workspace summary | `workspaces[]` | `summary` |
| Selected snapshot | link to `/api/dashboard?workspace=:workspaceId` | `project` |
| Action queue | `actionQueue` | not default |
| Provider actions | `actionQueue[].providerAction` | `actions` on events, threads, and weave nodes |
| Plugins | `workspaces[].pluginCount` | `plugins` |
| Thread actions | `workspaces[].needsDecisionCount` | `threads.records` |
| Tracked work | `workspaces[].eligibleWorkCount` | `trackedWork` |

## Host Payload

The host payload includes registered workspaces, `selectedWorkspaceId`, and a
ranked `actionQueue`. Embedders should use `actionQueue` for the "what needs me
now?" surface instead of re-sorting workspace counters in the browser.

Each host action has:

- workspace id, name, and root
- kind, reason, state, tone, and updated time
- compact detail text
- primary action
- optional provider action

Ready tracked work appears as `ready-work` host actions. Workspace payloads also
include a `trackedWork` summary with compact records for ready, importable,
stale, and hidden work items.

The queue is read-only guidance. Provider writes, cleanup, archive, forget, and
assistant actions still need their own explicit action contract. When the UI can
name the desired action but no contract exists yet, it should render a disabled
control instead of hiding the action or guessing the mutation.

## Workspace Drill-Down

A host app can preserve context by keeping the `workspace` query parameter on
workspace routes:

```text
/api/host?workspace=<id>
/api/dashboard?workspace=<id>
/api/weave?workspace=<id>
/api/events?workspace=<id>
/api/codex/thread?workspace=<id>
```

The selected host response keeps the chosen workspace marked as `current` while
still listing the other registered workspaces.

## Browser Module

```js
mountDevNexusDashboard(root, options)
fetchDevNexusDashboard(baseUrl)
fetchDevNexusDashboardHost(baseUrl)
```

The built-in module owns local rendering. Higher-level apps can mount it as a
workspace page or use the JSON routes to render their own UI.

## Ownership Boundary

| Owner | Responsibilities |
| --- | --- |
| Host app | Tenant selection, auth shell, persistence, global navigation, policy, and cross-workspace placement. |
| DevNexus | Workspace facts, host registry facts, plugin projections, provider links, action hints, and local capability checks. |

The default payload should be ready for glanceable UI. Raw diagnostics belong in
`/api/diagnostics`, not in the main card data.
