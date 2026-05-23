import fs from "node:fs";
import path from "node:path";

export interface NexusGitRemoteFacts {
  urls: Record<string, string>;
  pushUrls: Record<string, string>;
}

export function readNexusGitRemoteFacts(
  repositoryPath: string,
): NexusGitRemoteFacts {
  const configPath = gitConfigPath(repositoryPath);
  if (!configPath) {
    return { urls: {}, pushUrls: {} };
  }

  return parseNexusGitRemoteFacts(fs.readFileSync(configPath, "utf8"));
}

export function parseNexusGitRemoteFacts(text: string): NexusGitRemoteFacts {
  const urls: Record<string, string> = {};
  const pushUrls: Record<string, string> = {};
  let currentRemote: string | null = null;

  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const section = gitRemoteSectionName(trimmed);
    if (section !== undefined) {
      currentRemote = section || null;
      continue;
    }
    if (trimmed.startsWith("[")) {
      currentRemote = null;
      continue;
    }
    if (!currentRemote) {
      continue;
    }
    const assignment = gitConfigAssignment(trimmed);
    if (assignment?.key === "url") {
      urls[currentRemote] = assignment.value;
      continue;
    }
    if (assignment?.key === "pushurl") {
      pushUrls[currentRemote] = assignment.value;
    }
  }

  return { urls, pushUrls };
}

function gitRemoteSectionName(line: string): string | undefined {
  const prefix = '[remote "';
  const suffix = '"]';
  if (!line.startsWith(prefix) || !line.endsWith(suffix)) {
    return undefined;
  }

  return line.slice(prefix.length, line.length - suffix.length).trim();
}

function gitConfigAssignment(
  line: string,
): { key: string; value: string } | null {
  const separator = line.indexOf("=");
  if (separator < 0) {
    return null;
  }

  return {
    key: line.slice(0, separator).trim(),
    value: line.slice(separator + 1).trim(),
  };
}

function gitConfigPath(repositoryPath: string): string | null {
  const gitPath = path.join(repositoryPath, ".git");
  if (fs.statSync(gitPath, { throwIfNoEntry: false })?.isDirectory()) {
    const configPath = path.join(gitPath, "config");
    return fs.existsSync(configPath) ? configPath : null;
  }
  if (!fs.statSync(gitPath, { throwIfNoEntry: false })?.isFile()) {
    return null;
  }

  const gitDir = gitDirFromFileContent(fs.readFileSync(gitPath, "utf8"));
  if (!gitDir) {
    return null;
  }
  const configPath = path.join(path.resolve(repositoryPath, gitDir), "config");
  return fs.existsSync(configPath) ? configPath : null;
}

function gitDirFromFileContent(text: string): string | null {
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("gitdir:")) {
      return trimmed.slice("gitdir:".length).trim() || null;
    }
  }

  return null;
}
