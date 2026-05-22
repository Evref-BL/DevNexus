# Dashboard Product Model

This page is the review gate for the cockpit redesign. It defines the page
model and user vocabulary before broader UI and data-shape changes.

## Primary Questions

The cockpit should answer these questions in order:

1. What needs a human now?
2. Which workspaces need attention?
3. What work is unfinished?
4. Where do I click next?

Everything else is supporting detail.

## Scopes

| Scope | Purpose | Default contents |
| --- | --- | --- |
| Host cockpit | Host-wide situation awareness. | Action queue, workspace health, active threads, plugins, host capability summary. |
| Workspace cockpit | One workspace in context. | Selected item, work map, workspace HITL queue, components, plugins, events. |
| Selected item | One thing the user clicked. | Summary, primary action, provider links, evidence, diagnostics. |

The host cockpit is not just a workspace switcher. It is the first screen when
the user wants to understand the host.

## Page Order

1. Header and scope controls.
2. Selected item summary when something is selected.
3. Action queue.
4. Parallel work map.
5. Workspace, thread, component, and plugin lists.
6. Diagnostics or raw evidence.

This order keeps human decisions near the top and pushes supporting inventory
lower on the page.

## Vocabulary

Use these words in the primary UI:

| Use | Avoid in primary UI |
| --- | --- |
| approval | authority |
| review | handoff |
| blocker | raw policy failure strings |
| issue | provider object |
| pull request | provider pull_request |
| thread | lease |
| continue | resume work item execution |
| resume chat | Codex resume, unless Codex must be named |
| archive | stale cleanup |
| forget | delete reminder |
| rescue | salvage branch |

Technical terms can still appear in diagnostics, docs, and API fields.

## Actions

Every blocked or review-needed card should expose a primary action when one is
available.

| State | Primary action |
| --- | --- |
| Approval needed | Review approval |
| Provider issue found | Open issue |
| Provider PR found | Open pull request |
| Assistant thread found | Resume chat |
| No assistant thread found | Start chat |
| Local changes uncertain | Rescue |
| Useful but inactive thread | Archive |
| Not useful thread | Forget |

Action buttons should be short. Provider buttons should include provider icon,
short id, title when known, and an external-link icon when opening a new tab.

## Details

The selected item panel should have four sections:

- Summary
- Actions
- Evidence
- Diagnostics

Summary and Actions are open by default. Evidence and Diagnostics can be
collapsed or lower on the page.

## Implementation-Ready Decisions

- `dashboard serve` without a workspace root opens the host cockpit.
- The host cockpit should be a real status surface, not only a switcher.
- The default UI should avoid raw timestamps, raw ids, JSON-shaped text, and long
  paragraphs.
- Provider navigation is safe as read-only links.
- Assistant chat actions should use provider-neutral labels by default.
- Advisory leases can contribute hints but should not define the whole active
  work model.

## Open Product Decisions

- Which assistant providers should appear when more than one is configured.
- Whether archive and forget mutate only cockpit state or also project tracker
  state.
- Whether plugin installation can be launched from the cockpit or only linked to
  a setup flow.
- Which diagnostics are important enough to expose on the first page.

Do not start broad UI refactors until this model is accepted or updated.
