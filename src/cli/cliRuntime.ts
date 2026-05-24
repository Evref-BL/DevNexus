import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function packageRootPath(moduleUrl = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  for (let current = moduleDir; ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }
    if (path.dirname(current) === current) {
      break;
    }
  }

  const moduleDirName = path.basename(moduleDir);
  if (moduleDirName === "src" || moduleDirName === "dist") {
    return path.dirname(moduleDir);
  }
  return moduleDir;
}

export function readCurrentPackageVersion(): string | null {
  const packageJsonPath = path.join(packageRootPath(), "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };
  return typeof parsed.version === "string" ? parsed.version : null;
}

export function isCliEntrypoint(
  moduleUrl: string,
  argv: readonly string[] = process.argv,
): boolean {
  const entrypoint = argv[1];
  if (!entrypoint) {
    return false;
  }

  const normalize = (filePath: string): string => {
    const resolved = path.resolve(filePath);
    try {
      return fs.realpathSync.native(resolved);
    } catch {
      return resolved;
    }
  };

  return normalize(entrypoint) === normalize(fileURLToPath(moduleUrl));
}
