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
extensions or plugins. DevNexus provides the core contracts and hooks without
depending on any specific specialization. Plugins are additive capability
declarations: they can describe setup policy, projected skills, MCP servers
and tools, dependency projections, environment hints, cleanup hooks, worker
context or briefing fragments, and agent affordances, but they do not own the
project or replace the generic coordinator launch boundary.

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
dev-nexus project mcp refresh <project-root> --agent codex --agent claude
dev-nexus project tracker configure <project> --home <home-path> --provider local
dev-nexus project tracker link <project> --home <home-path> --tracker-project-id <id>
dev-nexus setup list
dev-nexus setup plan <project-root> join-existing-project --platform macos
dev-nexus setup check <project-root> join-existing-project --platform macos
dev-nexus mcp-stdio
```

Commands that need a registry use `--home`; when it is omitted they fall back
to `DEV_NEXUS_HOME` and then the default user home path. `project status` can
also inspect an initialized project root directly without a home registry,
which is useful for local smoke checks and generated worktrees.

## Guided Setup

DevNexus includes a guided setup assistant for first-machine setup and for
joining an existing shared DevNexus meta project on another host. The setup
assistant reads `dev-nexus.project.json`, produces host-local steps, and records
progress under `.dev-nexus/host-setup/` instead of mutating shared project
configuration with machine-local secrets or paths.

For a Mac joining an existing project:

```bash
dev-nexus setup plan <project-root> join-existing-project --platform macos
dev-nexus setup check <project-root> join-existing-project --platform macos
```

The plan covers prerequisite installs, human GitHub authentication, isolated
automation authentication, meta-project remotes, component checkouts, MCP
refresh, skill projection, and final preflight. When shared project metadata
contains OS-local source roots from another machine, the Mac plan uses
host-local placeholders and the check reports the component path configuration
as blocked instead of treating the other machine's path as valid.

## Project Template Shape

The generic project scaffold separates project-owned support state from
component source and local runtime records. A new or refreshed project writes a
generated `.dev-nexus/README.md` that describes the active layout in the same
terms used by the code:

| Area | Typical paths | Owner |
| --- | --- | --- |
| Component configuration | `dev-nexus.project.json`, component `sourceRoot` paths | User-authored source |
| Project state | `.dev-nexus/README.md`, component worktree roots under `<worktreesRoot>/<component-id>/` | Generated support or local runtime |
| Target state | `automation.target.statePath`, defaulting to `.dev-nexus/automation/target-state.md` | User-authored target memory, not overwritten by refresh |
| Skills | `.dev-nexus/skills/`, optional `.agents/skills/` or `.claude/skills/` projections | Generated from curated or extension skill definitions |
| Plugin capabilities | `dev-nexus.project.json` `plugins` records | User-authored additive capability metadata projected into agent context |
| Agent MCP projection | `.codex/config.toml`, `.mcp.json`, or configured agent target paths | Generated from `mcp.agentTargets` |

Component worktree roots are component-scoped even when a project has one
component, so arity one uses the same `<worktreesRoot>/<component-id>/` shape as
larger projects. Scaffold refreshes create missing component worktree
directories and seed a missing target-state file when automation is configured,
but existing target state is preserved.

Migration notes treat historical staging roots as migration-only evidence.
Production templates should not inherit source-specific paths, tracker ids,
component names, or launch commands from those roots. Generated support state
may be refreshed by DevNexus, user-authored state records durable project
intent, and local runtime state covers locks, ledgers, local tracker files,
agent launch records, and generated worktrees.

## MCP Server

DevNexus exposes a generic stdio Model Context Protocol (MCP) server for
agents:

```bash
dev-nexus mcp-stdio
```

Agent configuration should register that command as a project-local MCP server
when the agent needs direct DevNexus tools. The first native server slice
intentionally covers the core self-use loop: read project status, read
automation readiness and target context, and create/list/get/update/comment
work items through the configured work tracker. It can also record
caller-reported target cycle facts so the next launch can reason from durable
state instead of chat memory, then build a factual target report from those
records. It does not choose work or launch subagents itself; those decisions
remain with the human or launched coordinator agent.

The native MCP tools are:

```text
project_status
automation_status
eligible_work
agent_profiles
setup_flow_list
setup_plan
setup_check
setup_record
target_cycle_list
target_cycle_record
target_report
current_agent_adopt
current_agent_record
coordination_status
coordination_handoff
coordination_integrate
coordination_request
work_item_create
work_item_list
work_item_get
work_item_update
work_item_comment
work_item_set_status
```

Work-item tools accept `componentId` when a project has multiple component
trackers. Omitting it preserves the compatibility behavior and uses the
primary component.

Projects can still use the CLI for the same boundaries. The MCP server exists
so agents can use DevNexus directly without depending on a specialization
adapter for generic project orchestration.

## Shared Coordination

DevNexus exposes advisory coordination tools for parallel agents working from
Git worktrees. The tools record durable handoff facts in the configured
component work-item service and read Git state, but they do not choose or
supervise implementation work.

```bash
dev-nexus coordination status <project-root> --work-item local-1 --worktree <path>
dev-nexus coordination handoff <project-root> local-1 --status ready --worktree <path>
dev-nexus coordination integrate <project-root> --work-item local-1 --target-branch main --worktree <path>
```

`coordination integrate` builds a read-only plan from related handoff branches,
recorded decisions, `git merge-base`, `git merge-tree`, changed files, and
range-diff output when useful. `--fetch` fetches the configured remote only
when project automation safety explicitly allows host mutation.

Project-local agent configuration can be generated with:

```bash
dev-nexus project mcp refresh <project-root> --agent codex
```

or through project configuration:

```json
{
  "mcp": {
    "agentTargets": [
      { "agent": "codex" },
      { "agent": "claude", "sourceControl": "source" }
    ]
  }
}
```

The Codex target writes or updates `.codex/config.toml` with a
`dev_nexus` stdio server. The Claude target writes or updates project
`.mcp.json`. Generated support config is excluded from Git by default;
set `sourceControl` to `source` when the project should commit the agent MCP
configuration.

## Plugin Capabilities

`dev-nexus.project.json` can include a `plugins` array. A project may configure
more than one plugin, and each enabled plugin contributes additive capability
records. DevNexus core keeps those records generic and projects them into the
agent launch context plus the low-token `agent_profiles` MCP/CLI surface as
`pluginCapabilities`.

Supported capability record kinds are:

- `projected_skill`: a skill id and optional target agents.
- `mcp_server`: an MCP server name plus optional tool names and descriptions.
- `setup_obligation`: setup policy the coordinator should account for before work.
- `environment_hint`: environment variables or paths relevant to plugin tools.
- `cleanup_hook`: cleanup policy to consider after plugin-assisted work.
- `agent_affordance`: a concise capability or interaction the plugin makes available.
- `dependency_projection`: setup-only links from a component source root into a
  generated worker worktree, such as already-reviewed toolchain dependencies.
- `worker_context_fragment`: bounded advisory context rendered into generated worker `context.json`.
- `worker_briefing_fragment`: bounded advisory Markdown rendered into generated worker `briefing.md`.

Example:

```json
{
  "plugins": [
    {
      "id": "analysis-tools",
      "name": "Analysis Tools",
      "version": "0.1.0",
      "capabilities": [
        {
          "kind": "projected_skill",
          "id": "deep-review-skill",
          "skillId": "deep-review",
          "targetAgents": ["codex"]
        },
        {
          "kind": "mcp_server",
          "id": "analysis-mcp",
          "serverName": "analysis_tools",
          "tools": [
            {
              "name": "inspect_facts",
              "description": "Read plugin-supplied facts."
            }
          ]
        }
      ]
    },
    {
      "id": "workspace-policy",
      "capabilities": [
        {
          "kind": "setup_obligation",
          "id": "review-local-docs",
          "description": "Review project-local setup notes before editing.",
          "required": true
        },
        {
          "kind": "cleanup_hook",
          "id": "remove-temporary-cache",
          "description": "Remove temporary cache files created by plugin tools.",
          "trigger": "after_run"
        },
        {
          "kind": "dependency_projection",
          "id": "node-modules",
          "source": "node_modules",
          "target": "node_modules",
          "required": false,
          "sourceControl": "support",
          "reason": "Resolve local npm binaries from generated worker worktrees."
        },
        {
          "kind": "worker_briefing_fragment",
          "id": "review-workspace-policy",
          "title": "Workspace Policy",
          "body": "Read the workspace policy before using plugin-provided tools.",
          "provenance": "workspace-policy plugin manifest",
          "targetAgents": ["codex"],
          "targetComponents": ["core"]
        }
      ]
    }
  ]
}
```

Plugin records are not runners and do not select implementation work. They are
available capability and setup-policy facts for the launched coordinator. The
coordinator still chooses the work item batch, decides how many subagents to
run, assigns profiles, supervises implementation, and reports durable facts
back through DevNexus.

Worker fragment title, body, and provenance fields are bounded by the project
config schema so generated worker files stay concise. Enabled fragment
projection is deterministic: DevNexus filters component-targeted fragments to
the prepared worker component, filters agent-targeted fragments when the active
agent is known, and then orders fragments by plugin id, fragment id, kind, and
provenance. Duplicate fragment ids from different plugins are retained rather
than merged or overridden; each rendered fragment carries source plugin,
capability id, and provenance. Duplicate capability ids inside one plugin are
still rejected by project config validation.

## Project Components

`dev-nexus.project.json` stores `components` as a first-class list. Each
component has a stable `id`, display `name`, `role`, `kind`, source root,
worktree root, optional work tracking configuration, optional verification and
publication hints, and explicit relationships to other components.

The primary component is the compatibility anchor for legacy commands that can
operate on only one component. New automation and project status surfaces expose
all configured components, including each component's source root and whether
that root exists. Components with work tracking also expose raw provider
capability flags and an action-oriented `workTrackingCapabilityReport` so a
coordinator agent can see whether a component tracker can list, create, get,
update, comment, manage labels, manage assignees, use milestones, use a board,
or update board status before choosing a workflow. `boardStatus` means a
configured board or workflow status field can be synchronized; a provider can
still update neutral item status without claiming board-status support.
Component worktrees default under
`<project worktreesRoot>/<component-id>` so arity one is not a special
directory case.

Launched agents should treat each component as an independent source and
tracking boundary. The launch context reports the component `sourceRoot`,
`worktreesRoot`, Git defaults, relationships, and tracker capability flags so
an agent can decide whether to work in the active checkout or create its own
component worktree. When an agent takes work across components, it should keep
branches and generated worktrees component-scoped, check for unrelated dirty
state before editing, and report per-component progress through that
component's work-item service. In `agent_launch` mode DevNexus does not create
those implementation worktrees for the agent.

For parallel implementation work, coordinators should pick one component-owned
work item, inspect that component's `sourceRoot` for unrelated dirty state, and
then either work in that checkout or prepare a generated Git worktree under that
component's `worktreesRoot`. Prepared worktree records carry the component id,
source root, component worktrees root, generated worktree path, branch, base ref,
and owning work item id/title. A generated path is valid only when it resolves
inside the component `worktreesRoot`; path-like worktree names are rejected so a
parallel branch cannot escape into another component's tree. Agents should write
or update worktree execution metadata in the generated worktree as verification,
commit, and publication facts become known.

Work tracking is component-scoped. Older project-level `workTracking` remains
accepted for legacy configs and is normalized onto the generated primary
component, but explicit multi-component configs should put the work-item
service on the component that owns those items. A component can use a local
store, GitHub Issues, GitHub Projects, GitLab issues, Jira, or another
configured provider as those adapters become available.

CLI work-item commands accept `--component <component-id>` for component-owned
trackers and default to the primary component when the option is omitted.

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
the project `.dev-nexus/automation` state directory, starts the configured
agent command, and records the result reported by the agent. The
agent receives `DEV_NEXUS_AGENT_CONTEXT_FILE` and
`DEV_NEXUS_AGENT_RESULT_FILE`. A successful agent command must write valid
JSON to that result path before exiting; otherwise DevNexus records the launch
as failed. The required fields are `status` and `summary`. Optional fields are
`commitIds`, `verification`, `publicationDecision`, and `error`.
The context also carries a `result` contract with the exact result file path,
required fields, optional fields, allowed launch statuses, verification
statuses, and publication decision types. The same required and optional field
lists are exposed in `DEV_NEXUS_AGENT_RESULT_REQUIRED_FIELDS` and
`DEV_NEXUS_AGENT_RESULT_OPTIONAL_FIELDS`.

Current-agent adoption uses the same context and result-file contract without
starting a child coordinator process. `automation current-agent adopt` creates
or reuses the launch context, keeps the DevNexus run lock for the already
running coordinator, and returns the `DEV_NEXUS_*` environment values that a
launched process would have received. The current coordinator then records the
terminal result with `automation current-agent record` or the MCP
`current_agent_record` tool. Adoption result statuses are `completed`,
`blocked`, `failed`, and `skipped`; verification records, commit ids, and
publication decisions are recorded into the same automation run ledger.

```json
{
  "status": "completed",
  "summary": "Agent reported completion",
  "commitIds": [],
  "verification": [],
  "publicationDecision": {
    "type": "direct_integration",
    "remote": "origin",
    "targetBranch": "main",
    "reason": "Published verified source change."
  },
  "error": null
}
```

The agent context includes `components` and `componentEligibleWorkItems`.
DevNexus groups eligible work items by component and does not collapse that
grouping into a decision. The launched agent can then decide which component
work items to take, how many subagents to launch, what model and reasoning
profile each subagent should use, and how to report progress back to each
component's work-item service.

The same context also includes the configured automation `target`, `agent`
policy, and enabled `pluginCapabilities`. `automation.target` carries the
user-requested objective, the project-relative target-state Markdown file,
optional cycle and work-item bounds, and the stop condition for no remaining
eligible work. Agents should keep that target-state file concise: retain
current direction, active decisions, blockers, and near-term risks, and drop
stale detail as the target evolves. `automation.agent.maxConcurrentSubagents`
caps parallel subagent work, and `automation.agent.profiles` names the
executor/model/version or variant/reasoning or intelligence/safety profiles
that a launched agent may assign to subagents.
`automation.agent.coordinatorProfileId` may name one of those profiles as the
coordinator launch profile. A profile can carry `command` and `args`; DevNexus
uses that executable template when no raw `automation.agent.command` or CLI
`--command` override is provided. A coordinator profile must be launch-capable:
its `intendedUse` must be `coordinator` or `any`, and it must include a
`command` when it is selected by `coordinatorProfileId`. `intendedUse` defaults
to `any` for existing profile configs. Profile `safety` overrides the project
automation safety posture for that profile only; otherwise profiles inherit
`automation.safety`. The profile and subagent cap settings still describe
infrastructure policy. DevNexus exposes the normalized policy to the launched
coordinator, but the coordinator remains responsible for reading the context,
choosing work, assigning subagent profiles, and reporting facts back to
DevNexus.

`automation.target.cycleLedgerPath` stores the target cycle ledger, defaulting
to `.dev-nexus/automation/target-cycles.json`. A launched coordinator agent
can record `started`, `dispatched`, `completed`, `blocked`, `failed`, or
`skipped` cycle facts through `target_cycle_record` or the CLI. These records
are factual caller reports: DevNexus stores the run id, target id, component
work item refs, per-item progress states, agent profile ids, bounded notes,
blockers, and summary, but it still does not decide which work should be
selected or supervise subagents. Work item progress states can be `selected`,
`dispatched`, `in_progress`, `completed`, `blocked`, or `skipped`; item and
cycle notes are capped at 1000 characters each so the durable ledger stays
concise. `automation status` reads the same ledger and exposes cycle counts
plus the latest cycle.

`target_report` and `automation target-report` build read-only factual JSON
from the target context, target cycle ledger, automation run ledger, recorded
work item refs, blockers, and notes. The report status is derived from the
latest recorded target cycle when present, otherwise the latest automation run.
The report also includes a `relaunchDecision` field with one of `relaunch`,
`stop`, `wait`, `report_blocked`, `report_failed`, or `not_ready`, based on
the latest recorded cycle status, recorded eligible work count, target stop
policy, and relaunch policy. It is intended for final user reporting and
relaunch decisions by a human or coordinator agent. It avoids live external
tracker calls, may read configured local work-item stores to fill missing
titles/statuses, and does not infer hidden work state. Component progress,
active blockers, commits, verification records, and publication decisions are
summarized only from durable cycle/run facts and locally recorded work-item
state.

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

Enabled plugins can contribute the same setup behavior through
`dependency_projection` capabilities. DevNexus lowers those plugin records into
worker setup, applies component and agent targeting, links existing dependency
paths without running installers, and records projection status in both the
setup result and generated worker context. `sourceControl: "support"` excludes
the projected target from the worker checkout's Git state; `"source"` leaves it
visible when a project intentionally wants the target committed.

Dependency-link setup also treats the component worktrees root as a safety
boundary when provided: the target worktree path must remain inside that root
before any link is created. This keeps shared dependencies scoped to the
component worktree that the coordinator selected.

Generated component worktrees also receive a DevNexus-owned worker context
bundle under `.dev-nexus/context/`. The bundle contains machine-readable
`context.json` ownership and project metadata plus an agent-readable
`briefing.md`. DevNexus generates these bundle files for the worker checkout
instead of copying root `AGENTS.md`, `PLAN.md`, or automation target-state
files into the component source tree. The generated context directory is
excluded from Git along with any setup-only dependency links.

Enabled plugin worker fragments are projected into the same support files
without DevNexus depending on plugin-specific terms. Context fragments appear
under `pluginFragments.context` in `context.json`. Briefing fragments appear
under `pluginFragments.briefing` and are rendered into `briefing.md` with their
source and provenance. These fragments are advisory setup/context only: they do
not select work, launch subagents, or supervise implementation.

The context bundle does not move command roots. Source edits, verification
commands, and Git commands still run from the component checkout root. DevNexus
project commands continue to use the configured project root when they need
project-owned state such as automation ledgers or target records.

The package also ships a generic `dev-nexus` CLI for the same boundary:

```bash
dev-nexus automation eligible-work <project-root> --json
dev-nexus automation agent-profiles <project-root> --json
dev-nexus automation target-report <project-root> --json
dev-nexus work-item update <project-root> local-1 --component core --status in_progress
dev-nexus work-item comment <project-root> local-1 --component core --body "Started focused verification."
dev-nexus automation target-cycle record <project-root> --status completed --work-item core:local-1 --eligible-work-items 0
dev-nexus automation target-cycle record <project-root> --status dispatched --work-item core:local-1 --work-item-status dispatched --work-item-agent-profile codex-local --work-item-note "Subagent launched."
dev-nexus work-item create <project-root> --title "Implement task" --status ready --label automation
dev-nexus work-item list <project-root> --status ready
dev-nexus work-item get <project-root> local-1
dev-nexus work-item update <project-root> local-1 --status in_progress
dev-nexus work-item comment <project-root> local-1 --body "Started focused verification."
dev-nexus automation status <project-root>
dev-nexus automation enqueue <project-root> --title "Implement task"
dev-nexus automation target-cycle record <project-root> --status dispatched --work-item primary:local-1
dev-nexus automation target-cycle list <project-root>
dev-nexus automation target-report <project-root> --json
dev-nexus automation run-once <project-root> --command "codex exec <prompt-or-script>"
dev-nexus automation schedule <project-root> --command "codex exec <prompt-or-script>" --max-runs 1
dev-nexus automation coordinator-loop <project-root> --command "codex exec <prompt-or-script>" --max-runs 1
dev-nexus automation current-agent adopt <project-root> --run-id current-1 --json
dev-nexus automation current-agent record <project-root> --run-id current-1 --status completed --summary "Coordinator completed."
dev-nexus automation coordinator-loop <project-root> --adopt-current --run-id-prefix heartbeat --json
```

For `automation target-cycle record`, `--work-item-status`,
`--work-item-agent-profile`, and `--work-item-note` apply to the most recent
`--work-item` argument. They record what the coordinator reports; DevNexus does
not assign profiles, launch implementation subagents, or supervise their work.

For a low-token coordinator cycle, start with `automation eligible-work --json`
and `automation agent-profiles --json`, then use component-scoped `work-item`
and `target-cycle` commands to record the work the coordinator chose. The
full `automation status --json` remains available when the agent needs the
complete target context. `automation agent-profiles --json` includes enabled
`pluginCapabilities`, so coordinators can see generic plugin-provided skills,
MCP tools, setup obligations, dependency projections, environment hints,
cleanup hooks, and affordances without reading the full project config.

Projects can also store the shell command under `automation.agent.command` for
agent-launch mode or `automation.executor.command` for the older generated
worktree executor mode. For agent-launch mode, projects may instead set
`automation.agent.coordinatorProfileId` to a profile with `command` and
`args`. `automation run-once`, `automation schedule`, and
`automation coordinator-loop` may omit `--command` when the relevant command
source is configured. Command-line options still override the configured
command and timeout.

Profile selection is infrastructure policy, not work supervision. A
coordinator may use `automation.agent.profiles` and
`automation.agent.maxConcurrentSubagents` to decide how many subagents to run
and which executor/model/safety profile each one should receive, but DevNexus
does not select the work item batch or supervise subagent execution.

Manual `work-item` commands accept `--component <component-id>` for
component-owned work-item services. Omitting it targets the primary component
for compatibility. Agent-launch automation reads eligible work across all
configured component services.

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
to make its own work-selection and supervision decisions. Use this when
DevNexus should start a coordinator process.

`automation current-agent adopt` is the no-spawn counterpart for an
already-running coordinator, such as a Codex heartbeat or a restricted host
process. It returns `shouldProceed`, the context file, result file, result
contract, and environment map. If `shouldProceed` is false, the current agent
must not continue the automation run. If it is true, the agent may proceed
under the returned `DEV_NEXUS_MAX_CONCURRENT_SUBAGENTS` cap and must call
`automation current-agent record` or `current_agent_record` before yielding the
run.

`automation schedule` repeatedly checks the same read-only status boundary and
dispatches `automation run-once` only when the project is ready. It honors
project `automation.schedule.intervalMs`, waits until active locks or retry
backoff expire, and supports `--max-ticks` or `--max-runs` for bounded local
smokes and supervised runners.

`automation coordinator-loop` is the DevNexus-owned agent-launch service mode.
It records target-cycle decisions for no-work, lock, backoff, blocked, launch,
completion, and failure outcomes, and launches a coordinator only when the
project is ready. External schedulers can wake this command while DevNexus
keeps the durable wait/skip/launch policy in project state. With
`--adopt-current`, the same coordinator-loop gate records the wait/skip/block
or dispatched target-cycle facts and returns current-agent adoption context
instead of launching the configured coordinator command. This is the scheduler
safe path for hosts that can wake DevNexus but must avoid nested model
execution.

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

Prepared component worktrees receive their own generated agent-native skill
projection when `skills.agentTargets` is configured. DevNexus refreshes those
worker-local paths, such as `.agents/skills/`, from the project-managed
`.dev-nexus/skills` source and excludes them from the component worktree Git
index by default.
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
