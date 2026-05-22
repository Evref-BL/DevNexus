---
name: dev-nexus-status
description: Read DevNexus workspace status, target state, trackers, and blockers.
---

# DevNexus Status

Use this skill when a Claude Code user asks what is happening in a DevNexus
workspace or wants a read-only status report before choosing work.

## Workflow

1. Resolve the workspace root from the open project, MCP roots, or current
   directory.
2. Prefer read-only status calls and MCP tools.
3. Summarize workspace identity, active target state, configured trackers,
   current blockers, claimed work, and relevant handoffs.
4. Keep the summary factual. Do not choose work unless the user asks Claude
   Code to lead or start a bounded item.

## Local Command

```bash
node plugins/dev-nexus-claude/scripts/dev-nexus-claude-wrapper.mjs status
```
