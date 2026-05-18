# Agent Target Projection Opt-In Product Requirements Document (PRD)

## Problem

DevNexus projects can project Model Context Protocol (MCP) configuration,
skills, plugin fragments, and worker support files into agent-native locations
such as Codex or Claude directories. That is useful when a project actively
uses those agent providers. It is noisy when a project only uses one provider
but receives generated artifacts for another provider.

The dogfood project exposed this clearly. The project is currently operated
through Codex, and its MCP projection is configured only for Codex. However,
its skill projection configuration includes both Codex and Claude targets, so
DevNexus materialized a `.claude/skills` support directory. The directory is
ignored generated support state, not tracked source, but it still pollutes the
project root and gives a false signal that Claude is part of the active
workflow.

Users should not have to know every provider DevNexus supports, and DevNexus
should not generate provider-specific files unless the project or setup flow
explicitly selects that provider. Agent target projection should be an opt-in
project capability.

## Goals

- Make active agent providers explicit in project configuration and setup
  flows.
- Project only the MCP, skills, plugin fragments, worker context, and support
  files needed by selected agent providers.
- Keep generated provider support state out of source control unless a project
  explicitly asks for source-controlled projection.
- Report stale or unexpected provider-native directories, such as a Claude
  skills projection in a Codex-only project.
- Provide a safe cleanup path for generated support state that is no longer
  selected.
- Keep DevNexus provider-neutral: Codex, Claude, OpenCode, and future providers
  use the same target-selection model.
- Preserve multi-provider projects when users intentionally configure more than
  one active agent target.

## Non-Goals

- Do not remove support for Claude, OpenCode, or other providers.
- Do not make Codex the universal default for all projects.
- Do not delete user-authored or source-controlled provider files
  automatically.
- Do not edit provider-global state, credentials, app databases, or user-global
  skill directories.
- Do not require a provider to support both MCP and skills before it can be an
  active target.
- Do not make plugins decide which implementation agent should be used.

## Current State

DevNexus already has separate concepts for MCP projection and skill projection.
MCP projection has agent targets, and the dogfood project currently declares a
Codex MCP target only. Skill projection also has agent targets, and the
dogfood project currently declares both Codex and Claude skill targets. As a
result, DevNexus generates `.agents/skills` for Codex and `.claude/skills` for
Claude.

Plugin capability records can also name target agents. DevNexus filters plugin
fragments and projected skills by those targets, but the project-level enabled
provider set is not treated as the central source of truth for all generated
agent-native outputs.

Generated project-managed skills and agent-native projections are support
state and are ignored by Git in the dogfood project. That prevents source
pollution, but it does not prevent root-directory clutter or misleading
provider signals.

## Users

- A DevNexus project owner who wants a clean Codex-only, Claude-only, OpenCode,
  or multi-provider project.
- A new-machine setup user joining an existing DevNexus project.
- A coordinator agent checking whether the current provider has the expected
  MCP and skill surfaces.
- A plugin author contributing provider-specific setup fragments.
- A worker agent running inside a generated component worktree.

## User Stories

- As a Codex-only project owner, I can configure DevNexus so only Codex-native
  project files are generated.
- As a Claude user, I can opt into Claude projections without receiving Codex
  files unless I also select Codex.
- As a multi-provider team, we can explicitly select Codex and Claude and get
  both projections intentionally.
- As a new-machine setup user, I can choose the agent provider I will use on
  this machine and avoid generating unused provider files.
- As a coordinator agent, I can see whether a provider-native directory is
  expected, stale generated support, or manually authored.
- As a plugin author, I can declare target-compatible capabilities without
  forcing every compatible provider to be materialized.

## Product Model

DevNexus should distinguish supported providers from active project targets.

Supported providers are the providers DevNexus knows how to configure, such as
Codex, Claude, OpenCode, or manual/custom providers.

Active agent targets are the providers selected by the project or host-local
setup flow for generated outputs. Active targets should be explicit and should
drive all provider-native projections.

Projection types:

- MCP configuration projection.
- Skill projection.
- Plugin-provided projected skills.
- Plugin-provided MCP server entries or manual setup notes.
- Worker context and generated worktree support files.
- Provider-specific setup checks and readiness summaries.

Each projection type may have provider-specific details, but it should be
filtered through the active agent target set before generating files.

## Configuration Direction

The project should support one explicit agent target policy that can be reused
by MCP, skills, plugins, setup checks, and worker preparation.

Conceptual shape:

- A project declares active agent targets, such as Codex only, Claude only,
  OpenCode only, or Codex plus Claude.
- Each active target has provider id, enabled state, optional MCP config
  settings, optional skill projection settings, source-control policy, and
  setup notes.
- MCP and skills can still override details per target, but they should not
  create targets outside the active set unless explicitly configured to do so.
- Plugin capabilities can declare compatibility with target agents. DevNexus
  materializes them only for active targets that match the capability.
- Host-local setup can temporarily select a provider for one machine when the
  shared project allows host-local target selection.

Recommended default:

- New projects should start with the provider chosen during setup.
- Existing projects without explicit target policy should preserve current
  behavior through compatibility normalization, but setup should recommend
  writing an explicit active target set.
- A provider-native projection directory that is no longer selected should be
  reported as stale generated support, not silently kept as if it were active.

## Setup And Cleanup Behavior

Setup and refresh commands should make provider projection explicit.

Expected behavior:

- Setup asks or infers which provider is active for this machine when creating
  or joining a project.
- `project mcp refresh` and skill refresh use the active target set by default.
- Passing an explicit provider target refreshes only that provider unless the
  command requests all configured targets.
- Setup checks report missing expected projections and unexpected stale
  projections.
- Cleanup can remove stale generated support directories after confirming they
  are ignored/generated support state.
- Cleanup refuses to remove source-controlled, unknown, or manually authored
  provider files without explicit user approval.

For the dogfood project, the desired current policy is Codex-only until another
provider is intentionally added. Under that policy, `.agents/skills` and
`.codex/config.toml` are expected generated support, while `.claude/skills` is
stale generated support that can be safely removed after configuration is
updated.

## User-Facing Surfaces

### Project Status

Project status should summarize:

- Active agent targets.
- Expected MCP config files per target.
- Expected skill projection directories per target.
- Plugin capabilities selected for each target.
- Stale generated provider directories.
- Unsupported or manual provider targets and their setup notes.

### Setup Check

Setup check should distinguish:

- Expected and present projection.
- Expected but missing projection.
- Present but no longer selected generated support.
- Present and manually authored provider files.
- Unsupported provider target.
- Provider selected locally but not allowed by shared project policy.

### Agent Context

Generated agent context should only describe projections relevant to the
current agent target and shared project-managed skill roots. It should not list
irrelevant provider-native directories as if they were part of the active
workflow.

### Documentation

Documentation should explain:

- Supported provider versus active target.
- Codex-only, Claude-only, OpenCode/custom, and multi-provider examples.
- How to add a provider later.
- How to remove stale generated provider support.
- How to keep provider-global credentials and host-local settings out of the
  shared project.

## Implementation Decisions

- DevNexus core owns active target selection and projection filtering.
- Provider adapters own file formats, default paths, trust settings, and
  provider-specific activation notes.
- Plugins declare compatible target agents, not mandatory target agents.
- Stale generated support should be detected using projection manifests,
  known ignored paths, or generated markers where available.
- Compatibility normalization should avoid breaking existing projects that
  already configured multiple target lists.
- Cleanup should be deliberate and bounded to generated support state.
- The dogfood project should be migrated to an explicit Codex-only target set
  once the behavior is available.

## Testing Decisions

- Unit-test a Codex-only project: no Claude directories are generated.
- Unit-test a Claude-only project: no Codex directories are generated unless
  explicitly selected.
- Unit-test a multi-provider project: both configured targets are generated.
- Unit-test plugin capability filtering by active target set.
- Unit-test setup check output for expected, missing, stale, manual, and
  unsupported projections.
- Unit-test cleanup dry-run and cleanup execution for ignored generated
  directories.
- Unit-test compatibility normalization for legacy `mcp.agentTargets` and
  `skills.agentTargets` configurations.
- Unit-test worker context generation so worker-local projections match the
  assigned provider.

## Acceptance Criteria

- DevNexus has one explicit active-agent-target policy consumed by MCP, skills,
  plugins, setup checks, and worker context generation.
- New Codex-only projects do not receive `.claude` support directories.
- New Claude-only projects do not receive Codex support directories unless
  explicitly configured.
- Existing projects with multiple configured targets continue to work, but
  setup can recommend a normalized explicit target policy.
- Plugin-projected skills and MCP entries are materialized only for active
  compatible targets.
- Setup check reports stale generated provider projections clearly.
- Cleanup can remove stale generated support state safely and refuses ambiguous
  manual/source-controlled files.
- Documentation explains opt-in provider targeting and adding/removing
  providers.

## Out Of Scope For The First Implementation

- Provider-global account setup beyond existing setup guidance.
- Live provider capability discovery.
- Graphical user interface for provider target selection.
- Automatic deletion of unknown provider directories.
- Migration of user-global skills.
- Provider-specific implementation work outside projection adapters.

## Further Notes

This feature is closely related to existing worker context and skill projection
work, but the user-facing problem is distinct: provider support should not imply
provider activation. The project should remain clean by default, and generated
agent-native artifacts should communicate the active workflow rather than every
workflow DevNexus could theoretically support.
