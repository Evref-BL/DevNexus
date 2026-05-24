import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { packageRootPath } from "../../src/cli/cliRuntime.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("CLI runtime package root resolution", () => {
  it("resolves the package root from nested dist modules", () => {
    const root = makeTempDir("dev-nexus-cli-runtime-");
    const modulePath = path.join(root, "dist", "cli", "cliRuntime.js");
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");

    expect(packageRootPath(pathToFileURL(modulePath).href)).toBe(root);
  });
});
