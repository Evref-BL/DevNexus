# Agent-client plugin compatibility

This note records the implementation assumptions for DevNexus agent-client
plugins. It supports the Codex and Claude adapter feature tracked by
Evref-BL/DevNexus#183 and the compatibility-matrix change tracked by
Evref-BL/DevNexus#207.

The product direction is stable: DevNexus stays the external runtime, npm
package, command-line interface (CLI), and Model Context Protocol (MCP) server.
Codex and Claude plugins are thin adapters that teach each client how to expose
DevNexus safely.

## Status legend

- Confirmed: documented in official Codex or Claude documentation, or already
  implemented in DevNexus source.
- Local confirmed: documented by local Codex plugin scaffolding or dogfood
  source, but still worth validating in an installed client.
- Unknown: do not build a hard dependency until a prototype or live client
  smoke confirms it.
- Human-in-the-loop (HITL): needs explicit user approval before publication,
  package installation, live-client execution, credential work, or distribution.

## Compatibility matrix

### Plugin manifest

- Codex: Confirmed. Codex build docs use `.codex-plugin/plugin.json`; the local
  scaffold matches this shape.
- Claude Code: Confirmed. Claude plugins use `.claude-plugin/plugin.json`.
- DevNexus requirement: ship client-specific manifests; do not force one client
  schema into the other.

### Skills

- Codex: Confirmed. Codex plugins can bundle skills, and installed plugins or
  bundled skills can be invoked explicitly with `@`.
- Claude Code: Confirmed. Claude plugin skills live under
  `skills/<name>/SKILL.md` and are namespaced by plugin name.
- DevNexus requirement: put setup/status/refresh/handoff guidance in skills
  first; keep context progressive.

### Slash commands or workflow commands

- Codex: Unknown for adapter packaging beyond documented plugin skills and
  Codex app/CLI command surfaces.
- Claude Code: Confirmed. Claude plugins can include `commands/`; docs
  recommend `skills/` for new plugins.
- DevNexus requirement: use skills as the portable baseline. Add command
  aliases only where each client clearly supports them.

### MCP servers

- Codex: Confirmed. Codex supports local STDIO MCP servers and streamable HTTP
  MCP servers, with configuration in shared `config.toml` or project
  `.codex/config.toml` for trusted projects.
- Claude Code: Confirmed. Claude plugins can include `.mcp.json` at the plugin
  root.
- DevNexus requirement: adapter MCP config should call a wrapper that resolves
  the DevNexus runtime. Do not copy MCP server logic into plugins.

### Local plugin development

- Codex: Confirmed. Codex build docs support repo and personal marketplaces,
  local marketplace roots, and manual plugin creation.
- Claude Code: Confirmed. Claude supports `claude --plugin-dir ./plugin` and
  `/reload-plugins` for local testing.
- DevNexus requirement: build local prototypes before marketplace or workspace
  sharing.

### Distribution scopes

- Codex: Confirmed. Codex supports plugin directory install, repo or personal
  marketplace entries, and workspace sharing from the app.
- Claude Code: Confirmed. Claude `plugin install` supports user, project, and
  local scopes.
- DevNexus requirement: start with local dogfood distribution; require HITL
  approval before workspace sharing or public marketplace release.

### Persistent plugin data

- Codex: Unknown. Codex docs in scope do not establish a plugin-local persistent
  data directory equivalent to Claude's.
- Claude Code: Confirmed. Claude exposes `${CLAUDE_PLUGIN_DATA}` and uninstall
  can remove it unless `--keep-data` is used.
- DevNexus requirement: do not depend on plugin-local Codex package installs
  yet. Runtime resolver must support existing, source-current, project-local,
  and explicit manual-global modes first.

### Plugin dependencies

- Codex: Unknown for adapter packages in the current docs.
- Claude Code: Confirmed. Claude plugins can declare dependencies;
  cross-marketplace dependency installation is guarded.
- DevNexus requirement: keep DevNexus domain plugins independent. Do not rely on
  transitive client-plugin dependency resolution for the baseline.

### Package install during setup

- Codex: Unknown for plugin-local installs; normal MCP commands can run local
  processes.
- Claude Code: Confirmed as possible through hooks, but it must be explicit and
  use plugin data, not the versioned plugin root.
- DevNexus requirement: setup must be advisory first. No silent
  `npm install -g`, shell profile edit, credential write, or provider mutation
  during plugin install.

### Approval and permissions

- Codex: Confirmed. Codex plugin installs do not bypass existing approval
  settings, and bundled MCP servers may need extra setup or authentication.
- Claude Code: Confirmed in shape; plugin hooks, monitors, and executables
  require care because they can run local commands.
- DevNexus requirement: DevNexus policy still gates write tools. Plugin
  adapters must expose mutation class and recovery steps.

### Uninstall or disable

- Codex: Confirmed. Codex uninstall removes the plugin bundle; bundled apps can
  remain installed in ChatGPT.
- Claude Code: Confirmed. Claude uninstall can remove plugin data unless
  `--keep-data`; disable leaves the plugin installed.
- DevNexus requirement: disabling or uninstalling the adapter must not delete
  DevNexus workspace state.

### Live-client smoke

- Codex: HITL. Requires running installed Codex plugin flows in the user's
  client.
- Claude Code: HITL. Requires running Claude Code with local plugin or installed
  plugin.
- DevNexus requirement: automated no-network fixture tests come first. Live
  client tests need approval.

## Implementation consequences

- Build two adapter packages or manifests, one for Codex and one for Claude,
  backed by shared DevNexus adapter support code where that code is client
  neutral.
- Treat skills as the common workflow surface. Commands can be added later where
  a client makes the behavior explicit and testable.
- Keep runtime resolution outside the manifest. The manifest should point at a
  wrapper; the wrapper should decide whether to use an existing `dev-nexus`,
  a source-current CLI path, a project-local runtime, a plugin-local runtime
  where supported, or an explicit manual global install.
- Make setup and doctor commands advisory before mutation. They should report
  Node.js, npm, selected DevNexus runtime, version skew, workspace root, active
  agent targets, MCP config path, planned file writes, package operations, and
  provider operations.
- Keep plugin-local installation optional. Claude has a documented data
  directory; Codex plugin-local dependency persistence is still unknown for this
  feature until a prototype confirms it.
- Keep domain plugins separate. DevNexus-TypeScript, DevNexus-Pharo, and
  DevNexus-Research should continue to declare DevNexus plugin capabilities,
  while agent-client adapters expose DevNexus itself to Codex or Claude.
- Do not use plugins to choose work or supervise implementation. DevNexus
  remains infrastructure; the user or coordinator agent chooses and drives work.

## Follow-up issues

- #208: shared DevNexus runtime resolver.
- #209: adapter command wrapper and setup plan.
- #210: Codex local plugin prototype.
- #211: Claude local plugin prototype.
- #212: setup and doctor integration.
- #213: lean MCP profile and context budget.
- #214: distribution, security, and uninstall policy.
- #215: end-to-end dogfood smoke.

## Sources

- OpenAI Codex plugins: https://developers.openai.com/codex/plugins
- OpenAI Codex build plugins: https://developers.openai.com/codex/plugins/build
- OpenAI Codex MCP: https://developers.openai.com/codex/mcp
- OpenAI MCP guide: https://developers.openai.com/api/docs/mcp
- OpenAI Docs MCP: https://developers.openai.com/learn/docs-mcp
- OpenAI Codex plan and workspace controls:
  https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan
- Claude Code create plugins: https://code.claude.com/docs/en/plugins
- Claude Code plugins reference:
  https://code.claude.com/docs/en/plugins-reference
- Claude Code plugin dependencies:
  https://code.claude.com/docs/en/plugin-dependencies
