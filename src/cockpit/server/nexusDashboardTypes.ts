import type { NexusAutomationStatus, GetNexusAutomationStatusOptions } from "../../automation/nexusAutomationStatus.js";
import type { NexusAutomationTargetReport } from "../../automation/nexusAutomationTargetReport.js";
import type { ResolvedNexusProjectComponent } from "../../project/nexusProjectLifecycle.js";
import type { NexusEligibleWorkMode, NexusEligibleWorkSummary } from "../../work-items/nexusEligibleWorkSummary.js";
import type { GitRunner } from "../../worktrees/gitWorktreeService.js";
import type { NexusDashboardGitHistorySummary } from "./nexusDashboardGitHistory.js";
import type { NexusDashboardGitWorkflowSummary } from "./nexusDashboardGitWorkflows.js";
import type { NexusDashboardEmbeddingContract } from "./nexusDashboardEmbeddingContractTypes.js";
import type { NexusDashboardProviderAction } from "./nexusDashboardProviderActions.js";

export type {
  NexusDashboardContractOwner,
  NexusDashboardContractScope,
  NexusDashboardContractSelection,
  NexusDashboardContractSurface,
  NexusDashboardContractSurfaceId,
  NexusDashboardEmbeddingContract,
} from "./nexusDashboardEmbeddingContractTypes.js";

export type NexusDashboardSignalTone =
  | "good"
  | "active"
  | "warn"
  | "danger"
  | "neutral";

export type NexusDashboardEventSource =
  | "actual"
  | "derived"
  | "warning";

export type NexusDashboardEventSeverity =
  | "info"
  | "success"
  | "warning"
  | "danger";

export type NexusDashboardWeaveNodeKind =
  | "project"
  | "component"
  | "tracker"
  | "source"
  | "branch"
  | "commit"
  | "worktree"
  | "work-item"
  | "target-cycle"
  | "run"
  | "authority"
  | "blocker";

export type NexusDashboardWeaveEdgeKind =
  | "contains"
  | "tracks"
  | "owns"
  | "checks-out"
  | "points-to"
  | "records"
  | "selected"
  | "blocked-by"
  | "published-by";

export interface BuildNexusDashboardSnapshotOptions
  extends Pick<
    GetNexusAutomationStatusOptions,
    "homePath" | "env" | "credentialResolver" | "provider" | "providerFactory" | "providerOptions"
  > {
  projectRoot: string;
  eligibleWorkMode?: NexusEligibleWorkMode;
  gitRunner?: GitRunner;
  historyBranches?: string[];
  historyMaxCommits?: number;
  now?: () => Date | string;
}

export interface NexusDashboardDataError {
  name: string;
  message: string;
}

export interface NexusDashboardDataResult<T> {
  ok: boolean;
  value: T | null;
  error: NexusDashboardDataError | null;
}

export interface NexusDashboardSignal {
  id: string;
  label: string;
  value: string;
  tone: NexusDashboardSignalTone;
  detail: string;
}

export interface NexusDashboardGitState {
  repositoryPath: string;
  branch: string | null;
  upstream: string | null;
  headCommit: string | null;
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  ahead: number | null;
  behind: number | null;
  warnings: string[];
}

export interface NexusDashboardComponentSummary {
  id: string;
  name: string;
  kind: ResolvedNexusProjectComponent["kind"];
  role: ResolvedNexusProjectComponent["role"];
  remoteUrl: string | null;
  sourceRoot: string;
  sourceRootExists: boolean;
  worktreesRoot: string;
  defaultTrackerId: string | null;
  trackerProviders: string[];
  verificationRequired: boolean;
  publicationStrategy: string | null;
  git: NexusDashboardGitState | null;
}

export interface NexusDashboardProjectSummary {
  id: string;
  name: string;
  root: string;
  componentCount: number;
  defaultBranch: string | null;
  remoteUrl: string | null;
}

export interface NexusDashboardPublicationSummary {
  componentId: string | null;
  strategy: string;
  targetBranch: string | null;
  remote: string | null;
  blocking: boolean;
  actorStatus: string | null;
  authorityStatus: string | null;
  warnings: string[];
}

export interface NexusDashboardAuthoritySummary {
  summary: string;
  warningCount: number;
  blockedActionCount: number;
  waitingActionCount: number;
  fallbackActionCount: number;
  components: Array<{
    componentId: string;
    actorStatus: string;
    roles: string[];
    blockedActions: string[];
    warnings: string[];
  }>;
}

export interface NexusDashboardWorktreeSummary {
  activeCount: number;
  staleCount: number;
  warnings: string[];
  records: Array<{
    id: string;
    componentId: string | null;
    workItemId: string | null;
    status: string;
    effectiveStatus: string;
    branchName: string | null;
    worktreePath: string | null;
    hostId: string;
    agentId: string | null;
    stale: boolean;
    dirty: boolean | null;
    pushed: boolean | null;
    updatedAt: string;
    writeScope: string[];
  }>;
}

export type NexusDashboardThreadDecision =
  | "continue"
  | "resume"
  | "review"
  | "archive"
  | "forget"
  | "rescue"
  | "merged"
  | "blocked";

export interface NexusDashboardThreadRecord {
  id: string;
  title: string;
  componentId: string | null;
  workItemId: string | null;
  branchName: string | null;
  hostId: string;
  agentId: string | null;
  state: string;
  decision: NexusDashboardThreadDecision;
  decisionLabel: string;
  decisionDetail: string;
  stale: boolean;
  dirty: boolean | null;
  pushed: boolean | null;
  cleanupSafe: boolean | null;
  cleanupBlockers: string[];
  assistantProvider: "codex" | null;
  assistantThreadId: string | null;
  updatedAt: string;
  actions: NexusDashboardProviderAction[];
}

export interface NexusDashboardThreadSummary {
  totalCount: number;
  activeCount: number;
  needsDecisionCount: number;
  archiveCandidateCount: number;
  forgetCandidateCount: number;
  source?: "cleanup" | "local";
  incomplete?: boolean;
  detail?: string | null;
  records: NexusDashboardThreadRecord[];
}

export interface NexusDashboardPluginRecord {
  id: string;
  name: string;
  version: string | null;
  enabled: boolean;
  state: "enabled" | "disabled" | "available";
  source: "configured" | "catalogue";
  packageName: string | null;
  sourcePath: string | null;
  repositoryUrl: string | null;
  configExportName: string | null;
  installCommand: string | null;
  refreshCommand: string | null;
  detail: string;
  capabilityCount: number;
  projectedSkillCount: number;
  mcpServerCount: number;
  setupActionCount: number;
  dependencyProjectionCount: number;
  projectedSkills: string[];
  mcpServers: string[];
  setupHints: string[];
  dependencyHints: string[];
}

export interface NexusDashboardPluginSummary {
  totalCount: number;
  enabledCount: number;
  configuredCount: number;
  availableCount: number;
  capabilityCount: number;
  records: NexusDashboardPluginRecord[];
}

export type NexusDashboardSettingsScope =
  | "built-in"
  | "project"
  | "workspace"
  | "host-local"
  | "auth-profile"
  | "secret-store"
  | "session";

export type NexusDashboardSettingsMutationState =
  | "editable"
  | "preview-only"
  | "read-only"
  | "blocked";

export type NexusDashboardSettingsSensitivity =
  | "public"
  | "local"
  | "sensitive"
  | "secret";

export interface NexusDashboardSettingsItem {
  id: string;
  label: string;
  scope: NexusDashboardSettingsScope;
  source: string | null;
  effectiveValue: string;
  sensitivity: NexusDashboardSettingsSensitivity;
  mutationState: NexusDashboardSettingsMutationState;
  mutationContract: string | null;
  detail: string;
  blocker: string | null;
}

export interface NexusDashboardSettingsCategory {
  id: string;
  label: string;
  summary: string;
  primaryScope: NexusDashboardSettingsScope;
  mutationState: NexusDashboardSettingsMutationState;
  itemCount: number;
  editableCount: number;
  blockedCount: number;
  readOnlyCount: number;
  secretCount: number;
  items: NexusDashboardSettingsItem[];
}

export interface NexusDashboardSettingsSummary {
  totalCategoryCount: number;
  editableCategoryCount: number;
  blockedCategoryCount: number;
  redactedSecretCount: number;
  categories: NexusDashboardSettingsCategory[];
}

export type NexusDashboardTrackedWorkKind =
  | "blocked"
  | "ready"
  | "import-candidate"
  | "stale"
  | "excluded";

export interface NexusDashboardTrackedWorkItem {
  id: string;
  logicalItemId: string | null;
  componentId: string;
  componentName: string;
  title: string;
  status: string;
  kind: NexusDashboardTrackedWorkKind;
  kindLabel: string;
  detail: string;
  provider: string | null;
  trackerId: string | null;
  updatedAt: string | null;
  webUrl: string | null;
  actions: NexusDashboardProviderAction[];
}

export interface NexusDashboardTrackedWorkSummary {
  totalCount: number;
  blockedCount?: number;
  readyCount: number;
  importCandidateCount: number;
  staleCount: number;
  excludedCount: number;
  source?: "provider" | "local";
  incomplete?: boolean;
  detail?: string | null;
  records: NexusDashboardTrackedWorkItem[];
}

export type NexusDashboardFeatureStatus =
  | "planned"
  | "active"
  | "needs-review"
  | "blocked"
  | "ready";

export interface NexusDashboardFeatureRecord {
  id: string;
  title: string;
  featureId: string;
  componentIds: string[];
  componentNames: string[];
  releaseTrainVersionId: string | null;
  branchStrategy: string;
  status: NexusDashboardFeatureStatus;
  statusLabel: string;
  tone: NexusDashboardSignalTone;
  detail: string;
  featureBranch: string | null;
  reviewBranchPattern: string;
  defaultChangeBaseBranch: string;
  finalReviewTarget: string;
  finalPublicationTarget: string;
  reviewMode: string;
  finalPullRequestCreation: string;
  commentPolicy: string;
  threadCount: number;
  activeThreadCount: number;
  needsDecisionCount: number;
  branchCount: number;
  branches: string[];
  updatedAt: string | null;
  warnings: string[];
}

export interface NexusDashboardFeatureSummary {
  totalCount: number;
  activeCount: number;
  needsAttentionCount: number;
  records: NexusDashboardFeatureRecord[];
  incomplete?: boolean;
  detail?: string | null;
}

export interface NexusDashboardEvent {
  id: string;
  time: string;
  source: NexusDashboardEventSource;
  severity: NexusDashboardEventSeverity;
  title: string;
  body: string;
  relatedNodeIds: string[];
  href: string | null;
  actions: NexusDashboardProviderAction[];
}

export interface NexusDashboardWeaveLane {
  id: string;
  label: string;
  nodeIds: string[];
}

export interface NexusDashboardWeaveNode {
  id: string;
  kind: NexusDashboardWeaveNodeKind;
  laneId: string;
  label: string;
  detail: string;
  status: string;
  timestamp: string | null;
  href: string | null;
  actions: NexusDashboardProviderAction[];
}

export interface NexusDashboardWeaveEdge {
  id: string;
  kind: NexusDashboardWeaveEdgeKind;
  from: string;
  to: string;
  label: string;
}

export interface NexusDashboardWeave {
  version: 1;
  generatedAt: string;
  lanes: NexusDashboardWeaveLane[];
  nodes: NexusDashboardWeaveNode[];
  edges: NexusDashboardWeaveEdge[];
}

export interface NexusDashboardSnapshot {
  version: 1;
  contract: NexusDashboardEmbeddingContract;
  partial?: boolean;
  loadedSections?: string[];
  generatedAt: string;
  projectRoot: string;
  project: NexusDashboardProjectSummary;
  summary: string;
  signals: NexusDashboardSignal[];
  components: NexusDashboardComponentSummary[];
  history: NexusDashboardGitHistorySummary;
  automation: NexusDashboardDataResult<NexusAutomationStatus>;
  eligibleWork: NexusDashboardDataResult<NexusEligibleWorkSummary>;
  targetReport: NexusDashboardDataResult<NexusAutomationTargetReport>;
  worktrees: NexusDashboardWorktreeSummary;
  threads: NexusDashboardThreadSummary;
  features: NexusDashboardFeatureSummary;
  gitWorkflows: NexusDashboardGitWorkflowSummary;
  plugins: NexusDashboardPluginSummary;
  settings: NexusDashboardSettingsSummary;
  trackedWork: NexusDashboardTrackedWorkSummary;
  publication: NexusDashboardPublicationSummary[];
  authority: NexusDashboardAuthoritySummary | null;
  blockers: string[];
  events: NexusDashboardEvent[];
  weave: NexusDashboardWeave;
}

export type NexusDashboardWorkspaceSectionId =
  | "components"
  | "plugins"
  | "threads"
  | "tracked-work";

export interface NexusDashboardWorkspaceSectionPayload {
  version: 1;
  generatedAt: string;
  projectRoot: string;
  section: NexusDashboardWorkspaceSectionId;
  patch: Partial<NexusDashboardSnapshot>;
}

export interface BuildNexusDashboardHostSnapshotOptions
  extends Pick<
    BuildNexusDashboardSnapshotOptions,
    | "homePath"
    | "env"
    | "credentialResolver"
    | "provider"
    | "providerFactory"
    | "providerOptions"
    | "eligibleWorkMode"
    | "gitRunner"
    | "now"
  > {
  projectRoot?: string;
  currentProjectRoot?: string | null;
}

export type NexusDashboardHostActionKind =
  | "workspace-error"
  | "approval"
  | "blocker"
  | "thread"
  | "dirty"
  | "ready-work";

export interface NexusDashboardHostWorkspaceRecord {
  id: string;
  name: string;
  root: string;
  registered: boolean;
  current: boolean;
  loading?: boolean;
  generatedAt: string | null;
  summary: string;
  tone: NexusDashboardSignalTone;
  componentCount: number;
  dirtyComponentCount: number;
  threadCount: number;
  needsDecisionCount: number;
  staleThreadCount: number;
  approvalCount: number;
  blockerCount: number;
  pluginCount: number;
  automationStatus: string | null;
  eligibleWorkCount: number | null;
  firstReadyWorkSelectionId: string | null;
  firstReadyWorkProviderAction: NexusDashboardProviderAction | null;
  actionUpdatedAt: Partial<Record<NexusDashboardHostActionKind, string | null>>;
  updatedAt: string | null;
  error: NexusDashboardDataError | null;
}

export interface NexusDashboardHostPrimaryAction {
  label: string;
  kind: "open-workspace" | "review" | "rescue" | "start-work";
  workspaceId: string;
  targetSelectionId: string | null;
}

export interface NexusDashboardHostActionItem {
  id: string;
  kind: NexusDashboardHostActionKind;
  workspaceId: string;
  workspaceName: string;
  workspaceRoot: string;
  reason: string;
  detail: string;
  state: string;
  tone: NexusDashboardSignalTone;
  updatedAt: string | null;
  primaryAction: NexusDashboardHostPrimaryAction;
  providerAction: NexusDashboardProviderAction | null;
}

export interface NexusDashboardHostSnapshot {
  version: 1;
  contract: NexusDashboardEmbeddingContract;
  generatedAt: string;
  hostId: string;
  homePath: string;
  homeError: NexusDashboardDataError | null;
  currentProjectRoot: string | null;
  selectedWorkspaceId: string | null;
  workspaceCount: number;
  needsAttentionCount: number;
  partial?: boolean;
  actionQueue: NexusDashboardHostActionItem[];
  workspaces: NexusDashboardHostWorkspaceRecord[];
}
