import {
  type NexusProviderCredentialCommandRunner,
} from "../providers/nexusProviderCredentialBroker.js";
import {
  inspectNexusPublicationPullRequestForComponent,
  mergeNexusPublicationPullRequestForComponent,
  pushNexusPublicationBranchForComponent,
  upsertNexusPublicationPullRequestForComponent,
  type NexusPublicationBranchPushResult,
  type NexusPublicationPullRequestUpsertResult,
} from "../publication/nexusPublicationOperations.js";
import {
  type NexusPublicationGitPushRunner,
} from "../publication/nexusPublicationPolicy.js";
import type { NexusReviewLocalAuthorization } from "../publication/nexusReviewPolicy.js";
import {
  assertNexusSharedCheckoutMutationAllowed,
  type NexusCheckoutMutationClass,
  type NexusSharedCheckoutGuardOverride,
} from "../worktrees/nexusSharedCheckoutGuard.js";
import type { GitRunner } from "../worktrees/gitWorktreeService.js";

export interface NexusPublicationMcpTool {
  name: NexusPublicationMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface NexusPublicationMcpToolContext {
  gitRunner?: GitRunner;
  publicationFetch?: typeof fetch;
  publicationCredentialCommandRunner?: NexusProviderCredentialCommandRunner;
  publicationGitPushRunner?: NexusPublicationGitPushRunner;
  publicationRemoteProbeRunner?: NexusPublicationGitPushRunner;
  workItemCredentialCommandRunner?: NexusProviderCredentialCommandRunner;
  currentPath?: string;
  sharedCheckoutGuard?: "enforce" | "disabled";
  sharedCheckoutGuardOverride?: NexusSharedCheckoutGuardOverride | null;
}

export const nexusPublicationMcpToolNames = [
  "publication_branch_push",
  "publication_pull_request_upsert",
  "publication_review_handoff",
  "publication_pull_request_evidence",
  "publication_pull_request_merge",
] as const;

export type NexusPublicationMcpToolName =
  typeof nexusPublicationMcpToolNames[number];

export const nexusPublicationMcpTools: NexusPublicationMcpTool[] = [
  {
    name: "publication_branch_push",
    description: "Push a publication branch through configured DevNexus publication policy and credentials.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        projectRepository: { type: "boolean" },
        repositoryPath: { type: "string" },
        branch: { type: "string" },
        targetBranch: { type: ["string", "null"] },
        featureId: { type: ["string", "null"] },
        forceWithLease: { type: "boolean" },
        forceWithLeaseExpectedCommit: { type: ["string", "null"] },
        dryRun: { type: "boolean" },
        localAuthorization: publicationLocalAuthorizationSchema(),
      },
      required: ["projectRoot", "repositoryPath", "branch"],
      additionalProperties: false,
    },
  },
  {
    name: "publication_pull_request_upsert",
    description: "Create or update a pull request through configured DevNexus publication policy and credentials.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        projectRepository: { type: "boolean" },
        repositoryPath: { type: "string" },
        number: { type: "number" },
        head: { type: "string" },
        base: { type: ["string", "null"] },
        title: { type: "string" },
        body: { type: ["string", "null"] },
        draft: { type: "boolean" },
        dryRun: { type: "boolean" },
      },
      required: ["projectRoot", "repositoryPath", "head", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "publication_review_handoff",
    description: "Push a branch and create or update its pull request through configured DevNexus publication policy and credentials.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        projectRepository: { type: "boolean" },
        repositoryPath: { type: "string" },
        branch: { type: "string" },
        base: { type: ["string", "null"] },
        title: { type: "string" },
        body: { type: ["string", "null"] },
        draft: { type: "boolean" },
        featureId: { type: ["string", "null"] },
        forceWithLease: { type: "boolean" },
        forceWithLeaseExpectedCommit: { type: ["string", "null"] },
        dryRun: { type: "boolean" },
      },
      required: ["projectRoot", "repositoryPath", "branch", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "publication_pull_request_evidence",
    description: "Read pull request evidence through configured DevNexus publication credentials.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        projectRepository: { type: "boolean" },
        repositoryPath: { type: "string" },
        number: { type: "number" },
      },
      required: ["projectRoot", "repositoryPath", "number"],
      additionalProperties: false,
    },
  },
  {
    name: "publication_pull_request_merge",
    description: "Merge a pull request through configured DevNexus publication policy, review policy, and credentials.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
        componentId: { type: "string" },
        projectRepository: { type: "boolean" },
        repositoryPath: { type: "string" },
        number: { type: "number" },
        method: { type: "string", enum: ["merge", "squash", "rebase"] },
        branchRole: { type: ["string", "null"] },
        localAuthorization: publicationLocalAuthorizationSchema(),
      },
      required: ["projectRoot", "number"],
      additionalProperties: false,
    },
  },
];

export function isNexusPublicationMcpToolName(
  name: string,
): name is NexusPublicationMcpToolName {
  return (nexusPublicationMcpToolNames as readonly string[]).includes(name);
}

export async function callNexusPublicationMcpTool(
  name: NexusPublicationMcpToolName,
  args: Record<string, unknown>,
  context: NexusPublicationMcpToolContext = {},
): Promise<unknown> {
  switch (name) {
    case "publication_branch_push": {
      assertPublicationMutationAllowed(args, context, {
        command: name,
        mutationClass: "component_source",
      });
      const dryRun = optionalBoolean(args, "dryRun", "arguments") ?? false;
      const result = await pushNexusPublicationBranchForComponent({
        ...publicationTargetArgs(args),
        repositoryPath: requiredString(args, "repositoryPath", "arguments"),
        branch: requiredString(args, "branch", "arguments"),
        targetBranch: optionalNullableString(args, "targetBranch", "arguments"),
        featureId: optionalNullableString(args, "featureId", "arguments"),
        forceWithLease: optionalBoolean(args, "forceWithLease", "arguments"),
        forceWithLeaseExpectedCommit: optionalNullableString(
          args,
          "forceWithLeaseExpectedCommit",
          "arguments",
        ),
        localAuthorization: localAuthorizationFromArgs(args),
        ...publicationOperationRuntime(context),
        gitRunner: dryRun
          ? dryRunPublicationGitPushRunner
          : context.publicationGitPushRunner,
        remoteProbeRunner: context.publicationRemoteProbeRunner,
      });
      return publicationBranchPushPayload(result, dryRun);
    }
    case "publication_pull_request_upsert": {
      assertPublicationMutationAllowed(args, context, {
        command: name,
        mutationClass: "component_source",
      });
      const result = await upsertNexusPublicationPullRequestForComponent({
        ...publicationTargetArgs(args),
        number: optionalPositiveInteger(args, "number", "arguments"),
        head: requiredString(args, "head", "arguments"),
        base: optionalNullableString(args, "base", "arguments"),
        title: requiredString(args, "title", "arguments"),
        body: optionalNullableString(args, "body", "arguments"),
        draft: optionalBoolean(args, "draft", "arguments"),
        dryRun: optionalBoolean(args, "dryRun", "arguments"),
        ...publicationOperationRuntime(context),
      });
      return publicationPullRequestUpsertPayload(result);
    }
    case "publication_review_handoff": {
      assertPublicationMutationAllowed(args, context, {
        command: name,
        mutationClass: "component_source",
      });
      const dryRun = optionalBoolean(args, "dryRun", "arguments") ?? false;
      const branchPush = await pushNexusPublicationBranchForComponent({
        ...publicationTargetArgs(args),
        repositoryPath: requiredString(args, "repositoryPath", "arguments"),
        branch: requiredString(args, "branch", "arguments"),
        featureId: optionalNullableString(args, "featureId", "arguments"),
        forceWithLease: optionalBoolean(args, "forceWithLease", "arguments"),
        forceWithLeaseExpectedCommit: optionalNullableString(
          args,
          "forceWithLeaseExpectedCommit",
          "arguments",
        ),
        ...publicationOperationRuntime(context),
        gitRunner: dryRun
          ? dryRunPublicationGitPushRunner
          : context.publicationGitPushRunner,
        remoteProbeRunner: context.publicationRemoteProbeRunner,
      });
      const branchPushPayload = publicationBranchPushPayload(branchPush, dryRun);
      const pullRequest = branchPushPayload.ok
        ? await upsertNexusPublicationPullRequestForComponent({
            ...publicationTargetArgs(args),
            head: requiredString(args, "branch", "arguments"),
            base: optionalNullableString(args, "base", "arguments"),
            title: requiredString(args, "title", "arguments"),
            body: optionalNullableString(args, "body", "arguments"),
            draft: optionalBoolean(args, "draft", "arguments"),
            dryRun,
            ...publicationOperationRuntime(context),
          })
        : null;
      return {
        ok: branchPushPayload.ok && pullRequest !== null,
        dryRun,
        projectRoot: branchPush.projectRoot,
        componentId: branchPush.componentId,
        target: branchPush.target,
        repository: branchPush.repository,
        branchPush: branchPushPayload,
        pullRequest: pullRequest
          ? publicationPullRequestUpsertPayload(pullRequest)
          : null,
      };
    }
    case "publication_pull_request_evidence":
      return {
        ok: true,
        ...(await inspectNexusPublicationPullRequestForComponent({
          ...publicationTargetArgs(args),
          number: requiredPositiveInteger(args, "number", "arguments"),
          ...publicationOperationRuntime(context),
        })),
      };
    case "publication_pull_request_merge": {
      assertPublicationMutationAllowed(args, context, {
        command: name,
        mutationClass: "component_source",
      });
      const result = await mergeNexusPublicationPullRequestForComponent({
        ...publicationTargetArgs(args),
        number: requiredPositiveInteger(args, "number", "arguments"),
        method: optionalPullRequestMergeMethod(args, "method", "arguments"),
        branchRole: optionalNullableString(args, "branchRole", "arguments"),
        localAuthorization: localAuthorizationFromArgs(args),
        ...publicationOperationRuntime(context),
      });
      return {
        ok: result.merge.merged,
        ...result,
      };
    }
  }
}

function publicationLocalAuthorizationSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      authorized: { type: "boolean" },
      authorizedAt: { type: "string" },
      branchName: { type: "string" },
      headSha: { type: "string" },
      requestedAction: { type: "string" },
      summary: { type: "string" },
    },
    additionalProperties: false,
  };
}

function publicationTargetArgs(args: Record<string, unknown>): {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
} {
  return {
    projectRoot: requiredString(args, "projectRoot", "arguments"),
    componentId: optionalString(args, "componentId", "arguments"),
    projectRepository: optionalBoolean(args, "projectRepository", "arguments"),
  };
}

function publicationOperationRuntime(
  context: NexusPublicationMcpToolContext,
): {
  fetch?: typeof fetch;
  credentialCommandRunner?: NexusProviderCredentialCommandRunner;
} {
  return {
    ...(context.publicationFetch ? { fetch: context.publicationFetch } : {}),
    ...(context.publicationCredentialCommandRunner
      ? { credentialCommandRunner: context.publicationCredentialCommandRunner }
      : context.workItemCredentialCommandRunner
        ? { credentialCommandRunner: context.workItemCredentialCommandRunner }
        : {}),
  };
}

function assertPublicationMutationAllowed(
  args: Record<string, unknown>,
  context: NexusPublicationMcpToolContext,
  options: {
    command: string;
    mutationClass: NexusCheckoutMutationClass;
  },
): void {
  if (context.sharedCheckoutGuard !== "enforce") {
    return;
  }

  assertNexusSharedCheckoutMutationAllowed({
    projectRoot: requiredString(args, "projectRoot", "arguments"),
    command: options.command,
    mutationClass: options.mutationClass,
    targetPath:
      optionalString(args, "repositoryPath", "arguments") ??
      context.currentPath ??
      null,
    componentId: optionalString(args, "componentId", "arguments"),
    gitRunner: context.gitRunner,
    override: context.sharedCheckoutGuardOverride,
  });
}

const dryRunPublicationGitPushRunner: NexusPublicationGitPushRunner = (
  args: readonly string[],
) => ({
  args: [...args],
  stdout: "",
  stderr: "dry-run: git push was not executed",
  exitCode: null,
});

function publicationBranchPushPayload(
  result: NexusPublicationBranchPushResult,
  dryRun: boolean,
) {
  return {
    ok: dryRun || result.push.git.exitCode === 0,
    dryRun,
    projectRoot: result.projectRoot,
    componentId: result.componentId,
    target: result.target,
    repository: result.repository,
    branch: result.branch,
    targetBranch: result.targetBranch,
    featureBranchDelivery: result.featureBranchDelivery,
    warnings: result.warnings,
    forceWithLease: result.forceWithLease,
    forceWithLeaseExpectedCommit: result.forceWithLeaseExpectedCommit,
    reviewEnforcement: result.reviewEnforcement,
    credential: result.credential,
    push: {
      git: result.push.git,
      plan: {
        ...result.push.plan,
        args: result.push.plan.redactedArgs,
        redactedArgs: result.push.plan.redactedArgs,
        environment: result.push.plan.redactedEnvironment,
      },
    },
  };
}

function publicationPullRequestUpsertPayload(
  result: NexusPublicationPullRequestUpsertResult,
) {
  return {
    ok: true,
    dryRun: result.dryRun,
    projectRoot: result.projectRoot,
    componentId: result.componentId,
    target: result.target,
    repository: result.repository,
    credential: result.credential,
    plan: result.plan,
    pullRequest: result.pullRequest,
  };
}

function localAuthorizationFromArgs(
  args: Record<string, unknown>,
): Partial<NexusReviewLocalAuthorization> | null {
  const value = args.localAuthorization;
  if (value === undefined || value === null) {
    return null;
  }
  const record = asRecord(value, "arguments.localAuthorization");
  return {
    authorized: optionalBoolean(record, "authorized", "arguments.localAuthorization") ??
      false,
    authorizedAt:
      optionalString(record, "authorizedAt", "arguments.localAuthorization") ??
      null,
    branchName:
      optionalString(record, "branchName", "arguments.localAuthorization") ?? null,
    headSha:
      optionalString(record, "headSha", "arguments.localAuthorization") ?? null,
    requestedAction:
      optionalString(record, "requestedAction", "arguments.localAuthorization") ??
      null,
    summary: optionalString(record, "summary", "arguments.localAuthorization") ?? null,
  };
}

function optionalPullRequestMergeMethod(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): "merge" | "squash" | "rebase" | undefined {
  const value = optionalString(record, key, pathName);
  if (value === undefined) {
    return undefined;
  }
  if (value === "merge" || value === "squash" || value === "rebase") {
    return value;
  }

  throw new Error(`${pathName}.${key} must be merge, squash, or rebase`);
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

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${pathName}.${key} must be a boolean`);
  }

  return value;
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

function requiredPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number {
  const value = optionalPositiveInteger(record, key, pathName);
  if (value === undefined) {
    throw new Error(`${pathName}.${key} is required`);
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

function asRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}
