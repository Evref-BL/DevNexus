# DevNexus Operating Model

DevNexus is the project control plane around one or more component repositories.
It records durable facts, exposes safe tooling, projects agent setup, and gates
mutations. Humans and coordinator agents still choose what work to do and how to
supervise it.

## System Map

```mermaid
flowchart LR
  subgraph Humans["Humans"]
    human["Human maintainer<br/>direction, policy, review"]
    reviewer["External reviewer<br/>provider-native feedback"]
  end

  subgraph Agents["Agents"]
    coordinator["Coordinator agent<br/>chooses bounded work batch"]
    worker["Worker agent<br/>owns one worktree or scope"]
    integrator["Integrator agent<br/>serializes ready branches"]
  end

  subgraph DevNexus["DevNexus project control plane"]
    projectConfig["Project config<br/>components, plugins, policies"]
    workItems["Work-item service<br/>component tracker bindings"]
    targetState["Target state and cycle ledger<br/>run facts and objective"]
    handoffs["Leases and handoffs<br/>coordination status"]
    launch["Agent launch and setup projection<br/>skills, MCP, dependencies"]
    authority["Publication and authority policy<br/>current gates and planned resolver"]
  end

  subgraph Components["Git projects and components"]
    metaRepo["Dogfood meta repo<br/>AGENTS, PLAN, docs, .dev-nexus"]
    coreRepo["dev-nexus<br/>generic core"]
    pharoRepo["dev-nexus-pharo<br/>Pharo plugin"]
    tsRepo["dev-nexus-typescript<br/>TypeScript plugin"]
    worktrees["Generated worktrees<br/>isolated write surfaces"]
  end

  subgraph Providers["Provider systems"]
    github["GitHub<br/>repos, issues, PRs"]
    otherProviders["GitLab, Jira, Vibe, etc.<br/>neutral adapters"]
  end

  human -->|"sets target direction and policy"| projectConfig
  human -->|"may choose work directly"| coordinator
  reviewer -->|"answers requests"| github

  coordinator -->|"reads project context"| projectConfig
  coordinator -->|"lists eligible work"| workItems
  coordinator -->|"records cycle facts"| targetState
  coordinator -->|"prepares or launches"| launch
  launch -->|"briefing and writable boundary"| worker

  worker -->|"edits only owned surface"| worktrees
  worker -->|"updates status and comments"| workItems
  worker -->|"records verification and handoff"| handoffs
  worker -->|"commits branch"| github

  integrator -->|"reads readiness and conflicts"| handoffs
  integrator -->|"checks actor permissions"| authority
  authority -->|"uses component policy"| projectConfig
  integrator -->|"publishes when allowed"| github

  projectConfig -->|"declares"| metaRepo
  projectConfig -->|"declares primary component"| coreRepo
  projectConfig -->|"declares extension component"| pharoRepo
  projectConfig -->|"declares extension component"| tsRepo
  workItems -->|"local or provider-backed"| github
  workItems -->|"optional provider-backed coordination"| otherProviders
```

## Target Cycle

```mermaid
sequenceDiagram
  actor Human as Human or scheduler
  participant Coordinator as Coordinator agent
  participant DevNexus as DevNexus
  participant Tracker as Component tracker
  participant Worker as Worker agent
  participant Git as Git and providers

  Human->>Coordinator: Objective, manual request, or scheduled wakeup
  Coordinator->>DevNexus: Read AGENTS, CONTEXT, PLAN, target state
  Coordinator->>Tracker: List eligible component work
  Coordinator->>DevNexus: Select bounded batch and record target-cycle start
  Coordinator->>DevNexus: Prepare project or component worktrees
  DevNexus-->>Worker: Agent context, skills, policy, writable boundary
  Worker->>Git: Edit in owned worktree, commit branch
  Worker->>Tracker: Update status, comments, blockers
  Worker->>DevNexus: Record handoff, verification, publication intent
  Coordinator->>DevNexus: Build integration view from handoffs and policy
  Coordinator->>Git: Publish only when authority and component policy allow
  Coordinator->>DevNexus: Record result, verification, target-cycle facts
```

## Account And Remote Model

```mermaid
flowchart TB
  subgraph Actors["Actors"]
    humanActor["Human actor<br/>Gabriel-Darbord"]
    botActor["Automation actor<br/>Gabot-Darbot"]
  end

  subgraph HostProfiles["Host-local auth profiles"]
    humanProfile["human-github<br/>normal SSH or gh profile"]
    botProfile["bot-github<br/>GH_CONFIG_DIR=home:.config/gh-automation-github<br/>SSH host github.com-bot"]
  end

  subgraph Remotes["Git remotes"]
    origin["origin<br/>role: human/manual"]
    botRemote["bot<br/>role: automation"]
  end

  subgraph Actions["Action classes"]
    manual["Manual human work<br/>local decisions, review, direct commands"]
    agentGit["Agent-created Git work<br/>branches, commits, pushes"]
    providerWrites["Agent-created provider work<br/>issues, comments, PRs, bridge messages"]
  end

  humanActor --> humanProfile --> origin --> manual
  botActor --> botProfile --> botRemote --> agentGit
  botActor --> botProfile --> providerWrites
  agentGit -->|"must pass configured publication policy"| gate["DevNexus policy gate"]
  providerWrites -->|"must pass configured provider policy"| gate
```

Rule of thumb: human account defaults are for manual human actions. Any
agent-created Git or provider mutation must use the configured automation actor
unless the user explicitly overrides that policy.

## Conceptual Schema

```mermaid
erDiagram
  PROJECT ||--o{ COMPONENT : declares
  PROJECT ||--o{ TARGET_CYCLE : records
  PROJECT ||--o{ ACTOR : binds
  PROJECT ||--o{ PLUGIN : enables
  COMPONENT ||--o{ TRACKER_BINDING : owns
  COMPONENT ||--o{ WORKTREE_LEASE : coordinates
  COMPONENT ||--|| PUBLICATION_POLICY : has
  COMPONENT }o--o{ PLUGIN : extended_by
  TRACKER_BINDING ||--o{ WORK_ITEM : stores
  TRACKER_BINDING }o--|| PROVIDER : backed_by
  WORK_ITEM ||--o{ HANDOFF : receives
  ACTOR ||--o{ AUTH_PROFILE : uses_host_local
  AUTH_PROFILE ||--o{ REMOTE : authenticates
  PUBLICATION_POLICY }o--|| REMOTE : publishes_through

  PROJECT {
    string id
    string projectRoot
    string targetStatePath
    string cycleLedgerPath
  }

  COMPONENT {
    string id
    string role
    string sourceRoot
    string worktreesRoot
    string defaultBranch
  }

  TRACKER_BINDING {
    string id
    string provider
    string role
    string storePath
    boolean enabled
  }

  WORK_ITEM {
    string id
    string status
    string componentId
    string trackerId
  }

  WORKTREE_LEASE {
    string componentId
    string branchName
    string worktreePath
    string status
    string headCommit
  }

  ACTOR {
    string id
    string kind
    string provider
    string handle
  }

  AUTH_PROFILE {
    string id
    string credentialKind
    string hostLocalPath
  }

  REMOTE {
    string name
    string role
    string protocol
    string sshHostAlias
  }
```

## Core Entities

| Entity | What It Owns | Current Dogfood Shape |
| --- | --- | --- |
| DevNexus project | Portable project graph, target state, automation policy, skills, MCP wiring, worktree roots, local work-item stores | `dev-nexus-dogfood` |
| Component | Source root, generated worktree root, tracker bindings, verification policy, publication policy | `dev-nexus`, `dev-nexus-pharo`, `dev-nexus-typescript` |
| Tracker binding | Component-scoped system of record for work items, comments, status, labels, and provider references | Local JSON stores under `.dev-nexus/work-items/` |
| Worktree lease | Advisory ownership record for one active agent surface | Records component or project-meta scope, branch, status, verification, handoff |
| Target cycle | One coordinator run against the target objective | Records selected work, blockers, verification, publication, result JSON |
| Actor and auth profile | Who is attempting an action and which host-local credential profile is used | Human `Gabriel-Darbord`; automation `Gabot-Darbot` |
| Publication policy | Whether and how verified changes may be published | Direct integration to `main` through `bot` where component policy allows |
| Plugin | Additive setup policy, skills, MCP wiring, and domain affordances | Pharo and TypeScript plugins extend the generic core |

## Current Dogfood Instance

| Scope | Source Root | Tracker | Publication |
| --- | --- | --- | --- |
| Meta project | `/Users/gabriel.darbord/dev-nexus/dev-nexus-dogfood` | Project-local DevNexus state | `bot` remote to `main` for automation; `origin` for manual human work |
| `dev-nexus` | `/Users/gabriel.darbord/dev-nexus/sources/dev-nexus` | `.dev-nexus/work-items/dev-nexus.json` | Direct integration through component `bot` remote |
| `dev-nexus-pharo` | `/Users/gabriel.darbord/dev-nexus/sources/dev-nexus-pharo` | `.dev-nexus/work-items/dev-nexus-pharo.json` | Direct integration through component `bot` remote |
| `dev-nexus-typescript` | `/Users/gabriel.darbord/dev-nexus/sources/dev-nexus-typescript` | `.dev-nexus/work-items/dev-nexus-typescript.json` | Direct integration through component `bot` remote |

## Operating Invariants

- DevNexus records facts and applies guardrails; it does not choose or supervise
  implementation work.
- Each component owns its source root, worktree root, tracker, verification
  policy, and publication policy.
- Shared checkouts are read-mostly control rooms. Mutating agent work belongs in
  an owned generated worktree or an explicit integration context.
- Work selection uses component trackers. Local stores are fast for dogfood;
  provider-backed trackers are the path for durable shared coordination.
- Agent-created Git and provider activity uses the automation profile and must
  pass configured publication, provider, and evolving authority policy before
  mutation.
- Handoffs, leases, verification summaries, target-cycle facts, and publication
  decisions are the durable continuation record, not chat transcript memory.
