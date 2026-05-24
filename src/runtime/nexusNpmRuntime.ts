import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  defaultNexusAutomationCommandRunner,
  summarizeNexusAutomationCommandRunResult,
  type NexusAutomationCommandRunner,
  type NexusAutomationCommandRunResult,
} from "../automation/nexusAutomationCommandExecutor.js";

export type NexusNpmVisibilityFailureKind =
  | "registry_propagation_delay"
  | "network_failure"
  | "missing_package"
  | "missing_version"
  | "missing_dist_tag"
  | "invalid_packument";

export type NexusNpmRuntimeInstallFailureKind = "damaged_local_install";

export type NexusNpmRuntimeCommandRunner = NexusAutomationCommandRunner;

export interface NexusNpmVisibilityOptions {
  packageName: string;
  version?: string | null;
  distTag?: string | null;
  recentlyPublished?: boolean;
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  commandRunner?: NexusNpmRuntimeCommandRunner;
  sleep?: (delayMs: number) => Promise<void>;
}

export type NexusNpmVisibilityResult =
  | {
      status: "visible";
      packageName: string;
      version: string | null;
      distTag: string | null;
      distTagVersion: string | null;
      attempts: number;
      summary: string;
    }
  | {
      status: "failed";
      packageName: string;
      version: string | null;
      distTag: string | null;
      failureKind: NexusNpmVisibilityFailureKind;
      attempts: number;
      summary: string;
    };

export interface NexusNpmRuntimeInstallInspection {
  runtimeRoot: string;
  status: "valid" | "damaged";
  failureKind: NexusNpmRuntimeInstallFailureKind | null;
  issues: string[];
  packages: NexusNpmRuntimePackageRequirement[];
}

export interface NexusNpmRuntimePackageRequirement {
  installName: string;
  packageName: string;
  requested: string;
  expectedVersion: string | null;
}

export interface NexusNpmRuntimePreflightCheck {
  name: string;
  status: "passed" | "failed";
  message: string;
}

export interface PreflightNexusNpmRuntimeInstallOptions {
  projectRoot: string;
  runtimeRoot?: string;
  allowRepair?: boolean;
  commandRunner?: NexusNpmRuntimeCommandRunner;
  env?: NodeJS.ProcessEnv;
}

interface NpmPackument {
  name: string | null;
  versions: string[];
  distTags: Record<string, string>;
}

interface RuntimePackageJson {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

interface RuntimeLockPackage {
  version?: string;
}

export async function waitForNexusNpmPackageVisibility(
  options: NexusNpmVisibilityOptions,
): Promise<NexusNpmVisibilityResult> {
  const packageName = requiredNonEmptyString(options.packageName, "packageName");
  const version = optionalNullableString(options.version) ?? null;
  const distTag = optionalNullableString(options.distTag) ?? null;
  const maxAttempts = positiveInteger(options.maxAttempts ?? 6, "maxAttempts");
  const initialDelayMs = nonNegativeInteger(
    options.initialDelayMs ?? 5000,
    "initialDelayMs",
  );
  const maxDelayMs = nonNegativeInteger(
    options.maxDelayMs ?? 60000,
    "maxDelayMs",
  );
  const commandRunner =
    options.commandRunner ?? defaultNexusAutomationCommandRunner;
  const sleep = options.sleep ?? defaultSleep;
  let lastFailure: Exclude<NexusNpmVisibilityResult, { status: "visible" }> | null =
    null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const command = `npm view ${packageName} --json`;
    const result = commandRunner(command, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
    });
    const inspection = inspectNpmVisibilityCommandResult({
      result,
      packageName,
      version,
      distTag,
      recentlyPublished: options.recentlyPublished === true,
      attempt,
    });
    if (inspection.status === "visible") {
      return inspection;
    }

    lastFailure = inspection;
    if (!shouldRetryVisibilityFailure(inspection.failureKind) || attempt === maxAttempts) {
      return {
        ...inspection,
        attempts: attempt,
      };
    }

    await sleep(backoffDelay(attempt, initialDelayMs, maxDelayMs));
  }

  return (
    lastFailure ?? {
      status: "failed",
      packageName,
      version,
      distTag,
      failureKind: "missing_package",
      attempts: 0,
      summary: `Missing npm package: ${packageName}`,
    }
  );
}

export function inspectNexusNpmRuntimeInstall(options: {
  runtimeRoot: string;
}): NexusNpmRuntimeInstallInspection {
  const runtimeRoot = path.resolve(
    requiredNonEmptyString(options.runtimeRoot, "runtimeRoot"),
  );
  const issues: string[] = [];
  const packageJsonPath = path.join(runtimeRoot, "package.json");
  const lockPath = path.join(runtimeRoot, "package-lock.json");
  const packageJson = readRuntimePackageJson(packageJsonPath, issues);
  const lockPackages = readRuntimeLockPackages(lockPath);
  const packages = runtimePackageRequirements(packageJson, lockPackages);
  const nodeModulesPath = path.join(runtimeRoot, "node_modules");

  if (!fs.existsSync(nodeModulesPath)) {
    issues.push(`node_modules is missing: ${nodeModulesPath}`);
  }

  for (const requirement of packages) {
    issues.push(...inspectRuntimePackageRequirement(nodeModulesPath, requirement));
  }

  return {
    runtimeRoot,
    status: issues.length > 0 ? "damaged" : "valid",
    failureKind: issues.length > 0 ? "damaged_local_install" : null,
    issues,
    packages,
  };
}

function inspectRuntimePackageRequirement(
  nodeModulesPath: string,
  requirement: NexusNpmRuntimePackageRequirement,
): string[] {
  const installedPackageJsonPath = path.join(
    nodeModulesPath,
    ...requirement.installName.split("/"),
    "package.json",
  );
  const installed = readInstalledPackageJson(installedPackageJsonPath);
  if (!installed) {
    return [
      `missing installed package ${requirement.installName}: ${installedPackageJsonPath}`,
    ];
  }

  return [
    ...runtimePackageIdentityIssues(requirement, installed),
    ...runtimePackageBinIssues(
      nodeModulesPath,
      requirement.installName,
      installed,
    ),
  ];
}

function runtimePackageIdentityIssues(
  requirement: NexusNpmRuntimePackageRequirement,
  installed: { name?: string; version?: string },
): string[] {
  const issues: string[] = [];
  if (installed.name && installed.name !== requirement.packageName) {
    issues.push(
      `${requirement.installName} package identity is ${installed.name}, expected ${requirement.packageName}`,
    );
  }
  if (
    requirement.expectedVersion &&
    installed.version !== requirement.expectedVersion
  ) {
    issues.push(
      `${requirement.installName} version is ${installed.version ?? "unknown"}, expected ${requirement.expectedVersion}`,
    );
  }
  return issues;
}

function runtimePackageBinIssues(
  nodeModulesPath: string,
  installName: string,
  installed: { name?: string; bin?: unknown },
): string[] {
  return installedBinNames(installed)
    .filter((binName) => !runtimeBinExists(nodeModulesPath, binName))
    .map(
      (binName) =>
        `${installName} bin ${binName} is missing from node_modules/.bin`,
    );
}

export function preflightNexusNpmRuntimeInstall(
  options: PreflightNexusNpmRuntimeInstallOptions,
): NexusNpmRuntimePreflightCheck[] {
  const projectRoot = path.resolve(
    requiredNonEmptyString(options.projectRoot, "projectRoot"),
  );
  const runtimeRoots = runtimeRootsForProject(projectRoot, options.runtimeRoot);
  return runtimeRoots.map((runtimeRoot) =>
    preflightRuntimeRoot({
      runtimeRoot,
      allowRepair: options.allowRepair === true,
      commandRunner:
        options.commandRunner ?? defaultNexusAutomationCommandRunner,
      env: options.env ?? process.env,
    }),
  );
}

export function nexusNpmRuntimeInstallSetupCommand(runtimeRoot: string): string {
  return fs.existsSync(path.join(runtimeRoot, "package-lock.json"))
    ? "npm ci"
    : "npm install";
}

function preflightRuntimeRoot(options: {
  runtimeRoot: string;
  allowRepair: boolean;
  commandRunner: NexusNpmRuntimeCommandRunner;
  env: NodeJS.ProcessEnv;
}): NexusNpmRuntimePreflightCheck {
  const before = inspectNexusNpmRuntimeInstall({
    runtimeRoot: options.runtimeRoot,
  });
  const setupCommand = nexusNpmRuntimeInstallSetupCommand(options.runtimeRoot);
  const checkName = `npmRuntimeInstall:${path.basename(options.runtimeRoot)}`;
  if (before.status === "valid") {
    return {
      name: checkName,
      status: "passed",
      message: `Runtime npm package install is valid: ${options.runtimeRoot}`,
    };
  }

  if (!options.allowRepair) {
    return {
      name: checkName,
      status: "failed",
      message: damagedRuntimeSummary(before, setupCommand),
    };
  }

  const repair = options.commandRunner(setupCommand, {
    cwd: options.runtimeRoot,
    env: options.env,
  });
  if (!commandSucceeded(repair)) {
    return {
      name: checkName,
      status: "failed",
      message: [
        `Damaged local npm runtime install state could not be repaired through approved setup command ${setupCommand}: ${options.runtimeRoot}.`,
        summarizeNexusAutomationCommandRunResult(repair),
        issueSummary(before),
      ].join(" "),
    };
  }

  const after = inspectNexusNpmRuntimeInstall({
    runtimeRoot: options.runtimeRoot,
  });
  if (after.status === "valid") {
    return {
      name: checkName,
      status: "passed",
      message: `Runtime npm package install repaired through approved setup command ${setupCommand}: ${options.runtimeRoot}`,
    };
  }

  return {
    name: checkName,
    status: "failed",
    message: [
      `Damaged local npm runtime install state remains after approved setup command ${setupCommand}: ${options.runtimeRoot}.`,
      issueSummary(after),
    ].join(" "),
  };
}

function inspectNpmVisibilityCommandResult(options: {
  result: NexusAutomationCommandRunResult;
  packageName: string;
  version: string | null;
  distTag: string | null;
  recentlyPublished: boolean;
  attempt: number;
}): NexusNpmVisibilityResult {
  const { result, packageName, version, distTag, recentlyPublished } = options;
  if (!commandSucceeded(result)) {
    const diagnostic = summarizeNexusAutomationCommandRunResult(result);
    if (isNetworkFailure(result)) {
      return visibilityFailure({
        packageName,
        version,
        distTag,
        failureKind: "network_failure",
        attempts: options.attempt,
        summary: `Network failure while reading npm registry for ${packageName}: ${diagnostic}`,
      });
    }

    const failureKind =
      recentlyPublished && isRegistryMissingFailure(result)
        ? "registry_propagation_delay"
        : "missing_package";
    return visibilityFailure({
      packageName,
      version,
      distTag,
      failureKind,
      attempts: options.attempt,
      summary:
        failureKind === "registry_propagation_delay"
          ? `Registry propagation delay: npm package ${packageName} is not visible yet after publish.`
          : `Missing npm package: ${packageName}. ${diagnostic}`,
    });
  }

  const packument = parsePackument(result.stdout);
  if (!packument) {
    return visibilityFailure({
      packageName,
      version,
      distTag,
      failureKind: "invalid_packument",
      attempts: options.attempt,
      summary: `Invalid npm packument for ${packageName}: npm view did not return a package object.`,
    });
  }

  const versionVisible = version === null || packument.versions.includes(version);
  const distTagVersion = distTag ? packument.distTags[distTag] ?? null : null;
  const distTagVisible = distTag === null || distTagVersion !== null;
  const distTagMatches =
    distTag === null ||
    version === null ||
    distTagVersion === version;

  if (versionVisible && distTagVisible && distTagMatches) {
    return {
      status: "visible",
      packageName,
      version,
      distTag,
      distTagVersion,
      attempts: options.attempt,
      summary: `npm package ${packageName}${version ? `@${version}` : ""} is visible${distTag ? ` on dist-tag ${distTag}` : ""}.`,
    };
  }

  if (recentlyPublished) {
    return visibilityFailure({
      packageName,
      version,
      distTag,
      failureKind: "registry_propagation_delay",
      attempts: options.attempt,
      summary:
        `Registry propagation delay: npm package ${packageName}${version ? `@${version}` : ""}${distTag ? ` dist-tag ${distTag}` : ""} is not visible yet after publish.`,
    });
  }

  if (!versionVisible) {
    return visibilityFailure({
      packageName,
      version,
      distTag,
      failureKind: "missing_version",
      attempts: options.attempt,
      summary: `Missing npm package version: ${packageName}@${version}.`,
    });
  }

  return visibilityFailure({
    packageName,
    version,
    distTag,
    failureKind: "missing_dist_tag",
    attempts: options.attempt,
    summary:
      distTagVersion === null
        ? `Missing npm dist-tag: ${packageName} ${distTag}.`
        : `npm dist-tag ${distTag} points to ${distTagVersion}, expected ${version}.`,
  });
}

function visibilityFailure(
  value: Omit<Exclude<NexusNpmVisibilityResult, { status: "visible" }>, "status">,
): Exclude<NexusNpmVisibilityResult, { status: "visible" }> {
  return { status: "failed", ...value };
}

function parsePackument(output: string): NpmPackument | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const distTagsValue = record["dist-tags"];
    return {
      name: typeof record.name === "string" ? record.name : null,
      versions: Array.isArray(record.versions)
        ? record.versions.filter((version): version is string => typeof version === "string")
        : typeof record.version === "string"
          ? [record.version]
          : [],
      distTags:
        distTagsValue && typeof distTagsValue === "object" && !Array.isArray(distTagsValue)
          ? Object.fromEntries(
              Object.entries(distTagsValue as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : {},
    };
  } catch {
    return null;
  }
}

function runtimeRootsForProject(
  projectRoot: string,
  runtimeRoot: string | undefined,
): string[] {
  if (runtimeRoot) {
    return [path.resolve(runtimeRoot)];
  }
  const defaultRuntimeRoot = path.join(
    projectRoot,
    ".dev-nexus",
    "runtime",
    "npm-tools",
  );
  const hasRuntimeConfig = fs.existsSync(path.join(defaultRuntimeRoot, "package.json"));
  const hasNodeModules = fs.existsSync(path.join(defaultRuntimeRoot, "node_modules"));
  return hasRuntimeConfig || hasNodeModules ? [defaultRuntimeRoot] : [];
}

function readRuntimePackageJson(
  packageJsonPath: string,
  issues: string[],
): RuntimePackageJson {
  if (!fs.existsSync(packageJsonPath)) {
    issues.push(`runtime package.json is missing: ${packageJsonPath}`);
    return { dependencies: {}, optionalDependencies: {}, devDependencies: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("package.json is not an object");
    }
    const record = parsed as Record<string, unknown>;
    return {
      dependencies: stringRecord(record.dependencies),
      optionalDependencies: stringRecord(record.optionalDependencies),
      devDependencies: stringRecord(record.devDependencies),
    };
  } catch (error) {
    issues.push(
      `runtime package.json is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { dependencies: {}, optionalDependencies: {}, devDependencies: {} };
  }
}

function readRuntimeLockPackages(
  lockPath: string,
): Record<string, RuntimeLockPackage> {
  if (!fs.existsSync(lockPath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const packages = (parsed as Record<string, unknown>).packages;
    if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
      return {};
    }
    return packages as Record<string, RuntimeLockPackage>;
  } catch {
    return {};
  }
}

function runtimePackageRequirements(
  packageJson: RuntimePackageJson,
  lockPackages: Record<string, RuntimeLockPackage>,
): NexusNpmRuntimePackageRequirement[] {
  return Object.entries({
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
    ...packageJson.devDependencies,
  })
    .map(([installName, requested]) => {
      const parsed = parseRequestedPackage(installName, requested);
      const lockVersion = lockPackages[`node_modules/${installName}`]?.version;
      return {
        installName,
        packageName: parsed.packageName,
        requested,
        expectedVersion: lockVersion ?? exactRequestedVersion(parsed.requestedRange),
      };
    })
    .sort((left, right) => left.installName.localeCompare(right.installName));
}

function parseRequestedPackage(
  installName: string,
  requested: string,
): { packageName: string; requestedRange: string } {
  if (!requested.startsWith("npm:")) {
    return { packageName: installName, requestedRange: requested };
  }

  const aliased = requested.slice("npm:".length);
  const atIndex = aliased.startsWith("@")
    ? aliased.indexOf("@", 1)
    : aliased.lastIndexOf("@");
  if (atIndex <= 0) {
    return { packageName: installName, requestedRange: requested };
  }

  return {
    packageName: aliased.slice(0, atIndex),
    requestedRange: aliased.slice(atIndex + 1),
  };
}

function exactRequestedVersion(requested: string): string | null {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(requested)
    ? requested
    : null;
}

function readInstalledPackageJson(
  packageJsonPath: string,
): { name?: string; version?: string; bin?: unknown } | null {
  try {
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.name === "string" ? { name: record.name } : {}),
      ...(typeof record.version === "string" ? { version: record.version } : {}),
      ...(record.bin !== undefined ? { bin: record.bin } : {}),
    };
  } catch {
    return null;
  }
}

function installedBinNames(installed: { name?: string; bin?: unknown }): string[] {
  if (typeof installed.bin === "string" && installed.name) {
    return [path.basename(installed.name)];
  }
  if (
    installed.bin &&
    typeof installed.bin === "object" &&
    !Array.isArray(installed.bin)
  ) {
    return Object.keys(installed.bin);
  }
  return [];
}

function runtimeBinExists(nodeModulesPath: string, binName: string): boolean {
  const binRoot = path.join(nodeModulesPath, ".bin");
  return (
    fs.existsSync(path.join(binRoot, binName)) ||
    fs.existsSync(path.join(binRoot, `${binName}.cmd`)) ||
    fs.existsSync(path.join(binRoot, `${binName}.ps1`))
  );
}

function damagedRuntimeSummary(
  inspection: NexusNpmRuntimeInstallInspection,
  setupCommand: string,
): string {
  return [
    `Damaged local npm runtime install state: ${inspection.runtimeRoot}.`,
    issueSummary(inspection),
    `Run setup-owned command ${setupCommand} in ${inspection.runtimeRoot} before launching workers; workers must not repair this with ad hoc npm install or npx fetches.`,
  ].join(" ");
}

function issueSummary(inspection: NexusNpmRuntimeInstallInspection): string {
  return `Issues: ${inspection.issues.join("; ")}`;
}

function commandSucceeded(result: NexusAutomationCommandRunResult): boolean {
  return result.exitCode === 0 && !result.error;
}

function shouldRetryVisibilityFailure(
  failureKind: NexusNpmVisibilityFailureKind,
): boolean {
  return (
    failureKind === "registry_propagation_delay" ||
    failureKind === "network_failure"
  );
}

function isNetworkFailure(result: NexusAutomationCommandRunResult): boolean {
  return /(?:EAI_AGAIN|ECONNRESET|ETIMEDOUT|ENOTFOUND|network|timeout|5\d\d)/iu.test(
    `${result.stderr}\n${result.stdout}\n${result.error ?? ""}`,
  );
}

function isRegistryMissingFailure(result: NexusAutomationCommandRunResult): boolean {
  return /(?:E404|404|not found|No matching version found)/iu.test(
    `${result.stderr}\n${result.stdout}\n${result.error ?? ""}`,
  );
}

function backoffDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
): number {
  return Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return requiredNonEmptyString(value, "value");
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}
