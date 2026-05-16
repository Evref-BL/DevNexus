# DevNexus

DevNexus is a generic development orchestration core.

It owns project and work tracking, local work items, Codex worktree
orchestration, execution metadata, verification records, credential-aware
forge integration, and publication handoff across language ecosystems.

Language, runtime, framework, and toolchain-specific behavior belongs in
extensions. DevNexus provides the core contracts and extension hooks without
depending on any specific specialization.

## Automation Foundation

Projects can opt into generic run-once automation through
`dev-nexus.project.json`. The core schema covers work-item selection,
verification commands, run ledgers, stale-aware locks, retry backoff, safety
policy, and publication policy. These APIs only model and record automation
state; execution adapters decide how to run agents and tools for a project.

`runNexusAutomationOnce` provides the generic orchestration boundary for those
adapters. It loads the project config, selects eligible work from the configured
tracker, preflights tracker and Git worktree requirements, prepares a
branch-backed worktree, invokes an injected executor, records execution
metadata under the worktree support directory, appends the run ledger, and
updates the tracker with conservative status and comments.

The package also ships a generic `dev-nexus` CLI for the same boundary:

```bash
dev-nexus work-item create <project-root> --title "Implement task" --status ready --label automation
dev-nexus work-item list <project-root> --status ready
dev-nexus automation status <project-root>
dev-nexus automation run-once <project-root> --command "codex exec <prompt-or-script>"
```

`automation status` is read-only. It reports whether automation is disabled,
locked, in retry backoff, blocked by preflight, idle, or ready with a selected
work item before any worktree or tracker mutation happens.

`automation run-once` runs the command in the prepared worktree, exposes
`DEV_NEXUS_*` environment variables for the selected work item and worktree,
runs configured focused verification commands, records new commits relative to
the base ref when available, and writes the normal retained run ledger.
