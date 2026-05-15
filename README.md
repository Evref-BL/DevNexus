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
