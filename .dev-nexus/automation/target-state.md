# DevNexus Dogfood Target State

Current target: use DevNexus to work on itself and related components until the
live plan is represented as component-owned work items, and then use the
DevNexus agent-launch loop to advance eligible work.

Immediate direction:

- `dev-nexus:local-5` split `PLAN.md` into component-owned local work items
  using the curated `to-issues` skill. New work items include readiness,
  blocker, acceptance, verification, and publication notes.
- The ready DevNexus core dogfood batch is complete:
  - `dev-nexus:local-8` component-aware target completion reporting.
  - `dev-nexus:local-11` Codex and Claude agent profile policy schema.
- Low-token coordinator discovery is now available through DevNexus CLI
  `automation eligible-work` and `automation agent-profiles`, plus native MCP
  tools `eligible_work` and `agent_profiles`.
- New plugin-composition plan work is tracked. DevNexus remains the generic
  infrastructure; PharoNexus is a DevNexus plugin, not an alternate runner.
- Current ready `dogfood` work matching the automation selector:
  - `dev-nexus:local-13` add the generic plugin capability/projection contract.
  - `dev-nexus:local-15` add shared coordination integration planning now that
    status and handoff records exist.
  - `plexus:local-8` expose scoped PLexus project context for DevNexus plugins.
- Dependent non-eligible plugin work:
  - `pharo-nexus:local-4` model PharoNexus as the Pharo plugin for DevNexus
    agent setup after the generic plugin and scoped PLexus contracts are
    stable.
  - `pharo-launcher-mcp:local-3` confirm launcher image delete/status contract
    only if PLexus identifies a concrete launcher-side cleanup gap.
- Completed shared coordination baseline:
  - `dev-nexus:local-14` added generic `coordination_status` and
    `coordination_handoff` through CLI and MCP, with advisory stale handoff
    warnings and tracker-backed local comments.
- External coordination extension:
  - Add `coordination_request` so agents can ask external humans or agents for
    approval, feedback, choices, or review through provider-native issue,
    pull-request, merge-request, Jira, or review threads.
  - `dev-nexus:local-17` tracks the provider-neutral API and mocked provider
    implementation.
  - `dev-nexus:local-18` tracks the human decision for which live provider
    posting actions are allowed versus draft-only.
- Human-in-the-loop shared coordination decision:
  - `dev-nexus:local-16` choose the real shared tracker/provider and Tailscale
    transport role for Mac/Windows dogfood.
  - `dev-nexus:local-18` choose external coordination posting policy before
    live GitHub/GitLab/Jira comments or review requests are automated.
- Blocked plugin/live verification work:
  - `pharo-nexus:local-5` verify that subagents receive direct Pharo MCP access
    through PharoNexus-provided scoped PLexus setup.
  - After direct Pharo MCP access is proven in component worktrees, resume the
    blocked MCP-Pharo items `mcp-pharo:local-4` and `mcp-pharo:local-5`.
- Later or dependent non-eligible work:
  - `pharo-launcher-mcp:local-2` launcher cleanup/status hook follow-up only
    after the approved runner harness identifies a concrete hook need.
- Human-in-the-loop blocked work:
  - `dev-nexus:local-16` choose shared coordination provider/transport for
    Mac/Windows dogfood after the generic API shape is ready.
  - `plexus:local-3` build the approved isolated PLexus live-smoke runner
    harness after runner inputs and cleanup policy are approved.
  - `plexus:local-2` run the approved isolated PLexus live-smoke.
  - `pharo-nexus:local-5` verify PharoNexus-provided Pharo MCP access in
    subagent worktrees.
  - `mcp-pharo:local-2` run MCP-Pharo verification through the approved
    isolated runner.

Vibe backlog reconciliation:

- Inspected old Vibe Kanban issues as tracker/history only; no Vibe
  workspaces, sessions, executions, workers, or issue mutations were created.
- Publication-only Vibe blockers for PharoNexus `932e663`, PLexus `11b9c6a`,
  and pharo-launcher-mcp `0f75151` are stale because those commits are now
  contained in `origin/main`.
- Added local DevNexus backlog items for still-relevant Vibe findings:
  - `pharo-nexus:local-3` approved self-hosted startup smoke.
  - `plexus:local-4` gateway/lifecycle package boundary split.
  - `plexus:local-5` prepared image cache model and safe service boundary.
  - `plexus:local-6` scoped launcher create/stop contract alignment.
  - `plexus:local-7` OS-agnostic config tests and docs.
  - `mcp-pharo:local-4` `where` predicate mode API simplification.
  - `mcp-pharo:local-5` isolated local SmalltalkCI runner documentation.
- Folded Vibe worker/provider reliability evidence into `dev-nexus:local-10`
  instead of creating new work that depends on Vibe implementation workers.

Shared coordination planning:

- Added `docs/shared-multi-host-coordination-prd.md` to define the feature.
- The coordination API remains intentionally small. `coordination_status` and
  `coordination_handoff` are implemented; `coordination_integrate` remains the
  next generic integration-planning slice. External coordination extends it with
  `coordination_request`.
- Git worktrees and branches remain the parallelism mechanism. Coordination
  records are shared intent and handoff facts, not hard locks.
- External approval, feedback, review, and choice questions should be posted to
  provider-native systems when configured, then summarized back into neutral
  DevNexus coordination records.
- Live external provider posting remains policy-gated; the first implementation
  should support draft/mocked flows without credentials.
- Durable multi-host state should live in Git remotes and the shared work
  tracker. Tailscale can provide private MCP transport, but should not be the
  only source of truth.

Durable completed foundation:

- DevNexus core result-file contract hardening and component worktree guidance
  were implemented and published as `95cec72`.
- DevNexus core target-report/relaunch readiness was completed and published as
  `1863d04`.
- DevNexus low-token agent-facing automation surfaces were completed and
  published as `f332378`.
- DevNexus parallel wave `parallel-dev-nexus-wave-20260516` completed and was
  published through `ac07964`, covering coordinator-reported dispatch progress
  surfaces, component-scoped worktree ownership records, and neutral
  work-tracker provider capability conformance.
- DevNexus parallel wave `parallel-dev-nexus-wave-2-20260516` completed and
  was published through `e11df67`, covering component-aware target completion
  reporting and hardened Codex/Claude agent profile policy schema.
- DevNexus shared coordination baseline was published through `c0cb6d8`,
  covering generic CLI/MCP `coordination_status` and `coordination_handoff`
  records backed by work-item comments.
- Component wave `parallel-component-wave-20260516` completed with verified
  source changes:
  - DevNexus project template scaffold was published through `3891e3e`.
  - PharoNexus Codex worktree Pharo MCP config projection was published
    through `3135210`; live route validation still requires approved runtime
    infrastructure.
  - PLexus gateway lifecycle/package boundary and portability coverage were
    published through `a616dd4`.
  - MCP-Pharo items `mcp-pharo:local-4` and `mcp-pharo:local-5` were blocked
    because worker contexts had no direct Pharo MCP namespace, no registered
    PLexus image route, and no `imageId` for routed MCP calls.
- PharoNexus adapter alignment was completed and published as `c6629df`.
- PLexus isolated live-smoke runner boundary was documented and published as
  `916e1d5`.
- pharo-launcher-mcp cleanup hook boundary was documented and published as
  `1f3070b`.
- MCP-Pharo static/live verification boundary was merged into `origin/develop`
  through `9d90fd8`, preserving commits `0a38755` and `4c37fb0`; the temporary
  review branch `origin/review/mcp-pharo-verification-boundary-20260516` was
  removed after merge verification.

Active boundaries:

- Do not run live Pharo images, PLexus open/close, Docker launches, destructive
  Git cleanup, package installs, or privileged host mutation without an
  explicit isolated runner and cleanup plan.
- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation.
- Preserve unrelated changes in component working trees.
