# Multi-Tracker Work Tracking

DevNexus components can use more than one work tracker at the same time. The
common pattern is to keep a local tracker as the canonical source for agent
selection while linking or mirroring selected items to a shared provider such as
GitHub Issues.

This guide covers the supported configuration and migration path. It does not
make all trackers equal sources of truth, enable two-way sync by default, or
make live external writes generally available.

## Tracker Bindings

Configure multiple trackers on the owning component with `workTrackers` and
choose one enabled tracker as `defaultWorkTrackerId`.

```json
{
  "version": 1,
  "id": "example-suite",
  "name": "Example Suite",
  "components": [
    {
      "id": "core",
      "name": "Core",
      "kind": "git",
      "role": "primary",
      "sourceRoot": "componentsRoot:core",
      "defaultWorkTrackerId": "primary",
      "workTrackers": [
        {
          "id": "primary",
          "name": "Local Primary",
          "enabled": true,
          "roles": ["primary"],
          "workTracking": {
            "provider": "local",
            "storePath": ".dev-nexus/work-items/core.json"
          }
        },
        {
          "id": "github",
          "name": "GitHub Mirror",
          "enabled": true,
          "roles": ["mirror", "coordination"],
          "communication": {
            "coordinationHandoffs": "silent"
          },
          "workTracking": {
            "provider": "github",
            "host": "github.com",
            "repository": {
              "owner": "example",
              "name": "example-suite"
            }
          }
        }
      ],
      "relationships": []
    }
  ]
}
```

`workTracking` remains accepted for older workspaces. When `workTrackers` is not
configured, DevNexus normalizes the legacy `workTracking` value into one
enabled default tracker named `default` with role `primary`.

Tracker roles are advisory labels used by DevNexus surfaces and coordination
commands:

| Role | Intended use |
| --- | --- |
| `primary` | Canonical tracker for ordinary work-item operations and automation selection. |
| `mirror` | Receives selected fields from another tracker. |
| `coordination` | Stores handoffs, integration notes, or shared multi-host state. |
| `planning` | Stores backlog planning, PRD, or issue-slicing artifacts. |
| `external_feedback` | Records provider-native reviewer questions or responses. |
| `migration` | Participates in import, link, or cutover work. |
| `archive` | Read-mostly historical tracker. |

A tracker can have more than one role only when the component config says so.
For example, a tracker can be both `mirror` and `coordination`, but a mirror
role alone does not make it the coordination target.

Tracker communication policy controls whether coordination tools publish
handoff records as tracker comments. Local trackers default to
`coordinationHandoffs: "comment"` because local comments are durable workspace
storage. Provider trackers default to `coordinationHandoffs: "silent"` so
routine automation does not clutter shared systems such as GitHub Issues.

Set a project default with `workTrackerCommunication`, or override one tracker
binding with `communication`:

```json
{
  "workTrackerCommunication": {
    "coordinationHandoffs": "silent"
  },
  "components": [
    {
      "id": "core",
      "workTrackers": [
        {
          "id": "github",
          "roles": ["coordination"],
          "communication": {
            "coordinationHandoffs": "comment"
          }
        }
      ]
    }
  ]
}
```

Use `"comment"` for a provider tracker only when those comments are an intended
human-facing coordination surface.

## Default Tracker Behavior

Work-item commands and MCP tools use the component default tracker when
`--tracker` or `trackerId` is omitted.

```bash
dev-nexus work-item create <workspace-root> --component core --title "Implement focused task" --status ready
dev-nexus work-item list <workspace-root> --component core
dev-nexus work-item update <workspace-root> local-1 --component core --status in_progress
```

Use `--tracker` when intentionally reading or mutating a non-default tracker:

```bash
dev-nexus work-item list <workspace-root> --component core --tracker github --status ready
dev-nexus work-item get <workspace-root> github:42 --component core
dev-nexus work-item comment <workspace-root> github:42 --component core --body "Shared coordination note."
```

Tracker-qualified ids use `<tracker-id>:<provider-local-id>`. If a command also
passes `--tracker`, the id and option must agree.

`dev-nexus workspace status <workspace-root>` reports each tracker id, provider,
roles, enabled state, default state, and unsupported provider capabilities.

## Link Records

Link records connect one logical DevNexus work item to one or more provider
items. They let migration and sync tools find the existing external issue
instead of creating a duplicate.

Link an existing GitHub issue before enabling sync:

```bash
dev-nexus work-item link <workspace-root> local-46 \
  --component core \
  --tracker github \
  --item-id 42 \
  --item-number 42 \
  --web-url https://github.com/example/example-suite/issues/42
```

Inspect and repair links:

```bash
dev-nexus work-item show-links <workspace-root> local-46 --component core
dev-nexus work-item unlink <workspace-root> local-46 --component core --tracker github --item-id 42 --reason "Wrong external issue"
```

Repeated `link` calls for the same tracker and item update the stored metadata
instead of duplicating the reference. `unlink` records audit metadata so a
mistaken link can be explained later.

## Dry-Run Sync Planning

Start every migration or mirror rollout with a dry-run plan. The plan reads the
source and target trackers, applies filters, checks provider capabilities and
credentials, and reports creates, updates, skips, conflicts, stale links, and
unlinked target items without mutating providers.

```bash
dev-nexus work-item sync-plan <workspace-root> \
  --component core \
  --source-tracker primary \
  --target-tracker github \
  --open \
  --label automation \
  --field title \
  --field description \
  --field status \
  --field labels \
  --comment-policy ignore \
  --conflict-policy block \
  --write-create plan \
  --write-update plan \
  --credentials available
```

The command-line sync policy is explicit:

| Policy area | Supported values |
| --- | --- |
| Direction | `source_to_target` only. |
| Filters | `--open`, `--status`, `--label`, `--assignee`, `--search`, and `--limit`. |
| Fields | `title`, `description`, `status`, `labels`, `assignees`, and `milestone`. |
| Comments | `ignore` or `plan`. Planned comments are append-only sync comments. |
| Conflicts | `block`, `source_wins`, or `target_wins`. Use `block` for migration review. |
| Writes | `plan`, `skip`, or `block` for creates and updates. |
| Credentials | `not_required`, `available`, or `missing`. External writes require explicit available credentials policy. |

The dry-run planner is the review surface. Treat blockers, missing capabilities,
missing credentials, stale links, unlinked targets, and conflicts as work to
resolve before any execution.

Use `--open` for normal active-work migrations. It expands to `todo`, `ready`,
`in_progress`, and `blocked`, and cannot be combined with explicit `--status`
filters.

## One-Way Execution Limits

Sync execution is deliberately narrow. Use `work-item sync-execute` only for an
approved run after reviewing a dry-run plan. It consumes the same source,
target, filter, field, comment, conflict, write, and credential policy flags as
`sync-plan`; external target providers require `--credentials available`.

The current execution path is intended for local source trackers to GitHub
target trackers with explicit available credentials policy. Other provider
pairs are blocked by policy.

Execution creates or updates only the configured field set. It links created
target items immediately, records a sync run summary, and uses stable markers
for DevNexus-generated sync comments so repeated runs do not duplicate them.

Do not treat sync execution as a default migration step or as proof that live
external writes are available in every workspace. Run and review `sync-plan`
first, link existing external issues first, and execute only when the workspace
policy, provider target, and automation identity explicitly allow that external
mutation.

## Migration From Local To Shared Provider

Use an additive migration. The local tracker can remain primary while GitHub or
Jira is introduced as a mirror, coordination tracker, or migration tracker.

1. Add the external tracker binding with `enabled: true` and an explicit role,
   but keep `defaultWorkTrackerId` pointed at the current local primary.
2. Run `dev-nexus workspace status <workspace-root>` and confirm the tracker id,
   provider, roles, default state, and capability report.
3. Decide the migration scope with labels, statuses, explicit item ids, or a
   search query. Do not mirror every local runtime note by default.
4. Create or identify external issues that already represent local work.
5. Link existing external issues with `dev-nexus work-item link` before any
   sync plan that could create target items.
6. Run `dev-nexus work-item sync-plan` with narrow filters and `--json` for
   reviewable output.
7. Resolve stale links, unlinked target warnings, missing provider
   capabilities, missing credentials, and conflicts.
8. If policy allows, run one-way execution for the reviewed scope.
9. Keep the local tracker canonical until the component owner deliberately
   changes `defaultWorkTrackerId`.

For a future cutover, change the default tracker only after all active local
items have either been linked to the external provider, closed locally, or
intentionally left local. Record the decision in the workspace handoff or target
state so agents know which tracker is canonical.

## Safety Notes

- Dry-run first. `sync-plan` is the normal review step before any execution.
- No delete propagation. Closing or setting `wont_do` is the neutral way to end
  work; provider-native deletion remains manual unless a future policy says
  otherwise.
- No two-way sync by default. DevNexus does not auto-resolve concurrent edits
  across trackers.
- No duplicate creation by assumption. Link existing external issues before a
  plan that may create target items.
- Provider identity matters. External writes must use the configured automation
  identity or host-local auth profile, not whichever browser, Git CLI, or
  credential helper happens to be active.
- Secrets stay local. Tokens, private keys, browser state, and absolute
  credential paths belong in host-local configuration, not shared workspace
  config.
- Capability gaps are meaningful. If a provider cannot create, update, comment,
  label, assign, or represent a status, the plan should report a skip or
  blocker instead of silently dropping data.

## Agent Guidance

Coordinators should select work from the component default tracker unless the
target or work item explicitly says otherwise. Treat items from mirror,
coordination, planning, external-feedback, migration, or archive trackers as
supporting records.

Workspaces that intentionally allow selected external trackers into automation can
set `automation.eligibleWorkMode` to `discovery`. In that mode, configured
component `trackerDiscovery` policy decides which tracker roles are scanned and
whether non-default tracker items are directly selectable or import-only. Keep
the default mode for workspaces that want automation to read only the component
default tracker.

`automation eligible-work --discovery` also reports bounded examples of visible
items excluded by the selector or tracker-discovery policy, including status,
label, assignee, milestone, search, excluded-label, and final-limit reasons.

When an agent is assigned a canonical local item:

- Update status and progress comments on the default tracker.
- Use link records to find existing provider mirrors.
- Write handoffs through `coordination handoff`; if a coordination tracker is
  configured, DevNexus resolves that role before falling back to the default
  tracker and applies the tracker communication policy.
- Include the tracker id in target-cycle records and handoffs when the selected
  item did not come from the default tracker.
- Do not update a mirror as if it were canonical unless the assignment names
  that tracker or the component default has been changed.

This keeps local workspace work fast and recoverable while still letting shared
providers carry coordination, migration, or review state.
