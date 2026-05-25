# Cockpit History Widget

The cockpit history widget is a reusable history graph. Its first source is
Git, but the model should not be named or shaped around Git alone.

## Purpose

The widget should show how work moved through time:

- which events happened
- which branches or tracks existed in parallel
- where tracks split, continued, or merged
- which human decisions explain or authorize an event

The default view should stay lean. Details should appear on click, expansion, or
focused modes.

## Vocabulary

Use `event` in the visible UI. Use `history event` in the durable model when a
plain `event` would be ambiguous. Avoid `git event` because future sources can
describe events that are not Git commits.

| Term | Meaning |
| --- | --- |
| History event | A durable repository or workspace event, such as a commit. |
| Decision event | A human or policy decision, such as approval, rejection, rescue, or block. |
| Track | A time-ordered path of related events. Git branches are one source of tracks. |
| Instant slice | One horizontal row in the history view. |
| Marker | A compact visual annotation attached to a row or track. |
| Detail row | An expanded row showing supporting events and evidence. |

## Event Classes

Events do not all have the same visual weight.

| Class | Examples | Default rendering |
| --- | --- | --- |
| Source change | commit, generated source update, merge result | Primary row with node, subject, author, time, and hash or id. |
| Decision | approved, rejected, blocked, rescued | Marker or detail attached to the related event. |
| Review | requested review, review completed, changes requested | Marker or detail attached to the related event or track. |
| Publication | pushed, PR opened, merged, released | Marker, detail, or filterable milestone depending on importance. |
| Diagnostic | provider warning, local dirty state, failed check | Detail-only unless it needs human action now. |

Decision events should not become fake Git parents. They are first-class events
in the data model, but lower-weight visual elements in the default view.

## Graph Model

Model the widget as a typed, layered directed graph:

```text
G = (V, E)

V = history events
E = causal, parent, or explanatory relationships
row(v) = ordered instant slice
lane(track, row) = horizontal position of a track at that row
```

Rows represent instants. Tracks represent work streams that can run in parallel,
split, and merge.

Required invariants:

- every visible event has one row
- every active track has at most one lane in a row
- no two active tracks occupy the same lane in the same row
- graph edges are monotone in time
- connector endpoints touch an event node or routed track segment
- lane changes occur in row corridors
- colors belong to tracks, not temporary lane numbers

## Wrapped And Detailed Views

The default view is wrapped:

- one compact row per event
- branch or track geometry stays visible
- important markers appear inline
- no raw JSON-shaped details

The detailed view opens from a selected event:

- parent and child events
- attached decision events
- approving or blocking actor
- related review or provider records
- changed file summary when available
- diagnostics only when useful

This keeps HITL decisions discoverable without promoting every approval or
blocker to a full row in the primary history.

## Layout Responsibilities

Keep topology, layout, and rendering separate.

| Layer | Responsibility |
| --- | --- |
| Source adapters | Convert Git, HITL, provider, and tracker records into canonical history events. |
| Graph builder | Build vertices, edges, tracks, anchors, and event relationships. |
| Layout engine | Assign rows, lanes, colors, route segments, and markers. |
| Renderer | Draw SVG paths, nodes, row labels, markers, hover states, and detail rows. |
| Interactions | Selection, filters, focus modes, detail expansion, and keyboard navigation. |

The VS Code Git Graph project is a useful reference because it separates
vertices, branches, line segments, and rendering. DevNexus should borrow that
shape, not copy the implementation.

## Color Model

Color assignment should be graph coloring over tracks, not `lane % palette`.

Tracks conflict when they:

- are active in the same row interval
- occupy adjacent lanes for a meaningful duration
- cross or merge in nearby corridors
- are semantically related but should remain distinguishable

The layout should minimize:

```text
adjacent_color_similarity
+ color_change_across_refresh
+ conflict_with_status_tone
+ unnecessary_palette_sprawl
```

This gives stable colors across refreshes while avoiding adjacent branch colors
that look too similar.

## Implementation Slices

1. Extract the current Git-only graph builder into a pure history layout module.
2. Rename the primary model from commit/git event language to history event
   language where it is no longer Git-specific.
3. Add fixtures for split, merge, lane reuse, truncated parents, and refresh
   stability.
4. Return explicit layout objects: nodes, tracks, segments, connectors, markers,
   and detail rows.
5. Keep the current visible UI mostly stable while replacing the internal model.
6. Add track color conflict scoring.
7. Add HITL decision events as attached markers and detail content.

## Open Decisions

- Which decision events are important enough to appear as default markers.
- Whether a selected event opens an inline detail row, a side detail panel,
  or both.
- Whether publication events should be markers, rows, or filterable milestones.
- How much file-change detail belongs in the default expanded row.
