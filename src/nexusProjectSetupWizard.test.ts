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

describe("nexus project setup wizard", () => {
  it("uses the TTY path as the human quickstart without prompting for home", async () => {
    const defaultHome = path.join(os.tmpdir(), "dev-nexus-human-quickstart-home");
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
    expect(stdout.output()).toContain("DevNexus human quickstart");
    expect(stdout.output()).toContain("~/.dev-nexus unless --home is supplied");
    expect(stdout.output()).not.toContain("DevNexus home [");
  });

  it("builds first-run next actions from the applied project config", () => {
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
      "Open the DevNexus project root in Codex or your configured agent: /workspace/demo",
      "Run dev-nexus setup check '/workspace/demo' join-existing-project --json to verify local readiness.",
      "Run dev-nexus project status '/workspace/demo' --json to inspect configured components.",
      "Create or triage the first work item for component core with tracker local.",
      "Run dev-nexus project hosting status '/workspace/demo' --json when hosting intent is configured. Add --home only if you used a custom DevNexus home.",
    ]);
  });
});
