# DevNexus quality audit baseline

Date: 2026-05-23

This note defines the quality standard for the DevNexus repository audit before
source or repository-policy changes are made. It is a yardstick, not the final
audit report.

## Scope

The first audit pass covers:

- The primary DevNexus source repository, currently inspected at
  `Evref-BL/DevNexus` `app/main` commit `4050f7749835`.
- This dogfood workspace repository, inspected at `bot/main` commit
  `947c59ff9851`.
- Repository hygiene, including ignored runtime files, package contents,
  documentation health, CI gates, and public contribution files.

Extension components such as DevNexus-Pharo and DevNexus-TypeScript should use
the same standard, but they need separate component-scoped audit records.

## Evidence-backed decisions

| Area | Evidence | DevNexus decision |
| --- | --- | --- |
| Static analysis gate | SonarQube documents Clean as You Code and a recommended quality gate, and SonarScanner CLI can read `sonar-project.properties` or command-line analysis parameters. | Use SonarQube or SonarCloud as a gate on new code first. Existing debt should be measured and triaged, not used to block all work at once. |
| TypeScript coverage | SonarQube supports JavaScript/TypeScript/CSS analysis in all editions, and JavaScript/TypeScript coverage is passed with `sonar.javascript.lcov.reportPaths`. | Add LCOV coverage generation before treating Sonar coverage metrics as meaningful. Do not invent TypeScript-only coverage parameters. |
| TypeScript linting | `typescript-eslint` recommends ESLint flat config and TypeScript-aware rules for TypeScript projects. | Add ESLint with TypeScript-aware rules as a local developer and CI check. Sonar should complement linting, not replace it. |
| Ignore rules | Git's `.gitignore` rules are path-relative and have specific precedence and directory matching behavior. | Keep ignore rules explicit and reviewable. Avoid broad patterns that hide source or docs. Verify with `git check-ignore -v` when adding generated paths. |
| npm package contents | npm documents that the `package.json` `files` allowlist controls package contents and cannot be overridden by root `.npmignore` or `.gitignore`; `npm pack --dry-run` shows package contents. | Prefer `files` allowlists for published packages and keep `npm pack --dry-run` in publication validation. |
| Package entrypoints | Node documents the package `"type"` field and `"exports"` target rules. | Keep package entrypoints explicit: `type`, `main`, `types`, `bin`, and `exports` must match built artifacts. |
| Repository health | GitHub community profiles check recommended files such as README, license, contributing, code of conduct, security policy, and issue templates. GitHub README guidance says a README should explain what the project does, why it is useful, how to get started, where to get help, and who maintains it. | Treat community health files as repository quality, not cosmetic polish. Missing files become explicit audit findings for public repositories. |
| Security and supply chain checks | GitHub code scanning can annotate pull requests and be required by branch protection. OpenSSF Scorecard documents automated repository security health checks and remediation guidance. | Use CodeQL or another code scanning configuration for security findings, and use Scorecard as a repository-health signal. Do not rely on Sonar alone for supply-chain posture. |

## Current observations

Primary DevNexus source at `app/main` currently has:

- 324 tracked files.
- 149 non-test TypeScript files under `src/`.
- 113 TypeScript test files under `src/`.
- CI workflows for `npm ci` plus `npm run check` on Ubuntu, Windows, and macOS.
- A docs site workflow for Docusaurus.
- An npm publication workflow that runs `npm run check` and `npm pack --dry-run`.
- `package.json` package metadata with `type`, `bin`, `main`, `exports`,
  `types`, `files`, `engines`, and public publish config.
- No tracked `node_modules`, `dist`, `.DS_Store`, `.env`, `.cache`,
  `.dev-nexus/runtime`, or `worktrees` paths found by the tracked-file scan.
- No tracked `sonar-project.properties` found.
- No tracked ESLint config found.
- No tracked `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `CODEOWNERS`, or GitHub issue template found by the
  initial tracked-file scan.

The dogfood workspace repository currently has:

- Tracked workspace metadata, context, plans, local archive work-item stores, and
  docs.
- Ignore rules for generated agent support, local runtime state, worktrees,
  local MCP/Codex config, and `.DS_Store`.
- Ignored `.DS_Store` files present on disk. They are not tracked, but local
  cleanup is still useful when filesystem clutter affects tools or reviews.

One policy mismatch needs a follow-up check: the dogfood target state says
green-main validation requires Node 24 checks, while the current DevNexus CI
workflow uses Node 22 and `package.json` declares `node >=22`.

## Audit standard

### Source topology

- Runtime output belongs outside tracked source unless it is intentionally
  committed as product input.
- Top-level directories should communicate purpose: source, tests, docs,
  scripts, website, plugins, and workflow configuration.
- Plugin packages should own their package metadata, tests, fixtures, and skill
  assets instead of leaking plugin-specific files into core source directories.
- If import graph analysis shows broad hubs or cycles, split by product boundary
  rather than by arbitrary utility buckets.

### Git and ignored files

- `.gitignore` should cover OS noise, dependency installs, build output,
  coverage output, runtime state, local credentials, and workspace-local
  worktrees.
- Ignore rules should be narrow enough that source, docs, fixtures, examples,
  and generated files that are intentionally versioned remain visible.
- Audits should include both tracked-file scans and ignored-file scans:

```bash
git ls-files | rg '(^|/)(node_modules|dist|coverage|\.env|\.cache|\.DS_Store|worktrees)(/|$)'
git status --short --ignored
git check-ignore -v <path>
```

### TypeScript and tests

- `tsc --noEmit` or an equivalent build gate must run in CI.
- Unit tests and smoke checks should run through `npm run check` or a similarly
  obvious command.
- Coverage must be generated before a coverage gate is enforced.
- ESLint with TypeScript-aware rules should run locally and in CI once the
  configuration is added.

### SonarQube setup

Sonar should be introduced as configuration plus CI integration, not as an
ad hoc local-only report.

Required decisions before enabling the scanner:

- SonarQube Server or SonarCloud project identity.
- Where `SONAR_HOST_URL` and token secrets live.
- Whether branch and pull-request decoration are available for this repository.
- Initial new-code gate thresholds.
- Initial exclusions for generated files, test fixtures, plugin templates, and
  docs.

Candidate scanner inputs for the primary source repository:

```properties
sonar.projectKey=evref-bl_dev-nexus
sonar.projectName=DevNexus
sonar.sources=src,plugins/dev-nexus-research/src
sonar.tests=src,plugins/dev-nexus-research/test
sonar.test.inclusions=src/**/*.test.ts,plugins/dev-nexus-research/test/**/*.test.ts
sonar.javascript.lcov.reportPaths=coverage/lcov.info,plugins/dev-nexus-research/coverage/lcov.info
sonar.sourceEncoding=UTF-8
```

These values need validation against the final coverage layout and plugin
publication decisions.

Do not start a local SonarQube server with Docker from this dogfood workspace
without an approved isolated runner profile. The current workspace policy gates
Docker and live runtime operations.

### Repository health

For public or contributor-facing repositories, the audit should verify:

- README purpose, install path, quick start, help path, and maintainer signal.
- License file, not only a `package.json` license field.
- Security policy.
- Contribution guide.
- Code of conduct when community contributions are expected.
- Issue and pull request templates.
- CODEOWNERS or another ownership signal for review routing.
- Branch protection expectations and required checks.
- Code scanning and dependency or supply-chain checks.
- Published package allowlist and `npm pack --dry-run` output.

## First audit checklist

Run these checks before proposing source changes:

```bash
git fetch --all --prune
git status --short --branch
git ls-files | rg '(^|/)(node_modules|dist|coverage|\.env|\.cache|\.DS_Store|worktrees)(/|$)'
rg --files -g 'sonar-project.properties' -g 'eslint.config.*' -g '.eslintrc*'
npm ci
npm run check
npm pack --dry-run
```

Then add tool-specific checks as configuration lands:

```bash
npm run lint
npm run coverage
sonar-scanner -Dsonar.host.url="$SONAR_HOST_URL" -Dsonar.token="$SONAR_TOKEN"
```

## Next work slices

1. Create a component-scoped DevNexus source audit issue or handoff with this
   baseline as the reference.
2. Add or propose ESLint and coverage generation for the primary DevNexus
   package.
3. Add a reviewed Sonar scanner configuration and CI job once the Sonar
   project and credentials are chosen.
4. Open repository-health findings for missing public project files.
5. Resolve the Node 22 versus Node 24 validation-policy mismatch.
6. Run import graph and TypeScript diagnostics from a fresh source worktree, then
   record architecture findings separately from mechanical hygiene findings.

## Sources

- [SonarQube quality standards and Clean as You Code](https://docs.sonarsource.com/sonarqube-server/10.8/core-concepts/clean-as-you-code/about-quality-standards)
- [SonarScanner CLI documentation](https://docs.sonarsource.com/sonarqube-server/analyzing-source-code/scanners/sonarscanner)
- [SonarQube JavaScript, TypeScript, and CSS analysis](https://docs.sonarsource.com/sonarqube-server/analyzing-source-code/languages/javascript-typescript-css)
- [SonarQube JavaScript and TypeScript coverage](https://docs.sonarsource.com/sonarqube-server/9.8/analyzing-source-code/test-coverage/javascript-typescript-test-coverage)
- [Git gitignore documentation](https://git-scm.com/docs/gitignore)
- [npm package.json files and ignores](https://docs.npmjs.com/cli/v8/configuring-npm/package-json/)
- [Node.js package documentation](https://nodejs.org/api/packages.html)
- [typescript-eslint getting started](https://typescript-eslint.io/getting-started/)
- [GitHub README documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
- [GitHub community profile documentation](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories)
- [GitHub code scanning alerts](https://docs.github.com/en/code-security/concepts/code-scanning/about-code-scanning-alerts)
- [OpenSSF Scorecard](https://github.com/ossf/scorecard)
