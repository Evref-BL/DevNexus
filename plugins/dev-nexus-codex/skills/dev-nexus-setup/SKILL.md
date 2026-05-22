---
name: dev-nexus-setup
description: Diagnose DevNexus access before enabling MCP, skills, or runtime commands.
---

# DevNexus Setup

Use this skill when a Codex user asks to set up, diagnose, or repair DevNexus
access for the current workspace.

## Workflow

1. Identify the workspace root. Prefer the open project root, then MCP roots,
   then the current working directory.
2. Build an advisory setup plan before running commands that can write files,
   install packages, contact providers, or edit credentials.
3. Check Node.js, npm, the selected DevNexus runtime mode, runtime version,
   project root, active agent targets, and MCP configuration status.
4. Report missing runtime, stale runtime, or project config gaps with concrete
   commands the user can approve.
5. Do not run global installs, shell profile edits, provider writes, credential
   writes, workspace sharing, or public plugin publication without explicit
   human approval.

## Local Commands

Use these commands only after confirming they are advisory for the requested
task:

```bash
node plugins/dev-nexus-codex/scripts/dev-nexus-codex-wrapper.mjs setup
node plugins/dev-nexus-codex/scripts/dev-nexus-codex-wrapper.mjs doctor
```
