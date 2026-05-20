# First Project From Existing Components

Use this guide when you already have folders or repositories and want one
DevNexus project that lets an agent work across them.

## The Shape

Suppose you have these existing folders:

```text
/Users/alice/projects/benchmark-graphRag
/Users/alice/projects/GraphRag-Projects/json-java-moose
/Users/alice/projects/GraphRag-Projects/json-java-no-moose
/Users/alice/papers/2026-iwst-modelsandllms
```

The right DevNexus shape is usually one project with several components:

```text
DevNexus project root:
  /Users/alice/dev-nexus/graphrag-research-suite

Components:
  benchmark-graphrag
  json-java-moose
  json-java-no-moose
  iwst-paper
```

Do not create one DevNexus project per folder unless you want separate agent
workspaces and separate project state.

## Interactive Setup

For a human, start with:

```bash
dev-nexus project setup "/Users/alice/dev-nexus/graphrag-research-suite"
```

Use the existing folder paths as component source roots when prompted. Pick one
primary component. Other components can be dependencies, addons, or support
components.

`setup check` classifies each component source root as project-local, explicit
external, legacy external, missing, incompatible with the current host, or a
project-local-looking symlink/junction escape. External layouts are allowed
when intentional, but project-local component clones under `componentsRoot:` are
the cleanest default for repeatable agent work.

After setup, open this directory in the agent:

```text
/Users/alice/dev-nexus/graphrag-research-suite
```

## Answer-File Setup

Agents and repeatable setup flows can use an answer file.

```json
{
  "project": {
    "id": "graphrag-research-suite",
    "name": "GraphRAG Research Suite",
    "root": "/Users/alice/dev-nexus/graphrag-research-suite",
    "initializeGit": true,
    "defaultBranch": "main"
  },
  "components": [
    {
      "id": "benchmark-graphrag",
      "name": "Benchmark GraphRAG",
      "role": "primary",
      "source": {
        "kind": "reference_existing",
        "path": "/Users/alice/projects/benchmark-graphRag",
        "defaultBranch": "main"
      }
    },
    {
      "id": "json-java-moose",
      "name": "JSON Java Moose",
      "role": "dependency",
      "source": {
        "kind": "reference_existing",
        "path": "/Users/alice/projects/GraphRag-Projects/json-java-moose",
        "defaultBranch": "main"
      }
    },
    {
      "id": "json-java-no-moose",
      "name": "JSON Java No Moose",
      "role": "dependency",
      "source": {
        "kind": "reference_existing",
        "path": "/Users/alice/projects/GraphRag-Projects/json-java-no-moose",
        "defaultBranch": "main"
      }
    },
    {
      "id": "iwst-paper",
      "name": "IWST Paper",
      "role": "addon",
      "source": {
        "kind": "reference_existing",
        "path": "/Users/alice/papers/2026-iwst-modelsandllms",
        "defaultBranch": "main"
      }
    }
  ],
  "agentTargets": [
    {
      "provider": "codex",
      "configPath": ".codex/config.toml"
    }
  ],
  "localWorkTracking": {
    "enabled": true,
    "provider": "local"
  }
}
```

Preview local writes:

```bash
dev-nexus project setup "/Users/alice/dev-nexus/graphrag-research-suite" --answers ./graphrag.setup.json --json
```

Apply the local setup:

```bash
dev-nexus project setup "/Users/alice/dev-nexus/graphrag-research-suite" --answers ./graphrag.setup.json --yes
```

## Project-Local Components

For new projects, the easiest long-term layout is usually project-local
components:

```text
graphrag-research-suite/
  components/
    benchmark-graphrag/
    json-java-moose/
    json-java-no-moose/
  worktrees/
    benchmark-graphrag/
    json-java-moose/
    json-java-no-moose/
```

Use existing absolute paths only when you deliberately want DevNexus to
reference those external checkouts in place.

## Verify Readiness

```bash
dev-nexus project status "/Users/alice/dev-nexus/graphrag-research-suite"
dev-nexus setup check "/Users/alice/dev-nexus/graphrag-research-suite" join-existing-project
```

Then create the first component-scoped work item:

```bash
dev-nexus work-item create "/Users/alice/dev-nexus/graphrag-research-suite" --component benchmark-graphrag --title "Define GraphRAG benchmark protocol" --status ready
```
