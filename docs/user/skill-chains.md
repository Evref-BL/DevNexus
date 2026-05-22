# Skill Chains

DevNexus skills should compose as workflow verbs. These workflow composition
diagrams show common skill chains, using skills as nodes and decisions as
diamonds. The diagrams are supporting maps; the skill text carries the compact
rules agents should follow when the diagrams are not rendered. `take-the-lead`
should actively route work through these chains instead of treating them as
background documentation.

Some skills are frames rather than phases: `dev-nexus` provides workspace
infrastructure, `take-the-lead` changes the collaboration contract while the
user keeps decision authority, and `initiative-workflow` holds a durable
objective, delivery topology, and integration surface across slices.

Use the sizing vocabulary in [Concepts](concepts.md#work-sizing-terms) when a
chain needs to classify work. In this page, `slice` means an independently
reviewable vertical increment, and `delivery topology` means the Git and review
route used by slice branches.

```mermaid
flowchart LR
  DN["dev-nexus"] -. workspace .-> Chain["skill chain"]
  Lead["take-the-lead"] -. collaboration .-> Chain
  Initiative["initiative-workflow"] -. durable objective .-> Chain
```

The decision skills have distinct roles:

- `design-with-user` shapes unclear work collaboratively.
- `grill-me` stress-tests an existing plan by asking one decision-tree question
  at a time.
- `grill-with-docs` stress-tests an existing plan against code, glossary terms,
  domain docs, and Architecture Decision Records.

```mermaid
flowchart TD
  Start{"What kind of decision work?"}
  Start -->|"unclear goal or shape"| Design["design-with-user"]
  Start -->|"existing plan, general assumptions"| Grill["grill-me"]
  Start -->|"existing plan, project evidence needed"| GrillDocs["grill-with-docs"]
  GrillDocs --> Docs["documentation"]
  GrillDocs --> ADR["architecture-review"]
```

## Delegation Overlay

`parallel-work-dispatch` is an optional branch on any substantial chain, not a
separate workflow that only starts when the user says "subagents". Under
`take-the-lead`, the agent should decide whether delegation is useful after a
chain exposes independent domains.

Use `parallel-work-dispatch` when there are separate components, disjoint files,
separate tracker items, independent failures, or separate artifacts with clear
write scopes and verification paths. Skip it for small direct tasks, tightly
coupled edits, tasks blocked by one decision, or work that would force workers
into the same mutable files.

```mermaid
flowchart TD
  A["active skill chain"] --> B{"Independent domains?"}
  B -->|"yes, useful sidecar work"| C["parallel-work-dispatch"]
  C --> D["review returned work"]
  D --> E["integrate and verify"]
  B -->|"no or overhead too high"| F["continue inline"]
```

## Git Delivery Topologies

For Git-backed initiatives, choose the delivery topology before
`prepare-dev-nexus-worktree`. The topology tells agents how slice branches reach
the integration surface; it is separate from the initiative objective and
tracker anchor.

Use the smallest topology that preserves reviewability:

- Direct slice topology: short-lived slice branches or pull requests target the
  final integration branch. This is the default when slices can land
  independently.
- Stacked slice topology: dependent slice branches target the branch below them
  and land bottom-up or retarget as dependencies land.
- Initiative integration branch topology: slice branches target one approved
  long-lived initiative branch. Use it only after human-in-the-loop (HITL)
  approval when partial publication would be incoherent or unsafe.
- Throw-away integration branch topology: ready branches meet temporarily for
  compatibility rehearsal. Do not base new work on that branch.
- Release or version topology: follow the workspace release policy instead of
  treating a release train as automatic permission to batch unrelated work.

```mermaid
flowchart TD
  A{"Git-backed initiative?"}
  A -->|"no"| Artifact["choose artifact or tracker surface"]
  A -->|"yes"| B{"Can slices land independently?"}
  B -->|"yes"| Direct["direct slice topology"]
  B -->|"dependent sequence"| Stacked["stacked slice topology"]
  B -->|"partial state unsafe"| Approval["HITL approval"]
  Approval --> Initiative["initiative integration branch topology"]
  B -->|"compatibility rehearsal"| Throwaway["throw-away integration branch topology"]
  Direct --> Worktree["prepare-dev-nexus-worktree"]
  Stacked --> Worktree
  Initiative --> Worktree
  Throwaway --> Verify["verify integration only"]
```

## Feature Implementation

Use this chain when the request changes behavior or adds a capability.

```mermaid
flowchart TD
  A{"Request bounded?"}
  A -->|"no"| B["triage"]
  A -->|"yes"| C["design-with-user"]
  B --> C
  C --> D{"Needs challenge?"}
  D -->|"general plan"| E["grill-me"]
  D -->|"docs, ADRs, or code reality"| F["grill-with-docs"]
  D -->|"no"| T["select delivery topology"]
  E --> T
  F --> T
  T --> G["write-implementation-plan"]
  G --> H["prepare-dev-nexus-worktree"]
  H --> I["tdd"]
  I --> J["verify-before-completion"]
  J --> K["request-work-review"]
  K --> L{"Review outcome"}
  L -->|"changes requested"| M["receive-review-feedback"]
  M --> I
  L -->|"ready"| N["finish-dev-nexus-branch"]
```

## Bugfix

Use this chain when the work starts from a failure, regression, or unexpected
behavior. The chain starts with diagnosis; the fix should not outrun the
reproduction.

```mermaid
flowchart TD
  A["triage"] --> B["prepare-dev-nexus-worktree"]
  B --> C["diagnose"]
  C --> D{"Root cause isolated?"}
  D -->|"no"| C
  D -->|"yes"| E["tdd"]
  E --> F["verify-before-completion"]
  F --> G["request-work-review"]
  G --> H{"Review outcome"}
  H -->|"changes requested"| I["receive-review-feedback"]
  I --> E
  H -->|"ready"| J["finish-dev-nexus-branch"]
```

## Architecture Change

Use this chain when the work changes boundaries, contracts, dependency
direction, or long-lived structure.

```mermaid
flowchart TD
  A["zoom-out"] --> B["architecture-review"]
  B --> C{"Decision needs pressure?"}
  C -->|"docs, ADRs, or code reality"| D["grill-with-docs"]
  C -->|"general assumptions"| E["grill-me"]
  C -->|"no"| F["architecture-deepening"]
  D --> F
  E --> F
  F --> T["select delivery topology"]
  T --> G["write-implementation-plan"]
  G --> H["prepare-dev-nexus-worktree"]
  H --> I["tdd"]
  I --> J["verify-before-completion"]
  J --> K["request-work-review"]
  K --> L{"Review outcome"}
  L -->|"changes requested"| M["receive-review-feedback"]
  M --> F
  L -->|"ready"| N["finish-dev-nexus-branch"]
```

## Documentation Change

Use this chain when the output is user-facing or maintainer-facing prose.

```mermaid
flowchart TD
  A{"Docs scope clear?"}
  A -->|"no"| B["design-with-user"]
  A -->|"yes"| C["prepare-dev-nexus-worktree"]
  B --> C
  C --> D["documentation"]
  D --> E["humanizer"]
  E --> F["verify-before-completion"]
  F --> G{"Review needed?"}
  G -->|"yes"| H["request-work-review"]
  H --> I{"Review outcome"}
  I -->|"changes requested"| J["receive-review-feedback"]
  J -. revise .-> D
  I -->|"ready"| K["finish-dev-nexus-branch"]
  G -->|"no"| K
```

## Plan To Published Version

Use this chain when a version, release train, or broad initiative needs to move
from planning through multiple slices to a publishable result. The per-slice
section expands each mode into separate skill nodes instead of hiding multiple
skills in one box.

```mermaid
flowchart TD
  A["initiative-workflow"] --> B["zoom-out"]
  B --> C["design-with-user"]
  C --> D{"Needs challenge?"}
  D -->|"general plan"| E["grill-me"]
  D -->|"docs, ADRs, or code reality"| F["grill-with-docs"]
  D -->|"no"| G["to-prd"]
  E --> G
  F --> G
  G --> H["to-issues"]
  H --> T["select delivery topology"]
  T --> I["write-implementation-plan"]
  I --> J{"Independent slices?"}
  J -->|"yes"| K["parallel-work-dispatch"]
  J -->|"no"| L["execute-initiative-plan"]
  K --> S0
  L --> S0

  subgraph Slice["repeat for each version slice"]
    S0["prepare-dev-nexus-worktree"] --> S1{"Slice mode"}
    S1 -->|"feature"| S2["tdd"]
    S1 -->|"bugfix"| S3["diagnose"]
    S3 --> S4["tdd"]
    S1 -->|"documentation"| S5["documentation"]
    S5 --> S6["humanizer"]
    S1 -->|"architecture"| S7["architecture-review"]
    S7 --> S8["architecture-deepening"]
    S2 --> S9["verify-before-completion"]
    S4 --> S9
    S6 --> S9
    S8 --> S9
    S9 --> S10["request-work-review"]
    S10 --> S11{"Review outcome"}
    S11 -->|"changes requested"| S12["receive-review-feedback"]
    S12 --> S1
    S11 -->|"ready"| S13["finish-dev-nexus-branch"]
  end

  S13 --> V{"All version scope ready?"}
  V -->|"no"| S0
  V -->|"yes"| W["verify-before-completion"]
  W --> X["request-work-review"]
  X --> Y{"Release approved?"}
  Y -->|"changes requested"| Z["receive-review-feedback"]
  Z --> S0
  Y -->|"approved"| AA["finish-dev-nexus-branch"]
```
