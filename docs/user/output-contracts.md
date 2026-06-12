# Output contracts

DevNexus commands and MCP tools that can produce large status trees should use a
compact result by default. Full output stays available through an explicit
option.

## Compact result envelope

The shared compact envelope is `dev-nexus.result.compact.v1`.

```json
{
  "ok": true,
  "contract": "dev-nexus.result.compact.v1",
  "mode": "compact",
  "kind": "work_item_discovery_status",
  "summary": {},
  "stats": {},
  "findings": [],
  "omitted": [],
  "retrieval": [],
  "nextCursor": null
}
```

Use the fields this way:

- `summary`: the shortest useful human and agent-readable status.
- `stats`: counts and totals needed to decide what to inspect next.
- `findings`: the highest-signal warnings, blockers, or top items.
- `omitted`: counts and reasons for data left out of the compact result.
- `retrieval`: commands or MCP calls that return the full data.
- `nextCursor`: a cursor when the compact result is paginated.

Compact defaults should not include raw logs, full provider payloads, complete
work item dumps, large status trees, or verbose generated configuration.

## Full output escape hatches

Each migrated command or tool must keep a documented full-output path.

- CLI commands can use `--json=full`, `--raw`, or `--verbose` when appropriate.
- MCP tools can use `detail: "full"` when the tool supports `detail`.
- Retrieval hints in compact output should point to the exact full-output path.

`--json` on a migrated high-volume CLI command means compact JSON. Use
`--json=full` when callers need the old full tree.

## First migrated surface

`dev-nexus work-item discovery-status <workspace-root> --json` now returns the
compact envelope by default. Use this command for the full tree:

```bash
dev-nexus work-item discovery-status <workspace-root> --json=full
```

The MCP tool `work_item_discovery_status` follows the same contract. Its default
result is compact. Pass `detail: "full"` for the full discovery status tree.

## Subprocess output

DevNexus should reduce output at the highest structured layer that owns the
data.

Use direct structured output when DevNexus owns the data model, for example a
CLI or MCP command that can return a compact result envelope plus a full
retrieval path.

Use built-in preview compression when DevNexus only has captured subprocess
streams. The automation command runner keeps the existing bounded stdout and
stderr preview behavior as the fallback path.

Use RTK or Snip output filtering only when a command-runner policy explicitly
selects known noisy commands. Filtering is presentation-only: DevNexus still
executes the configured command directly and then filters the captured stdout
and stderr files. A future execution-wrapper policy would be required before
DevNexus may run the original command through another executable.

The automation executor supports `automation.executor.outputFilter`:

```json
{
  "automation": {
    "executor": {
      "outputFilter": {
        "enabled": true,
        "commandExecutables": ["git", "npm"],
        "commandPrefixes": ["npm test", "npm run check"],
        "preferTools": ["rtk", "snip"],
        "preserveRawOutputDirectory": ".dev-nexus/automation/command-output"
      }
    }
  }
}
```

`commandExecutables` matches an executable name, basename, absolute path, or
`"*"` for every executor command. `commandPrefixes` matches the display command
or its leading words. `preferTools` is tried in order. RTK uses `rtk log
<captured-file>` so it filters captured output without changing command
semantics. Snip is optional; if it is missing or fails, DevNexus falls back to
the raw bounded preview.

Set `preserveRawOutputDirectory` when raw stdout and stderr files should remain
available for debugging. Keep that directory ignored or otherwise outside
tracked workspace state unless the artifacts are intentionally published.
