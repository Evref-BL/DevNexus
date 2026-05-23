import fs from "node:fs";
import path from "node:path";
import type { NexusAutomationConfig } from "./nexusAutomationConfig.js";

export interface NexusAutomationTargetContext {
  id: string | null;
  objective: string | null;
  statePath: string;
  cycleLedgerPath: string;
  stateExists: boolean;
  stateMarkdown: string | null;
  stopWhenNoEligibleWork: boolean;
  maxCycles: number | null;
  maxWorkItems: number | null;
}

export class NexusAutomationTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusAutomationTargetError";
  }
}

export function readNexusAutomationTargetContext(options: {
  projectRoot: string;
  config: NexusAutomationConfig;
}): NexusAutomationTargetContext {
  const statePath = resolveProjectRelativePath(
    options.projectRoot,
    options.config.target.statePath,
    "automation.target.statePath",
  );
  const cycleLedgerPath = resolveProjectRelativePath(
    options.projectRoot,
    options.config.target.cycleLedgerPath,
    "automation.target.cycleLedgerPath",
  );
  const stateExists = fs.existsSync(statePath);

  return {
    id: options.config.target.id,
    objective: options.config.target.objective,
    statePath,
    cycleLedgerPath,
    stateExists,
    stateMarkdown: stateExists ? fs.readFileSync(statePath, "utf8") : null,
    stopWhenNoEligibleWork: options.config.target.stopWhenNoEligibleWork,
    maxCycles: options.config.target.maxCycles,
    maxWorkItems: options.config.target.maxWorkItems,
  };
}

function resolveProjectRelativePath(
  projectRoot: string,
  configuredPath: string,
  fieldName: string,
): string {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, configuredPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new NexusAutomationTargetError(
      `${fieldName} must resolve inside the workspace root: ${target}`,
    );
  }

  return target;
}
