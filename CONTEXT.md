# DevNexus Context

## Glossary

- DevNexus project: A managed orchestration context containing one or more components, launch policy, shared records, and project-level support files.
- Component: A configured source or support unit inside a DevNexus project, with its own source root, optional Git metadata, worktree root, work-item service, verification hints, publication hints, and relationships.
- Primary component: The component that legacy single-target commands use when a command cannot yet operate across every component.
- Component arity: The number of components configured in a DevNexus project; arity one follows the same model as any larger arity.
- Work-item service: The tracker or issue provider configured for a component, such as a local store, GitHub Issues, GitHub Projects, GitLab issues, or Jira.
- Component work-item selector: A work-item operation that names a project plus optional component id; when the component id is omitted, compatibility commands use the primary component.
- Work-tracker capabilities: Provider feature flags that tell an agent whether a component's tracker can list, create, get, update, comment, use labels, use assignees, use milestones, use boards, or update board status.
- DevNexus user: A human or an agent acting under human instruction that configures DevNexus and asks it to launch agent work.
- DevNexus Model Context Protocol (MCP) server: The generic stdio tool server that exposes DevNexus project, automation, and work-item APIs to agents without specialization adapters.
- Agent MCP target: A configured project-local agent integration, such as Codex `.codex/config.toml` or Claude `.mcp.json`, that registers the DevNexus Model Context Protocol (MCP) server for that agent.
- DevNexus plugin: An additive, generic project capability declaration. A project may configure multiple plugins; each plugin contributes metadata about projected skills, MCP servers and tools, setup obligations, environment hints, cleanup hooks, or agent affordances.
- Plugin capability projection: The agent-facing summary of enabled plugin capability records. It tells launched coordinators what capabilities and setup policy are available, but it does not run setup, choose work, assign subagents, or supervise implementation.
- Target: The user-requested outcome for a DevNexus automation loop, such as completing selected work items or continuing until no eligible issue remains.
- Target state: Concise project memory for the current target, stored in a configured Markdown file and updated by agents as the useful context changes.
- Target cycle: One caller-reported pass through a target loop, such as reading context, dispatching subagents, waiting for results, or recording a blocker.
- Target cycle ledger: DevNexus-managed JSON records of target cycle facts, including selected or dispatched work item refs, summaries, blockers, notes, and terminal or still-active cycle status.
- Target report: A read-only factual JSON synthesis over target context, target cycles, run records, recorded work item refs, blockers, and notes. A report must not invent tracker state or choose the next work.
- Launched agent: The thinking process started by DevNexus that chooses work items, supervises subagents, coordinates worktrees, verifies changes, and reports results.
- Agent profile: A named executor/model/version or variant/reasoning or intelligence/safety policy that may also include a launch command template. A coordinator profile starts the launched agent; other profiles are policy hints the launched agent can assign to subagents.
- Subagent cap: The maximum number of subagents the launched agent should run concurrently for one DevNexus automation cycle. It is infrastructure policy, not a DevNexus decision about which work should be done.

## Avoided Aliases

- Do not treat "project" as an alias for one repository, one source checkout, one work-item service, or one component.
- Do not treat a plugin as owning a DevNexus project, replacing the generic core, or acting as an alternate runner.
- Do not describe DevNexus as choosing or supervising implementation work; agents do that after DevNexus launches them with context.
- Prefer "work-item service" or "work tracking provider" over "board" when the provider can be issue-based, project-based, or local.
