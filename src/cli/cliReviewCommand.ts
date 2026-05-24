import process from "node:process";
import {
  readCliJsonFile,
  writeJson,
  writeLine,
  type TextWriter,
} from "./cliSupport.js";
import type { DevNexusCliDependencies } from "./cliCommandContext.js";
import { loadProjectConfig } from "../project/nexusProjectConfig.js";
import { resolveProjectComponents } from "../project/nexusProjectLifecycle.js";
import {
  normalizeNexusPublicationProviderEvidence,
  type NexusPublicationProviderEvidence,
  type NexusPublicationProviderEvidenceInput,
} from "../publication/nexusPublicationProviderEvidence.js";
import {
  buildNexusReviewPlan,
  type NexusReviewPlan,
} from "../publication/nexusReviewPolicy.js";

interface ParsedReviewPlanCommand {
  projectRoot: string;
  componentId?: string;
  branchRole?: string;
  paths: string[];
  labels: string[];
  requestedAction?: string;
  branchName?: string;
  headSha?: string;
  authorized: boolean;
  authorizationTimestamp?: string;
  authorizationSummary?: string;
  evidenceFile?: string;
  json: boolean;
}

export async function handleReviewCommand(
  argv: string[],
  dependencies: DevNexusCliDependencies,
): Promise<number> {
  if (argv[1] !== "plan") {
    throw new Error("review requires plan");
  }

  const parsed = parseReviewPlanCommand(argv);
  const projectConfig = loadProjectConfig(parsed.projectRoot);
  const components = resolveProjectComponents(parsed.projectRoot, projectConfig);
  const component = parsed.componentId
    ? components.find((candidate) => candidate.id === parsed.componentId)
    : components.find((candidate) => candidate.role === "primary") ?? components[0];
  if (!component) {
    throw new Error("DevNexus workspace has no components");
  }
  if (parsed.componentId && component.id !== parsed.componentId) {
    throw new Error(`Workspace component is not configured: ${parsed.componentId}`);
  }

  const plan = buildNexusReviewPlan({
    componentId: component.id,
    policy: component.review,
    branchRole: parsed.branchRole,
    paths: parsed.paths,
    labels: parsed.labels,
    requestedAction: parsed.requestedAction,
    branchName: parsed.branchName,
    headSha: parsed.headSha,
    localAuthorization: parsed.authorized
      ? {
          authorized: true,
          authorizedAt:
            parsed.authorizationTimestamp ??
            normalizeNow(dependencies.now?.() ?? new Date()),
          branchName: parsed.branchName ?? null,
          headSha: parsed.headSha ?? null,
          requestedAction: parsed.requestedAction ?? null,
          summary: parsed.authorizationSummary ?? null,
        }
      : null,
    providerEvidence: parsed.evidenceFile
      ? firstProviderEvidence(parsed.evidenceFile)
      : null,
  });

  printReviewPlan(plan, parsed, dependencies.stdout ?? process.stdout);
  return plan.status === "blocked" ? 1 : 0;
}

function parseReviewPlanCommand(argv: string[]): ParsedReviewPlanCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("review plan requires a workspace root");
  }

  const parsed: ParsedReviewPlanCommand = {
    projectRoot,
    paths: [],
    labels: [],
    authorized: false,
    json: false,
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
      case "--branch-role":
        parsed.branchRole = next();
        break;
      case "--path":
        parsed.paths.push(next());
        break;
      case "--label":
        parsed.labels.push(next());
        break;
      case "--requested-action":
        parsed.requestedAction = next();
        break;
      case "--branch":
        parsed.branchName = next();
        break;
      case "--head":
        parsed.headSha = next();
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
      case "--evidence-file":
        parsed.evidenceFile = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown review plan option: ${arg}`);
    }
  }

  if (
    parsed.authorized &&
    (!parsed.requestedAction || !parsed.branchName || !parsed.headSha)
  ) {
    throw new Error(
      "review plan --authorized requires --requested-action, --branch, and --head",
    );
  }

  return parsed;
}

function firstProviderEvidence(inputPath: string): NexusPublicationProviderEvidence | null {
  const raw = readCliJsonFile(inputPath, "review provider evidence");
  const inputs = providerEvidenceInputs(raw);
  return normalizeNexusPublicationProviderEvidence(inputs)[0] ?? null;
}

function providerEvidenceInputs(raw: unknown): NexusPublicationProviderEvidenceInput[] {
  if (Array.isArray(raw)) {
    return raw as NexusPublicationProviderEvidenceInput[];
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("review provider evidence file must be an array or object");
  }
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.evidence)) {
    return record.evidence as NexusPublicationProviderEvidenceInput[];
  }
  return [record as NexusPublicationProviderEvidenceInput];
}

function printReviewPlan(
  plan: NexusReviewPlan,
  parsed: ParsedReviewPlanCommand,
  stdout: TextWriter,
): void {
  if (parsed.json) {
    writeJson(stdout, { ok: true, plan });
    return;
  }

  writeLine(stdout, "DevNexus review plan.");
  writeLine(stdout, `  Component: ${plan.componentId}`);
  writeLine(stdout, `  Status: ${plan.status}`);
  writeLine(stdout, `  Next action: ${plan.nextAction}`);
  writeLine(stdout, `  Transport: ${plan.transport}`);
  writeLine(stdout, `  Gates: ${plan.gates.join(", ") || "none"}`);
  if (plan.matchedRuleIndex !== null) {
    writeLine(stdout, `  Matched rule: ${plan.matchedRuleIndex}`);
  }
  if (plan.requiredEvidence.length > 0) {
    writeLine(stdout, `  Required evidence: ${plan.requiredEvidence.join(", ")}`);
  }
  if (plan.providerMutations.length > 0) {
    writeLine(stdout, `  Provider mutations: ${plan.providerMutations.join(", ")}`);
  }
  for (const result of plan.gateResults) {
    writeLine(
      stdout,
      `    ${result.gate}: ${result.status} (${result.evidenceSource}) - ${result.message}`,
    );
  }
}

function normalizeNow(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
