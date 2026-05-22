import { shellQuoteArgument } from "./nexusAutomationAgentProfile.js";
import type { NexusPublicationProviderBaseStatus } from "./nexusPublicationProviderEvidence.js";

export type NexusInitiativeBranchUpdateDecisionStatus =
  | "not_required"
  | "behind"
  | "diverged"
  | "unknown";

export type NexusInitiativeBranchUpdateChoiceId =
  | "merge_update"
  | "rebase"
  | "no_update";

export interface NexusInitiativeBranchUpdateChoice {
  id: NexusInitiativeBranchUpdateChoiceId;
  recommended: boolean;
  humanInTheLoop: boolean;
  forceWithLeaseRequired: boolean;
  command: string | null;
  reasons: string[];
}

export interface NexusInitiativeBranchUpdateDecision {
  status: NexusInitiativeBranchUpdateDecisionStatus;
  recommendation: NexusInitiativeBranchUpdateChoiceId | "none";
  headBranch: string | null;
  baseBranch: string;
  pushRemote: string | null;
  publicBranch: boolean;
  stackedBranch: boolean;
  conflictRisk: "none" | "unknown" | "elevated";
  ciFreshnessRisk: "none" | "stale" | "unknown";
  protectedBranchConstraint: "none" | "avoid_direct_base_push";
  forceWithLeaseRequired: boolean;
  humanInTheLoop: boolean;
  reasons: string[];
  choices: NexusInitiativeBranchUpdateChoice[];
}

export function buildNexusInitiativeBranchUpdateDecision(options: {
  baseStatus: NexusPublicationProviderBaseStatus | null;
  headBranch: string | null;
  baseBranch: string;
  pushRemote?: string | null;
  publicBranch?: boolean;
  stackedBranch?: boolean;
}): NexusInitiativeBranchUpdateDecision {
  const baseStatus = options.baseStatus;
  const pushRemote = clean(options.pushRemote) ?? null;
  const publicBranch = options.publicBranch ?? (
    baseStatus === "behind" || baseStatus === "diverged"
  );
  const stackedBranch = options.stackedBranch ?? false;
  if (baseStatus !== "behind" && baseStatus !== "diverged") {
    return {
      status: baseStatus === "unknown" ? "unknown" : "not_required",
      recommendation: "none",
      headBranch: options.headBranch,
      baseBranch: options.baseBranch,
      pushRemote,
      publicBranch: false,
      stackedBranch,
      conflictRisk: baseStatus === "unknown" ? "unknown" : "none",
      ciFreshnessRisk: baseStatus === "unknown" ? "unknown" : "none",
      protectedBranchConstraint: "none",
      forceWithLeaseRequired: false,
      humanInTheLoop: false,
      reasons: [],
      choices: [],
    };
  }

  const conflictRisk = baseStatus === "diverged" ? "elevated" : "unknown";
  const reasons = [
    `review branch base status is ${baseStatus}`,
    "CI may be stale until the review branch includes the current base branch",
    "avoid direct pushes to the protected base branch",
  ];
  if (stackedBranch) {
    reasons.push(
      "review branch belongs to a stack; update parent branches before children",
    );
  }

  return {
    status: baseStatus,
    recommendation: "merge_update",
    headBranch: options.headBranch,
    baseBranch: options.baseBranch,
    pushRemote,
    publicBranch,
    stackedBranch,
    conflictRisk,
    ciFreshnessRisk: "stale",
    protectedBranchConstraint: "avoid_direct_base_push",
    forceWithLeaseRequired: false,
    humanInTheLoop: false,
    reasons,
    choices: [
      {
        id: "merge_update",
        recommended: true,
        humanInTheLoop: false,
        forceWithLeaseRequired: false,
        command: branchUpdateCommand("merge", options),
        reasons: [
          "updates the review branch without rewriting published history",
        ],
      },
      {
        id: "rebase",
        recommended: false,
        humanInTheLoop: true,
        forceWithLeaseRequired: true,
        command: branchUpdateCommand("rebase", options),
        reasons: [
          publicBranch
            ? "rewrites the public review branch and requires force-with-lease approval"
            : "rewrites the review branch and requires force-with-lease approval",
        ],
      },
      {
        id: "no_update",
        recommended: false,
        humanInTheLoop: false,
        forceWithLeaseRequired: false,
        command: null,
        reasons: [
          "leaves regression risk to CI after final publication",
        ],
      },
    ],
  };
}

function branchUpdateCommand(
  mode: "merge" | "rebase",
  options: {
    headBranch: string | null;
    baseBranch: string;
    pushRemote?: string | null;
  },
): string | null {
  if (!options.headBranch) {
    return null;
  }
  const pushRemote = clean(options.pushRemote) ?? "origin";
  const checkout = `git checkout ${shellQuoteArgument(options.headBranch)}`;
  if (mode === "merge") {
    return [
      checkout,
      `git merge --no-ff ${shellQuoteArgument(options.baseBranch)}`,
      `git push ${shellQuoteArgument(pushRemote)} ${shellQuoteArgument(options.headBranch)}`,
    ].join(" && ");
  }

  return [
    checkout,
    `git rebase ${shellQuoteArgument(options.baseBranch)}`,
    `git push --force-with-lease ${shellQuoteArgument(pushRemote)} ${shellQuoteArgument(options.headBranch)}`,
  ].join(" && ");
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
