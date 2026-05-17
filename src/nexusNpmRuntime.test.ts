import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectNexusNpmRuntimeInstall,
  preflightNexusNpmRuntimeInstall,
  waitForNexusNpmPackageVisibility,
  type NexusNpmRuntimeCommandRunner,
} from "./index.js";

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

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeInstalledPackage(options: {
  runtimeRoot: string;
  installName: string;
  packageName: string;
  version: string;
  bins?: string[];
}): void {
  const packageRoot = path.join(
    options.runtimeRoot,
    "node_modules",
    ...options.installName.split("/"),
  );
  writeJson(path.join(packageRoot, "package.json"), {
    name: options.packageName,
    version: options.version,
    bin:
      options.bins && options.bins.length > 0
        ? Object.fromEntries(
            options.bins.map((bin) => [bin, `dist/${bin}.js`]),
          )
        : undefined,
  });
  for (const bin of options.bins ?? []) {
    const binPath = path.join(options.runtimeRoot, "node_modules", ".bin", bin);
    fs.mkdirSync(path.dirname(binPath), { recursive: true });
    fs.writeFileSync(binPath, "#!/usr/bin/env node\n", "utf8");
  }
}

describe("nexus npm package visibility", () => {
  it("waits with bounded backoff until a freshly published dist-tag is visible", async () => {
    const commands: string[] = [];
    const sleeps: number[] = [];
    let attempts = 0;
    const commandRunner: NexusNpmRuntimeCommandRunner = (command, options) => {
      commands.push(`${command} @ ${options.cwd}`);
      attempts += 1;
      return {
        command,
        cwd: options.cwd,
        stdout:
          attempts === 1
            ? JSON.stringify({
                name: "@evref-bl/dev-nexus",
                versions: ["0.1.0-alpha.14"],
                "dist-tags": {},
              })
            : JSON.stringify({
                name: "@evref-bl/dev-nexus",
                versions: ["0.1.0-alpha.14", "0.1.0-alpha.15"],
                "dist-tags": { dogfood: "0.1.0-alpha.15" },
              }),
        stderr: "",
        exitCode: 0,
      };
    };

    const result = await waitForNexusNpmPackageVisibility({
      packageName: "@evref-bl/dev-nexus",
      version: "0.1.0-alpha.15",
      distTag: "dogfood",
      recentlyPublished: true,
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 1500,
      cwd: "registry-smoke",
      commandRunner,
      sleep: (delayMs) => {
        sleeps.push(delayMs);
        return Promise.resolve();
      },
    });

    expect(result).toMatchObject({
      status: "visible",
      attempts: 2,
      packageName: "@evref-bl/dev-nexus",
      version: "0.1.0-alpha.15",
      distTag: "dogfood",
      distTagVersion: "0.1.0-alpha.15",
    });
    expect(sleeps).toEqual([1000]);
    expect(commands).toEqual([
      "npm view @evref-bl/dev-nexus --json @ registry-smoke",
      "npm view @evref-bl/dev-nexus --json @ registry-smoke",
    ]);
  });

  it("classifies exhausted fresh-publish visibility checks as propagation delay", async () => {
    const sleeps: number[] = [];

    const result = await waitForNexusNpmPackageVisibility({
      packageName: "@evref-bl/dev-nexus",
      version: "0.1.0-alpha.16",
      distTag: "dogfood",
      recentlyPublished: true,
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 1500,
      commandRunner: (command, options) => ({
        command,
        cwd: options.cwd,
        stdout: JSON.stringify({
          name: "@evref-bl/dev-nexus",
          versions: ["0.1.0-alpha.15"],
          "dist-tags": { dogfood: "0.1.0-alpha.15" },
        }),
        stderr: "",
        exitCode: 0,
      }),
      sleep: (delayMs) => {
        sleeps.push(delayMs);
        return Promise.resolve();
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      failureKind: "registry_propagation_delay",
      attempts: 3,
    });
    expect(result.summary).toContain("Registry propagation delay");
    expect(sleeps).toEqual([1000, 1500]);
  });

  it("distinguishes network failures from missing versions", async () => {
    const network = await waitForNexusNpmPackageVisibility({
      packageName: "@evref-bl/dev-nexus",
      version: "0.1.0-alpha.15",
      maxAttempts: 2,
      initialDelayMs: 100,
      commandRunner: (command, options) => ({
        command,
        cwd: options.cwd,
        stdout: "",
        stderr: "npm ERR! code EAI_AGAIN\nnpm ERR! network timeout",
        exitCode: 1,
      }),
      sleep: () => Promise.resolve(),
    });
    const missingVersion = await waitForNexusNpmPackageVisibility({
      packageName: "@evref-bl/dev-nexus",
      version: "0.1.0-alpha.99",
      commandRunner: (command, options) => ({
        command,
        cwd: options.cwd,
        stdout: JSON.stringify({
          name: "@evref-bl/dev-nexus",
          versions: ["0.1.0-alpha.15"],
          "dist-tags": { dogfood: "0.1.0-alpha.15" },
        }),
        stderr: "",
        exitCode: 0,
      }),
      sleep: () => Promise.resolve(),
    });

    expect(network).toMatchObject({
      status: "failed",
      failureKind: "network_failure",
      attempts: 2,
    });
    expect(network.summary).toContain("Network failure");
    expect(missingVersion).toMatchObject({
      status: "failed",
      failureKind: "missing_version",
      attempts: 1,
    });
    expect(missingVersion.summary).toContain("Missing npm package version");
  });
});

describe("nexus npm runtime install preflight", () => {
  it("repairs a partial runtime node_modules tree through the approved setup command", () => {
    const projectRoot = makeTempDir("dev-nexus-npm-runtime-");
    const runtimeRoot = path.join(projectRoot, ".dev-nexus", "runtime", "npm-tools");
    writeJson(path.join(runtimeRoot, "package.json"), {
      dependencies: {
        "@evref-bl/dev-nexus-pharo": "0.1.0-alpha.9",
      },
    });
    writeJson(path.join(runtimeRoot, "package-lock.json"), {
      lockfileVersion: 3,
      packages: {
        "node_modules/@evref-bl/dev-nexus-pharo": {
          version: "0.1.0-alpha.9",
        },
      },
    });
    fs.mkdirSync(path.join(runtimeRoot, "node_modules"), { recursive: true });
    const commands: string[] = [];

    const result = preflightNexusNpmRuntimeInstall({
      projectRoot,
      allowRepair: true,
      commandRunner: (command, options) => {
        commands.push(`${command} @ ${options.cwd}`);
        writeInstalledPackage({
          runtimeRoot,
          installName: "@evref-bl/dev-nexus-pharo",
          packageName: "@evref-bl/dev-nexus-pharo",
          version: "0.1.0-alpha.9",
          bins: ["dev-nexus-pharo"],
        });
        return {
          command,
          cwd: options.cwd,
          stdout: "installed",
          stderr: "",
          exitCode: 0,
        };
      },
    });

    expect(result).toEqual([
      expect.objectContaining({
        name: "npmRuntimeInstall:npm-tools",
        status: "passed",
        message: expect.stringContaining("repaired through approved setup command npm ci"),
      }),
    ]);
    expect(commands).toEqual([`npm ci @ ${runtimeRoot}`]);
  });

  it("reports stale runtime node_modules as damaged local install state without repair approval", () => {
    const projectRoot = makeTempDir("dev-nexus-npm-runtime-");
    const runtimeRoot = path.join(projectRoot, ".dev-nexus", "runtime", "npm-tools");
    writeJson(path.join(runtimeRoot, "package.json"), {
      dependencies: {
        "dev-nexus": "npm:@evref-bl/dev-nexus@0.1.0-alpha.14",
      },
    });
    writeJson(path.join(runtimeRoot, "package-lock.json"), {
      lockfileVersion: 3,
      packages: {
        "node_modules/dev-nexus": {
          version: "0.1.0-alpha.14",
        },
      },
    });
    writeInstalledPackage({
      runtimeRoot,
      installName: "dev-nexus",
      packageName: "@evref-bl/dev-nexus",
      version: "0.1.0-alpha.13",
      bins: ["dev-nexus"],
    });

    const inspection = inspectNexusNpmRuntimeInstall({ runtimeRoot });
    const result = preflightNexusNpmRuntimeInstall({
      projectRoot,
      allowRepair: false,
      commandRunner: () => {
        throw new Error("repair should not run");
      },
    });

    expect(inspection).toMatchObject({
      status: "damaged",
      failureKind: "damaged_local_install",
    });
    expect(inspection.issues).toEqual([
      expect.stringContaining("version is 0.1.0-alpha.13, expected 0.1.0-alpha.14"),
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        status: "failed",
        message: expect.stringContaining("Damaged local npm runtime install state"),
      }),
    ]);
  });
});
