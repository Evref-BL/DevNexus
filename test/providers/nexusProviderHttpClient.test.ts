import { describe, expect, it } from "vitest";
import {
  createNexusProviderHttpClient,
} from "../../src/providers/nexusProviderHttpClient.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("nexus provider HTTP client", () => {
  it("stores GitHub ETags and reuses cached JSON on 304 responses", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetcher: typeof fetch = async (input, init = {}) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url: String(input), headers });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ value: 1 }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            etag: "\"etag-1\"",
          },
        });
      }

      expect(headers["If-None-Match"]).toBe("\"etag-1\"");
      return new Response(null, { status: 304 });
    };
    const client = createNexusProviderHttpClient({ fetch: fetcher });

    const first = await client.requestJson<{ value: number }>({
      method: "GET",
      url: "https://api.github.com/repos/example/project/issues/7",
      headers: { Authorization: "Bearer token" },
    });
    const second = await client.requestJson<{ value: number }>({
      method: "GET",
      url: "https://api.github.com/repos/example/project/issues/7",
      headers: { Authorization: "Bearer token" },
    });

    expect(first).toMatchObject({
      ok: true,
      status: 200,
      body: { value: 1 },
      fromCache: false,
      notModified: false,
    });
    expect(second).toMatchObject({
      ok: true,
      status: 304,
      body: { value: 1 },
      fromCache: true,
      notModified: true,
    });
    expect(calls).toHaveLength(2);
  });

  it("serializes provider requests when concurrency is one", async () => {
    let active = 0;
    let maxActive = 0;
    const fetcher: typeof fetch = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(10);
      active -= 1;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = createNexusProviderHttpClient({
      fetch: fetcher,
      concurrency: 1,
    });

    await Promise.all([
      client.requestJson({
        method: "GET",
        url: "https://api.github.com/repos/example/project/issues/1",
      }),
      client.requestJson({
        method: "GET",
        url: "https://api.github.com/repos/example/project/issues/2",
      }),
    ]);

    expect(maxActive).toBe(1);
  });

  it("surfaces rate-limit metadata from provider errors", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
          "retry-after": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1770000000",
        },
      });
    const client = createNexusProviderHttpClient({ fetch: fetcher });

    const response = await client.requestJson<{ message: string }>({
      method: "GET",
      url: "https://api.github.com/repos/example/project/issues/7",
    });

    expect(response).toMatchObject({
      ok: false,
      status: 403,
      body: { message: "API rate limit exceeded" },
      rateLimit: {
        limited: true,
        retryAfterSeconds: 60,
        remaining: 0,
        resetAt: "2026-02-02T02:40:00.000Z",
      },
    });
  });
});
