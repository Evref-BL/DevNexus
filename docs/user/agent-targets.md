# Agent Targets And Projection Cleanup

DevNexus separates supported agent providers from active agent targets.

A supported provider is a provider DevNexus knows how to describe or project
for, such as Codex, Claude, OpenCode, manual, or custom. An active target is a
provider this workspace currently wants generated support for. A Codex-only
workspace should not need Claude files just because DevNexus supports Claude.

Use `agentTargets.active` in `dev-nexus.project.json` when the workspace needs an
explicit policy:

```json
{
  "agentTargets": {
    "active": [
      {
        "provider": "codex"
      }
    ]
  }
}
```

Older workspaces may still use `mcp.agentTargets` and `skills.agentTargets`.
DevNexus treats those as compatibility input and recommends adding
`agentTargets.active` when the workspace should make provider selection explicit.

## What Gets Projected

Active targets control generated agent support:

- MCP configuration, such as `.codex/config.toml`, `.mcp.json`, or
  `opencode.json`.
- Agent-native skill directories, such as `.agents/skills`,
  `.claude/skills`, or `.opencode/skills`.
- Plugin capabilities and worker context fragments that declare matching
  target agents.

Generated support is still local workspace support. It is not a promise that a
provider is installed, logged in, trusted, or connected to a live session.
Provider credentials, account profiles, and runtime approval remain host-local
setup concerns.

Refresh generated support after changing targets:

```bash
dev-nexus workspace mcp refresh <workspace-root>
```

Pass `--agent <provider>` only when you intentionally want to refresh one
provider surface:

```bash
dev-nexus workspace mcp refresh <workspace-root> --agent codex
```

## MCP Exposure And Gateway Groups

MCP servers can be projected directly, hidden, or routed through the DevNexus
MCP gateway. Direct exposure gives the agent every configured upstream tool as a
visible tool. Gateway exposure gives the agent the small `dev_nexus_gateway`
surface and lets it search, describe, and call configured upstream tools on
demand.

Use gateway exposure when a workspace or plugin has many MCP tools but most
turns only need a few of them:

```json
{
  "mcp": {
    "exposure": "gateway",
    "gateway": {
      "includedServers": ["workflow_runtime"],
      "excludedTools": ["workflow_runtime.workflow_delete"]
    },
    "agentTargets": [
      {
        "agent": "codex",
        "gateway": {
          "includedTools": ["workflow_runtime.workflow_search"]
        }
      }
    ]
  }
}
```

Gateway grouping is an allow/filter policy. `includedServers` allows every tool
from a server, `includedTools` allows individual tools, and `excludedTools`
removes tools even when a broader include matched. Tool names may be written as
`tool_name`, `server_name.tool_name`, or `server_name__tool_name`.

Plugin MCP servers connect to the gateway through their `mcp_server`
capability. Declare `serverName`, `command`, and `args`; declare `tools` when the
tool names are known at plugin install time. If no tools are declared, the
gateway starts the command-based MCP server, runs MCP initialization and
`tools/list`, caches the discovered metadata under `.dev-nexus/runtime/mcp-gateway/`,
and uses that cache in future budget reports.

Check the context effect before changing exposure:

```bash
dev-nexus workspace mcp budget <workspace-root>
dev-nexus workspace mcp budget <workspace-root> --json
```

The budget report shows visible MCP context, gateway-routed upstream tools, and
the estimated byte/token delta versus exposing those upstream tools directly.

## Common Policies

Codex-only:

```json
{
  "agentTargets": {
    "active": [
      {
        "provider": "codex",
        "mcp": {
          "configPath": ".codex/config.toml"
        },
        "skills": {
          "directory": ".agents/skills"
        }
      }
    ]
  }
}
```

Claude-only:

```json
{
  "agentTargets": {
    "active": [
      {
        "provider": "claude",
        "mcp": {
          "configPath": ".mcp.json"
        },
        "skills": {
          "directory": ".claude/skills"
        }
      }
    ]
  }
}
```

OpenCode or another provider with manual setup notes:

```json
{
  "agentTargets": {
    "active": [
      {
        "provider": "opencode",
        "setupNotes": [
          "Confirm the local OpenCode project reads opencode.json before assigning work."
        ]
      }
    ]
  }
}
```

Multi-provider:

```json
{
  "agentTargets": {
    "active": [
      {
        "provider": "codex"
      },
      {
        "provider": "claude"
      }
    ]
  }
}
```

Manual or custom targets are useful when a team wants the workspace status to
record intent but no built-in generated projection adapter exists. Treat those
targets as documented setup obligations rather than automatic provider
configuration.

## Choosing Targets During Setup

For interactive setup, choose only the agent providers this workspace will
actually use first. For answer-file setup, list the desired providers in the
setup answers and review the generated `dev-nexus.project.json` before applying
without `--dry-run`.

After setup, verify the selected target surfaces:

```bash
dev-nexus workspace status <workspace-root>
dev-nexus setup check <workspace-root> join-existing-project
```

`workspace status` reports active providers, expected MCP files, expected skill
directories, missing generated support, unsupported targets, and stale or
manual provider directories.

## Cleaning Stale Generated Support

Stale generated support is a provider-native file or directory that is present
but no longer selected by the active target policy. Examples include a
generated `.claude/skills` directory left behind after a workspace moves to
Codex-only, or an old `.codex/config.toml` after a workspace moves to another
provider.

DevNexus classifies stale support conservatively:

- `present-stale-generated` means the path looks generated or ignored by Git.
  It is a cleanup candidate, but still review it first.
- `present-manual` means DevNexus does not consider the path cleanup-safe. It
  may be source-controlled or manually authored.
- Expected missing support should be refreshed, not cleaned.

Do a dry-run style review before removing anything:

```bash
dev-nexus workspace status <workspace-root>
dev-nexus setup check <workspace-root> join-existing-project
dev-nexus workspace agent-projection cleanup <workspace-root> --dry-run
```

Only apply cleanup after the dry-run identifies removable generated support:

```bash
dev-nexus workspace agent-projection cleanup <workspace-root> --apply
```

The cleanup command removes only paths classified as cleanup-safe stale
generated support. It skips active provider support, source-controlled files,
manual provider configuration, credentials, and user-local profile state.
Do not delete provider-global files outside the workspace.
