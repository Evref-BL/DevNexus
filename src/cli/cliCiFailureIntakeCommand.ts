import path from "node:path";
import process from "node:process";
import {
  readCliJsonFile,
  writeJson,
  writeLine,
  type TextWriter,
} from "./cliSupport.js";
import {
  planNexusCiFailureIntake,
  type NexusCiFailureExistingWorkItem,
  type NexusCiFailureIntakePolicy,
  type NexusCiFailureIntakePlan,
  type NexusCiFailureReplay,
} from "../operations/nexusCiFailureIntake.js";

interface CiFailureIntakeCliDependencies {
  stdout?: TextWriter;
  now?: () => Date | string;
}

interface ParsedCiFailureIntakePlanCommand {
  projectRoot: string;
  inputPath: string;
  json?: boolean;
}

export async function handleCiFailureIntakeCommand(
  argv: string[],
  dependencies: CiFailureIntakeCliDependencies,
): Promise<number> {
  if (argv[1] === "plan") {
    const parsed = parseCiFailureIntakePlanCommand(argv);
    const input = readCiFailureIntakeInput(parsed.inputPath);
    const plan = planNexusCiFailureIntake({
      policy: input.policy,
      failure: input.failure,
      existingWorkItems: input.existingWorkItems,
      now: input.now ?? dependencies.now?.(),
    });
    printCiFailureIntakePlanResult(
      plan,
      parsed,
      dependencies.stdout ?? process.stdout,
    );
    return 0;
  }

  throw new Error("ci-failure-intake requires plan");
}

function parseCiFailureIntakePlanCommand(
  argv: string[],
): ParsedCiFailureIntakePlanCommand {
  const [, , projectRoot, ...rest] = argv;
  if (!projectRoot || projectRoot.startsWith("--")) {
    throw new Error("ci-failure-intake plan requires a workspace root");
  }

  const parsed: Partial<ParsedCiFailureIntakePlanCommand> = {
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
      case "--input":
        parsed.inputPath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown ci-failure-intake plan option: ${arg}`);
    }
  }

  if (!parsed.inputPath) {
    throw new Error("ci-failure-intake plan requires --input");
  }

  return parsed as ParsedCiFailureIntakePlanCommand;
}

function readCiFailureIntakeInput(inputPath: string): {
  policy: NexusCiFailureIntakePolicy;
  failure: NexusCiFailureReplay;
  existingWorkItems?: NexusCiFailureExistingWorkItem[];
  now?: string;
} {
  const raw = readCliJsonFile(inputPath, "ci-failure-intake input") as {
    policy?: NexusCiFailureIntakePolicy;
    failure?: NexusCiFailureReplay;
    existingWorkItems?: NexusCiFailureExistingWorkItem[];
    now?: string;
  };
  if (!raw.policy) {
    throw new Error("ci-failure-intake input requires policy");
  }
  if (!raw.failure) {
    throw new Error("ci-failure-intake input requires failure");
  }

  return {
    policy: raw.policy,
    failure: raw.failure,
    existingWorkItems: raw.existingWorkItems ?? [],
    now: raw.now,
  };
}

function printCiFailureIntakePlanResult(
  plan: NexusCiFailureIntakePlan,
  parsed: ParsedCiFailureIntakePlanCommand,
  stdout: TextWriter,
): void {
  const payload = {
    ok: true,
    projectRoot: path.resolve(parsed.projectRoot),
    plan,
  };
  if (parsed.json) {
    writeJson(stdout, payload);
    return;
  }

  writeLine(stdout, "DevNexus CI failure intake plan.");
  writeLine(stdout, `  Accepted: ${String(plan.accepted)}`);
  writeLine(stdout, `  Action: ${plan.action.kind}`);
  if (plan.action.kind === "create" || plan.action.kind === "update") {
    writeLine(stdout, `  Title: ${plan.action.workItem.title}`);
    writeLine(stdout, `  Status: ${plan.action.workItem.status}`);
  }
  if (plan.dedupeKey) {
    writeLine(stdout, `  Dedupe: ${plan.dedupeKey}`);
  }
  writeLine(
    stdout,
    `  Wakeup: ${plan.wakeup.shouldWake ? "yes" : "no"} - ${plan.wakeup.reason}`,
  );
  for (const blocker of plan.blockers) {
    writeLine(stdout, `  Blocker: ${blocker}`);
  }
}
