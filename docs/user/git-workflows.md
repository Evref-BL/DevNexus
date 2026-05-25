# Git Workflow Integration

DevNexus does not replace Git, GitHub, GitLab, or a team's branching rules. It
records enough policy, state, and evidence for agents to use those rules without
guessing.

Use this guide when a workspace needs more than "make a branch and hand it to a
maintainer". The goal is to describe the expected Git workflow first, run work
inside that workflow, and adjust the expectation when implementation shows that
the workflow needs a different policy.

## What DevNexus Owns

DevNexus owns the coordination layer around Git:

- which component and tracker item the work belongs to;
- which Git checkout or generated worktree may be mutated;
- which base branch or parent branch should start the work;
- which review, verification, and publication gates apply;
- which human or agent owns the next decision;
- which facts were observed from Git, CI, and provider review state;
- which cleanup or archive action is safe when work stops.

Git still owns commits, branches, merges, rebases, tags, and conflict
resolution. Providers still own pull requests, merge requests, reviews, checks,
merge queues, and branch protection.

## Documentation-Driven Workflow Design

Start a new workflow by writing the expectation before relying on automation.
The first useful document should answer:

- what branch or ref new work starts from;
- whether review branches target the final branch, another review branch, a
  feature branch, a release branch, or a fork;
- whether a branch may be rebased after publication;
- when DevNexus should pause for human approval;
- what evidence makes the workflow ready for review, publication, or cleanup;
- how abandoned work should be preserved or removed.

The implementation can then make that expectation executable through
configuration, worktree preparation, review planning, publication planning, and
cleanup planning. If the implementation proves that the expectation is wrong,
change the document and policy together. Do not hide a workflow change in a
one-off command.

## Workflow Run Model

Once a Git workflow starts, treat it as a run with explicit state. A run may be
short, such as one local review handoff, or long, such as a feature branch with
several review branches and a final pull request.

Useful node types are:

- Observation: read Git status, remotes, provider review state, checks, and
  work-item state.
- Decision: choose a branch strategy, update strategy, review route, or cleanup
  route.
- Action: prepare a worktree, push a branch, open or update a pull request, run
  verification, or record a handoff.
- Gate: require a human, reviewer, CI result, claim, approval, or authority
  check before continuing.
- Handoff: return control to a human, maintainer, reviewer, or another agent
  with enough context to resume.
- Wait: hold for provider checks, review, merge queue, or another branch in a
  stack.
- Terminal: complete, abort, abandon, archive, rescue, or merge.

Each state should record the current branch or ref, the expected next owner, the
evidence used for the decision, and the allowed next transitions. This makes a
pause normal rather than exceptional.

## Default Lifecycle

A normal DevNexus Git workflow follows this shape:

1. Select the canonical work item and component.
2. Resolve the workflow policy for that component.
3. Fetch and inspect the canonical base or parent ref.
4. Prepare an isolated worktree from that ref.
5. Implement, verify, and record progress in the worktree.
6. Produce the review surface selected by policy.
7. Read provider, CI, review, and branch freshness evidence.
8. Decide whether to leave the branch unchanged, merge the target into it,
   rebase it, restack it, recreate it, or move it to cleanup.
9. Publish only when review, verification, freshness, and authority gates are
   satisfied.
10. Clean up only after the branch is proven merged, intentionally archived, or
    safely abandoned.

The current commands that participate in this lifecycle include:

```bash
dev-nexus worktree prepare <workspace-root> --component api --work-item local-1
dev-nexus git-workflow start <workspace-root> --component api --profile protected-main --work-item github-123
dev-nexus coordination handoff <workspace-root> local-1 --component api --status ready --worktree worktrees/api/feat-example --decision "review requested"
dev-nexus publication review-handoff <workspace-root> --component api --branch feat/example --title "Add example"
dev-nexus publication green-main plan <workspace-root> --component api --pr 123 --checks-file checks.json
dev-nexus publication feature-plan <workspace-root> --component api
dev-nexus publication feature-report <workspace-root> --component api --evidence-file evidence.json
dev-nexus publication feature-finalization <workspace-root> --component api --evidence-file evidence.json
dev-nexus coordination cleanup-plan <workspace-root> --component api
```

Use dry-run options where available before mutating a provider.

## Read-Only Plan And Status

Before starting or resuming a workflow, inspect the selected profile and local
Git evidence without changing Git, provider, tracker, or runtime state:

```bash
dev-nexus git-workflow plan <workspace-root> --component api --profile protected-main --work-item github-123
dev-nexus git-workflow status <workspace-root> --component api --run run-123
```

`plan` explains the selected profile, branch strategy, base ref, target branch,
evidence gaps, blockers, gates, next owner, and allowed next commands. `status`
adds the recorded workflow run when one exists, then refreshes only safe local
Git facts. Provider review and check evidence should be attached through the
appropriate publication/provider evidence commands; read-only plan/status report
missing provider evidence as a gap instead of silently guessing.

When the plan is acceptable, `git-workflow start` uses the selected profile to
prepare the worktree and records the initial runtime workflow run in the new
worktree. The plain `worktree prepare` command remains available for manual
worktree setup and keeps its existing explicit `--base-ref` and feature-branch
options.

## Branch Strategies

The branch strategy answers where reviewable changes flow.

Direct branch strategy works for independent changes that can review and merge
straight into the final target branch. It is the simple default for small
changes, solo projects, and most provider-native issue fixes.

Stacked branch strategy works when later changes depend on earlier unmerged
changes. Each branch targets the branch below it. Restacking published branches
can rewrite history, so policy should decide when `--force-with-lease` needs
human approval.

Feature branch strategy works when one longer objective needs several review
branches but one coherent final publication gate. Review branches target the
feature branch. The final feature branch targets the final branch.

Hybrid branch strategy combines a feature branch with direct or stacked review
branches under it. This is useful when part of the work can be reviewed
independently but the final target branch should see one coherent result.

Release or maintenance branch strategy works when a fix must land in an older
supported line and then flow to newer lines, or when a fix is made on trunk and
cherry-picked to maintained release branches. The team must choose the direction
explicitly.

Fork or integration-manager strategy works when contributors cannot push to the
canonical repository. DevNexus should use the configured provider and
publication policy instead of inventing a fork or using a human account.

Temporary integration branches are rehearsal surfaces. They are useful for
compatibility checks, but they should not become a hidden base for new work.

## Branch Freshness Decisions

A branch does not need to be updated just because the final target branch moved.
DevNexus should classify the situation before recommending a branch update.
Provider base status and mergeability are authoritative when available. When
the provider cannot answer yet, DevNexus falls back to local Git facts such as
ahead/behind counts and conflict probes.

Update or block immediately when:

- the branch was created from the wrong canonical base;
- the selected base ref could not be fetched or verified;
- the provider reports a merge conflict;
- strict required checks require the branch to be up to date;
- a review branch no longer targets the policy-selected parent;
- a stacked branch needs restacking before review can continue.

Do not update automatically when:

- the branch is mergeable, checks are loose, and the workflow accepts ordinary
  pull-request validation;
- a merge queue will validate the branch against the latest target and queued
  changes;
- updating would add noisy merge commits without changing the decision;
- the branch is shared or already reviewed and policy does not allow rewriting.

Choose the update method from policy:

- merge the target or parent into the branch when preserving public history
  matters;
- rebase when the team wants a linear branch and rewrite authority is available;
- restack when a stacked branch's parent changed;
- recreate or cherry-pick when the branch started from the wrong history;
- leave unchanged when provider or queue validation is enough.

GitHub documents the same tradeoff through strict and loose required checks:
strict checks require an up-to-date branch, while loose checks reduce rebuilds
but can fail after merge if the target branch changed incompatibly. A merge queue
validates the pull request with the latest target branch without requiring the
author to update the branch first.

## Human and Agent Control Points

DevNexus should hand control back whenever policy requires judgment that the
tool cannot own:

- choosing a branch strategy for a long-lived feature;
- approving a rebase or force-with-lease push of a published branch;
- approving final publication to a protected branch;
- resolving unclear conflicts;
- deciding whether failed CI is product risk, test flake, or infrastructure
  noise;
- abandoning, archiving, or rescuing unmerged work.

A handoff should include the component, work item, branch, head commit, base
ref, verification, provider URL if any, blockers, and the exact next decision.
After the human or next agent acts, DevNexus should be able to resume from
recorded facts instead of restarting the workflow from memory.

## Pause, Abort, and Abandon

Pausing keeps the work alive. Record a coordination handoff, keep the worktree
and branch, and state the next owner.

Aborting before durable work exists can remove the generated worktree and local
branch after confirming they contain no useful commits or untracked files.

Aborting after commits exist needs a preservation decision. The safe default is
to keep the branch, mark the handoff or lease as blocked or abandoned, and let
cleanup planning report what can be removed later.

Abandoned work should not disappear silently. Preserve it with a rescue branch,
provider comment, tracker update, archive record, or explicit cleanup decision.
Cleanup should prove one of these facts before deleting anything:

- the branch is merged into the target branch;
- the branch has no unique work;
- a human approved archival or deletion;
- the work was copied to a rescue branch or another durable record.

DevNexus records pause, abort, abandon, archive, rescue, and merged outcomes in
the Git workflow run. Cleanup planning reads that run state alongside Git facts
and worktree leases: paused or active runs block deletion, abandoned runs require
preservation, and archived or rescued runs only become cleanup-safe when the run
contains the archive or rescue evidence.

## Workflow Profiles

Use profiles as named defaults, not hardcoded product behavior.

Solo or small open-source profile:

- short-lived direct branches;
- loose freshness unless conflicts appear;
- human review or self-review;
- simple review handoff;
- squash, merge, or rebase merge chosen by repository convention.

Maintainer-led open-source profile:

- contributor forks or topic branches;
- maintainer owns final integration;
- patch series or pull requests may be used;
- rebasing contributor branches before merge is acceptable when contributors own
  the branch;
- final branch protection and release tagging remain maintainer decisions.

Industrial protected-main profile:

- isolated worktrees;
- pull requests or merge requests for review;
- required checks and review gates;
- merge queue or strict freshness for busy targets;
- no direct target pushes except through explicit authority.

Stacked-change profile:

- parent branch recorded for each change;
- restack plans use provider evidence and branch graph facts;
- force-with-lease is gated once branches are public;
- final publication waits until the stack is coherent.

Release-maintenance profile:

- maintained release branches are first-class targets;
- fixes either start at the oldest affected branch and merge upward, or start on
  trunk and cherry-pick down, depending on team policy;
- tags, changelogs, and package publication are separate gates.

Environment-branch profile:

- branches can represent deployment environments such as staging or production;
- promotion is a workflow action, not a normal feature-branch update;
- hotfix and rollback policy must say whether fixes happen on trunk first,
  production first, or both through cherry-picks.

## Configuration Direction

Current DevNexus configuration already separates component source roots,
worktrees, review policy, publication policy, release trains, feature branch
delivery, provider auth, and authority. Deep Git workflows should extend that
shape rather than put provider-specific branching logic in agents.

Use `automation.gitWorkflows` to name the branching policy before a run starts.
Profiles are provider-neutral. Publication config still owns push, pull-request,
merge, evidence, package, and release mechanics.

```json
{
  "automation": {
    "gitWorkflows": {
      "activeProfileId": "protected-feature",
      "profiles": [
        {
          "id": "protected-feature",
          "branchStrategy": "hybrid",
          "targetBranch": "main",
          "branchNaming": {
            "defaultIntentPrefix": "feat",
            "allowedIntentPrefixes": ["feat", "fix", "chore", "docs"],
            "featureBranchPattern": "{intent}/{feature}",
            "reviewBranchPattern": "{intent}/{feature}/{change}"
          },
          "review": {
            "mode": "review_branch_pr",
            "finalPullRequest": true,
            "finalPullRequestCreation": "at_review_gate"
          },
          "update": {
            "behind": "restack",
            "diverged": "block",
            "wrongBase": "recreate",
            "publicRewrite": "with_human_approval"
          },
          "gates": {
            "publication": [
              "human_approval",
              "provider_review",
              "publication_authority"
            ]
          }
        }
      ]
    }
  }
}
```

Supported branch strategies are `direct`, `feature_branch`, `stacked`,
`hybrid`, `release_maintenance`, `environment_branch`, and
`throwaway_rehearsal`. Release-maintenance profiles declare their maintained
branches and flow direction. Environment-branch profiles declare the environment
branch and promotion method. Throwaway rehearsal profiles cannot create a final
pull request.

Older `automation.publication.releaseTrain.featureBranchDelivery` config remains
readable. When it is enabled and `automation.gitWorkflows` is omitted,
DevNexus projects it as `legacy-feature-branch-delivery`. New
workspaces should prefer `automation.gitWorkflows`; release trains should stay
focused on batching, candidate branches, CI tiers, and final publication.

A workflow run object should then be a directed graph:

- states are typed nodes;
- transitions have conditions and required evidence;
- mutating transitions declare authority and dry-run behavior;
- handoff transitions declare the next owner and resume inputs;
- terminal transitions declare cleanup, archive, or publication results.

The graph can then express several team workflows without changing agent
behavior. Agents ask DevNexus for the current state and next allowed actions;
humans decide at gates; DevNexus resumes when evidence arrives.

## References

- [Git branching workflows](https://git-scm.com/book/en/v2/Git-Branching-Branching-Workflows)
- [Git distributed workflows](https://git-scm.com/book/en/v2/Distributed-Git-Distributed-Workflows)
- [Git workflow documentation](https://git-scm.com/docs/gitworkflows)
- [Git rebase documentation](https://git-scm.com/docs/git-rebase)
- [Git push force-with-lease documentation](https://git-scm.com/docs/git-push)
- [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [GitLab branches](https://docs.gitlab.com/topics/git/branch/)
