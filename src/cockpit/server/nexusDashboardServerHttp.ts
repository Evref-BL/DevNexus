import type {
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { NexusDashboardCodexChatError } from "./nexusDashboardCodexChat.js";
import type { NexusDashboardThreadResolutionAction } from "./nexusDashboardThreadResolution.js";
import type {
  NexusDashboardLocalOpenApp,
  NexusDashboardLocalOpenTarget,
} from "./nexusDashboardLocalOpen.js";

export class NexusDashboardRouteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "NexusDashboardRouteError";
  }
}

export function dashboardErrorStatusCode(error: unknown): number {
  if (
    error instanceof NexusDashboardRouteError ||
    error instanceof NexusDashboardCodexChatError
  ) {
    return error.statusCode;
  }
  return 500;
}

export function dashboardErrorBody(error: unknown): unknown {
  return {
    ok: false,
    error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof NexusDashboardRouteError
        ? { code: error.code }
        : {}),
    },
  };
}

export function requireDashboardMutationRequest(
  request: IncomingMessage,
  actionToken: string,
): void {
  const contentType = request.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !contentType.toLowerCase().split(";").some((part) =>
      part.trim() === "application/json"
    )
  ) {
    throw new NexusDashboardCodexChatError(
      "Content-Type must be application/json",
      415,
    );
  }

  const suppliedToken = request.headers["x-dev-nexus-action-token"];
  if (suppliedToken !== actionToken) {
    throw new NexusDashboardCodexChatError(
      "Dashboard action token is missing or invalid",
      403,
    );
  }

  const origin = request.headers.origin;
  if (typeof origin === "string") {
    const requestHost = request.headers.host;
    const originHost = safeOriginHost(origin);
    if (!requestHost || originHost !== requestHost) {
      throw new NexusDashboardCodexChatError(
        "Dashboard action origin is not allowed",
        403,
      );
    }
  }
}

export function sendJson(
  response: ServerResponse,
  value: unknown,
  statusCode = 200,
): void {
  sendText(
    response,
    "application/json; charset=utf-8",
    JSON.stringify(value, null, 2),
    statusCode,
  );
}

export function sendText(
  response: ServerResponse,
  contentType: string,
  body: string,
  statusCode = 200,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

export function sendBinary(
  response: ServerResponse,
  contentType: string,
  body: Buffer | string,
  statusCode = 200,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "public, max-age=86400",
  });
  response.end(body);
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (Buffer.byteLength(body, "utf8") > maxBytes) {
      throw new NexusDashboardCodexChatError(
        "Request body is too large",
        413,
      );
    }
  }
  if (!body.trim()) {
    throw new NexusDashboardCodexChatError(
      "Request body must be JSON",
      400,
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new NexusDashboardCodexChatError(
      "Request body must be valid JSON",
      400,
    );
  }
}

export function requiredStringField(value: unknown, fieldName: string): string {
  const record = plainRecord(value);
  const field = record[fieldName];
  if (typeof field !== "string" || field.trim().length === 0) {
    throw new NexusDashboardCodexChatError(
      `${fieldName} must be a non-empty string`,
      400,
    );
  }

  return field.trim();
}

export function optionalStringField(
  value: unknown,
  fieldName: string,
): string | undefined {
  const record = plainRecord(value);
  const field = record[fieldName];
  if (field === undefined || field === null || field === "") {
    return undefined;
  }
  if (typeof field !== "string") {
    throw new NexusDashboardCodexChatError(
      `${fieldName} must be a string`,
      400,
    );
  }

  return field.trim() || undefined;
}

export function requiredLocalOpenTarget(
  value: unknown,
  fieldName: string,
): NexusDashboardLocalOpenTarget {
  const target = requiredStringField(value, fieldName);
  if (target === "home" || target === "project") {
    return target;
  }
  throw new NexusDashboardCodexChatError(
    `${fieldName} must be home or project`,
    400,
  );
}

export function requiredLocalOpenApp(
  value: unknown,
  fieldName: string,
): NexusDashboardLocalOpenApp {
  const app = requiredStringField(value, fieldName);
  if (app === "file" || app === "code" || app === "terminal") {
    return app;
  }
  throw new NexusDashboardCodexChatError(
    `${fieldName} must be file, code, or terminal`,
    400,
  );
}

export function requiredDashboardThreadResolutionAction(
  value: unknown,
  fieldName: string,
): NexusDashboardThreadResolutionAction {
  const action = requiredStringField(value, fieldName);
  if (action === "archive" || action === "forget") {
    return action;
  }
  throw new NexusDashboardCodexChatError(
    `${fieldName} must be archive or forget`,
    400,
  );
}

export function rejectClientControlledField(
  value: unknown,
  fieldName: string,
): void {
  const record = plainRecord(value);
  if (record[fieldName] !== undefined && record[fieldName] !== null) {
    throw new NexusDashboardCodexChatError(
      `${fieldName} is server-controlled for dashboard actions`,
      400,
    );
  }
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusDashboardCodexChatError(
      "Request body must be a JSON object",
      400,
    );
  }

  return value as Record<string, unknown>;
}

function safeOriginHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

export function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export function isAddressInUseError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as NodeJS.ErrnoException).code === "EADDRINUSE",
  );
}

export function dashboardTimestamp(now?: () => Date | string): string {
  const value = now?.() ?? new Date();
  return typeof value === "string" ? value : value.toISOString();
}

export function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function safeJsonString(value: string): string {
  return JSON.stringify(value).replace(/<\/script/giu, "<\\/script");
}
