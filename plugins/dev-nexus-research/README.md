# DevNexus Research

DevNexus Research is an additive domain plugin skeleton for research-project
workflows. It contributes generic DevNexus plugin capabilities, placeholder
research guidance, and artifact conventions. It does not add research-specific
behavior to DevNexus core.

The baseline package is intentionally no-network and no-runtime:

- projected skill: `research-workflow-router`
- setup obligation: declared source and citation policy
- environment hints: research artifact directory and source manifest path
- worker context: human research boundary and evidence integrity
- worker briefing: baseline research artifact conventions

DevNexus still owns generic project configuration, tracker access, worktrees,
coordination records, target cycles, and publication policy. The plugin only
adds research-domain context for projects that opt into it.

## Boundaries

- This skeleton contains original placeholder guidance only.
- It does not vendor or adapt upstream Academic Research Skills content.
- It does not call external search, citation, export, Zotero, or document
  rendering services.
- It should not be enabled in the dogfood root until setup and projection
  behavior has been tested for a research project.

## Verification

Run package checks from the repository root:

```bash
npm --prefix plugins/dev-nexus-research run check
```

The package also ships a static fixture at
`fixtures/dev-nexus-research.project.json` that validates the plugin capability
shape through DevNexus core.
