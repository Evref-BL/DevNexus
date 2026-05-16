# DevNexus

DevNexus is a generic development orchestration core.

It owns project and work tracking, local work items, Codex worktree
orchestration, execution metadata, verification records, credential-aware
forge integration, and publication handoff across language ecosystems.

Language, runtime, framework, and toolchain-specific behavior belongs in
extensions. DevNexus provides the core contracts and extension hooks without
depending on any specific specialization.

## Project CLI

The package ships a generic `dev-nexus` CLI for initializing a DevNexus home
and managing generic project roots:

```bash
dev-nexus home init <home-path>
dev-nexus project create <name> --home <home-path>
dev-nexus project import <source-root> --home <home-path> --name <name>
dev-nexus project list --home <home-path>
dev-nexus project status <project-id-or-root> --home <home-path>
dev-nexus project status <project-root>
dev-nexus project tracker configure <project> --home <home-path> --provider local
dev-nexus project tracker link <project> --home <home-path> --tracker-project-id <id>
```

Commands that need a registry use `--home`; when it is omitted they fall back
to `DEV_NEXUS_HOME` and then the default user home path. `project status` can
also inspect an initialized project root directly without a home registry,
which is useful for local smoke checks and generated worktrees.

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

Generated worktrees can declare setup-only dependency links through
`automation.setup.dependencyLinks`. Each link copies no package data and runs
no installer; it only links an existing reviewed path from the source checkout
into the generated worktree and records the target in the worktree Git exclude
file. Required links are checked during read-only status so unsafe or missing
dependencies block before worktree creation.

The package also ships a generic `dev-nexus` CLI for the same boundary:

```bash
dev-nexus work-item create <project-root> --title "Implement task" --status ready --label automation
dev-nexus work-item list <project-root> --status ready
dev-nexus work-item get <project-root> local-1
dev-nexus work-item update <project-root> local-1 --status in_progress
dev-nexus work-item comment <project-root> local-1 --body "Started focused verification."
dev-nexus automation status <project-root>
dev-nexus automation run-once <project-root> --command "codex exec <prompt-or-script>"
dev-nexus automation schedule <project-root> --command "codex exec <prompt-or-script>" --max-runs 1
```

Projects can also store the shell command under
`automation.executor.command`. In that mode, `automation run-once` and
`automation schedule` may omit `--command`; command-line options still override
the configured command, timeout, and full-verification setting for a supervised
run.

`automation status` is read-only. It reports whether automation is disabled,
locked, in retry backoff, blocked by preflight, idle, or ready with a selected
work item before any worktree or tracker mutation happens.

`automation run-once` runs the command in the prepared worktree, exposes
`DEV_NEXUS_*` environment variables for the selected work item and worktree,
runs configured focused verification commands, records new commits relative to
the base ref when available, and writes the normal retained run ledger.

`automation schedule` repeatedly checks the same read-only status boundary and
dispatches `automation run-once` only when the project is ready. It honors
project `automation.schedule.intervalMs`, waits until active locks or retry
backoff expire, and supports `--max-ticks` or `--max-runs` for bounded local
smokes and supervised runners.

## Curated Skills

DevNexus materializes reviewed support skills under the managed project support
directory. The default core pack includes:

- `diagnose`
- `tdd` for Test-Driven Development (TDD)
- `handoff`
- `triage`
- `architecture-review`
- `setup-agent-skills`
- `grill-with-docs`
- `to-issues`
- `to-prd` for Product Requirements Document (PRD) synthesis
- `prototype`
- `zoom-out`
- `architecture-deepening`

Curated skills must use explicit terminology. Acronyms such as Product
Requirements Document (PRD), Architecture Decision Record (ADR),
human-in-the-loop (HITL), and autonomous agent-ready (AFK) must be expanded
where they appear so generated guidance is understandable without external
context.
