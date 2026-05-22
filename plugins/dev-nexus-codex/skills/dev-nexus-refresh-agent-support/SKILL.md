---
name: dev-nexus-refresh-agent-support
description: Refresh DevNexus-projected Codex skills and MCP configuration.
---

# DevNexus Refresh Agent Support

Use this skill when Codex needs refreshed DevNexus support files, projected
skills, or MCP configuration for the current workspace.

## Workflow

1. Inspect the current DevNexus setup or plugin projection status first.
2. Report the files that would be created or updated before running a refresh.
3. Keep generated support files under the workspace support paths chosen by
   DevNexus. Do not write under the plugin root.
4. Run refresh commands only after the user approves file mutations.
5. Re-check setup status after refresh and report remaining gaps.

## Guardrails

- Do not edit user credentials, shell profiles, global npm state, or provider
  configuration.
- Do not use workspace sharing or plugin publication as part of a refresh.
