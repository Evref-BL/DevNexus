# Skill Chains

DevNexus skills should compose as workflow verbs. These workflow composition
diagrams show common skill chains, using skills as nodes and decisions as
diamonds. Some skills are frames rather than phases: `dev-nexus` provides
workspace infrastructure, `take-the-lead` changes the collaboration contract
while the user keeps decision authority, and `initiative-workflow` holds a
durable objective and integration surface across slices.

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
  D -->|"no"| G["write-implementation-plan"]
  E --> G
  F --> G
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
  F --> G["write-implementation-plan"]
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
flowchart LR
  A{"Docs scope clear?"}
  A -->|"no"| B["design-with-user"]
  A -->|"yes"| C["prepare-dev-nexus-worktree"]
  B --> C
  C --> D["documentation"]
  D --> E["humanizer"]
  E --> F["verify-before-completion"]
  F --> G{"Review needed?"}
  G -->|"no"| K["finish-dev-nexus-branch"]
  G -->|"yes"| H["request-work-review"]
  H --> I{"Review outcome"}
  I -->|"ready"| K["finish-dev-nexus-branch"]
  I -->|"changes requested"| J["receive-review-feedback"]
  J -. revise .-> D
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
  H --> I["write-implementation-plan"]
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
