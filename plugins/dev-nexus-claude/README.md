# DevNexus Claude Plugin Prototype

This is a repo-local Claude Code plugin prototype for the agent-client plugin
initiative. It is not a marketplace package.

## What It Contains

- `.claude-plugin/plugin.json` with Claude Code plugin metadata.
- `.mcp.json` with a `dev_nexus` MCP server entry.
- `scripts/dev-nexus-claude-wrapper.mjs`, which calls the DevNexus adapter
  wrapper from the local source checkout after `npm run build`.
- Skills for setup, status, agent-support refresh, worktree preparation, and
  handoff workflows.

## Local Checks

From the DevNexus source checkout:

```bash
npm run build
node --check plugins/dev-nexus-claude/scripts/dev-nexus-claude-wrapper.mjs
CLAUDE_PLUGIN_ROOT="$PWD/plugins/dev-nexus-claude" \
  CLAUDE_PLUGIN_DATA="$PWD/.tmp/claude-plugin-data" \
  node plugins/dev-nexus-claude/scripts/dev-nexus-claude-wrapper.mjs doctor
```

Claude Code local loading is a human approval gate:

```bash
claude --plugin-dir ./plugins/dev-nexus-claude
```

Plugin-local package installation is optional and explicit. The baseline
prototype reads `${CLAUDE_PLUGIN_DATA}` but does not install packages into it.
