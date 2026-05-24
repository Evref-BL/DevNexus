import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildNexusCandidateBranchPlan,
  type NexusCandidateBranchPlan,
} from "../publication/nexusCandidateBranchPlan.js";
import {
  buildNexusGreenMainPublicationPlan,
  type NexusGreenMainCheckRunInput,
  type NexusGreenMainCommandStep,
  type NexusGreenMainPublicationPlan,
} from "../publication/nexusGreenMainPublication.js";
import {
  buildNexusMergeQueueReadinessReport,
  type NexusMergeQueueReadinessReport,
  type NexusMergeQueueWorkflowTriggerInput,
} from "../publication/nexusMergeQueueReadiness.js";
import {
  buildNexusFeatureBranchDeliveryPlan,
  type NexusFeatureBranchDeliveryPlan,
} from "../publication/nexusFeatureBranchDeliveryPlan.js";
import {
  buildNexusFeatureBranchDeliveryReport,
  type NexusFeatureBranchDeliveryReport,
  type NexusFeatureBranchDeliveryReportItem,
} from "../publication/nexusFeatureBranchDeliveryReport.js";
import {
  buildNexusFeatureFinalizationPlan,
  type NexusFeatureFinalizationPlan,
} from "../publication/nexusFeatureFinalizationPlan.js";
import {
  inspectNexusPublicationPullRequestForComponent,
  mergeNexusPublicationPullRequestForComponent,
  NexusPublicationBranchPushBlockedError,
  pushNexusPublicationBranchForComponent,
  upsertNexusPublicationPullRequestForComponent,
  type NexusPublicationBranchPushResult,
  type NexusPublicationPullRequestEvidenceResult,
  type NexusPublicationPullRequestMergeResult,
  type NexusPublicationPullRequestUpsertResult,
} from "../publication/nexusPublicationOperations.js";
import {
  NexusReviewPolicyEnforcementError,
} from "../publication/nexusReviewPolicyEnforcement.js";
import type { NexusPublicationGitPushRunner } from "../publication/nexusPublicationPolicy.js";
import type { NexusReviewLocalAuthorization } from "../publication/nexusReviewPolicy.js";
import {
  classifyNexusPublicationProviderEvidenceChecks,
  normalizeNexusPublicationProviderEvidence,
  type NexusPublicationProviderEvidence,
  type NexusPublicationProviderEvidenceCheckClassification,
} from "../publication/nexusPublicationProviderEvidence.js";
import {
  buildNexusReleaseTrainReadinessReport,
  type NexusReleaseTrainProviderEvidenceInput,
  type NexusReleaseTrainReadinessReport,
} from "../publication/nexusReleaseTrainReadiness.js";
import {
  NexusProviderCredentialBrokerError,
  type NexusProviderCredentialCommandRunner,
} from "../providers/nexusProviderCredentialBroker.js";
import { resolveNexusCommandPath } from "../runtime/nexusCommandPath.js";
import {
  parsePositiveInteger,
  readCliJsonFile,
  writeJson,
  writeLine,
  type TextWriter,
} from "./cliSupport.js";

interface PublicationCliDependencies {
  stdout?: TextWriter;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  credentialCommandRunner?: NexusProviderCredentialCommandRunner;
  publicationGitPushRunner?: NexusPublicationGitPushRunner;
  now?: () => Date | string;
}

interface ParsedPublicationGreenMainPlanCommand {
  projectRoot: string;
  componentId?: string;
  prNumber: number;
  prUrl?: string | null;
  headBranch?: string | null;
  checksFile: string;
  allowRerun?: boolean;
  rerunAttempted?: boolean;
  rerunReason?: string | null;
  json?: boolean;
}

interface ParsedPublicationBranchPushCommand {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  repositoryPath?: string;
  branch: string;
  targetBranch?: string | null;
  featureId?: string | null;
  forceWithLease?: boolean;
  forceWithLeaseExpectedCommit?: string | null;
  authorized?: boolean;
  authorizationTimestamp?: string | null;
  authorizationSummary?: string | null;
  dryRun?: boolean;
  json?: boolean;
}

interface ParsedPublicationPullRequestUpsertCommand {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  number?: number | null;
  head: string;
  base?: string | null;
  title: string;
  body?: string | null;
  bodyFile?: string | null;
  draft?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

interface ParsedPublicationReviewHandoffCommand {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  repositoryPath?: string;
  branch: string;
  base?: string | null;
  title: string;
  body?: string | null;
  bodyFile?: string | null;
  draft?: boolean;
  featureId?: string | null;
  forceWithLease?: boolean;
  forceWithLeaseExpectedCommit?: string | null;
  dryRun?: boolean;
  json?: boolean;
}

interface PublicationPullRequestFailurePayload {
  ok: false;
  dryRun: boolean;
  projectRoot: string;
  componentId: string | null;
  target: NexusPublicationBranchPushResult["target"];
  repository: NexusPublicationBranchPushResult["repository"];
  error: {
    code: "pull_request_credential_unavailable" | "pull_request_upsert_failed";
    message: string;
    credentialCode?: string | null;
    profileId?: string | null;
  };
  setupActions: string[];
}

type PublicationReviewHandoffPullRequestResult =
  | NexusPublicationPullRequestUpsertResult
  | PublicationPullRequestFailurePayload;

interface ParsedPublicationPullRequestMergeCommand {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  number: number;
  method?: "merge" | "squash" | "rebase";
  branchRole?: string | null;
  authorized?: boolean;
  authorizationTimestamp?: string | null;
  authorizationSummary?: string | null;
  json?: boolean;
}

interface ParsedPublicationPullRequestEvidenceCommand {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  number: number;
  json?: boolean;
}

interface ParsedReleaseTrainReadinessCommand {
  projectRoot: string;
  versionId?: string | null;
  evidenceFile?: string;
  fullMatrixBudgetAvailable?: boolean;
  json?: boolean;
}

interface ParsedPublicationCandidatePlanCommand {
  projectRoot: string;
  versionId?: string | null;
  evidenceFile?: string;
  integrationBranchName?: string | null;
  candidateBranchName?: string | null;
  fullMatrixBudgetAvailable?: boolean;
  json?: boolean;
}

interface ParsedPublicationFeaturePlanCommand {
  projectRoot: string;
  componentId?: string;
  featureId?: string | null;
  json?: boolean;
}

interface ParsedPublicationFeatureReportCommand {
  projectRoot: string;
  componentId?: string;
  featureId?: string | null;
  evidenceFile?: string;
  fullMatrixBudgetAvailable?: boolean;
  json?: boolean;
}

interface ParsedPublicationFeatureFinalizationCommand
  extends ParsedPublicationFeatureReportCommand {}

interface ParsedPublicationEvidenceNormalizeCommand {
  evidenceFile: string;
  requiredChecks: string[];
  json?: boolean;
}

interface ParsedPublicationMergeQueueReadinessCommand {
  projectRoot: string;
  componentId?: string;
  mergeQueueEnabled?: boolean | null;
  evidenceFile?: string;
  workflowTriggersFile?: string;
  json?: boolean;
}

type PublicationCliCommandHandler = (
  argv: string[],
  dependencies: PublicationCliDependencies,
) => Promise<number>;

const twoSegmentPublicationCommandFamilies = new Set([
  "pull-request",
  "green-main",
  "evidence",
]);

const publicationCliCommandHandlers: Partial<Record<string, PublicationCliCommandHandler>> = {
  "branch-push": handlePublicationBranchPushCommand,
  "pull-request upsert": handlePublicationPullRequestUpsertCommand,
  "review-handoff": handlePublicationReviewHandoffCommand,
  "pull-request merge": handlePublicationPullRequestMergeCommand,
  "pull-request evidence": handlePublicationPullRequestEvidenceCommand,
  "green-main plan": handlePublicationGreenMainPlanCommand,
  "evidence normalize": handlePublicationEvidenceNormalizeCommand,
  "merge-queue-readiness": handlePublicationMergeQueueReadinessCommand,
  "release-train-readiness": handlePublicationReleaseTrainReadinessCommand,
  "candidate-plan": handlePublicationCandidatePlanCommand,
  "feature-plan": handlePublicationFeaturePlanCommand,
  "feature-report": handlePublicationFeatureReportCommand,
  "feature-finalization": handlePublicationFeatureFinalizationCommand,
};


export async function handlePublicationCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const handler = publicationCliCommandHandlers[publicationCliCommandKey(argv)];
  if (handler) {
    return handler(argv, dependencies);
  }
  throw new Error(
    "publication requires branch-push, pull-request upsert, pull-request merge, review-handoff, green-main plan, evidence normalize, merge-queue-readiness, release-train-readiness, candidate-plan, feature-plan, feature-report, or feature-finalization",
  );
}

async function handlePublicationBranchPushCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationBranchPushCommand(argv);
  const repositoryPath = path.resolve(parsed.repositoryPath ?? process.cwd());
  const projectRepository = inferProjectRepositoryPublicationTarget({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    projectRepository: parsed.projectRepository,
    repositoryPath,
  });
  let result: NexusPublicationBranchPushResult;
  try {
    result = await pushNexusPublicationBranchForComponent({
      projectRoot: parsed.projectRoot,
      componentId: parsed.componentId,
      projectRepository,
      repositoryPath,
      branch: parsed.branch,
      targetBranch: parsed.targetBranch,
      featureId: parsed.featureId,
      forceWithLease: parsed.forceWithLease,
      forceWithLeaseExpectedCommit: parsed.forceWithLeaseExpectedCommit,
      localAuthorization: publicationLocalAuthorization(parsed),
      baseEnv: publicationBaseEnv(dependencies),
      fetch: dependencies.fetch,
      credentialCommandRunner: dependencies.credentialCommandRunner,
      gitRunner: parsed.dryRun
        ? dryRunPublicationGitPushRunner
        : dependencies.publicationGitPushRunner,
      remoteProbeRunner: dependencies.publicationGitPushRunner,
    });
  } catch (error) {
    return handlePublicationBranchPushError(error, parsed, dependencies);
  }
  printPublicationBranchPushResult(result, parsed, publicationStdout(dependencies));
  return result.push.git.exitCode === 0 || parsed.dryRun ? 0 : 1;
}

async function handlePublicationPullRequestUpsertCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationPullRequestUpsertCommand(argv);
  const result = await upsertNexusPublicationPullRequestForComponent({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    projectRepository: parsed.projectRepository,
    number: parsed.number,
    head: parsed.head,
    base: parsed.base,
    title: parsed.title,
    body: publicationPullRequestBody(parsed),
    draft: parsed.draft,
    dryRun: parsed.dryRun,
    baseEnv: publicationBaseEnv(dependencies),
    fetch: dependencies.fetch,
    credentialCommandRunner: dependencies.credentialCommandRunner,
  });
  printPublicationPullRequestUpsertResult(result, parsed, publicationStdout(dependencies));
  return 0;
}

async function handlePublicationReviewHandoffCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationReviewHandoffCommand(argv);
  const repositoryPath = path.resolve(parsed.repositoryPath ?? process.cwd());
  const projectRepository = inferProjectRepositoryPublicationTarget({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    projectRepository: parsed.projectRepository,
    repositoryPath,
  });
  const branchPush = await pushNexusPublicationBranchForComponent({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    projectRepository,
    repositoryPath,
    branch: parsed.branch,
    featureId: parsed.featureId,
    forceWithLease: parsed.forceWithLease,
    forceWithLeaseExpectedCommit: parsed.forceWithLeaseExpectedCommit,
    baseEnv: publicationBaseEnv(dependencies),
    fetch: dependencies.fetch,
    credentialCommandRunner: dependencies.credentialCommandRunner,
    gitRunner: parsed.dryRun
      ? dryRunPublicationGitPushRunner
      : dependencies.publicationGitPushRunner,
    remoteProbeRunner: dependencies.publicationGitPushRunner,
  });
  const branchPushOk = parsed.dryRun || branchPush.push.git.exitCode === 0;
  const pullRequest = branchPushOk
    ? await reviewHandoffPullRequestResult({
        parsed,
        projectRepository,
        branchPush,
        dependencies,
      })
    : null;
  printPublicationReviewHandoffResult(
    { branchPush, pullRequest },
    parsed,
    publicationStdout(dependencies),
  );
  return branchPushOk && pullRequestOk(pullRequest) ? 0 : 1;
}

async function handlePublicationPullRequestMergeCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationPullRequestMergeCommand(argv);
  const result = await mergeNexusPublicationPullRequestForComponent({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    projectRepository: parsed.projectRepository,
    number: parsed.number,
    method: parsed.method,
    branchRole: parsed.branchRole,
    localAuthorization: publicationLocalAuthorization(parsed),
    baseEnv: publicationBaseEnv(dependencies),
    fetch: dependencies.fetch,
    credentialCommandRunner: dependencies.credentialCommandRunner,
  }).catch((error: unknown) => {
    if (parsed.json && error instanceof NexusReviewPolicyEnforcementError) {
      printPublicationReviewPolicyBlockedError(error, false, publicationStdout(dependencies));
      return null;
    }
    throw error;
  });
  if (!result) {
    return 1;
  }
  printPublicationPullRequestMergeResult(result, parsed, publicationStdout(dependencies));
  return result.merge.merged ? 0 : 1;
}

async function handlePublicationPullRequestEvidenceCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationPullRequestEvidenceCommand(argv);
  const result = await inspectNexusPublicationPullRequestForComponent({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    projectRepository: parsed.projectRepository,
    number: parsed.number,
    baseEnv: publicationBaseEnv(dependencies),
    fetch: dependencies.fetch,
    credentialCommandRunner: dependencies.credentialCommandRunner,
  });
  printPublicationPullRequestEvidenceResult(result, parsed, publicationStdout(dependencies));
  return 0;
}

async function handlePublicationGreenMainPlanCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationGreenMainPlanCommand(argv);
  const plan = buildNexusGreenMainPublicationPlan({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    prNumber: parsed.prNumber,
    prUrl: parsed.prUrl,
    headBranch: parsed.headBranch,
    checks: readGreenMainChecksInput(parsed.checksFile),
    rerunPolicy: {
      allowed: parsed.allowRerun ?? false,
      alreadyAttempted: parsed.rerunAttempted ?? false,
      reason: parsed.rerunReason ?? null,
    },
  });
  printPublicationGreenMainPlan(plan, parsed, publicationStdout(dependencies));
  return 0;
}

async function handlePublicationEvidenceNormalizeCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationEvidenceNormalizeCommand(argv);
  const evidence = normalizeNexusPublicationProviderEvidence(
    readReleaseTrainEvidenceInput(parsed.evidenceFile),
  );
  const classifications = parsed.requiredChecks.length > 0
    ? evidence.map((item) =>
        classifyNexusPublicationProviderEvidenceChecks({
          evidence: item,
          requiredChecks: parsed.requiredChecks,
        }),
      )
    : [];
  printPublicationEvidenceNormalizeResult(
    evidence,
    classifications,
    parsed,
    publicationStdout(dependencies),
  );
  return 0;
}

async function handlePublicationMergeQueueReadinessCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationMergeQueueReadinessCommand(argv);
  const report = buildNexusMergeQueueReadinessReport({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    mergeQueueEnabled: parsed.mergeQueueEnabled,
    workflowTriggers: parsed.workflowTriggersFile
      ? readPublicationWorkflowTriggersInput(parsed.workflowTriggersFile)
      : [],
    providerEvidence: parsed.evidenceFile
      ? readReleaseTrainEvidenceInput(parsed.evidenceFile)
      : [],
    now: dependencies.now,
  });
  printPublicationMergeQueueReadinessReport(report, parsed, publicationStdout(dependencies));
  return 0;
}

async function handlePublicationReleaseTrainReadinessCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parseReleaseTrainReadinessCommand(argv);
  const report = buildNexusReleaseTrainReadinessReport({
    projectRoot: parsed.projectRoot,
    versionId: parsed.versionId,
    fullMatrixBudgetAvailable: parsed.fullMatrixBudgetAvailable,
    providerEvidence: parsed.evidenceFile
      ? readReleaseTrainEvidenceInput(parsed.evidenceFile)
      : [],
    now: dependencies.now,
  });
  printReleaseTrainReadinessReport(report, parsed, publicationStdout(dependencies));
  return 0;
}

async function handlePublicationCandidatePlanCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationCandidatePlanCommand(argv);
  const plan = buildNexusCandidateBranchPlan({
    projectRoot: parsed.projectRoot,
    versionId: parsed.versionId,
    integrationBranchName: parsed.integrationBranchName,
    candidateBranchName: parsed.candidateBranchName,
    fullMatrixBudgetAvailable: parsed.fullMatrixBudgetAvailable,
    providerEvidence: parsed.evidenceFile
      ? readReleaseTrainEvidenceInput(parsed.evidenceFile)
      : [],
    now: dependencies.now,
  });
  printPublicationCandidatePlan(plan, parsed, publicationStdout(dependencies));
  return 0;
}

async function handlePublicationFeaturePlanCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationFeaturePlanCommand(argv);
  const plan = buildNexusFeatureBranchDeliveryPlan({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    featureId: parsed.featureId,
  });
  printPublicationFeaturePlan(plan, parsed, publicationStdout(dependencies));
  return 0;
}

async function handlePublicationFeatureReportCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationFeatureReportCommand(argv);
  const report = buildNexusFeatureBranchDeliveryReport({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    featureId: parsed.featureId,
    providerEvidence: parsed.evidenceFile
      ? readReleaseTrainEvidenceInput(parsed.evidenceFile)
      : [],
    fullMatrixBudgetAvailable: parsed.fullMatrixBudgetAvailable,
    now: dependencies.now,
  });
  printPublicationFeatureReport(report, parsed, publicationStdout(dependencies));
  return 0;
}

async function handlePublicationFeatureFinalizationCommand(
  argv: string[],
  dependencies: PublicationCliDependencies,
): Promise<number> {
  const parsed = parsePublicationFeatureFinalizationCommand(argv);
  const plan = buildNexusFeatureFinalizationPlan({
    projectRoot: parsed.projectRoot,
    componentId: parsed.componentId,
    featureId: parsed.featureId,
    providerEvidence: parsed.evidenceFile
      ? readReleaseTrainEvidenceInput(parsed.evidenceFile)
      : [],
    fullMatrixBudgetAvailable: parsed.fullMatrixBudgetAvailable,
    now: dependencies.now,
  });
  printPublicationFeatureFinalizationPlan(plan, parsed, publicationStdout(dependencies));
  return 0;
}

function handlePublicationBranchPushError(
  error: unknown,
  parsed: ParsedPublicationBranchPushCommand,
  dependencies: PublicationCliDependencies,
): number {
  if (parsed.json && error instanceof NexusPublicationBranchPushBlockedError) {
    printPublicationBranchPushBlockedError(error, parsed, publicationStdout(dependencies));
    return 1;
  }
  if (parsed.json && error instanceof NexusReviewPolicyEnforcementError) {
    printPublicationReviewPolicyBlockedError(
      error,
      Boolean(parsed.dryRun),
      publicationStdout(dependencies),
    );
    return 1;
  }
  throw error;
}

function publicationCliCommandKey(argv: string[]): string {
  const family = argv[1] ?? "";
  if (!twoSegmentPublicationCommandFamilies.has(family)) {
    return family;
  }
  return [family, argv[2]].filter(Boolean).join(" ");
}

function publicationStdout(dependencies: PublicationCliDependencies): TextWriter {
  return dependencies.stdout ?? process.stdout;
}

function publicationBaseEnv(dependencies: PublicationCliDependencies): NodeJS.ProcessEnv {
  return dependencies.env ?? process.env;
}


function parsePublicationGreenMainPlanCommand(
  argv: string[],
): ParsedPublicationGreenMainPlanCommand {
  const [, scope, command, projectRoot, ...rest] = argv;
  if (scope !== "green-main" || command !== "plan") {
    throw new Error("publication requires green-main plan");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication green-main plan requires a workspace root");
  }

  const parsed: Partial<ParsedPublicationGreenMainPlanCommand> = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--pr":
        parsed.prNumber = parsePositiveInteger(next(), arg);
        break;
      case "--pr-url":
        parsed.prUrl = next();
        break;
      case "--head":
        parsed.headBranch = next();
        break;
      case "--checks-file":
        parsed.checksFile = next();
        break;
      case "--allow-rerun":
        parsed.allowRerun = true;
        break;
      case "--rerun-attempted":
        parsed.rerunAttempted = true;
        break;
      case "--rerun-reason":
        parsed.rerunReason = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication green-main plan option: ${arg}`);
    }
  }
  if (!parsed.prNumber) {
    throw new Error("publication green-main plan requires --pr");
  }
  if (!parsed.checksFile) {
    throw new Error("publication green-main plan requires --checks-file");
  }

  return parsed as ParsedPublicationGreenMainPlanCommand;
}

function parsePublicationBranchPushCommand(
  argv: string[],
): ParsedPublicationBranchPushCommand {
  const [, command, projectRoot, ...rest] = argv;
  if (command !== "branch-push") {
    throw new Error("publication requires branch-push");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication branch-push requires a workspace root");
  }

  const parsed: Partial<ParsedPublicationBranchPushCommand> = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--project-repository":
        parsed.projectRepository = true;
        break;
      case "--repository-path":
        parsed.repositoryPath = next();
        break;
      case "--branch":
        parsed.branch = next();
        break;
      case "--target-branch":
        parsed.targetBranch = next();
        break;
      case "--feature":
        parsed.featureId = next();
        break;
      case "--force-with-lease":
        parsed.forceWithLease = true;
        break;
      case "--force-with-lease-expected":
        parsed.forceWithLease = true;
        parsed.forceWithLeaseExpectedCommit = next();
        break;
      case "--authorized":
        parsed.authorized = true;
        break;
      case "--authorization-timestamp":
        parsed.authorizationTimestamp = next();
        break;
      case "--authorization-summary":
        parsed.authorizationSummary = next();
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication branch-push option: ${arg}`);
    }
  }
  if (!parsed.branch) {
    throw new Error("publication branch-push requires --branch");
  }
  assertSinglePublicationTarget(parsed.componentId, parsed.projectRepository);

  return parsed as ParsedPublicationBranchPushCommand;
}

function parsePublicationPullRequestUpsertCommand(
  argv: string[],
): ParsedPublicationPullRequestUpsertCommand {
  const [, scope, command, projectRoot, ...rest] = argv;
  if (scope !== "pull-request" || command !== "upsert") {
    throw new Error("publication requires pull-request upsert");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication pull-request upsert requires a workspace root");
  }

  const parsed: Partial<ParsedPublicationPullRequestUpsertCommand> = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--project-repository":
        parsed.projectRepository = true;
        break;
      case "--number":
        parsed.number = parsePositiveInteger(next(), arg);
        break;
      case "--head":
        parsed.head = next();
        break;
      case "--base":
        parsed.base = next();
        break;
      case "--title":
        parsed.title = next();
        break;
      case "--body":
        parsed.body = next();
        break;
      case "--body-file":
        parsed.bodyFile = next();
        break;
      case "--draft":
        parsed.draft = true;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication pull-request upsert option: ${arg}`);
    }
  }
  if (!parsed.head) {
    throw new Error("publication pull-request upsert requires --head");
  }
  if (!parsed.title) {
    throw new Error("publication pull-request upsert requires --title");
  }
  if (parsed.body !== undefined && parsed.bodyFile) {
    throw new Error("publication pull-request upsert accepts --body or --body-file, not both");
  }
  assertSinglePublicationTarget(parsed.componentId, parsed.projectRepository);

  return parsed as ParsedPublicationPullRequestUpsertCommand;
}

function parsePublicationReviewHandoffCommand(
  argv: string[],
): ParsedPublicationReviewHandoffCommand {
  const [, command, projectRoot, ...rest] = argv;
  if (command !== "review-handoff") {
    throw new Error("publication requires review-handoff");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication review-handoff requires a workspace root");
  }

  const parsed: Partial<ParsedPublicationReviewHandoffCommand> = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--project-repository":
        parsed.projectRepository = true;
        break;
      case "--repository-path":
        parsed.repositoryPath = next();
        break;
      case "--branch":
        parsed.branch = next();
        break;
      case "--base":
        parsed.base = next();
        break;
      case "--title":
        parsed.title = next();
        break;
      case "--body":
        parsed.body = next();
        break;
      case "--body-file":
        parsed.bodyFile = next();
        break;
      case "--draft":
        parsed.draft = true;
        break;
      case "--feature":
        parsed.featureId = next();
        break;
      case "--force-with-lease":
        parsed.forceWithLease = true;
        break;
      case "--force-with-lease-expected":
        parsed.forceWithLease = true;
        parsed.forceWithLeaseExpectedCommit = next();
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication review-handoff option: ${arg}`);
    }
  }
  if (!parsed.branch) {
    throw new Error("publication review-handoff requires --branch");
  }
  if (!parsed.title) {
    throw new Error("publication review-handoff requires --title");
  }
  if (parsed.body !== undefined && parsed.bodyFile) {
    throw new Error("publication review-handoff accepts --body or --body-file, not both");
  }
  assertSinglePublicationTarget(parsed.componentId, parsed.projectRepository);

  return parsed as ParsedPublicationReviewHandoffCommand;
}

function parsePublicationPullRequestMergeCommand(
  argv: string[],
): ParsedPublicationPullRequestMergeCommand {
  const [, scope, command, projectRoot, ...rest] = argv;
  if (scope !== "pull-request" || command !== "merge") {
    throw new Error("publication requires pull-request merge");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication pull-request merge requires a workspace root");
  }

  const parsed: Partial<ParsedPublicationPullRequestMergeCommand> = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--project-repository":
        parsed.projectRepository = true;
        break;
      case "--number":
        parsed.number = parsePositiveInteger(next(), arg);
        break;
      case "--method":
        parsed.method = parsePublicationPullRequestMergeMethod(next(), arg);
        break;
      case "--branch-role":
        parsed.branchRole = next();
        break;
      case "--authorized":
        parsed.authorized = true;
        break;
      case "--authorization-timestamp":
        parsed.authorizationTimestamp = next();
        break;
      case "--authorization-summary":
        parsed.authorizationSummary = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication pull-request merge option: ${arg}`);
    }
  }
  if (!parsed.number) {
    throw new Error("publication pull-request merge requires --number");
  }
  assertSinglePublicationTarget(parsed.componentId, parsed.projectRepository);

  return parsed as ParsedPublicationPullRequestMergeCommand;
}

function parsePublicationPullRequestEvidenceCommand(
  argv: string[],
): ParsedPublicationPullRequestEvidenceCommand {
  const [, scope, command, projectRoot, ...rest] = argv;
  if (scope !== "pull-request" || command !== "evidence") {
    throw new Error("publication requires pull-request evidence");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication pull-request evidence requires a workspace root");
  }

  const parsed: Partial<ParsedPublicationPullRequestEvidenceCommand> = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--project-repository":
        parsed.projectRepository = true;
        break;
      case "--number":
        parsed.number = parsePositiveInteger(next(), arg);
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication pull-request evidence option: ${arg}`);
    }
  }
  if (!parsed.number) {
    throw new Error("publication pull-request evidence requires --number");
  }
  assertSinglePublicationTarget(parsed.componentId, parsed.projectRepository);

  return parsed as ParsedPublicationPullRequestEvidenceCommand;
}

function assertSinglePublicationTarget(
  componentId: string | undefined,
  projectRepository: boolean | undefined,
): void {
  if (componentId && projectRepository) {
    throw new Error("publication accepts --component or --project-repository, not both");
  }
}

function inferProjectRepositoryPublicationTarget(options: {
  projectRoot: string;
  componentId?: string;
  projectRepository?: boolean;
  repositoryPath: string;
}): boolean | undefined {
  if (options.projectRepository || options.componentId) {
    return options.projectRepository;
  }

  return sameGitRepository(options.projectRoot, options.repositoryPath)
    ? true
    : undefined;
}

function sameGitRepository(leftPath: string, rightPath: string): boolean {
  const left = gitCommonDirectory(leftPath);
  const right = gitCommonDirectory(rightPath);
  return Boolean(left && right && left === right);
}

function gitCommonDirectory(repositoryPath: string): string | null {
  const result = spawnSync(
    resolveNexusCommandPath("git"),
    ["rev-parse", "--git-common-dir"],
    {
      cwd: repositoryPath,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim();
  if (!value) {
    return null;
  }

  return realPath(path.resolve(repositoryPath, value));
}

function realPath(filePath: string): string {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function parsePublicationPullRequestMergeMethod(
  value: string,
  optionName: string,
): "merge" | "squash" | "rebase" {
  if (value === "merge" || value === "squash" || value === "rebase") {
    return value;
  }

  throw new Error(`${optionName} must be merge, squash, or rebase`);
}

function parseReleaseTrainReadinessCommand(
  argv: string[],
): ParsedReleaseTrainReadinessCommand {
  const [, command, projectRoot, ...rest] = argv;
  if (command !== "release-train-readiness") {
    throw new Error("publication requires release-train-readiness");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("release-train-readiness requires a workspace root");
  }

  const parsed: ParsedReleaseTrainReadinessCommand = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--version":
        parsed.versionId = next();
        break;
      case "--evidence-file":
        parsed.evidenceFile = next();
        break;
      case "--full-matrix-budget-available":
        parsed.fullMatrixBudgetAvailable = true;
        break;
      case "--full-matrix-budget-exhausted":
        parsed.fullMatrixBudgetAvailable = false;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown release-train-readiness option: ${arg}`);
    }
  }

  return parsed;
}

function parsePublicationEvidenceNormalizeCommand(
  argv: string[],
): ParsedPublicationEvidenceNormalizeCommand {
  const [, scope, command, evidenceFile, ...rest] = argv;
  if (scope !== "evidence" || command !== "normalize") {
    throw new Error("publication requires evidence normalize");
  }
  if (!evidenceFile || evidenceFile.startsWith("--")) {
    throw new Error("publication evidence normalize requires an evidence file");
  }

  const parsed: ParsedPublicationEvidenceNormalizeCommand = {
    evidenceFile,
    requiredChecks: [],
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--required-check":
        parsed.requiredChecks.push(next());
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication evidence normalize option: ${arg}`);
    }
  }

  return parsed;
}

function parsePublicationMergeQueueReadinessCommand(
  argv: string[],
): ParsedPublicationMergeQueueReadinessCommand {
  const [, command, projectRoot, ...rest] = argv;
  if (command !== "merge-queue-readiness") {
    throw new Error("publication requires merge-queue-readiness");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication merge-queue-readiness requires a workspace root");
  }

  const parsed: ParsedPublicationMergeQueueReadinessCommand = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--merge-queue-enabled":
        parsed.mergeQueueEnabled = true;
        break;
      case "--merge-queue-disabled":
        parsed.mergeQueueEnabled = false;
        break;
      case "--evidence-file":
        parsed.evidenceFile = next();
        break;
      case "--workflow-triggers-file":
        parsed.workflowTriggersFile = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication merge-queue-readiness option: ${arg}`);
    }
  }

  return parsed;
}

function parsePublicationCandidatePlanCommand(
  argv: string[],
): ParsedPublicationCandidatePlanCommand {
  const [, command, projectRoot, ...rest] = argv;
  if (command !== "candidate-plan") {
    throw new Error("publication requires candidate-plan");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication candidate-plan requires a workspace root");
  }

  const parsed: ParsedPublicationCandidatePlanCommand = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--version":
        parsed.versionId = next();
        break;
      case "--evidence-file":
        parsed.evidenceFile = next();
        break;
      case "--integration-branch":
        parsed.integrationBranchName = next();
        break;
      case "--candidate-branch":
        parsed.candidateBranchName = next();
        break;
      case "--full-matrix-budget-available":
        parsed.fullMatrixBudgetAvailable = true;
        break;
      case "--full-matrix-budget-exhausted":
        parsed.fullMatrixBudgetAvailable = false;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication candidate-plan option: ${arg}`);
    }
  }

  return parsed;
}

function parsePublicationFeaturePlanCommand(
  argv: string[],
): ParsedPublicationFeaturePlanCommand {
  const [, command, projectRoot, ...rest] = argv;
  if (command !== "feature-plan") {
    throw new Error("publication requires feature-plan");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication feature-plan requires a workspace root");
  }

  const parsed: ParsedPublicationFeaturePlanCommand = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--feature":
        parsed.featureId = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication feature-plan option: ${arg}`);
    }
  }

  return parsed;
}

function parsePublicationFeatureReportCommand(
  argv: string[],
): ParsedPublicationFeatureReportCommand {
  const [, command, projectRoot, ...rest] = argv;
  if (command !== "feature-report") {
    throw new Error("publication requires feature-report");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication feature-report requires a workspace root");
  }

  const parsed: ParsedPublicationFeatureReportCommand = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--feature":
        parsed.featureId = next();
        break;
      case "--evidence-file":
        parsed.evidenceFile = next();
        break;
      case "--full-matrix-budget-available":
        parsed.fullMatrixBudgetAvailable = true;
        break;
      case "--full-matrix-budget-exhausted":
        parsed.fullMatrixBudgetAvailable = false;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication feature-report option: ${arg}`);
    }
  }

  return parsed;
}

function parsePublicationFeatureFinalizationCommand(
  argv: string[],
): ParsedPublicationFeatureFinalizationCommand {
  const [, command, projectRoot, ...rest] = argv;
  if (command !== "feature-finalization") {
    throw new Error("publication requires feature-finalization");
  }
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("publication feature-finalization requires a workspace root");
  }

  const parsed: ParsedPublicationFeatureFinalizationCommand = {
    projectRoot,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }
      return rest[index]!;
    };

    switch (arg) {
      case "--component":
        parsed.componentId = next();
        break;
      case "--feature":
        parsed.featureId = next();
        break;
      case "--evidence-file":
        parsed.evidenceFile = next();
        break;
      case "--full-matrix-budget-available":
        parsed.fullMatrixBudgetAvailable = true;
        break;
      case "--full-matrix-budget-exhausted":
        parsed.fullMatrixBudgetAvailable = false;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown publication feature-finalization option: ${arg}`);
    }
  }

  return parsed;
}

function readGreenMainChecksInput(
  inputPath: string,
): NexusGreenMainCheckRunInput[] {
  const raw = readCliJsonFile(
    inputPath,
    "publication green-main checks",
  ) as unknown;
  if (Array.isArray(raw)) {
    return raw as NexusGreenMainCheckRunInput[];
  }
  if (
    raw !== null &&
    typeof raw === "object" &&
    Array.isArray((raw as { checks?: unknown }).checks)
  ) {
    return (raw as { checks: NexusGreenMainCheckRunInput[] }).checks;
  }

  throw new Error(
    "publication green-main checks file must be an array or an object with checks",
  );
}

const dryRunPublicationGitPushRunner: NexusPublicationGitPushRunner = (
  args: readonly string[],
) => ({
  args: [...args],
  stdout: "",
  stderr: "dry-run: git push was not executed",
  exitCode: null,
});

function publicationPullRequestBody(
  parsed: Pick<ParsedPublicationPullRequestUpsertCommand, "body" | "bodyFile">,
): string | null | undefined {
  if (parsed.body !== undefined) {
    if (parsed.body === null) {
      return null;
    }
    return normalizeInlinePullRequestBody(parsed.body);
  }
  if (parsed.bodyFile) {
    return fs.readFileSync(path.resolve(parsed.bodyFile), "utf8");
  }
  return undefined;
}

function normalizeInlinePullRequestBody(body: string): string {
  const escapedLineBreak = `${String.fromCharCode(92)}n`;
  return body.includes(escapedLineBreak)
    ? body.replaceAll(escapedLineBreak, String.fromCharCode(10))
    : body;
}

function publicationLocalAuthorization(
  parsed: {
    authorized?: boolean;
    authorizationTimestamp?: string | null;
    authorizationSummary?: string | null;
  },
): Partial<NexusReviewLocalAuthorization> | null {
  if (!parsed.authorized) {
    return null;
  }
  return {
    authorized: true,
    authorizedAt: parsed.authorizationTimestamp ?? null,
    summary: parsed.authorizationSummary ?? null,
  };
}

function readReleaseTrainEvidenceInput(
  inputPath: string,
): NexusReleaseTrainProviderEvidenceInput[] {
  const raw = readCliJsonFile(inputPath, "release train readiness evidence");
  if (Array.isArray(raw)) {
    return raw as NexusReleaseTrainProviderEvidenceInput[];
  }
  if (raw !== null && typeof raw === "object") {
    const record = raw as {
      evidence?: unknown;
      providerEvidence?: unknown;
    };
    if (Array.isArray(record.evidence)) {
      return record.evidence as NexusReleaseTrainProviderEvidenceInput[];
    }
    if (Array.isArray(record.providerEvidence)) {
      return record.providerEvidence as NexusReleaseTrainProviderEvidenceInput[];
    }
  }

  throw new Error(
    "release train readiness evidence file must be an array, {\"evidence\": [...]}, or {\"providerEvidence\": [...]}",
  );
}

function readPublicationWorkflowTriggersInput(
  inputPath: string,
): NexusMergeQueueWorkflowTriggerInput[] {
  const raw = readCliJsonFile(inputPath, "publication workflow triggers");
  if (Array.isArray(raw)) {
    return raw as NexusMergeQueueWorkflowTriggerInput[];
  }
  if (raw !== null && typeof raw === "object") {
    const record = raw as {
      workflowTriggers?: unknown;
      workflows?: unknown;
    };
    if (Array.isArray(record.workflowTriggers)) {
      return record.workflowTriggers as NexusMergeQueueWorkflowTriggerInput[];
    }
    if (Array.isArray(record.workflows)) {
      return record.workflows as NexusMergeQueueWorkflowTriggerInput[];
    }
  }

  throw new Error(
    "publication workflow triggers file must be an array, {\"workflowTriggers\": [...]}, or {\"workflows\": [...]}",
  );
}


function printPublicationGreenMainPlan(
  plan: NexusGreenMainPublicationPlan,
  parsed: ParsedPublicationGreenMainPlanCommand,
  stdout: TextWriter,
): void {
  const payload = { ok: true, ...plan };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus green-main publication plan.");
  printGreenMainPlanSummary(plan, stdout);
  printGreenMainWarnings(plan.warnings, stdout);
  printGreenMainRequiredChecks(plan.requiredChecks, stdout);
  printGreenMainFailedJobs(plan.failedJobs, stdout);
  printGreenMainCommands(plan.commands, stdout);
}

function printGreenMainPlanSummary(
  plan: NexusGreenMainPublicationPlan,
  stdout: TextWriter,
): void {
  writeLine(
    stdout,
    `  Pull request: ${plan.pullRequest.repository}#${plan.pullRequest.number}`,
  );
  writeLine(stdout, `  Component: ${plan.component.id}`);
  writeLine(stdout, `  Status: ${plan.status}`);
  writeLine(
    stdout,
    `  Merge: ${plan.merge.allowed ? "allowed" : "blocked"} - ${plan.merge.reason}`,
  );
  writeLine(
    stdout,
    `  Rerun: ${plan.rerun.decision}${plan.rerun.reason ? ` - ${plan.rerun.reason}` : ""}`,
  );
}

function printGreenMainWarnings(
  warnings: readonly string[],
  stdout: TextWriter,
): void {
  for (const warning of warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
}

function printGreenMainRequiredChecks(
  checks: NexusGreenMainPublicationPlan["requiredChecks"],
  stdout: TextWriter,
): void {
  writeLine(stdout, "  Required checks:");
  for (const check of checks) {
    writeLine(stdout, `    ${check.name}: ${check.status}`);
  }
}

function printGreenMainFailedJobs(
  jobs: NexusGreenMainPublicationPlan["failedJobs"],
  stdout: TextWriter,
): void {
  if (jobs.length === 0) {
    return;
  }
  writeLine(stdout, "  Failed jobs:");
  for (const job of jobs) {
    printGreenMainFailedJob(job, stdout);
  }
}

function printGreenMainFailedJob(
  job: NexusGreenMainPublicationPlan["failedJobs"][number],
  stdout: TextWriter,
): void {
  const details = [
    job.platform ? `platform=${job.platform}` : null,
    job.workflow ? `workflow=${job.workflow}` : null,
    job.url ? `url=${job.url}` : null,
  ].filter((item): item is string => item !== null);
  writeLine(
    stdout,
    `    ${job.name}: ${job.classification}${details.length > 0 ? ` ${details.join(" ")}` : ""}`,
  );
  printOptionalGreenMainFailedJobLine(stdout, "Step", job.failingStep);
  printOptionalGreenMainFailedJobLine(stdout, "Test", job.failingTest);
  printOptionalGreenMainFailedJobLine(stdout, "Message", job.message);
}

function printOptionalGreenMainFailedJobLine(
  stdout: TextWriter,
  label: string,
  value: string | null | undefined,
): void {
  if (value) {
    writeLine(stdout, `      ${label}: ${value}`);
  }
}

function printGreenMainCommands(
  commands: NexusGreenMainPublicationPlan["commands"],
  stdout: TextWriter,
): void {
  writeLine(stdout, "  Commands:");
  for (const step of Object.values(commands)) {
    writeLine(stdout, `    ${step.title}: ${formatGreenMainStep(step)}`);
  }
}

function printPublicationBranchPushResult(
  result: NexusPublicationBranchPushResult,
  parsed: ParsedPublicationBranchPushCommand,
  stdout: TextWriter,
): void {
  const payload = publicationBranchPushPayload(result, Boolean(parsed.dryRun));
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(
    stdout,
    `DevNexus publication branch ${parsed.dryRun ? "push dry-run" : "pushed"}.`,
  );
  writeLine(stdout, `  Target: ${formatPublicationTarget(result.target)}`);
  writeLine(stdout, `  Repository: ${result.repository.owner}/${result.repository.name}`);
  writeLine(stdout, `  Branch: ${result.branch}`);
  if (result.featureBranchDelivery) {
    writeLine(stdout, `  Feature: ${result.featureBranchDelivery.featureId}`);
    writeLine(
      stdout,
      `  Feature remote policy: ${result.featureBranchDelivery.branchPublication.strategy} -> ${result.featureBranchDelivery.branchPublication.selectedRemote}`,
    );
    writeLine(
      stdout,
      `  Feature remote selection: ${result.featureBranchDelivery.remoteSelection.status}`,
    );
  }
  if (result.targetBranch) {
    writeLine(stdout, `  Target branch: ${result.targetBranch}`);
  }
  writeLine(stdout, `  Credential: ${result.credential.profileId} (${result.credential.kind})`);
  writeLine(stdout, `  Transport: ${result.push.plan.transport}`);
  writeLine(stdout, `  Refspec: ${result.push.plan.refspec}`);
  for (const warning of result.warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
  if (result.forceWithLease) {
    writeLine(stdout, "  Force with lease: true");
  }
  if (result.forceWithLeaseExpectedCommit) {
    writeLine(stdout, `  Expected remote commit: ${result.forceWithLeaseExpectedCommit}`);
  }
  writeLine(stdout, `  Exit code: ${result.push.git.exitCode ?? "not-run"}`);
  if (result.push.git.stderr.trim()) {
    writeLine(stdout, `  Git: ${result.push.git.stderr.trim()}`);
  }
}

function printPublicationBranchPushBlockedError(
  error: NexusPublicationBranchPushBlockedError,
  parsed: ParsedPublicationBranchPushCommand,
  stdout: TextWriter,
): void {
  writeJson(stdout, {
    ok: false,
    dryRun: Boolean(parsed.dryRun),
    error: {
      code: "feature_branch_publication_blocked",
      message: error.message,
    },
    featureBranchDelivery: error.featureBranchDelivery,
  });
}

function printPublicationReviewPolicyBlockedError(
  error: NexusReviewPolicyEnforcementError,
  dryRun: boolean,
  stdout: TextWriter,
): void {
  writeJson(stdout, {
    ok: false,
    dryRun,
    error: {
      code: "review_policy_blocked",
      message: error.message,
    },
    reviewEnforcement: error.decision,
    reviewPlan: error.reviewPlan,
  });
}

function printPublicationPullRequestUpsertResult(
  result: NexusPublicationPullRequestUpsertResult,
  parsed: ParsedPublicationPullRequestUpsertCommand,
  stdout: TextWriter,
): void {
  const payload = publicationPullRequestUpsertPayload(result);
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(
    stdout,
    `DevNexus publication pull request ${result.dryRun ? "upsert dry-run" : "upserted"}.`,
  );
  writeLine(stdout, `  Target: ${formatPublicationTarget(result.target)}`);
  writeLine(stdout, `  Repository: ${result.repository.owner}/${result.repository.name}`);
  if (result.pullRequest) {
    writeLine(stdout, `  Pull request: #${result.pullRequest.number}`);
    if (result.pullRequest.url) {
      writeLine(stdout, `  URL: ${result.pullRequest.url}`);
    }
  }
  writeLine(stdout, `  Operation: ${result.plan.operation}`);
  writeLine(stdout, `  Head: ${result.plan.head}`);
  writeLine(stdout, `  Base: ${result.plan.base}`);
  writeLine(stdout, `  Credential: ${result.credential.profileId} (${result.credential.kind})`);
  writeLine(stdout, `  Backend: ${result.pullRequest?.metadata.backend ?? result.plan.backend}`);
}

async function reviewHandoffPullRequestResult(options: {
  parsed: ParsedPublicationReviewHandoffCommand;
  projectRepository: boolean | undefined;
  branchPush: NexusPublicationBranchPushResult;
  dependencies: PublicationCliDependencies;
}): Promise<PublicationReviewHandoffPullRequestResult> {
  try {
    return await upsertNexusPublicationPullRequestForComponent({
      projectRoot: options.parsed.projectRoot,
      componentId: options.parsed.componentId,
      projectRepository: options.projectRepository,
      head: options.parsed.branch,
      base: options.parsed.base,
      title: options.parsed.title,
      body: publicationPullRequestBody(options.parsed),
      draft: options.parsed.draft,
      dryRun: options.parsed.dryRun,
      baseEnv: options.dependencies.env ?? process.env,
      fetch: options.dependencies.fetch,
      credentialCommandRunner: options.dependencies.credentialCommandRunner,
    });
  } catch (error) {
    return publicationPullRequestFailurePayload({
      error,
      branchPush: options.branchPush,
      dryRun: Boolean(options.parsed.dryRun),
    });
  }
}

function publicationPullRequestFailurePayload(options: {
  error: unknown;
  branchPush: NexusPublicationBranchPushResult;
  dryRun: boolean;
}): PublicationPullRequestFailurePayload {
  const credentialError =
    options.error instanceof NexusProviderCredentialBrokerError
      ? options.error
      : null;
  const profileId =
    credentialError?.profileId ??
    options.branchPush.credential.profileId ??
    null;
  const message = options.error instanceof Error
    ? options.error.message
    : String(options.error);
  const code = credentialError
    ? "pull_request_credential_unavailable"
    : "pull_request_upsert_failed";

  return {
    ok: false,
    dryRun: options.dryRun,
    projectRoot: options.branchPush.projectRoot,
    componentId: options.branchPush.componentId,
    target: options.branchPush.target,
    repository: options.branchPush.repository,
    error: {
      code,
      message,
      ...(credentialError ? { credentialCode: credentialError.code } : {}),
      ...(profileId ? { profileId } : {}),
    },
    setupActions: publicationPullRequestSetupActions({
      branchPush: options.branchPush,
      credentialError,
      profileId,
    }),
  };
}

function publicationPullRequestSetupActions(options: {
  branchPush: NexusPublicationBranchPushResult;
  credentialError: NexusProviderCredentialBrokerError | null;
  profileId: string | null;
}): string[] {
  const repository = `${options.branchPush.repository.owner}/${options.branchPush.repository.name}`;
  if (!options.credentialError) {
    return [
      `Fix the pull request provider error for ${repository}, then rerun publication review-handoff.`,
    ];
  }

  const profile = options.profileId ?? "the selected publication auth profile";
  return [
    `Update host-local auth profile ${profile} so it can create or update pull requests for ${repository}.`,
    `Add an API-capable credential for pull request API operations, or run review handoff with a publication actor/auth profile that has pull_requests:write on ${repository}.`,
  ];
}

function pullRequestOk(
  pullRequest: PublicationReviewHandoffPullRequestResult | null,
): pullRequest is NexusPublicationPullRequestUpsertResult {
  return Boolean(pullRequest && !("ok" in pullRequest && pullRequest.ok === false));
}

function printPublicationReviewHandoffResult(
  result: {
    branchPush: NexusPublicationBranchPushResult;
    pullRequest: PublicationReviewHandoffPullRequestResult | null;
  },
  parsed: ParsedPublicationReviewHandoffCommand,
  stdout: TextWriter,
): void {
  const branchPushPayload = publicationBranchPushPayload(
    result.branchPush,
    Boolean(parsed.dryRun),
  );
  const payload = {
    ok: branchPushPayload.ok && pullRequestOk(result.pullRequest),
    dryRun: Boolean(parsed.dryRun),
    projectRoot: result.branchPush.projectRoot,
    componentId: result.branchPush.componentId,
    target: result.branchPush.target,
    repository: result.branchPush.repository,
    branchPush: branchPushPayload,
    pullRequest: result.pullRequest
      ? publicationReviewHandoffPullRequestPayload(result.pullRequest)
      : null,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(
    stdout,
    `DevNexus publication review handoff ${parsed.dryRun ? "dry-run" : "completed"}.`,
  );
  writeLine(stdout, `  Target: ${formatPublicationTarget(result.branchPush.target)}`);
  writeLine(stdout, `  Repository: ${result.branchPush.repository.owner}/${result.branchPush.repository.name}`);
  writeLine(stdout, `  Branch: ${result.branchPush.branch}`);
  writeLine(stdout, `  Branch credential: ${result.branchPush.credential.profileId} (${result.branchPush.credential.kind})`);
  if (result.pullRequest && pullRequestOk(result.pullRequest)) {
    writeLine(stdout, `  Pull request credential: ${result.pullRequest.credential.profileId} (${result.pullRequest.credential.kind})`);
    if (result.pullRequest.pullRequest) {
      writeLine(stdout, `  Pull request: #${result.pullRequest.pullRequest.number}`);
      if (result.pullRequest.pullRequest.url) {
        writeLine(stdout, `  URL: ${result.pullRequest.pullRequest.url}`);
      }
    }
  }
  if (result.pullRequest && !pullRequestOk(result.pullRequest)) {
    writeLine(stdout, `  Pull request blocked: ${result.pullRequest.error.message}`);
    for (const setupAction of result.pullRequest.setupActions) {
      writeLine(stdout, `  Setup action: ${setupAction}`);
    }
  }
}

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

function publicationReviewHandoffPullRequestPayload(
  result: PublicationReviewHandoffPullRequestResult,
) {
  return pullRequestOk(result)
    ? publicationPullRequestUpsertPayload(result)
    : result;
}

function printPublicationPullRequestMergeResult(
  result: NexusPublicationPullRequestMergeResult,
  parsed: ParsedPublicationPullRequestMergeCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: result.merge.merged,
    projectRoot: result.projectRoot,
    componentId: result.componentId,
    target: result.target,
    repository: result.repository,
    credential: result.credential,
    pullRequest: result.pullRequest,
    reviewEnforcement: result.reviewEnforcement,
    merge: result.merge,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus publication pull request merged.");
  writeLine(stdout, `  Target: ${formatPublicationTarget(result.target)}`);
  writeLine(stdout, `  Repository: ${result.repository.owner}/${result.repository.name}`);
  writeLine(stdout, `  Pull request: #${result.pullRequest.number}`);
  writeLine(stdout, `  Method: ${result.pullRequest.method}`);
  writeLine(stdout, `  Merged: ${result.merge.merged ? "yes" : "no"}`);
  if (result.merge.sha) {
    writeLine(stdout, `  SHA: ${result.merge.sha}`);
  }
  if (result.merge.message) {
    writeLine(stdout, `  Message: ${result.merge.message}`);
  }
  writeLine(stdout, `  Credential: ${result.credential.profileId} (${result.credential.kind})`);
  writeLine(stdout, `  Backend: ${result.merge.metadata.backend}`);
}

function printPublicationPullRequestEvidenceResult(
  result: NexusPublicationPullRequestEvidenceResult,
  parsed: ParsedPublicationPullRequestEvidenceCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: true,
    projectRoot: result.projectRoot,
    componentId: result.componentId,
    target: result.target,
    repository: result.repository,
    credential: result.credential,
    pullRequest: result.pullRequest,
    evidence: result.evidence,
    providerEvidence: [result.evidence],
    metadata: result.metadata,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus publication pull request evidence.");
  writeLine(stdout, `  Target: ${formatPublicationTarget(result.target)}`);
  writeLine(stdout, `  Repository: ${result.repository.owner}/${result.repository.name}`);
  writeLine(stdout, `  Pull request: #${result.pullRequest.number}`);
  writeLine(stdout, `  Head: ${result.evidence.headBranch ?? "unknown"}`);
  writeLine(stdout, `  Base: ${result.evidence.targetBranch ?? "unknown"}`);
  writeLine(stdout, `  Checks: ${result.evidence.checks?.length ?? 0}`);
  writeLine(stdout, `  Review: ${result.evidence.reviewState ?? "unknown"}`);
  writeLine(stdout, `  Base status: ${result.evidence.baseStatus ?? "unknown"}`);
  writeLine(stdout, `  Mergeability: ${result.evidence.mergeability ?? "unknown"}`);
  writeLine(stdout, `  Credential: ${result.credential.profileId} (${result.credential.kind})`);
  writeLine(stdout, `  Backend: ${result.metadata.backend}`);
}

function formatPublicationTarget(
  target: NexusPublicationBranchPushResult["target"],
): string {
  if (target.kind === "project") {
    return `project ${target.id}`;
  }

  return `component ${target.componentId ?? target.id}`;
}

function printReleaseTrainReadinessReport(
  report: NexusReleaseTrainReadinessReport,
  parsed: ParsedReleaseTrainReadinessCommand,
  stdout: TextWriter,
): void {
  if (parsed.json) {
    writeJson(stdout, {
      ok: true,
      nextAction: report.nextAction,
      summary: report.summary,
      report,
    });
    return;
  }

  writeLine(stdout, "DevNexus release train readiness.");
  writeLine(stdout, `  Project: ${report.project.id} (${report.project.name})`);
  writeLine(stdout, `  Next action: ${report.nextAction}`);
  writeLine(
    stdout,
    `  Branches: ${report.summary.itemCount}; eligible=${report.summary.eligibleCount}; blocked=${report.summary.blockedCount}; needsVerification=${report.summary.needsVerificationCount}; needsScope=${report.summary.needsScopeCount}`,
  );
  if (report.summary.budgetLimitedCount > 0) {
    writeLine(stdout, `  CI budget limited: ${report.summary.budgetLimitedCount}`);
  }
  for (const version of report.versions) {
    writeLine(
      stdout,
      `  Version ${version.versionId ?? "unscoped"}: ${version.itemCount} branch(es), ${version.eligibleCount} eligible`,
    );
    for (const item of version.items) {
      writeLine(
        stdout,
        `    ${item.componentId} ${item.workItemId ?? "no-work-item"} ${item.branchName ?? "no-branch"} -> ${item.candidateEligibility}`,
      );
      writeLine(
        stdout,
        `      next=${item.ciTier.tier.id} evidence=${item.evidence.status}`,
      );
      if (item.reasons.length > 0) {
        writeLine(stdout, `      reasons: ${item.reasons.join("; ")}`);
      }
    }
  }
  for (const warning of report.warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
}

function printPublicationEvidenceNormalizeResult(
  evidence: NexusPublicationProviderEvidence[],
  classifications: NexusPublicationProviderEvidenceCheckClassification[],
  parsed: ParsedPublicationEvidenceNormalizeCommand,
  stdout: TextWriter,
): void {
  if (parsed.json) {
    writeJson(stdout, {
      ok: true,
      evidence,
      classifications,
    });
    return;
  }

  writeLine(stdout, "DevNexus publication provider evidence.");
  writeLine(stdout, `  Evidence records: ${evidence.length}`);
  for (const [index, item] of evidence.entries()) {
    const classification = classifications[index];
    writeLine(
      stdout,
      `  ${index + 1}. ${item.provider} ${item.sourceKind} ${item.headBranch ?? item.headRef ?? "no-ref"}`,
    );
    writeLine(
      stdout,
      `     head=${item.headSha ?? "unknown"} target=${item.targetBranch ?? "unknown"} tier=${item.intendedCiTier ?? "unknown"}`,
    );
    if (classification) {
      writeLine(stdout, `     checks=${classification.status}: ${classification.message}`);
    }
  }
}

function printPublicationMergeQueueReadinessReport(
  report: NexusMergeQueueReadinessReport,
  parsed: ParsedPublicationMergeQueueReadinessCommand,
  stdout: TextWriter,
): void {
  if (parsed.json) {
    writeJson(stdout, {
      ok: true,
      nextAction: report.nextAction,
      report,
    });
    return;
  }

  writeLine(stdout, "DevNexus merge queue readiness.");
  writeLine(stdout, `  Project: ${report.project.id} (${report.project.name})`);
  writeLine(stdout, `  Component: ${report.component.id}`);
  writeLine(stdout, `  Target branch: ${report.targetBranch}`);
  writeLine(
    stdout,
    `  Merge queue: ${report.mergeQueue.enabled ? "enabled" : "disabled"} workflowTrigger=${report.mergeQueue.workflowTriggerStatus}`,
  );
  writeLine(stdout, `  Next action: ${report.nextAction}`);
  writeLine(
    stdout,
    `  Candidate matrix: ${report.candidateMatrixEvidence.length} evidence record(s)`,
  );
  for (const item of report.candidateMatrixEvidence) {
    writeLine(
      stdout,
      `    ${item.headRef ?? "no-ref"} ${item.intendedCiTier ?? "no-tier"} -> ${item.status}`,
    );
  }
  writeLine(
    stdout,
    `  Protected target gate: ${report.protectedTargetGate.status} - ${report.protectedTargetGate.message}`,
  );
  for (const blocker of report.blockers) {
    writeLine(stdout, `  Blocker: ${blocker}`);
  }
  for (const warning of report.warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
}

function printPublicationCandidatePlan(
  plan: NexusCandidateBranchPlan,
  parsed: ParsedPublicationCandidatePlanCommand,
  stdout: TextWriter,
): void {
  if (parsed.json) {
    writeJson(stdout, {
      ok: true,
      nextAction: plan.nextAction,
      summary: plan.summary,
      plan,
    });
    return;
  }

  writeLine(stdout, "DevNexus candidate branch plan.");
  writeLine(stdout, `  Project: ${plan.project.id} (${plan.project.name})`);
  writeLine(stdout, `  Selected version: ${plan.selectedVersion.id ?? "unscoped"}`);
  writeLine(stdout, `  Next action: ${plan.nextAction}`);
  writeLine(stdout, `  Integration branch: ${plan.branches.integration}`);
  writeLine(stdout, `  Candidate branch: ${plan.branches.candidate}`);
  writeLine(
    stdout,
    `  Items: included=${plan.summary.includedCount}; deferred=${plan.summary.deferredCount}; blocked=${plan.summary.blockedCount}; excluded=${plan.summary.excludedCount}`,
  );
  if (plan.candidateCiTier) {
    writeLine(
      stdout,
      `  Candidate CI tier: ${plan.candidateCiTier.tier.id}${plan.candidateCiTier.budgetLimited ? " (budget limited)" : ""}`,
    );
  }
  writeCandidatePlanItems(stdout, "Included", plan.included);
  writeCandidatePlanItems(stdout, "Deferred", plan.deferred);
  writeCandidatePlanItems(stdout, "Blocked", plan.blocked);
  writeCandidatePlanItems(stdout, "Excluded", plan.excluded);
  if (plan.changedAreaOverlaps.length > 0) {
    writeLine(stdout, "  Changed-area overlaps:");
    for (const overlap of plan.changedAreaOverlaps) {
      writeLine(
        stdout,
        `    ${overlap.changedArea}: ${overlap.workItemIds.join(", ")} (${overlap.branches.join(", ")})`,
      );
    }
  }
  for (const warning of plan.warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
}

function printPublicationFeaturePlan(
  plan: NexusFeatureBranchDeliveryPlan,
  parsed: ParsedPublicationFeaturePlanCommand,
  stdout: TextWriter,
): void {
  if (parsed.json) {
    writeJson(stdout, {
      ok: true,
      plan,
    });
    return;
  }

  writeLine(stdout, "DevNexus feature branch delivery plan.");
  writeLine(stdout, `  Project: ${plan.project.id} (${plan.project.name})`);
  writeLine(stdout, `  Features: ${plan.itemCount}`);
  for (const item of plan.items) {
    const feature = item.feature;
    const branchPlan = feature.branchPlan;
    writeLine(
      stdout,
      `  ${item.componentId}: active=${feature.activeScopeId} branchStrategy=${feature.defaultBranchStrategy}`,
    );
    writeLine(
      stdout,
      `    feature=${branchPlan.featureBranch ?? "none"} changes=${branchPlan.reviewBranchPattern}`,
    );
    writeLine(
      stdout,
      `    base=${branchPlan.defaultChangeBaseBranch} reviewTarget=${branchPlan.defaultChangeReviewTarget} final=${branchPlan.finalPublicationTarget}`,
    );
    writeLine(
      stdout,
      `    review=${feature.reviewMode} finalPR=${feature.finalPullRequest} finalPRCreation=${feature.finalPullRequestCreation} commentPolicy=${feature.commentPolicy}`,
    );
    writeLine(
      stdout,
      `    branchPublication=${feature.branchPublication.strategy} remote=${feature.branchPublication.selectedRemote ?? "manual"} fallback=${feature.branchPublication.fallbackRemote ?? "none"}`,
    );
    if (branchPlan.requiresFeatureBranchApproval) {
      writeLine(stdout, "    HITL: feature branch approval required");
    }
  }
  for (const warning of plan.warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
}

function printPublicationFeatureReport(
  report: NexusFeatureBranchDeliveryReport,
  parsed: ParsedPublicationFeatureReportCommand,
  stdout: TextWriter,
): void {
  if (parsed.json) {
    writeJson(stdout, {
      ok: true,
      nextAction: report.nextAction,
      summary: report.summary,
      report,
    });
    return;
  }

  writeLine(stdout, "DevNexus feature branch delivery report.");
  writeLine(stdout, `  Project: ${report.project.id} (${report.project.name})`);
  writeLine(stdout, `  Next action: ${report.nextAction}`);
  writeLine(
    stdout,
    `  Features: ${report.summary.itemCount}; ready=${report.summary.readyCount}; needsUpdate=${report.summary.needsUpdateCount}; blocked=${report.summary.blockedCount}; reviewNeeded=${report.summary.reviewNeededCount}`,
  );
  for (const item of report.items) {
    const evidence = item.providerEvidence;
    writeLine(
      stdout,
      `  ${item.componentId}: active=${item.featureId} branchStrategy=${item.branchStrategy} -> ${item.status}`,
    );
    writeLine(
      stdout,
      `    feature=${item.featureBranch ?? "none"} final=${item.finalPublicationTarget} ci=${item.ciTier.tier.id}`,
    );
    writeLine(
      stdout,
      `    evidence=${evidence.provider ?? "none"} ${evidence.sourceKind ?? "no-source"} checks=${evidence.checksStatus} review=${evidence.reviewState ?? "unknown"} merge=${evidence.mergeability ?? "unknown"} base=${evidence.baseStatus ?? "unknown"} policy=${evidence.branchPolicy ?? "unknown"} draft=${evidence.draft ?? "unknown"}`,
    );
    if (evidence.reviewTarget) {
      writeLine(
        stdout,
        `    reviewTarget=${formatReviewTarget(evidence.reviewTarget)}`,
      );
    }
    if (item.branchUpdateDecision.status !== "not_required") {
      writeLine(
        stdout,
        `    branchUpdate=${item.branchUpdateDecision.status} recommendation=${item.branchUpdateDecision.recommendation} forceWithLease=${item.branchUpdateDecision.forceWithLeaseRequired}`,
      );
      if (item.branchUpdateDecision.reasons.length > 0) {
        writeLine(
          stdout,
          `    branchUpdate reasons: ${item.branchUpdateDecision.reasons.join("; ")}`,
        );
      }
      const command = recommendedBranchUpdateCommand(item);
      if (command) {
        writeLine(stdout, `    branchUpdate command: ${command}`);
      }
    }
    if (item.reasons.length > 0) {
      writeLine(stdout, `    reasons: ${item.reasons.join("; ")}`);
    }
  }
  for (const warning of report.warnings) {
    writeLine(stdout, `  Warning: ${warning}`);
  }
}

function printPublicationFeatureFinalizationPlan(
  plan: NexusFeatureFinalizationPlan,
  parsed: ParsedPublicationFeatureFinalizationCommand,
  stdout: TextWriter,
): void {
  if (parsed.json) {
    writeJson(stdout, {
      ok: true,
      nextAction: plan.nextAction,
      summary: plan.summary,
      plan,
    });
    return;
  }

  writeLine(stdout, "DevNexus feature finalization plan.");
  writeLine(stdout, `  Project: ${plan.project.id} (${plan.project.name})`);
  writeLine(stdout, `  Next action: ${plan.nextAction}`);
  writeLine(
    stdout,
    `  Features: ${plan.summary.itemCount}; safeToReview=${plan.summary.safeToReviewCount}; readyForPublication=${plan.summary.readyForPublicationCount}; needsReview=${plan.summary.needsReviewCount}; blocked=${plan.summary.blockedCount}`,
  );
  for (const item of plan.items) {
    printFeatureFinalizationItem(item, stdout);
  }
}

function printFeatureFinalizationItem(
  item: NexusFeatureFinalizationPlan["items"][number],
  stdout: TextWriter,
): void {
  writeLine(
    stdout,
    `  ${item.componentId}: active=${item.featureId} review=${item.reviewReadiness.status} publication=${item.publicationReadiness.status}`,
  );
  writeLine(
    stdout,
    `    feature=${item.featureBranch ?? "none"} final=${item.finalPublicationTarget} authorizedToMerge=${item.publicationReadiness.authorizedToMerge}`,
  );
  printFeatureFinalizationPullRequestAction(item, stdout);
  printFeatureFinalizationBranchUpdate(item, stdout);
  printFeatureFinalizationReadinessReasons(item, stdout);
}

function printFeatureFinalizationPullRequestAction(
  item: NexusFeatureFinalizationPlan["items"][number],
  stdout: TextWriter,
): void {
  writeLine(
    stdout,
    `    finalPRAction=${item.finalPullRequestAction.status} humanInTheLoop=${item.finalPullRequestAction.humanInTheLoop}`,
  );
  if (item.finalPullRequestAction.providerAction) {
    const action = item.finalPullRequestAction.providerAction;
    writeLine(
      stdout,
      `    finalPR=${action.head} -> ${action.base} title=${action.title}`,
    );
  }
  if (item.finalPullRequestAction.cliCommand) {
    writeLine(
      stdout,
      `    command: ${item.finalPullRequestAction.cliCommand}`,
    );
  }
}

function printFeatureFinalizationBranchUpdate(
  item: NexusFeatureFinalizationPlan["items"][number],
  stdout: TextWriter,
): void {
  if (item.branchUpdateDecision.status === "not_required") {
    return;
  }
  writeLine(
    stdout,
    `    branchUpdate=${item.branchUpdateDecision.status} recommendation=${item.branchUpdateDecision.recommendation} forceWithLease=${item.branchUpdateDecision.forceWithLeaseRequired}`,
  );
  if (item.branchUpdateDecision.reasons.length > 0) {
    writeLine(
      stdout,
      `    branchUpdate reasons: ${item.branchUpdateDecision.reasons.join("; ")}`,
    );
  }
  const command = recommendedBranchUpdateCommand(item);
  if (command) {
    writeLine(stdout, `    branchUpdate command: ${command}`);
  }
}

function printFeatureFinalizationReadinessReasons(
  item: NexusFeatureFinalizationPlan["items"][number],
  stdout: TextWriter,
): void {
  printFeatureFinalizationReasonLine("review", item.reviewReadiness.reasons, stdout);
  printFeatureFinalizationReasonLine(
    "publication",
    item.publicationReadiness.reasons,
    stdout,
  );
}

function printFeatureFinalizationReasonLine(
  label: string,
  reasons: readonly string[],
  stdout: TextWriter,
): void {
  if (reasons.length > 0) {
    writeLine(stdout, `    ${label} reasons: ${reasons.join("; ")}`);
  }
}

function formatReviewTarget(
  target: NonNullable<NexusFeatureBranchDeliveryReportItem["providerEvidence"]["reviewTarget"]>,
): string {
  const label = target.number ? `#${target.number}` : target.id ?? target.kind;
  return target.url ? `${label} ${target.url}` : label;
}

function recommendedBranchUpdateCommand(
  item: Pick<NexusFeatureBranchDeliveryReportItem, "branchUpdateDecision">,
): string | null {
  const recommendation = item.branchUpdateDecision.recommendation;
  const choice = item.branchUpdateDecision.choices.find((candidate) =>
    candidate.id === recommendation
  );
  return choice?.command ?? null;
}

function writeCandidatePlanItems(
  stdout: TextWriter,
  label: string,
  items: NexusCandidateBranchPlan["included"],
): void {
  if (items.length === 0) {
    return;
  }
  writeLine(stdout, `  ${label}:`);
  for (const item of items) {
    writeLine(
      stdout,
      `    ${item.componentId} ${item.workItemId ?? "no-work-item"} ${item.branchName ?? "no-branch"} -> ${item.candidateEligibility}`,
    );
    if (item.reasons.length > 0) {
      writeLine(stdout, `      reasons: ${item.reasons.join("; ")}`);
    }
  }
}

function formatGreenMainStep(step: NexusGreenMainCommandStep): string {
  if (!step.enabled || !step.command) {
    return `disabled${step.note ? ` (${step.note})` : ""}`;
  }
  const environment = Object.entries(step.environment);
  const envPrefix =
    environment.length === 0
      ? ""
      : `${environment
          .map(([key, value]) => `${key}=${value}`)
          .join(" ")} `;
  return `${envPrefix}${step.command}${step.note ? ` (${step.note})` : ""}`;
}
