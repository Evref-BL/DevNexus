import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export class NexusCommandPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusCommandPathError";
  }
}

export function resolveNexusCommandPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const normalizedCommand = requiredCommandName(command);
  if (path.isAbsolute(normalizedCommand)) {
    return executablePath(normalizedCommand);
  }
  if (normalizedCommand.includes("/") || normalizedCommand.includes("\\")) {
    throw new NexusCommandPathError(
      `Command must be absolute or PATH-resolved: ${normalizedCommand}`,
    );
  }

  for (const directory of trustedPathDirectories(env)) {
    for (const candidate of commandCandidates(directory, normalizedCommand, env)) {
      const executable = executablePathOrNull(candidate);
      if (executable) {
        return executable;
      }
    }
  }

  throw new NexusCommandPathError(
    `Command was not found in trusted PATH directories: ${normalizedCommand}`,
  );
}

function requiredCommandName(command: string): string {
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new NexusCommandPathError("Command must be a non-empty string");
  }

  return command.trim();
}

function trustedPathDirectories(env: NodeJS.ProcessEnv): string[] {
  const pathValue = pathEnvironmentValue(env);
  if (!pathValue) {
    return [];
  }

  const directories: string[] = [];
  for (const entry of pathValue.split(path.delimiter)) {
    const directory = entry.trim();
    if (!directory || !path.isAbsolute(directory)) {
      continue;
    }
    if (isUnsafePathDirectory(directory)) {
      continue;
    }
    directories.push(directory);
  }

  return directories;
}

function pathEnvironmentValue(env: NodeJS.ProcessEnv): string | undefined {
  return env.PATH ?? env.Path ?? env.path ?? process.env.PATH;
}

function commandCandidates(
  directory: string,
  command: string,
  env: NodeJS.ProcessEnv,
): string[] {
  const base = path.join(directory, command);
  if (process.platform !== "win32" || path.extname(command)) {
    return [base];
  }

  return [base, ...pathext(env).map((extension) => `${base}${extension}`)];
}

function pathext(env: NodeJS.ProcessEnv): string[] {
  const value = env.PATHEXT ?? env.PathExt ?? ".COM;.EXE;.BAT;.CMD";
  return value
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);
}

function isUnsafePathDirectory(directory: string): boolean {
  try {
    const stats = fs.statSync(directory);
    if (!stats.isDirectory()) {
      return true;
    }

    // Windows ACLs are not represented by POSIX writable mode bits; applying
    // the POSIX check there rejects trusted system PATH directories in CI.
    if (process.platform === "win32") {
      return false;
    }

    return Boolean(stats.mode & 0o022);
  } catch {
    return true;
  }
}

function executablePath(value: string): string {
  const executable = executablePathOrNull(value);
  if (!executable) {
    throw new NexusCommandPathError(`Command is not executable: ${value}`);
  }

  return executable;
}

function executablePathOrNull(value: string): string | null {
  try {
    const stats = fs.statSync(value);
    if (!stats.isFile()) {
      return null;
    }
    fs.accessSync(value, fs.constants.X_OK);
    return value;
  } catch {
    return null;
  }
}
