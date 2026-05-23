# Publication Workflows

DevNexus starts with a simple publication posture. A normal workspace can use
work items, isolated worktrees, focused verification, and review handoff without
configuring versions, release trains, or CI budgets.

Use the advanced publication tools only when the workspace needs them. A team
can opt into green-main checks, CI tiers, candidate branches, merge queues,
remote runners, or version-scoped release trains later.

## Simple Default

The default publication strategy is `review_handoff`. In that mode an agent can
prepare a branch, record verification, and leave the user or maintainer with a
clear handoff. DevNexus does not require hosted CI, target-branch pushes,
version planning, or release trains.

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

DevNexus treats review and publication as separate concepts. Review decides how
a change is checked and approved; publication decides whether it may be pushed,
merged, queued, or released. The target review-policy design is recorded in
[Review policy design](../dev/review-policy.md).

## When To Opt Into Advanced Publication

Use a richer publication policy when local handoff is no longer enough.

Choose `green_main` when the workspace has protected branches, required checks,
or a bot account that should open pull requests and wait for CI before merge.

Choose CI tiers when every change should not run the same hosted matrix. CI
tiers let the workspace distinguish local focused checks, cheap remote smoke,
candidate matrix checks, protected target gates, and scheduled drift checks.

Choose a release train when you want to batch several work items into an
integration or candidate branch before final publication. Version planning can
name the scope, but it remains optional. A workspace can use unscoped candidate
planning or no train at all.

## Advanced Opt-In Example

This example opts into a green-main workflow and a version-scoped release
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
      "releaseTrain": {
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
an internal label to use release trains. Add labels only when the component
owner wants an explicit queue filter.

## Feature Branch Delivery

Use feature branch delivery when a single objective needs several reviewable
changes but should still have one coherent final publication path. A feature is
the planning object. Branch names still use normal Git intent prefixes such as
`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, or `ci/`.

The default long-running feature shape is `hybrid`:

- one approved feature branch, such as `feat/codex-goals`;
- review branches that target that feature branch, such as
  `feat/codex-goals/target-projection`;
- optional stacked review branches when one change depends on another;
- one final pull request from the feature branch to the target branch;
- human approval for the branch strategy choice and final publication.

Configure feature branch delivery under `releaseTrain`. It extends release
trains instead of replacing them.

```json
{
  "automation": {
    "publication": {
      "strategy": "green_main",
      "targetBranch": "main",
      "releaseTrain": {
        "enabled": true,
        "activeVersionId": "v-next",
        "branchNaming": {
          "integrationPrefix": "integration",
          "candidatePrefix": "candidate",
          "unscopedName": "manual"
        },
        "featureBranchDelivery": {
          "enabled": true,
          "activeFeatureId": "codex-goals",
          "defaultBranchStrategy": "hybrid",
          "allowedBranchStrategies": ["direct", "stacked", "feature_branch", "hybrid"],
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
            "featureBranchPattern": "{intent}/{feature}",
            "reviewBranchPattern": "{intent}/{feature}/{change}"
          },
          "review": {
            "mode": "review_branch_pr",
            "finalPullRequest": true,
            "finalPullRequestCreation": "at_review_gate"
          },
          "provider": {
            "commentPolicy": "status_only"
          },
          "branchPublication": {
            "strategy": "push_remote_then_fallback",
            "fallbackRemote": "fork"
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

Feature branch delivery uses three read-only commands:

- `feature-plan` explains branch routing before work starts.
- `feature-report` combines branch policy, pull-request evidence, checks,
  review state, base freshness, and conflicts.
- `feature-finalization` separates review readiness from publication
  authority. A draft pull request can be safe to review while still blocked for
  final publication. A green, approved pull request still stops at the human
  publication gate unless policy explicitly grants more authority.

For stacked and hybrid branch strategies, the plan also carries a stack summary:
publication eligibility, root branch, default parent branch, review target, and
any known change entries. Worker context records the selected review-branch
parent and stack position when the change worktree is prepared. DevNexus also
exposes a provider-neutral restack plan model for branch graph facts; it reports which
branches need update, which pushed branches require `--force-with-lease`, and
which updates need human approval.

`finalPullRequestCreation` controls when the final feature pull request is
opened. The default, `at_review_gate`, avoids creating a long-lived PR while the
feature branch is still accumulating commits. Use `at_feature_start` only
when the team accepts repeated PR CI on every branch update, and `manual_only`
when DevNexus should report readiness without recommending provider mutation.

`branchPublication` controls where feature and review branches are expected to
be pushed. `push_remote` uses the component push remote.
`push_remote_then_fallback` records a configured fallback remote, such as
a fork, for machines or actors that cannot push to the upstream repository.
`fallback_remote` always targets the fallback. `manual_only` reports the branch
shape without selecting a push remote.

When the selected fallback remote is a GitHub fork, DevNexus resolves the remote
URL and renders the final pull-request head as `owner:branch`. If the fallback
remote is missing or does not point at a GitHub repository, finalization blocks
with a setup action instead of guessing. `branch-push --feature` probes
`push_remote_then_fallback` with read-only `git push --dry-run` calls and uses
the fallback only when the push remote rejects the dry run.

When provider evidence says the feature review branch is behind or diverged,
`feature-report` and `feature-finalization` include a branch update
decision. The default recommendation is a merge update into the review branch:
it refreshes CI without rewriting public history. Rebase remains an explicit
alternative for teams that want a linear branch, but it requires human approval
and a `--force-with-lease` push. Leaving the branch unchanged keeps the risk that
CI passes against stale base code and fails after merge.

For GitHub, keep routine provider output quiet. Prefer PR bodies, checks,
labels, and DevNexus reports for ordinary state. Comments should be reserved
for major redirection, explicit human request, or a provider that has no quieter
durable field.

## Advanced Commands

The publication commands produce planning and evidence output. They do not make a
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

Review release train readiness:

```bash
dev-nexus publication release-train-readiness <workspace-root> --version v-next
```

Plan candidate branches:

```bash
dev-nexus publication candidate-plan <workspace-root> --version v-next
```

Review feature branch routing:

```bash
dev-nexus publication feature-plan <workspace-root> --component api
```

Review feature branch provider state from saved evidence:

```bash
dev-nexus publication feature-report <workspace-root> --component api --evidence-file evidence.json
```

The report is read-only. It classifies the feature review branch as needing
final pull-request creation, provider evidence, branch update, conflict
resolution, branch-policy resolution, check follow-up, review, or final
publication readiness. Saved provider evidence can include pull-request review
state and base freshness, so an out-of-date but otherwise mergeable GitHub pull
request is flagged before publication.

Review finalization readiness before undrafting, requesting review, or merging:

```bash
dev-nexus publication feature-finalization <workspace-root> --component api --evidence-file evidence.json
```

The finalization plan is also read-only. It reports whether the branch is safe
for review, whether it is ready for publication, and whether publication still
requires a human decision. It does not merge, undraft, comment, or enter a merge
queue.

## Choosing A Path

Start with `review_handoff` unless the workspace already has a reason to do
more. Add `green_main` when protected-branch publication needs machine-readable
check decisions. Add CI tiers when hosted CI cost or platform coverage needs
policy. Add release trains when the team wants to batch related work before
final publication. Add feature branch delivery when several changes should
share one durable branch, one review branch, and one final publication gate.

Self-hosting workspaces can use the advanced path to reduce CI noise and protect
shared branches. That is an opt-in operating profile, not the DevNexus default.
