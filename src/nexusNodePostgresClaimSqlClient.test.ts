import { describe, expect, it } from "vitest";
import {
  createNexusNodePostgresClaimSqlClient,
  detectNexusNodePostgresAdapterStatus,
  loadNexusNodePostgresModule,
  type NexusNodePostgresModule,
} from "./nexusNodePostgresClaimSqlClient.js";

describe("node-postgres claim SQL client", () => {
  it("reports optional adapter availability without importing pg", () => {
    expect(
      detectNexusNodePostgresAdapterStatus({
        resolveModule: () => "/deps/node_modules/pg/lib/index.js",
      }),
    ).toBe("available");

    expect(
      detectNexusNodePostgresAdapterStatus({
        resolveModule: () => {
          const error = new Error("Cannot find module 'pg'");
          (error as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND";
          throw error;
        },
      }),
    ).toBe("missing");
  });

  it("wraps node-postgres clients in explicit transactions", async () => {
    const events: Array<{
      sql: string;
      params?: readonly unknown[];
    }> = [];
    let connectCount = 0;
    let endCount = 0;
    const module: NexusNodePostgresModule = {
      Client: class {
        constructor(readonly config: object) {}

        async connect(): Promise<void> {
          connectCount += 1;
        }

        async query(
          sql: string,
          params?: readonly unknown[],
        ): Promise<{ rows: unknown[] }> {
          events.push({ sql, params });
          return { rows: [{ ok: true }] };
        }

        async end(): Promise<void> {
          endCount += 1;
        }
      },
    };

    const client = await createNexusNodePostgresClaimSqlClient({
      connectionString: "postgres://claims@example.invalid/db",
      schema: "dev_nexus",
      module,
    });

    const result = await client.transaction((transaction) =>
      transaction.query("SELECT $1::int AS value", [42])
    );

    expect(result.rows).toEqual([{ ok: true }]);
    expect(connectCount).toBe(1);
    expect(endCount).toBe(1);
    expect(events).toEqual([
      { sql: "BEGIN" },
      { sql: 'SET LOCAL search_path TO "dev_nexus", public' },
      { sql: "SELECT $1::int AS value", params: [42] },
      { sql: "COMMIT" },
    ]);
  });

  it("rolls back and closes the client when a transaction fails", async () => {
    const events: string[] = [];
    let endCount = 0;
    const module: NexusNodePostgresModule = {
      Client: class {
        async connect(): Promise<void> {
          events.push("connect");
        }

        async query(sql: string): Promise<{ rows: unknown[] }> {
          events.push(sql);
          return { rows: [] };
        }

        async end(): Promise<void> {
          endCount += 1;
          events.push("end");
        }
      },
    };
    const client = await createNexusNodePostgresClaimSqlClient({
      connectionString: "postgres://claims@example.invalid/db",
      module,
    });

    await expect(
      client.transaction(async () => {
        throw new Error("claim failed");
      }),
    ).rejects.toThrow(/claim failed/);

    expect(events).toEqual(["connect", "BEGIN", "ROLLBACK", "end"]);
    expect(endCount).toBe(1);
  });

  it("fails clearly when the loaded package does not expose Client", async () => {
    await expect(
      loadNexusNodePostgresModule({
        loadModule: async () => ({}),
      }),
    ).rejects.toThrow(/node-postgres package must export Client/);
  });

  it("fails clearly when the optional pg package is not installed", async () => {
    await expect(
      loadNexusNodePostgresModule({
        loadModule: async () => {
          const error = new Error("Cannot find package 'pg'");
          (error as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND";
          throw error;
        },
      }),
    ).rejects.toThrow(/optional node-postgres package is not installed/);
  });
});
