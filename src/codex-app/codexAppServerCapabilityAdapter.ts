import type {
  CodexAppServerJsonRpcClient,
} from "./codexAppServerJsonRpc.js";
import {
  detectCodexAppServerMcpCapabilities,
  type CodexAppServerMcpCapabilitySet,
} from "./codexAppServerMcpRelay.js";

export const codexAppServerControlMethods = [
  "thread/start",
  "thread/fork",
  "turn/start",
  "turn/interrupt",
] as const;

export const codexAppServerReadMethodCandidates = [
  "thread/read",
  "thread/list",
] as const;

export const codexAppServerGoalMethods = [
  "thread/goal/set",
  "thread/goal/get",
  "thread/goal/clear",
] as const;

export type CodexAppServerControlMethod =
  (typeof codexAppServerControlMethods)[number];
export type CodexAppServerReadMethod =
  (typeof codexAppServerReadMethodCandidates)[number];
export type CodexAppServerGoalMethod =
  (typeof codexAppServerGoalMethods)[number];

export interface CodexAppServerMethodAvailability {
  method: string;
  available: boolean;
}

export interface CodexAppServerAlternativeCapability {
  available: boolean;
  method: string | null;
  alternatives: string[];
}

export interface CodexAppServerCapabilitySet {
  threadStart: CodexAppServerMethodAvailability;
  threadFork: CodexAppServerMethodAvailability;
  turnStart: CodexAppServerMethodAvailability;
  turnInterrupt: CodexAppServerMethodAvailability;
  threadRead: CodexAppServerMethodAvailability;
  threadList: CodexAppServerMethodAvailability;
  threadReadOrList: CodexAppServerAlternativeCapability;
  threadGoalSet: CodexAppServerMethodAvailability;
  threadGoalGet: CodexAppServerMethodAvailability;
  threadGoalClear: CodexAppServerMethodAvailability;
  mcp: CodexAppServerMcpCapabilitySet;
}

export interface CodexAppServerCapabilityAdapter {
  client: CodexAppServerJsonRpcClient;
  initializeResult: unknown;
  advertisedMethods: string[];
  capabilities: CodexAppServerCapabilitySet;
}

export interface InitializeCodexAppServerCapabilityAdapterOptions {
  client: CodexAppServerJsonRpcClient;
  initializeParams?: unknown;
}

export class CodexAppServerCapabilityError extends Error {
  readonly missingCapabilities: string[];
  readonly advertisedMethods: string[];

  constructor(options: {
    missingCapabilities: string[];
    advertisedMethods: string[];
  }) {
    const advertised = options.advertisedMethods.length > 0
      ? ` Advertised methods: ${options.advertisedMethods.join(", ")}.`
      : " The initialize result did not advertise any supported methods.";
    super(
      `Codex app-server is missing required JSON-RPC capabilities: ${options.missingCapabilities.join(", ")}.${advertised}`,
    );
    this.name = "CodexAppServerCapabilityError";
    this.missingCapabilities = options.missingCapabilities;
    this.advertisedMethods = options.advertisedMethods;
  }
}

export async function initializeCodexAppServerCapabilityAdapter(
  options: InitializeCodexAppServerCapabilityAdapterOptions,
): Promise<CodexAppServerCapabilityAdapter> {
  const initializeResult = await options.client.request(
    "initialize",
    options.initializeParams,
  );
  const advertisedMethods = extractCodexAppServerMethodNames(initializeResult);
  const capabilities = detectCodexAppServerCapabilities(advertisedMethods);
  const missingCapabilities = missingCodexAppServerCapabilities(capabilities);
  if (missingCapabilities.length > 0) {
    throw new CodexAppServerCapabilityError({
      missingCapabilities,
      advertisedMethods,
    });
  }

  return {
    client: options.client,
    initializeResult,
    advertisedMethods,
    capabilities,
  };
}

export function detectCodexAppServerCapabilities(
  methodNames: readonly string[],
): CodexAppServerCapabilitySet {
  const methods = new Set(methodNames);
  const threadRead = availability("thread/read", methods);
  const threadList = availability("thread/list", methods);
  const readMethod = threadRead.available
    ? threadRead.method
    : threadList.available
      ? threadList.method
      : null;

  return {
    threadStart: availability("thread/start", methods),
    threadFork: availability("thread/fork", methods),
    turnStart: availability("turn/start", methods),
    turnInterrupt: availability("turn/interrupt", methods),
    threadRead,
    threadList,
    threadReadOrList: {
      available: readMethod !== null,
      method: readMethod,
      alternatives: [...codexAppServerReadMethodCandidates],
    },
    threadGoalSet: availability("thread/goal/set", methods),
    threadGoalGet: availability("thread/goal/get", methods),
    threadGoalClear: availability("thread/goal/clear", methods),
    mcp: detectCodexAppServerMcpCapabilities(methodNames),
  };
}

export function missingCodexAppServerCapabilities(
  capabilities: CodexAppServerCapabilitySet,
): string[] {
  return [
    ...(capabilities.threadStart.available ? [] : ["thread/start"]),
    ...(capabilities.threadFork.available ? [] : ["thread/fork"]),
    ...(capabilities.turnStart.available ? [] : ["turn/start"]),
    ...(capabilities.turnInterrupt.available ? [] : ["turn/interrupt"]),
    ...(capabilities.threadReadOrList.available
      ? []
      : ["thread/read or thread/list"]),
  ];
}

export function extractCodexAppServerMethodNames(
  initializeResult: unknown,
): string[] {
  const methods = new Set<string>();
  const visited = new Set<object>();
  collectMethodNames(initializeResult, methods, visited, 0);
  return [...methods].sort((left, right) => left.localeCompare(right));
}

const methodListKeys = new Set([
  "methods",
  "methodNames",
  "rpcMethods",
  "supportedMethods",
]);

function collectMethodNames(
  value: unknown,
  methods: Set<string>,
  visited: Set<object>,
  depth: number,
): void {
  if (!value || typeof value !== "object" || depth > 8) {
    return;
  }
  if (visited.has(value)) {
    return;
  }

  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMethodNames(item, methods, visited, depth + 1);
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (methodListKeys.has(key)) {
      addMethodNames(child, methods);
    }
    collectMethodNames(child, methods, visited, depth + 1);
  }
}

function addMethodNames(value: unknown, methods: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      const methodName = methodNameFromValue(item);
      if (methodName) {
        methods.add(methodName);
      }
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const keyMethodName = normalizeMethodName(key);
    if (keyMethodName) {
      methods.add(keyMethodName);
    }
    const childMethodName = methodNameFromValue(child);
    if (childMethodName) {
      methods.add(childMethodName);
    }
  }
}

function methodNameFromValue(value: unknown): string | null {
  if (typeof value === "string") {
    return normalizeMethodName(value);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  return normalizeMethodName(record.name) ?? normalizeMethodName(record.method);
}

function normalizeMethodName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const method = value.trim();
  return method.length > 0 ? method : null;
}

function availability(
  method: string,
  methods: ReadonlySet<string>,
): CodexAppServerMethodAvailability {
  return {
    method,
    available: methods.has(method),
  };
}
