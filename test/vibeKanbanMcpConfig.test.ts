import http from "node:http";
import { describe, expect, it } from "vitest";
import {
  vibeKanbanApiBaseUrl,
  VibeKanbanApiError,
} from "../src/vibeKanbanApi.js";
import {
  getVibeKanbanMcpConfig,
  mergeMcpServerConfig,
  normalizeVibeKanbanExecutor,
  updateVibeKanbanMcpConfig,
  VibeKanbanMcpConfigError,
} from "../src/vibeKanbanMcpConfig.js";

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readRequestBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Buffer));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startFakeVibeKanbanApi(): Promise<{
  port: number;
  server: http.Server;
  posts: unknown[];
  executorQueries: string[];
}> {
  const posts: unknown[] = [];
  const executorQueries: string[] = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/mcp-config") {
      response.statusCode = 404;
      response.end();
      return;
    }

    executorQueries.push(url.searchParams.get("executor") ?? "");

    if (request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          success: true,
          data: {
            mcp_config: {
              servers: {
                existing: {
                  command: "node",
                  args: ["existing.js"],
                },
              },
              servers_path: ["mcpServers"],
            },
            config_path: "C:\\Users\\example\\.codex\\config.json",
          },
        }),
      );
      return;
    }

    if (request.method === "POST") {
      posts.push(await readRequestBody(request));
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          success: true,
          data: "Updated MCP server configuration",
        }),
      );
      return;
    }

    response.statusCode = 405;
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return { port: address.port, server, posts, executorQueries };
}

describe("Vibe Kanban MCP config adapter", () => {
  it("normalizes supported executor aliases", () => {
    expect(normalizeVibeKanbanExecutor("codex")).toBe("CODEX");
    expect(normalizeVibeKanbanExecutor("claude-code")).toBe("CLAUDE_CODE");
    expect(normalizeVibeKanbanExecutor("cursor")).toBe("CURSOR_AGENT");
  });

  it("validates Vibe Kanban API ports before generating request URLs", () => {
    expect(vibeKanbanApiBaseUrl({ port: 1 })).toBe("http://127.0.0.1:1");
    expect(vibeKanbanApiBaseUrl({ host: "localhost", port: 65_535 })).toBe(
      "http://localhost:65535",
    );

    for (const port of [0, -1, 65_536, 3.14]) {
      expect(() => vibeKanbanApiBaseUrl({ port })).toThrow(VibeKanbanApiError);
    }
  });

  it("merges MCP server config without dropping existing servers", () => {
    expect(
      mergeMcpServerConfig(
        {
          existing: {
            command: "node",
          },
        },
        "new-server",
        {
          type: "http",
          url: "http://127.0.0.1:3000/mcp",
        },
      ),
    ).toEqual({
      existing: {
        command: "node",
        args: [],
      },
      "new-server": {
        type: "http",
        url: "http://127.0.0.1:3000/mcp",
      },
    });

    expect(() =>
      mergeMcpServerConfig({}, "bad", { command: "" }),
    ).toThrow(VibeKanbanMcpConfigError);
  });

  it("validates MCP server string maps", () => {
    expect(
      mergeMcpServerConfig({}, "http", {
        type: "http",
        url: "http://127.0.0.1:3000/mcp",
        headers: {
          authorization: "Bearer token",
        },
      }),
    ).toEqual({
      http: {
        type: "http",
        url: "http://127.0.0.1:3000/mcp",
        headers: {
          authorization: "Bearer token",
        },
      },
    });

    expect(() =>
      mergeMcpServerConfig({}, "bad", {
        command: "node",
        env: {
          PORT: 3000 as unknown as string,
        },
      }),
    ).toThrow(VibeKanbanMcpConfigError);
  });

  it("reads and updates MCP config through the Vibe API", async () => {
    const api = await startFakeVibeKanbanApi();
    try {
      await expect(
        getVibeKanbanMcpConfig({
          port: api.port,
          executor: "codex",
        }),
      ).resolves.toMatchObject({
        mcpConfig: {
          servers: {
            existing: {
              command: "node",
              args: ["existing.js"],
            },
          },
          serversPath: ["mcpServers"],
          configPath: "C:\\Users\\example\\.codex\\config.json",
        },
      });

      await updateVibeKanbanMcpConfig({
        port: api.port,
        executor: "claude-code",
        servers: {
          server: {
            command: "node",
          },
        },
      });

      expect(api.executorQueries).toEqual(["CODEX", "CLAUDE_CODE"]);
      expect(api.posts).toEqual([
        {
          servers: {
            server: {
              command: "node",
              args: [],
            },
          },
        },
      ]);
    } finally {
      await closeServer(api.server);
    }
  });
});
