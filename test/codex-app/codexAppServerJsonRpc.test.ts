import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  CodexAppServerJsonRpcClient,
  createCodexAppServerStdioJsonRpcTransport,
} from "../../src/index.js";

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

  it("buffers turn notifications that arrive before a waiter is registered", async () => {
    const { child, transport } = makeSpawnedTransport();
    const client = new CodexAppServerJsonRpcClient({ transport });

    child.stdout.write(
      `${JSON.stringify({
        method: "turn/completed",
        params: { turnId: "turn-early", status: "completed" },
      })}\n`,
    );

    await expect(
      client.waitForNotification(
        (notification) =>
          notification.method === "turn/completed" &&
          (notification.params as { turnId?: string }).turnId === "turn-early",
      ),
    ).resolves.toMatchObject({
      method: "turn/completed",
      params: { turnId: "turn-early", status: "completed" },
    });
  });

  it("routes responses and turn completion notifications independently", async () => {
    const { child, transport } = makeSpawnedTransport();
    const client = new CodexAppServerJsonRpcClient({ transport });

    const completion = client.waitForNotification(
      (notification) =>
        notification.method === "turn/completed" &&
        (notification.params as { turnId?: string }).turnId === "turn-routing",
    );
    const initialize = client.request("initialize");

    child.stdout.write(
      `${JSON.stringify({
        method: "turn/completed",
        params: { turnId: "turn-routing", status: "completed" },
      })}\n`,
    );
    child.stdout.write(`${JSON.stringify({ id: 1, result: { ok: true } })}\n`);

    await expect(completion).resolves.toMatchObject({
      method: "turn/completed",
      params: { turnId: "turn-routing", status: "completed" },
    });
    await expect(initialize).resolves.toEqual({ ok: true });
  });

  it("rejects unsupported server requests as explicit infrastructure blockers", async () => {
    const { child, stdinText, transport } = makeSpawnedTransport();
    const client = new CodexAppServerJsonRpcClient({ transport });
    const initialize = client.request("initialize");

    child.stdout.write(
      `${JSON.stringify({
        id: "approval-1",
        method: "approval/request",
        params: { reason: "needs approval" },
      })}\n`,
    );

    await expect(initialize).rejects.toThrow(
      "Codex app-server JSON-RPC transport failed while calling initialize: Codex app-server sent unsupported server request approval/request; DevNexus cannot satisfy Codex app-server approval, permission, or user-input requests through this transport",
    );
    expect(stdinText()).toContain(
      JSON.stringify({
        id: "approval-1",
        error: {
          code: -32001,
          message:
            "DevNexus cannot satisfy Codex app-server server request approval/request through this transport.",
        },
      }),
    );
  });

  it("wakes pending response and notification waiters when the transport closes", async () => {
    const { child, transport } = makeSpawnedTransport();
    const client = new CodexAppServerJsonRpcClient({ transport });

    const initialize = client.request("initialize");
    const completion = client.waitForNotification(
      (notification) => notification.method === "turn/completed",
    );

    child.emit("exit", 1, null);

    await expect(initialize).rejects.toThrow(
      "Codex app-server JSON-RPC transport failed while calling initialize: Codex app-server stdio process exited before responding: exit 1",
    );
    await expect(completion).rejects.toThrow(
      "Codex app-server stdio process exited before responding: exit 1",
    );
  });
});
