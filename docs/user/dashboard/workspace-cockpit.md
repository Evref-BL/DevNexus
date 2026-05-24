# Workspace Cockpit

The workspace cockpit is the drill-down for one DevNexus workspace. It keeps the
host context available while focusing on the selected workspace.

The page should answer:

- what is happening in this workspace
- which component or work item needs attention
- which branches, worktrees, cycles, or runs explain the current state
- which provider record or assistant thread should be opened next

## Main Regions

| Region | Job |
| --- | --- |
| Selected item | Keep summary and actions near the top of the page. |
| Parallel work map | Show the shape of source, work, cycles, and approvals. |
| HITL queue | Show workspace-specific approvals, review, rescue, archive, or forget decisions. |
| Components | Show component health, dirty state, tracker, and provider links. |
| Plugins | Show workspace plugin coverage and setup obligations. |
| Events | Show recent facts without making the page a log viewer. |

## Work Map Rules

- Label lanes directly and keep labels non-overlapping.
- Use row labels for the actual item, not the lane name.
- Keep rows dense enough for the full picture at a glance.
- Center dots on the lane line.
- Select a row to update the selected-item panel.
- Show evidence on demand, not in every row.

The work map is not a replacement for Git history. It explains DevNexus
workspace activity: source checkout, active branch or worktree, other work,
cycles, runs, approvals, blockers, and provider records.
