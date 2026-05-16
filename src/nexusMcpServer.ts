import path from "node:path";
import process from "node:process";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  resolveNexusHome,
  saveNexusHomeConfigFile,
  validateNexusHomeConfigBase,
  type NexusHomeConfigBase,
} from "./nexusHomeConfig.js";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./nexusProjectConfig.js";
import {
  getNexusProjectStatus,
  type NexusProjectHomeStore,
} from "./nexusProjectHomeService.js";
import {
  resolvePrimaryProjectComponent,
  resolveProjectComponents,
} from "./nexusProjectLifecycle.js";
import {
  buildNexusProjectStatusForPath,
  type NexusProjectStatusBase,
} from "./nexusProjectRegistry.js";
import {
  getNexusAutomationStatus,
} from "./nexusAutomationStatus.js";
import {
  appendNexusAutomationTargetCycleRecord,
  readNexusAutomationTargetCycleLedger,
  type NexusAutomationTargetCycleStatus,
  type NexusAutomationTargetCycleWorkItemInput,
} from "./nexusAutomationTargetCycle.js";
import {
  buildNexusAutomationTargetReport,
} from "./nexusAutomationTargetReport.js";
import {
  createWorkItemService,
  type ResolvedWorkItemProjectContext,
  type WorkItemProjectSelector,
} from "./workItemService.js";
import type {
  WorkItemPatch,
  WorkItemRef,
  WorkStatus,
} from "./workTrackingTypes.js";

export const devNexusMcpProtocolVersion = "2024-11-05";

type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface DevNexusMcpToolContext {
  now?: () => Date | string;
}

export interface DevNexusMcpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

const tools: McpTool[] = [
  {
    name: "project_status",
    description: "Show one DevNexus project by registered id or filesystem path.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "automation_status",
    description: "Read DevNexus automation readiness, target context, and eligible work without mutating state.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "target_cycle_list",
    description: "List recorded DevNexus target cycles without mutating state.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "target_cycle_record",
    description: "Record caller-reported DevNexus target cycle progress.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        cycleId: { type: "string" },
        runId: { type: "string" },
        status: { type: "string" },
        summary: { type: ["string", "null"] },
        eligibleWorkItemCount: { type: ["number", "null"] },
        workItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              componentId: { type: ["string", "null"] },
              id: { type: "string" },
              title: { type: ["string", "null"] },
              status: { type: ["string", "null"] },
              cycleStatus: { type: ["string", "null"] },
              agentProfileId: { type: ["string", "null"] },
              notes: { type: ["string", "null"] },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
        blockers: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
  {
    name: "target_report",
    description: "Build a factual DevNexus target report from recorded target, cycle, run, and work-item facts.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "work_item_create",
    description: "Create a work item through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        status: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
        milestone: { type: ["string", "null"] },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_list",
    description: "List work items through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        status: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
        search: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "work_item_get",
    description: "Get a work item through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "work_item_update",
    description: "Update a work item through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        status: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
        milestone: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "work_item_comment",
    description: "Add a comment to a work item through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
        body: { type: "string" },
      },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_set_status",
    description: "Set a work item's status through the configured DevNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
        status: { type: "string" },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
];

export function listDevNexusMcpTools(): McpTool[] {
  return tools;
}

export async function callDevNexusMcpTool(
  name: string,
  argsValue: unknown,
  context: DevNexusMcpToolContext = {},
): Promise<DevNexusMcpToolResult> {
  try {
    const args = argsValue === undefined ? {} : asRecord(argsValue, "arguments");
    switch (name) {
      case "project_status":
        return toolResult({
          ok: true,
          project: projectStatusFromArgs(args),
        });
      case "automation_status":
        return toolResult({
          ok: true,
          ...(await getNexusAutomationStatus({
            projectRoot: projectRootFromArgs(args),
            now: context.now,
          })),
        });
      case "target_cycle_list":
        return toolResult({
          ok: true,
          ...targetCycleLedgerFromArgs(args),
        });
      case "target_cycle_record":
        return toolResult({
          ok: true,
          ...appendTargetCycleFromArgs(args, context),
        });
      case "target_report":
        return toolResult({
          ok: true,
          report: buildNexusAutomationTargetReport({
            projectRoot: projectRootFromArgs(args),
            now: context.now?.(),
          }),
        });
      case "work_item_create":
        return toolResult({
          ok: true,
          workItem: await workItemServiceFromArgs(args, context).createWorkItem({
            ...projectSelectorFromArgs(args),
            title: requiredString(args, "title", "arguments"),
            description: optionalNullableString(args, "description", "arguments"),
            status: optionalWorkStatus(args, "status", "arguments"),
            labels: optionalStringArray(args, "labels", "arguments") ?? [],
            assignees: optionalStringArray(args, "assignees", "arguments") ?? [],
            milestone: optionalNullableString(args, "milestone", "arguments"),
          }),
        });
      case "work_item_list":
        return toolResult({
          ok: true,
          workItems: await workItemServiceFromArgs(args, context).listWorkItems({
            ...projectSelectorFromArgs(args),
            status: optionalWorkStatusQuery(args, "status", "arguments"),
            labels: optionalStringArray(args, "labels", "arguments"),
            assignees: optionalStringArray(args, "assignees", "arguments"),
            search: optionalString(args, "search", "arguments"),
            limit: optionalPositiveInteger(args, "limit", "arguments"),
          }),
        });
      case "work_item_get":
        return toolResult({
          ok: true,
          workItem: await workItemServiceFromArgs(args, context).getWorkItem({
            ...projectSelectorFromArgs(args),
            ...workItemRefFromArgs(args),
          }),
        });
      case "work_item_update":
        return toolResult({
          ok: true,
          workItem: await workItemServiceFromArgs(args, context).updateWorkItem({
            ...projectSelectorFromArgs(args),
            ref: workItemRefFromArgs(args),
            patch: workItemPatchFromArgs(args),
          }),
        });
      case "work_item_comment":
        return toolResult({
          ok: true,
          comment: await workItemServiceFromArgs(args, context).addComment({
            ...projectSelectorFromArgs(args),
            ref: workItemRefFromArgs(args),
            body: requiredString(args, "body", "arguments"),
          }),
        });
      case "work_item_set_status":
        return toolResult({
          ok: true,
          workItem: await workItemServiceFromArgs(args, context).setStatus({
            ...projectSelectorFromArgs(args),
            ref: workItemRefFromArgs(args),
            status: parseWorkStatus(
              requiredString(args, "status", "arguments"),
              "arguments.status",
            ),
          }),
        });
      default:
        return toolResult(
          {
            ok: false,
            error: `Unknown DevNexus MCP tool: ${name}`,
          },
          true,
        );
    }
  } catch (error) {
    return toolResult(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}

export async function handleDevNexusMcpJsonRpcMessage(
  message: JsonRpcRequest,
): Promise<unknown | undefined> {
  switch (message.method) {
    case "initialize":
      return jsonRpcResult(message.id, {
        protocolVersion: devNexusMcpProtocolVersion,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "dev-nexus",
          version: "0.1.0",
        },
      });
    case "notifications/initialized":
      return undefined;
    case "tools/list":
      return jsonRpcResult(message.id, {
        tools: listDevNexusMcpTools(),
      });
    case "tools/call": {
      const params = parseToolCallParams(message.params);
      return jsonRpcResult(
        message.id,
        await callDevNexusMcpTool(params.name, params.arguments),
      );
    }
    default:
      if (message.id === undefined) {
        return undefined;
      }

      return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

export async function runDevNexusMcpStdioServer(): Promise<void> {
  const transport = new StdioJsonRpcTransport(handleDevNexusMcpJsonRpcMessage);
  await transport.start();
}

function workItemServiceFromArgs(
  args: Record<string, unknown>,
  context: DevNexusMcpToolContext,
) {
  const homePath = homePathFromArgs(args);
  return createWorkItemService({
    resolveProject: (selector) => resolveWorkItemProject(selector, homePath),
    now: context.now,
  });
}

function targetCycleLedgerFromArgs(args: Record<string, unknown>): {
  projectRoot: string;
  projectId: string;
  ledger: ReturnType<typeof readNexusAutomationTargetCycleLedger>;
} {
  const { projectRoot, projectConfig, automationConfig } =
    targetCycleProjectFromArgs(args);
  return {
    projectRoot,
    projectId: projectConfig.id,
    ledger: readNexusAutomationTargetCycleLedger(projectRoot, automationConfig),
  };
}

function appendTargetCycleFromArgs(
  args: Record<string, unknown>,
  context: DevNexusMcpToolContext,
): {
  projectRoot: string;
  projectId: string;
  record: ReturnType<typeof readNexusAutomationTargetCycleLedger>["cycles"][number];
  ledger: ReturnType<typeof readNexusAutomationTargetCycleLedger>;
} {
  const { projectRoot, projectConfig, automationConfig } =
    targetCycleProjectFromArgs(args);
  const cycleId = optionalString(args, "cycleId", "arguments");
  const ledger = appendNexusAutomationTargetCycleRecord({
    projectRoot,
    config: automationConfig,
    now: context.now?.(),
    record: {
      ...(cycleId ? { id: cycleId } : {}),
      projectId: projectConfig.id,
      targetId: automationConfig.target.id,
      objective: automationConfig.target.objective,
      runId: optionalNullableString(args, "runId", "arguments") ?? null,
      status: parseTargetCycleStatus(
        requiredString(args, "status", "arguments"),
        "arguments.status",
      ),
      summary: optionalNullableString(args, "summary", "arguments") ?? null,
      eligibleWorkItemCount: optionalNullableNonNegativeInteger(
        args,
        "eligibleWorkItemCount",
        "arguments",
      ),
      workItems: optionalTargetCycleWorkItems(args, "workItems", "arguments") ?? [],
      blockers: optionalStringArray(args, "blockers", "arguments") ?? [],
      notes: optionalStringArray(args, "notes", "arguments") ?? [],
    },
  });

  return {
    projectRoot,
    projectId: projectConfig.id,
    record: ledger.cycles.at(-1)!,
    ledger,
  };
}

function targetCycleProjectFromArgs(args: Record<string, unknown>): {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  automationConfig: NonNullable<NexusProjectConfig["automation"]>;
} {
  const projectRoot = projectRootFromArgs(args);
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation;
  if (!automationConfig) {
    throw new Error("Project automation is not configured");
  }

  return { projectRoot, projectConfig, automationConfig };
}

function resolveWorkItemProject(
  selector: WorkItemProjectSelector,
  homePath: string,
): ResolvedWorkItemProjectContext {
  const projectRoot = selector.projectRoot
    ? path.resolve(selector.projectRoot)
    : getNexusProjectStatus({
        homePath,
        homeStore: fileProjectHomeStore(),
        project: requiredPlainString(selector.project, "project"),
      }).project.projectRoot;
  const config = loadProjectConfig(projectRoot);
  const componentId = selector.componentId;
  const component = componentId
    ? resolveProjectComponents(projectRoot, config).find(
        (candidate) => candidate.id === componentId,
      )
    : resolvePrimaryProjectComponent(projectRoot, config);
  if (!component) {
    throw new Error(`Project component is not configured: ${componentId}`);
  }
  if (!component.workTracking) {
    throw new Error(`Component ${component.id} work tracking is not configured`);
  }

  return {
    homePath: config.home ?? homePath,
    projectRoot,
    projectId: config.id,
    projectName: config.name,
    componentId: component.id,
    componentName: component.name,
    sourceRoot: component.sourceRoot,
    workTracking: component.workTracking,
  };
}

function projectRootFromArgs(args: Record<string, unknown>): string {
  const projectRoot = optionalString(args, "projectRoot", "arguments");
  if (projectRoot) {
    return path.resolve(projectRoot);
  }

  return projectStatusFromArgs(args).projectRoot;
}

function projectStatusFromArgs(args: Record<string, unknown>): NexusProjectStatusBase {
  const project = requiredString(args, "project", "arguments");
  const homePath = optionalString(args, "homePath", "arguments");
  if (homePath) {
    return getNexusProjectStatus({
      homePath,
      homeStore: fileProjectHomeStore(),
      project,
    }).project;
  }

  try {
    return buildNexusProjectStatusForPath(project);
  } catch (pathError) {
    try {
      return getNexusProjectStatus({
        homePath: defaultNexusHomePath(),
        homeStore: fileProjectHomeStore(),
        project,
      }).project;
    } catch {
      throw pathError;
    }
  }
}

function fileProjectHomeStore(): NexusProjectHomeStore<NexusHomeConfigBase> {
  return {
    resolveHomePath: resolveNexusHome,
    loadHomeConfig: (homePath) =>
      loadNexusHomeConfigFile(homePath, validateNexusHomeConfigBase),
    saveHomeConfig: (homePath, registry) =>
      saveNexusHomeConfigFile(homePath, registry, validateNexusHomeConfigBase),
  };
}

function homePathFromArgs(args: Record<string, unknown>): string {
  return optionalString(args, "homePath", "arguments") ?? defaultNexusHomePath();
}

function projectSelectorFromArgs(args: Record<string, unknown>): WorkItemProjectSelector {
  const project = optionalString(args, "project", "arguments");
  const projectRoot = optionalString(args, "projectRoot", "arguments");
  const componentId = optionalString(args, "componentId", "arguments");
  return {
    ...(project ? { project } : {}),
    ...(projectRoot ? { projectRoot } : {}),
    ...(componentId ? { componentId } : {}),
  };
}

function workItemRefFromArgs(args: Record<string, unknown>): WorkItemRef {
  const ref = args.ref;
  if (ref !== undefined && ref !== null) {
    return workItemRefFromRecord(asRecord(ref, "arguments.ref"), "arguments.ref");
  }

  return workItemRefFromRecord(args, "arguments");
}

function workItemRefFromRecord(
  record: Record<string, unknown>,
  pathName: string,
): WorkItemRef {
  const provider = optionalString(record, "provider", pathName);
  const id = optionalString(record, "id", pathName);
  const externalRef = record.externalRef;
  return {
    ...(provider ? { provider } : {}),
    ...(id ? { id } : {}),
    ...(externalRef !== undefined && externalRef !== null
      ? {
          externalRef: externalRefFromRecord(
            asRecord(externalRef, `${pathName}.externalRef`),
            `${pathName}.externalRef`,
          ),
        }
      : {}),
  };
}

function externalRefFromRecord(
  record: Record<string, unknown>,
  pathName: string,
): NonNullable<WorkItemRef["externalRef"]> {
  const itemNumber = optionalPositiveInteger(record, "itemNumber", pathName);
  return {
    provider: requiredString(record, "provider", pathName),
    host: optionalNullableString(record, "host", pathName),
    repositoryId: optionalNullableString(record, "repositoryId", pathName),
    repositoryOwner: optionalNullableString(record, "repositoryOwner", pathName),
    repositoryName: optionalNullableString(record, "repositoryName", pathName),
    projectId: optionalNullableString(record, "projectId", pathName),
    boardId: optionalNullableString(record, "boardId", pathName),
    itemId: requiredString(record, "itemId", pathName),
    itemNumber,
    itemKey: optionalNullableString(record, "itemKey", pathName),
    nodeId: optionalNullableString(record, "nodeId", pathName),
    webUrl: optionalNullableString(record, "webUrl", pathName),
  };
}

function workItemPatchFromArgs(args: Record<string, unknown>): WorkItemPatch {
  const patch: WorkItemPatch = {};
  if (hasOwn(args, "title")) {
    patch.title = requiredString(args, "title", "arguments");
  }
  if (hasOwn(args, "description")) {
    patch.description = optionalNullableString(args, "description", "arguments") ?? null;
  }
  if (hasOwn(args, "status")) {
    patch.status = optionalWorkStatus(args, "status", "arguments");
  }
  if (hasOwn(args, "labels")) {
    patch.labels = optionalStringArray(args, "labels", "arguments") ?? [];
  }
  if (hasOwn(args, "assignees")) {
    patch.assignees = optionalStringArray(args, "assignees", "arguments") ?? [];
  }
  if (hasOwn(args, "milestone")) {
    patch.milestone = optionalNullableString(args, "milestone", "arguments") ?? null;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("arguments must include at least one work item field to update");
  }

  return patch;
}

function parseToolCallParams(value: unknown): { name: string; arguments?: unknown } {
  const params = asRecord(value, "params");
  return {
    name: requiredString(params, "name", "params"),
    arguments: params.arguments,
  };
}

function toolResult(value: unknown, isError = false): DevNexusMcpToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown): unknown {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
): unknown {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

class StdioJsonRpcTransport {
  private buffer = Buffer.alloc(0);
  private processing = false;

  constructor(
    private readonly onMessage: (
      message: JsonRpcRequest,
    ) => Promise<unknown | undefined>,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      process.stdin.on("data", (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        void this.processBuffer().catch((error: unknown) => {
          this.send(
            jsonRpcError(
              undefined,
              -32603,
              error instanceof Error ? error.message : String(error),
            ),
          );
        });
      });
      process.stdin.once("end", resolve);
    });
  }

  private async processBuffer(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (true) {
        const headerEnd = this.headerEndIndex();
        if (!headerEnd) {
          return;
        }

        const [endIndex, separatorLength] = headerEnd;
        const header = this.buffer.slice(0, endIndex).toString("utf8");
        const lengthMatch = /^Content-Length:\s*(\d+)\s*$/imu.exec(header);
        if (!lengthMatch) {
          throw new Error("Missing Content-Length header");
        }

        const contentLength = Number(lengthMatch[1]);
        const messageStart = endIndex + separatorLength;
        const messageEnd = messageStart + contentLength;
        if (this.buffer.length < messageEnd) {
          return;
        }

        const body = this.buffer.slice(messageStart, messageEnd).toString("utf8");
        this.buffer = this.buffer.slice(messageEnd);
        const response = await this.onMessage(JSON.parse(body) as JsonRpcRequest);
        if (response) {
          this.send(response);
        }
      }
    } finally {
      this.processing = false;
      if (this.headerEndIndex()) {
        void this.processBuffer();
      }
    }
  }

  private headerEndIndex(): [number, number] | undefined {
    const crlfIndex = this.buffer.indexOf("\r\n\r\n");
    if (crlfIndex >= 0) {
      return [crlfIndex, 4];
    }

    const lfIndex = this.buffer.indexOf("\n\n");
    return lfIndex >= 0 ? [lfIndex, 2] : undefined;
  }

  private send(message: unknown): void {
    const body = JSON.stringify(message);
    process.stdout.write(
      `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
    );
  }
}

function asRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName}.${key} must be a non-empty string`);
  }

  return value.trim();
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName}.${key} must be a non-empty string or null`);
  }

  return value.trim();
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be an array of strings`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${pathName}.${key}[${index}] must be a non-empty string`);
    }

    return item.trim();
  });
}

function optionalPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${pathName}.${key} must be a positive integer`);
  }

  return value;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = optionalString(record, key, pathName);
  if (!value) {
    throw new Error(`${pathName}.${key} is required`);
  }

  return value;
}

function requiredPlainString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

const workStatuses = new Set<WorkStatus>([
  "todo",
  "ready",
  "in_progress",
  "blocked",
  "done",
  "wont_do",
]);

function parseWorkStatus(value: string, pathName: string): WorkStatus {
  if (!workStatuses.has(value as WorkStatus)) {
    throw new Error(
      `${pathName} must be todo, ready, in_progress, blocked, done, or wont_do`,
    );
  }

  return value as WorkStatus;
}

function optionalWorkStatus(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): WorkStatus | undefined {
  const value = optionalString(record, key, pathName);
  return value === undefined ? undefined : parseWorkStatus(value, `${pathName}.${key}`);
}

function optionalWorkStatusQuery(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): WorkStatus | WorkStatus[] | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return parseWorkStatus(value, `${pathName}.${key}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be a status or array of statuses`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${pathName}.${key}[${index}] must be a status`);
    }

    return parseWorkStatus(item, `${pathName}.${key}[${index}]`);
  });
}

function parseTargetCycleStatus(
  value: string,
  pathName: string,
): NexusAutomationTargetCycleStatus {
  if (
    value === "started" ||
    value === "dispatched" ||
    value === "completed" ||
    value === "blocked" ||
    value === "failed" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${pathName} must be a valid target cycle status`);
}

function optionalNullableNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${pathName}.${key} must be a non-negative integer or null`);
  }

  return value;
}

function optionalTargetCycleWorkItems(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): NexusAutomationTargetCycleWorkItemInput[] | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be an array`);
  }

  return value.map((item, index) =>
    targetCycleWorkItemFromRecord(
      asRecord(item, `${pathName}.${key}[${index}]`),
      `${pathName}.${key}[${index}]`,
    ),
  );
}

function targetCycleWorkItemFromRecord(
  record: Record<string, unknown>,
  pathName: string,
): NexusAutomationTargetCycleWorkItemInput {
  return {
    componentId: optionalNullableString(record, "componentId", pathName) ?? null,
    id: requiredString(record, "id", pathName),
    title: optionalNullableString(record, "title", pathName) ?? null,
    status: nullableWorkStatus(record, "status", pathName),
    cycleStatus: nullableTargetCycleWorkItemStatus(
      record,
      "cycleStatus",
      pathName,
    ),
    agentProfileId:
      optionalNullableString(record, "agentProfileId", pathName) ?? null,
    notes: optionalNullableString(record, "notes", pathName) ?? null,
  };
}

function nullableWorkStatus(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): WorkStatus | null {
  const value = optionalString(record, key, pathName);
  return value === undefined ? null : parseWorkStatus(value, `${pathName}.${key}`);
}

function nullableTargetCycleWorkItemStatus(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): NexusAutomationTargetCycleWorkItemInput["cycleStatus"] {
  const value = optionalString(record, key, pathName);
  if (value === undefined) {
    return null;
  }
  if (
    value === "eligible" ||
    value === "selected" ||
    value === "dispatched" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "blocked" ||
    value === "skipped"
  ) {
    return value;
  }

  throw new Error(`${pathName}.${key} must be a valid target cycle work item status`);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
