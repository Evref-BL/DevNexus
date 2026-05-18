import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  CodexAppServerJsonRpcClient,
  createCodexAppServerStdioJsonRpcTransport,
} from "./index.js";

class FakeCodexAppServerProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
    return true;
  }
}

function makeSpawnedTransport() {
  const child = new FakeCodexAppServerProcess();
  const stdinChunks: string[] = [];
  child.stdin.on("data", (chunk: Buffer) => {
    stdinChunks.push(chunk.toString("utf8"));
  });

  const transport = createCodexAppServerStdioJsonRpcTransport({
    command: "codex",
    args: ["app-server"],
    spawn: () => child as unknown as ChildProcess,
  });

  return {
    child,
    stdinText: () => stdinChunks.join(""),
    transport,
  };
}

describe("Codex app-server JSON-RPC-lite transport", () => {
  it("writes newline-delimited JSON without Content-Length framing", async () => {
    const { child, stdinText, transport } = makeSpawnedTransport();
    const client = new CodexAppServerJsonRpcClient({ transport });

    const result = client.request("initialize", {
      clientInfo: {
        name: "dev-nexus",
      },
    });

    expect(stdinText()).toBe(
      `${JSON.stringify({
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "dev-nexus",
          },
        },
      })}\n`,
    );
    expect(stdinText()).not.toContain("Content-Length");

    child.stdout.write(`${JSON.stringify({ id: 1, result: { ok: true } })}\n`);

    await expect(result).resolves.toEqual({ ok: true });
  });

  it("accepts split newline-delimited responses without a jsonrpc member", async () => {
    const { child, transport } = makeSpawnedTransport();
    const client = new CodexAppServerJsonRpcClient({ transport });

    const result = client.request("initialize");
    child.stdout.write('{"id":1,');
    child.stdout.write('"result":{"methods":["thread/start"]}}\r\n');

    await expect(result).resolves.toEqual({ methods: ["thread/start"] });
  });

  it("reports malformed newline-delimited JSON as a transport failure", async () => {
    const { child, transport } = makeSpawnedTransport();
    const client = new CodexAppServerJsonRpcClient({ transport });

    const result = client.request("initialize");
    child.stdout.write("{not-json}\n");

    await expect(result).rejects.toThrow(
      "Codex app-server JSON-RPC transport failed while calling initialize: Codex app-server stdio response is not valid newline-delimited JSON",
    );
  });
});
