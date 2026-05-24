# Agent Guide For DevNexus Source

This is the source repository for the DevNexus npm package. DevNexus is
language-neutral infrastructure for agent workspaces, components, trackers,
worktrees, automation state, MCP tools, and publication policy.

## Repository Map

- `src/` contains TypeScript source. Keep runtime code under domain
  subdirectories such as `automation/`, `project/`, `work-items/`,
  `publication/`, `dashboard/`, `mcp/`, and `cli/`.
- `test/` mirrors source domains with Vitest tests.
- `plugins/dev-nexus-research/` is an npm workspace plugin with its own source,
  tests, and package metadata.
- `scripts/` contains repository-local development and smoke tooling.
- `docs/user/` is user-facing documentation. `docs/dev/` is maintainer and
  design documentation.
- `website/` contains the Docusaurus site and has its own dependency install.
- Generated build output lives in `dist/`; do not edit it by hand.

## Working Rules

- Preserve unrelated user changes. Inspect `git status --short --branch` before
  editing and stage only files owned by the current task.
- Prefer existing module boundaries and helper APIs over new abstractions.
- Keep changes narrow. Do not mix quality refactors, feature behavior, docs, and
  generated metadata unless the task explicitly owns that combination.
- Use `rg` or `rg --files` for repository search.
- Use `apply_patch` for manual source edits.
- Do not commit secrets, tokens, local paths from private machines, or runtime
  artifacts.

## Development Commands

- Install dependencies with `npm install`.
- Build with `npm run build`.
- Run all standard checks with `npm run check`.
- Run focused tests with `npm test -- <test-file>`.
- Run plugin checks with `npm run check:plugins`.
- Build docs only when docs or website files changed, from `website/` with
  `npm ci` then `npm run build`.

## Quality Checks

- Run focused tests for the code you touch, then `npm run check` before handing
  off source changes.
- For Sonar-driven quality work, run `npm run quality:sonar-local`. It uses
  Docker to start a temporary local SonarQube Community Build server, runs the
  scanner, evaluates a lenient local gate, and removes its container, network,
  and `.scannerwork` output afterward.
- The local Sonar gate blocks bugs, vulnerabilities, missing coverage, and high
  duplication. Existing critical/blocker code smells are refactor debt unless
  the current task explicitly raises them to blockers.
- Do not add the local Sonar Docker scan to normal build/test scripts; it is
  intentionally opt-in for quality audits and agent quality work.
- If a Sonar run is interrupted, clean resources named `devnexus-sonar-*`
  before finishing the task.

## Documentation

- Update docs when behavior, commands, setup, public policy, or user-facing
  workflows change.
- Keep README content short and link deeper details into `docs/user/` or
  `docs/dev/`.
- Keep design/history documents out of the active path unless the task names
  them directly.

## CI And Publication

- `.github/workflows/ci.yml` is the normal build/test gate.
- `.github/workflows/sonar.yml` is optional SonarQube analysis. It runs only
  after a maintainer configures the GitHub Actions secret `SONAR_TOKEN` and,
  for SonarQube Cloud, the repository variable `SONAR_ORGANIZATION`.
- The npm package is published from `dist/` and selected docs/scripts through
  `package.json` `files`; do not add internal audit tooling to the package
  payload unless it is intentionally public.
- Agents should not merge, publish, or change workflow files with unsanctioned
  credentials. If GitHub rejects a workflow update for missing `workflow` scope,
  stop for human-in-the-loop action.

## Nested Instructions

Add a nested `AGENTS.md` only when a subtree has materially different build,
test, safety, or ownership rules. Keep this root file as the default source
guide and put specialized instructions as close as possible to the specialized
code.
