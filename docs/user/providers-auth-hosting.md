# Providers, Auth, And Hosting

DevNexus can reference external systems such as GitHub, GitLab, Jira, Codex,
Claude, and future providers. Shared project configuration should describe
intent. Host-local credential details stay on each machine.

## Accounts

Projects often need two kinds of provider accounts:

- A **user account** for manual user actions. The current config model may call
  this actor kind `human`.
- A **bot or machine account** for agent-created provider activity, such as
  pushing branches, opening issues, commenting, or creating pull requests.

Do not let an agent silently fall back to a user account when project policy
expects a bot account. Configure the bot profile explicitly.

## Credential Methods

DevNexus should reference credential context, not store secrets.

Typical credential methods:

- provider CLI profiles, such as `gh` for GitHub or `glab` for GitLab
- environment-variable names, such as `GITHUB_TOKEN`
- SSH host aliases, such as `github.com-bot`
- host-local token stores or wrapper scripts

Raw tokens, passwords, private keys, SSH key material, and provider CLI state
do not belong in `dev-nexus.project.json` or setup answer files.

## Auth Profiles

An auth profile is a named reference to host-local credential context.

Example:

```json
{
  "authProfiles": [
    {
      "id": "human-github",
      "provider": "github",
      "actorKind": "human",
      "account": "alice",
      "credentialMethod": {
        "kind": "provider_cli",
        "cli": "gh",
        "configDir": "home:.config/gh"
      }
    },
    {
      "id": "bot-github",
      "provider": "github",
      "actorKind": "machine_user",
      "account": "example-bot",
      "credentialMethod": {
        "kind": "provider_cli",
        "cli": "gh",
        "configDir": "home:.config/gh-bot"
      }
    }
  ]
}
```

Setup previews include an auth inventory. The inventory reports which profiles
are required now, optional later, or needed only for provider mutations. It
checks host-local handles without printing secret values.

## Work Trackers

A component can use a local tracker, a provider tracker, or both.

Local tracking is the simplest first-project default. Provider-backed trackers
are useful when the shared system of record is GitHub Issues, GitLab issues,
Jira, or another provider.

Example GitHub tracker intent:

```json
{
  "workTrackers": [
    {
      "id": "github",
      "provider": "github",
      "role": "eligible_source",
      "repositoryOwner": "ExampleOrg",
      "repositoryName": "example-suite",
      "authProfileId": "bot-github"
    }
  ]
}
```

Read [Multi-tracker work tracking](multi-tracker.md) before linking local work
items to provider issues or planning sync.

## Provider Commands And APIs

DevNexus should prefer neutral provider records over hard-coded forge commands.
When a command needs live provider facts, collect those facts through the
configured provider adapter, provider CLI, or provider API, then pass the saved
facts to DevNexus for classification.

For example, GitHub users may collect pull-request checks with `gh`. GitLab,
Jira, or another forge may need a provider-specific CLI or API call instead.
The durable DevNexus surface should be the normalized tracker item, request,
check report, or publication decision, not a README workflow that only works on
one forge.

## Meta-Repository Hosting

The DevNexus project root is often a Git repository. Hosting that repository
lets multiple machines and agents share project state.

Hosting intent is about the DevNexus meta-repository, not every component
repository.

Example:

```json
{
  "hostingIntent": {
    "provider": "github",
    "namespace": "ExampleOrg",
    "repositoryName": "example-suite",
    "defaultBranch": "main",
    "humanAuthProfileId": "human-github",
    "automationAuthProfileId": "bot-github",
    "providerMutationAuthProfileId": "bot-github"
  }
}
```

`project setup` records hosting intent and reports the next commands. It does
not create repositories or mutate provider state.

Inspect hosting state:

```bash
dev-nexus project hosting status <project-root>
dev-nexus project hosting plan <project-root>
```

Apply hosting repairs only when policy and credentials are explicit:

```bash
dev-nexus project hosting apply <project-root>
```

## Publication Posture

Publication policy describes what agents may do after verification.

Common postures:

- `local_only`: record work locally, no publication.
- `review_handoff`: prepare a branch or handoff for user review.
- `direct_integration`: integrate directly when policy allows.
- `green_main`: validate through required checks before merging to the target
  branch.

For hosted projects, prefer explicit bot remotes and bot auth profiles for
agent-created Git and provider activity.

## Authority Roles

Auth profiles say how a machine can authenticate. Authority roles say whether
the current actor may use that authentication for a specific action.

Use authority roles to separate maintainers, contributors, reviewers, runtime
operators, release operators, user accounts, and bot accounts.

See [Authority roles](authority-roles.md) for full examples.
