import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";
import { NexusDashboardCodexChatError } from "./nexusDashboardCodexChat.js";
import type {
  BuildNexusDashboardHostSnapshotOptions,
} from "./nexusDashboard.js";
import {
  type NexusDashboardServerCache,
  invalidateDashboardCache,
} from "./nexusDashboardServerCache.js";
import {
  NexusDashboardRouteError,
  dashboardErrorBody,
  dashboardErrorStatusCode,
  readJsonBody,
  rejectClientControlledField,
  requireDashboardMutationRequest,
  sendJson,
} from "./nexusDashboardServerHttp.js";
import {
  resolveDashboardWorkspaceSelection,
  workspaceIdFromUrl,
} from "./nexusDashboardServerWorkspace.js";
import {
  applyNexusProjectConfigMutation,
  previewNexusProjectConfigMutation,
  NexusProjectConfigMutationError,
  type NexusProjectComponentEditPatch,
  type NexusProjectConfigMutationIntent,
  type NexusProjectConfigRevision,
} from "../../project/nexusProjectConfigMutation.js";

export async function routeDashboardProjectConfigPreview(
  request: IncomingMessage,
  response: ServerResponse,
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  actionToken: string,
  url: URL,
): Promise<void> {
  try {
    requireDashboardMutationRequest(request, actionToken);
    const body = await readJsonBody(request);
    rejectProjectConfigClientControlledFields(body);
    const selection = await resolveDashboardWorkspaceSelection(
      snapshotOptions,
      workspaceIdFromUrl(url),
    );
    const proposal = previewNexusProjectConfigMutation({
      projectRoot: selection.snapshotOptions.projectRoot,
      intent: requiredProjectConfigMutationIntent(body),
    });

    sendJson(response, { ok: true, proposal });
  } catch (error) {
    sendJson(response, dashboardErrorBody(error), dashboardErrorStatusCode(error));
  }
}

export async function routeDashboardProjectConfigApply(
  request: IncomingMessage,
  response: ServerResponse,
  snapshotOptions: BuildNexusDashboardHostSnapshotOptions,
  actionToken: string,
  dashboardCache: NexusDashboardServerCache,
  url: URL,
): Promise<void> {
  try {
    requireDashboardMutationRequest(request, actionToken);
    const body = await readJsonBody(request);
    rejectProjectConfigClientControlledFields(body);
    const selection = await resolveDashboardWorkspaceSelection(
      snapshotOptions,
      workspaceIdFromUrl(url),
    );
    const result = await applyNexusProjectConfigMutation({
      projectRoot: selection.snapshotOptions.projectRoot,
      expectedRevision: requiredProjectConfigRevision(body),
      intent: requiredProjectConfigMutationIntent(body),
    });
    invalidateDashboardCache(dashboardCache);

    sendJson(response, { ok: true, result });
  } catch (error) {
    const routedError = projectConfigRouteError(error);
    sendJson(
      response,
      dashboardErrorBody(routedError),
      dashboardErrorStatusCode(routedError),
    );
  }
}

function rejectProjectConfigClientControlledFields(value: unknown): void {
  for (const field of [
    "projectRoot",
    "workspaceRoot",
    "path",
    "cwd",
    "projectConfigPath",
    "homePath",
  ]) {
    rejectClientControlledField(value, field);
  }

  const body = requiredRecord(value, "request body");
  if (body.intent !== undefined && body.intent !== null) {
    for (const field of [
      "projectRoot",
      "workspaceRoot",
      "path",
      "cwd",
      "projectConfigPath",
      "homePath",
    ]) {
      rejectClientControlledField(body.intent, field);
    }
  }
}

function requiredProjectConfigMutationIntent(
  value: unknown,
): NexusProjectConfigMutationIntent {
  const body = requiredRecord(value, "request body");
  const intent = requiredRecord(body.intent, "intent");
  switch (intent.kind) {
    case "add_component":
      return {
        kind: "add_component",
        answers: requiredComponentAddAnswers(intent.answers),
      };
    case "edit_component":
      return {
        kind: "edit_component",
        componentId: requiredString(intent.componentId, "intent.componentId"),
        patch: requiredComponentEditPatch(intent.patch),
      };
    case "remove_component":
      return {
        kind: "remove_component",
        componentId: requiredString(intent.componentId, "intent.componentId"),
      };
    default:
      throw new NexusDashboardCodexChatError(
        "intent.kind must be add_component, edit_component, or remove_component",
        400,
      );
  }
}

function requiredComponentAddAnswers(
  value: unknown,
): Extract<NexusProjectConfigMutationIntent, { kind: "add_component" }>["answers"] {
  const answers = requiredRecord(value, "intent.answers");
  if (!Array.isArray(answers.components)) {
    throw new NexusDashboardCodexChatError(
      "intent.answers.components must be an array",
      400,
    );
  }
  return answers as unknown as Extract<
    NexusProjectConfigMutationIntent,
    { kind: "add_component" }
  >["answers"];
}

function requiredProjectConfigRevision(
  value: unknown,
): NexusProjectConfigRevision {
  const body = requiredRecord(value, "request body");
  const revision = requiredRecord(body.expectedRevision, "expectedRevision");
  return {
    configPath: requiredString(revision.configPath, "expectedRevision.configPath"),
    sha256: requiredSha256(revision.sha256, "expectedRevision.sha256"),
    sizeBytes: requiredNonNegativeNumber(
      revision.sizeBytes,
      "expectedRevision.sizeBytes",
    ),
  };
}

function requiredComponentEditPatch(value: unknown): NexusProjectComponentEditPatch {
  const record = requiredRecord(value, "intent.patch");
  const patch: NexusProjectComponentEditPatch = {};
  setOptionalStringPatch(record, patch, "name", false);
  setOptionalStringPatch(record, patch, "remoteUrl", true);
  setOptionalStringPatch(record, patch, "defaultBranch", true);
  setOptionalStringPatch(record, patch, "sourceRoot", true);
  setOptionalStringPatch(record, patch, "worktreesRoot", true);
  setOptionalStringPatch(record, patch, "defaultWorkTrackerId", true);
  if (record.kind !== undefined) {
    if (record.kind !== "local" && record.kind !== "git") {
      throw new NexusDashboardCodexChatError(
        "intent.patch.kind must be local or git",
        400,
      );
    }
    patch.kind = record.kind;
  }
  if (record.role !== undefined) {
    if (
      record.role !== "primary" &&
      record.role !== "extension" &&
      record.role !== "addon" &&
      record.role !== "dependency" &&
      record.role !== "optional"
    ) {
      throw new NexusDashboardCodexChatError(
        "intent.patch.role must be primary, extension, addon, dependency, or optional",
        400,
      );
    }
    patch.role = record.role;
  }

  if (Object.keys(patch).length === 0) {
    throw new NexusDashboardCodexChatError(
      "intent.patch must contain at least one supported field",
      400,
    );
  }

  return patch;
}

function setOptionalStringPatch<Key extends keyof NexusProjectComponentEditPatch>(
  record: Record<string, unknown>,
  patch: NexusProjectComponentEditPatch,
  key: Key,
  nullable: boolean,
): void {
  const value = record[key];
  if (value === undefined) {
    return;
  }
  if (value === null && nullable) {
    patch[key] = null as NexusProjectComponentEditPatch[Key];
    return;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusDashboardCodexChatError(
      `intent.patch.${String(key)} must be a non-empty string${nullable ? " or null" : ""}`,
      400,
    );
  }
  patch[key] = value.trim() as NexusProjectComponentEditPatch[Key];
}

function requiredRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusDashboardCodexChatError(
      `${pathName} must be a JSON object`,
      400,
    );
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusDashboardCodexChatError(
      `${pathName} must be a non-empty string`,
      400,
    );
  }
  return value.trim();
}

function requiredSha256(value: unknown, pathName: string): string {
  const text = requiredString(value, pathName);
  if (!/^[0-9a-f]{64}$/u.test(text)) {
    throw new NexusDashboardCodexChatError(
      `${pathName} must be a sha256 hex digest`,
      400,
    );
  }
  return text;
}

function requiredNonNegativeNumber(value: unknown, pathName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new NexusDashboardCodexChatError(
      `${pathName} must be a non-negative number`,
      400,
    );
  }
  return value;
}

function projectConfigRouteError(error: unknown): unknown {
  if (!(error instanceof NexusProjectConfigMutationError)) {
    return error;
  }
  switch (error.code) {
    case "stale":
      return new NexusDashboardRouteError(
        "project_config_stale",
        error.message,
        409,
      );
    case "blocked":
      return new NexusDashboardRouteError(
        "project_config_blocked",
        error.message,
        409,
      );
    case "invalid":
      return new NexusDashboardRouteError(
        "project_config_invalid",
        error.message,
        400,
      );
  }
}
