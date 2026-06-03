# Cockpit Data Contracts

Cockpit data is meant for both the built-in local cockpit and embedders that
provide their own tenant, auth, and navigation shell.

## Local Server Routes

```text
GET /api/host
GET /api/projects
GET /api/cockpit
GET /api/snapshot
GET /api/weave
GET /api/events
GET /api/diagnostics
POST /api/cockpit/project-config/preview
POST /api/cockpit/project-config/apply
GET /assets/dev-nexus-cockpit.js
```

`/api/host` is the host cockpit payload. It works without a current workspace
root and carries the workspace list, selected workspace id, and action queue.

`/api/cockpit?workspace=<id>` and `/api/snapshot?workspace=<id>` return the
selected workspace payload. The default workspace payload is meant for UI: it
keeps summaries, Git history, Git workflow state, threads, plugins, provider
actions, events, and the parallel work map, but leaves raw automation objects
out.

`/api/diagnostics?workspace=<id>` returns the raw automation, eligible-work, and
target-report objects for an explicit diagnostics view.

Each host, workspace, and diagnostics payload includes a `contract` object with
the route map, selected workspace context, ownership boundary, and named
surfaces:

| Surface | Host Field | Workspace Field |
| --- | --- | --- |
| Host summary | `workspaces` | not default |
| Workspace summary | `workspaces[]` | `summary` |
| Selected snapshot | link to `/api/cockpit?workspace=:workspaceId` | `project` |
| Action queue | `actionQueue` | not default |
| Provider actions | `actionQueue[].providerAction` | `actions` on events, threads, and weave nodes |
| Plugins | `workspaces[].pluginCount` | `plugins` |
| Thread actions | `workspaces[].needsDecisionCount` | `threads.records` |
| Tracked work | `workspaces[].eligibleWorkCount` | `trackedWork` |
| Git workflows | not default | `gitWorkflows` |

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

The queue is read-only guidance. Assistant chat actions and local thread
archive/forget actions have explicit local action contracts:

```text
POST /api/codex/thread
POST /api/cockpit/thread-action
POST /api/cockpit/project-config/preview
POST /api/cockpit/project-config/apply
```

`/api/cockpit/thread-action` records a local cockpit decision only. It hides
the selected thread from active attention, but does not delete worktrees,
branches, notes, or provider records. Curated plugin catalogue entries may
expose copyable install and refresh guidance, but the browser does not execute
it. Provider writes, destructive cleanup, direct plugin install, and plugin
setup still need their own explicit action contract. When the UI can name one
of those desired actions but no contract exists yet, it should render a disabled
control instead of hiding the action or guessing the mutation.

Workspace `plugins.records[]` includes configured plugins and curated catalogue
entries. A catalogue entry has `state: "available"`, `source: "catalogue"`,
`sourcePath: null`, `packageName`, `repositoryUrl`, `configExportName`,
`installCommand`, and a `refreshCommand` suitable for copying into a shell.

Project configuration writes are not raw JSON edits. The cockpit can preview
and apply typed component configuration intents through the project-config
routes. Preview returns validation, topology diagnostics, blocked reasons, and
a freshness token. Apply requires that token and rejects stale, blocked, or
unsupported writes before touching the project config file. Component removal
removes the configuration record only; it does not delete source checkouts,
worktrees, provider records, or secrets.

Workspace `gitWorkflows` is a compact, read-only summary. It contains profile
counts, the active profile id, run counts by broad state, configured profile
records, and recent run records. It must not expose raw
`automation.gitWorkflows` JSON; editable configuration belongs in a future
Settings surface with validation and an explicit apply step.

## Workspace Drill-Down

A host app can preserve context by keeping the `workspace` query parameter on
workspace routes:

```text
/api/host?workspace=<id>
/api/cockpit?workspace=<id>
/api/weave?workspace=<id>
/api/events?workspace=<id>
/api/codex/thread?workspace=<id>
```

The selected host response keeps the chosen workspace marked as `current` while
still listing the other registered workspaces.

## Browser Module

```js
mountDevNexusCockpit(root, options)
fetchDevNexusCockpit(baseUrl)
fetchDevNexusCockpitHost(baseUrl)
```

The built-in module owns local rendering. Higher-level apps can mount it as a
workspace page or use the JSON routes to render their own UI.

The older `dashboard` route and module names remain as compatibility aliases
while the cockpit surface moves to the new names.

## Ownership Boundary

| Owner | Responsibilities |
| --- | --- |
| Host app | Tenant selection, auth shell, persistence, global navigation, policy, and cross-workspace placement. |
| DevNexus | Workspace facts, host registry facts, plugin projections, provider links, action hints, and local capability checks. |

The default payload should be ready for glanceable UI. Raw diagnostics belong in
`/api/diagnostics`, not in the main card data.
