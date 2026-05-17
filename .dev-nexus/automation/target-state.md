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
- Current ready `dogfood` work matching the automation selector after parallel
  wave `parallel-dev-nexus-wave-20260517-1115`:
  - `dev-nexus:local-33` launch ephemeral Codex app-server worker threads,
    unblocked by completed `dev-nexus:local-31` and `dev-nexus:local-32`.
  - `dev-nexus:local-38` add publication identity and remote guardrails so
    DevNexus can prevent GitHub account/remote mix-ups before automated pushes
    or provider writes.
  - `dev-nexus:local-39` add first-class meta-project hosting configuration so
    DevNexus can describe the GitHub user/org namespace, repo naming,
    visibility, remote names, repo provisioning policy, and host-local auth
    profile reference for shared meta repositories.
  - `dev-nexus:local-44` add component multi-tracker schema and compatibility
    normalization.
  - `dev-nexus:local-55` add extensible agent-provider MCP target support so
    DevNexus can support providers such as OpenCode without Codex-specific
    assumptions.
- GitHub identity dogfood state:
  - Plain `gh` is authenticated as `Gabriel-Darbord` for human/manual API work.
  - `C:\Users\gabriel.darbord\bin\gh-gabot.cmd` sets
    `GH_CONFIG_DIR=C:\Users\gabriel.darbord\.config\gh-gabot` and authenticates
    as `Gabot-Darbot` for bot API work.
  - The dogfood meta repo uses `origin` for personal SSH access and `bot` for
    `git@github.com-gabot:Gabot-Darbot/dev-nexus-dogfood.git`.
  - Until `dev-nexus:local-38` lands, agents must not infer the right account
    from the active browser or default `gh`; automation should use explicit
    remotes/wrappers.
  - Until `dev-nexus:local-39` lands, the current bot-owned repo is a working
    dogfood setup, not yet the portable DevNexus project-hosting model.
- Onboarding direction:
  - `dev-nexus:local-40` is complete through DevNexus `4524fc6`: guided setup
    assistant flows are exposed through CLI and MCP as `setup list`, `setup
    plan`, `setup check`, and `setup record`. Mac setup plans now use
    host-local placeholders instead of Windows source roots, and Mac preflight
    correctly blocks on OS-local component path configuration. Follow-up commit
    `dde7d8e` publishes npm `@evref-bl/dev-nexus@0.1.0-alpha.1` with the
    `dogfood` tag for same-day Mac installation.
  - `dev-nexus:local-53` is complete through DevNexus `e88d7aa`: portable path
    resolution now supports `projectRoot:`, `projectParent:`, `home:`, and
    `sourcesRoot:` bases. npm `@evref-bl/dev-nexus@0.1.0-alpha.3` is published
    on the `dogfood` tag. This dogfood config now uses
    `sourcesRoot:<component>` source roots; Windows keeps compatibility through
    host-local junctions under `C:\dev\code\sources`, and the Mac setup plan
    clones components under `$HOME/dev-nexus/sources`.
  - `dev-nexus:local-54` is complete through DevNexus `c83ab0f`: shared
    automation agent profiles now use generic `codex` plus portable
    `projectRoot:` and `sourcesRoot:` args. npm
    `@evref-bl/dev-nexus@0.1.0-alpha.4` is published on the `dogfood` tag.
    The same profile resolves to Windows paths on Windows and
    `$HOME/dev-nexus/...` paths on Mac.
  - `dev-nexus:local-42` Mac follow-ups are published through DevNexus
    `8c51077`: setup guidance now separates projected MCP config from
    provider-session readiness. Setup checks warn until the host records
    `open-agent-project-session` after confirming DevNexus MCP tools are
    visible in the configured provider. npm
    `@evref-bl/dev-nexus@0.1.0-alpha.6` is published on the `dogfood` tag.
    The wording is provider-neutral; Codex Desktop is only one provider
    example.
  - Mac plugin-projection follow-up is published through DevNexus `6dd5cc8`
    and npm `@evref-bl/dev-nexus@0.1.0-alpha.7`: setup checks now inspect
    enabled plugin `projected_skill` and `mcp_server` capabilities and warn
    when project-managed skills, agent-local skill projections, or agent MCP
    server entries are missing. The dogfood project config now also declares
    the DevNexus-Pharo MCP-Pharo domain skills. `dev-nexus-pharo:local-11`
    tracks plugin-owned materialization of root Pharo skills and MCP config.
  - `dev-nexus:local-55` tracks the next provider-inclusion slice: extensible
    agent MCP target adapters, including OpenCode or a documented custom
    provider/manual-config path once provider docs confirm the config model.
  - `dev-nexus:local-41` will add the initial GitHub bot/machine-user and
    meta-repo setup flow after the generic setup assistant and hosting config
    shape exist.
  - `dev-nexus:local-42` will add the new-machine setup flow for joining an
    existing shared DevNexus project, including host-local auth, source roots,
    MCP refresh, skills projection, and toolchain preflight.
- The five-agent DevNexus wave completed and was published through DevNexus
  `d0db6af`:
  - `dev-nexus:local-17` added draft-only/mocked `coordination_request`
    support through CLI and MCP, without live external provider posting.
  - `dev-nexus:local-24` added related-component dependency projections for
    worker worktrees.
  - `dev-nexus:local-29` added the current-agent coordinator adoption contract
    for already-running coordinators.
  - `dev-nexus:local-31` added the Codex app-server JSON-RPC capability
    adapter foundation.
  - `dev-nexus:local-32` added Codex app-server agent profile schema support.
  Integration verification passed with `npm run check`: 44 test files and 279
  tests.
- Worker-local JavaScript/TypeScript verification is now handled as a plugin
  concern. DevNexus core supplies generic dependency projections, and the
  standalone `dev-nexus-typescript` component supplies TypeScript/JavaScript
  plugin capabilities that project existing `node_modules` support and worker
  guidance into generated worktrees.
- Runtime setup is now approved through
  `.dev-nexus/automation/runtime-profile-overnight-live-20260517.md`.
  Docker/Podman compatibility checks, local dependency repair, and isolated
  PLexus/pharo-launcher-mcp/Pharo smoke work may proceed inside that profile.
  Live external provider posting remains blocked unless a work item records
  explicit provider-policy approval.
- The standalone Codex cron automation `devnexus-dogfood-overnight` is paused.
  It can load `dev-nexus automation run-once`, but its scheduler shell runs in
  a restricted workspace-write/no-network sandbox, so a nested `codex.exe`
  coordinator can fail before selecting work. The DevNexus-owned loop
  foundation is complete through `dev-nexus:local-27`; restricted current-agent
  adoption remains tracked by `dev-nexus:local-29`.
- The active continuation automation is the thread heartbeat
  `devnexus-dogfood-heartbeat`. Treat it as a temporary wake-up bridge, not
  the desired perpetual-work architecture. It should invoke
  `dev-nexus automation coordinator-loop . --max-ticks 1 --max-runs 1 --json`
  and let DevNexus decide no-work, backoff, active-lock, wait, launch,
  completion, blocked, and failed outcomes.
- Codex app-server provider planning is captured in
  `docs/codex-app-server-provider-prd.md`. The follow-up tracker item
  `dev-nexus:local-30` is `todo`/HITL and has been sliced into implementation
  items. Foundation work `dev-nexus:local-31` and `dev-nexus:local-32` is
  complete; `dev-nexus:local-33` is now ready. Dependent follow-ups
  `dev-nexus:local-34` through `dev-nexus:local-36` remain `todo` until the
  app-server launch path lands.
- The cron prompt now invokes DevNexus through the user-local Codex Node path
  instead of a fragile `node` alias or scheduler-sensitive package-manager
  runtime.
- Previous scheduler blocker: on 2026-05-17T07:32:51Z, the configured
  Winget-managed `node.exe` returned access denied before DevNexus
  `automation run-once` could load. No coordinator launch or implementation
  work was attempted during that blocked overnight run.
- Current automation state: the paused cron invokes DevNexus through
  `C:\Users\gabriel.darbord\AppData\Local\OpenAI\Codex\bin\node.exe`, but it
  should not be resumed as a direct nested coordinator launcher. If a host
  scheduler is used, it should wake DevNexus `automation coordinator-loop`
  instead, so DevNexus decides whether a coordinator run should actually start.
  `dev-nexus:local-27` is now complete through DevNexus `af0b300`; current-agent
  adoption remains tracked separately by `dev-nexus:local-29`.
- Local launcher cleanup: the pharo-launcher-mcp checkout now lives at
  `C:\dev\code\git\pharo-launcher-mcp`; active source/config now uses that
  project and package identity consistently.
- `pharo-launcher-mcp` live-smoke passed using the approved profile state root
  and produced no source checkout changes. A later launcher-owned fix for
  isolated profile configuration, copied-image metadata repair, and Windows
  detached launch logging was completed and published as `24f6d84`, then
  released to npm as `@evref-bl/pharo-launcher-mcp@0.1.2` from source commit
  `c137fe9`.
- PLexus approved live smoke `dogfood-overnight-local-3-20260517-0428`
  passed open/route/close through the isolated runner after the launcher fix.
  Artifacts are retained under
  `.dev-nexus/runtime/artifacts/overnight-live-20260517/dogfood-overnight-local-3-20260517-0428`.
- PLexus now consumes `@evref-bl/pharo-launcher-mcp@^0.1.2` through normal npm
  dependency resolution in source commit `7d34f86`. The approved smoke was
  rerun without a local launcher checkout override as
  `dogfood-overnight-local-3-npm-20260517-0442` and passed copy/open/route/close
  cleanup through the published package. Artifacts are retained under
  `.dev-nexus/runtime/artifacts/overnight-live-20260517/dogfood-overnight-local-3-npm-20260517-0442`.
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
  - `dev-nexus:local-37` is complete through the standalone
    DevNexus-TypeScript plugin repo at `bf19839` plus this dogfood project
    wiring. The project now treats TypeScript/JavaScript package dependency
    setup as plugin-provided infrastructure rather than hard-coding it into
    DevNexus core.
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
  - MCP-Pharo was refreshed to `origin/main` commit `8ba98ed` on 2026-05-17.
    Recent pulls added repo-local Pharo skills for CI reproduction, image Git
    handoff, project loading, and version compatibility, plus the Docker
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
  - Initial live external coordination policy notes are recorded in
    `docs/shared-multi-host-coordination-prd.md`; assignment should be treated
    as ownership/response intent unless a project explicitly configures it as
    an approval signal.
  - Default policy direction: external provider events should update neutral
    DevNexus state-machine records; GitHub labels or Projects status/category
    moves are preferred for issue-level approval over assignment.
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
- Human-in-the-loop blocked work:
  - `dev-nexus:local-16` choose shared coordination provider/transport for
    Mac/Windows dogfood after the generic API shape is ready.
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
  trusted route-control plumbing for PLexus core or operators, not a third
  normal agent-facing surface.
- This naming/default surface direction is now implemented and published in
  PLexus `4a0b813`.
- Scoped project/workspace/image context and route metadata are now implemented
  and published in PLexus `de0d5c6`.
- PLexus route-control hardening is published through `71aa925`: HTTP gateway
  service mode now separates `/mcp` agent-facing Pharo tools from
  `/control-mcp` route registration/status/cleanup over one shared in-memory
  route table, and PLexus core defaults route registry calls to the
  route-control endpoint.
- Mac PLexus follow-up commits are pulled into the Windows checkout through
  `c24c739`: `44fd737` maps legacy `PLEXUS_GATEWAY_MCP_URL` `/mcp` values to
  `/control-mcp`, `6a36cf2` preserves per-image runtime state, records actual
  image listener pids, and adds scoped stop behavior, and `c24c739` aligns
  Windows/POSIX path-style test expectations. `plexus:local-6` remains open
  because `pharo_launcher_image_create` is still documented but not exposed by
  the scoped launcher server.

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
- DevNexus MCP approval-default projection was published through `baa238a`,
  covering `defaultToolsApprovalMode` in project MCP config, Codex
  `default_tools_approval_mode` generation, and preservation of existing
  trusted-server approval settings during `project mcp refresh`.
- DevNexus MCP component-qualified work-item routing was published through
  `7aa035d`, covering `component-id:local-id` references for MCP
  get/update/comment/set-status calls so component-local trackers are selected
  before legacy root tracker fallbacks.
- DevNexus managed coordinator-loop foundation was published through
  `af0b300`, covering `automation coordinator-loop`, no-work/lock/backoff wait
  decisions, target-cycle launch/finalization facts, and stdout/stderr tail
  diagnostics. Current-agent adoption remains a follow-up.
- DevNexus guided setup assistant was published through `4524fc6`, covering
  setup flow modeling, Mac new-machine setup plan/check/record CLI, equivalent
  MCP tools, host-local setup progress records, README guidance, and OS-local
  sourceRoot guards. Package `@evref-bl/dev-nexus@0.1.0-alpha.1` is published
  on npm under the `dogfood` dist-tag through source commit `dde7d8e`.
- DevNexus-Pharo MCP-Pharo domain skill bundling was published through
  `ec14934`, covering bundled `pharo-ci-repro`,
  `pharo-image-git-handoff`, `pharo-project-load`, and
  `pharo-version-compat` skills plus plugin projected-skill capabilities.
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
- PLexus approved isolated live-smoke runner harness was completed and
  published as `5953274`; `plexus:local-3` and the approved live-smoke
  execution item `plexus:local-2` are complete. PLexus source commit `7d34f86`
  updates the launcher package dependency to the published fixed
  `@evref-bl/pharo-launcher-mcp@0.1.2`.
- pharo-launcher-mcp cleanup hook boundary was documented and published as
  `1f3070b`.
- pharo-launcher-mcp isolated profile image-copy configuration was completed
  and published as `24f6d84`, including profile-root launcher CLI config,
  copied-image metadata repair, and detached launch log redirection. Patch
  release `0.1.2` was published to npm from `c137fe9`.
- MCP-Pharo static/live verification boundary was merged through `origin/main`;
  automatic loads and DevNexus component defaults now target `main`.
- MCP-Pharo `mcp-pharo:local-5` was completed by upstream work now refreshed
  through commit `8ba98ed`, which includes repo-local Pharo CI reproduction,
  image Git handoff, project loading, version compatibility skills, Docker
  smalltalkCI helper scripts, and log-reading references.
- Local Codex/automation MCP config now uses the `dev_nexus_pharo` server name
  with `default_tools_approval_mode = "approve"` for trusted DevNexus-Pharo and
  PLexus MCP servers. `dev-nexus:local-26` is complete; future MCP refreshes
  preserve approval defaults through DevNexus source commit `baa238a`.
- The dogfood DevNexus MCP projection now uses the user-local Codex Node
  executable path and declares `defaultToolsApprovalMode: "approve"` in
  `dev-nexus.project.json`; refreshed `.codex/config.toml` contains
  `default_tools_approval_mode = "approve"`.

Active boundaries:

- Live Pharo images, PLexus open/close, Docker launches, and package installs
  are allowed only inside the approved
  `overnight-live-20260517` disposable runner profile or a newer recorded
  profile. Destructive Git cleanup and unrelated host mutation remain blocked.
- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation.
- Preserve unrelated changes in component working trees.
