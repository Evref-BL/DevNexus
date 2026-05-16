# DevNexus

DevNexus is a generic development orchestration core.

It owns project and work tracking, local work items, agent launch
configuration, execution metadata, verification records, credential-aware forge
integration, and publication handoff across language ecosystems.

A DevNexus project is a managed orchestration context containing one or more
components. A component is the unit that points at a source root, optional Git
remote, worktree root, work-item service, verification hints, publication
hints, and relationships to other components. Component arity can be one or
many; a project with one component follows the same model as a project with
several components.

DevNexus is not the work-planning agent. It should not decide which work item
to implement, supervise the implementation, or plan parallel worktrees itself.
A user drives DevNexus by configuring projects, schedules, launch policies, and
agent commands. A user can be a human or an agent acting under human
instruction. DevNexus executes that infrastructure and schedule by launching a
configured agent such as Codex or Claude in a prepared project context. The
launched agent chooses the work item or items, creates and coordinates Git
worktrees when useful, verifies the result, and reports commits, publication,
blockers, and notes back through DevNexus-owned records. DevNexus can relaunch
the agent while eligible work remains when the user has configured that
behavior.

For example, a human can tell Codex to use DevNexus to work on a project until
no eligible issue remains. In that flow, Codex is the user of DevNexus under
human instruction; DevNexus supplies the configured launch gates, schedule,
component context, relaunch loop, and run records.

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

## Project Components

`dev-nexus.project.json` stores `components` as a first-class list. Each
component has a stable `id`, display `name`, `role`, `kind`, source root,
worktree root, optional work tracking configuration, optional verification and
publication hints, and explicit relationships to other components.

The primary component is the compatibility anchor for legacy commands that can
operate on only one component. New automation and project status surfaces expose
all configured components, including each component's source root and whether
that root exists. Component worktrees default under
`<project worktreesRoot>/<component-id>` so arity one is not a special
directory case.

Work tracking is component-scoped. Older project-level `workTracking` remains
accepted for legacy configs and is normalized onto the generated primary
component, but explicit multi-component configs should put the work-item
service on the component that owns those items. A component can use a local
store, GitHub Issues, GitHub Projects, GitLab issues, Jira, or another
configured provider as those adapters become available.

Example:

```json
{
  "version": 1,
  "id": "example-suite",
  "name": "Example Suite",
  "repo": {
    "kind": "local",
    "remoteUrl": null,
    "defaultBranch": null
  },
  "components": [
    {
      "id": "core",
      "name": "Core",
      "kind": "git",
      "role": "primary",
      "remoteUrl": "git@example.invalid:example/core.git",
      "defaultBranch": "main",
      "sourceRoot": "components/core",
      "workTracking": {
        "provider": "github",
        "repository": {
          "owner": "example",
          "name": "core"
        }
      },
      "relationships": []
    },
    {
      "id": "addon",
      "name": "Addon",
      "kind": "git",
      "role": "addon",
      "remoteUrl": "git@example.invalid:example/addon.git",
      "defaultBranch": "main",
      "sourceRoot": "components/addon",
      "workTracking": {
        "provider": "jira",
        "host": "example.atlassian.net",
        "projectKey": "ADDON"
      },
      "relationships": [
        {
          "kind": "extends",
          "componentId": "core"
        }
      ]
    }
  ],
  "worktreesRoot": "worktrees",
  "kanban": {
    "provider": "vibe-kanban",
    "projectId": null
  }
}
```

## Automation Foundation

Projects can opt into generic agent-launch automation through
`dev-nexus.project.json`. The core schema covers user-configured launch gates,
verification hints, run ledgers, stale-aware locks, retry backoff, safety
policy, and publication policy. These APIs model launch state and record what
the agent reports; execution adapters decide how to start agents and tools for
a project.

The configured automation selector is a user-authored launch gate and context
filter. It can decide whether the user's configured conditions for launching an
agent are met, but it is not a mandate for DevNexus to choose the task. The
launched agent must inspect the tracker context, choose the work item or items
to take, decide whether parallel Git worktrees are useful, and supervise
implementation through verification and publication.

`automation.mode: "agent_launch"` uses the launch-only boundary. DevNexus
checks the selector as an eligibility gate, writes an agent context file under
the project `.dev-nexus/automation` state directory, starts
`automation.agent.command`, and records the result reported by the agent. The
agent receives `DEV_NEXUS_AGENT_CONTEXT_FILE` and
`DEV_NEXUS_AGENT_RESULT_FILE`; it can write status, summary, commits,
verification records, publication decisions, blockers, and notes to the result
file for DevNexus to retain in the run ledger.

The agent context includes `components` and `componentEligibleWorkItems`.
DevNexus groups eligible work items by component and does not collapse that
grouping into a decision. The launched agent can then decide which component
work items to take, how many subagents to launch, what model and reasoning
profile each subagent should use, and how to report progress back to each
component's work-item service.

The same context also includes the configured automation `target` and `agent`
policy. `automation.target` carries the user-requested objective, the
project-relative target-state Markdown file, optional cycle and work-item
bounds, and the stop condition for no remaining eligible work. Agents should
keep that target-state file concise: retain current direction, active
decisions, blockers, and near-term risks, and drop stale detail as the target
evolves. `automation.agent.maxConcurrentSubagents` caps parallel subagent
work, and `automation.agent.profiles` names the executor/model/reasoning
profiles that a launched agent may assign to subagents.

`runNexusAutomationOnce` remains available for older local command smokes that
prepare one generated worktree and run `automation.executor.command`. That
selected-work path is interim. New automation work should prefer
`runNexusAutomationAgentLaunchOnce`: DevNexus prepares safe context, starts the
configured agent when the user-requested or scheduled launch policy fires, can
relaunch while eligible work remains when the user has configured that
behavior, and records the agent's reported result.

Generated worktrees can declare setup-only dependency links through
`automation.setup.dependencyLinks`. Each link copies no package data and runs
no installer; it only links an existing reviewed path from the active component
source root into the generated worktree and records the target in the worktree
Git exclude file. Required links are checked during read-only status so unsafe
or missing dependencies block before worktree creation.

The package also ships a generic `dev-nexus` CLI for the same boundary:

```bash
dev-nexus work-item create <project-root> --title "Implement task" --status ready --label automation
dev-nexus work-item list <project-root> --status ready
dev-nexus work-item get <project-root> local-1
dev-nexus work-item update <project-root> local-1 --status in_progress
dev-nexus work-item comment <project-root> local-1 --body "Started focused verification."
dev-nexus automation status <project-root>
dev-nexus automation enqueue <project-root> --title "Implement task"
dev-nexus automation run-once <project-root> --command "codex exec <prompt-or-script>"
dev-nexus automation schedule <project-root> --command "codex exec <prompt-or-script>" --max-runs 1
```

Projects can also store the shell command under `automation.agent.command` for
agent-launch mode or `automation.executor.command` for the older generated
worktree executor mode. `automation run-once` and `automation schedule` may
omit `--command` when the relevant command is configured. Command-line options
still override the configured command and timeout.

Manual `work-item` commands currently target the primary component's work-item
service. Agent-launch automation is the component-aware path for reading
eligible work across all configured component services.

`automation status` is read-only. It reports whether automation is disabled,
locked, in retry backoff, blocked by preflight, idle, or ready to launch an
agent under the user-configured launch policy before any worktree or tracker
mutation happens.

`automation enqueue` creates a work item that matches the configured automation
launch filter. It derives the default status, labels, and assignees from
`automation.selector`, lets callers add extra labels or assignees, and refuses
inputs that would be invisible to the configured agent-launch loop.

`automation run-once` runs the configured command with `DEV_NEXUS_*`
environment variables for project context and writes the retained run ledger.
In agent-launch mode, no work item is selected and no generated worktree is
prepared by DevNexus; the target command launches an agent with enough context
to make its own work-selection and supervision decisions.

`automation schedule` repeatedly checks the same read-only status boundary and
dispatches `automation run-once` only when the project is ready. It honors
project `automation.schedule.intervalMs`, waits until active locks or retry
backoff expire, and supports `--max-ticks` or `--max-runs` for bounded local
smokes and supervised runners.

## Curated Skills

DevNexus keeps reviewed skill definitions under its managed project support
directory, `.dev-nexus/skills`, as DevNexus-owned state. That directory is not
the agent-facing install location. Projects can also configure
`skills.agentTargets` so DevNexus projects selected skills into agent-native
directories:

- `codex` -> `.agents/skills/<skill-id>/SKILL.md`
- `claude` -> `.claude/skills/<skill-id>/SKILL.md`

This keeps DevNexus responsible for curated, pinned skill material while the
configured agents load skills from the locations they actually understand.
The default core pack includes:

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

For DevNexus dogfooding, `to-issues` is the intended bridge from a target plan
to tracker-backed execution. A human or launched agent can use the skill to
split the current target plan into component-owned issues, mark which issues
are autonomous agent-ready (AFK), and then let DevNexus relaunch agents while
eligible work remains under the configured target and subagent caps.
