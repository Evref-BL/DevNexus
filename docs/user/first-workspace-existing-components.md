# First Workspace From Existing Components

Use this guide when you already have folders or repositories and want one
DevNexus workspace that lets an agent work across them.

## The Shape

Suppose you have these existing folders:

```text
/Users/alice/projects/rocket-shop/checkout-api
/Users/alice/projects/rocket-shop/storefront
/Users/alice/projects/rocket-shop/shared-kernel
/Users/alice/projects/rocket-shop/load-test-lab
```

The right DevNexus shape is usually one workspace with several components:

```text
DevNexus workspace root:
  /Users/alice/dev-nexus/rocket-shop-suite

Components:
  checkout-api
  storefront
  shared-kernel
  load-test-lab
```

Do not create one DevNexus workspace per folder unless you want separate agent
workspaces and separate workspace state.

## Interactive Setup

For a user in a terminal, create or choose the DevNexus workspace directory, then
run setup from that directory:

```bash
dev-nexus workspace setup
```

Use the existing folder paths as component source roots when prompted. Pick one
primary component. Other components can be dependencies, addons, or support
components.

`setup check` classifies each component source root as workspace-local, explicit
external, legacy external, missing, incompatible with the current host, or a
workspace-local-looking symlink/junction escape. External layouts are allowed
when intentional, but workspace-local component clones under `componentsRoot:` are
the cleanest default for repeatable agent work.

After setup, open the DevNexus workspace directory in the agent:

```text
/Users/alice/dev-nexus/rocket-shop-suite
```

## Answer-File Setup

Agents and repeatable setup flows can use an answer file.

```json
{
  "project": {
    "id": "rocket-shop-suite",
    "name": "Rocket Shop Suite",
    "root": "/Users/alice/dev-nexus/rocket-shop-suite",
    "initializeGit": true,
    "defaultBranch": "main"
  },
  "components": [
    {
      "id": "checkout-api",
      "name": "Checkout API",
      "role": "primary",
      "source": {
        "kind": "reference_existing",
        "path": "/Users/alice/projects/rocket-shop/checkout-api",
        "defaultBranch": "main"
      }
    },
    {
      "id": "storefront",
      "name": "Storefront",
      "role": "dependency",
      "source": {
        "kind": "reference_existing",
        "path": "/Users/alice/projects/rocket-shop/storefront",
        "defaultBranch": "main"
      }
    },
    {
      "id": "shared-kernel",
      "name": "Shared Kernel",
      "role": "dependency",
      "source": {
        "kind": "reference_existing",
        "path": "/Users/alice/projects/rocket-shop/shared-kernel",
        "defaultBranch": "main"
      }
    },
    {
      "id": "load-test-lab",
      "name": "Load Test Lab",
      "role": "addon",
      "source": {
        "kind": "reference_existing",
        "path": "/Users/alice/projects/rocket-shop/load-test-lab",
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
dev-nexus workspace setup "/Users/alice/dev-nexus/rocket-shop-suite" --answers ./rocket-shop.setup.json --json
```

Apply the local setup:

```bash
dev-nexus workspace setup "/Users/alice/dev-nexus/rocket-shop-suite" --answers ./rocket-shop.setup.json --yes
```

## Workspace-Local Components

For new workspaces, the easiest long-term layout is usually workspace-local
components:

```text
rocket-shop-suite/
  components/
    checkout-api/
    storefront/
    shared-kernel/
    load-test-lab/
  worktrees/
    checkout-api/
    storefront/
    shared-kernel/
    load-test-lab/
```

Use existing absolute paths only when you deliberately want DevNexus to
reference those external checkouts in place.

## Verify Readiness

```bash
dev-nexus workspace status "/Users/alice/dev-nexus/rocket-shop-suite"
dev-nexus setup check "/Users/alice/dev-nexus/rocket-shop-suite" join-existing-project
```

Then create the first component-scoped work item:

```bash
dev-nexus work-item create "/Users/alice/dev-nexus/rocket-shop-suite" --component checkout-api --title "Define checkout retry policy" --status ready
```
