# Source Topology

DevNexus uses a small root surface and domain folders:

- `src/cli.ts`: package `bin` entrypoint, kept at the source root so it still
  emits `dist/cli.js`.
- `src/index.ts`: package public API barrel, kept at the source root so it
  still emits `dist/index.js`.
- `src/<domain>/`: production modules grouped by feature area.
- `test/<domain>/`: tests grouped beside the feature area they exercise, while
  staying outside the production compile root.

This keeps runtime package entrypoints stable while making the implementation
tree navigable by ownership area. The TypeScript project continues to compile
`src/**/*.ts`, which is the pattern shown in TypeScript's `tsconfig.json`
documentation for selecting project sources. Vitest recursively discovers
`.test.ts` files, and its docs explicitly support either co-located tests or a
dedicated test directory. DevNexus chooses the dedicated `test/` root so test
helpers and fixtures do not ship through `package.json` `files`.

Current production domains:

- `agents`
- `automation`
- `authority`
- `cli`
- `codex-app`
- `coordination`
- `cockpit`
- `extensions`
- `git`
- `hosts`
- `mcp`
- `operations`
- `project`
- `providers`
- `publication`
- `remote-execution`
- `runtime`
- `work-items`
- `worktrees`

The cockpit is still part of the core package while it owns DevNexus-local
contracts, snapshots, routes, and the zero-build local browser client. Its
implementation lives under `src/cockpit`:

- `src/cockpit/client/`: browser UI, interactions, styles, and history widget
  rendering.
- `src/cockpit/server/`: snapshot/model builders, local HTTP routes, server
  registry, cache policy, data contracts, server assets, and chat bridge.
  Keep `nexusDashboard.ts` as a public orchestration facade; host snapshots,
  worktree/thread/plugin/tracked-work summaries, event timelines, and weave
  models belong in focused sibling modules. Keep `nexusDashboardServer.ts` as
  the HTTP wiring facade; request validation belongs in
  `nexusDashboardServerHttp.ts`, workspace selection in
  `nexusDashboardServerWorkspace.ts`, local app opening in
  `nexusDashboardLocalOpen.ts`, browser assets in
  `nexusDashboardServerAssets.ts`, and Codex/thread mutation routes in
  `nexusDashboardServerChatRoutes.ts`. Stable embedding-route contracts belong
  in `nexusDashboardEmbeddingContractTypes.ts`; `nexusDashboardTypes.ts`
  remains the compatibility barrel for snapshot-facing type imports.

The legacy `src/dashboard/` folder is reserved for compatibility facades that
re-export the cockpit server modules under old dashboard-named import paths.
Do not add new implementation there. If the cockpit grows beyond DevNexus-local
contracts and local-control routes, move the product UI into a separate app or
workspace package and keep only the stable data/route contract in core.

Avoid adding new source files directly under `src/` unless they are package
entrypoints. New tests should go under the matching `test/<domain>/` folder.

References:

- TypeScript `tsconfig.json` source selection: https://www.typescriptlang.org/docs/handbook/tsconfig-json
- Vitest test-file discovery and organization: https://main.vitest.dev/guide/learn/writing-tests#test-files
- Node package entrypoints and package encapsulation: https://nodejs.org/api/packages.html
