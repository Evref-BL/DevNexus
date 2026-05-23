const gitDirectoryPrefix = "gitdir:";

export function gitDirectoryFromGitFileContent(content: string): string | null {
  for (const line of contentLines(content)) {
    const gitDir = gitDirectoryFromGitFileLine(line);
    if (gitDir) {
      return gitDir;
    }
  }

  return null;
}

export function gitDirectoryFromGitFileLine(line: string): string | null {
  const trimmed = line.trim();
  if (
    trimmed.slice(0, gitDirectoryPrefix.length).toLowerCase() !==
      gitDirectoryPrefix
  ) {
    return null;
  }

  const gitDir = trimmed.slice(gitDirectoryPrefix.length).trim();
  return gitDir || null;
}

function contentLines(content: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") {
      continue;
    }
    const end = index > start && content[index - 1] === "\r"
      ? index - 1
      : index;
    lines.push(content.slice(start, end));
    start = index + 1;
  }

  if (start < content.length) {
    lines.push(content.slice(start));
  }

  return lines;
}
