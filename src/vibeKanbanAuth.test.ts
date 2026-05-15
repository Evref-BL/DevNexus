import { describe, expect, it, vi } from "vitest";
import {
  ensureVibeKanbanLocalLogin,
  VibeKanbanAuthError,
} from "./vibeKanbanAuth.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

describe("Vibe Kanban auth", () => {
  it("signs into the local Vibe app when credentials are provided", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3000/api/auth/status") {
        return jsonResponse({
          success: true,
          data: {
            logged_in: false,
          },
        });
      }

      if (url === "http://127.0.0.1:3000/api/auth/local/login") {
        expect(init).toMatchObject({
          method: "POST",
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "admin@example.test",
          password: "secret-password",
        });
        return jsonResponse({
          success: true,
          data: {
            user_id: "user-1",
            email: "admin@example.test",
            providers: [],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      ensureVibeKanbanLocalLogin({
        port: 3000,
        credentials: {
          email: "admin@example.test",
          password: "secret-password",
        },
        fetch: fetchMock,
      }),
    ).resolves.toMatchObject({
      status: "logged-in",
      attempted: true,
      loggedIn: true,
      email: "admin@example.test",
    });
  });

  it("does not sign in again when Vibe already reports a logged-in session", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3000/api/auth/status") {
        return jsonResponse({
          success: true,
          data: {
            logged_in: true,
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      ensureVibeKanbanLocalLogin({
        port: 3000,
        credentials: {
          email: "admin@example.test",
          password: "secret-password",
        },
        fetch: fetchMock,
      }),
    ).resolves.toMatchObject({
      status: "already-logged-in",
      attempted: false,
      loggedIn: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips login when no credentials are provided", async () => {
    await expect(
      ensureVibeKanbanLocalLogin({
        port: 3000,
        fetch: vi.fn(),
      }),
    ).resolves.toMatchObject({
      status: "skipped",
      attempted: false,
      loggedIn: false,
    });
  });

  it("rejects malformed auth status responses", async () => {
    await expect(
      ensureVibeKanbanLocalLogin({
        port: 3000,
        credentials: {
          email: "admin@example.test",
          password: "secret-password",
        },
        fetch: async () =>
          jsonResponse({
            success: true,
            data: {},
          }),
      }),
    ).rejects.toThrow(VibeKanbanAuthError);
  });
});
