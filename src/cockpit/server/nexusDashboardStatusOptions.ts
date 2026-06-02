
import type { GetNexusAutomationStatusOptions } from "../../automation/nexusAutomationStatus.js";
import type { GitRunner } from "../../worktrees/gitWorktreeService.js";
import type {
  BuildNexusDashboardHostSnapshotOptions,
  BuildNexusDashboardSnapshotOptions,
} from "./nexusDashboardTypes.js";

type DashboardStatusOptionSource = Pick<
  BuildNexusDashboardSnapshotOptions,
  | "homePath"
  | "eligibleWorkMode"
  | "env"
  | "credentialResolver"
  | "provider"
  | "providerFactory"
  | "providerOptions"
  | "now"
> | Pick<
  BuildNexusDashboardHostSnapshotOptions,
  | "homePath"
  | "eligibleWorkMode"
  | "env"
  | "credentialResolver"
  | "provider"
  | "providerFactory"
  | "providerOptions"
  | "now"
>;

export function statusOptions(
  options: DashboardStatusOptionSource,
  projectRoot: string,
  gitRunner: GitRunner,
): GetNexusAutomationStatusOptions {
  return {
    projectRoot,
    homePath: options.homePath,
    eligibleWorkMode: options.eligibleWorkMode,
    env: options.env,
    credentialResolver: options.credentialResolver,
    provider: options.provider,
    providerFactory: options.providerFactory,
    providerOptions: options.providerOptions,
    gitRunner,
    now: options.now,
  };
}
