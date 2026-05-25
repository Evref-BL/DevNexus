import type {
  NexusGitWorkflowProfileConfig,
  NexusGitWorkflowUpdateAction,
} from "../automation/nexusAutomationConfig.js";
import { shellQuoteArgument } from "../automation/nexusAutomationAgentProfile.js";

export type NexusGitWorkflowBranchFreshness =
  | "fresh"
  | "behind"
  | "diverged"
  | "conflicting"
  | "unknown";

export type NexusGitWorkflowProviderBaseStatus =
  | "up_to_date"
  | "behind"
  | "diverged"
  | "unknown";

export type NexusGitWorkflowProviderMergeability =
  | "mergeable"
  | "conflicting"
  | "unknown";

export type NexusGitWorkflowValidationMode =
  | "strict_checks"
  | "loose_checks"
  | "merge_queue";

export type NexusGitWorkflowRequiredChecksStatus =
  | "passed"
  | "pending"
  | "failed"
  | "stale"
  | "missing"
  | "unknown";

export type NexusGitWorkflowMergeQueueStatus =
  | "available"
  | "queued"
  | "unavailable"
  | "unknown";

export type NexusGitWorkflowHumanGate =
  | "public_history_rewrite"
  | "blocked_by_policy"
  | null;

export interface NexusGitWorkflowBranchFreshnessProviderEvidence {
  baseStatus?: NexusGitWorkflowProviderBaseStatus | null;
  mergeable?: NexusGitWorkflowProviderMergeability | null;
  validationMode?: NexusGitWorkflowValidationMode | null;
  requiredChecks?: NexusGitWorkflowRequiredChecksStatus | null;
  mergeQueue?: NexusGitWorkflowMergeQueueStatus | null;
}

export interface NexusGitWorkflowBranchFreshnessGitEvidence {
  aheadBy?: number | null;
  behindBy?: number | null;
  conflicts?: boolean | null;
}

export interface NexusGitWorkflowBranchFreshnessOptions {
  profile: NexusGitWorkflowProfileConfig;
  headBranch: string | null;
  baseBranch: string;
  pushRemote?: string | null;
  publicBranch?: boolean | null;
  parentBranches?: string[];
  childBranches?: string[];
  git?: NexusGitWorkflowBranchFreshnessGitEvidence | null;
  provider?: NexusGitWorkflowBranchFreshnessProviderEvidence | null;
}

export interface NexusGitWorkflowOrderedBranchUpdate {
  branch: string;
  order: "parent" | "current" | "child";
}

export interface NexusGitWorkflowBranchFreshnessDecision {
  freshness: NexusGitWorkflowBranchFreshness;
  action: NexusGitWorkflowUpdateAction;
  branchStrategy: NexusGitWorkflowProfileConfig["branchStrategy"];
  headBranch: string | null;
  baseBranch: string;
  pushRemote: string;
  publicBranch: boolean;
  providerAction: string | null;
  command: string | null;
  hitlRequired: boolean;
  forceWithLeaseRequired: boolean;
  humanGate: NexusGitWorkflowHumanGate;
  blockers: string[];
  reasons: string[];
  orderedUpdates: NexusGitWorkflowOrderedBranchUpdate[];
}

export function buildNexusGitWorkflowBranchFreshnessDecision(
  options: NexusGitWorkflowBranchFreshnessOptions,
): NexusGitWorkflowBranchFreshnessDecision {
  const provider = options.provider ?? {};
  const git = options.git ?? {};
  const freshness = classifyFreshness(provider, git);
  const publicBranch = options.publicBranch ?? freshness !== "fresh";
  const pushRemote = clean(options.pushRemote) ?? "origin";
  const reasons = freshnessReasons(freshness, provider, git);
  const orderedUpdates = orderedBranchUpdates(options);
  if (orderedUpdates.length > 1) {
    reasons.push(
      "stacked workflow must update parent branches before child branches",
    );
  }

  const conflictBlockers = freshness === "conflicting"
    ? ["provider reports merge conflicts"]
    : [];
  const checkBlockers = requiredCheckBlockers(provider);
  if (conflictBlockers.length > 0 || checkBlockers.length > 0) {
    return decision({
      options,
      freshness,
      action: "block",
      pushRemote,
      publicBranch,
      reasons,
      blockers: [...conflictBlockers, ...checkBlockers],
      orderedUpdates,
    });
  }

  const providerOverride = directProviderValidationOverride(options.profile, provider);
  if (providerOverride) {
    return decision({
      options,
      freshness,
      action: "none",
      pushRemote,
      publicBranch,
      providerAction: providerOverride.providerAction,
      reasons: [...reasons, providerOverride.reason],
      orderedUpdates,
    });
  }

  const action = updateActionForFreshness(options.profile, freshness);
  return decision({
    options,
    freshness,
    action,
    pushRemote,
    publicBranch,
    reasons,
    orderedUpdates,
  });
}

function classifyFreshness(
  provider: NexusGitWorkflowBranchFreshnessProviderEvidence,
  git: NexusGitWorkflowBranchFreshnessGitEvidence,
): NexusGitWorkflowBranchFreshness {
  if (provider.mergeable === "conflicting" || git.conflicts === true) {
    return "conflicting";
  }
  if (provider.baseStatus === "behind") {
    return "behind";
  }
  if (provider.baseStatus === "diverged") {
    return "diverged";
  }
  if (provider.baseStatus === "up_to_date") {
    return "fresh";
  }
  const aheadBy = git.aheadBy ?? null;
  const behindBy = git.behindBy ?? null;
  if (typeof behindBy === "number" && behindBy > 0) {
    return typeof aheadBy === "number" && aheadBy > 0 ? "diverged" : "behind";
  }
  if (aheadBy === 0 && behindBy === 0) {
    return "fresh";
  }
  return "unknown";
}

function freshnessReasons(
  freshness: NexusGitWorkflowBranchFreshness,
  provider: NexusGitWorkflowBranchFreshnessProviderEvidence,
  git: NexusGitWorkflowBranchFreshnessGitEvidence,
): string[] {
  const reasons: string[] = [];
  if (freshness === "behind") {
    reasons.push(freshnessSource(provider, git, "branch is behind its base"));
  } else if (freshness === "diverged") {
    reasons.push(
      freshnessSource(provider, git, "branch has diverged from its base"),
    );
  } else if (freshness === "conflicting") {
    reasons.push(
      provider.mergeable === "conflicting"
        ? "provider reports branch cannot merge cleanly"
        : "local Git facts report branch cannot merge cleanly",
    );
  } else if (freshness === "fresh") {
    reasons.push(
      freshnessSource(provider, git, "branch is up to date with its base"),
    );
  } else {
    reasons.push("branch freshness is unknown");
  }
  if (provider.validationMode === "strict_checks") {
    reasons.push(
      "strict checks require the review branch to include the current base",
    );
  }
  return reasons;
}

function freshnessSource(
  provider: NexusGitWorkflowBranchFreshnessProviderEvidence,
  git: NexusGitWorkflowBranchFreshnessGitEvidence,
  message: string,
): string {
  return provider.baseStatus && provider.baseStatus !== "unknown"
    ? `provider reports ${message}`
    : hasLocalGitFreshnessFacts(git)
      ? `local Git facts report ${message}`
      : message;
}

function hasLocalGitFreshnessFacts(
  git: NexusGitWorkflowBranchFreshnessGitEvidence,
): boolean {
  return typeof git.aheadBy === "number" || typeof git.behindBy === "number";
}

function requiredCheckBlockers(
  provider: NexusGitWorkflowBranchFreshnessProviderEvidence,
): string[] {
  if (provider.requiredChecks === "failed") {
    return ["required checks failed"];
  }
  return [];
}

function directProviderValidationOverride(
  profile: NexusGitWorkflowProfileConfig,
  provider: NexusGitWorkflowBranchFreshnessProviderEvidence,
): { reason: string; providerAction: string | null } | null {
  if (profile.branchStrategy !== "direct" || provider.baseStatus !== "behind") {
    return null;
  }
  if (provider.validationMode === "loose_checks") {
    return {
      reason:
        "direct workflow uses loose checks; provider validation can run without updating the branch",
      providerAction: null,
    };
  }
  if (
    provider.validationMode === "merge_queue" &&
    (provider.mergeQueue === "available" || provider.mergeQueue === "queued")
  ) {
    return {
      reason:
        "merge queue will validate the candidate against the protected target",
      providerAction: "enter_merge_queue",
    };
  }
  return null;
}

function updateActionForFreshness(
  profile: NexusGitWorkflowProfileConfig,
  freshness: NexusGitWorkflowBranchFreshness,
): NexusGitWorkflowUpdateAction {
  if (freshness === "behind") {
    return profile.update.behind;
  }
  if (freshness === "diverged") {
    return profile.update.diverged;
  }
  if (freshness === "unknown") {
    return "wait";
  }
  return "none";
}

function decision(options: {
  options: NexusGitWorkflowBranchFreshnessOptions;
  freshness: NexusGitWorkflowBranchFreshness;
  action: NexusGitWorkflowUpdateAction;
  pushRemote: string;
  publicBranch: boolean;
  providerAction?: string | null;
  reasons: string[];
  blockers?: string[];
  orderedUpdates?: NexusGitWorkflowOrderedBranchUpdate[];
}): NexusGitWorkflowBranchFreshnessDecision {
  const rewrite = isRewriteAction(options.action);
  const blockedByRewritePolicy =
    rewrite && options.options.profile.update.publicRewrite === "never";
  const hitlRequired =
    rewrite &&
    options.publicBranch &&
    options.options.profile.update.publicRewrite === "with_human_approval";
  const action = blockedByRewritePolicy ? "block" : options.action;
  const blockers = [
    ...(options.blockers ?? []),
    ...(blockedByRewritePolicy
      ? ["public rewrite policy forbids this update action"]
      : []),
  ];
  return {
    freshness: options.freshness,
    action,
    branchStrategy: options.options.profile.branchStrategy,
    headBranch: options.options.headBranch,
    baseBranch: options.options.baseBranch,
    pushRemote: options.pushRemote,
    publicBranch: options.publicBranch,
    providerAction: options.providerAction ?? null,
    command: blockers.length > 0
      ? null
      : updateCommand(action, {
          headBranch: options.options.headBranch,
          baseBranch: options.options.baseBranch,
          pushRemote: options.pushRemote,
        }),
    hitlRequired,
    forceWithLeaseRequired: rewrite && action !== "block",
    humanGate: blockedByRewritePolicy
      ? "blocked_by_policy"
      : hitlRequired
        ? "public_history_rewrite"
        : null,
    blockers,
    reasons: options.reasons,
    orderedUpdates: options.orderedUpdates ?? [],
  };
}

function updateCommand(
  action: NexusGitWorkflowUpdateAction,
  options: {
    headBranch: string | null;
    baseBranch: string;
    pushRemote: string;
  },
): string | null {
  if (!options.headBranch) {
    return null;
  }
  const checkout = `git checkout ${shellQuoteArgument(options.headBranch)}`;
  if (action === "merge") {
    return [
      checkout,
      `git merge --no-ff ${shellQuoteArgument(options.baseBranch)}`,
      `git push ${shellQuoteArgument(options.pushRemote)} ${shellQuoteArgument(options.headBranch)}`,
    ].join(" && ");
  }
  if (action === "rebase") {
    return [
      checkout,
      `git rebase ${shellQuoteArgument(options.baseBranch)}`,
      `git push --force-with-lease ${shellQuoteArgument(options.pushRemote)} ${shellQuoteArgument(options.headBranch)}`,
    ].join(" && ");
  }
  if (action === "cherry_pick") {
    return [
      checkout,
      `git cherry-pick ${shellQuoteArgument(options.baseBranch)}`,
      `git push ${shellQuoteArgument(options.pushRemote)} ${shellQuoteArgument(options.headBranch)}`,
    ].join(" && ");
  }
  return null;
}

function isRewriteAction(action: NexusGitWorkflowUpdateAction): boolean {
  return action === "rebase" || action === "restack" || action === "recreate";
}

function orderedBranchUpdates(
  options: NexusGitWorkflowBranchFreshnessOptions,
): NexusGitWorkflowOrderedBranchUpdate[] {
  if (
    options.profile.branchStrategy !== "stacked" &&
    options.profile.branchStrategy !== "hybrid"
  ) {
    return [];
  }
  return [
    ...(options.parentBranches ?? []).map((branch) => ({
      branch,
      order: "parent" as const,
    })),
    ...(options.headBranch
      ? [{ branch: options.headBranch, order: "current" as const }]
      : []),
    ...(options.childBranches ?? []).map((branch) => ({
      branch,
      order: "child" as const,
    })),
  ];
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
