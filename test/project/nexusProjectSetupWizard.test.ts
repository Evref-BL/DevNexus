import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusProjectSetupApplyNextActions,
  loadNexusProjectSetupAnswers,
  type NexusProjectSetupApplyResult,
} from "../../src/index.js";

const originalDevNexusHome = process.env.DEV_NEXUS_HOME;
const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  if (originalDevNexusHome === undefined) {
    delete process.env.DEV_NEXUS_HOME;
  } else {
    process.env.DEV_NEXUS_HOME = originalDevNexusHome;
  }
});

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function ttyInput(): NodeJS.ReadStream {
  const stream = new PassThrough() as NodeJS.ReadStream;
  Object.defineProperty(stream, "isTTY", {
    value: true,
  });
  return stream;
}

function captureOutput(options: {
  onWrite?: (chunk: string) => void;
} = {}): { stream: NodeJS.WriteStream; output: () => string } {
  let output = "";
  const stream = new PassThrough() as NodeJS.WriteStream;
  stream.write = (chunk: string | Buffer): boolean => {
    const text = chunk.toString();
    output += text;
    options.onWrite?.(text);
    return true;
  };
  return {
    stream,
    output: () => output,
  };
}

describe("nexus workspace setup wizard", () => {
  it("uses the TTY path as the user quickstart without prompting for home", async () => {
    const defaultHome = path.join(os.tmpdir(), "dev-nexus-user-quickstart-home");
    const projectRoot = makeTempDir("dev-nexus-quickstart-project-");
    process.env.DEV_NEXUS_HOME = defaultHome;
    const stdin = ttyInput();
    const promptAnswers = [
      "",
      "Quickstart Demo",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ];
    const stdout = captureOutput({
      onWrite(chunk) {
        if (!chunk.includes(": ") || promptAnswers.length === 0) {
          return;
        }
        const answer = promptAnswers.shift()!;
        queueMicrotask(() => {
          stdin.write(`${answer}\n`);
        });
      },
    });

    const answersPromise = loadNexusProjectSetupAnswers({
      projectRoot,
      stdin,
      stdout: stdout.stream,
    });
    const answers = await answersPromise;
    stdin.destroy();

    expect(answers).toMatchObject({
      home: {
        path: defaultHome,
      },
      project: {
        id: "quickstart-demo",
        name: "Quickstart Demo",
        root: projectRoot,
        initializeGit: true,
      },
      components: [
        {
          id: "primary",
          role: "primary",
          source: {
            kind: "create_local",
            path: path.join("components", "primary"),
            initializeGit: true,
          },
        },
      ],
      agentTargets: [
        {
          provider: "codex",
        },
      ],
    });
    expect(stdout.output()).toContain("DevNexus user quickstart");
    expect(stdout.output()).toContain("What are you setting up?");
    expect(stdout.output()).toContain("project");
    expect(stdout.output()).toContain("workspace");
    expect(stdout.output()).toContain("Initialize Git repo? (yes/no)");
    expect(stdout.output()).not.toContain("Initialize meta Git repo");
    expect(stdout.output()).toContain("~/.dev-nexus unless --home is supplied");
    expect(stdout.output()).not.toContain("DevNexus home [");
  });

  it("defaults the layout to project and the primary component to the workspace root in an existing Git checkout", async () => {
    const defaultHome = path.join(os.tmpdir(), "dev-nexus-existing-repo-home");
    const projectRoot = makeTempDir("dev-nexus-existing-repo-");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    process.env.DEV_NEXUS_HOME = defaultHome;
    const stdin = ttyInput();
    const promptAnswers = [
      "",
      "Existing Repo",
      "",
      "",
      "repo",
      "",
      "",
      "",
      "",
    ];
    const stdout = captureOutput({
      onWrite(chunk) {
        if (!chunk.includes(": ") || promptAnswers.length === 0) {
          return;
        }
        const answer = promptAnswers.shift()!;
        queueMicrotask(() => {
          stdin.write(`${answer}\n`);
        });
      },
    });

    const answers = await loadNexusProjectSetupAnswers({
      projectRoot,
      stdin,
      stdout: stdout.stream,
    });
    stdin.destroy();

    expect(answers).toMatchObject({
      project: {
        id: "existing-repo",
        name: "Existing Repo",
        root: projectRoot,
        initializeGit: true,
      },
      components: [
        {
          id: "repo",
          role: "primary",
          source: {
            kind: "reference_existing",
            path: ".",
          },
        },
      ],
    });
    expect(stdout.output()).not.toContain("Initialize Git repo? (yes/no)");
  });

  it("can choose a coordination workspace layout inside an existing Git checkout", async () => {
    const projectRoot = makeTempDir("dev-nexus-existing-repo-workspace-layout-");
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    const stdin = ttyInput();
    const promptAnswers = [
      "",
      "Existing Repo Workspace",
      "",
      "workspace",
      "core",
      "",
      "",
      "",
      "",
    ];
    const stdout = captureOutput({
      onWrite(chunk) {
        if (!chunk.includes(": ") || promptAnswers.length === 0) {
          return;
        }
        const answer = promptAnswers.shift()!;
        queueMicrotask(() => {
          stdin.write(`${answer}\n`);
        });
      },
    });

    const answers = await loadNexusProjectSetupAnswers({
      projectRoot,
      stdin,
      stdout: stdout.stream,
    });
    stdin.destroy();

    expect(answers).toMatchObject({
      components: [
        {
          id: "core",
          role: "primary",
          source: {
            kind: "create_local",
            path: path.join("components", "core"),
            initializeGit: true,
          },
        },
      ],
    });
  });

  it("collects additional components through an explicit repeat prompt", async () => {
    const projectRoot = makeTempDir("dev-nexus-multi-component-project-");
    const stdin = ttyInput();
    const promptAnswers = [
      "",
      "Multi Component Demo",
      "",
      "",
      "core",
      "",
      "yes",
      "api",
      "packages/api",
      "primary",
      "dependency",
      "yes",
      "paper",
      "docs/paper",
      "optional",
      "",
      "",
      "",
      "",
    ];
    const stdout = captureOutput({
      onWrite(chunk) {
        if (!chunk.includes(": ") || promptAnswers.length === 0) {
          return;
        }
        const answer = promptAnswers.shift()!;
        queueMicrotask(() => {
          stdin.write(`${answer}\n`);
        });
      },
    });

    const answers = await loadNexusProjectSetupAnswers({
      projectRoot,
      stdin,
      stdout: stdout.stream,
    });
    stdin.destroy();

    expect(answers?.components).toEqual([
      {
        id: "core",
        name: "core",
        role: "primary",
        source: {
          kind: "create_local",
          path: path.join("components", "core"),
          initializeGit: true,
        },
      },
      {
        id: "api",
        name: "api",
        role: "dependency",
        source: {
          kind: "create_local",
          path: "packages/api",
          initializeGit: true,
        },
      },
      {
        id: "paper",
        name: "paper",
        role: "optional",
        source: {
          kind: "create_local",
          path: "docs/paper",
          initializeGit: true,
        },
      },
    ]);
    expect(stdout.output()).toContain("Add another component? (yes/no)");
    expect(stdout.output()).toContain("Additional component role");
    expect(stdout.output()).toContain("Additional components cannot use role primary.");
  });

  it("does not create missing outside paths from the user quickstart defaults", async () => {
    const projectRoot = makeTempDir("dev-nexus-outside-path-project-");
    const missingOutsidePath = path.join(
      os.tmpdir(),
      `dev-nexus-missing-outside-${process.pid}-${Date.now()}`,
    );
    const stdin = ttyInput();
    const promptAnswers = [
      "",
      "Outside Path Demo",
      "",
      "",
      "external",
      missingOutsidePath,
      "",
      "",
      "",
      "",
    ];
    const stdout = captureOutput({
      onWrite(chunk) {
        if (!chunk.includes(": ") || promptAnswers.length === 0) {
          return;
        }
        const answer = promptAnswers.shift()!;
        queueMicrotask(() => {
          stdin.write(`${answer}\n`);
        });
      },
    });

    const answers = await loadNexusProjectSetupAnswers({
      projectRoot,
      stdin,
      stdout: stdout.stream,
    });
    stdin.destroy();

    expect(answers?.components[0]?.source).toEqual({
      kind: "reference_existing",
      path: missingOutsidePath,
    });
  });

  it("builds first-run next actions from the applied workspace config", () => {
    const result = {
      projectRoot: "/workspace/demo",
      proposal: {
        answers: {
          home: {
            path: "/home/dev/.dev-nexus",
          },
        },
      },
      projectConfig: {
        components: [
          {
            id: "core",
            defaultWorkTrackerId: "local",
          },
        ],
      },
    } as NexusProjectSetupApplyResult;

    expect(
      buildNexusProjectSetupApplyNextActions(result, {
        quoteArgument: (value) => `'${value}'`,
      }),
    ).toEqual([
      "Open the DevNexus workspace root in Codex or your configured agent: /workspace/demo",
      "Run dev-nexus setup check '/workspace/demo' join-existing-project --json to verify local readiness.",
      "Run dev-nexus workspace status '/workspace/demo' --json to inspect configured components.",
      "Create or triage the first work item for component core with tracker local.",
      "Run dev-nexus workspace hosting status '/workspace/demo' --json when hosting intent is configured. Add --home only if you used a custom DevNexus home.",
    ]);
  });
});
