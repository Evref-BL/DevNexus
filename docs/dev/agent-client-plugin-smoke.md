# Agent-client plugin smoke tests

This note records the smoke-test boundary for the repo-local Codex and Claude
Code plugin prototypes.

## Automated no-network smoke

The automated smoke test is:

```bash
npm test -- src/nexusAgentClientPluginNoNetworkSmoke.test.ts
```

It creates temporary DevNexus workspace fixtures and fake source-current
runtimes. It exercises both agent clients through the adapter wrapper for:

- setup checks
- workspace status
- MCP startup command planning

The test must not run package installation, provider writes, workspace sharing,
marketplace publication, or live Codex or Claude Code clients. It treats
runtime installation, npm registry access, and provider activity as approval
gates, not as automatic smoke-test repair steps.

The no-network smoke also checks the disable/uninstall boundary by deleting a
temporary plugin-data directory and confirming durable DevNexus workspace state
still exists:

- `dev-nexus.project.json`
- `.dev-nexus/` workspace metadata
- work-item link records
- target-cycle facts
- component worktrees

This is a boundary check for DevNexus plugin behavior. It is not a substitute
for each client vendor's own uninstall behavior, which must be checked during
live client smoke if that step is approved.

## Live client smoke

Live client smoke remains a human-in-the-loop gate.

Do not run these checks without explicit approval for the exact client,
workspace, plugin path, runtime mode, and command scope:

- Codex plugin side-load or local marketplace install
- Claude Code `--plugin-dir` loading
- package installation under a plugin data root
- shared workspace or team distribution
- public marketplace publication

Before running an approved live smoke, record:

- client name and exact version
- plugin path or install source
- DevNexus runtime mode
- workspace root
- command list
- approval scope and excluded actions
- outcome
- failure classification

## Failure classification

Classify every failed smoke result as one of:

- DevNexus bug
- Codex plugin adapter bug
- Claude Code plugin adapter bug
- client limitation
- environment setup issue
- missing approval or credential

Record the classification in the owning work item or follow-up issue with the
command, output summary, and next action.
