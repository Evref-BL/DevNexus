import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NexusCommandPathError,
  resolveNexusCommandPath,
} from "../src/nexusCommandPath.js";

function makeExecutable(directory: string, name: string): string {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, "#!/bin/sh\nexit 0\n", "utf8");
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

describe("nexus command path", () => {
  it("resolves bare commands from trusted absolute PATH directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-nexus-command-path-"));
    const trustedBin = path.join(root, "trusted-bin");
    fs.mkdirSync(trustedBin, { recursive: true, mode: 0o755 });
    const commandPath = makeExecutable(trustedBin, "demo-tool");

    expect(resolveNexusCommandPath("demo-tool", { PATH: trustedBin })).toBe(
      commandPath,
    );
  });

  it("ignores relative and group-writable PATH entries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-nexus-command-path-"));
    const unsafeBin = path.join(root, "unsafe-bin");
    fs.mkdirSync(unsafeBin, { recursive: true, mode: 0o777 });
    fs.chmodSync(unsafeBin, 0o777);
    makeExecutable(unsafeBin, "demo-tool");

    expect(() =>
      resolveNexusCommandPath("demo-tool", {
        PATH: [".", unsafeBin].join(path.delimiter),
      }),
    ).toThrow(NexusCommandPathError);
  });

  it("rejects relative command paths", () => {
    expect(() =>
      resolveNexusCommandPath("./demo-tool", { PATH: process.env.PATH }),
    ).toThrow(/absolute or PATH-resolved/);
  });
});
