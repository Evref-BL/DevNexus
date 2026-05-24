# Plugin source notes

Status: parked. These notes record marketplace research for later; they are
not active cockpit scope.

## What mature plugin ecosystems do

- VS Code scans published extension packages, uses runtime security guidance,
  and separates trust in the workspace from trust in the extension.
- Chrome extensions expose install-time and optional permissions. Broad access
  can trigger deeper review, and policy violations can block publication.
- JetBrains Marketplace reviews new plugins and updates, uses Plugin Verifier
  for compatibility, and supports plugin signing.
- Figma requires network domains in the plugin manifest when plugins make
  network requests.
- Obsidian keeps community plugins behind Restricted mode and warns users that
  sensitive vaults need independent plugin review.
- WordPress keeps an open plugin directory, but directory plugins must satisfy
  code, license, privacy, and external-service rules.

## DevNexus takeaway

DevNexus plugins are higher risk than most UI-only extensions because they can
shape worktrees, skills, MCP servers, setup checks, credentials, provider
actions, and assistant behavior. A full public marketplace should wait for:

- signed or pinned artifacts
- an explicit capability manifest
- install separate from enable
- permission diffs on update
- admin allowlists, denylists, and private catalogs
- a revocation path
- setup commands behind an approved runner profile

## Current small step

The cockpit can surface curated DevNexus plugin catalogue entries and copy a
`dev-nexus workspace plugin refresh ... --from ... --export ...` command. It
does not scan component source roots for plugin packages, run package installs,
or run setup from the browser.

## Sources

- [VS Code extension runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)
- [VS Code Workspace Trust extension guide](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- [Chrome Web Store extension permissions](https://support.google.com/chrome_webstore/answer/186213)
- [Chrome Web Store policy troubleshooting](https://developer.chrome.com/docs/webstore/troubleshooting/)
- [JetBrains plugin signing](https://plugins.jetbrains.com/docs/intellij/plugin-signing.html)
- [JetBrains Marketplace approval guidelines](https://www.jetbrains.com/legal/docs/plugins_site/approval-guidelines/1.1/)
- [Figma plugin manifest](https://developers.figma.com/docs/plugins/manifest/)
- [Obsidian plugin security](https://obsidian.md/help/plugin-security)
- [WordPress plugin directory guidelines](https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/)
