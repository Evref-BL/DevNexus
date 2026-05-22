export type NexusAutomationCodexAppServerLaunchStatus =
  | "started"
  | "completed"
  | "failed"
  | "blocked";

export interface NexusAutomationCodexAppServerGoalMetadata {
  requested: boolean;
  set: boolean;
  readAvailable: boolean;
  goalId: string | null;
  threadId: string | null;
  status: string | null;
  tokenBudget: number | null;
  tokensUsed: number | null;
  timeUsedMs: number | null;
  unavailableReason: string | null;
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
