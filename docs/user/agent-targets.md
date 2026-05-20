# Agent Targets And Projection Cleanup

DevNexus separates supported agent providers from active agent targets.

A supported provider is a provider DevNexus knows how to describe or project
for, such as Codex, Claude, OpenCode, manual, or custom. An active target is a
provider this project currently wants generated support for. A Codex-only
project should not need Claude files just because DevNexus supports Claude.

Use `agentTargets.active` in `dev-nexus.project.json` when the project needs an
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

Older projects may still use `mcp.agentTargets` and `skills.agentTargets`.
DevNexus treats those as compatibility input and recommends adding
`agentTargets.active` when the project should make provider selection explicit.

## What Gets Projected

Active targets control generated agent support:

- MCP configuration, such as `.codex/config.toml`, `.mcp.json`, or
  `opencode.json`.
- Agent-native skill directories, such as `.agents/skills`,
  `.claude/skills`, or `.opencode/skills`.
- Plugin capabilities and worker context fragments that declare matching
  target agents.

Generated support is still local project support. It is not a promise that a
provider is installed, logged in, trusted, or connected to a live session.
Provider credentials, account profiles, and runtime approval remain host-local
setup concerns.

Refresh generated support after changing targets:

```bash
dev-nexus project mcp refresh <project-root>
```

Pass `--agent <provider>` only when you intentionally want to refresh one
provider surface:

```bash
dev-nexus project mcp refresh <project-root> --agent codex
```

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

Manual or custom targets are useful when a team wants the project status to
record intent but no built-in generated projection adapter exists. Treat those
targets as documented setup obligations rather than automatic provider
configuration.

## Choosing Targets During Setup

For interactive setup, choose only the agent providers this project will
actually use first. For answer-file setup, list the desired providers in the
setup answers and review the generated `dev-nexus.project.json` before applying
with `--yes`.

After setup, verify the selected target surfaces:

```bash
dev-nexus project status <project-root>
dev-nexus setup check <project-root> join-existing-project
```

`project status` reports active providers, expected MCP files, expected skill
directories, missing generated support, unsupported targets, and stale or
manual provider directories.

## Cleaning Stale Generated Support

Stale generated support is a provider-native file or directory that is present
but no longer selected by the active target policy. Examples include a
generated `.claude/skills` directory left behind after a project moves to
Codex-only, or an old `.codex/config.toml` after a project moves to another
provider.

DevNexus classifies stale support conservatively:

- `present-stale-generated` means the path looks generated or ignored by Git.
  It is a cleanup candidate, but still review it first.
- `present-manual` means DevNexus does not consider the path cleanup-safe. It
  may be source-controlled or manually authored.
- Expected missing support should be refreshed, not cleaned.

Do a dry-run style review before removing anything:

```bash
dev-nexus project status <project-root>
dev-nexus setup check <project-root> join-existing-project
```

Only remove generated support after status or setup checks identify it as
cleanup-safe. Do not delete provider-global files, source-controlled files,
manual provider configuration, credentials, or user-local profile state.
