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
  infrastructure; DevNexus-Pharo is a DevNexus plugin, not an alternate runner.
- Current ready `dogfood` work matching the automation selector:
  - `dev-nexus:local-17` add draft-only/mocked `coordination_request` support
    without live external provider posting.
  - `dev-nexus:local-24` support declared related-component dependency
    projections for worker worktrees.
- Runtime setup is now approved through
  `.dev-nexus/automation/runtime-profile-overnight-live-20260517.md`.
  Docker/Podman compatibility checks, local dependency repair, and isolated
  PLexus/pharo-launcher-mcp/Pharo smoke work may proceed inside that profile.
  Live external provider posting remains blocked unless a work item records
  explicit provider-policy approval.
- Local launcher cleanup: the pharo-launcher-mcp checkout now lives at
  `C:\dev\code\git\pharo-launcher-mcp`; active source/config now uses that
  project and package identity consistently.
- `pharo-launcher-mcp` live-smoke passed using the approved profile state root
  and produced no source checkout changes.
- Scoped npm dogfood prereleases were published on 2026-05-17 so other
  machines can install without sibling checkout assumptions:
  - `@evref-bl/dev-nexus@0.1.0-alpha.0` published with `dogfood` tag and
    DevNexus source commit `c6ed813`.
  - `@evref-bl/plexus-core@0.1.0-alpha.0` and
    `@evref-bl/plexus-gateway@0.1.0-alpha.0` published with `dogfood` tag and
    PLexus source commit `ecac759`.
  - `@evref-bl/dev-nexus-pharo@0.1.0-alpha.0` published with `dogfood` and
    `latest` tags and DevNexus-Pharo source commit `8024fa2`. npm reports
    public access and dist-tags. After registry propagation, packument lookup
    and a clean temp-directory `npm exec --package` smoke both pass.
  - The former npm package name was unpublished with `--force`; dist-tags are
    gone, though `npm view` may still show cached metadata briefly.
  - DevNexus-Pharo now consumes DevNexus through the npm alias
    `dev-nexus -> @evref-bl/dev-nexus@0.1.0-alpha.0`, not `file:../DevNexus`.
  - `dev-nexus-pharo:local-8` completed the rename to DevNexus-Pharo in
    source/package/docs/config identifiers and published source commit
    `8024fa2`. The GitHub repository is renamed to
    `Evref-BL/DevNexus-Pharo`, and the local source remote plus dogfood
    component metadata now point at the new SSH URL. The obsolete GitHub
    redirect for the former repository slug has been retired; the old API,
    web, and Git URLs now return not found.
  - The stale ignored local work-item store for the former component id was
    removed; the active tracker store is `.dev-nexus/work-items/dev-nexus-pharo.json`.
- Worker context direction:
  - Keep `worktreePath` as the component Git checkout root for now.
  - `dev-nexus:local-19` is complete and published in DevNexus `508b301`.
    Prepared component worktrees now generate DevNexus-owned
    `.dev-nexus/context/context.json` and `.dev-nexus/context/briefing.md`
    instead of copying root `AGENTS.md`, `PLAN.md`, or target-state files into
    source roots.
  - `dev-nexus:local-20` is complete and published through DevNexus `5895ea2`.
    Project-local skills remain DevNexus-managed under `.dev-nexus/skills` and
    can now be projected into worker-local agent paths such as
    `.agents/skills` without global installation.
  - `dev-nexus:local-21` is complete and published through DevNexus `5895ea2`.
    Plugins can now contribute bounded worker briefing/context fragments.
    `dev-nexus-pharo:local-4` owns the Pharo-specific fragment for scoped PLexus
    and direct Pharo MCP guidance.
  - `dev-nexus:local-23` is complete and published through DevNexus
    `6c0501c`. DevNexus core now accepts declarative plugin dependency
    projections, materializes them into worker worktrees without installs, and
    records the resulting support in setup/context surfaces. JavaScript/
    TypeScript is covered by fixtures; Java can reuse the same hook later for
    JDK/Maven/Gradle hints.
  - `dev-nexus-pharo:local-4` is complete and published through DevNexus-Pharo
    `75a038c`. DevNexus-Pharo now declares a DevNexus plugin config with Pharo
    skills, scoped PLexus and direct Pharo MCP capabilities, setup obligations,
    environment hints, cleanup expectations, agent affordances, and worker
    context/briefing fragments. DevNexus-Pharo-created/imported projects persist
    the plugin entry without replacing DevNexus. The dogfood project also
    records a component-scoped `dev-nexus-pharo` plugin entry for future generated
    worker contexts.
  - Defer nested generated execution workspaces until the simpler context
    bundle has been exercised; `dev-nexus:local-22` tracks the human decision
    and architecture review.
- MCP-Pharo branch migration:
  - MCP-Pharo is now merged to `origin/main`; DevNexus component metadata and
    PLexus automatic Metacello loading must target `main`, not `develop`.
  - MCP-Pharo was refreshed to `origin/main` commit `f84ae31` on 2026-05-17.
    That pull added the repo-local `pharo-ci-repro` skill and Docker
    smalltalkCI reproduction helper.
- Dependent non-eligible plugin work:
  - `pharo-launcher-mcp:local-3` confirm launcher image delete/status contract
    only if PLexus identifies a concrete launcher-side cleanup gap.
- Completed shared coordination baseline:
  - `dev-nexus:local-14` added generic `coordination_status` and
    `coordination_handoff` through CLI and MCP, with advisory stale handoff
    warnings and tracker-backed local comments.
  - `dev-nexus:local-15` added generic read-only `coordination_integrate`
    planning through CLI and MCP, using recorded handoffs and Git merge
    analysis without mutating source.
- External coordination extension:
  - Add `coordination_request` so agents can ask external humans or agents for
    approval, feedback, choices, or review through provider-native issue,
    pull-request, merge-request, Jira, or review threads.
  - `dev-nexus:local-17` is ready for provider-neutral API and mocked/draft-only
    provider implementation.
  - `dev-nexus:local-18` tracks the human decision for which live provider
    posting actions are allowed versus draft-only.
- Human-in-the-loop shared coordination decision:
  - `dev-nexus:local-16` choose the real shared tracker/provider and Tailscale
    transport role for Mac/Windows dogfood.
  - `dev-nexus:local-18` choose external coordination posting policy before
    live GitHub/GitLab/Jira comments or review requests are automated.
- Blocked plugin/live verification work:
  - `dev-nexus-pharo:local-5` verify that subagents receive direct Pharo MCP access
    through DevNexus-Pharo-provided scoped PLexus setup.
  - After direct Pharo MCP access is proven in component worktrees, resume the
    blocked MCP-Pharo query API item `mcp-pharo:local-4`.
- Later or dependent non-eligible work:
  - `pharo-launcher-mcp:local-2` launcher cleanup/status hook follow-up only
    after the approved runner harness identifies a concrete hook need.
- Previously human-in-the-loop blocked work now ready for isolated runtime setup:
  - `plexus:local-3` build and harden the isolated PLexus live-smoke runner
    harness using the approved `overnight-live-20260517` profile.

- Human-in-the-loop blocked work:
  - `dev-nexus:local-16` choose shared coordination provider/transport for
    Mac/Windows dogfood after the generic API shape is ready.
  - `plexus:local-2` run the approved isolated PLexus live-smoke after
    `plexus:local-3` confirms the harness is runnable.
  - `dev-nexus-pharo:local-5` verify DevNexus-Pharo-provided Pharo MCP access in
    subagent worktrees after the runner passes.
  - `mcp-pharo:local-2` run MCP-Pharo verification through the approved
    isolated runner after the runner passes.

Vibe backlog reconciliation:

- Inspected old Vibe Kanban issues as tracker/history only; no Vibe
  workspaces, sessions, executions, workers, or issue mutations were created.
- Publication-only Vibe blockers for DevNexus-Pharo `932e663`, PLexus `11b9c6a`,
  and pharo-launcher-mcp `0f75151` are stale because those commits are now
  contained in `origin/main`.
- Added local DevNexus backlog items for still-relevant Vibe findings:
  - `dev-nexus-pharo:local-3` approved self-hosted startup smoke.
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

PLexus agent-facing surface direction:

- Normal agents should see two PLexus MCP concepts:
  - `pharo-launcher` for scoped image lifecycle such as list, create, start,
    stop, delete, and info.
  - `gateway` for typed project Pharo MCP tools routed to a selected image by
    explicit `imageId`.
- `plexus_route_to_image` remains a raw routing escape hatch only when an
  explicit opt-in setting enables it. Generated default agent config should not
  expose it.
- Route registration, unregister, status, and stale-route cleanup are
  internal/admin plumbing for PLexus core or operators, not a third normal
  agent-facing surface.
- This naming/default surface direction is now implemented and published in
  PLexus `4a0b813`.
- Scoped project/workspace/image context and route metadata are now implemented
  and published in PLexus `de0d5c6`.

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
- DevNexus generic plugin capability projection contract was published through
  `613ea21`, covering additive multi-plugin project config, projected skills,
  MCP servers/tools, setup obligations, environment hints, cleanup hooks, agent
  affordances, launch-context projection, and low-token agent profile reporting.
- PLexus gateway agent-facing proxy defaults were published through `4a0b813`,
  covering generated `pharo-launcher` plus `gateway` workspace MCP config,
  default hiding of `plexus_route_to_image`, and explicit raw-routing opt-in
  without exposing route-management tools on the normal `gateway` surface.
- DevNexus coordination integration planning was published through `b2c219a`,
  covering read-only CLI/MCP `coordination_integrate`, merge-base/merge-tree
  conflict forecasting, recorded decision conflicts, stale handoffs, and
  policy-gated fetch planning.
- DevNexus worker context bundles were published through `508b301`, covering
  `.dev-nexus/context/context.json`, `.dev-nexus/context/briefing.md`, Git
  exclusion of generated context support, executor environment pointers, and
  generic ownership/read-write boundary metadata.
- DevNexus worker context follow-ups were published through `5895ea2`,
  covering worker-local project skill projections and generic plugin
  worker-context/briefing fragments.
- DevNexus plugin dependency projection support was published through
  `6c0501c`, covering generic `dependency_projection` plugin capabilities,
  generated worktree materialization, Git exclusion, worker context reporting,
  JS/TS binary-resolution fixtures, and run-once preflight/setup wiring.
- PLexus scoped plugin context was published through `de0d5c6`, covering
  project/workspace/target/image ownership context, scoped lifecycle
  affordance descriptions, cleanup metadata, and gateway `imageId` route
  metadata for subagent handoff.
- Component wave `parallel-component-wave-20260516` completed with verified
  source changes:
  - DevNexus project template scaffold was published through `3891e3e`.
  - DevNexus-Pharo Codex worktree Pharo MCP config projection was published
    through `3135210`; live route validation still requires approved runtime
    infrastructure.
  - PLexus gateway lifecycle/package boundary and portability coverage were
    published through `a616dd4`.
  - MCP-Pharo items `mcp-pharo:local-4` and `mcp-pharo:local-5` were blocked
    because worker contexts had no direct Pharo MCP namespace, no registered
    PLexus image route, and no `imageId` for routed MCP calls.
- DevNexus-Pharo adapter alignment was completed and published as `c6629df`.
- PLexus isolated live-smoke runner boundary was documented and published as
  `916e1d5`.
- pharo-launcher-mcp cleanup hook boundary was documented and published as
  `1f3070b`.
- MCP-Pharo static/live verification boundary was merged through `origin/main`;
  automatic loads and DevNexus component defaults now target `main`.
- MCP-Pharo `mcp-pharo:local-5` was completed by upstream commit `f84ae31`,
  which added a repo-local Pharo CI reproduction skill, Docker smalltalkCI
  helper script, and log-reading reference. No Docker or live image run was
  performed during the dogfood refresh.

Active boundaries:

- Live Pharo images, PLexus open/close, Docker launches, and package installs
  are allowed only inside the approved
  `overnight-live-20260517` disposable runner profile or a newer recorded
  profile. Destructive Git cleanup and unrelated host mutation remain blocked.
- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation.
- Preserve unrelated changes in component working trees.
