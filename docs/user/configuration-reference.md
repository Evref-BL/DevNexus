# DevNexus Configuration Reference

This reference is maintained in `src/config-reference/nexusConfigReference.ts`.
Focused tests compare its parser field index with the workspace, home, and automation config parsers so accepted field names cannot be added silently.

CLI:

```bash
dev-nexus config reference --scope all
dev-nexus config reference --scope workspace --json
```

## Workspace Config (`dev-nexus.project.json`)

| Path | Type | Values | Required | Default | Summary | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `version` | 1 |  | yes |  | Workspace config schema version. |  |
| `id` | string |  | yes |  | Stable workspace id used by local state and generated agent context. | [Concepts](concepts.md) |
| `name` | string |  | yes |  | Human-readable workspace name. | [Concepts](concepts.md) |
| `home` | string \| null |  | no | `null` | Optional DevNexus home path override for this workspace. | [Getting started](getting-started.md) |
| `repo` | object |  | yes |  | Workspace metadata repository settings. | [Concepts](concepts.md) |
| `worktreesRoot` | string |  | no | `worktrees` | Default workspace-relative directory for prepared worktrees. | [Agent workflows](agent-workflows.md) |
| `components[]` | array&lt;object&gt; |  | yes |  | Source folders or artifacts coordinated by this workspace. | [Concepts](concepts.md), [Getting started](getting-started.md) |
| `components[].id` | string |  | yes |  | Stable component id used in work items, leases, and commands. |  |
| `components[].sourceRoot` | string |  | yes |  | Workspace-relative or absolute component source path. | [Getting started](getting-started.md) |
| `components[].defaultWorkTrackerId` | string |  | no |  | Default work tracker binding for this component. | [Multi-tracker work tracking](multi-tracker.md) |
| `workTracking` | object |  | no |  | Legacy/default work tracker selection. | [Multi-tracker work tracking](multi-tracker.md) |
| `workTrackers[]` | array&lt;object&gt; |  | no |  | Named local or provider-backed tracker bindings. | [Multi-tracker work tracking](multi-tracker.md) |
| `trackerDiscovery` | object |  | no |  | Controls work-item discovery, visibility, and query limits. | [Multi-tracker work tracking](multi-tracker.md) |
| `workTrackerCommunication` | object |  | no |  | Commenting and status-update policy for tracker communication. | [Multi-tracker work tracking](multi-tracker.md), [Agent workflows](agent-workflows.md) |
| `agent` | object |  | no |  | Default agent command, model, reasoning, and tool approval settings. | [Agent workflows](agent-workflows.md) |
| `agentTargets[]` | array&lt;object&gt; |  | no |  | Agent client targets that receive generated support such as Codex or Claude config. | [Agent targets and projection cleanup](agent-targets.md) |
| `mcp` | object |  | no |  | Core MCP exposure and gateway materialization settings. | [Agent targets and projection cleanup](agent-targets.md), [Agent workflows](agent-workflows.md) |
| `skills` | object |  | no |  | Workspace skill projection and agent skill-pack settings. | [Agent targets and projection cleanup](agent-targets.md) |
| `plugins[]` | array&lt;object&gt; |  | no |  | Installed plugin projections, MCP servers, skills, and capabilities. | [Agent targets and projection cleanup](agent-targets.md) |
| `hosting` | object |  | no |  | Provider hosting, repository provisioning, access repair, and remotes. | [Providers, auth, and hosting](providers-auth-hosting.md) |
| `automation` | object |  | no |  | Automation selector, executor, verification, publication, and safety policy. | [Agent workflows](agent-workflows.md), [Publication workflows](publication-workflows.md) |
| `automation.selector` | object |  | no |  | Eligible work-item filters such as statuses, labels, assignees, search, and limit. | [Agent workflows](agent-workflows.md) |
| `automation.verification` | object |  | no |  | Focused and full verification commands used by automation and handoffs. | [Agent workflows](agent-workflows.md) |
| `automation.publication` | object |  | no |  | Branch, review, package, release, and credential policy for publishing work. | [Publication workflows](publication-workflows.md) |
| `automation.publication.strategy` | string | `local_only`, `direct_integration`, `review_handoff`, `blocked` | no |  | Publication strategy selected by automation and PR handoff commands. | [Publication workflows](publication-workflows.md) |
| `automation.publication.gitIdentity` | object \| null |  | no |  | Primary Git author/committer identity plus any co-author trailers. | [Publication workflows](publication-workflows.md) |
| `automation.publication.gitIdentity.name` | string |  | no |  | Configured primary Git author and committer name. | [Publication workflows](publication-workflows.md) |
| `automation.publication.gitIdentity.email` | string |  | no |  | Configured primary Git author and committer email. | [Publication workflows](publication-workflows.md) |
| `automation.publication.gitIdentity.coAuthors[]` | array&lt;object&gt; |  | no |  | Additional commit trailer identities rendered as Co-authored-by lines. | [Publication workflows](publication-workflows.md) |
| `automation.publication.gitIdentity.coAuthors[].name` | string |  | yes |  | Co-author display name for the exact Co-authored-by trailer. | [Publication workflows](publication-workflows.md) |
| `automation.publication.gitIdentity.coAuthors[].email` | string |  | yes |  | Co-author email for the exact Co-authored-by trailer. | [Publication workflows](publication-workflows.md) |
| `automation.gitWorkflows[]` | array&lt;object&gt; |  | no |  | Configurable stateful Git workflow decision graphs. | [Git workflow integration](git-workflows.md) |
| `automation.featureBranchDelivery` | object |  | no |  | Feature branch, integration branch, review branch, and finalization policy. | [Publication workflows](publication-workflows.md) |
| `automation.greenMain` | object |  | no |  | Green-main merge planning, rerun, check, and freshness policy. | [Publication workflows](publication-workflows.md) |
| `automation.releaseTrain` | object |  | no |  | Release train batching, candidate branch, promotion, and final PR policy. | [Publication workflows](publication-workflows.md) |
| `automation.workItemClaims` | object |  | no |  | Local or PostgreSQL-backed work-item claim authority and lease policy. | [Agent workflows](agent-workflows.md), [PostgreSQL claim authority](postgresql-claim-authority.md) |
| `hosts[]` | array&lt;object&gt; |  | no |  | Known execution hosts and host-local safety hints. | [Agent workflows](agent-workflows.md) |
| `runnerProfiles[]` | array&lt;object&gt; |  | no |  | Remote execution runner profiles, command profiles, and host requirements. | [Agent workflows](agent-workflows.md) |
| `authority` | object |  | no |  | Actors, roles, bindings, permissions, policy gates, and approval records. | [Agent workflows](agent-workflows.md), [Publication workflows](publication-workflows.md) |
| `versionPlanning` | object |  | no |  | Version scopes, release readiness, and component inclusion policy. | [Publication workflows](publication-workflows.md) |

## Home Config (`dev-nexus.home.json`)

| Path | Type | Values | Required | Default | Summary | Docs |
| --- | --- | --- | --- | --- | --- | --- |
| `version` | 1 |  | yes |  | Home config schema version. |  |
| `paths.projectsRoot` | string |  | yes |  | Default root for registered project source folders. | [Getting started](getting-started.md) |
| `paths.workspacesRoot` | string |  | yes |  | Default root for DevNexus workspace directories. | [Getting started](getting-started.md) |
| `projects[]` | array&lt;object&gt; |  | yes |  | Registered DevNexus projects and workspace roots. | [Getting started](getting-started.md) |
| `agent` | object |  | no |  | Host-level default agent command paths and environment keys. | [Agent workflows](agent-workflows.md) |
| `authProfiles[]` | array&lt;object&gt; |  | no |  | Host-local provider credential profiles used by workspaces. | [Providers, auth, and hosting](providers-auth-hosting.md) |
| `authProfiles[].githubApp` | object |  | no |  | GitHub App installation or user-to-server authentication settings. | [Providers, auth, and hosting](providers-auth-hosting.md) |
| `claimAuthorityProfiles[]` | array&lt;object&gt; |  | no |  | Host-local shared claim backends such as PostgreSQL connection profiles. | [PostgreSQL claim authority](postgresql-claim-authority.md) |
| `hostOverlays[]` | array&lt;object&gt; |  | no |  | Per-host overlays for SSH, Tailscale, runner, and repository paths. | [Agent workflows](agent-workflows.md), [Providers, auth, and hosting](providers-auth-hosting.md) |

## Parser Field Index

Every field name below is accepted by the workspace, home, or automation config parser and is intentionally discoverable here.
The index is field-name based because the parsers also contain nested and provider-specific shapes that do not map cleanly to one JSON schema yet.

`access`, `account`, `actions`, `activationNotes`, `active`, `activeFeatureId`, `activeProfileId`, `activeVersionId`
`actor`, `actorId`, `actors`, `agent`, `agentTargets`, `allowAccessRepair`, `allowCreate`, `allowDefaultBranchRepair`
`allowDependencyInstall`, `allowHostMutation`, `allowInvitationAcceptance`, `allowLiveServices`, `allowLocalRemoteRepair`, `allowNonLoopbackEndpoint`, `allowVisibilityRepair`, `allowedBranchStrategies`
`allowedIntentPrefixes`, `allowedOperationClasses`, `apiBaseUrl`, `appId`, `appServer`, `approval`, `approvalRef`, `args`
`artifactRetention`, `assignees`, `authProfile`, `authProfiles`, `authority`, `automation`, `backend`, `backoff`
`baseDelayMs`, `behind`, `board`, `boardId`, `body`, `branch`, `branchNaming`, `branchPublication`
`branchStrategy`, `branches`, `candidatePrefix`, `capabilities`, `capabilityTags`, `checkCommand`, `ciTiers`, `claimAuthorityProfiles`
`cleanup`, `clientId`, `command`, `commandArgs`, `commandEnvironment`, `commandPaths`, `commandProfileRefs`, `coAuthors`
`commentPolicy`, `communication`, `componentId`, `componentRoots`, `components`, `componentsRoot`, `configFormat`, `configPath`
`configSchema`, `conflictWinner`, `connectionProfileId`, `connectionString`, `connectionStringEnv`, `coordinationHandoffs`, `coordinatorProfileId`, `credentialIdentity`
`credentialKind`, `cycleLedgerPath`, `decisionGraph`, `defaultBranch`, `defaultBranchStrategy`, `defaultCorePack`, `defaultIntentPrefix`, `defaultToolsApprovalMode`
`defaultWorkTrackerId`, `dependencyLinks`, `description`, `directExternalSelection`, `directTargetPush`, `directory`, `displayName`, `diverged`
`driver`, `dryRun`, `eligibleWorkMode`, `email`, `enabled`, `endpoint`, `environment`, `environmentKeys`
`ephemeralThreadDefault`, `excludeLabels`, `excludedTools`, `executor`, `executorMode`, `exposure`, `extensions`, `failureLimit`
`fallbackRemote`, `featureBranchDelivery`, `featureBranchPattern`, `finalLimit`, `finalPullRequest`, `finalPullRequestCreation`, `fingerprints`, `flow`
`focusedCommands`, `from`, `fullCommands`, `gates`, `gateway`, `gitIdentity`, `gitUserEmail`, `gitUserName`
`gitWorkflows`, `githubApp`, `githubCliConfigDir`, `greenMain`, `handle`, `handles`, `heartbeatIntervalMs`, `home`
`host`, `hostId`, `hostLocalSafetyHints`, `hostOverlays`, `hosting`, `hosts`, `id`, `identityRef`
`importRequiredFirst`, `includedServers`, `includedTools`, `installCommand`, `installationAccount`, `integrationBranch`, `integrationPreference`, `integrationPrefix`
`intelligence`, `intendedUse`, `intervalMs`, `invitationPolicy`, `issueType`, `itemId`, `itemKey`, `itemNumber`
`items`, `kind`, `labels`, `leaseDurationMs`, `ledger`, `license`, `limit`, `limits`
`localPolicy`, `lock`, `manualActor`, `manualInstructions`, `manualRemote`, `materialization`, `maxConcurrentSubagents`, `maxCycles`
`maxDelayMs`, `maxWorkItems`, `mcp`, `mcpExposure`, `mergeAuthority`, `milestones`, `missingCredentialBehavior`, `mode`
`model`, `mutationClass`, `name`, `nameTemplate`, `namespace`, `nextOwner`, `nodeId`, `nodes`
`notes`, `number`, `objective`, `outputByteLimit`, `outputLineLimit`, `owner`, `ownerKind`, `packageKind`
`packageName`, `packagePublish`, `path`, `paths`, `platformTags`, `plugins`, `policyGateIds`, `port`
`postgres`, `privateKeyPath`, `profile`, `profiles`, `projectId`, `projectKey`, `projectRoot`, `projects`
`projectsRoot`, `promotion`, `protocol`, `provenance`, `provider`, `providerFilters`, `providerIdentity`, `providerMutationAuthProfile`
`providerQuery`, `providerWrites`, `provisioning`, `publicRewrite`, `publication`, `purposes`, `push`, `pushUrl`
`queryLimit`, `reason`, `reasoning`, `relationships`, `relaunch`, `release`, `releasePublish`, `releaseTrain`
`remote`, `remoteUrl`, `remotes`, `repo`, `repositories`, `repository`, `repositoryId`, `repositoryName`
`repositoryOwner`, `repositoryScopes`, `repositoryUrl`, `requirePassing`, `required`, `requiredCapabilities`, `requiredChecks`, `requiredEvidence`
`requiredPermission`, `requiredProviderPermissions`, `resumeInputs`, `retention`, `review`, `reviewBranchPattern`, `role`, `roleBindings`
`roles`, `runFullVerification`, `runnerProfiles`, `safety`, `scannedRoles`, `schedule`, `schema`, `scope`
`search`, `selector`, `serverName`, `setup`, `setupInstructions`, `setupNotes`, `shell`, `skillId`
`skills`, `slug`, `source`, `sourceComponentId`, `sourceControl`, `sourceRoot`, `sshHost`, `sshHostAlias`
`sshUser`, `staleAfterMs`, `staleChecks`, `staleClaimPolicy`, `start`, `startNodeId`, `statePath`, `statusFieldId`
`statusOptions`, `statuses`, `stopWhenNoEligibleWork`, `storePath`, `strategy`, `summary`, `surfaces`, `tailscaleAddress`
`target`, `targetAgents`, `targetBranch`, `targetComponents`, `template`, `timeoutMs`, `title`, `to`
`tokenRefreshBufferSeconds`, `tools`, `trackerDiscovery`, `trackerId`, `trackerLimits`, `transitions`, `transport`, `trigger`
`trustSemantics`, `ttlDays`, `unknownActorFallbackRole`, `unscopedName`, `update`, `url`, `valueHint`, `variable`
`variant`, `verification`, `version`, `versionPlanning`, `versionPolicy`, `visibility`, `whileEligible`, `workItemClaims`
`workTrackerCommunication`, `workTrackers`, `workTracking`, `workspaceRoots`, `workspacesRoot`, `worktreesRoot`, `wrongBase`
