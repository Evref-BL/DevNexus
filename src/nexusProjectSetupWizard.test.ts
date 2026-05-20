import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNexusProjectSetupApplyNextActions,
  loadNexusProjectSetupAnswers,
  type NexusProjectSetupApplyResult,
} from "./index.js";

const originalDevNexusHome = process.env.DEV_NEXUS_HOME;

afterEach(() => {
  if (originalDevNexusHome === undefined) {
    delete process.env.DEV_NEXUS_HOME;
  } else {
    process.env.DEV_NEXUS_HOME = originalDevNexusHome;
  }
});

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
      projectRoot: "/tmp/quickstart-project",
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
        root: "/tmp/quickstart-project",
        initializeGit: true,
      },
      components: [
        {
          id: "primary",
          role: "primary",
          source: {
            kind: "reference_existing",
            path: ".",
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
    expect(stdout.output()).toContain("~/.dev-nexus unless --home is supplied");
    expect(stdout.output()).not.toContain("DevNexus home [");
  });

  it("collects additional components through an explicit repeat prompt", async () => {
    const stdin = ttyInput();
    const promptAnswers = [
      "",
      "Multi Component Demo",
      "",
      "core",
      ".",
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
      projectRoot: "/tmp/multi-component-project",
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
          kind: "reference_existing",
          path: ".",
        },
      },
      {
        id: "api",
        name: "api",
        role: "dependency",
        source: {
          kind: "reference_existing",
          path: "packages/api",
        },
      },
      {
        id: "paper",
        name: "paper",
        role: "optional",
        source: {
          kind: "reference_existing",
          path: "docs/paper",
        },
      },
    ]);
    expect(stdout.output()).toContain("Add another component? (yes/no)");
    expect(stdout.output()).toContain("Additional component role");
    expect(stdout.output()).toContain("Additional components cannot use role primary.");
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
