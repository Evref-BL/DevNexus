# Providers, Auth, And Hosting

DevNexus can reference external systems such as GitHub, GitLab, Jira, Codex,
Claude, and future providers. Shared workspace configuration should describe
intent. Host-local credential details stay on each machine.

## Accounts

Workspaces often need two kinds of provider accounts:

- A **user account** for manual user actions. The current config model may call
  this actor kind `human`.
- An **automation actor** for agent-created provider activity, such as pushing
  branches, opening issues, commenting, or creating pull requests. On GitHub,
  prefer a GitHub App for organization automation. A machine-user account is
  still a useful simple or legacy option.

Do not let an agent silently fall back to a user account when workspace policy
expects an automation actor. Configure the profile explicitly.

## Credential Methods

DevNexus should reference credential context, not store secrets.

Typical credential methods:

- GitHub App installation tokens minted from a host-local private key
- GitHub App user access tokens supplied by a host-local OAuth/token helper
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
      "kind": "human",
      "account": "alice",
      "host": "github.com"
    },
    {
      "id": "bot-github",
      "provider": "github",
      "kind": "automation",
      "account": "example-bot",
      "sshHost": "github.com-example-bot",
      "githubCliConfigDir": "/home/alice/.config/gh-example-bot",
      "environmentKeys": ["GH_CONFIG_DIR"]
    },
    {
      "id": "devnexus-app",
      "provider": "github",
      "kind": "app",
      "credentialKind": "github_app",
      "account": "devnexus-automation",
      "host": "github.com",
      "environmentKeys": ["GH_TOKEN", "GITHUB_TOKEN"],
      "purposes": ["api", "git", "cli"],
      "githubApp": {
        "appId": "12345",
        "clientId": "Iv23example",
        "slug": "devnexus-automation",
        "privateKeyPath": "/home/alice/.dev-nexus/secrets/github-apps/devnexus-automation/private-key.pem",
        "installationAccount": "ExampleOrg",
        "repositories": ["example-suite"],
        "tokenRefreshBufferSeconds": 300
      }
    },
    {
      "id": "alice-devnexus-app-user",
      "actorId": "alice",
      "provider": "github",
      "kind": "human",
      "credentialKind": "github_app_user_token",
      "account": "alice",
      "host": "github.com",
      "environmentKeys": ["GH_TOKEN"],
      "purposes": ["api", "git"],
      "command": "/home/alice/.dev-nexus/secrets/github-apps/devnexus-automation/user-token.mjs --repo {repository.owner}/{repository.name}"
    }
  ]
}
```

Setup previews include an auth inventory. The inventory reports which profiles
are required now, optional later, or needed only for provider mutations. It
checks host-local handles without printing secret values.

## GitHub Apps

A GitHub App is the preferred GitHub automation actor for organization-owned
work because the App is installed on accounts and repositories instead of being
treated as a regular user. The App can be public and reusable across
organizations, or private to one account. Each organization or user still
installs it and chooses all repositories or selected repositories.

DevNexus distinguishes these GitHub App modes:

- App identity/JWT: used only to ask GitHub for App or installation tokens.
- Installation token/server-to-server: GitHub attributes API actions to the
  App, such as `devnexus-automation[bot]`. This is the default organization
  automation mode.
- User access token/user-to-server: GitHub attributes API actions to the
  authorizing user and shows the App as the programmatic access path. Use this
  only when project policy wants a human to be the visible actor.

Create the App in GitHub first. For a normal DevNexus automation App, start
with these settings:

- App name: a clear product or automation name, such as `DevNexus Automation`.
- Homepage URL: the DevNexus repository or docs site.
- Callback URL: blank unless the App has a user OAuth flow.
- Request user authorization during installation: off unless DevNexus needs a
  user OAuth flow.
- Device flow: off unless DevNexus needs a user OAuth flow.
- Webhook active: off until an integration actually consumes webhooks.
- Installable by: any account when the App should be reusable across
  organizations.

Start with the smallest repository permissions that match the workflows:

- Contents: read and write for branch publication.
- Pull requests: read and write for pull-request creation, update, merge, and
  comments.
- Issues: read and write for issue status, comments, and closing.
- Checks: read-only for check-run evidence.
- Commit statuses: read-only for legacy status evidence.
- Actions: read-only when workflows, jobs, or artifacts must be inspected.
- Metadata: GitHub grants this automatically.
- Workflows: no access unless agents must edit `.github/workflows/*`.

After creating the App, generate a private key and keep the downloaded `.pem`
file in a host-local secret store such as
`~/.dev-nexus/secrets/github-apps/<app-slug>/`. Put only the path and public App
metadata in the DevNexus home auth profile. Do not put the key contents or
issued installation tokens in a shared workspace file.

Install the App on each GitHub organization or user account that should use it.
If the installation is limited to selected repositories, include every component
repository DevNexus needs to read or write. DevNexus hosting status reports
three different App problems separately: the App is not installed, the
repository is not selected, or the installation is missing a required
permission.

For human-attributed automation, the App also needs a user authorization flow.
Use either a callback URL for a web OAuth flow or enable device flow for a
headless/CLI flow. Store user access tokens, refresh tokens, client secrets,
and any helper state in host-local secret storage. In shared DevNexus config,
reference only the auth profile id and a host-local command or environment key.
GitHub limits user-to-server tokens to the intersection of the user's access,
the App installation's repository access, and the App's granted permissions.

A `github_app_user_token` profile should normally use a host-local helper
command. The helper owns the OAuth/device-flow state and prints a short-lived
token response for the requested repository. DevNexus passes placeholders such
as `{repository.owner}` and `{repository.name}` to the command and accepts
either plain token output or JSON:

```json
{
  "accessToken": "redacted",
  "expiresAt": "2026-05-21T13:00:00.000Z",
  "login": "alice",
  "actorId": "alice",
  "permissions": {
    "contents": "write",
    "issues": "write",
    "pull_requests": "write"
  }
}
```

`accessToken`, `token`, or `value` provide the bearer token. `expiresAt` lets
DevNexus reject expired helper output. `login`, `providerIdentity`, `account`,
or `user` let DevNexus confirm the token belongs to the expected human actor.
`permissions` lets DevNexus check the App/user intersection before a write.
When authorization is missing, refresh fails, the App is not installed, the
repository is not selected, or permissions are insufficient, the helper should
exit non-zero with a concise message and no token.

`gh` can still be useful. A user may keep using `gh` for manual GitHub actions,
and a DevNexus adapter may use `gh` as one backend. Workspace workflows should
depend on the DevNexus provider facade and auth profile id, not on hard-coded
`gh` commands.

## Work Trackers

A component can use a local tracker, a provider tracker, or both.

Local tracking is the simplest first-workspace default. Provider-backed trackers
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
      "authProfileId": "devnexus-app"
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

The DevNexus workspace root is often a Git repository. Hosting that repository
lets multiple machines and agents share workspace state.

Hosting intent is about the DevNexus workspace repository, not every component
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
    "automationAuthProfileId": "devnexus-app",
    "providerMutationAuthProfileId": "devnexus-app"
  }
}
```

`workspace init` records hosting intent and reports the next commands.
`workspace setup` is an alias for the same local setup flow. Neither command
creates repositories or mutates provider state.

Inspect hosting state:

```bash
dev-nexus workspace hosting status <workspace-root>
dev-nexus workspace hosting plan <workspace-root>
```

Apply hosting repairs only when policy and credentials are explicit:

```bash
dev-nexus workspace hosting apply <workspace-root>
```

## Publication Posture

Publication policy describes what agents may do after verification.

The default posture is `review_handoff`. It keeps the first workspace simple:
the agent prepares a branch or handoff, records verification, and leaves
publication to the user or maintainer. Version planning, publication trains, CI
tiers, merge queues, and remote runners are optional additions.

Common postures:

- `local_only`: record work locally, no publication.
- `review_handoff`: prepare a branch or handoff for user review.
- `direct_integration`: integrate directly when policy allows.
- `green_main`: validate through required checks before merging to the target
  branch.

See [Publication workflows](publication-workflows.md) for the simple default
configuration and the opt-in green-main, CI tier, and publication train path.

For hosted workspaces, prefer explicit automation remotes and auth profiles for
agent-created Git and provider activity. With GitHub Apps, the remote can be a
plain HTTPS repository URL while DevNexus injects a short-lived token only for
the Git operation that needs it. Use an installation-token profile when the App
should be the actor, and a `github_app_user_token` profile when a human actor
should be visible with the App recorded as the credential path.

## Authority Roles

Auth profiles say how a machine can authenticate. Authority roles say whether
the current actor may use that authentication for a specific action.

Use authority roles to separate maintainers, contributors, reviewers, runtime
operators, release operators, user accounts, and bot accounts.

See [Authority roles](authority-roles.md) for full examples.
