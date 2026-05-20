import fs from "node:fs";
import path from "node:path";
import type {
  NexusProjectSetupAnswers,
  NexusProjectSetupComponentAnswers,
} from "./nexusProjectSetupModel.js";

export type NexusProjectComponentTopologyDiagnosticSeverity =
  | "error"
  | "warning";

export interface NexusProjectComponentTopologyDiagnostic {
  severity: NexusProjectComponentTopologyDiagnosticSeverity;
  path: string;
  componentId: string;
  sourceRoot: string;
  message: string;
}

export interface NexusProjectComponentTopologyFact {
  componentId: string;
  role: NexusProjectSetupComponentAnswers["role"];
  sourceKind: NexusProjectSetupComponentAnswers["source"]["kind"];
  sourceRoot: string;
  exists: boolean;
  isDirectory: boolean;
  isGitRepository: boolean;
  currentBranch: string | null;
  remotes: Record<string, string>;
  nestedGitRepositories: string[];
}

export interface NexusProjectComponentTopologyAnalysis {
  projectRoot: string;
  diagnostics: NexusProjectComponentTopologyDiagnostic[];
  components: NexusProjectComponentTopologyFact[];
}

export function analyzeNexusProjectSetupComponentTopology(
  answers: Pick<NexusProjectSetupAnswers, "project" | "components">,
): NexusProjectComponentTopologyAnalysis {
  const projectRoot = path.resolve(answers.project.root || ".");
  const diagnostics: NexusProjectComponentTopologyDiagnostic[] = [];
  const components = answers.components.map((component, index) =>
    analyzeComponentTopology({ projectRoot, component, index, diagnostics }),
  );

  return {
    projectRoot,
    diagnostics,
    components,
  };
}

export function findNestedGitRepositories(
  directoryPath: string,
  maxDepth = 2,
): string[] {
  if (!isDirectory(directoryPath)) {
    return [];
  }

  const repositories: string[] = [];
  visitNestedRepositories(directoryPath, directoryPath, maxDepth, repositories);
  return repositories.sort((left, right) => left.localeCompare(right));
}

function analyzeComponentTopology(options: {
  projectRoot: string;
  component: NexusProjectSetupComponentAnswers;
  index: number;
  diagnostics: NexusProjectComponentTopologyDiagnostic[];
}): NexusProjectComponentTopologyFact {
  const sourceRoot = setupComponentSourceRoot(options.projectRoot, options.component);
  const sourcePath = `components[${options.index}].source.path`;
  const exists = fs.existsSync(sourceRoot);
  const isDir = exists && isDirectory(sourceRoot);
  const gitInfo = isDir ? readGitInfo(sourceRoot) : emptyGitInfo();
  const nestedGitRepositories =
    isDir && !gitInfo.isGitRepository ? findNestedGitRepositories(sourceRoot) : [];
  const fact: NexusProjectComponentTopologyFact = {
    componentId: options.component.id,
    role: options.component.role,
    sourceKind: options.component.source.kind,
    sourceRoot,
    exists,
    isDirectory: isDir,
    isGitRepository: gitInfo.isGitRepository,
    currentBranch: gitInfo.currentBranch,
    remotes: gitInfo.remotes,
    nestedGitRepositories,
  };

  if (isInsideGeneratedWorktrees(options.projectRoot, sourceRoot)) {
    options.diagnostics.push(diagnostic({
      severity: "error",
      path: sourcePath,
      component: options.component,
      sourceRoot,
      message:
        "Component source roots must stay separate from generated worktrees; choose a stable checkout path outside worktrees/.",
    }));
  }

  switch (options.component.source.kind) {
    case "reference_existing":
      inspectExistingReference(options, fact, sourcePath);
      break;
    case "clone_project_local":
      inspectProjectLocalClone(options, fact, sourcePath);
      break;
    case "create_local":
      inspectCreateLocal(options, fact, sourcePath);
      break;
  }

  return fact;
}

function inspectExistingReference(
  options: {
    component: NexusProjectSetupComponentAnswers;
    diagnostics: NexusProjectComponentTopologyDiagnostic[];
  },
  fact: NexusProjectComponentTopologyFact,
  sourcePath: string,
): void {
  if (!fact.exists) {
    options.diagnostics.push(diagnostic({
      severity: "error",
      path: sourcePath,
      component: options.component,
      sourceRoot: fact.sourceRoot,
      message: "Existing component source path does not exist.",
    }));
    return;
  }

  if (!fact.isDirectory) {
    options.diagnostics.push(diagnostic({
      severity: "error",
      path: sourcePath,
      component: options.component,
      sourceRoot: fact.sourceRoot,
      message: "Existing component source path must be a directory.",
    }));
    return;
  }

  if (!fact.isGitRepository) {
    if (fact.nestedGitRepositories.length > 0) {
      options.diagnostics.push(diagnostic({
        severity: "warning",
        path: sourcePath,
        component: options.component,
        sourceRoot: fact.sourceRoot,
        message: `Source path looks like a container folder with nested Git repositories: ${fact.nestedGitRepositories.join(", ")}. Add the intended nested repositories as components instead of importing the container.`,
      }));
      return;
    }

    options.diagnostics.push(diagnostic({
      severity: "warning",
      path: sourcePath,
      component: options.component,
      sourceRoot: fact.sourceRoot,
      message: "Existing component source path is not a Git repository.",
    }));
    return;
  }

  const expectedBranch = options.component.source.defaultBranch;
  if (expectedBranch && fact.currentBranch && fact.currentBranch !== expectedBranch) {
    options.diagnostics.push(diagnostic({
      severity: "warning",
      path: `${sourcePath}.defaultBranch`,
      component: options.component,
      sourceRoot: fact.sourceRoot,
      message: `Configured default branch is ${expectedBranch}, but the checkout is currently on ${fact.currentBranch}.`,
    }));
  }

  const expectedRemote = options.component.source.remoteUrl;
  if (expectedRemote && !Object.values(fact.remotes).includes(expectedRemote)) {
    options.diagnostics.push(diagnostic({
      severity: "warning",
      path: `${sourcePath}.remoteUrl`,
      component: options.component,
      sourceRoot: fact.sourceRoot,
      message: "Configured remote URL was not found in the existing checkout remotes.",
    }));
  }
}

function inspectProjectLocalClone(
  options: {
    component: NexusProjectSetupComponentAnswers;
    diagnostics: NexusProjectComponentTopologyDiagnostic[];
  },
  fact: NexusProjectComponentTopologyFact,
  sourcePath: string,
): void {
  if (fact.exists && (!fact.isDirectory || directoryHasEntries(fact.sourceRoot))) {
    options.diagnostics.push(diagnostic({
      severity: "warning",
      path: sourcePath,
      component: options.component,
      sourceRoot: fact.sourceRoot,
      message:
        "Workspace-local clone target already exists; setup will not replace it automatically.",
    }));
  }
}

function inspectCreateLocal(
  options: {
    component: NexusProjectSetupComponentAnswers;
    diagnostics: NexusProjectComponentTopologyDiagnostic[];
  },
  fact: NexusProjectComponentTopologyFact,
  sourcePath: string,
): void {
  if (fact.exists && (!fact.isDirectory || directoryHasEntries(fact.sourceRoot))) {
    options.diagnostics.push(diagnostic({
      severity: "warning",
      path: sourcePath,
      component: options.component,
      sourceRoot: fact.sourceRoot,
      message:
        "New local component target already exists and is not empty; setup will preserve existing contents.",
    }));
  }
}

function setupComponentSourceRoot(
  projectRoot: string,
  component: NexusProjectSetupComponentAnswers,
): string {
  const sourcePath =
    component.source.path ??
    (component.source.kind === "clone_project_local"
      ? path.join("components", component.id)
      : component.id);
  return path.isAbsolute(sourcePath)
    ? path.resolve(sourcePath)
    : path.resolve(projectRoot, sourcePath);
}

function isInsideGeneratedWorktrees(projectRoot: string, sourceRoot: string): boolean {
  return isSameOrInsidePath(path.resolve(projectRoot, "worktrees"), sourceRoot);
}

function isSameOrInsidePath(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function readGitInfo(sourceRoot: string): {
  isGitRepository: boolean;
  currentBranch: string | null;
  remotes: Record<string, string>;
} {
  const gitDir = readGitDirectory(sourceRoot);
  if (!gitDir) {
    return emptyGitInfo();
  }

  return {
    isGitRepository: true,
    currentBranch: readCurrentBranch(gitDir),
    remotes: readGitRemotes(gitDir),
  };
}

function emptyGitInfo(): {
  isGitRepository: boolean;
  currentBranch: string | null;
  remotes: Record<string, string>;
} {
  return {
    isGitRepository: false,
    currentBranch: null,
    remotes: {},
  };
}

function readGitDirectory(sourceRoot: string): string | null {
  const dotGit = path.join(sourceRoot, ".git");
  if (!fs.existsSync(dotGit)) {
    return null;
  }
  const stat = fs.statSync(dotGit);
  if (stat.isDirectory()) {
    return dotGit;
  }
  if (!stat.isFile()) {
    return null;
  }

  const content = fs.readFileSync(dotGit, "utf8").trim();
  const match = /^gitdir:\s*(.+)$/iu.exec(content);
  if (!match) {
    return null;
  }
  return path.resolve(sourceRoot, match[1]!);
}

function readCurrentBranch(gitDir: string): string | null {
  const headPath = path.join(gitDir, "HEAD");
  if (!fs.existsSync(headPath)) {
    return null;
  }
  const head = fs.readFileSync(headPath, "utf8").trim();
  const match = /^ref:\s*refs\/heads\/(.+)$/u.exec(head);
  return match ? match[1]! : null;
}

function readGitRemotes(gitDir: string): Record<string, string> {
  const configPath = path.join(gitDir, "config");
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const remotes: Record<string, string> = {};
  let currentRemote: string | null = null;
  for (const rawLine of fs.readFileSync(configPath, "utf8").split(/\r?\n/u)) {
    const remoteMatch = /^\s*\[remote "([^"]+)"\]\s*$/u.exec(rawLine);
    if (remoteMatch) {
      currentRemote = remoteMatch[1]!;
      continue;
    }
    const sectionMatch = /^\s*\[.+\]\s*$/u.exec(rawLine);
    if (sectionMatch) {
      currentRemote = null;
      continue;
    }
    const urlMatch = /^\s*url\s*=\s*(.+?)\s*$/u.exec(rawLine);
    if (currentRemote && urlMatch) {
      remotes[currentRemote] = urlMatch[1]!;
    }
  }

  return remotes;
}

function visitNestedRepositories(
  rootPath: string,
  currentPath: string,
  depthRemaining: number,
  repositories: string[],
): void {
  if (depthRemaining < 0) {
    return;
  }
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git") {
      continue;
    }
    const entryPath = path.join(currentPath, entry.name);
    if (fs.existsSync(path.join(entryPath, ".git"))) {
      repositories.push(path.relative(rootPath, entryPath));
      continue;
    }
    visitNestedRepositories(rootPath, entryPath, depthRemaining - 1, repositories);
  }
}

function directoryHasEntries(directoryPath: string): boolean {
  return isDirectory(directoryPath) && fs.readdirSync(directoryPath).length > 0;
}

function isDirectory(directoryPath: string): boolean {
  return fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
}

function diagnostic(options: {
  severity: NexusProjectComponentTopologyDiagnosticSeverity;
  path: string;
  component: NexusProjectSetupComponentAnswers;
  sourceRoot: string;
  message: string;
}): NexusProjectComponentTopologyDiagnostic {
  return {
    severity: options.severity,
    path: options.path,
    componentId: options.component.id,
    sourceRoot: options.sourceRoot,
    message: options.message,
  };
}
