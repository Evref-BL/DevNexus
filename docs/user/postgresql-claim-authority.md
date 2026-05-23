---
id: postgresql-claim-authority
title: PostgreSQL claim authority
sidebar_label: PostgreSQL claim authority
---

# PostgreSQL claim authority

PostgreSQL claim authority is an opt-in backend for work-item claims. Use it
when more than one coordinator host may race for the same eligible work.

The default backend is still `optimistic_tracker`. That backend writes claim
metadata through the work tracker and is adequate when one coordinator serializes
claim acquisition. PostgreSQL adds a shared authority for multi-host use: one
winner per work item, lease tokens, fencing tokens, expiry, reclaim, heartbeat,
release, and audit fields.

Work trackers remain the visible work record. GitHub, GitLab, Jira, and local
trackers still hold titles, labels, comments, and workflow status. PostgreSQL
only owns claim authority.

## Prerequisites

- A PostgreSQL database reachable from every coordinator host that should share
  claim authority.
- The optional `pg` package installed in the runtime that runs DevNexus.
- A database schema created by an operator. Routine `claim-next` and automation
  launch commands do not create or migrate schema.
- A host-local environment variable that contains the PostgreSQL connection
  string.

The DevNexus package declares `pg` as an optional peer dependency. Projects that
do not use PostgreSQL claims do not need it.

## Configure the project

Set the portable project config to use the PostgreSQL backend and reference a
host-local profile id:

```json
{
  "automation": {
    "workItemClaims": {
      "enabled": true,
      "leaseDurationMs": 3600000,
      "heartbeatIntervalMs": 1200000,
      "authority": {
        "backend": "postgres",
        "postgres": {
          "connectionProfileId": "shared-claims"
        }
      }
    }
  }
}
```

Do not put a database URL in `dev-nexus.project.json`. Project config is meant
to be portable across hosts.

`leaseDurationMs` defaults to 60 minutes. `heartbeatIntervalMs` defaults to
20 minutes and must be no more than half of `leaseDurationMs`.

The lease is the maximum time an abandoned claim can block another coordinator
from reclaiming the same work item. The heartbeat interval is how often a
long-running owner should renew the claim before expiry. The defaults are tuned
for agent work rather than low-latency service failover: they keep abandoned
work bounded at one hour, leave room for long local verification, and still
renew well before expiry.

The policy follows the same shape as common coordination systems:

- Kubernetes Lease-based leader election treats `leaseDuration` as the time
  another candidate waits before taking over, requires the renew deadline to be
  less than or equal to the lease duration, and documents renewal before expiry,
  for example around half the lease duration.
- Consul sessions recommend the lowest practical TTL and warn against long TTLs
  above one hour because force-expired sessions may take up to double the TTL to
  reap.
- RabbitMQ heartbeats separate the timeout from the interval and send heartbeat
  frames at about half the timeout.

References:

- [Kubernetes coordinated leader election](https://kubernetes.io/docs/concepts/cluster-administration/coordinated-leader-election/)
- [Kubernetes leader election configuration](https://kubernetes.io/docs/reference/config-api/kube-scheduler-config.v1/#leaderelectionconfiguration)
- [Consul session API TTL](https://developer.hashicorp.com/consul/api-docs/session)
- [RabbitMQ heartbeats](https://www.rabbitmq.com/docs/heartbeats)

## Configure each host

Add a claim authority profile to the host-local `dev-nexus.home.json`:

```json
{
  "claimAuthorityProfiles": [
    {
      "id": "shared-claims",
      "backend": "postgres",
      "driver": "node_postgres",
      "connectionStringEnv": "DEV_NEXUS_CLAIMS_DATABASE_URL",
      "schema": "dev_nexus"
    }
  ]
}
```

Then set the connection string in the host environment:

```bash
export DEV_NEXUS_CLAIMS_DATABASE_URL='postgres://user:password@host:5432/dev_nexus'
```

The profile stores the environment variable name, not the secret.

## Create the schema

Schema creation is explicit. DevNexus does not create tables from normal
automation commands.

The package exports `nexusPostgresClaimAuthoritySchemaSql` for tooling
that applies schema under an approved operator workflow. Apply it with the
database account and migration process your team uses for shared infrastructure.

## Check readiness

Run automation status before enabling a coordinator loop:

```bash
dev-nexus automation status <workspace-root> --home <home-path> --json
```

The status output reports:

- the selected backend;
- the configured PostgreSQL profile id;
- whether the host-local profile exists;
- whether the connection-string environment variable is present;
- whether the optional `node_postgres` adapter is available.

You can also exercise claim selection without starting a worker:

```bash
dev-nexus work-item claim-next <workspace-root> --home <home-path> --host <host-id> --json
```

If PostgreSQL is configured but not ready, DevNexus blocks instead of silently
falling back to `optimistic_tracker`.

## Worker enforcement

When an automation launch obtains an authority-backed claim, the launch context
includes the authority claim record and fencing token. The command environment
also includes:

- `DEV_NEXUS_CLAIM_LEASE_DURATION_MS`
- `DEV_NEXUS_CLAIM_HEARTBEAT_INTERVAL_MS`
- `DEV_NEXUS_CLAIM_AUTHORITY_KIND`
- `DEV_NEXUS_CLAIM_FENCING_TOKEN`
- `DEV_NEXUS_CLAIM_AUTHORITY_STATE`

Before DevNexus-controlled worker actions mutate state, they verify the current
authority claim from `DEV_NEXUS_AGENT_CONTEXT_FILE`.

Currently guarded paths:

- CLI and MCP worktree preparation;
- CLI and MCP current-agent completion recording.

Long-running current-agent workers can renew an authority-backed claim without
recording a terminal result:

```bash
dev-nexus automation current-agent heartbeat <workspace-root> --json
```

The matching MCP tool is `current_agent_heartbeat`. Both surfaces read the
current launch context, use the selected authority backend, and return the
updated claim record.

For current-agent adoption, run the heartbeat before
`DEV_NEXUS_CLAIM_HEARTBEAT_INTERVAL_MS` elapses, and again at that cadence while
the work stays active. The command renews the claim for the configured lease
duration unless `--lease-duration-ms` is provided.

Spawned synchronous agent commands cannot heartbeat while the command runner is
blocked waiting for the child process. DevNexus therefore requires configured
synchronous agent launches to have `automation.agent.timeoutMs` lower than
`automation.workItemClaims.leaseDurationMs`. A future async launch runtime can
add a background heartbeat sidecar; the current safe rule is that a spawned
command must finish or time out before its claim expires.

Blocked or failed current-agent outcomes are still allowed so a stale worker can
report that it stopped.

## Live smoke tests

Live PostgreSQL smoke tests are intentionally gated. They require an explicit
runner policy, a real database connection, and operator approval to create or
use schema. The normal test suite uses fake SQL clients and does not require a
database.

To run the live smoke, install the optional `pg` peer dependency in the runtime
environment and set:

```bash
DEV_NEXUS_POSTGRES_CLAIM_AUTHORITY_SMOKE=1 \
DEV_NEXUS_CLAIMS_DATABASE_URL='postgres://user:password@host:5432/dev_nexus' \
npm test -- src/nexusPostgresWorkItemClaimAuthority.live.test.ts
```

The smoke creates the target schema if it does not exist, applies
`nexusPostgresClaimAuthoritySchemaSql`, writes one synthetic claim row, verifies
that a second owner loses the race, then releases the claim. It uses
`DEV_NEXUS_CLAIMS_SCHEMA` when set and otherwise defaults to
`dev_nexus_smoke`.

## Local multi-container race canary

Use the container canary before testing on another physical host:

```bash
npm run smoke:postgres-containers
```

The canary requires Docker. It builds a temporary DevNexus runner image from the
current checkout, starts a private Docker network with `postgres:16-alpine`,
then starts two isolated runner containers with separate workspace and
`DEV_NEXUS_HOME` directories. Both runners race for the same synthetic eligible
work item through the PostgreSQL claim authority.

The script asserts:

- exactly one runner returns `claimed`;
- exactly one runner returns `lost_race`;
- the loser observes the winner's fencing token;
- the winning runner can heartbeat and release the claim;
- the database row ends in `released` state.

The container canary is intentionally not part of `npm run check` because it
requires Docker, network access, and image builds.
