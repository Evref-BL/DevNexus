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
dev-nexus automation current-agent heartbeat <workspace-root> --lease-duration-ms 3600000 --json
```

The matching MCP tool is `current_agent_heartbeat`. Both surfaces read the
current launch context, use the selected authority backend, and return the
updated claim record.

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
