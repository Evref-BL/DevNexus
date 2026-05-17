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
  `C:\dev\code\pharo-nexus\PharoNexus-Control\worktrees\MetaPharoNexus`
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
