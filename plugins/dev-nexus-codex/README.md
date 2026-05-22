# DevNexus Codex Plugin Prototype

This is a repo-local Codex plugin prototype for the agent-client plugin
initiative. It is not a public marketplace package.

## What It Contains

- `.codex-plugin/plugin.json` with Codex plugin metadata.
- `.mcp.json` with a `dev_nexus` MCP server entry.
- `scripts/dev-nexus-codex-wrapper.mjs`, which calls the DevNexus adapter
  wrapper from the local source checkout after `npm run build`.
- Skills for setup, status, agent-support refresh, worktree preparation, and
  handoff workflows.
- `fixtures/codex-marketplace.json` for repo-local marketplace testing.

## Local Checks

From the DevNexus source checkout:

```bash
npm run build
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/dev-nexus-codex
node --check plugins/dev-nexus-codex/scripts/dev-nexus-codex-wrapper.mjs
```

Live Codex install, workspace sharing, and public marketplace publication remain
human approval gates.
