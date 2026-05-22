# Publication Workflows

DevNexus starts with a simple publication posture. A normal workspace can use
work items, isolated worktrees, focused verification, and review handoff without
configuring versions, publication trains, or CI budgets.

Use the advanced publication tools only when the workspace needs them. A team
can opt into green-main checks, CI tiers, candidate branches, merge queues,
remote runners, or version-scoped publication trains later.

## Simple Default

The default publication strategy is `review_handoff`. In that mode an agent can
prepare a branch, record verification, and leave the user or maintainer with a
clear handoff. DevNexus does not require hosted CI, target-branch pushes,
version planning, or publication trains.

This is the right starting point for most users:

- first workspaces
- small teams
- repositories without branch protection
- one-off fixes
- local or manual review workflows

You can omit publication policy entirely and use the default. If you want the
default to be explicit, configure the component like this:

```json
{
  "components": [
    {
      "id": "api",
      "name": "API",
      "kind": "git",
      "role": "primary",
      "remoteUrl": "git@github.com:ExampleOrg/api.git",
      "defaultBranch": "main",
      "sourceRoot": "../api",
      "publication": {
        "strategy": "review_handoff"
      }
    }
  ]
}
```

A typical agent flow stays short:

```bash
dev-nexus worktree prepare <workspace-root> --component api --work-item local-1
dev-nexus work-item comment <workspace-root> local-1 --component api --body "Prepared a branch and ran focused verification."
```

The user or maintainer decides whether to push, open a pull request, merge, or
ask for more work.

## When To Opt Into Advanced Publication

Use a richer publication policy when local handoff is no longer enough.

Choose `green_main` when the workspace has protected branches, required checks,
or a bot account that should open pull requests and wait for CI before merge.

Choose CI tiers when every change should not run the same hosted matrix. CI
tiers let the workspace distinguish local focused checks, cheap remote smoke,
candidate matrix checks, protected target gates, and scheduled drift checks.

Choose a publication train when you want to batch several work items into an
integration or candidate branch before final publication. Version planning can
name the scope, but it remains optional. A workspace can use unscoped candidate
planning or no train at all.

## Advanced Opt-In Example

This example opts into a green-main workflow and a version-scoped publication
train. It is suitable for a workspace that wants ordinary pull requests to run
cheap remote smoke first, then run the full matrix only for candidate or
protected target validation.

```json
{
  "versionPlanning": {
    "versions": [
      {
        "id": "v-next",
        "objective": "Batch the next user-facing release.",
        "owningComponents": [
          "api"
        ],
        "targetBranch": "main",
        "scope": [],
        "readinessGates": [
          {
            "kind": "work_items_done",
            "components": [
              "api"
            ]
          },
          {
            "kind": "checks_green",
            "components": [
              "api"
            ],
            "checkNames": [
              "Node 22 check"
            ]
          }
        ],
        "releasePolicy": {
          "tags": "none",
          "packages": "none",
          "providerRelease": "none"
        }
      }
    ]
  },
  "automation": {
    "verification": {
      "ciTiers": {
        "defaultTier": "remote_smoke",
        "fullMatrixBudget": {
          "minimumIntervalMinutes": 60,
          "minimumChangeCount": 3
        }
      }
    },
    "publication": {
      "strategy": "green_main",
      "remote": "bot",
      "targetBranch": "main",
      "push": false,
      "greenMain": {
        "integrationPreference": "pull_request",
        "directTargetPush": "blocked",
        "mergeAuthority": "authorized_merge",
        "requiredChecks": [
          "Node 22 check (ubuntu-latest)",
          "Node 22 check (windows-latest)",
          "Node 22 check (macos-latest)"
        ],
        "staleChecks": "block"
      },
      "publicationTrain": {
        "enabled": true,
        "activeVersionId": "v-next",
        "branchNaming": {
          "integrationPrefix": "integration",
          "candidatePrefix": "candidate",
          "unscopedName": "manual"
        },
        "selector": {
          "statuses": [
            "ready"
          ],
          "labels": []
        }
      }
    }
  }
}
```

The `labels` array is empty on purpose. Public repository users should not need
an internal label to use publication trains. Add labels only when the component
owner wants an explicit queue filter.

## Initiative Delivery

Use initiative delivery when a single objective needs several reviewable slices
but should still have one coherent final publication path. An initiative is the
planning object. Branch names still use normal Git intent prefixes such as
`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, or `ci/`.

The default long-running feature shape is `hybrid`:

- one approved integration branch, such as `feat/codex-goals`;
- slice branches that target that integration branch, such as
  `feat/codex-goals/target-projection`;
- optional stacked slice branches when one slice depends on another;
- one final pull request from the integration branch to the target branch;
- human approval for the topology choice and final publication.

Configure initiative delivery under `publicationTrain`. It extends publication
trains instead of replacing them.

```json
{
  "automation": {
    "publication": {
      "strategy": "green_main",
      "targetBranch": "main",
      "publicationTrain": {
        "enabled": true,
        "activeVersionId": "v-next",
        "branchNaming": {
          "integrationPrefix": "integration",
          "candidatePrefix": "candidate",
          "unscopedName": "manual"
        },
        "initiativeDelivery": {
          "enabled": true,
          "activeInitiativeId": "codex-goals",
          "defaultTopology": "hybrid",
          "allowedTopologies": ["direct", "stacked", "integration", "hybrid"],
          "branchNaming": {
            "defaultIntentPrefix": "feat",
            "allowedIntentPrefixes": [
              "feat",
              "fix",
              "chore",
              "docs",
              "refactor",
              "test",
              "ci"
            ],
            "integrationBranchPattern": "{intent}/{initiative}",
            "sliceBranchPattern": "{intent}/{initiative}/{slice}"
          },
          "review": {
            "mode": "slice_pull_request",
            "finalPullRequest": true
          },
          "provider": {
            "noise": "quiet"
          }
        },
        "selector": {
          "statuses": ["ready"],
          "labels": []
        }
      }
    }
  }
}
```

Initiative delivery uses three read-only surfaces:

- `initiative-plan` explains branch routing before work starts.
- `initiative-report` combines branch policy, pull-request evidence, checks,
  review state, base freshness, and conflicts.
- `initiative-finalization` separates review readiness from publication
  authority. A draft pull request can be safe to review while still blocked for
  final publication. A green, approved pull request still stops at the human
  publication gate unless policy explicitly grants more authority.

For GitHub, keep routine provider output quiet. Prefer PR bodies, checks,
labels, and DevNexus reports for ordinary state. Comments should be reserved
for major redirection, explicit human request, or a provider surface with no
quieter durable field.

## Advanced Commands

The publication commands are planning and evidence surfaces. They do not make a
workspace advanced by themselves; they are useful after the workspace config
opts into the matching policy.

Inspect green-main checks from saved provider facts:

```bash
dev-nexus publication green-main plan <workspace-root> --component api --pr <pr-number> --checks-file checks.json
```

Normalize saved provider evidence:

```bash
dev-nexus publication evidence normalize evidence.json
```

Collect pull-request evidence through the configured publication credential:

```bash
dev-nexus publication pull-request evidence <workspace-root> --component api --number 123 --json
```

Review merge queue readiness:

```bash
dev-nexus publication merge-queue-readiness <workspace-root> --component api
```

Review publication train readiness:

```bash
dev-nexus publication train-readiness <workspace-root> --version v-next
```

Plan candidate branches:

```bash
dev-nexus publication candidate-plan <workspace-root> --version v-next
```

Review initiative delivery branch routing:

```bash
dev-nexus publication initiative-plan <workspace-root> --component api
```

Review initiative delivery provider state from saved evidence:

```bash
dev-nexus publication initiative-report <workspace-root> --component api --evidence-file evidence.json
```

The report is read-only. It classifies the initiative review surface as needing
provider evidence, branch update, conflict resolution, branch-policy resolution,
check follow-up, review, or final publication readiness. Saved provider evidence
can include pull-request review state and base freshness, so an out-of-date but
otherwise mergeable GitHub pull request is flagged before publication.

Review finalization readiness before undrafting, requesting review, or merging:

```bash
dev-nexus publication initiative-finalization <workspace-root> --component api --evidence-file evidence.json
```

The finalization plan is also read-only. It reports whether the branch is safe
for review, whether it is ready for publication, and whether publication still
requires a human decision. It does not merge, undraft, comment, or enter a merge
queue.

## Choosing A Path

Start with `review_handoff` unless the workspace already has a reason to do
more. Add `green_main` when protected-branch publication needs machine-readable
check decisions. Add CI tiers when hosted CI cost or platform coverage needs
policy. Add publication trains when the team wants to batch related work before
final publication. Add initiative delivery when several slices should share one
durable branch, one review surface, and one final publication gate.

Self-hosting workspaces can use the advanced path to reduce CI noise and protect
shared branches. That is an opt-in operating profile, not the DevNexus default.
