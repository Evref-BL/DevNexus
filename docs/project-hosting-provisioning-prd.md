# Project Hosting Provisioning Product Requirements Document (PRD)

## Problem

DevNexus can describe a meta-project repository, expected Git remotes, host-local
authentication profiles, and publication policy. That is enough to check many
facts, but it is not enough to safely create or repair a hosted project.

The gap appeared while creating the `dev-nexus-plexus` meta-project. The
automation account created a private GitHub repository and pushed the project,
but the human account was not granted access. An agent can repair that manually
with provider commands, but that is exactly the wrong ownership boundary. A
repository setup mistake should not become chat memory, one-off shell history,
or an improvised GitHub command.

DevNexus needs project hosting provisioning as a declared, idempotent operation.
The user-facing Application Programming Interface (API) should be dumb and
obvious: declare the repository, declare the accounts that must have access,
then run a plan or apply command. The tool should absorb the complexity:
provider behavior, remotes, authentication profiles, collaborator invitations,
permission checks, drift detection, and safe repair.

## Goals

- Let a DevNexus project declare hosted repository intent with minimal,
  predictable configuration.
- Let projects declare required human and automation access without spelling out
  provider-specific repair commands.
- Provide a dry-run plan that explains exactly what exists, what is missing,
  what will be changed, and what remains blocked or needs explicit
  human/provider action.
- Provide an apply operation that creates missing repositories, configures
  remotes, and repairs access when project policy allows it.
- Keep secrets and local credential material out of shared project
  configuration.
- Make collaborator invitation state explicit, especially for private GitHub
  repositories where access may require acceptance by the invited account.
- Accept repository invitations automatically when the invited principal has a
  configured auth profile and project policy allows DevNexus to use it for that
  purpose.
- Keep provider-specific complexity in hosting adapters, not in project
  configuration or agent instructions.
- Make the workflow testable with mocked providers before any live GitHub,
  GitLab, or other provider calls.

## Non-Goals

- Do not make DevNexus choose implementation work.
- Do not bypass provider permissions, organization policy, branch protection,
  single sign-on, or required invitation acceptance.
- Do not store tokens, private keys, GitHub CLI state, or browser sessions in
  portable project configuration.
- Do not require every provider to implement every provisioning capability.
- Do not make repository creation or access mutation implicit in status checks.
- Do not add PLexus, Pharo, Codex, or language-specific behavior to the generic
  hosting model.
- Do not automatically grant broad access to all known accounts; required
  access must be declared.

## Users

- A project owner creating a new DevNexus meta-project.
- A human maintainer who needs normal manual access to a private meta-project
  repository.
- A bot or machine user that creates repositories, pushes automation commits,
  and performs provider writes under project policy.
- A coordinator agent that needs to detect missing repository access without
  manually inventing provider commands.
- A new host joining an existing DevNexus project and validating that its human
  and automation profiles match the project.

## Product Vocabulary

- Hosting intent: the portable declaration of provider, namespace, repository
  name, visibility, default branch, remotes, and required access.
- Auth profile: a host-local credential profile such as a GitHub CLI
  configuration directory, Secure Shell (SSH) host alias, or future provider
  app credential.
- Principal: a declared provider identity that should have access, such as a
  human account, machine user, organization team, deploy key, or provider app.
- Required access: the minimum repository permission a principal must have for
  the project to be healthy.
- Provisioning plan: a dry-run result describing missing repository, remote,
  access, branch, and provider-state facts.
- Provisioning apply: a policy-gated operation that performs the safe subset of
  the provisioning plan.
- Pending invitation: provider state where access has been requested but the
  target human or organization has not accepted or activated it.
- Drift: a hosted repository fact that differs from project intent, such as
  visibility, missing remote, wrong default branch, missing collaborator, or
  insufficient access.

## Core Principle: Dumb API, Smart Tool

The API should not ask users to understand provider mechanics. A project should
say what it wants in direct nouns:

- repository owner or namespace
- repository name
- visibility
- default branch
- remotes
- required access
- whether creation and access repair are allowed

Everything else belongs in the tool:

- deriving provider URLs
- choosing provider API endpoints
- resolving host-local auth profiles
- detecting the current account for each profile
- checking whether the repository exists
- creating the repository when allowed
- adding or inviting collaborators
- checking teams, organization membership, and invitation state
- configuring local remotes without clobbering unrelated remotes
- explaining blocked states, automatic invitation acceptance options, and exact
  manual acceptance requirements when automation cannot complete the flow
- retrying safe reads and distinguishing provider latency from real failure

The best user experience is boring. A user should be able to look at the
configuration and know what the project requires without knowing how GitHub
collaborator invitations work.

## Configuration Direction

DevNexus already has a `hosting` project configuration area for provider,
namespace, repository, remotes, auth profile references, and repository creation
policy. Extend it with required access and explicit provisioning permissions.

The conceptual model should support:

- Repository:
  - provider
  - namespace
  - name or name template
  - visibility
  - default branch
- Remotes:
  - name
  - role
  - protocol
  - auth profile
  - optional provider host or SSH host alias
- Access:
  - principal kind, such as human, machine user, team, deploy key, or app
  - provider login or team slug
  - intended role, such as human, automation, reviewer, or observer
  - required permission, such as read, write, maintain, or admin
  - auth profile to use when checking that principal, when relevant
  - whether pending invitation is acceptable
- Provisioning:
  - allow repository creation
  - allow remote repair
  - allow access repair
  - allow default-branch repair
  - allow visibility repair
  - provider mutation auth profile

Recommended default behavior:

- Status and plan never mutate provider state.
- Apply mutates only the classes explicitly allowed by provisioning policy.
- Repository creation is disabled unless explicitly allowed.
- Access repair is disabled unless explicitly allowed.
- Human access defaults to read unless the project declares a stronger
  permission.
- Automation access defaults to write, or admin only when it must create or
  administer the repository.
- Pending invitations are repairable when the invited principal has a configured
  auth profile and provisioning policy allows invitation acceptance.
- Pending invitations are warnings or blockers only when DevNexus cannot act as
  the invited principal, the provider blocks acceptance, or project policy
  requires explicit human confirmation.

## User-Facing Commands

The command surface should stay small:

- `dev-nexus project hosting status`
- `dev-nexus project hosting plan`
- `dev-nexus project hosting apply`

Status answers "what is true right now?"

Plan answers "what would DevNexus do, and what is blocked?"

Apply answers "make the declared safe changes, then report what still needs
human or provider action."

The Model Context Protocol (MCP) surface should mirror those concepts with
structured inputs and outputs. Agents should not need provider-specific tools to
perform the normal setup path.

## Hosting Status

Hosting status should report:

- hosting configured or absent
- provider and namespace
- resolved repository name
- repository existence
- visibility and default branch
- expected remotes and current local remote matches
- auth profiles used for human and automation remotes
- current actor observed for each auth profile
- required access entries and effective provider state
- pending invitations
- blockers and warnings
- whether apply is currently allowed

Status must never create repositories, invite collaborators, update remotes, or
write provider state.

## Hosting Plan

Hosting plan should be a deterministic dry run. It should report ordered actions
with enough detail for a human to approve the result:

- create repository
- update local remote URL
- add missing remote
- add collaborator
- update collaborator permission
- invite collaborator
- accept pending invitation using the invited principal's auth profile
- wait for pending invitation when no usable invited-principal auth profile is
  configured
- set default branch
- decline unsafe visibility change
- decline unsupported provider operation

Each action should include:

- action id
- provider
- target repository
- target principal or remote
- current state
- desired state
- mutation required or read-only
- allowed, blocked, or manual
- reason
- auth profile that would perform the action

The plan should be stable enough to test with snapshots and useful enough to
paste into a work-item comment.

## Hosting Apply

Hosting apply should execute only allowed plan actions. It should:

- recompute the plan immediately before mutation
- fail fast if required auth profiles are missing
- create repositories only when creation is allowed
- create private repositories with the declared visibility
- configure local remotes only for declared remote names
- avoid changing unknown remotes
- add or invite declared collaborators when access repair is allowed
- accept pending invitations when invitation acceptance is allowed and the
  invited principal's auth profile is available
- report pending invitations separately from completed access when they cannot
  be accepted automatically
- record provider URLs and remote URLs after mutation
- return a final status check after applying changes

Apply should be idempotent. Running it twice against a healthy project should
produce no provider mutations.

## GitHub Behavior

The first provider implementation should target GitHub because dogfood uses a
GitHub machine user and private meta-project repositories.

GitHub-specific behavior should live behind a hosting provider adapter. The
generic API should not expose GitHub endpoint names.

Required GitHub capabilities:

- read repository metadata
- create a repository under a user or organization namespace when allowed
- read the authenticated account for an auth profile
- inspect current collaborator permission
- add or update a collaborator permission when allowed
- detect pending collaborator invitation state when possible
- list repository invitations for the authenticated invited user when an auth
  profile is configured for that principal
- accept a repository invitation as the invited user when provisioning policy
  allows it
- report cases where organization policy, single sign-on, or insufficient token
  scope prevents the operation
- distinguish "not found because repository is absent" from "not found because
  the current actor lacks access" when provider evidence allows it

GitHub should not silently treat a pending collaborator invitation as completed
access unless DevNexus has successfully accepted it through the invited
principal's configured auth profile. If DevNexus can see the invitation from an
administrator profile but cannot authenticate as the invitee, the plan should
say exactly which auth profile is missing or unusable.

## Relationship To Existing DevNexus Concepts

Hosting provisioning complements, but does not replace:

- publication policy, which decides whether work is pushed, handed off, or kept
  local
- authority policy, which decides which actors may mutate providers
- setup checks, which validate host-local readiness
- work tracking, which records planned and completed implementation work
- agent launch context, which tells agents what infrastructure facts are true

The hosting tool should feed those concepts with factual state. It should not
decide whether an implementation agent is a maintainer or contributor. That
belongs to authority policy.

## User Stories

As a project owner, I can declare that a meta-project repository should exist
under a bot account, be private, and grant my human account admin access.

As a human maintainer, I can run a dry-run command and see that the repository
exists and my account has a pending invitation that DevNexus can accept through
my configured human auth profile.

As an automation account, I can create a repository and configure the declared
remotes without accidentally using the human account.

As a coordinator agent, I can report "human account not invited" as a hosting
setup blocker instead of inventing provider commands.

As a new host joining a project, I can validate that my local human and bot auth
profiles match the shared hosting intent before running automation.

As an invited maintainer, I can let DevNexus accept a pending provider
invitation for me when my host-local auth profile is configured, instead of
opening the provider user interface.

As a maintainer reviewing project configuration, I can tell the intended
repository access model by reading a short, obvious block of configuration.

## Acceptance Criteria

- Project config validates a required hosting access model with principal kind,
  provider identity, required permission, and invitation policy.
- Existing hosting configs without access declarations remain valid.
- Hosting status reports repository, remotes, auth profiles, observed actors,
  required access, pending invitations, warnings, and blockers.
- Hosting plan produces stable structured actions for missing repository,
  missing remotes, wrong remote URLs, missing access, insufficient access, and
  pending invitations.
- Hosting apply executes only actions allowed by provisioning policy.
- GitHub provider support can create a repository, add or invite a collaborator,
  detect effective or pending collaborator access, and accept a pending
  invitation through the invitee auth profile in mocked tests.
- Local remote repair does not delete or mutate undeclared remotes.
- Missing auth profiles, mismatched current actor, insufficient provider scopes,
  organization policy blockers, and unsupported provider operations produce
  actionable failures.
- The `dev-nexus-plexus` scenario can be represented declaratively: private
  repository under the automation account namespace, bot automation remote,
  human origin remote, and required human account access.
- Documentation shows the minimal API and explains that provider details belong
  to the tool.

## Testing Decisions

- Unit tests should cover configuration validation and defaulting.
- Provider adapter tests should use mocked GitHub responses for repository
  absent, repository present, missing collaborator, insufficient collaborator
  permission, pending invitation, and organization policy failure.
- Invitation acceptance tests should cover successful acceptance, missing
  invitee auth profile, invitee profile authenticated as the wrong account,
  expired invitation, insufficient token scope, and provider policy rejection.
- Planner tests should assert stable action ordering and no mutation during
  plan.
- Apply tests should assert idempotency and policy-gated mutation.
- Remote configuration tests should cover `origin`, `bot`, SSH host aliases,
  HTTPS remotes, and undeclared remote preservation.
- Setup/status tests should prove hosting drift appears in project status and
  setup checks without live provider access in normal test runs.
- A dogfood follow-up can validate against the real `Gabot-Darbot` repositories
  only after the mocked provider implementation passes.

## Out Of Scope

- Browser-based provider setup.
- Secret storage or credential generation.
- Provider organization creation.
- Branch protection administration.
- Repository transfer between owners.
- Team creation or membership management beyond checking and granting
  repository access to an existing team.
- Accepting invitations without a configured invitee auth profile and explicit
  project policy permission.
- Non-Git repository hosting.
- Making GitHub mandatory for DevNexus projects.

## Further Notes

This work should be sliced after the authority model is considered, but it does
not need to wait for the full authority implementation. A first source slice can
add access declarations, status, and planning without live provider mutation.
Apply can follow behind explicit provisioning gates.

The user-facing API should resist becoming clever. If configuration starts
requiring provider endpoint names, token-scope recipes, or imperative steps, the
complexity has leaked into the wrong layer.
