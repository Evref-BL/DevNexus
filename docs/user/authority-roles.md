# Authority Roles

DevNexus separates the shared authority model from host-local credentials.
Workspaces can name the actors that are allowed to do work, bind roles to those
actors, and keep each machine's credential details in its own DevNexus home.
This lets private workspaces use automation accounts without storing secrets in
the shared workspace repository, and lets open-source contributors prepare work without
needing maintainer access.

Authority is advisory unless a command path explicitly gates a mutation. Do
not treat a role definition as a promise that every provider-side operation is
implemented. Provider adapters, publication policy, branch policy, review
state, setup checks, and host-local credentials can still block a command.

## Model

An actor is the identity DevNexus expects to act. Actors are durable workspace
facts, such as a human maintainer, machine-user bot, GitHub App, team, external
agent, or local operator.

An auth profile is host-local credential context. It lives in the DevNexus home
config, not in `dev-nexus.project.json`. It can name an account, provider,
credential kind, SSH host alias, GitHub CLI config directory, wrapper command,
or command environment keys. Do not put tokens, private keys, or provider CLI
state in the shared workspace.

A role is a named set of authority actions. DevNexus ships recommended roles:

| Role | Typical use |
| --- | --- |
| `maintainer` | Workspace-state updates, branch pushes, review requests, and target-branch integration when publication policy allows it. |
| `contributor` | Local preparation, feature branches, work-item updates, PR creation, and review requests without target-branch integration. |
| `reviewer` | Inspect work, comment, and approve or reject reviews where provider policy allows it. |
| `observer` | Read workspace/provider state and leave handoffs without source, tracker, provider, or runtime mutation. |
| `runtime_operator` | Approved runtime or host-local mutations without source integration authority. |
| `release_operator` | Package or release publication when release policy also allows it. |

A role binding assigns one or more roles to one actor inside a scope. Scopes can
name a workspace, component, provider, tracker, repository, target branch, or
environment. Prefer the narrowest scope that matches the job.

Effective authority is the resolved answer for a specific component and
requested action. It combines the actor, host-local auth profile, role binding,
publication policy, provider state, and fallback action. Status surfaces show
actions as allowed, blocked, or waiting; waiting means authority exists but an
external signal such as review approval, passing checks, mergeability, or
branch-policy clearance is still missing.

Safe defaults are conservative:

- Unknown actors fall back to read-only observer behavior unless the workspace
  config deliberately changes the fallback role.
- Secrets and local credential paths stay out of the shared workspace repository.
- A machine-user automation profile should not be reused as the human/manual
  profile.
- Target-branch pushes, provider mutation, package publishing, release
  publishing, and live runtime mutation need both role authority and the
  relevant workspace policy.
- If the observed account does not match the configured actor, setup and status
  surfaces should warn before mutation.

## Shared Workspace Configuration

Declare actors and role bindings in `dev-nexus.project.json`:

```json
{
  "authority": {
    "actors": [
      {
        "id": "project-owner",
        "kind": "human",
        "provider": "github",
        "providerIdentity": "alice",
        "displayName": "Alice"
      },
      {
        "id": "automation-bot",
        "kind": "machine_user",
        "provider": "github",
        "providerIdentity": "example-automation-bot",
        "displayName": "Example Automation Bot"
      }
    ],
    "roleBindings": [
      {
        "actorId": "automation-bot",
        "roles": ["maintainer"],
        "scope": {
          "project": "example-suite"
        }
      },
      {
        "actorId": "project-owner",
        "roles": ["maintainer", "reviewer", "release_operator"],
        "scope": {
          "project": "example-suite"
        }
      }
    ],
    "unknownActorFallbackRole": "observer"
  }
}
```

The publication actor names the identity automation expects to use for source
publication. The manual actor names the human identity used outside automation:

```json
{
  "components": [
    {
      "id": "core",
      "publication": {
        "strategy": "direct_integration",
        "remote": "bot",
        "targetBranch": "main",
        "push": true,
        "actor": {
          "id": "automation-bot",
          "kind": "machine_user",
          "provider": "github",
          "handle": "example-automation-bot"
        },
        "manualRemote": "origin",
        "manualActor": {
          "id": "project-owner",
          "kind": "human",
          "provider": "github",
          "handle": "alice"
        }
      }
    }
  ]
}
```

Hosting remotes and access records can reference host-local auth profiles by
id. The profile id is shared; the credential material is not:

```json
{
  "hosting": {
    "provider": "github",
    "namespace": "ExampleOrg",
    "repository": {
      "nameTemplate": "{projectId}",
      "visibility": "private",
      "defaultBranch": "main"
    },
    "remotes": [
      {
        "name": "origin",
        "role": "human",
        "protocol": "ssh",
        "authProfile": "human-github"
      },
      {
        "name": "bot",
        "role": "automation",
        "protocol": "ssh",
        "authProfile": "bot-github",
        "sshHost": "github.com-bot"
      }
    ],
    "access": [
      {
        "kind": "human",
        "providerIdentity": "alice",
        "role": "human",
        "requiredPermission": "admin",
        "authProfile": "human-github",
        "invitationPolicy": "auto_accept"
      },
      {
        "kind": "machine_user",
        "providerIdentity": "example-automation-bot",
        "role": "automation",
        "requiredPermission": "write",
        "authProfile": "bot-github",
        "invitationPolicy": "require_accepted"
      }
    ],
    "provisioning": {
      "allowCreate": false,
      "allowLocalRemoteRepair": true,
      "allowAccessRepair": false,
      "allowInvitationAcceptance": true,
      "allowDefaultBranchRepair": false,
      "allowVisibilityRepair": false,
      "providerMutationAuthProfile": "bot-github"
    }
  }
}
```

## Host-Local Profiles

Each machine stores auth profiles in its DevNexus home config:

```json
{
  "version": 1,
  "paths": {
    "projectsRoot": "home:projects",
    "workspacesRoot": "home:workspaces"
  },
  "authProfiles": [
    {
      "id": "human-github",
      "actorId": "project-owner",
      "provider": "github",
      "kind": "human",
      "account": "alice",
      "host": "github.com"
    },
    {
      "id": "bot-github",
      "actorId": "automation-bot",
      "provider": "github",
      "kind": "automation",
      "account": "example-automation-bot",
      "sshHost": "github.com-bot",
      "environmentKeys": ["GH_CONFIG_DIR"]
    }
  ],
  "projects": []
}
```

The shared workspace may mention `human-github` and `bot-github` as profile ids,
but every operator controls what those profiles mean on their own machine.
Setup checks should flag a missing profile, an account mismatch, or a remote
that points at the wrong profile before automation publishes.

## Role Patterns

Use these patterns as starting points and narrow scopes when possible.

Maintainer bot for a private workspace repository:

```json
{
  "actorId": "automation-bot",
  "roles": ["maintainer"],
  "scope": {
    "project": "example-suite"
  }
}
```

This bot can commit, push branches, update work items, request reviews, and
directly integrate only when the component publication policy and host-local
auth profile also allow the requested action.

Contributor-only bot:

```json
{
  "actorId": "contribution-bot",
  "roles": ["contributor"],
  "scope": {
    "component": "core"
  }
}
```

Use this for fork or PR-only automation. It can prepare work and request
review, but it does not get target-branch integration, release publication, or
runtime mutation authority.

Reviewer:

```json
{
  "actorId": "reviewer-team",
  "roles": ["reviewer"],
  "scope": {
    "repository": "ExampleOrg/example-suite"
  }
}
```

Reviewer authority is for comments and provider review decisions. It does not
grant source publication or workspace-state ownership.

Observer:

```json
{
  "actorId": "reporting-agent",
  "roles": ["observer"],
  "scope": {
    "project": "example-suite"
  }
}
```

Observers can read state and leave handoffs. Use this for dashboards, audits,
status summaries, or untrusted automation.

Runtime operator:

```json
{
  "actorId": "runtime-agent",
  "roles": ["runtime_operator"],
  "scope": {
    "environment": "staging"
  }
}
```

Runtime authority is deliberately separate from source integration. The
selected work item and workspace policy must still authorize live runtime work.

Release operator:

```json
{
  "actorId": "release-bot",
  "roles": ["release_operator"],
  "scope": {
    "component": "core"
  }
}
```

Release authority does not bypass package or release publication policy. If a
component's policy does not allow package or release publishing, the action
stays blocked.

## Onboarding

When creating a new private workspace:

1. Create or import the DevNexus workspace.
2. Add shared `hosting`, `publication`, `authority.actors`, and
   `authority.roleBindings` records that describe the intended actors and
   remotes.
3. Create host-local auth profiles in each operator's DevNexus home.
4. Run setup and hosting status checks before allowing automation to mutate
   remotes, trackers, providers, or target branches.

When joining an existing workspace on a new machine:

1. Clone or open the shared workspace repository.
2. Initialize or select a DevNexus home.
3. Add host-local auth profiles whose ids match the shared workspace references.
4. Configure local remotes such as `origin` for the human profile and `bot` for
   the automation profile.
5. Run setup checks and inspect authority status before starting automation.

The shared workspace repository should contain only portable intent: actor ids,
provider identities, remote names, profile ids, SSH host aliases, and expected
account names. Secrets, token files, private keys, and provider CLI state stay
host-local.

## Open-Source Contribution

For open-source work, contributors should not need maintainer rights in the
upstream repository. A contributor setup normally uses a fork or feature branch,
`contributor` role authority, and a publication policy that opens or updates a
pull request instead of pushing the target branch.

PR-only behavior means:

- Prepare work in a generated component worktree or fork checkout.
- Push a feature branch only through the contributor-controlled remote.
- Open or update a pull request when the provider adapter and workspace policy
  allow it.
- Wait for reviews, checks, mergeability, and branch policy before merge.
- Do not directly integrate to the upstream target branch by default.
- Do not write `.dev-nexus/`, generated skill files, worktree metadata, or
  local tracker files into the target repository unless that repository is the
  DevNexus workspace repository itself and explicitly owns those files.

DevNexus coordination artifacts belong in the configured workspace repository or
tracker. Target source repositories should receive only the source, tests,
docs, and repository-native files required by the contribution.
