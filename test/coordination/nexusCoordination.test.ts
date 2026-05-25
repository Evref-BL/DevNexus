import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  coordinationHandoffCommentMarker,
  createDefaultNexusHomeConfigBase,
  createLocalWorkTrackerProvider,
  createNexusCoordinationHandoff,
  createOrRefreshNexusWorktreeLease,
  defaultNexusAutomationConfig,
  getNexusCoordinationStatus,
  getNexusCoordinationIntegrationPlan,
  loadLocalWorkTrackingStore,
  saveNexusHomeConfigFile,
  saveProjectConfig,
  type GitCommandResult,
  type GitRunner,
  type NexusProjectConfig,
  validateNexusHomeConfigBase,
} from "../../src/index.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function saveCoordinationAuthHomeConfig(homePath: string): void {
  saveNexusHomeConfigFile(
    homePath,
    createDefaultNexusHomeConfigBase(homePath, {
      projectsRoot: path.join(homePath, "projects"),
      workspacesRoot: path.join(homePath, "workspaces"),
      authProfiles: [
        {
          id: "bot-github",
          actorId: "coordination-bot",
          provider: "github",
          kind: "automation",
          account: "coordination-bot",
          sshHost: "github.com-bot",
          githubCliConfigDir: "home:.config/gh-coordination-bot",
          environmentKeys: ["GH_CONFIG_DIR"],
        },
      ],
    }),
    validateNexusHomeConfigBase,
  );
}

function projectConfig(
  sourceRoot: string,
  worktreesRoot: string,
  storePath: string,
): NexusProjectConfig {
  return {
    version: 1,
    id: "coordination-demo",
    name: "Coordination Demo",
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
    components: [
      {
        id: "dev-nexus",
        name: "DevNexus",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/dev-nexus.git",
        defaultBranch: "main",
        sourceRoot,
        worktreesRoot,
        workTracking: {
          provider: "local",
          storePath,
        },
        relationships: [],
      },
    ],
  };
}

function coordinationTrackerProjectConfig(options: {
  sourceRoot: string;
  worktreesRoot: string;
  primaryStorePath: string;
  coordinationStorePath: string;
}): NexusProjectConfig {
  return {
    version: 1,
    id: "coordination-demo",
    name: "Coordination Demo",
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
    components: [
      {
        id: "dev-nexus",
        name: "DevNexus",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/dev-nexus.git",
        defaultBranch: "main",
        sourceRoot: options.sourceRoot,
        worktreesRoot: options.worktreesRoot,
        defaultWorkTrackerId: "primary",
        workTrackers: [
          {
            id: "primary",
            name: "Primary",
            enabled: true,
            roles: ["primary"],
            workTracking: {
              provider: "local",
              storePath: options.primaryStorePath,
            },
          },
          {
            id: "coordination",
            name: "Coordination",
            enabled: true,
            roles: ["coordination"],
            workTracking: {
              provider: "local",
              storePath: options.coordinationStorePath,
            },
          },
        ],
        relationships: [],
      },
    ],
  };
}

function providerCoordinationProjectConfig(options: {
  sourceRoot: string;
  worktreesRoot: string;
  primaryStorePath: string;
  projectCommunication?: NexusProjectConfig["workTrackerCommunication"];
  coordinationCommunication?: NonNullable<
    NonNullable<NexusProjectConfig["components"][number]["workTrackers"]>[number]["communication"]
  >;
}): NexusProjectConfig {
  return {
    version: 1,
    id: "coordination-demo",
    name: "Coordination Demo",
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
    ...(options.projectCommunication
      ? { workTrackerCommunication: options.projectCommunication }
      : {}),
    components: [
      {
        id: "dev-nexus",
        name: "DevNexus",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/dev-nexus.git",
        defaultBranch: "main",
        sourceRoot: options.sourceRoot,
        worktreesRoot: options.worktreesRoot,
        defaultWorkTrackerId: "primary",
        workTrackers: [
          {
            id: "primary",
            name: "Primary",
            enabled: true,
            roles: ["primary"],
            workTracking: {
              provider: "local",
              storePath: options.primaryStorePath,
            },
          },
          {
            id: "coordination",
            name: "GitHub Coordination",
            enabled: true,
            roles: ["coordination"],
            ...(options.coordinationCommunication
              ? { communication: options.coordinationCommunication }
              : {}),
            workTracking: {
              provider: "github",
              repository: {
                owner: "example",
                name: "demo",
              },
            },
          },
        ],
        relationships: [],
      },
    ],
  };
}

function unsupportedProviderCoordinationProjectConfig(options: {
  sourceRoot: string;
  worktreesRoot: string;
  primaryStorePath: string;
}): NexusProjectConfig {
  const config = providerCoordinationProjectConfig(options);
  config.components[0]!.workTrackers[1] = {
    id: "coordination",
    name: "GitLab Coordination",
    enabled: true,
    roles: ["coordination"],
    workTracking: {
      provider: "gitlab",
      repository: {
        id: "example/demo",
      },
    },
  };
  return config;
}

function multiComponentProjectConfig(options: {
  primarySourceRoot: string;
  primaryWorktreesRoot: string;
  primaryStorePath: string;
  addonSourceRoot: string;
  addonWorktreesRoot: string;
  addonStorePath: string;
}): NexusProjectConfig {
  return {
    version: 1,
    id: "coordination-demo",
    name: "Coordination Demo",
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: "main",
    },
    worktreesRoot: "worktrees",
    components: [
      {
        id: "primary",
        name: "Primary",
        kind: "git",
        role: "primary",
        remoteUrl: "git@example.invalid:demo/primary.git",
        defaultBranch: "main",
        sourceRoot: options.primarySourceRoot,
        worktreesRoot: options.primaryWorktreesRoot,
        workTracking: {
          provider: "local",
          storePath: options.primaryStorePath,
        },
        relationships: [],
      },
      {
        id: "addon",
        name: "Addon",
        kind: "git",
        role: "addon",
        remoteUrl: "git@example.invalid:demo/addon.git",
        defaultBranch: "main",
        sourceRoot: options.addonSourceRoot,
        worktreesRoot: options.addonWorktreesRoot,
        workTracking: {
          provider: "local",
          storePath: options.addonStorePath,
        },
        relationships: [
          {
            kind: "extends",
            componentId: "primary",
          },
        ],
      },
    ],
  };
}

function fakeGitRunner(
  repositoryPath: string,
  calls: Array<{ args: string[]; cwd?: string }>,
  overrides: {
    status?: string;
    aheadBehind?: string;
    upstreamExitCode?: number;
    branch?: string;
    head?: string;
    changedFiles?: string[];
  } = {},
): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    const joined = argsArray.join(" ");
    if (joined === "rev-parse --show-toplevel") {
      return ok(argsArray, `${repositoryPath}\n`);
    }
    if (joined === "symbolic-ref --short HEAD") {
      return ok(argsArray, `${overrides.branch ?? "codex/shared-coordination"}\n`);
    }
    if (joined === "rev-parse HEAD") {
      return ok(argsArray, `${overrides.head ?? "abc123def456"}\n`);
    }
    if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return {
        args: argsArray,
        stdout:
          overrides.upstreamExitCode === 1
            ? ""
            : `origin/${overrides.branch ?? "codex/shared-coordination"}\n`,
        stderr: "",
        exitCode: overrides.upstreamExitCode ?? 0,
      };
    }
    if (joined === "status --porcelain=v1") {
      return ok(argsArray, overrides.status ?? "");
    }
    if (joined === "rev-list --left-right --count HEAD...@{u}") {
      return ok(argsArray, overrides.aheadBehind ?? "0\t0\n");
    }
    if (
      joined === "diff --name-only HEAD" ||
      joined === "ls-files --others --exclude-standard"
    ) {
      return ok(argsArray, `${overrides.changedFiles?.join("\n") ?? ""}\n`);
    }

    return ok(argsArray, "");
  };
}

interface FakeIntegrationBranch {
  head: string;
  mergeBase: string;
  changedFiles: string[];
  mergeStatus?: "clean" | "conflict";
  conflictFiles?: string[];
  messages?: string[];
  rangeDiff?: string[];
}

function fakeIntegrationGitRunner(
  repositoryPath: string,
  calls: Array<{ args: string[]; cwd?: string }>,
  options: {
    currentBranch?: string;
    currentHead?: string;
    mainHead?: string;
    upstreamExitCode?: number;
    branches?: Record<string, FakeIntegrationBranch>;
  } = {},
): GitRunner {
  const mainHead = options.mainHead ?? "1111111111111111111111111111111111111111";
  const currentBranch = options.currentBranch ?? "main";
  const currentHead = options.currentHead ?? mainHead;
  const branches = options.branches ?? {};

  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    const joined = argsArray.join(" ");

    if (joined === "rev-parse --show-toplevel") {
      return ok(argsArray, `${repositoryPath}\n`);
    }
    if (joined === "symbolic-ref --short HEAD") {
      return ok(argsArray, `${currentBranch}\n`);
    }
    if (joined === "rev-parse HEAD") {
      return ok(argsArray, `${currentHead}\n`);
    }
    if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") {
      return {
        args: argsArray,
        stdout: options.upstreamExitCode === 1 ? "" : `origin/${currentBranch}\n`,
        stderr: "",
        exitCode: options.upstreamExitCode ?? 0,
      };
    }
    if (joined === "status --porcelain=v1") {
      return ok(argsArray, "");
    }
    if (joined === "rev-list --left-right --count HEAD...@{u}") {
      return ok(argsArray, "0\t0\n");
    }
    if (argsArray[0] === "rev-parse" && argsArray[1] === "--verify") {
      const ref = argsArray[2];
      if (ref === "main" || ref === "origin/main") {
        return ok(argsArray, `${mainHead}\n`);
      }
      const branch = ref ? branches[ref] : undefined;
      return ok(argsArray, `${branch?.head ?? currentHead}\n`);
    }
    if (argsArray[0] === "merge-base") {
      const branch = branches[argsArray[2] ?? ""];
      return ok(argsArray, `${branch?.mergeBase ?? mainHead}\n`);
    }
    if (
      argsArray[0] === "diff" &&
      argsArray[1] === "--name-only" &&
      argsArray[2]?.includes("...")
    ) {
      const branchName = argsArray[2].split("...").at(1) ?? "";
      const branch = branches[branchName];
      return ok(argsArray, `${branch?.changedFiles.join("\n") ?? ""}\n`);
    }
    if (joined.startsWith("merge-tree --write-tree --quiet ")) {
      const branch = branches[argsArray.at(-1) ?? ""];
      return {
        args: argsArray,
        stdout: branch?.mergeStatus === "conflict" ? "" : `${mainHead}\n`,
        stderr: "",
        exitCode: branch?.mergeStatus === "conflict" ? 1 : 0,
      };
    }
    if (joined.startsWith("merge-tree --write-tree --name-only --messages ")) {
      const branch = branches[argsArray.at(-1) ?? ""];
      const outputLines = branch?.mergeStatus === "conflict"
        ? [
            ...(branch.conflictFiles ?? []),
            ...(branch.messages ?? []),
          ]
        : [];
      return ok(argsArray, `${outputLines.join("\n")}\n`);
    }
    if (argsArray[0] === "range-diff") {
      const branchArg = argsArray[2] ?? "";
      const branchName = branchArg.split("..").at(1) ?? "";
      const branch = branches[branchName];
      return ok(argsArray, `${branch?.rangeDiff?.join("\n") ?? ""}\n`);
    }

    return ok(argsArray, "");
  };
}

function ok(args: string[], stdout: string): GitCommandResult {
  return {
    args,
    stdout,
    stderr: "",
    exitCode: 0,
  };
}

function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function writeTrackerLink(options: {
  projectRoot: string;
  projectId: string;
  componentId: string;
  logicalItemId: string;
  trackerId: string;
  trackerName: string;
  itemId: string;
  itemNumber?: number | null;
  provider?: string;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  timestamp: string;
}): void {
  writeText(
    path.join(options.projectRoot, ".dev-nexus", "work-item-links.json"),
    `${JSON.stringify(
      {
        version: 1,
        nextAuditNumber: 1,
        updatedAt: options.timestamp,
        records: [
          {
            projectId: options.projectId,
            componentId: options.componentId,
            logicalItemId: options.logicalItemId,
            createdAt: options.timestamp,
            updatedAt: options.timestamp,
            references: [
              {
                trackerId: options.trackerId,
                trackerName: options.trackerName,
                provider: options.provider ?? "local",
                host: null,
                repositoryId: null,
                repositoryOwner: options.repositoryOwner ?? null,
                repositoryName: options.repositoryName ?? null,
                projectId: null,
                boardId: null,
                itemId: options.itemId,
                itemNumber: options.itemNumber ?? null,
                itemKey: null,
                nodeId: null,
                webUrl: null,
                firstObservedAt: options.timestamp,
                lastObservedAt: options.timestamp,
              },
            ],
            audit: [],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function holdStoreLock(storePath: string): () => void {
  const lockPath = `${storePath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const handle = fs.openSync(lockPath, "wx");
  try {
    fs.writeFileSync(handle, "external test lock\n", "utf8");
  } finally {
    fs.closeSync(handle);
  }

  return () => fs.rmSync(lockPath, { force: true });
}

function initCoordinationProjectFixture(name: string): {
  projectRoot: string;
  sourceRoot: string;
  storePath: string;
} {
  const projectRoot = makeTempDir(`dev-nexus-${name}-project-`);
  const sourceRoot = path.join(projectRoot, "source");
  const storePath = ".dev-nexus/work-items-dev-nexus.json";
  fs.mkdirSync(sourceRoot, { recursive: true });
  saveProjectConfig(
    projectRoot,
    projectConfig(sourceRoot, "worktrees/dev-nexus", storePath),
  );

  return { projectRoot, sourceRoot, storePath };
}

async function createFixtureWorkItem(
  projectRoot: string,
  storePath: string,
  title: string,
): Promise<string> {
  const item = await createLocalWorkTrackerProvider({
    projectRoot,
    config: { provider: "local", storePath },
    now: () => "2026-05-16T09:00:00.000Z",
  }).createWorkItem({
    projectRoot,
    title,
    status: "in_progress",
  });

  return item.id;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("nexus coordination", () => {
  it("normalizes component-qualified and provider-local ids across coordination tools", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const primarySourceRoot = path.join(projectRoot, "components", "primary");
    const addonSourceRoot = path.join(projectRoot, "components", "addon");
    const primaryWorktreesRoot = path.join(projectRoot, "worktrees", "primary");
    const addonWorktreesRoot = path.join(projectRoot, "worktrees", "addon");
    const addonWorktreePath = path.join(addonWorktreesRoot, "local-60");
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const addonStorePath = ".dev-nexus/work-items-addon.json";
    fs.mkdirSync(primarySourceRoot, { recursive: true });
    fs.mkdirSync(addonSourceRoot, { recursive: true });
    fs.mkdirSync(addonWorktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      multiComponentProjectConfig({
        primarySourceRoot,
        primaryWorktreesRoot,
        primaryStorePath,
        addonSourceRoot,
        addonWorktreesRoot,
        addonStorePath,
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: addonStorePath },
      now: () => "2026-05-17T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Addon coordination",
      status: "in_progress",
    });
    const gitRunner = fakeGitRunner(addonWorktreePath, []);

    const handoff = await createNexusCoordinationHandoff({
      projectRoot,
      workItemId: "addon:local-1",
      status: "ready",
      currentPath: projectRoot,
      gitRunner,
      now: () => "2026-05-17T10:00:00.000Z",
    });
    const qualifiedStatus = await getNexusCoordinationStatus({
      projectRoot,
      workItemId: "addon:local-1",
      currentPath: projectRoot,
      gitRunner,
      now: () => "2026-05-17T10:05:00.000Z",
    });
    const providerLocalStatus = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "addon",
      workItemId: "local-1",
      currentPath: projectRoot,
      gitRunner,
      now: () => "2026-05-17T10:10:00.000Z",
    });
    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      workItemId: "addon:local-1",
      targetBranch: "main",
      currentPath: projectRoot,
      gitRunner,
      now: () => "2026-05-17T10:15:00.000Z",
    });

    expect(handoff).toMatchObject({
      component: {
        id: "addon",
      },
      record: {
        componentId: "addon",
        workItemId: "local-1",
      },
      comment: {
        id: "local-comment-1",
      },
    });
    expect(qualifiedStatus).toMatchObject({
      component: {
        id: "addon",
      },
      workItem: {
        id: "local-1",
        title: "Addon coordination",
      },
      handoffs: {
        records: [
          {
            workItemId: "local-1",
            componentId: "addon",
          },
        ],
      },
    });
    expect(providerLocalStatus.component.id).toBe("addon");
    expect(providerLocalStatus.workItem?.title).toBe("Addon coordination");
    expect(plan).toMatchObject({
      component: {
        id: "addon",
      },
      scope: "work_item",
      handoffs: {
        totalCount: 1,
      },
    });
  });

  it("defaults component-scoped handoff Git facts to the selected component source root", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const primarySourceRoot = path.join(projectRoot, "components", "primary");
    const addonSourceRoot = path.join(projectRoot, "components", "addon");
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const addonStorePath = ".dev-nexus/work-items-addon.json";
    fs.mkdirSync(primarySourceRoot, { recursive: true });
    fs.mkdirSync(addonSourceRoot, { recursive: true });
    saveProjectConfig(
      projectRoot,
      multiComponentProjectConfig({
        primarySourceRoot,
        primaryWorktreesRoot: path.join(projectRoot, "worktrees", "primary"),
        primaryStorePath,
        addonSourceRoot,
        addonWorktreesRoot: path.join(projectRoot, "worktrees", "addon"),
        addonStorePath,
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: addonStorePath },
      now: () => "2026-05-17T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Addon coordination",
      status: "in_progress",
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const handoff = await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "addon",
      workItemId: "local-1",
      status: "ready",
      gitRunner: fakeGitRunner(addonSourceRoot, gitCalls),
      now: () => "2026-05-17T10:00:00.000Z",
    });

    expect(gitCalls[0]).toMatchObject({
      args: ["rev-parse", "--show-toplevel"],
      cwd: addonSourceRoot,
    });
    expect(handoff.record).toMatchObject({
      componentId: "addon",
      repositoryPath: addonSourceRoot,
      branch: "codex/shared-coordination",
    });
  });

  it("asks for currentPath when a component-scoped coordination path has no source checkout", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "components", "missing-dev-nexus");
    saveProjectConfig(
      projectRoot,
      projectConfig(
        sourceRoot,
        path.join(projectRoot, "worktrees", "dev-nexus"),
        ".dev-nexus/work-items-dev-nexus.json",
      ),
    );
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const failingGitRunner: GitRunner = (args: readonly string[], cwd?: string) => {
      const argsArray = [...args];
      gitCalls.push({ args: argsArray, cwd });
      return {
        args: argsArray,
        stdout: "",
        stderr: "not a git repository",
        exitCode: 1,
      };
    };

    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      gitRunner: failingGitRunner,
    });

    expect(gitCalls[0]).toMatchObject({
      args: ["rev-parse", "--show-toplevel"],
      cwd: sourceRoot,
    });
    expect(status.git.repositoryPath).toBeNull();
    expect(status.warnings.join("\n")).toContain("Pass currentPath");
  });

  it("rejects mismatched and ambiguous provider-local coordination ids with tracker diagnostics", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const primarySourceRoot = path.join(projectRoot, "components", "primary");
    const addonSourceRoot = path.join(projectRoot, "components", "addon");
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const addonStorePath = ".dev-nexus/work-items-addon.json";
    fs.mkdirSync(primarySourceRoot, { recursive: true });
    fs.mkdirSync(addonSourceRoot, { recursive: true });
    saveProjectConfig(
      projectRoot,
      multiComponentProjectConfig({
        primarySourceRoot,
        primaryWorktreesRoot: path.join(projectRoot, "worktrees", "primary"),
        primaryStorePath,
        addonSourceRoot,
        addonWorktreesRoot: path.join(projectRoot, "worktrees", "addon"),
        addonStorePath,
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: () => "2026-05-17T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Primary duplicate id",
      status: "ready",
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: addonStorePath },
      now: () => "2026-05-17T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Addon duplicate id",
      status: "ready",
    });

    await expect(
      getNexusCoordinationStatus({
        projectRoot,
        componentId: "primary",
        workItemId: "addon:local-1",
        currentPath: projectRoot,
        gitRunner: fakeGitRunner(projectRoot, []),
      }),
    ).rejects.toThrow(
      /component "addon" conflicts with requested component "primary".*provider-local id "local-1".*requested tracker: local.*id tracker: local/u,
    );
    await expect(
      getNexusCoordinationStatus({
        projectRoot,
        workItemId: "local-1",
        currentPath: projectRoot,
        gitRunner: fakeGitRunner(projectRoot, []),
      }),
    ).rejects.toThrow(
      /Provider-local work item id "local-1" is ambiguous.*primary \(tracker: local\).*addon \(tracker: local\)/u,
    );
    await expect(
      getNexusCoordinationStatus({
        projectRoot,
        componentId: "addon",
        workItemId: "local-99",
        currentPath: projectRoot,
        gitRunner: fakeGitRunner(projectRoot, []),
      }),
    ).rejects.toThrow(
      /requested component "addon" provider-local id "local-99" using tracker "local": Local work item not found: local-99/u,
    );
  });

  it("records structured tracker-backed handoffs and reports current git status", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-14");
    const storePath = ".dev-nexus/work-items-dev-nexus.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, {
      ...projectConfig(sourceRoot, "worktrees/dev-nexus", storePath),
      automation: {
        ...defaultNexusAutomationConfig,
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "review_handoff",
          actor: {
            id: "coordination-bot",
            kind: "machine_user",
            provider: "github",
            handle: "coordination-bot",
          },
        },
      },
      authority: {
        actors: [
          {
            id: "coordination-bot",
            kind: "machine_user",
            provider: "github",
            providerIdentity: "coordination-bot",
            displayName: "Coordination Bot",
          },
        ],
        roleBindings: [
          {
            actorId: "coordination-bot",
            roles: ["contributor"],
            scope: {
              component: "dev-nexus",
            },
          },
        ],
      },
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath },
      now: () => "2026-05-16T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Shared coordination",
      status: "in_progress",
    });
    const qualityDelta = {
      producer: "static-analysis",
      sourcePath: ".quality/static-analysis-delta.json",
      readOnly: true,
      status: "regressed",
      touchedFiles: ["src/nexusCoordination.ts"],
      summary: {
        newFindingCount: 3,
        resolvedFindingCount: 0,
        touchedNewFindingCount: 2,
        touchedResolvedFindingCount: 0,
        newCriticalOrBlockerCount: 1,
        newBugCount: 1,
        newVulnerabilityCount: 1,
        newSecurityHotspotCount: 1,
        qualityGateRegressed: true,
      },
      attention: [
        {
          id: "sonar-issue:bug",
          source: "sonar_issue",
          category: "bug",
          severity: "blocker",
          filePath: "src/nexusCoordination.ts",
          line: 42,
          rule: "complexity:S3776",
          message: "Reduce cognitive complexity.",
        },
      ],
    };
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const handoff = await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      status: "ready",
      hostId: "windows-devbox",
      agentId: "codex",
      changedAreas: ["src/nexusCoordination.ts"],
      decisions: ["Use advisory handoffs instead of locks."],
      verificationSummary: "npm test passed",
      integrationPreference: "direct_integration",
      qualityDelta,
      note: "Ready to merge.",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, gitCalls),
      now: () => "2026-05-16T10:00:00.000Z",
    });

    expect(handoff.record).toMatchObject({
      kind: "dev-nexus.coordination.handoff",
      version: 1,
      projectId: "coordination-demo",
      componentId: "dev-nexus",
      workItemId: "local-1",
      hostId: "windows-devbox",
      agentId: "codex",
      status: "ready",
      leaseId: handoff.lease.id,
      branch: "codex/shared-coordination",
      upstream: "origin/codex/shared-coordination",
      headCommit: "abc123def456",
      dirty: false,
      pushed: true,
      changedAreas: ["src/nexusCoordination.ts"],
      qualityDelta: {
        producer: "static-analysis",
        status: "regressed",
        sourcePath: ".quality/static-analysis-delta.json",
        touchedFiles: ["src/nexusCoordination.ts"],
        summary: {
          newFindingCount: 3,
          touchedNewFindingCount: 2,
          newCriticalOrBlockerCount: 1,
          newBugCount: 1,
          newVulnerabilityCount: 1,
          newSecurityHotspotCount: 1,
          qualityGateRegressed: true,
        },
        attention: [
          {
            category: "bug",
            severity: "blocker",
            rule: "complexity:S3776",
            filePath: "src/nexusCoordination.ts",
            line: 42,
          },
        ],
      },
    });
    expect(handoff.lease).toMatchObject({
      projectId: "coordination-demo",
      hostId: "windows-devbox",
      agentId: "codex",
      workItemId: "local-1",
      status: "ready",
      lastObservedHeadCommit: "abc123def456",
      dirty: false,
      pushed: true,
      worktree: {
        kind: "component_worktree",
        relativePath: "local-14",
      },
      writeScope: ["src/nexusCoordination.ts"],
    });
    expect(handoff.comment.body).toContain(coordinationHandoffCommentMarker);
    expect(handoff.comment.body).toContain(
      "Quality delta: regressed; 3 new finding(s); 2 on touched file(s); 1 critical/blocker; 1 bug(s); 1 vulnerability issue(s); 1 security hotspot(s); quality gate regressed",
    );
    const store = loadLocalWorkTrackingStore(path.join(projectRoot, storePath));
    expect(store.comments["local-1"]?.[0]?.body).toContain(
      coordinationHandoffCommentMarker,
    );

    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(status).toMatchObject({
      project: {
        id: "coordination-demo",
      },
      component: {
        id: "dev-nexus",
      },
      workItem: {
        id: "local-1",
      },
      git: {
        repositoryPath: worktreePath,
        branch: "codex/shared-coordination",
        upstream: "origin/codex/shared-coordination",
        ahead: 0,
        behind: 0,
        dirty: false,
        pushed: true,
      },
      leases: {
        activeCount: 1,
        blocking: false,
        records: [
          {
            id: handoff.lease.id,
            status: "ready",
            stale: false,
          },
        ],
      },
      handoffs: {
        available: true,
        records: [
          {
            status: "ready",
            stale: false,
          },
        ],
      },
      authority: {
        componentId: "dev-nexus",
        actor: {
          actorId: "coordination-bot",
        },
        roles: ["contributor"],
        blockedActions: expect.arrayContaining(["git.push_target_branch"]),
        fallbackActions: expect.arrayContaining(["provider.pull_request.open"]),
      },
      nextAction: "Ready for review or integration.",
    });
  });

  it("preserves porcelain status columns when counting dirty files", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "status");
    const storePath = ".dev-nexus/work-items-dev-nexus.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig(sourceRoot, "worktrees/dev-nexus", storePath),
    );

    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, [], {
        status:
          " M src/unstaged.ts\nM  src/staged.ts\nMM src/both.ts\n?? src/new.ts\n",
      }),
    });

    expect(status.git).toMatchObject({
      dirty: true,
      stagedCount: 2,
      unstagedCount: 2,
      untrackedCount: 1,
    });
  });

  it("groups active coordination activity and reports overlap, stale leases, and branch blockers", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const currentWorktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "current");
    const ownedWorktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "owned");
    const otherWorktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "other");
    const staleWorktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "stale");
    const storePath = ".dev-nexus/work-items-dev-nexus.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(currentWorktreePath, { recursive: true });
    fs.mkdirSync(ownedWorktreePath, { recursive: true });
    fs.mkdirSync(otherWorktreePath, { recursive: true });
    fs.mkdirSync(staleWorktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      projectConfig(sourceRoot, "worktrees/dev-nexus", storePath),
    );
    const workItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Parallel status",
    );
    createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: os.hostname(),
      agentId: "codex-owned",
      workItemId,
      branchName: "codex/dev-nexus/owned",
      worktreePath: ownedWorktreePath,
      writeScope: ["src/coordination"],
      status: "working",
      gitFacts: {
        headCommit: "owned123",
        dirty: false,
        pushed: true,
        upstream: "origin/codex/dev-nexus/owned",
      },
      now: () => "2026-05-16T10:00:00.000Z",
    });
    createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "other-host",
      agentId: "codex-other",
      workItemId: "local-99",
      branchName: "codex/dev-nexus/other",
      worktreePath: otherWorktreePath,
      writeScope: ["src/coordination/nexusCoordination.ts"],
      status: "working",
      gitFacts: {
        headCommit: "other123",
        dirty: true,
        stagedCount: 1,
        pushed: false,
        ahead: 2,
        upstream: null,
      },
      now: () => "2026-05-16T10:05:00.000Z",
    });
    createOrRefreshNexusWorktreeLease({
      projectRoot,
      componentId: "dev-nexus",
      hostId: "old-host",
      agentId: "codex-stale",
      workItemId: "local-100",
      branchName: "codex/dev-nexus/stale",
      worktreePath: staleWorktreePath,
      writeScope: ["docs"],
      status: "working",
      gitFacts: {
        headCommit: "stale123",
        dirty: false,
        pushed: true,
        upstream: "origin/codex/dev-nexus/stale",
      },
      now: () => "2026-05-15T09:00:00.000Z",
    });

    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      currentPath: currentWorktreePath,
      gitRunner: fakeGitRunner(currentWorktreePath, [], {
        status: " M src/coordination/nexusCoordination.ts\n",
        aheadBehind: "1\t0\n",
        upstreamExitCode: 1,
        changedFiles: ["src/coordination/nexusCoordination.ts"],
      }),
      now: () => "2026-05-16T10:30:00.000Z",
      maxLeaseAgeMs: 60 * 60 * 1000,
    });

    expect(status.git).toMatchObject({
      dirty: true,
      upstream: null,
      ahead: null,
      pushed: null,
      changedFiles: ["src/coordination/nexusCoordination.ts"],
    });
    expect(status.activity).toMatchObject({
      activeGroupCount: 2,
      staleGroupCount: 1,
      overlapCount: 2,
      dirtyGeneratedWorktree: true,
      dirtySharedCheckout: false,
      currentBranch: {
        missingUpstream: true,
        unpushed: false,
      },
      authority: {
        missingSummary: true,
      },
    });
    expect(status.activity.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          branch: "codex/dev-nexus/owned",
          ownership: "current_host",
          active: true,
          overlap: expect.objectContaining({
            likely: true,
            granularity: "package",
          }),
          nextAction: "Continue or hand off the owned active worktree.",
        }),
        expect.objectContaining({
          branch: "codex/dev-nexus/other",
          ownership: "other_host",
          active: true,
          dirty: true,
          unpushed: true,
          missingUpstream: true,
          overlap: expect.objectContaining({
            likely: true,
            granularity: "file",
          }),
          nextAction: "Coordinate before editing overlapping active work.",
        }),
        expect.objectContaining({
          branch: "codex/dev-nexus/stale",
          stale: true,
          nextAction: "Run cleanup dry-run or refresh the stale lease.",
        }),
      ]),
    );
    expect(status.activity.nextAction).toBe(
      "Review, commit, or hand off current worktree changes before starting parallel work.",
    );
  });

  it("uses host-local auth profiles in coordination authority status", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const homePath = makeTempDir("dev-nexus-coordination-home-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-15");
    const storePath = ".dev-nexus/work-items-dev-nexus.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveCoordinationAuthHomeConfig(homePath);
    saveProjectConfig(projectRoot, {
      ...projectConfig(sourceRoot, "worktrees/dev-nexus", storePath),
      home: homePath,
      automation: {
        ...defaultNexusAutomationConfig,
        publication: {
          ...defaultNexusAutomationConfig.publication,
          strategy: "direct_integration",
          remote: "bot",
          targetBranch: "main",
          actor: {
            id: "coordination-bot",
            kind: "machine_user",
            provider: "github",
            handle: "coordination-bot",
          },
        },
      },
      authority: {
        actors: [
          {
            id: "coordination-bot",
            kind: "machine_user",
            provider: "github",
            providerIdentity: "coordination-bot",
            displayName: "Coordination Bot",
          },
        ],
        roleBindings: [
          {
            actorId: "coordination-bot",
            roles: ["maintainer"],
            scope: {
              component: "dev-nexus",
            },
          },
        ],
      },
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath },
      now: () => "2026-05-16T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Shared coordination",
      status: "in_progress",
    });

    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(status.authority).toMatchObject({
      componentId: "dev-nexus",
      actor: {
        status: "matched",
        actorId: "coordination-bot",
      },
      authProfile: {
        id: "bot-github",
        provider: "github",
        kind: "automation",
      },
      roles: ["maintainer"],
    });
    expect(status.authority.warnings).not.toContain(
      "No host-local auth profile is bound to automation actor coordination-bot.",
    );
  });

  it("writes and reads handoffs from a linked coordination-role tracker", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-50");
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    const coordinationStorePath = ".dev-nexus/work-items-coordination.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      coordinationTrackerProjectConfig({
        sourceRoot,
        worktreesRoot: "worktrees/dev-nexus",
        primaryStorePath,
        coordinationStorePath,
      }),
    );
    const primaryItem = await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: () => "2026-05-18T08:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Primary selected item",
      status: "in_progress",
    });
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: coordinationStorePath },
      now: () => "2026-05-18T08:01:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Unrelated coordination item",
      status: "ready",
    });
    const coordinationItem = await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: coordinationStorePath },
      now: () => "2026-05-18T08:02:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Coordination mirror item",
      status: "in_progress",
    });
    writeTrackerLink({
      projectRoot,
      projectId: "coordination-demo",
      componentId: "dev-nexus",
      logicalItemId: primaryItem.id,
      trackerId: "coordination",
      trackerName: "Coordination",
      itemId: coordinationItem.id,
      timestamp: "2026-05-18T08:03:00.000Z",
    });

    const handoff = await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: primaryItem.id,
      trackerRole: "coordination",
      status: "ready",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-18T08:10:00.000Z",
    });
    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: primaryItem.id,
      trackerId: "coordination",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-18T08:15:00.000Z",
    });
    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: primaryItem.id,
      trackerRole: "coordination",
      targetBranch: "main",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-18T08:20:00.000Z",
    });

    expect(handoff).toMatchObject({
      record: {
        workItemId: primaryItem.id,
        logicalItemId: primaryItem.id,
        selectedWorkItemRef: {
          trackerId: "primary",
          itemId: primaryItem.id,
        },
        coordinationTargetRef: {
          trackerId: "coordination",
          itemId: coordinationItem.id,
        },
      },
      comment: {
        trackerRef: {
          trackerId: "coordination",
          default: false,
        },
      },
    });
    expect(status).toMatchObject({
      workItem: {
        id: primaryItem.id,
        title: "Primary selected item",
        trackerRef: {
          trackerId: "primary",
          default: true,
        },
      },
      coordinationTracker: {
        trackerId: "coordination",
        selection: "explicit_id",
      },
      handoffs: {
        trackerId: "coordination",
        records: [
          {
            workItemId: primaryItem.id,
            coordinationTargetRef: {
              trackerId: "coordination",
              itemId: coordinationItem.id,
            },
          },
        ],
      },
    });
    expect(plan).toMatchObject({
      handoffs: {
        trackerId: "coordination",
        totalCount: 1,
      },
    });
    expect(
      loadLocalWorkTrackingStore(path.join(projectRoot, primaryStorePath))
        .comments[primaryItem.id],
    ).toEqual([]);
    expect(
      loadLocalWorkTrackingStore(path.join(projectRoot, coordinationStorePath))
        .comments[coordinationItem.id],
    ).toHaveLength(1);
  });

  it("keeps GitHub coordination handoffs silent by default", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-181");
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      providerCoordinationProjectConfig({
        sourceRoot,
        worktreesRoot: "worktrees/dev-nexus",
        primaryStorePath,
      }),
    );
    const primaryItem = await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: () => "2026-05-18T08:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Primary selected item",
      status: "in_progress",
    });
    writeTrackerLink({
      projectRoot,
      projectId: "coordination-demo",
      componentId: "dev-nexus",
      logicalItemId: primaryItem.id,
      trackerId: "coordination",
      trackerName: "GitHub Coordination",
      itemId: "7",
      itemNumber: 7,
      provider: "github",
      repositoryOwner: "example",
      repositoryName: "demo",
      timestamp: "2026-05-18T08:03:00.000Z",
    });
    vi.stubGlobal("fetch", async () => {
      throw new Error("GitHub should not be called for silent handoff publication");
    });
    vi.stubEnv("GITHUB_TOKEN", "coordination-test-token");

    const handoff = await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: primaryItem.id,
      trackerRole: "coordination",
      status: "ready",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-18T08:10:00.000Z",
    });

    expect(handoff.comment).toBeNull();
    expect(handoff.record).toMatchObject({
      workItemId: primaryItem.id,
      coordinationTargetRef: {
        trackerId: "coordination",
        provider: "github",
        itemId: "7",
      },
    });
    expect(handoff.lease).toMatchObject({
      status: "ready",
      workItemId: primaryItem.id,
      branchName: "codex/shared-coordination",
    });
  });

  it("lets GitHub coordination trackers opt in to handoff comments", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-182");
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      providerCoordinationProjectConfig({
        sourceRoot,
        worktreesRoot: "worktrees/dev-nexus",
        primaryStorePath,
        coordinationCommunication: {
          coordinationHandoffs: "comment",
        },
      }),
    );
    const primaryItem = await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: () => "2026-05-18T08:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Primary selected item",
      status: "in_progress",
    });
    writeTrackerLink({
      projectRoot,
      projectId: "coordination-demo",
      componentId: "dev-nexus",
      logicalItemId: primaryItem.id,
      trackerId: "coordination",
      trackerName: "GitHub Coordination",
      itemId: "7",
      itemNumber: 7,
      provider: "github",
      repositoryOwner: "example",
      repositoryName: "demo",
      timestamp: "2026-05-18T08:03:00.000Z",
    });
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fetchMock: typeof fetch = async (input, init = {}) => {
      calls.push({
        url: String(input),
        method: init.method,
      });
      return new Response(
        JSON.stringify({
          id: 9002,
          node_id: "IC_provider_handoff_write",
          body: JSON.parse(String(init.body)).body,
          user: { login: "devnexus-automation[bot]" },
          created_at: "2026-05-18T08:10:00.000Z",
          updated_at: "2026-05-18T08:10:00.000Z",
          html_url: "https://github.com/example/demo/issues/7#issuecomment-9002",
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GITHUB_TOKEN", "coordination-test-token");

    const handoff = await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: primaryItem.id,
      trackerRole: "coordination",
      status: "ready",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-18T08:10:00.000Z",
    });

    expect(handoff.comment).toMatchObject({
      id: "github-comment-9002",
      trackerRef: {
        trackerId: "coordination",
      },
    });
    expect(calls).toEqual([
      {
        url: "https://api.github.com/repos/example/demo/issues/7/comments",
        method: "POST",
      },
    ]);
  });

  it("reads GitHub-backed coordination handoffs from provider comments", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-180");
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      providerCoordinationProjectConfig({
        sourceRoot,
        worktreesRoot: "worktrees/dev-nexus",
        primaryStorePath,
      }),
    );

    const record = {
      kind: "dev-nexus.coordination.handoff",
      version: 1,
      createdAt: "2026-05-18T08:00:00.000Z",
      projectId: "coordination-demo",
      projectRoot,
      componentId: "dev-nexus",
      componentName: "DevNexus",
      workItemId: "github-7",
      logicalItemId: "github-7",
      selectedWorkItemRef: null,
      coordinationTargetRef: null,
      trackerReferences: [],
      hostId: "linux-host",
      agentId: "codex",
      status: "ready",
      leaseId: null,
      repositoryPath: worktreePath,
      branch: "codex/provider-handoff",
      upstream: "origin/codex/provider-handoff",
      baseRef: "origin/main",
      headCommit: "abc123def456",
      dirty: false,
      ahead: 1,
      behind: 0,
      pushed: true,
      changedAreas: ["src/nexusCoordination.ts"],
      decisions: ["Read GitHub coordination comments."],
      verificationSummary: "focused tests passed",
      integrationPreference: "review_handoff",
      note: "provider readback",
    };
    const bodies = [
      [
        {
          id: 7001,
          number: 7,
          title: "Provider handoff target",
          body: null,
          state: "open",
          labels: [],
          assignees: [],
          created_at: "2026-05-18T07:55:00.000Z",
          updated_at: "2026-05-18T08:05:00.000Z",
          html_url: "https://github.com/example/demo/issues/7",
        },
      ],
      [
        {
          id: 9001,
          node_id: "IC_provider_handoff",
          body: [
            coordinationHandoffCommentMarker,
            "",
            "```json",
            JSON.stringify(record, null, 2),
            "```",
          ].join("\n"),
          user: { login: "devnexus-automation[bot]" },
          created_at: "2026-05-18T08:01:00.000Z",
          updated_at: "2026-05-18T08:01:00.000Z",
          html_url:
            "https://github.com/example/demo/issues/7#issuecomment-9001",
        },
      ],
    ];
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fetchMock: typeof fetch = async (input, init = {}) => {
      calls.push({
        url: String(input),
        method: init.method,
      });
      const body = bodies.shift();
      if (!body) {
        return new Response(JSON.stringify({ message: "unexpected request" }), {
          status: 500,
        });
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GITHUB_TOKEN", "coordination-test-token");

    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      trackerRole: "coordination",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-18T08:15:00.000Z",
    });

    expect(status.handoffs).toMatchObject({
      available: true,
      capability: {
        read: true,
        write: true,
      },
      trackerId: "coordination",
      provider: "github",
      diagnostics: [],
      warnings: [],
      records: [
        {
          workItemId: "github-7",
          status: "ready",
          branch: "codex/provider-handoff",
          commentId: "github-comment-9001",
          changedAreas: ["src/nexusCoordination.ts"],
          decisions: ["Read GitHub coordination comments."],
        },
      ],
    });
    expect(calls).toEqual([
      {
        url: "https://api.github.com/repos/example/demo/issues?state=all&per_page=100&page=1",
        method: "GET",
      },
      {
        url: "https://api.github.com/repos/example/demo/issues/7/comments?per_page=100&page=1",
        method: "GET",
      },
    ]);
  });

  it("marks non-GitHub provider-backed coordination handoffs incomplete and blocks write-only records", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-179");
    const primaryStorePath = ".dev-nexus/work-items-primary.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(
      projectRoot,
      unsupportedProviderCoordinationProjectConfig({
        sourceRoot,
        worktreesRoot: "worktrees/dev-nexus",
        primaryStorePath,
      }),
    );
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath: primaryStorePath },
      now: () => "2026-05-18T08:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Primary selected item",
      status: "in_progress",
    });

    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      trackerRole: "coordination",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-18T08:15:00.000Z",
    });
    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      trackerRole: "coordination",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-18T08:20:00.000Z",
    });

    expect(status.handoffs).toMatchObject({
      available: false,
      capability: {
        read: false,
        write: false,
      },
      diagnostics: [
        {
          kind: "coordination_provider_capability_unavailable",
          severity: "warning",
          capability: "read_handoffs",
          operation: "readCoordinationHandoffs",
          trackerId: "coordination",
          provider: "gitlab",
        },
      ],
    });
    expect(status.nextAction).toContain("Use a local coordination tracker");
    expect(plan.handoffs).toMatchObject({
      available: false,
      capability: {
        read: false,
        write: false,
      },
    });
    expect(plan.nextAction).toContain("Use a local coordination tracker");

    await expect(
      createNexusCoordinationHandoff({
        projectRoot,
        componentId: "dev-nexus",
        workItemId: "local-1",
        trackerRole: "coordination",
        status: "ready",
        currentPath: worktreePath,
        gitRunner: fakeGitRunner(worktreePath, []),
        now: () => "2026-05-18T08:30:00.000Z",
      }),
    ).rejects.toMatchObject({
      diagnostic: {
        kind: "coordination_provider_capability_unavailable",
        severity: "error",
        capability: "write_handoffs",
        operation: "createCoordinationHandoff",
        trackerId: "coordination",
        provider: "gitlab",
      },
    });
    expect(
      loadLocalWorkTrackingStore(path.join(projectRoot, primaryStorePath))
        .comments["local-1"],
    ).toEqual([]);
  });

  it("treats stale handoffs as advisory warnings, not locks", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-14");
    const storePath = ".dev-nexus/work-items-dev-nexus.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig(sourceRoot, "worktrees/dev-nexus", storePath));
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath },
      now: () => "2026-05-16T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Shared coordination",
      status: "in_progress",
    });
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      status: "working",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-16T10:00:00.000Z",
    });

    const status = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(status.handoffs.records[0]).toMatchObject({
      status: "working",
      stale: true,
    });
    expect(status.handoffs.warnings).toContain(
      "Handoff for local-1 from 2026-05-16T10:00:00.000Z is stale.",
    );
    expect(status.blocking).toBe(false);
  });

  it("serializes concurrent local-provider coordination handoffs", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-59");
    const storePath = ".dev-nexus/work-items-dev-nexus.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, projectConfig(sourceRoot, "worktrees/dev-nexus", storePath));
    await createLocalWorkTrackerProvider({
      projectRoot,
      config: { provider: "local", storePath },
      now: () => "2026-05-16T09:00:00.000Z",
    }).createWorkItem({
      projectRoot,
      title: "Concurrent handoffs",
      status: "in_progress",
    });

    const absoluteStorePath = path.join(projectRoot, storePath);
    const releaseLock = holdStoreLock(absoluteStorePath);
    const statuses = ["working", "ready", "blocked", "merged"] as const;
    let completed = false;
    const handoffs = Promise.all(
      statuses.map((status, index) =>
        createNexusCoordinationHandoff({
          projectRoot,
          componentId: "dev-nexus",
          workItemId: "local-1",
          status,
          hostId: `host-${index}`,
          agentId: "codex",
          changedAreas: [`src/area-${index}.ts`],
          decisions: [`Decision ${index}`],
          currentPath: worktreePath,
          gitRunner: fakeGitRunner(worktreePath, []),
          now: () => `2026-05-16T10:0${index}:00.000Z`,
        }),
      ),
    ).then((result) => {
      completed = true;
      return result;
    });

    try {
      await sleep(25);
      expect(completed).toBe(false);
    } finally {
      releaseLock();
    }

    const results = await handoffs;
    const commentIds = results.map((result) => result.comment.id);
    expect(new Set(commentIds).size).toBe(4);

    const rawStore = fs.readFileSync(absoluteStorePath, "utf8");
    expect(() => JSON.parse(rawStore)).not.toThrow();
    const store = loadLocalWorkTrackingStore(absoluteStorePath);
    const comments = store.comments["local-1"] ?? [];
    expect(comments).toHaveLength(4);
    expect(new Set(comments.map((comment) => comment.id)).size).toBe(4);
    expect(comments.every((comment) =>
      comment.body.includes(coordinationHandoffCommentMarker),
    )).toBe(true);

    const coordinationStatus = await getNexusCoordinationStatus({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: "local-1",
      currentPath: worktreePath,
      gitRunner: fakeGitRunner(worktreePath, []),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(coordinationStatus.handoffs.records).toHaveLength(4);
    expect(coordinationStatus.handoffs.records.map((record) => record.status))
      .toEqual(expect.arrayContaining([...statuses]));
  });

  it("plans a clean handoff branch merge without mutating the source checkout", async () => {
    const { projectRoot, sourceRoot, storePath } =
      initCoordinationProjectFixture("coordination-clean");
    const workItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Clean integration",
    );
    const mainCommit = "1111111111111111111111111111111111111111";
    const featureCommit = "2222222222222222222222222222222222222222";
    const branches = {
      "codex/clean-branch": {
        head: featureCommit,
        mergeBase: mainCommit,
        changedFiles: ["src/clean.ts"],
        mergeStatus: "clean" as const,
      },
    };
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      status: "ready",
      hostId: "windows-devbox",
      agentId: "codex",
      changedAreas: ["src/clean.ts"],
      decisions: ["Keep the integration planner read-only."],
      verificationSummary: "focused tests passed",
      integrationPreference: "direct_integration",
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "codex/clean-branch",
        currentHead: featureCommit,
        mainHead: mainCommit,
        upstreamExitCode: 1,
        branches,
      }),
      now: () => "2026-05-16T10:00:00.000Z",
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      targetBranch: "main",
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, gitCalls, {
        currentBranch: "main",
        currentHead: mainCommit,
        mainHead: mainCommit,
        branches,
      }),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(plan.mutatesSource).toBe(false);
    expect(plan.target.ref).toBe("main");
    expect(plan.branches).toMatchObject([
      {
        branch: "codex/clean-branch",
        headCommit: featureCommit,
        merge: {
          status: "clean",
          changedFiles: ["src/clean.ts"],
          conflictFiles: [],
        },
        handoff: {
          decisions: ["Keep the integration planner read-only."],
          integrationPreference: "direct_integration",
          stale: false,
        },
      },
    ]);
    expect(plan.suggestedOrder.map((step) => step.branch)).toEqual([
      "codex/clean-branch",
    ]);
    expect(
      gitCalls.filter((call) =>
        ["checkout", "merge", "reset", "switch"].includes(call.args[0] ?? ""),
      ),
    ).toEqual([]);
    expect(gitCalls.map((call) => call.args.join(" "))).toContain(
      "merge-tree --write-tree --quiet main codex/clean-branch",
    );
  });

  it("plans component integration from the component repository when current path is the project repo", async () => {
    const { projectRoot, sourceRoot, storePath } =
      initCoordinationProjectFixture("coordination-component-repo");
    const workItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Component repo integration",
    );
    const projectMainCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const componentMainCommit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const featureCommit = "cccccccccccccccccccccccccccccccccccccccc";
    const branches = {
      "codex/component-clean-branch": {
        head: featureCommit,
        mergeBase: componentMainCommit,
        changedFiles: ["src/component-clean.ts"],
        mergeStatus: "clean" as const,
      },
    };
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      status: "ready",
      changedAreas: ["src/component-clean.ts"],
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "codex/component-clean-branch",
        currentHead: featureCommit,
        mainHead: componentMainCommit,
        upstreamExitCode: 1,
        branches,
      }),
      now: () => "2026-05-16T10:00:00.000Z",
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];
    const componentRunner = fakeIntegrationGitRunner(sourceRoot, gitCalls, {
      currentBranch: "main",
      currentHead: componentMainCommit,
      mainHead: componentMainCommit,
      branches,
    });
    const projectRunner = fakeIntegrationGitRunner(projectRoot, gitCalls, {
      currentBranch: "main",
      currentHead: projectMainCommit,
      mainHead: projectMainCommit,
      branches: {},
    });
    const gitRunner: GitRunner = (args, cwd) =>
      cwd === sourceRoot ? componentRunner(args, cwd) : projectRunner(args, cwd);

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      targetBranch: "main",
      currentPath: projectRoot,
      gitRunner,
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(plan.target.commit).toBe(componentMainCommit);
    expect(plan.target.commit).not.toBe(projectMainCommit);
    expect(plan.branches).toMatchObject([
      {
        branch: "codex/component-clean-branch",
        merge: {
          status: "clean",
          targetCommit: componentMainCommit,
          changedFiles: ["src/component-clean.ts"],
        },
      },
    ]);
    expect(gitCalls[0]).toMatchObject({
      args: ["rev-parse", "--show-toplevel"],
      cwd: sourceRoot,
    });
  }, 15000);

  it("warns when a handoff was based on the default branch for a non-default integration target", async () => {
    const { projectRoot, sourceRoot, storePath } =
      initCoordinationProjectFixture("coordination-base-mismatch");
    const workItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Feature target integration",
    );
    const mainCommit = "1111111111111111111111111111111111111111";
    const featureTargetCommit = "2222222222222222222222222222222222222222";
    const workerCommit = "3333333333333333333333333333333333333333";
    const branches = {
      "codex/default-based-worker": {
        head: workerCommit,
        mergeBase: mainCommit,
        changedFiles: ["src/feature-target.ts"],
        mergeStatus: "clean" as const,
      },
      "feature/target": {
        head: featureTargetCommit,
        mergeBase: mainCommit,
        changedFiles: [],
        mergeStatus: "clean" as const,
      },
    };
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      status: "ready",
      changedAreas: ["src/feature-target.ts"],
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "codex/default-based-worker",
        currentHead: workerCommit,
        mainHead: mainCommit,
        upstreamExitCode: 1,
        branches,
      }),
      now: () => "2026-05-16T10:00:00.000Z",
    });

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      targetBranch: "feature/target",
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "feature/target",
        currentHead: featureTargetCommit,
        mainHead: mainCommit,
        branches,
      }),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "based on default branch main while integration target is feature/target",
        ),
      ]),
    );
  });

  it("reports concise textual conflicts from merge-tree", async () => {
    const { projectRoot, sourceRoot, storePath } =
      initCoordinationProjectFixture("coordination-conflict");
    const workItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Conflicting integration",
    );
    const mainCommit = "1111111111111111111111111111111111111111";
    const featureCommit = "3333333333333333333333333333333333333333";
    const branches = {
      "codex/conflicting-branch": {
        head: featureCommit,
        mergeBase: mainCommit,
        changedFiles: ["settings.txt"],
        mergeStatus: "conflict" as const,
        conflictFiles: ["settings.txt"],
        messages: ["CONFLICT (content): Merge conflict in settings.txt"],
      },
    };
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      status: "ready",
      changedAreas: ["settings.txt"],
      decisions: ["Feature branch owns the settings mode."],
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "codex/conflicting-branch",
        currentHead: featureCommit,
        mainHead: mainCommit,
        upstreamExitCode: 1,
        branches,
      }),
      now: () => "2026-05-16T10:00:00.000Z",
    });

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      targetBranch: "main",
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "main",
        currentHead: mainCommit,
        mainHead: mainCommit,
        branches,
      }),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(plan.branches).toMatchObject([
      {
        branch: "codex/conflicting-branch",
        merge: {
          status: "conflict",
          conflictFiles: ["settings.txt"],
        },
      },
    ]);
    expect(plan.branches[0]!.merge.summary).toContain("settings.txt");
    expect(plan.branches[0]!.merge.messages.join("\n").length).toBeLessThan(800);
    expect(plan.nextAction).toContain("Resolve textual conflicts");
  });

  it("surfaces competing recorded decisions before recommending merge order", async () => {
    const { projectRoot, sourceRoot, storePath } =
      initCoordinationProjectFixture("coordination-decisions");
    const firstWorkItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "First decision",
    );
    const secondWorkItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Second decision",
    );
    const mainCommit = "1111111111111111111111111111111111111111";
    const jsonCommit = "4444444444444444444444444444444444444444";
    const yamlCommit = "5555555555555555555555555555555555555555";
    const branches = {
      "codex/use-json": {
        head: jsonCommit,
        mergeBase: mainCommit,
        changedFiles: ["src/json.ts"],
        mergeStatus: "clean" as const,
      },
      "codex/use-yaml": {
        head: yamlCommit,
        mergeBase: mainCommit,
        changedFiles: ["src/yaml.ts"],
        mergeStatus: "clean" as const,
      },
    };
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: firstWorkItemId,
      status: "ready",
      changedAreas: ["src/contracts.ts"],
      decisions: ["Represent integration facts as JSON records."],
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "codex/use-json",
        currentHead: jsonCommit,
        mainHead: mainCommit,
        upstreamExitCode: 1,
        branches,
      }),
      now: () => "2026-05-16T10:00:00.000Z",
    });
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId: secondWorkItemId,
      status: "ready",
      changedAreas: ["src/contracts.ts"],
      decisions: ["Represent integration facts as YAML records."],
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "codex/use-yaml",
        currentHead: yamlCommit,
        mainHead: mainCommit,
        upstreamExitCode: 1,
        branches,
      }),
      now: () => "2026-05-16T10:05:00.000Z",
    });

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      targetBranch: "main",
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "main",
        currentHead: mainCommit,
        mainHead: mainCommit,
        branches,
      }),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(plan.decisionConflicts).toMatchObject([
      {
        kind: "changed_area",
        changedArea: "src/contracts.ts",
        branches: expect.arrayContaining(["codex/use-json", "codex/use-yaml"]),
      },
    ]);
    expect(plan.suggestedOrder).toEqual([]);
    expect(plan.nextAction).toContain("Resolve competing handoff decisions");
  });

  it("keeps stale handoffs visible but excludes them from the suggested order", async () => {
    const { projectRoot, sourceRoot, storePath } =
      initCoordinationProjectFixture("coordination-stale");
    const workItemId = await createFixtureWorkItem(
      projectRoot,
      storePath,
      "Stale integration",
    );
    const mainCommit = "1111111111111111111111111111111111111111";
    const staleCommit = "6666666666666666666666666666666666666666";
    const branches = {
      "codex/stale-branch": {
        head: staleCommit,
        mergeBase: mainCommit,
        changedFiles: ["src/stale.ts"],
        mergeStatus: "clean" as const,
      },
    };
    await createNexusCoordinationHandoff({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      status: "ready",
      changedAreas: ["src/stale.ts"],
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "codex/stale-branch",
        currentHead: staleCommit,
        mainHead: mainCommit,
        upstreamExitCode: 1,
        branches,
      }),
      now: () => "2026-05-16T10:00:00.000Z",
    });

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      workItemId,
      targetBranch: "main",
      currentPath: sourceRoot,
      gitRunner: fakeIntegrationGitRunner(sourceRoot, [], {
        currentBranch: "main",
        currentHead: mainCommit,
        mainHead: mainCommit,
        branches,
      }),
      now: () => "2026-05-18T10:00:00.000Z",
    });

    expect(plan.handoffs.staleCount).toBe(1);
    expect(plan.branches).toMatchObject([
      {
        branch: "codex/stale-branch",
        stale: true,
        merge: {
          status: "skipped",
        },
      },
    ]);
    expect(plan.suggestedOrder).toEqual([]);
    expect(plan.warnings).toContain(
      "Handoff for local-1 from 2026-05-16T10:00:00.000Z is stale.",
    );
  });

  it("fetches configured remotes only when automation safety allows host mutation", async () => {
    const projectRoot = makeTempDir("dev-nexus-coordination-fetch-project-");
    const sourceRoot = path.join(projectRoot, "source");
    const worktreePath = path.join(projectRoot, "worktrees", "dev-nexus", "local-15");
    const storePath = ".dev-nexus/work-items-dev-nexus.json";
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, {
      ...projectConfig(sourceRoot, "worktrees/dev-nexus", storePath),
      automation: {
        ...defaultNexusAutomationConfig,
        safety: {
          ...defaultNexusAutomationConfig.safety,
          allowHostMutation: true,
        },
        publication: {
          ...defaultNexusAutomationConfig.publication,
          remote: "origin",
          targetBranch: "main",
        },
      },
    });
    const gitCalls: Array<{ args: string[]; cwd?: string }> = [];

    const plan = await getNexusCoordinationIntegrationPlan({
      projectRoot,
      componentId: "dev-nexus",
      currentPath: worktreePath,
      fetch: true,
      gitRunner: fakeGitRunner(worktreePath, gitCalls),
      now: () => "2026-05-16T10:15:00.000Z",
    });

    expect(plan.fetch).toMatchObject({
      requested: true,
      allowed: true,
      remote: "origin",
      targetBranch: "main",
      ran: true,
      exitCode: 0,
    });
    expect(plan.target.ref).toBe("origin/main");
    expect(gitCalls.map((call) => call.args)).toContainEqual([
      "fetch",
      "--prune",
      "origin",
      "main",
    ]);
    expect(plan.mutatesSource).toBe(false);
  });
});
