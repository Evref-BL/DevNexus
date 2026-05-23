# Review Policy Design

This note records the target design for DevNexus review policy. It is a design
document, not implemented configuration.

## Decision

DevNexus should model review policy separately from publication policy.

Review policy answers:

- How should this change be reviewed?
- Who or what must approve it?
- What counts as reviewed?
- Should review happen locally, through a provider pull request, through an
  issue, through an agent review, or not at all?

Publication policy answers:

- May this change be pushed?
- May it open a pull request or merge request?
- May it merge, enter a queue, publish a package, or release?
- Which checks, credentials, and authority gates apply before publication?

Publication can consume review state, but review is not publication. A local
VS Code review can satisfy a human review gate without creating a provider pull
request. A final feature branch pull request can require provider review and CI
before merge.

## Source Model

Provider documentation supports this separation.

GitHub pull request reviews are a collaboration mechanism: reviewers can
comment, approve, or request changes before merge. Branch protection can then
turn reviews into merge requirements, and required status checks are a separate
gate. GitHub also tracks whether an approved diff becomes stale after new
commits or base-branch changes.

Sources:

- [GitHub Docs: About pull request reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)
- [GitHub Docs: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

GitLab makes the split explicit. Merge request approvals can be optional, or
they can be required and block merge. GitLab also distinguishes approval rules,
which users interact with, from merge checks, which are pass/fail conditions
such as conflicts, pipeline success, resolved threads, external status checks,
and required approvals.

Sources:

- [GitLab Docs: Merge request approvals](https://docs.gitlab.com/user/project/merge_requests/approvals/)
- [GitLab Docs: Merge request concepts](https://docs.gitlab.com/development/merge_request_concepts/)

## Policy Shape

The review policy should live on the component, separate from publication:

```json
{
  "components": [
    {
      "id": "api",
      "review": {
        "default": {
          "transport": "local",
          "gate": "human_required"
        },
        "rules": []
      },
      "publication": {
        "strategy": "review_handoff"
      }
    }
  ]
}
```

The component default should be enough for simple projects. Rules should refine
that default for branch role, paths, change type, work item labels, or provider
capabilities.

```json
{
  "review": {
    "default": {
      "transport": "local",
      "gate": "human_required"
    },
    "rules": [
      {
        "match": {
          "branchRole": "feature_finalization"
        },
        "transport": "pull_request",
        "gate": "human_required"
      },
      {
        "match": {
          "paths": ["docs/**", "plugins/**/skills/**"]
        },
        "transport": "local",
        "gate": "human_required"
      }
    ]
  }
}
```

Rules are ordered. The first matching rule wins, then any omitted fields fall
back to the default.

## Terms

- Review transport: where the review happens. Examples: `local`,
  `pull_request`, `merge_request`, `issue`, `agent_review`, `none`.
- Review gate: what must happen before the change may proceed. Examples:
  `none`, `human_required`, `agent_allowed`, `provider_approval_required`,
  `ci_required`, `final_human_approval_required`.
- Branch role: why the branch exists in the feature workflow. Examples:
  `review_branch`, `feature_branch`, `feature_finalization`,
  `temporary_integration`, `release_candidate`.
- Local review: a review performed outside the provider, such as in VS Code,
  while DevNexus records that the gate was satisfied.
- Provider review: a review performed through a provider object such as a
  GitHub pull request or GitLab merge request.

## Expected Tool Behavior

Agents should not inspect policy and hand-roll behavior. They should run the
normal workflow and call a DevNexus review tool. The tool should:

1. Read the component review policy.
2. Match the current change against ordered rules.
3. Return the review transport, gate, required evidence, and blocked actions.
4. Perform only the provider mutations allowed by that result.
5. Record review evidence without writing noisy provider comments unless policy
   requires them.

The workflow stays regular:

1. Prepare or adopt the worktree.
2. Implement and verify the change.
3. Ask DevNexus for the review plan.
4. Satisfy the review gate through the selected transport.
5. Ask DevNexus for the publication or finalization plan.

## Examples

Docs and generated skills:

- Transport: local.
- Gate: human required.
- Evidence: branch name, commit id, verification summary, and human approval in
  chat or a local DevNexus record.
- Provider behavior: no branch push, no pull request, no provider comments.

Feature branch finalization:

- Transport: pull request.
- Gate: human required, provider approval required, and CI required.
- Evidence: final feature branch, pull request state, review state, required
  checks, base freshness, and conflict status.
- Provider behavior: create or update one final pull request when the feature
  is ready for publication review.

Quick local fix:

- Transport: local.
- Gate: none or human required, depending on component default.
- Evidence: commit id and verification summary.
- Provider behavior: none unless publication policy later asks for a handoff or
  pull request.

## Open Design Points

- Exact schema names for `transport`, `gate`, and `branchRole`.
- Whether `gate` is one value or a list of requirements.
- How DevNexus records local human approval without creating noisy provider
  comments.
- How review evidence composes with green-main publication evidence.
- Whether review policy should support CODEOWNERS-like path ownership, or only
  consume provider-native CODEOWNERS evidence when available.
