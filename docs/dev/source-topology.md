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
- `dashboard`
- `extensions`
- `git`
- `hosts`
- `integrations/vibe-kanban`
- `mcp`
- `operations`
- `project`
- `providers`
- `publication`
- `remote-execution`
- `runtime`
- `work-items`
- `worktrees`

Avoid adding new source files directly under `src/` unless they are package
entrypoints. New tests should go under the matching `test/<domain>/` folder.

References:

- TypeScript `tsconfig.json` source selection: https://www.typescriptlang.org/docs/handbook/tsconfig-json
- Vitest test-file discovery and organization: https://main.vitest.dev/guide/learn/writing-tests#test-files
- Node package entrypoints and package encapsulation: https://nodejs.org/api/packages.html
