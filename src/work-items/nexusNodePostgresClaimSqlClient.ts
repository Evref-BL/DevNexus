import { createRequire } from "node:module";
import type {
  NexusPostgresClaimSqlClient,
  NexusPostgresClaimSqlQueryResult,
  NexusPostgresClaimSqlTransaction,
} from "./nexusPostgresWorkItemClaimAuthority.js";

export type NexusNodePostgresAdapterStatus = "available" | "missing";

export interface NexusNodePostgresClient {
  connect(): Promise<void>;
  query<Row = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<NexusPostgresClaimSqlQueryResult<Row>>;
  end(): Promise<void>;
}

export interface NexusNodePostgresModule {
  Client: new (config: NexusNodePostgresClientConfig) => NexusNodePostgresClient;
}

export interface NexusNodePostgresClientConfig {
  connectionString: string;
  application_name?: string;
}

export interface LoadNexusNodePostgresModuleOptions {
  loadModule?: () => Promise<unknown>;
}

export interface DetectNexusNodePostgresAdapterStatusOptions {
  resolveModule?: (specifier: string) => string;
}

export interface CreateNexusNodePostgresClaimSqlClientOptions {
  connectionString: string;
  schema?: string | null;
  applicationName?: string | null;
  module?: NexusNodePostgresModule;
  loadModule?: () => Promise<unknown>;
}

const nodePostgresModuleName = "pg";
const defaultApplicationName = "dev-nexus-claim-authority";

export function detectNexusNodePostgresAdapterStatus(
  options: DetectNexusNodePostgresAdapterStatusOptions = {},
): NexusNodePostgresAdapterStatus {
  const resolveModule =
    options.resolveModule ?? createRequire(import.meta.url).resolve;
  try {
    resolveModule(nodePostgresModuleName);
    return "available";
  } catch {
    return "missing";
  }
}

export async function loadNexusNodePostgresModule(
  options: LoadNexusNodePostgresModuleOptions = {},
): Promise<NexusNodePostgresModule> {
  let loaded: unknown;
  try {
    loaded =
      options.loadModule
        ? await options.loadModule()
        : await importNodePostgresModule();
  } catch (error) {
    if (isNodePostgresMissingError(error)) {
      throw new Error(
        "optional node-postgres package is not installed; install pg to use the PostgreSQL claim authority adapter",
      );
    }
    throw error;
  }
  const normalized = normalizeNodePostgresModule(loaded);
  if (!normalized) {
    throw new Error("node-postgres package must export Client");
  }

  return normalized;
}

export async function createNexusNodePostgresClaimSqlClient(
  options: CreateNexusNodePostgresClaimSqlClientOptions,
): Promise<NexusPostgresClaimSqlClient> {
  const connectionString = requiredNonEmptyString(
    options.connectionString,
    "connectionString",
  );
  const schema = optionalNonEmptyString(options.schema);
  const module =
    options.module ?? await loadNexusNodePostgresModule({
      loadModule: options.loadModule,
    });
  const config: NexusNodePostgresClientConfig = {
    connectionString,
    application_name:
      optionalNonEmptyString(options.applicationName) ?? defaultApplicationName,
  };

  return {
    async transaction<T>(
      callback: (transaction: NexusPostgresClaimSqlTransaction) => Promise<T>,
    ): Promise<T> {
      const client = new module.Client(config);
      await client.connect();
      try {
        await client.query("BEGIN");
        if (schema) {
          await client.query(
            `SET LOCAL search_path TO ${quotePostgresIdentifier(schema)}, public`,
          );
        }
        const result = await callback({
          query: (sql, params) => client.query(sql, params),
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new Error(
            `${errorMessage(error)}; rollback failed: ${errorMessage(rollbackError)}`,
          );
        }
        throw error;
      } finally {
        await client.end();
      }
    },
  };
}

async function importNodePostgresModule(): Promise<unknown> {
  const moduleName = nodePostgresModuleName;
  return import(moduleName);
}

function normalizeNodePostgresModule(
  loaded: unknown,
): NexusNodePostgresModule | null {
  if (!loaded || typeof loaded !== "object") {
    return null;
  }
  const record = loaded as Record<string, unknown>;
  if (typeof record.Client === "function") {
    return record as unknown as NexusNodePostgresModule;
  }
  const defaultExport = record.default;
  if (defaultExport && typeof defaultExport === "object") {
    const defaultRecord = defaultExport as Record<string, unknown>;
    if (typeof defaultRecord.Client === "function") {
      return defaultRecord as unknown as NexusNodePostgresModule;
    }
  }

  return null;
}

function isNodePostgresMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as {
    code?: unknown;
    message?: unknown;
  };
  return (
    record.code === "MODULE_NOT_FOUND" ||
    record.code === "ERR_MODULE_NOT_FOUND" ||
    (typeof record.message === "string" &&
      (record.message.includes("Cannot find package 'pg'") ||
        record.message.includes("Cannot find module 'pg'")))
  );
}

function quotePostgresIdentifier(value: string): string {
  return `"${requiredNonEmptyString(value, "schema").replaceAll("\"", "\"\"")}"`;
}

function optionalNonEmptyString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requiredNonEmptyString(value, "value");
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
