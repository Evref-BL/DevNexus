import {
  nexusWorkItemClaimAuthorityKey,
  type NexusWorkItemClaimAuthority,
  type NexusWorkItemClaimAuthorityClaimCandidateOptions,
  type NexusWorkItemClaimAuthorityClaimCandidateResult,
  type NexusWorkItemClaimAuthorityHeartbeatResult,
  type NexusWorkItemClaimAuthorityInspectOptions,
  type NexusWorkItemClaimAuthorityInspectResult,
  type NexusWorkItemClaimAuthorityKey,
  type NexusWorkItemClaimAuthorityReclaimExpiredClaimOptions,
  type NexusWorkItemClaimAuthorityReclaimResult,
  type NexusWorkItemClaimAuthorityRecord,
  type NexusWorkItemClaimAuthorityReleaseResult,
  type NexusWorkItemClaimAuthorityState,
  type NexusWorkItemClaimAuthorityVerifyResult,
  type NexusWorkItemClaimOwner,
} from "./nexusWorkItemClaimAuthority.js";
import type {
  WorkItem,
} from "./workTrackingTypes.js";

export interface NexusPostgresClaimSqlQueryResult<Row = unknown> {
  rows: Row[];
}

export interface NexusPostgresClaimSqlTransaction {
  query<Row = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<NexusPostgresClaimSqlQueryResult<Row>>;
}

export interface NexusPostgresClaimSqlClient {
  transaction<T>(
    callback: (transaction: NexusPostgresClaimSqlTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface NexusPostgresClaimAuthorityRow {
  keyHash: string;
  key: NexusWorkItemClaimAuthorityKey;
  authorityKind: string;
  owner: NexusWorkItemClaimOwner;
  fencingToken: number;
  state: NexusWorkItemClaimAuthorityState;
  claimedAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
  releasedAt: string | null;
  reclaimedFrom: NexusWorkItemClaimAuthorityRecord | null;
  providerMirrorWarnings: string[];
}

export interface NexusPostgresWorkItemClaimAuthorityOptions {
  client: NexusPostgresClaimSqlClient;
}

export const nexusPostgresClaimAuthoritySchemaSql = `
CREATE SEQUENCE IF NOT EXISTS dev_nexus_work_item_claim_fencing_seq;

CREATE TABLE IF NOT EXISTS dev_nexus_work_item_claims (
  key_hash text PRIMARY KEY,
  project_id text NOT NULL,
  component_id text NOT NULL,
  tracker_id text NOT NULL,
  provider text NOT NULL,
  work_item_id text NOT NULL,
  claim_key jsonb NOT NULL,
  authority_kind text NOT NULL,
  owner jsonb NOT NULL,
  fencing_token bigint NOT NULL DEFAULT nextval('dev_nexus_work_item_claim_fencing_seq'),
  state text NOT NULL CHECK (state IN ('active', 'released')),
  claimed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL,
  released_at timestamptz,
  reclaimed_from jsonb,
  provider_mirror_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_nexus_work_item_claims_scope_idx
  ON dev_nexus_work_item_claims (project_id, component_id, tracker_id, provider);

CREATE INDEX IF NOT EXISTS dev_nexus_work_item_claims_expiry_idx
  ON dev_nexus_work_item_claims (state, expires_at);
`.trim();

const selectClaimSql = `
/* dev-nexus-postgres-claim-authority:select */
SELECT
  key_hash AS "keyHash",
  claim_key AS "key",
  authority_kind AS "authorityKind",
  owner,
  fencing_token AS "fencingToken",
  state,
  claimed_at AS "claimedAt",
  expires_at AS "expiresAt",
  last_heartbeat_at AS "lastHeartbeatAt",
  released_at AS "releasedAt",
  reclaimed_from AS "reclaimedFrom",
  provider_mirror_warnings AS "providerMirrorWarnings"
FROM dev_nexus_work_item_claims
WHERE key_hash = $1
FOR UPDATE
`;

const lockClaimScopeSql = `
/* dev-nexus-postgres-claim-authority:lock */
SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
`;

const upsertClaimSql = `
/* dev-nexus-postgres-claim-authority:upsert */
WITH input AS (SELECT $1::jsonb AS payload)
INSERT INTO dev_nexus_work_item_claims (
  key_hash,
  project_id,
  component_id,
  tracker_id,
  provider,
  work_item_id,
  claim_key,
  authority_kind,
  owner,
  fencing_token,
  state,
  claimed_at,
  expires_at,
  last_heartbeat_at,
  released_at,
  reclaimed_from,
  provider_mirror_warnings,
  updated_at
)
SELECT
  payload->>'keyHash',
  payload #>> '{key,projectId}',
  payload #>> '{key,componentId}',
  payload #>> '{key,trackerId}',
  payload #>> '{key,provider}',
  payload #>> '{key,workItemId}',
  payload->'key',
  payload->>'authorityKind',
  payload->'owner',
  nextval('dev_nexus_work_item_claim_fencing_seq'),
  payload->>'state',
  (payload->>'claimedAt')::timestamptz,
  (payload->>'expiresAt')::timestamptz,
  (payload->>'lastHeartbeatAt')::timestamptz,
  NULLIF(payload->>'releasedAt', '')::timestamptz,
  payload->'reclaimedFrom',
  payload->'providerMirrorWarnings',
  now()
FROM input
ON CONFLICT (key_hash) DO UPDATE SET
  claim_key = EXCLUDED.claim_key,
  authority_kind = EXCLUDED.authority_kind,
  owner = EXCLUDED.owner,
  fencing_token = nextval('dev_nexus_work_item_claim_fencing_seq'),
  state = EXCLUDED.state,
  claimed_at = EXCLUDED.claimed_at,
  expires_at = EXCLUDED.expires_at,
  last_heartbeat_at = EXCLUDED.last_heartbeat_at,
  released_at = EXCLUDED.released_at,
  reclaimed_from = EXCLUDED.reclaimed_from,
  provider_mirror_warnings = EXCLUDED.provider_mirror_warnings,
  updated_at = now()
RETURNING
  key_hash AS "keyHash",
  claim_key AS "key",
  authority_kind AS "authorityKind",
  owner,
  fencing_token AS "fencingToken",
  state,
  claimed_at AS "claimedAt",
  expires_at AS "expiresAt",
  last_heartbeat_at AS "lastHeartbeatAt",
  released_at AS "releasedAt",
  reclaimed_from AS "reclaimedFrom",
  provider_mirror_warnings AS "providerMirrorWarnings"
`;

const heartbeatClaimSql = `
/* dev-nexus-postgres-claim-authority:heartbeat */
UPDATE dev_nexus_work_item_claims
SET
  owner = $2::jsonb,
  expires_at = $3::timestamptz,
  last_heartbeat_at = $4::timestamptz,
  updated_at = now()
WHERE key_hash = $1
RETURNING
  key_hash AS "keyHash",
  claim_key AS "key",
  authority_kind AS "authorityKind",
  owner,
  fencing_token AS "fencingToken",
  state,
  claimed_at AS "claimedAt",
  expires_at AS "expiresAt",
  last_heartbeat_at AS "lastHeartbeatAt",
  released_at AS "releasedAt",
  reclaimed_from AS "reclaimedFrom",
  provider_mirror_warnings AS "providerMirrorWarnings"
`;

const releaseClaimSql = `
/* dev-nexus-postgres-claim-authority:release */
UPDATE dev_nexus_work_item_claims
SET
  state = 'released',
  released_at = $2::timestamptz,
  updated_at = now()
WHERE key_hash = $1
RETURNING
  key_hash AS "keyHash",
  claim_key AS "key",
  authority_kind AS "authorityKind",
  owner,
  fencing_token AS "fencingToken",
  state,
  claimed_at AS "claimedAt",
  expires_at AS "expiresAt",
  last_heartbeat_at AS "lastHeartbeatAt",
  released_at AS "releasedAt",
  reclaimed_from AS "reclaimedFrom",
  provider_mirror_warnings AS "providerMirrorWarnings"
`;

const updateWarningsSql = `
/* dev-nexus-postgres-claim-authority:warnings */
UPDATE dev_nexus_work_item_claims
SET
  provider_mirror_warnings = $2::jsonb,
  updated_at = now()
WHERE key_hash = $1
RETURNING
  key_hash AS "keyHash",
  claim_key AS "key",
  authority_kind AS "authorityKind",
  owner,
  fencing_token AS "fencingToken",
  state,
  claimed_at AS "claimedAt",
  expires_at AS "expiresAt",
  last_heartbeat_at AS "lastHeartbeatAt",
  released_at AS "releasedAt",
  reclaimed_from AS "reclaimedFrom",
  provider_mirror_warnings AS "providerMirrorWarnings"
`;

const inspectClaimsSql = `
/* dev-nexus-postgres-claim-authority:inspect */
SELECT
  key_hash AS "keyHash",
  claim_key AS "key",
  authority_kind AS "authorityKind",
  owner,
  fencing_token AS "fencingToken",
  state,
  claimed_at AS "claimedAt",
  expires_at AS "expiresAt",
  last_heartbeat_at AS "lastHeartbeatAt",
  released_at AS "releasedAt",
  reclaimed_from AS "reclaimedFrom",
  provider_mirror_warnings AS "providerMirrorWarnings"
FROM dev_nexus_work_item_claims
WHERE ($1::text IS NULL OR key_hash = $1)
`;

export class NexusPostgresWorkItemClaimAuthority
  implements Required<NexusWorkItemClaimAuthority>
{
  readonly kind = "postgres";

  constructor(private readonly options: NexusPostgresWorkItemClaimAuthorityOptions) {}

  async claimCandidate(
    options: NexusWorkItemClaimAuthorityClaimCandidateOptions,
  ): Promise<NexusWorkItemClaimAuthorityClaimCandidateResult> {
    const result = await this.writeClaim(options, "claim");
    if (result.status !== "claimed") {
      return result;
    }

    const authorityClaim = await this.mirrorClaim({
      claim: requiredAuthorityClaim(result),
      claimOptions: options,
    });

    return {
      status: "claimed",
      workItem: claimedWorkItem(options.freshWorkItem),
      authorityClaim,
    };
  }

  async verifyClaim(options: {
    key: NexusWorkItemClaimAuthorityKey;
    leaseToken: string;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityVerifyResult> {
    const keyHash = serializedClaimAuthorityKey(options.key);
    const row = await this.options.client.transaction((transaction) =>
      selectClaimRow(transaction, keyHash),
    );
    return verifyCurrentClaim({
      claim: row ? rowToRecord(row) : undefined,
      leaseToken: options.leaseToken,
      now: options.now,
    });
  }

  async heartbeatClaim(options: {
    key: NexusWorkItemClaimAuthorityKey;
    leaseToken: string;
    leaseDurationMs: number;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityHeartbeatResult> {
    assertPositiveDuration(options.leaseDurationMs);
    const keyHash = serializedClaimAuthorityKey(options.key);
    return this.options.client.transaction(async (transaction) => {
      await lockClaimScope(transaction, options.key);
      const row = await selectClaimRow(transaction, keyHash);
      const result = verifyCurrentClaim({
        claim: row ? rowToRecord(row) : undefined,
        leaseToken: options.leaseToken,
        now: options.now,
      });
      if (result.status !== "verified") {
        return {
          status: "rejected",
          reason: verifyStatusToRejectedReason(result.status),
          ...(result.claim ? { claim: result.claim } : {}),
        };
      }

      const expiresAt = new Date(
        options.now.getTime() + options.leaseDurationMs,
      ).toISOString();
      const owner = {
        ...result.claim.owner,
        expiresAt,
      };
      const updated = await updateHeartbeatRow(transaction, {
        keyHash,
        owner,
        expiresAt,
        lastHeartbeatAt: options.now.toISOString(),
      });

      return {
        status: "heartbeat",
        claim: rowToRecord(updated),
      };
    });
  }

  async releaseClaim(options: {
    key: NexusWorkItemClaimAuthorityKey;
    leaseToken: string;
    fencingToken?: number | null;
    now: Date;
  }): Promise<NexusWorkItemClaimAuthorityReleaseResult> {
    const keyHash = serializedClaimAuthorityKey(options.key);
    return this.options.client.transaction(async (transaction) => {
      await lockClaimScope(transaction, options.key);
      const row = await selectClaimRow(transaction, keyHash);
      const result = verifyCurrentClaim({
        claim: row ? rowToRecord(row) : undefined,
        leaseToken: options.leaseToken,
        now: options.now,
      });
      if (result.status !== "verified") {
        return {
          status: "rejected",
          reason: verifyStatusToRejectedReason(result.status),
          ...(result.claim ? { claim: result.claim } : {}),
        };
      }
      if (
        options.fencingToken !== undefined &&
        options.fencingToken !== null &&
        options.fencingToken !== result.claim.fencingToken
      ) {
        return {
          status: "rejected",
          reason: "fencing_token_mismatch",
          claim: result.claim,
        };
      }

      const updated = await releaseClaimRow(transaction, {
        keyHash,
        releasedAt: options.now.toISOString(),
      });
      return {
        status: "released",
        claim: rowToRecord(updated),
      };
    });
  }

  async reclaimExpiredClaim(
    options: NexusWorkItemClaimAuthorityReclaimExpiredClaimOptions,
  ): Promise<NexusWorkItemClaimAuthorityReclaimResult> {
    const result = await this.writeClaim(options, "reclaim");
    if (result.status !== "claimed") {
      return result;
    }

    const authorityClaim = await this.mirrorClaim({
      claim: requiredAuthorityClaim(result),
      claimOptions: options,
      previousOwner: options.previousOwner,
    });

    return {
      status: "claimed",
      workItem: claimedWorkItem(options.freshWorkItem),
      authorityClaim,
    };
  }

  async inspectClaims(
    options: NexusWorkItemClaimAuthorityInspectOptions,
  ): Promise<NexusWorkItemClaimAuthorityInspectResult> {
    const keyHash = options.key ? serializedClaimAuthorityKey(options.key) : null;
    const rows = await this.options.client.transaction((transaction) =>
      inspectClaimRows(transaction, keyHash),
    );
    const records = rows.map(rowToRecord);
    return {
      activeClaims: records.filter(
        (claim) => claim.state === "active" && !claimIsExpired(claim, options.now),
      ),
      staleClaims: records.filter(
        (claim) => claim.state === "active" && claimIsExpired(claim, options.now),
      ),
      releasedClaims: records.filter((claim) => claim.state === "released"),
    };
  }

  private async writeClaim(
    options: NexusWorkItemClaimAuthorityClaimCandidateOptions,
    mode: "claim",
  ): Promise<NexusWorkItemClaimAuthorityClaimCandidateResult>;
  private async writeClaim(
    options: NexusWorkItemClaimAuthorityReclaimExpiredClaimOptions,
    mode: "reclaim",
  ): Promise<NexusWorkItemClaimAuthorityReclaimResult>;
  private async writeClaim(
    options:
      | NexusWorkItemClaimAuthorityClaimCandidateOptions
      | NexusWorkItemClaimAuthorityReclaimExpiredClaimOptions,
    mode: "claim" | "reclaim",
  ): Promise<
    | NexusWorkItemClaimAuthorityClaimCandidateResult
    | NexusWorkItemClaimAuthorityReclaimResult
  > {
    const key = nexusWorkItemClaimAuthorityKey(options);
    const keyHash = serializedClaimAuthorityKey(key);
    return this.options.client.transaction(async (transaction) => {
      await lockClaimScope(transaction, key);
      const existingRow = await selectClaimRow(transaction, keyHash);
      const existing = existingRow ? rowToRecord(existingRow) : null;
      if (mode === "reclaim") {
        if (!existing) {
          return {
            status: "rejected",
            reason: "missing_claim",
          };
        }
        if (existing.state === "released") {
          return {
            status: "rejected",
            reason: "released",
            authorityClaim: existing,
          };
        }
        if (!claimIsExpired(existing, options.now)) {
          return {
            status: "rejected",
            reason: "active_claim",
            authorityClaim: existing,
          };
        }
      } else if (existing && claimIsCurrent(existing, options.now)) {
        return {
          status: "lost_race",
          observedWorkItem: claimedWorkItem(options.freshWorkItem),
          authorityClaim: existing,
        };
      }

      const reclaimedFrom =
        existing && existing.state === "active" && claimIsExpired(existing, options.now)
          ? existing
          : null;
      const row = await upsertClaimRow(transaction, {
        keyHash,
        key,
        authorityKind: this.kind,
        owner: options.owner,
        state: "active",
        claimedAt: options.owner.claimedAt,
        expiresAt: options.owner.expiresAt,
        lastHeartbeatAt: options.now.toISOString(),
        releasedAt: null,
        reclaimedFrom,
        providerMirrorWarnings: [],
        fencingToken: 0,
      });
      return {
        status: "claimed",
        workItem: claimedWorkItem(options.freshWorkItem),
        authorityClaim: rowToRecord(row),
      };
    });
  }

  private async mirrorClaim(options: {
    claim: NexusWorkItemClaimAuthorityRecord;
    claimOptions: NexusWorkItemClaimAuthorityClaimCandidateOptions;
    previousOwner?: NexusWorkItemClaimOwner;
  }): Promise<NexusWorkItemClaimAuthorityRecord> {
    const warnings: string[] = [];
    if (!options.claimOptions.provider.capabilities.updateItem) {
      warnings.push("Work tracker does not support claim status mirroring.");
    } else {
      try {
        await options.claimOptions.provider.updateWorkItem(
          options.claimOptions.ref,
          { status: "in_progress" },
        );
      } catch (error) {
        warnings.push(
          `Failed to mirror claim status to work tracker: ${errorMessage(error)}`,
        );
      }
    }

    if (options.claimOptions.provider.capabilities.comment) {
      try {
        await options.claimOptions.provider.addComment(
          options.claimOptions.ref,
          postgresClaimComment({
            claim: options.claim,
            previousOwner: options.previousOwner,
          }),
        );
      } catch (error) {
        warnings.push(
          `Failed to mirror claim comment to work tracker: ${errorMessage(error)}`,
        );
      }
    }

    if (warnings.length === 0) {
      return options.claim;
    }

    const keyHash = serializedClaimAuthorityKey(options.claim.key);
    return this.options.client.transaction(async (transaction) => {
      const row = await updateProviderMirrorWarnings(transaction, {
        keyHash,
        providerMirrorWarnings: warnings,
      });
      return rowToRecord(row);
    });
  }
}

async function lockClaimScope(
  transaction: NexusPostgresClaimSqlTransaction,
  key: NexusWorkItemClaimAuthorityKey,
): Promise<void> {
  await transaction.query(lockClaimScopeSql, [
    [key.projectId, key.componentId, key.trackerId, key.provider].join(":"),
  ]);
}

async function selectClaimRow(
  transaction: NexusPostgresClaimSqlTransaction,
  keyHash: string,
): Promise<NexusPostgresClaimAuthorityRow | null> {
  const result = await transaction.query<NexusPostgresClaimAuthorityRow>(
    selectClaimSql,
    [keyHash],
  );
  return result.rows[0] ?? null;
}

async function upsertClaimRow(
  transaction: NexusPostgresClaimSqlTransaction,
  row: NexusPostgresClaimAuthorityRow,
): Promise<NexusPostgresClaimAuthorityRow> {
  const result = await transaction.query<NexusPostgresClaimAuthorityRow>(
    upsertClaimSql,
    [row],
  );
  return requiredReturnedRow(result, "upsert claim");
}

async function updateHeartbeatRow(
  transaction: NexusPostgresClaimSqlTransaction,
  options: {
    keyHash: string;
    owner: NexusWorkItemClaimOwner;
    expiresAt: string;
    lastHeartbeatAt: string;
  },
): Promise<NexusPostgresClaimAuthorityRow> {
  const result = await transaction.query<NexusPostgresClaimAuthorityRow>(
    heartbeatClaimSql,
    [
      options.keyHash,
      options.owner,
      options.expiresAt,
      options.lastHeartbeatAt,
    ],
  );
  return requiredReturnedRow(result, "heartbeat claim");
}

async function releaseClaimRow(
  transaction: NexusPostgresClaimSqlTransaction,
  options: {
    keyHash: string;
    releasedAt: string;
  },
): Promise<NexusPostgresClaimAuthorityRow> {
  const result = await transaction.query<NexusPostgresClaimAuthorityRow>(
    releaseClaimSql,
    [options.keyHash, options.releasedAt],
  );
  return requiredReturnedRow(result, "release claim");
}

async function updateProviderMirrorWarnings(
  transaction: NexusPostgresClaimSqlTransaction,
  options: {
    keyHash: string;
    providerMirrorWarnings: string[];
  },
): Promise<NexusPostgresClaimAuthorityRow> {
  const result = await transaction.query<NexusPostgresClaimAuthorityRow>(
    updateWarningsSql,
    [options.keyHash, options.providerMirrorWarnings],
  );
  return requiredReturnedRow(result, "update provider mirror warnings");
}

async function inspectClaimRows(
  transaction: NexusPostgresClaimSqlTransaction,
  keyHash: string | null,
): Promise<NexusPostgresClaimAuthorityRow[]> {
  const result = await transaction.query<NexusPostgresClaimAuthorityRow>(
    inspectClaimsSql,
    [keyHash],
  );
  return result.rows;
}

function requiredReturnedRow(
  result: NexusPostgresClaimSqlQueryResult<NexusPostgresClaimAuthorityRow>,
  action: string,
): NexusPostgresClaimAuthorityRow {
  const row = result.rows[0];
  if (!row) {
    throw new Error(`PostgreSQL claim authority did not return a row for ${action}`);
  }

  return row;
}

function rowToRecord(
  row: NexusPostgresClaimAuthorityRow,
): NexusWorkItemClaimAuthorityRecord {
  return {
    authorityKind: row.authorityKind,
    key: cloneClaimAuthorityKey(row.key),
    owner: cloneClaimOwner(row.owner),
    fencingToken: Number(row.fencingToken),
    state: row.state,
    claimedAt: isoString(row.claimedAt),
    expiresAt: isoString(row.expiresAt),
    lastHeartbeatAt: isoString(row.lastHeartbeatAt),
    releasedAt: row.releasedAt ? isoString(row.releasedAt) : null,
    ...(row.reclaimedFrom
      ? { reclaimedFrom: cloneClaimAuthorityRecord(row.reclaimedFrom) }
      : {}),
    ...(row.providerMirrorWarnings.length > 0
      ? { providerMirrorWarnings: [...row.providerMirrorWarnings] }
      : {}),
  };
}

function requiredAuthorityClaim(
  result:
    | Extract<
        NexusWorkItemClaimAuthorityClaimCandidateResult,
        { status: "claimed" }
      >
    | Extract<NexusWorkItemClaimAuthorityReclaimResult, { status: "claimed" }>,
): NexusWorkItemClaimAuthorityRecord {
  if (!result.authorityClaim) {
    throw new Error("PostgreSQL claim authority did not return claim metadata");
  }

  return result.authorityClaim;
}

function verifyCurrentClaim(options: {
  claim: NexusWorkItemClaimAuthorityRecord | undefined;
  leaseToken: string;
  now: Date;
}): NexusWorkItemClaimAuthorityVerifyResult {
  if (!options.claim) {
    return {
      status: "missing",
    };
  }
  const claim = cloneClaimAuthorityRecord(options.claim);
  if (claim.owner.leaseToken !== options.leaseToken) {
    return {
      status: "token_mismatch",
      claim,
    };
  }
  if (claim.state === "released") {
    return {
      status: "released",
      claim,
    };
  }
  if (claimIsExpired(claim, options.now)) {
    return {
      status: "expired",
      claim,
    };
  }

  return {
    status: "verified",
    claim,
  };
}

function verifyStatusToRejectedReason(
  status: Exclude<NexusWorkItemClaimAuthorityVerifyResult["status"], "verified">,
): "missing_claim" | "token_mismatch" | "expired" | "released" {
  return status === "missing" ? "missing_claim" : status;
}

function claimIsCurrent(
  claim: NexusWorkItemClaimAuthorityRecord,
  now: Date,
): boolean {
  return claim.state === "active" && !claimIsExpired(claim, now);
}

function claimIsExpired(
  claim: NexusWorkItemClaimAuthorityRecord,
  now: Date,
): boolean {
  return new Date(claim.expiresAt).getTime() <= now.getTime();
}

function claimedWorkItem(workItem: WorkItem): WorkItem {
  return {
    ...cloneWorkItem(workItem),
    status: "in_progress",
  };
}

function postgresClaimComment(options: {
  claim: NexusWorkItemClaimAuthorityRecord;
  previousOwner?: NexusWorkItemClaimOwner;
}): string {
  return [
    options.previousOwner
      ? "DevNexus PostgreSQL claim reclaimed from expired owner."
      : "DevNexus PostgreSQL claim acquired.",
    "",
    `- host: ${options.claim.owner.hostId}`,
    ...(options.claim.owner.agentId
      ? [`- agent: ${options.claim.owner.agentId}`]
      : []),
    ...(options.claim.owner.ownerId
      ? [`- owner: ${options.claim.owner.ownerId}`]
      : []),
    `- lease token: ${options.claim.owner.leaseToken}`,
    `- fencing token: ${options.claim.fencingToken}`,
    `- expires: ${options.claim.expiresAt}`,
    ...(options.previousOwner
      ? [`- previous lease token: ${options.previousOwner.leaseToken}`]
      : []),
  ].join("\n");
}

function cloneClaimAuthorityRecord(
  claim: NexusWorkItemClaimAuthorityRecord,
): NexusWorkItemClaimAuthorityRecord {
  return {
    ...claim,
    key: cloneClaimAuthorityKey(claim.key),
    owner: cloneClaimOwner(claim.owner),
    ...(claim.reclaimedFrom
      ? { reclaimedFrom: cloneClaimAuthorityRecord(claim.reclaimedFrom) }
      : {}),
    ...(claim.providerMirrorWarnings
      ? { providerMirrorWarnings: [...claim.providerMirrorWarnings] }
      : {}),
  };
}

function cloneClaimAuthorityKey(
  key: NexusWorkItemClaimAuthorityKey,
): NexusWorkItemClaimAuthorityKey {
  return {
    ...key,
  };
}

function cloneClaimOwner(
  owner: NexusWorkItemClaimOwner,
): NexusWorkItemClaimOwner {
  return {
    ...owner,
  };
}

function cloneWorkItem(workItem: WorkItem): WorkItem {
  return {
    ...workItem,
    labels: workItem.labels ? [...workItem.labels] : undefined,
    assignees: workItem.assignees ? [...workItem.assignees] : undefined,
    externalRef: workItem.externalRef ? { ...workItem.externalRef } : undefined,
    trackerRef: workItem.trackerRef ? { ...workItem.trackerRef } : undefined,
  };
}

function serializedClaimAuthorityKey(
  key: NexusWorkItemClaimAuthorityKey,
): string {
  return JSON.stringify([
    key.projectId,
    key.componentId,
    key.trackerId,
    key.provider,
    key.workItemId,
    key.repositoryId ?? null,
    key.repositoryOwner ?? null,
    key.repositoryName ?? null,
    key.itemNumber ?? null,
    key.itemKey ?? null,
    key.nodeId ?? null,
  ]);
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertPositiveDuration(leaseDurationMs: number): void {
  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new Error("leaseDurationMs must be a positive number");
  }
}
