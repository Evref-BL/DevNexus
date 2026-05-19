# DevNexus Dogfood Target State

Current target: keep the clean DevNexus dogfood project current, reproducible,
and ready for coordinator-driven work across its components.

## Current State

- The latest completed DevNexus source batches published to main through the
  `bot` remote include `dev-nexus:local-67` as `ce9b7d2` for duplicate
  explicit target-cycle id rejection, `dev-nexus:local-97` as `ff981bc` for
  worktree-first parallel chat documentation, `dev-nexus:local-79` as
  `4ca4362` for host-local and remote-host registry overlays,
  `dev-nexus:local-76` as `90e1b18` plus `baace6a` for deterministic
  full-suite Windows verification, `dev-nexus:local-80` as `69fad6f` for runner
  profile safety policy, `dev-nexus:local-112` as `0cf0571` for plugin MCP
  overlap guardrails, and `dev-nexus:local-48` as `dfaf1ca` for mocked
  one-way work-item sync execution. The newest DevNexus batch published
  `dev-nexus:local-113` as `7898d11` for Codex app-server JSONL/JSON-RPC-lite
  protocol compatibility, `dev-nexus:local-51` as `b748694` for multi-tracker
  configuration and migration docs, and `dev-nexus:local-99` as `2e8b64f` for
  advisory worktree leases. `dev-nexus:local-102` is published as `6d10c72`
  for cleanup dry-run safety classification, `dev-nexus:local-105` is
  published as `3b6b755` for active agent target config normalization, and
  `dev-nexus:local-98` is published as `e3ab2de` for fail-closed
  shared-checkout mutation guardrails. `dev-nexus:local-118` is published as
  `180955f` for hosting access declarations and provisioning gates, and
  `dev-nexus:local-119` is published as `7f53a03` for the read-only hosting
  status model, and `dev-nexus:local-120` is published as `4fa962f` for
  deterministic dry-run hosting plan actions. `dev-nexus:local-121` is
  published as `37717f7` for read-only hosting status/plan CLI and MCP
  surfaces, `dev-nexus:local-122` is published as `afe5549` for
  policy-gated local remote repair apply, and `dev-nexus:local-138`,
  `local-139`, and `local-140` are published together as `c19b493` for Mac
  setup assistant path/check fixes and quiet setup-test Git initialization.
  `dev-nexus:local-123` is published as `3c92655` for provider-gated GitHub
  repository creation apply, `dev-nexus:local-124` is published as `6e42b7f`
  for provider-gated collaborator access repair apply, and
  `dev-nexus:local-125` is published as `09513af` for invitee-auth-profile
  invitation acceptance apply. The latest Windows batch published
  `dev-nexus:local-126` as `5290da8` for hosting setup/documentation
  integration, then published `dev-nexus:local-87`, `dev-nexus:local-81`, and
  `dev-nexus:local-127` together through `ba9976e` for the neutral authority
  config model, durable remote execution request/result records, and the
  opt-in disposable hosting fixture. The latest Windows batch published
  `dev-nexus:local-129` as `3de4635` for tracker discovery roles and default
  policy, `dev-nexus:local-114` as `0d871d7` for Codex app-server notification
  and server-request routing, `dev-nexus:local-115` as `f98bede` for safe
  Codex app-server initialize probes, and `dev-nexus:local-106` as `c73f347`
  for active agent target projection filtering. The next DevNexus source
  integrations published `dev-nexus:local-88` and `dev-nexus:local-130`
  together as `e946039` for current-actor authority resolution and read-only
  tracker discovery status, `dev-nexus:local-89` as `0bc80d9` for the
  effective authority resolver, and `dev-nexus:local-131` as `c7928f1` for
  opt-in eligible-work discovery aggregation. The latest batch published
  `dev-nexus:local-132` as `d3df60c` for linked tracker work-item
  deduplication and `dev-nexus:local-90` as `f315a66` for scoped authority
  summaries in status/report/agent-context surfaces. The latest integration
  published `dev-nexus:local-91` and `dev-nexus:local-133` through `08b700c`
  for publication authority gating, read-only inbound import planning, and the
  post-review import identity-matching fixes. The next heartbeat integration
  published `dev-nexus:local-92` and `dev-nexus:local-134` through `793a162`
  for coordination/provider mutation authority gates, policy-gated inbound
  import execution, and integration import cleanup. The latest heartbeat
  resolved the authority-profile integration hold, then published
  `dev-nexus:local-94` as merge commit `b218118` for authority-role
  documentation and `dev-nexus:local-107` through `3753adf` for stale and
  unexpected provider-projection diagnostics. The first-user onboarding
  foundation `dev-nexus:local-155` is published as `b941546` for the typed
  project setup answer/proposal model, explicit mutation classification, local
  setup versus hosting handoff separation, JSON-safe proposal rendering, and
  secret diagnostics. `dev-nexus:local-156` is published as `85206d9` for the
  guided `dev-nexus project setup` CLI, non-interactive answer-file preview
  and apply flow, local scaffold/tracker/agent support generation, and
  first-project onboarding documentation. `dev-nexus:local-157` is published
  as `bea572c` for guided component topology diagnostics and
  `dev-nexus project component add` preview/apply support for adding
  components to an existing project without manual JSON editing.
  `dev-nexus:local-158` is published as `5ba2844` for setup auth profile
  inventory reporting, required-now versus provider-mutation-only profile
  classification, missing profile diagnostics, and host-local credential-handle
  checks that avoid raw secret values. `dev-nexus:local-159` is published as
  `4fbc4a4` for setup hosting handoff reporting, exact hosting status/plan/apply
  next commands, meta-project-only scope, and explicit deferral of provider
  mutations out of `project setup`. `dev-nexus:local-161` is published as
  `be3c30a` for installed CLI versus documentation command-surface skew
  diagnostics, `dev-nexus:local-160` is published as `89f216a` for setup
  readiness and agent handoff reporting, and `dev-nexus:local-154` is published
  as `4556010` for automation Git identity derivation, worktree-local bot Git
  config, worker-context identity briefing, and publication preflight blocking
  when non-human automation would inherit a mismatched human Git identity.
  `dev-nexus:local-162` and `dev-nexus:local-164` are published through
  `c0dc6d2` for the green-main publication policy model, protected
  validation/handoff readiness, merge-authority reporting, stale check signals,
  and the setup-check platform compatibility fix that restored Windows CI.
- The dogfood meta-project now records GitHub hosting remotes and automation
  publication actors explicitly: human manual work uses `origin`, while
  agent-created Git/GitHub activity uses the `bot` remote and
  `Gabot-Darbot` machine-user profile. `dev-nexus:local-163` migrated dogfood
  component publication config to green-main: component publication uses the
  `bot` remote, `GH_CONFIG_DIR=home:.config/gh-automation-github`,
  pull-request validation, `Node 24 check (ubuntu-latest)`,
  `Node 24 check (windows-latest)`, and `Node 24 check (macos-latest)` as the
  required checks, stale checks blocked, direct target-branch push blocked, and
  authorized merge only after checks are green. The dogfood project authority
  model binds `dogfood-automation-bot` to the `Gabot-Darbot` machine-user
  profile with maintainer authority, and host-local DevNexus home config binds
  `bot-github` to that actor.
- GitHub CI expansion issues are complete across all three source components:
  DevNexus #11 merged through PR #13 as `ae38fee`, DevNexus-Pharo #3 merged
  through PR #4 as `041fbe0`, and DevNexus-TypeScript #1 merged through PR #2
  as `626a54e`. Each component's latest `main` CI passed the three required
  Node 24 checks on Ubuntu, Windows, and macOS. The DevNexus PR exposed and
  fixed a stale Windows path-quoting test expectation; the DevNexus-Pharo
  post-merge Windows run exposed a transient Vitest worker-pool crash and
  passed on failed-job rerun.
- `docs/project-hosting-provisioning-prd.md` records the desired DevNexus
  hosting provisioning workflow: keep the API minimal while the tool owns
  repository creation, collaborator repair, pending invitation detection, and
  invitee-profile invitation acceptance. The PRD has been sliced:
  `dev-nexus:local-118` is complete for access declarations and provisioning
  gates; `dev-nexus:local-119` is complete for the read-only hosting status
  model; `local-120` is complete for deterministic dry-run plan actions;
  `local-121` is complete for CLI/MCP status and plan surfaces; `local-122`
  is complete for local remote repair apply; `local-123` is complete for
  GitHub repository creation apply; `local-124` is complete for collaborator
  repair and pending invite detection; `local-125` is complete for invitee
  auth-profile invitation acceptance; `local-126` is complete for setup and
  documentation integration; and `local-127` is complete for an opt-in fake-project
  GitHub integration test that must not depend on `dev-nexus-plexus` or any
  other active project.
- User policy as of 2026-05-18: agents may integrate verified dogfood
  component work into main without waiting for manual human review, using the
  configured bot/automation profile when permissions allow. Components that
  still have an explicit non-integration publication policy must be configured
  before automation treats them as direct-integration targets.
- User policy as of 2026-05-19: green-main publication means branch or pull
  request validation first; merge to `main` only after required checks are
  green and the current actor has explicit merge authority. Branch CI status
  checks are explicit publication actions, not unsolicited background polling.
- `dev-nexus:local-166` is ready for CI failure intake and coordinator wakeup
  policy: allowed scopes, webhook/poll/manual replay rollout, dedupe/backoff,
  failure-to-work-item mapping, and policy-gated coordinator wakeups.
- The current bot profile has direct write access for the active
  `Evref-BL/DevNexus` dogfood source flow; it fast-forwarded source `main` to
  `c0dc6d2` after branch CI passed.
- Windows and Mac bot publication paths are authenticated for the current
  dogfood flow. Agent-created Git/GitHub activity must continue to use the
  configured `bot` remotes and `Gabot-Darbot` automation profile.
- Fresh Mac onboarding has been remediated for the advertised generic MCP
  surface. Local source-linked CLIs expose `dev-nexus` and
  `dev-nexus-pharo`; direct PLexus and Pharo runtime work now belongs in the
  sibling `dev-nexus-plexus` project.
- Cleanup work `dev-nexus:local-68` is complete.
- Local stale `codex/*` branches in DevNexus and DevNexus-Pharo have been
  pruned after verifying they were merged or superseded by completed work items.
- Mocked one-way local-to-GitHub sync execution is complete in
  `dev-nexus:local-48`; multi-tracker migration/configuration documentation is
  complete in `dev-nexus:local-51`.
- `docs/tracker-discovery-inbound-sync-prd.md` records the current gap that
  eligible-work originally scanned component default trackers only. Dogfood now
  configures local primary trackers plus GitHub Issues eligible-source trackers
  for each component and uses discovery mode so matching GitHub Issues may be
  selected directly without import-first migration. The PRD has been sliced:
  start with
  `dev-nexus:local-129` for tracker roles and discovery-policy defaults, which
  is now complete. `local-130` is complete for read-only discovery status,
  `local-131` is complete for opt-in eligible-work aggregation from configured
  discovery sources, `local-132` is complete for reusable linked-item
  deduplication, `local-133` is complete for read-only inbound import planning,
  and `local-134` is complete for policy-gated local import execution.
  `local-135` is complete as `3819017` for compact external issue visibility
  summaries across status, eligible-work, agent context, and target reports.
  `local-136` is complete as `c3bb52a` for fake GitHub inbox discovery,
  planning, guarded import execution, idempotent rerun, missing-credential,
  wrong-filter, and no-live-provider smoke coverage. `local-137` is resolved
  for direct external selection and no import-first requirement; provider
  comments and scheduler import remain separate explicit policy decisions.
- Remote host execution PRD slicing is complete. `dev-nexus:local-77` created
  `dev-nexus:local-79` through `local-86` and `dev-nexus-pharo:local-14`;
  corresponding PLexus runtime follow-up work is tracked in `dev-nexus-plexus`.
  `local-79`, `local-80`, and `local-81` are complete; follow-on host checks,
  SSH transport, verification execution, and live dogfood smokes should remain
  ordered behind the durable request/result record model.
- DevNexus source `c0dc6d2` passed local `npm run check` on Mac, dispatched
  branch CI run `26121736764`, and post-publish `main` CI run `26121826141`.
  The earlier Windows `src/nexusSetupAssistant.test.ts` path-platform failure
  is resolved; `main` is green again for the configured GitHub Actions CI.
  DevNexus-Pharo and DevNexus-TypeScript `npm run check` also passed on this
  Mac after sync.
- The focused hosting verification for `dev-nexus:local-123` through
  `dev-nexus:local-127` passes on Windows after rebasing over the Mac
  setup-assistant commit. The latest hosting fixture slice passed
  `npm test -- src/nexusProjectHostingIntegrationFixture.test.ts`,
  `npm test -- src/nexusProjectHosting.test.ts src/nexusProjectHostingIntegrationFixture.test.ts`,
  `npm run build`, `npm test -- --exclude src/nexusSetupAssistant.test.ts`,
  and `git diff --check`.
- `dev-nexus:local-78` is complete as the authority-policy planning umbrella.
  Project/component/provider-specific agent roles such as maintainer,
  contributor, reviewer, and observer determine whether an agent may push, open
  PRs, approve, merge, or only hand off.
- `docs/coordination-roles-authority-prd.md` now captures the PRD for
  `dev-nexus:local-78` and is attached to the work item through a local
  DevNexus comment.
- The authority PRD has been sliced: `dev-nexus:local-87` is complete for the
  actor/role/action configuration model, `local-88` is complete for host-local
  current-actor resolution, `local-89` is complete for the pure effective
  authority resolver, `local-90` is complete for scoped authority status and
  agent-context reporting, `local-91` is complete for publication action
  gating, and `local-92` is complete for coordination/provider mutation
  authority gates. `local-93` is complete as DevNexus source commit
  `8a97548` for mocked GitHub, GitLab, and Jira provider approval,
  branch-policy, and issue-level decision signal summaries. `local-94` is
  complete for authority-role documentation. `local-152` is complete as
  `0e86479` for local tracker work-item mutations with provider-scoped
  automation auth profiles. `local-95` is a blocked HITL decision item for
  self-approval, temporary elevation, and advanced role-policy questions.
- Parallel-agent Git workflow slicing is complete. `dev-nexus:local-96`
  recorded the authority cross-check and created `local-97` through
  `local-103`. `local-97`, `local-98`, `local-99`, and `local-102` are
  complete. DevNexus-controlled CLI and MCP mutations now classify shared
  project checkouts, shared component checkouts, generated component
  worktrees, generated project-meta worktrees, bootstrap operations, and
  explicit integration/allow overrides before writing. `local-100` can be
  reconsidered now that authority status summaries exist. Provider mutation
  gating stays with the authority item `local-92`.
- `docs/agent-target-projection-opt-in-prd.md` records the decision that
  provider-native MCP, skills, plugin, and worker projections should be
  generated only for active agent targets. `dev-nexus:local-104` is complete as
  the planning umbrella. Current dogfood evidence: MCP is Codex-only, but
  `skills.agentTargets` still includes Claude, so `.claude/skills` is stale
  ignored support state for this Codex-only workflow.
- Agent-target projection opt-in has been sliced. `dev-nexus:local-105` is
  complete for active target policy and compatibility normalization, and
  `local-106` is complete for active-target projection filtering.
  `dev-nexus:local-107` is published through DevNexus main `3753adf` with
  read-only stale/unexpected provider projection diagnostics.
  `dev-nexus:local-109` is published through DevNexus main `721fbd9` for
  assigned worker-provider target propagation into worker context and worktree
  setup. Keep `local-108`, `local-110`, and `local-111` ordered behind the
  diagnostics and cleanup behavior they require. Do not remove `.claude/skills`
  until cleanup safety behavior is integrated, unless a separate manual cleanup
  is explicitly approved.
- DevNexus-Pharo MCP/plugin cleanup has completed source deletions
  `dev-nexus-pharo:local-15` through `local-19` and published commits
  `1ef5709`, `eb55b9c`, `c5f7a90`, `be1f866`, and `1dd2141` to
  DevNexus-Pharo main through the bot remote. `dev_nexus_pharo` now lists only
  six Pharo-owned `pharo_project_*` project/skill tools, has no default
  tool-name overlap with core `dev_nexus`, and no longer carries obsolete
  DevNexus-Pharo config migration paths.
- DevNexus-Pharo packaging work `dev-nexus-pharo:local-20` is published as
  `84a4556`; packaged npm contents now include `AGENTS.md` plus built `dist`,
  and a tarball-install smoke proved project create/import write `AGENTS.md`.
- DevNexus-Pharo import/config cleanup `dev-nexus-pharo:local-21` is
  published as `f0027da`; normal create/import now treats Vibe linkage as
  explicit DevNexus-Pharo extension configuration and no longer preserves
  legacy PLexus/Vibe metadata in neutral project imports.
- DevNexus project import extension merge work `dev-nexus:local-142` is
  published as `9fbb9f1`; empty/default same-key extension markers now
  preserve nested extension config, including DevNexus-Pharo
  `plexusProjectConfig` and `imageExecution`, while explicit replacement and
  clearing remain available to callers.
- DevNexus core guardrail work `dev-nexus:local-112` is complete; core now
  rejects plugin MCP tool names that overlap `dev_nexus`.
- `docs/codex-architecture-design-audit-prd.md` records the Codex architecture
  audit. It keeps `codex exec` as the practical default while app-server
  support starts with current JSONL JSON-RPC-lite protocol compatibility,
  capability discovery, event routing, and provider session facts.
- The Codex app-server audit has been sliced into corrective DevNexus work.
  `dev-nexus:local-113` is complete, fixing stdio wire protocol compatibility.
  `local-114` is complete for notification and server-request routing.
  `local-115` is complete for safe capability probes; `local-116` should wait
  until the remaining app-server event and capability facts are stable.
- `docs/dev-nexus-research-plugin-prd.md` records the first planned
  non-engineering DevNexus domain plugin direction. DevNexus-Research should
  support academic research and paper-writing workflows through additive
  skills, setup checks, artifact conventions, integrity gates, and human
  checkpoints. The PRD is sliced: `dev-nexus:local-146` is the blocked
  human-in-the-loop license and upstream ARS integration posture decision;
  `local-147` is complete as `c283c2f` for an original DevNexus-Research plugin
  package skeleton; `local-148` through `local-151` cover projected research
  skills, artifact/setup conventions, optional external ARS Codex skill
  integration, and a dogfood paper-project smoke.
- No active implementation worktrees are expected for the completed source
  batches. The merged worktrees and local branches for `local-126`,
  `local-127`, `local-81`, `local-87`, `local-129`, `local-114`, `local-115`,
  `local-106`, `local-88`, `local-130`, `local-89`, `local-131`, `local-132`,
  `local-90`, `local-91`, `local-133`, `local-92`, and `local-134` were
  removed after publication. `local-94`, `local-107`, and `local-142` are now
  published; their ready leases are closed as merged, their generated helper
  worktrees have been removed, and the old unmerged dogfood metadata branch was
  deleted after confirming its handoff facts are already represented on main.

## Near-Term Direction

- `dev-nexus:local-94` and `dev-nexus:local-107` are now integrated and
  published through `bot/main`. Project-local coordination planning resolved
  `bot-github` authority for both branches; `local-94` merged as `b218118`,
  `local-107` merged as `3753adf`, and post-merge `npm run check` passed in
  `C:\dev\code\sources\dev-nexus` with 64 test files and 575 tests.
- The focused coordination auth-profile fix for the previous mismatch remains
  published as `8735a73`. Active MCP server processes may still need reload
  before their coordination status surfaces reflect the fixed code; use the
  project-local source CLI for authority-sensitive checks until then.
- Keep remote host execution ordered: promote host checks, SSH transport,
  verification execution, or live dogfood smokes only after their dependencies
  on completed `dev-nexus:local-81` are explicit.
- Keep parallel-agent workflow ordered: use completed fail-closed
  shared-checkout mutation enforcement (`local-98`) and read-only cleanup
  classification (`local-102`) before cleanup execution, and keep status
  expansion/start-adopt slices behind their authority dependencies.
- Continue agent-target projection after published `local-109`; `local-111` is
  the dogfood Codex-only migration and should wait for active target filtering
  plus stale cleanup safety.
- Keep `dev-nexus:local-52` and live runtime items blocked until policy or
  runner approval is explicit.
- Promote `local-73` through `local-75` only after their prerequisites are
  satisfied; resolve the full `local-69` umbrella before relying on Windows
  source roots as clean onboarding examples.
- Continue Codex app-server correction after completed `dev-nexus:local-115`
  before worker-thread orchestration, MCP relay expansion, or provider-native
  subagent features.
- DevNexus-Research plugin skeleton work `dev-nexus:local-147` is published as
  `c283c2f` with original placeholder content only. Keep `dev-nexus:local-146`
  blocked until the user decides whether ARS is inspiration-only, optional
  external integration, or bundled/adapted content under an explicit license
  posture. Keep `local-148` through `local-151` ordered behind this skeleton
  and the relevant setup/projection tests.
- Cross-tracker discovery implementation is complete through
  `dev-nexus:local-137` for this dogfood policy: local and GitHub Issues are
  peer discovery sources for configured components, and matching GitHub issues
  can be selected directly without copy/import migration. Provider comments and
  scheduled import are still not automatically enabled. `dev-nexus:local-153`
  is complete for GitHub issue eligibility hygiene: provider-native issues now
  use the same selector convention as local items (`dogfood` plus
  `status:ready` is directly selectable; blocked/unsafe labels exclude) without
  creating local duplicates. Selector-level direct discovery currently returns
  Evref-BL/DevNexus#3, Evref-BL/DevNexus#4, and Evref-BL/DevNexus-Pharo#1 as
  eligible GitHub issues. The authority provider-signal
  follow-on `local-93` is complete. The local tracker auth-profile mismatch
  follow-on `local-152` is
  also complete as `0e86479`; DevNexus-Pharo package-template and legacy Vibe
  metadata fixes `dev-nexus-pharo:local-20` and `local-21` are complete as
  `84a4556` and `f0027da`. DevNexus import extension config preservation
  `dev-nexus:local-142` is complete as `9fbb9f1`. The next cycle should
  re-check eligible work and either promote the next dependency-satisfied
  bounded slice or record the blocker that keeps remaining items out of ready
  state.
- First-user onboarding repair from Nicolas' trial is now complete through the
  local setup model, guided setup CLI, component-add flow, auth inventory,
  hosting handoff, setup readiness report, and CLI/docs skew diagnostics. The
  next cycle should re-check eligible work and pick the next dependency-ready
  bounded slice rather than continuing the completed onboarding batch.

## Boundaries

- Do not create Vibe workspaces, sessions, executions, or workers for
  implementation.
- Do not run live Pharo images, PLexus open/close, Docker, package installs, or
  destructive host cleanup without a current approved isolated runner profile.
- Preserve component source roots and source branches unless a work item
  explicitly owns their migration or deletion.
- The generic DevNexus MCP tools are visible in the active Codex tool
  namespace. Prefer MCP surfaces for read-only inspection, and use guarded CLI
  overrides only when recording integration-owned project-state facts from the
  shared checkout.
