# Approved Runtime Profile: overnight-live-20260517

This profile is the approved disposable runtime boundary for autonomous
DevNexus dogfood work on 2026-05-17.

## Scope

- Docker/Podman is allowed for focused, repo-owned compatibility checks.
- Local dependency repair is allowed inside component source roots and generated
  worktrees when needed for verification, including `npm install` and
  `npm prune`. Do not install global packages.
- Live PLexus, pharo-launcher-mcp, and Pharo image work is allowed only through
  an isolated runner or an equivalent cleanup plan recorded in the work item.
- Live external provider posting remains blocked unless a work item explicitly
  records provider policy approval. Mocked, draft-only, and local-provider flows
  are allowed.

## Paths

- Dogfood root: `C:\dev\code\dev-nexus-dogfood`
- PLexus source: `C:\dev\code\git\PLexus`
- pharo-launcher-mcp source: `C:\dev\code\git\pharo-launcher-mcp`
- DevNexus-Pharo source:
  `C:\dev\code\dev-nexus-control\worktrees\DevNexus-Pharo`
- MCP-Pharo source:
  `C:\Users\gabriel.darbord\Documents\Pharo\images\MCP12-2\pharo-local\iceberg\Evref-BL\MCP`
- PLexus state root:
  `C:\dev\code\dev-nexus-dogfood\.dev-nexus\runtime\plexus\overnight-live-20260517`
- Runtime artifacts:
  `C:\dev\code\dev-nexus-dogfood\.dev-nexus\runtime\artifacts\overnight-live-20260517`
- Launcher profile root:
  `C:\dev\code\dev-nexus-dogfood\.dev-nexus\runtime\pharo-launcher\overnight-live-20260517`

## PLexus Smoke Runner Policy

- Preferred runner:
  `npm run smoke:open-route-close -- --copyFromImageName MCP12-2`
- The runner may copy from `MCP12-2` to generated disposable smoke images.
- Never mutate or delete the source `MCP12-2` image.
- Use generated workspace ids prefixed with `dogfood-overnight`.
- Use generated target ids prefixed with `dogfood-overnight`.
- Use dynamic ports unless a focused test explicitly needs a fixed local port.
- Retain logs, runner output, and failure summaries under the artifact path.
- On failure, clean only recorded routes, processes, temporary directories, and
  disposable image names created by the current runner invocation.
- Do not delete unrelated `PlexusSmoke*` images unless the current runner
  created and recorded them.

## Current Verification Facts

- Docker CLI is available and backed by a reachable Podman engine.
- Component source roots are clean at status level before this profile was
  recorded.
- The pharo-launcher-mcp checkout path is
  `C:\dev\code\git\pharo-launcher-mcp`.
- PLexus workspace links were repaired locally with `npm install`; `npm prune`
  removed stale generated package directories.
- `npm run smoke:open-route-close -- --help` now reaches the runner help path.
- `pharo-launcher-mcp` live smoke passed with this profile state root. It copied
  the launcher image/changes into the disposable profile and passed health,
  version, and validate-installation checks.
- `plexus:local-3` hardened the PLexus smoke runner to require
  `--approvalProfile`, `--launcherProfileRoot`, `--artifactRoot`,
  `--stateRoot`, `--runId`, `--workspaceId`, `--targetId`, and timeout budget
  inputs before live execution. The harness was published as PLexus `5953274`.
- `pharo-launcher-mcp:local-4` fixed isolated launcher profile configuration,
  copied-image metadata repair, and Windows detached launch logging. The fix
  was published as pharo-launcher-mcp `24f6d84`, then released to npm as
  `@evref-bl/pharo-launcher-mcp@0.1.2` from `c137fe9`.
- The approved PLexus live smoke passed as
  `dogfood-overnight-local-3-20260517-0428`: copied `MCP12-2` to an owned
  disposable image, opened the project, routed `find-packages`, closed the
  project, unregistered the route, stopped the process, and deleted the copied
  image. Artifact evidence is retained under
  `C:\dev\code\dev-nexus-dogfood\.dev-nexus\runtime\artifacts\overnight-live-20260517\dogfood-overnight-local-3-20260517-0428`.
- PLexus source `7d34f86` now pins `@evref-bl/pharo-launcher-mcp@^0.1.2`.
  The same approved live smoke passed without a local launcher checkout
  override as `dogfood-overnight-local-3-npm-20260517-0442`, proving the normal
  npm package path can copy, open, route, close, unregister, stop, and delete
  the disposable image. Artifact evidence is retained under
  `C:\dev\code\dev-nexus-dogfood\.dev-nexus\runtime\artifacts\overnight-live-20260517\dogfood-overnight-local-3-npm-20260517-0442`.
