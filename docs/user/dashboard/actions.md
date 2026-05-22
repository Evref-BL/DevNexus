# Cockpit Actions

The cockpit should guide the user to the next safe action. A blocked state
without an action is a product bug unless the system can explain why no action
is available.

## Action Types

| Action | Meaning |
| --- | --- |
| Open issue | Open a provider issue in a new tab. |
| Open pull request | Open a provider pull request in a new tab. |
| Start chat | Start a new assistant chat for the selected item. |
| Resume chat | Continue the assistant thread that already worked on the item. |
| Copy prompt | Copy a provider-neutral continuation prompt. |
| Continue | Keep working on a thread, branch, or workspace item. |
| Archive | Keep the record but remove it from active attention. |
| Forget | Drop an unneeded local thread or cockpit reminder after explicit user choice. |
| Rescue | Inspect uncertain local changes before archive or forget. |

## Provider Actions

Provider buttons should show:

- provider icon
- short id
- title when known
- external-link affordance when opening a new tab

Example labels:

- `GitHub #42: Fix setup fallback`
- `GitHub PR #66: Dashboard cockpit`
- `Repository: DevNexus`

Provider actions are read-only navigation unless a separate provider mutation
policy explicitly allows posting, approving, merging, or cleanup.

## Assistant Actions

Assistant actions should use provider-neutral language by default. Use `Start
chat`, `Resume chat`, and `Copy prompt` unless the user must choose between
multiple assistant providers.

Prompts should be concise and specific:

- item title
- current decision
- reason
- branch or workspace when relevant
- requested next action

Do not mention Codex unless Codex is the configured assistant provider for that
action.
