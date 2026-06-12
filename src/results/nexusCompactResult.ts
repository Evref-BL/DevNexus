export const nexusCompactResultContract = "dev-nexus.result.compact.v1" as const;

export interface NexusCompactResultRetrievalHint {
  description: string;
  command?: string[];
  mcpTool?: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface NexusCompactResultOmission {
  path: string;
  omittedCount: number;
  reason: string;
  retrieval?: string;
}

export interface NexusCompactResultEnvelope<
  TSummary extends object,
  TStats extends object,
  TFinding extends object,
> {
  ok: true;
  contract: typeof nexusCompactResultContract;
  mode: "compact";
  kind: string;
  summary: TSummary;
  stats: TStats;
  findings: TFinding[];
  omitted: NexusCompactResultOmission[];
  retrieval: NexusCompactResultRetrievalHint[];
  nextCursor: string | null;
}
