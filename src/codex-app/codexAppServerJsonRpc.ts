import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";

export type CodexAppServerJsonRpcId = string | number;

export interface CodexAppServerJsonRpcRequest {
  jsonrpc?: "2.0";
  id: CodexAppServerJsonRpcId;
  method: string;
  params?: unknown;
}

export interface CodexAppServerJsonRpcSuccessResponse {
  jsonrpc?: "2.0";
  id: CodexAppServerJsonRpcId;
  result: unknown;
}

export interface CodexAppServerJsonRpcErrorResponse {
  jsonrpc?: "2.0";
  id: CodexAppServerJsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type CodexAppServerJsonRpcResponse =
  | CodexAppServerJsonRpcSuccessResponse
  | CodexAppServerJsonRpcErrorResponse;

export interface CodexAppServerJsonRpcNotification {
  jsonrpc?: "2.0";
  method: string;
  params?: unknown;
}

export interface CodexAppServerJsonRpcServerRequest {
  jsonrpc?: "2.0";
  id: CodexAppServerJsonRpcId;
  method: string;
  params?: unknown;
}

export type CodexAppServerJsonRpcNotificationPredicate = (
  notification: CodexAppServerJsonRpcNotification,
) => boolean;

export interface CodexAppServerJsonRpcTransport {
  send(
    request: CodexAppServerJsonRpcRequest,
  ): Promise<CodexAppServerJsonRpcResponse>;
  sendNotification?(
    notification: CodexAppServerJsonRpcNotification,
  ): Promise<void> | void;
  waitForNotification?(
    predicate: CodexAppServerJsonRpcNotificationPredicate,
  ): Promise<CodexAppServerJsonRpcNotification>;
  close?(): Promise<void> | void;
}

export interface CodexAppServerJsonRpcClientOptions {
  transport: CodexAppServerJsonRpcTransport;
  nextId?: () => CodexAppServerJsonRpcId;
}

export type CodexAppServerJsonRpcErrorKind =
  | "protocol"
  | "remote"
  | "transport";

export interface CodexAppServerJsonRpcErrorOptions {
  kind: CodexAppServerJsonRpcErrorKind;
  method: string;
  message: string;
  code?: number;
  data?: unknown;
  cause?: unknown;
}

export class CodexAppServerJsonRpcError extends Error {
  readonly kind: CodexAppServerJsonRpcErrorKind;
  readonly method: string;
  readonly code?: number;
  readonly data?: unknown;

  constructor(options: CodexAppServerJsonRpcErrorOptions) {
    super(options.message);
    this.name = "CodexAppServerJsonRpcError";
    this.kind = options.kind;
    this.method = options.method;
    this.code = options.code;
    this.data = options.data;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class CodexAppServerJsonRpcClient {
  private nextNumericId = 1;
  private readonly transport: CodexAppServerJsonRpcTransport;
  private readonly nextId: () => CodexAppServerJsonRpcId;

  constructor(options: CodexAppServerJsonRpcClientOptions) {
    this.transport = options.transport;
    this.nextId = options.nextId ?? (() => this.nextNumericId++);
  }

  async request<Result = unknown>(
    method: string,
    params?: unknown,
  ): Promise<Result> {
    const requestMethod = requiredNonEmptyString(method, "method");
    const request: CodexAppServerJsonRpcRequest = {
      id: this.nextId(),
      method: requestMethod,
      ...(params === undefined ? {} : { params }),
    };

    let response: CodexAppServerJsonRpcResponse;
    try {
      response = await this.transport.send(request);
    } catch (error) {
      throw new CodexAppServerJsonRpcError({
        kind: "transport",
        method: requestMethod,
        message: `Codex app-server JSON-RPC transport failed while calling ${requestMethod}: ${errorMessage(error)}`,
        cause: error,
      });
    }

    const record = responseRecord(response, requestMethod);
    if (hasOwn(record, "jsonrpc") && record.jsonrpc !== "2.0") {
      throw protocolError(
        requestMethod,
        `response jsonrpc must be absent or "2.0", got ${JSON.stringify(record.jsonrpc)}`,
      );
    }

    if (!sameJsonRpcId(record.id, request.id)) {
      throw protocolError(
        requestMethod,
        `response id ${formatJsonRpcId(record.id)} did not match request id ${formatJsonRpcId(request.id)}`,
      );
    }

    if (hasOwn(record, "error")) {
      const remoteError = remoteErrorRecord(record.error, requestMethod);
      throw new CodexAppServerJsonRpcError({
        kind: "remote",
        method: requestMethod,
        code: remoteError.code,
        data: remoteError.data,
        message: `Codex app-server JSON-RPC method ${requestMethod} failed: ${remoteError.message}`,
      });
    }

    if (!hasOwn(record, "result")) {
      throw protocolError(requestMethod, "response must include result or error");
    }

    return record.result as Result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const notificationMethod = requiredNonEmptyString(method, "method");
    const notification: CodexAppServerJsonRpcNotification = {
      method: notificationMethod,
      ...(params === undefined ? {} : { params }),
    };

    if (!this.transport.sendNotification) {
      throw new CodexAppServerJsonRpcError({
        kind: "transport",
        method: notificationMethod,
        message:
          `Codex app-server JSON-RPC transport failed while sending ${notificationMethod}: transport does not support client notifications`,
      });
    }

    try {
      await this.transport.sendNotification(notification);
    } catch (error) {
      throw new CodexAppServerJsonRpcError({
        kind: "transport",
        method: notificationMethod,
        message: `Codex app-server JSON-RPC transport failed while sending ${notificationMethod}: ${errorMessage(error)}`,
        cause: error,
      });
    }
  }

  close(): Promise<void> | void {
    return this.transport.close?.();
  }

  supportsNotifications(): boolean {
    return typeof this.transport.waitForNotification === "function";
  }

  waitForNotification(
    predicate: CodexAppServerJsonRpcNotificationPredicate,
  ): Promise<CodexAppServerJsonRpcNotification> {
    if (!this.transport.waitForNotification) {
      return Promise.reject(
        new Error("Codex app-server transport does not support notifications"),
      );
    }

    return this.transport.waitForNotification(predicate);
  }
}

export type CodexAppServerStdioSpawn = (
  command: string,
  args?: readonly string[],
  options?: SpawnOptions,
) => ChildProcess;

export interface CreateCodexAppServerStdioJsonRpcTransportOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: CodexAppServerStdioSpawn;
}

interface PendingJsonRpcRequest {
  method: string;
  resolve: (response: CodexAppServerJsonRpcResponse) => void;
  reject: (error: Error) => void;
}

interface PendingJsonRpcNotificationWaiter {
  predicate: CodexAppServerJsonRpcNotificationPredicate;
  resolve: (notification: CodexAppServerJsonRpcNotification) => void;
  reject: (error: Error) => void;
}

export function createCodexAppServerStdioJsonRpcTransport(
  options: CreateCodexAppServerStdioJsonRpcTransportOptions,
): CodexAppServerJsonRpcTransport {
  return new CodexAppServerStdioJsonRpcTransport(options);
}

class CodexAppServerStdioJsonRpcTransport
  implements CodexAppServerJsonRpcTransport
{
  private readonly child: ChildProcess;
  private readonly pending = new Map<CodexAppServerJsonRpcId, PendingJsonRpcRequest>();
  private readonly notificationWaiters: PendingJsonRpcNotificationWaiter[] = [];
  private readonly bufferedNotifications: CodexAppServerJsonRpcNotification[] = [];
  private buffer = Buffer.alloc(0);
  private closedError: Error | null = null;

  constructor(options: CreateCodexAppServerStdioJsonRpcTransportOptions) {
    const command = requiredNonEmptyString(options.command, "command");
    const spawn = options.spawn ?? nodeSpawn;
    this.child = spawn(command, [...(options.args ?? [])], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.receive(chunk));
    this.child.once("error", (error) => this.failAll(error));
    this.child.once("exit", (code, signal) => {
      this.failAll(
        new Error(
          `Codex app-server stdio process exited before responding: ${exitSummary(code, signal)}`,
        ),
      );
    });
  }

  send(
    request: CodexAppServerJsonRpcRequest,
  ): Promise<CodexAppServerJsonRpcResponse> {
    if (this.closedError) {
      return Promise.reject(this.closedError);
    }
    if (!this.child.stdin?.writable) {
      return Promise.reject(new Error("Codex app-server stdin is not writable"));
    }

    return new Promise((resolve, reject) => {
      this.pending.set(request.id, {
        method: request.method,
        resolve,
        reject,
      });
      this.writeMessage(request, (error?: Error | null) => {
        if (!error) {
          return;
        }

        this.pending.delete(request.id);
        reject(error);
      });
    });
  }

  sendNotification(
    notification: CodexAppServerJsonRpcNotification,
  ): Promise<void> {
    if (this.closedError) {
      return Promise.reject(this.closedError);
    }
    if (!this.child.stdin?.writable) {
      return Promise.reject(new Error("Codex app-server stdin is not writable"));
    }

    return new Promise((resolve, reject) => {
      this.writeMessage(notification, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  waitForNotification(
    predicate: CodexAppServerJsonRpcNotificationPredicate,
  ): Promise<CodexAppServerJsonRpcNotification> {
    if (this.closedError) {
      return Promise.reject(this.closedError);
    }

    for (let index = 0; index < this.bufferedNotifications.length; index += 1) {
      const notification = this.bufferedNotifications[index]!;
      if (predicate(notification)) {
        this.bufferedNotifications.splice(index, 1);
        return Promise.resolve(notification);
      }
    }

    return new Promise((resolve, reject) => {
      this.notificationWaiters.push({ predicate, resolve, reject });
    });
  }

  private writeMessage(
    messageBody: CodexAppServerJsonRpcRequest | CodexAppServerJsonRpcNotification,
    callback?: (error?: Error | null) => void,
  ): void {
    const body = JSON.stringify(messageBody);
    this.child.stdin!.write(`${body}\n`, "utf8", callback);
  }

  close(): void {
    this.closedError = new Error("Codex app-server stdio transport closed");
    this.child.stdin?.end();
    if (!this.child.killed) {
      this.child.kill();
    }
    this.failAll(this.closedError);
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      this.processBuffer();
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private processBuffer(): void {
    while (true) {
      const lineEnd = this.buffer.indexOf("\n");
      if (lineEnd < 0) {
        return;
      }

      const line = this.buffer.slice(0, lineEnd).toString("utf8").trim();
      this.buffer = this.buffer.slice(lineEnd + 1);
      if (line.length === 0) {
        continue;
      }

      this.routeMessage(parseStdioJsonLine(line));
    }
  }

  private routeMessage(message: Record<string, unknown>): void {
    if (isJsonRpcResponse(message)) {
      this.resolveResponse(message);
      return;
    }
    if (isJsonRpcServerRequest(message)) {
      this.rejectUnsupportedServerRequest(
        message as unknown as CodexAppServerJsonRpcServerRequest,
      );
      return;
    }
    if (isJsonRpcNotification(message)) {
      this.routeNotification(
        message as unknown as CodexAppServerJsonRpcNotification,
      );
    }
  }

  private resolveResponse(response: Record<string, unknown>): void {
    const id = response.id;
    if (typeof id !== "string" && typeof id !== "number") {
      return;
    }

    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }

    this.pending.delete(id);
    pending.resolve(response as unknown as CodexAppServerJsonRpcResponse);
  }

  private routeNotification(
    notification: CodexAppServerJsonRpcNotification,
  ): void {
    for (let index = 0; index < this.notificationWaiters.length; index += 1) {
      const waiter = this.notificationWaiters[index]!;
      if (waiter.predicate(notification)) {
        this.notificationWaiters.splice(index, 1);
        waiter.resolve(notification);
        return;
      }
    }

    this.bufferedNotifications.push(notification);
    if (this.bufferedNotifications.length > 100) {
      this.bufferedNotifications.shift();
    }
  }

  private rejectUnsupportedServerRequest(
    request: CodexAppServerJsonRpcServerRequest,
  ): void {
    this.writeServerRequestRejection(request);
    this.failAll(
      new Error(
        `Codex app-server sent unsupported server request ${request.method}; DevNexus cannot satisfy Codex app-server approval, permission, or user-input requests through this transport`,
      ),
    );
  }

  private writeServerRequestRejection(
    request: CodexAppServerJsonRpcServerRequest,
  ): void {
    if (!this.child.stdin?.writable) {
      return;
    }

    const response = {
      id: request.id,
      error: {
        code: -32001,
        message:
          `DevNexus cannot satisfy Codex app-server server request ${request.method} through this transport.`,
      },
    };
    this.child.stdin.write(`${JSON.stringify(response)}\n`, "utf8");
  }

  private failAll(error: Error): void {
    this.closedError = error;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.notificationWaiters.splice(0)) {
      waiter.reject(error);
    }
  }
}

function isJsonRpcResponse(
  message: Record<string, unknown>,
): boolean {
  return isJsonRpcId(message.id) &&
    (hasOwn(message, "result") || hasOwn(message, "error"));
}

function isJsonRpcServerRequest(
  message: Record<string, unknown>,
): boolean {
  return isJsonRpcId(message.id) &&
    typeof message.method === "string" &&
    message.method.trim().length > 0 &&
    !hasOwn(message, "result") &&
    !hasOwn(message, "error");
}

function isJsonRpcNotification(
  message: Record<string, unknown>,
): boolean {
  return !hasOwn(message, "id") &&
    typeof message.method === "string" &&
    message.method.trim().length > 0;
}

function isJsonRpcId(value: unknown): value is CodexAppServerJsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

function parseStdioJsonLine(line: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `Codex app-server stdio response is not valid newline-delimited JSON: ${errorMessage(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Codex app-server stdio response line must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

export function summarizeCodexAppServerJsonRpcFailure(error: unknown): string {
  return error instanceof CodexAppServerJsonRpcError
    ? error.message
    : errorMessage(error);
}

function responseRecord(
  value: unknown,
  method: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError(method, "response must be an object");
  }

  return value as Record<string, unknown>;
}

function remoteErrorRecord(
  value: unknown,
  method: string,
): { code: number; message: string; data?: unknown } {
  const record = responseRecord(value, method);
  const code = record.code;
  const message = record.message;
  if (typeof code !== "number" || !Number.isInteger(code)) {
    throw protocolError(method, "response error.code must be an integer");
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    throw protocolError(method, "response error.message must be a non-empty string");
  }

  return {
    code,
    message: message.trim(),
    ...(hasOwn(record, "data") ? { data: record.data } : {}),
  };
}

function protocolError(
  method: string,
  message: string,
): CodexAppServerJsonRpcError {
  return new CodexAppServerJsonRpcError({
    kind: "protocol",
    method,
    message: `Codex app-server JSON-RPC protocol error while calling ${method}: ${message}`,
  });
}

function sameJsonRpcId(
  left: unknown,
  right: CodexAppServerJsonRpcId,
): boolean {
  return left === right;
}

function formatJsonRpcId(id: unknown): string {
  return typeof id === "string" ? JSON.stringify(id) : String(id);
}

function exitSummary(code: number | null, signal: NodeJS.Signals | null): string {
  if (code !== null) {
    return `exit ${code}`;
  }
  if (signal) {
    return `signal ${signal}`;
  }

  return "unknown exit";
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function requiredNonEmptyString(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CodexAppServerJsonRpcError({
      kind: "protocol",
      method: name,
      message: `${name} must be a non-empty string`,
    });
  }

  return value.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
