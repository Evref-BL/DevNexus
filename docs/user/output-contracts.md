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
