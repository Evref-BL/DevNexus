import process from "node:process";
import type { TextWriter } from "./cliSupport.js";
import type { NexusAutomationCommandRunner } from "./nexusAutomationCommandExecutor.js";
import type { GitRunner } from "./gitWorktreeService.js";
import type { ProjectGitRunner } from "./nexusProjectLifecycle.js";
import type { NexusProviderCredentialCommandRunner } from "./nexusProviderCredentialBroker.js";
import type { NexusPublicationGitPushRunner } from "./nexusPublicationPolicy.js";
import type { NexusProjectHostingProviderAdapter } from "./nexusProjectHosting.js";
import type { NexusMcpRuntimeProcess } from "./nexusSetupAssistant.js";
import type {
  NexusDashboardServerHandle,
  startNexusDashboardServer,
} from "./nexusDashboardServer.js";
import type {
  NexusEligibleWorkClaimProviderFactory,
  NexusWorkItemClaimAuthority,
} from "./nexusWorkItemClaim.js";
import {
  assertNexusSharedCheckoutMutationAllowed,
  parseNexusSharedCheckoutGuardOverride,
  NexusSharedCheckoutGuardError,
  type NexusCheckoutMutationClass,
  type NexusSharedCheckoutGuardOverride,
} from "./nexusSharedCheckoutGuard.js";

export interface DevNexusCliDependencies {
  stdout?: TextWriter;
  stderr?: TextWriter;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  credentialCommandRunner?: NexusProviderCredentialCommandRunner;
  publicationGitPushRunner?: NexusPublicationGitPushRunner;
  commandRunner?: NexusAutomationCommandRunner;
  gitRunner?: GitRunner;
  projectGitRunner?: ProjectGitRunner;
  hostingProvider?: NexusProjectHostingProviderAdapter;
  mcpRuntimeProcesses?: readonly NexusMcpRuntimeProcess[] | false;
  dashboardServerStarter?: (
    options: Parameters<typeof startNexusDashboardServer>[0],
  ) => Promise<NexusDashboardServerHandle>;
  dashboardServerWaiter?: (handle: NexusDashboardServerHandle) => Promise<void>;
  now?: () => Date | string;
  sleep?: (milliseconds: number) => Promise<void>;
  sharedCheckoutGuard?: "enforce" | "disabled";
  sharedCheckoutGuardOverride?: NexusSharedCheckoutGuardOverride | null;
  workItemClaimProviderFactory?: NexusEligibleWorkClaimProviderFactory;
  workItemClaimAuthority?: NexusWorkItemClaimAuthority;
  workItemClaimLeaseTokenFactory?: () => string;
}

export interface CliMutationGuardOptions {
  projectRoot: string;
  command: string;
  mutationClass: NexusCheckoutMutationClass;
  targetPath?: string | null;
  componentId?: string | null;
}

export function assertCliMutationAllowed(
  dependencies: DevNexusCliDependencies,
  options: CliMutationGuardOptions,
): void {
  if (!shouldEnforceCliSharedCheckoutGuard(dependencies)) {
    return;
  }

  try {
    assertNexusSharedCheckoutMutationAllowed({
      projectRoot: options.projectRoot,
      command: options.command,
      mutationClass: options.mutationClass,
      targetPath: options.targetPath,
      componentId: options.componentId,
      gitRunner: dependencies.gitRunner,
      override: cliSharedCheckoutGuardOverride(dependencies),
    });
  } catch (error) {
    if (error instanceof NexusSharedCheckoutGuardError) {
      throw new Error(
        JSON.stringify(
          {
            ok: false,
            error: "shared_checkout_mutation_refused",
            guard: error.decision,
          },
          null,
          2,
        ),
      );
    }
    throw error;
  }
}

function shouldEnforceCliSharedCheckoutGuard(
  dependencies: DevNexusCliDependencies,
): boolean {
  const envMode = process.env.DEV_NEXUS_SHARED_CHECKOUT_GUARD?.trim().toLowerCase();
  if (envMode === "off" || envMode === "disabled") {
    return false;
  }
  if (dependencies.sharedCheckoutGuard === "disabled") {
    return false;
  }
  if (dependencies.sharedCheckoutGuard === "enforce" || envMode === "enforce") {
    return true;
  }

  return !hasInjectedCliDependency(dependencies);
}

function hasInjectedCliDependency(dependencies: DevNexusCliDependencies): boolean {
  return Boolean(
    dependencies.stdout ||
      dependencies.stderr ||
      dependencies.commandRunner ||
      dependencies.gitRunner ||
      dependencies.projectGitRunner ||
      dependencies.hostingProvider ||
      dependencies.now,
  );
}

function cliSharedCheckoutGuardOverride(
  dependencies: DevNexusCliDependencies,
): NexusSharedCheckoutGuardOverride | null {
  if (dependencies.sharedCheckoutGuardOverride !== undefined) {
    return dependencies.sharedCheckoutGuardOverride;
  }

  return parseNexusSharedCheckoutGuardOverride(
    process.env.DEV_NEXUS_SHARED_CHECKOUT_GUARD_OVERRIDE,
  );
}
