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

  for (const line of text.split(/\r?\u000a/u)) {
    const section = /^\s*\[remote\s+"([^"]+)"\]\s*$/u.exec(line);
    if (section) {
      currentRemote = section[1]!.trim() || null;
      continue;
    }
    if (/^\s*\[/u.test(line)) {
      currentRemote = null;
      continue;
    }
    if (!currentRemote) {
      continue;
    }
    const url = /^\s*url\s*=\s*(.+?)\s*$/u.exec(line);
    if (url) {
      urls[currentRemote] = url[1]!.trim();
      continue;
    }
    const pushUrl = /^\s*pushurl\s*=\s*(.+?)\s*$/u.exec(line);
    if (pushUrl) {
      pushUrls[currentRemote] = pushUrl[1]!.trim();
    }
  }

  return { urls, pushUrls };
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

  const match = /^gitdir:\s*(.+?)\s*$/u.exec(fs.readFileSync(gitPath, "utf8"));
  if (!match) {
    return null;
  }
  const gitDir = path.resolve(repositoryPath, match[1]!);
  const configPath = path.join(gitDir, "config");
  return fs.existsSync(configPath) ? configPath : null;
}
