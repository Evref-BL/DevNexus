# Dashboard Data Contracts

Dashboard data is meant for both the built-in local cockpit and embedders that
provide their own tenant, auth, and navigation shell.

## Local Server Routes

```text
GET /api/projects
GET /api/dashboard
GET /api/snapshot
GET /api/weave
GET /api/events
GET /assets/dev-nexus-dashboard.js
```

`/api/dashboard` and `/api/snapshot` return workspace data when the request has
a selected workspace. In host mode, callers can use the host payload to choose a
workspace, then request workspace drill-down data.

## Host Payload

The host payload includes registered workspaces and a ranked `actionQueue`.
Embedders should use `actionQueue` for the "what needs me now?" surface instead
of re-sorting workspace counters in the browser.

Each host action has:

- workspace id, name, and root
- kind, reason, state, tone, and updated time
- compact detail text
- primary action
- optional provider action

The queue is read-only guidance. Provider writes, cleanup, archive, forget, and
assistant actions still need their own explicit action contract.

## Browser Module

```js
mountDevNexusDashboard(root, options)
fetchDevNexusDashboard(baseUrl)
```

The built-in module owns local rendering. Higher-level apps can mount it as a
workspace page or use the JSON routes to render their own UI.

## Ownership Boundary

| Owner | Responsibilities |
| --- | --- |
| Host app | Tenant selection, auth shell, persistence, global navigation, policy, and cross-workspace placement. |
| DevNexus | Workspace facts, host registry facts, plugin projections, provider links, action hints, and local capability checks. |

The default payload should be ready for glanceable UI. Raw diagnostics can be
available, but they should be explicit fields or separate views rather than the
main text shown in cards.
