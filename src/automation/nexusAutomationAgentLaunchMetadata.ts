import type { NexusCodexGoalsPolicyDecision } from "./nexusCodexGoalsPolicy.js";

export type NexusAutomationCodexAppServerLaunchStatus =
  | "started"
  | "completed"
  | "failed"
  | "blocked";

export type NexusAutomationProviderSessionStatus =
  | "started"
  | "completed"
  | "failed"
  | "blocked"
  | "interrupted";

export type NexusAutomationProviderTerminalStatus =
  | "not_observed"
  | "observed"
  | "failed";

export type NexusAutomationProviderResultContractStatus =
  | "not_read"
  | "valid"
  | "missing"
  | "invalid";

export type NexusAutomationProviderResultContractResultStatus =
  | "completed"
  | "failed"
  | "blocked";

export interface NexusAutomationProviderResultContractMetadata {
  status: NexusAutomationProviderResultContractStatus;
  file: string | null;
  resultStatus: NexusAutomationProviderResultContractResultStatus | null;
  failureSummary: string | null;
}

export interface NexusAutomationProviderSessionRecord {
  providerId: string;
  executorMode: string | null;
  status: NexusAutomationProviderSessionStatus;
  purpose: string | null;
  runId: string;
  componentId: string | null;
  workItemId: string | null;
  worktreeId: string | null;
  cwd: string | null;
  profileId: string | null;
  model: string | null;
  reasoning: string | null;
  sessionId: string | null;
  turnId: string | null;
  sourceSessionId: string | null;
  sourceTurnId: string | null;
  persistenceMode: string | null;
  sandbox: string | null;
  approvalPolicy: string | null;
  permissionProfile: string | null;
  terminalStatus: NexusAutomationProviderTerminalStatus;
  resultContract: NexusAutomationProviderResultContractMetadata;
  failureSummary: string | null;
}

export type NexusAutomationCodexAppServerGoalOperationStatus =
  | "not_requested"
  | "unsupported"
  | "set"
  | "read"
  | "unavailable"
  | "failed";

export interface NexusAutomationCodexAppServerGoalMetadata {
  requested: boolean;
  setMethodAvailable: boolean;
  getMethodAvailable: boolean;
  setStatus: NexusAutomationCodexAppServerGoalOperationStatus;
  readStatus: NexusAutomationCodexAppServerGoalOperationStatus;
  goalId: string | null;
  threadId: string | null;
  status: string | null;
  tokenBudget: number | null;
  tokensUsed: number | null;
  timeUsedSeconds: number | null;
  failureSummary: string | null;
  policy: NexusCodexGoalsPolicyDecision | null;
}

export interface NexusAutomationCodexAppServerLaunchMetadata {
  provider: "codex-app-server";
  status: NexusAutomationCodexAppServerLaunchStatus;
  action: "thread_start" | "thread_fork";
  runId: string;
  profileId: string;
  threadId: string | null;
  turnId: string | null;
  sourceThreadId: string | null;
  sourceTurnId: string | null;
  ephemeral: boolean;
  threadPersistence: "ephemeral" | "durable";
  cwd: string;
  model: string | null;
  reasoning: string | null;
  resultFile: string;
  failureSummary: string | null;
  goal: NexusAutomationCodexAppServerGoalMetadata | null;
}
