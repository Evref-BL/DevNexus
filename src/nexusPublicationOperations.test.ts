import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./cli.js";
import {
  defaultNexusAutomationConfig,
  mergeNexusPublicationPullRequestForComponent,
  pushNexusPublicationBranchForComponent,
  saveProjectConfig,
  saveNexusHomeConfigFile,
  upsertNexusPublicationPullRequestForComponent,
  validateNexusHomeConfigBase,
  type NexusProjectConfig,
  type NexusPublicationGitPushRunner,
} from "./index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("publication operations", () => {
  it("pushes review branches through the configured App credential without leaking the token into the plan", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();
    const calls: Array<{ args: readonly string[]; cwd: string; token: string | undefined }> = [];
    const gitRunner: NexusPublicationGitPushRunner = (args, options) => {
      calls.push({
        args,
        cwd: options.cwd,
        token: options.env.DEV_NEXUS_GIT_TOKEN,
      });
      return {
        args: [...args],
        stdout: "",
        stderr: "Everything up-to-date",
        exitCode: 0,
      };
    };

    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      repositoryPath: sourceRoot,
      branch: "codex/dev-nexus/app-publication-cli",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      gitRunner,
    });

    expect(result.credential).toMatchObject({
      profileId: "dev-nexus-app-github",
      kind: "github_app",
      gitCredential: {
        protocol: "https",
        host: "github.com",
        path: "Evref-BL/DevNexus.git",
      },
    });
    expect(result.push.plan.transport).toBe("https_token");
    expect(result.push.plan.remote).toBe("https://github.com/Evref-BL/DevNexus.git");
    expect(result.push.plan.refspec).toBe("codex/dev-nexus/app-publication-cli");
    expect(JSON.stringify(result.push.plan)).not.toContain("installation-token");
    expect(calls).toEqual([
      expect.objectContaining({
        cwd: sourceRoot,
        token: "installation-token",
      }),
    ]);
  });

  it("pushes workspace metadata branches through the App when project repository is selected", async () => {
    const { projectRoot } = createMultiComponentPublicationProject();
    const calls: Array<{ args: readonly string[]; cwd: string; token: string | undefined }> = [];
    const gitRunner: NexusPublicationGitPushRunner = (args, options) => {
      calls.push({
        args,
        cwd: options.cwd,
        token: options.env.DEV_NEXUS_GIT_TOKEN,
      });
      return {
        args: [...args],
        stdout: "",
        stderr: "Everything up-to-date",
        exitCode: 0,
      };
    };

    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      projectRepository: true,
      repositoryPath: projectRoot,
      branch: "codex/dogfood/code-quality-audit-records",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      gitRunner,
    });

    expect(result.componentId).toBeNull();
    expect(result.target).toEqual({
      kind: "project",
      id: "publication-project",
      componentId: null,
      projectId: "publication-project",
    });
    expect(result.repository).toMatchObject({
      owner: "Gabot-Darbot",
      name: "dev-nexus-dogfood",
    });
    expect(result.push.plan.remote).toBe(
      "https://github.com/Gabot-Darbot/dev-nexus-dogfood.git",
    );
    expect(JSON.stringify(result.push.plan)).not.toContain("installation-token");
    expect(calls).toEqual([
      expect.objectContaining({
        cwd: projectRoot,
        token: "installation-token",
      }),
    ]);
  });

  it("adds force-with-lease only when the review branch update asks for it", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();
    const result = await pushNexusPublicationBranchForComponent({
      projectRoot,
      repositoryPath: sourceRoot,
      branch: "codex/dev-nexus/app-publication-cli",
      forceWithLease: true,
      forceWithLeaseExpectedCommit: "78aee49bd490cae82e433d76b83e865296022a1c",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      gitRunner: (args) => ({
        args: [...args],
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    });

    expect(result.forceWithLease).toBe(true);
    expect(result.forceWithLeaseExpectedCommit).toBe(
      "78aee49bd490cae82e433d76b83e865296022a1c",
    );
    expect(result.push.plan.args).toContain(
      "--force-with-lease=refs/heads/codex/dev-nexus/app-publication-cli:78aee49bd490cae82e433d76b83e865296022a1c",
    );
  });

  it("creates pull requests through the forge adapter with App API credentials", async () => {
    const { projectRoot } = createPublicationProject();
    const requests: Array<{ url: string; method: string; authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        JSON.stringify({
          number: 191,
          html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
          state: "open",
          title: "Add App publication commands",
        }),
        { status: 201 },
      );
    };

    const result = await upsertNexusPublicationPullRequestForComponent({
      projectRoot,
      head: "codex/dev-nexus/app-publication-cli",
      title: "Add App publication commands",
      body: "Use DevNexus App credentials for publication.",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      fetch: fetchImpl,
    });

    expect(result.pullRequest).toMatchObject({
      number: 191,
      url: "https://github.com/Evref-BL/DevNexus/pull/191",
      title: "Add App publication commands",
    });
    expect(requests).toEqual([
      {
        url: "https://api.github.com/repos/Evref-BL/DevNexus/pulls",
        method: "POST",
        authorization: "Bearer installation-token",
        body: {
          head: "codex/dev-nexus/app-publication-cli",
          base: "main",
          title: "Add App publication commands",
          body: "Use DevNexus App credentials for publication.",
        },
      },
    ]);
  });

  it("upserts pull requests against the workspace metadata repository when selected", async () => {
    const { projectRoot } = createMultiComponentPublicationProject();
    const requests: Array<{ url: string; method: string; authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        JSON.stringify({
          number: 31,
          html_url: "https://github.com/Gabot-Darbot/dev-nexus-dogfood/pull/31",
          state: "open",
          title: "Update dogfood publication context",
        }),
        { status: 201 },
      );
    };

    const result = await upsertNexusPublicationPullRequestForComponent({
      projectRoot,
      projectRepository: true,
      head: "codex/dogfood/code-quality-audit-records",
      title: "Update dogfood publication context",
      body: "Record the current App publication path.",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      fetch: fetchImpl,
    });

    expect(result.componentId).toBeNull();
    expect(result.target.kind).toBe("project");
    expect(result.pullRequest).toMatchObject({
      number: 31,
      url: "https://github.com/Gabot-Darbot/dev-nexus-dogfood/pull/31",
      title: "Update dogfood publication context",
    });
    expect(requests).toEqual([
      {
        url: "https://api.github.com/repos/Gabot-Darbot/dev-nexus-dogfood/pulls",
        method: "POST",
        authorization: "Bearer installation-token",
        body: {
          head: "codex/dogfood/code-quality-audit-records",
          base: "main",
          title: "Update dogfood publication context",
          body: "Record the current App publication path.",
        },
      },
    ]);
  });

  it("merges pull requests through the forge adapter with App API credentials", async () => {
    const { projectRoot } = createPublicationProject();
    const requests: Array<{ url: string; method: string; authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        JSON.stringify({
          merged: true,
          sha: "merge-commit",
          message: "Pull Request successfully merged",
        }),
        { status: 200 },
      );
    };

    const result = await mergeNexusPublicationPullRequestForComponent({
      projectRoot,
      number: 191,
      method: "squash",
      baseEnv: {
        DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
      } as NodeJS.ProcessEnv,
      fetch: fetchImpl,
    });

    expect(result.merge).toMatchObject({
      merged: true,
      sha: "merge-commit",
      message: "Pull Request successfully merged",
    });
    expect(result.pullRequest).toEqual({
      number: 191,
      method: "squash",
    });
    expect(requests).toEqual([
      {
        url: "https://api.github.com/repos/Evref-BL/DevNexus/pulls/191/merge",
        method: "PUT",
        authorization: "Bearer installation-token",
        body: {
          merge_method: "squash",
        },
      },
    ]);
  });

  it("blocks direct target-branch pushes when green-main policy requires a pull request", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();

    await expect(
      pushNexusPublicationBranchForComponent({
        projectRoot,
        repositoryPath: sourceRoot,
        branch: "codex/dev-nexus/app-publication-cli",
        targetBranch: "main",
        baseEnv: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        gitRunner: () => {
          throw new Error("git should not run");
        },
      }),
    ).rejects.toThrow(/blocks direct pushes to target branch main/u);
  });
});

describe("publication CLI operations", () => {
  it("pushes a branch through the configured App credential path", async () => {
    const { projectRoot, sourceRoot } = createPublicationProject();
    const stdout = textWriter();
    const calls: Array<{ token: string | undefined }> = [];
    const gitRunner: NexusPublicationGitPushRunner = (args, options) => {
      calls.push({ token: options.env.DEV_NEXUS_GIT_TOKEN });
      return {
        args: [...args],
        stdout: "",
        stderr: "Everything up-to-date",
        exitCode: 0,
      };
    };

    const exitCode = await main(
      [
        "publication",
        "branch-push",
        projectRoot,
        "--repository-path",
        sourceRoot,
        "--branch",
        "codex/dev-nexus/app-publication-cli",
        "--force-with-lease-expected",
        "78aee49bd490cae82e433d76b83e865296022a1c",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        publicationGitPushRunner: gitRunner,
      },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.output());
    expect(payload).toMatchObject({
      ok: true,
      componentId: "primary",
      credential: {
        profileId: "dev-nexus-app-github",
        kind: "github_app",
      },
      push: {
        plan: {
          transport: "https_token",
          remote: "https://github.com/Evref-BL/DevNexus.git",
          refspec: "codex/dev-nexus/app-publication-cli",
          forceWithLease: true,
          forceWithLeaseExpectedCommit: "78aee49bd490cae82e433d76b83e865296022a1c",
        },
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
    expect(calls).toEqual([{ token: "installation-token" }]);
  });

  it("prints project repository branch-push results through the CLI", async () => {
    const { projectRoot } = createMultiComponentPublicationProject();
    const stdout = textWriter();
    const gitRunner: NexusPublicationGitPushRunner = (args) => ({
      args: [...args],
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const exitCode = await main(
      [
        "publication",
        "branch-push",
        projectRoot,
        "--project-repository",
        "--repository-path",
        projectRoot,
        "--branch",
        "codex/dogfood/code-quality-audit-records",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        publicationGitPushRunner: gitRunner,
      },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout.output());
    expect(payload).toMatchObject({
      ok: true,
      componentId: null,
      target: {
        kind: "project",
        id: "publication-project",
      },
      push: {
        plan: {
          remote: "https://github.com/Gabot-Darbot/dev-nexus-dogfood.git",
          refspec: "codex/dogfood/code-quality-audit-records",
        },
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
  });

  it("rejects publication commands that select a component and the project repository", async () => {
    const { projectRoot } = createMultiComponentPublicationProject();
    const stdout = textWriter();

    await expect(
      main(
        [
          "publication",
          "branch-push",
          projectRoot,
          "--component",
          "dev-nexus",
          "--project-repository",
          "--branch",
          "codex/dogfood/code-quality-audit-records",
        ],
        { stdout },
      ),
    ).rejects.toThrow(
      "publication accepts --component or --project-repository, not both",
    );
  });

  it("upserts pull requests through the configured App API credential path", async () => {
    const { projectRoot } = createPublicationProject();
    const stdout = textWriter();
    const requests: Array<{ authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        JSON.stringify({
          number: 191,
          html_url: "https://github.com/Evref-BL/DevNexus/pull/191",
          state: "open",
          title: "Add App publication commands",
        }),
        { status: 201 },
      );
    };

    const exitCode = await main(
      [
        "publication",
        "pull-request",
        "upsert",
        projectRoot,
        "--head",
        "codex/dev-nexus/app-publication-cli",
        "--title",
        "Add App publication commands",
        "--body",
        "Use DevNexus App credentials for publication.",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      pullRequest: {
        number: 191,
        url: "https://github.com/Evref-BL/DevNexus/pull/191",
      },
      credential: {
        profileId: "dev-nexus-app-github",
        kind: "github_app",
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
    expect(requests).toEqual([
      {
        authorization: "Bearer installation-token",
        body: {
          head: "codex/dev-nexus/app-publication-cli",
          base: "main",
          title: "Add App publication commands",
          body: "Use DevNexus App credentials for publication.",
        },
      },
    ]);
  });

  it("merges pull requests through the configured App API credential path", async () => {
    const { projectRoot } = createPublicationProject();
    const stdout = textWriter();
    const requests: Array<{ authorization: string | null; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        JSON.stringify({
          merged: true,
          sha: "merge-commit",
          message: "Pull Request successfully merged",
        }),
        { status: 200 },
      );
    };

    const exitCode = await main(
      [
        "publication",
        "pull-request",
        "merge",
        projectRoot,
        "--number",
        "191",
        "--method",
        "rebase",
        "--json",
      ],
      {
        stdout,
        env: {
          DEV_NEXUS_TEST_APP_TOKEN: "installation-token",
        } as NodeJS.ProcessEnv,
        fetch: fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      ok: true,
      pullRequest: {
        number: 191,
        method: "rebase",
      },
      merge: {
        merged: true,
        sha: "merge-commit",
      },
      credential: {
        profileId: "dev-nexus-app-github",
        kind: "github_app",
      },
    });
    expect(stdout.output()).not.toContain("installation-token");
    expect(requests).toEqual([
      {
        authorization: "Bearer installation-token",
        body: {
          merge_method: "rebase",
        },
      },
    ]);
  });
});

function createPublicationProject(): { projectRoot: string; homePath: string; sourceRoot: string } {
  const projectRoot = makeTempDir("dev-nexus-publication-ops-");
  const homePath = path.join(projectRoot, "home");
  const sourceRoot = path.join(projectRoot, "source");
  fs.mkdirSync(sourceRoot, { recursive: true });
  savePublicationHomeConfig(homePath);
  saveProjectConfig(projectRoot, publicationProjectConfig(homePath));
  return { projectRoot, homePath, sourceRoot };
}

function createMultiComponentPublicationProject(): {
  projectRoot: string;
  homePath: string;
  sourceRoot: string;
} {
  const projectRoot = makeTempDir("dev-nexus-publication-multi-");
  const homePath = path.join(projectRoot, "home");
  const sourceRoot = path.join(projectRoot, "sources", "dev-nexus");
  fs.mkdirSync(sourceRoot, { recursive: true });
  savePublicationHomeConfig(homePath);
  saveProjectConfig(projectRoot, {
    ...publicationProjectConfig(homePath),
    repo: {
      kind: "git",
      remoteUrl: "git@github.com:Gabot-Darbot/dev-nexus-dogfood.git",
      defaultBranch: "main",
    },
    components: [
      {
        id: "dev-nexus",
        name: "DevNexus",
        kind: "git",
        role: "primary",
        remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
        defaultBranch: "main",
        sourceRoot: "sources/dev-nexus",
        workTracking: {
          provider: "github",
          repository: {
            owner: "Evref-BL",
            name: "DevNexus",
          },
        },
        relationships: [],
      },
    ],
  });
  return { projectRoot, homePath, sourceRoot };
}

function savePublicationHomeConfig(homePath: string): void {
  saveNexusHomeConfigFile(
    homePath,
    {
      version: 1,
      paths: {
        projectsRoot: path.join(homePath, "projects"),
        workspacesRoot: path.join(homePath, "workspaces"),
      },
      authProfiles: [
        {
          id: "dev-nexus-app-github",
          actorId: "dev-nexus-automation-app",
          provider: "github",
          kind: "app",
          credentialKind: "github_app",
          account: "devnexus-automation",
          host: "github.com",
          purposes: ["api", "git"],
          environmentKeys: ["DEV_NEXUS_TEST_APP_TOKEN"],
        },
      ],
      projects: [],
    },
    validateNexusHomeConfigBase,
  );
}

function publicationProjectConfig(homePath: string): NexusProjectConfig {
  return {
    version: 1,
    id: "publication-project",
    name: "Publication Project",
    home: homePath,
    repo: {
      kind: "git",
      remoteUrl: "git@github.com:Evref-BL/DevNexus.git",
      defaultBranch: "main",
      sourceRoot: "source",
    },
    worktreesRoot: "worktrees",
    workTracking: {
      provider: "github",
      repository: {
        owner: "Evref-BL",
        name: "DevNexus",
      },
    },
    automation: {
      ...defaultNexusAutomationConfig,
      publication: {
        ...defaultNexusAutomationConfig.publication,
        strategy: "green_main",
        remote: "app",
        targetBranch: "main",
        push: false,
        actor: {
          kind: "app",
          provider: "github",
          handle: "devnexus-automation",
          id: "dev-nexus-automation-app",
        },
      },
    },
  };
}

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function textWriter(): { write(chunk: string): boolean; output(): string } {
  let output = "";
  return {
    write(chunk: string): boolean {
      output += chunk;
      return true;
    },
    output: () => output,
  };
}
