#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const keepTemp = process.argv.includes("--keep-temp");
const dockerCommand = process.env.DOCKER_COMMAND || "docker";
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "dev-nexus-postgres-container-canary-"),
);
const suffix = `${process.pid}-${Date.now()}`;
const imageTag = `dev-nexus-postgres-claim-canary:${suffix}`;
const networkName = `dev-nexus-claim-canary-${suffix}`;
const postgresName = `dev-nexus-claim-canary-postgres-${suffix}`;
const schema = `dev_nexus_canary_${suffix.replaceAll("-", "_")}`;
const connectionString =
  "postgres://dev_nexus:dev_nexus@postgres:5432/dev_nexus";
const workItemId = `postgres-container-canary-${suffix}`;

let imageBuilt = false;
let networkCreated = false;
let postgresStarted = false;

try {
  assertDockerAvailable();
  const contextRoot = path.join(tempRoot, "context");
  const workspaceA = path.join(tempRoot, "host-a", "workspace");
  const workspaceB = path.join(tempRoot, "host-b", "workspace");
  const homeA = path.join(tempRoot, "host-a", "home");
  const homeB = path.join(tempRoot, "host-b", "home");
  prepareBuildContext(contextRoot);
  prepareHostFixture(workspaceA, homeA);
  prepareHostFixture(workspaceB, homeB);

  run(dockerCommand, ["build", "-t", imageTag, contextRoot], {
    label: "build DevNexus canary runner image",
  });
  imageBuilt = true;
  run(dockerCommand, ["network", "create", networkName], {
    label: "create canary Docker network",
  });
  networkCreated = true;
  run(
    dockerCommand,
    [
      "run",
      "-d",
      "--rm",
      "--name",
      postgresName,
      "--network",
      networkName,
      "--network-alias",
      "postgres",
      "-e",
      "POSTGRES_USER=dev_nexus",
      "-e",
      "POSTGRES_PASSWORD=dev_nexus",
      "-e",
      "POSTGRES_DB=dev_nexus",
      "postgres:16-alpine",
    ],
    { label: "start PostgreSQL canary container" },
  );
  postgresStarted = true;
  waitForPostgres();
  runContainer("init", {
    label: "initialize PostgreSQL claim schema",
  });

  const [hostA, hostB] = await Promise.all([
    runClaimHost({
      label: "host-a claim",
      workspaceRoot: workspaceA,
      homePath: homeA,
      hostId: "container-host-a",
      agentId: "container-agent-a",
      leaseToken: `${workItemId}-lease-a`,
    }),
    runClaimHost({
      label: "host-b claim",
      workspaceRoot: workspaceB,
      homePath: homeB,
      hostId: "container-host-b",
      agentId: "container-agent-b",
      leaseToken: `${workItemId}-lease-b`,
    }),
  ]);
  const claims = [hostA, hostB];
  const winners = claims.filter((result) => result.claim.status === "claimed");
  const losers = claims.filter((result) => result.claim.status === "lost_race");
  assert(
    winners.length === 1,
    `expected exactly one claimed result, got ${winners.length}: ${JSON.stringify(claims, null, 2)}`,
  );
  assert(
    losers.length === 1,
    `expected exactly one lost_race result, got ${losers.length}: ${JSON.stringify(claims, null, 2)}`,
  );
  const winner = winners[0];
  const loser = losers[0];
  assert(
    winner.claim.authorityClaim?.fencingToken ===
      loser.claim.authorityClaim?.fencingToken,
    "lost race did not report the winner fencing token",
  );

  const winnerWorkspace =
    winner.hostId === "container-host-a" ? workspaceA : workspaceB;
  const winnerHome = winner.hostId === "container-host-a" ? homeA : homeB;
  const finalized = parseJson(
    runContainer("finalize", {
      label: "heartbeat and release winner claim",
      workspaceRoot: winnerWorkspace,
      homePath: winnerHome,
      env: {
        CANARY_AUTHORITY_CLAIM_JSON: JSON.stringify(
          winner.claim.authorityClaim,
        ),
        CANARY_LEASE_TOKEN: winner.claim.owner.leaseToken,
      },
    }).stdout,
    "finalize container JSON",
  );
  assertEqual(finalized.heartbeat.status, "heartbeat", "heartbeat status");
  assertEqual(finalized.release.status, "released", "release status");
  assertEqual(
    finalized.postReleaseVerify.status,
    "released",
    "post-release verification status",
  );

  const inspected = parseJson(
    runContainer("inspect", {
      label: "inspect released PostgreSQL claim row",
    }).stdout,
    "inspect container JSON",
  );
  assertEqual(inspected.rows.length, 1, "released canary row count");
  assertEqual(inspected.rows[0].state, "released", "released canary row state");

  console.log(
    JSON.stringify(
      {
        ok: true,
        imageTag,
        networkName,
        schema,
        workItemId,
        winner: {
          hostId: winner.hostId,
          agentId: winner.claim.owner.agentId,
          fencingToken: winner.claim.authorityClaim.fencingToken,
          leaseToken: winner.claim.owner.leaseToken,
        },
        loser: {
          hostId: loser.hostId,
          status: loser.claim.status,
          observedFencingToken: loser.claim.authorityClaim.fencingToken,
        },
        heartbeat: finalized.heartbeat,
        release: finalized.release,
        databaseRows: inspected.rows,
        tempRoot: keepTemp ? tempRoot : null,
      },
      null,
      2,
    ),
  );
} finally {
  cleanup();
}

function assertDockerAvailable() {
  run(dockerCommand, ["version"], { label: "check Docker availability" });
}

function prepareBuildContext(contextRoot) {
  fs.mkdirSync(contextRoot, { recursive: true });
  for (const fileName of ["package.json", "package-lock.json", "tsconfig.json"]) {
    fs.copyFileSync(path.join(repoRoot, fileName), path.join(contextRoot, fileName));
  }
  fs.cpSync(path.join(repoRoot, "src"), path.join(contextRoot, "src"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(contextRoot, "Dockerfile"),
    `FROM node:22-bookworm-slim
WORKDIR /app
ENV npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts \\
  && npm install --no-save --no-audit --no-fund --ignore-scripts pg@8.21.0
COPY src ./src
COPY canary-worker.mjs ./canary-worker.mjs
RUN npm run build
ENTRYPOINT ["node", "/app/canary-worker.mjs"]
`,
  );
  fs.writeFileSync(path.join(contextRoot, "canary-worker.mjs"), workerSource());
}

function prepareHostFixture(workspaceRoot, homePath) {
  fs.mkdirSync(path.join(workspaceRoot, "source"), { recursive: true });
  fs.mkdirSync(homePath, { recursive: true });
  writeJsonFile(path.join(workspaceRoot, "dev-nexus.project.json"), {
    version: 1,
    id: "postgres-container-canary",
    name: "PostgreSQL Container Canary",
    components: [
      {
        id: "core",
        name: "Core",
        kind: "git",
        role: "primary",
        remoteUrl: null,
        defaultBranch: "main",
        sourceRoot: "source",
        defaultWorkTrackerId: "github",
        workTrackers: [
          {
            id: "github",
            name: "GitHub",
            enabled: true,
            roles: ["primary", "eligible_source"],
            workTracking: {
              provider: "github",
              repository: {
                owner: "example",
                name: "demo",
              },
            },
          },
        ],
        relationships: [],
      },
    ],
    automation: {
      enabled: true,
      mode: "agent_launch",
      eligibleWorkMode: "default",
      workItemClaims: {
        enabled: true,
        leaseDurationMs: 600000,
        heartbeatIntervalMs: 120000,
        staleClaimPolicy: "report",
        authority: {
          backend: "postgres",
          postgres: {
            connectionProfileId: "container-postgres-claims",
          },
        },
      },
      selector: {
        statuses: ["ready"],
        labels: ["postgres-container-canary"],
        excludeLabels: ["blocked"],
        assignees: [],
        search: null,
        limit: 1,
      },
      agent: {
        timeoutMs: 300000,
      },
    },
  });
  writeJsonFile(path.join(homePath, "dev-nexus.home.json"), {
    version: 1,
    paths: {
      projectsRoot: path.join(homePath, "projects"),
      workspacesRoot: path.join(homePath, "workspaces"),
    },
    projects: [],
    claimAuthorityProfiles: [
      {
        id: "container-postgres-claims",
        backend: "postgres",
        driver: "node_postgres",
        connectionStringEnv: "DEV_NEXUS_CLAIMS_DATABASE_URL",
        schema,
      },
    ],
  });
}

function waitForPostgres() {
  const deadline = Date.now() + 30_000;
  let lastOutput = "";
  while (Date.now() < deadline) {
    const result = spawnSync(
      dockerCommand,
      ["exec", postgresName, "pg_isready", "-U", "dev_nexus", "-d", "dev_nexus"],
      { encoding: "utf8" },
    );
    lastOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (result.status === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`PostgreSQL container did not become ready: ${lastOutput}`);
}

function runClaimHost(options) {
  return runContainerAsync("claim", {
    label: options.label,
    workspaceRoot: options.workspaceRoot,
    homePath: options.homePath,
    env: {
      CANARY_HOST_ID: options.hostId,
      CANARY_AGENT_ID: options.agentId,
      CANARY_LEASE_TOKEN: options.leaseToken,
    },
  }).then((result) => parseJson(result.stdout, `${options.label} JSON`));
}

function runContainer(mode, options = {}) {
  return run(
    dockerCommand,
    dockerRunArgs(mode, options),
    { label: options.label ?? `run ${mode} container` },
  );
}

function runContainerAsync(mode, options = {}) {
  return runAsync(
    dockerCommand,
    dockerRunArgs(mode, options),
    { label: options.label ?? `run ${mode} container` },
  );
}

function dockerRunArgs(mode, options = {}) {
  const env = {
    DEV_NEXUS_CLAIMS_DATABASE_URL: connectionString,
    DEV_NEXUS_CLAIMS_SCHEMA: schema,
    CANARY_WORK_ITEM_ID: workItemId,
    CANARY_NOW: "2026-05-23T10:00:00.000Z",
    CANARY_HEARTBEAT_NOW: "2026-05-23T10:05:00.000Z",
    CANARY_RELEASE_NOW: "2026-05-23T10:10:00.000Z",
    ...(options.workspaceRoot ? { PROJECT_ROOT: "/workspace" } : {}),
    ...(options.homePath ? { DEV_NEXUS_HOME: "/home/dev-nexus" } : {}),
    ...(options.env ?? {}),
  };
  const args = ["run", "--rm", "--network", networkName];
  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }
  if (options.workspaceRoot) {
    args.push("-v", `${options.workspaceRoot}:/workspace:ro`);
  }
  if (options.homePath) {
    args.push("-v", `${options.homePath}:/home/dev-nexus:ro`);
  }
  args.push(imageTag, mode);
  return args;
}

function cleanup() {
  if (postgresStarted) {
    spawnSync(dockerCommand, ["rm", "-f", "-v", postgresName], { encoding: "utf8" });
  }
  if (networkCreated) {
    spawnSync(dockerCommand, ["network", "rm", networkName], { encoding: "utf8" });
  }
  if (imageBuilt && !keepTemp) {
    spawnSync(dockerCommand, ["image", "rm", "-f", imageTag], { encoding: "utf8" });
  }
  if (!keepTemp) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${options.label ?? command} failed with exit ${result.status}\nSTDOUT:\n${result.stdout ?? ""}\nSTDERR:\n${result.stderr ?? ""}`,
    );
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${options.label ?? command} failed with exit ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${error.message}\n${value}`);
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function workerSource() {
  return String.raw`#!/usr/bin/env node
import {
  createNexusNodePostgresClaimSqlClient,
} from "./dist/nexusNodePostgresClaimSqlClient.js";
import {
  NexusPostgresWorkItemClaimAuthority,
  nexusPostgresClaimAuthoritySchemaSql,
} from "./dist/nexusPostgresWorkItemClaimAuthority.js";
import { loadProjectConfig } from "./dist/nexusProjectConfig.js";
import { resolveProjectComponents } from "./dist/nexusProjectLifecycle.js";
import {
  claimNexusEligibleWorkItem,
  heartbeatNexusWorkItemAuthorityClaim,
  verifyNexusWorkItemAuthorityClaim,
} from "./dist/nexusWorkItemClaim.js";

const mode = process.argv[2];

async function main() {
  if (mode === "init") {
    await initializeSchema();
  } else if (mode === "claim") {
    await claim();
  } else if (mode === "finalize") {
    await finalize();
  } else if (mode === "inspect") {
    await inspect();
  } else {
    throw new Error("container canary worker requires init, claim, finalize, or inspect");
  }
}

async function initializeSchema() {
  const schema = requiredEnv("DEV_NEXUS_CLAIMS_SCHEMA");
  const client = await postgresClient();
  await client.transaction(async (transaction) => {
    await transaction.query("CREATE SCHEMA IF NOT EXISTS " + quotePostgresIdentifier(schema));
    await transaction.query(nexusPostgresClaimAuthoritySchemaSql);
  });
  writeJson({ status: "initialized", schema });
}

async function claim() {
  const projectRoot = requiredEnv("PROJECT_ROOT");
  const homePath = requiredEnv("DEV_NEXUS_HOME");
  const workItemId = requiredEnv("CANARY_WORK_ITEM_ID");
  const hostId = requiredEnv("CANARY_HOST_ID");
  const agentId = requiredEnv("CANARY_AGENT_ID");
  const leaseToken = requiredEnv("CANARY_LEASE_TOKEN");
  const now = requiredEnv("CANARY_NOW");
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation;
  const components = resolveProjectComponents(projectRoot, projectConfig);
  const provider = new CanaryProvider(workItem(workItemId));
  const claim = await claimNexusEligibleWorkItem({
    projectRoot,
    projectConfig,
    components,
    automationConfig,
    componentId: "core",
    trackerId: "github",
    mode: "default",
    providerFactory: () => provider,
    homePath,
    env: process.env,
    owner: {
      hostId,
      agentId,
      ownerId: "container-canary",
    },
    leaseDurationMs: automationConfig.workItemClaims.leaseDurationMs,
    staleClaimPolicy: automationConfig.workItemClaims.staleClaimPolicy,
    leaseTokenFactory: () => leaseToken,
    now: () => now,
  });
  writeJson({
    hostId,
    claim: simplifyClaim(claim),
    mirror: {
      updates: provider.updates.length,
      comments: provider.comments.length,
    },
  });
}

async function finalize() {
  const projectRoot = requiredEnv("PROJECT_ROOT");
  const homePath = requiredEnv("DEV_NEXUS_HOME");
  const authorityClaim = JSON.parse(requiredEnv("CANARY_AUTHORITY_CLAIM_JSON"));
  const leaseToken = requiredEnv("CANARY_LEASE_TOKEN");
  const heartbeatNow = requiredEnv("CANARY_HEARTBEAT_NOW");
  const releaseNow = requiredEnv("CANARY_RELEASE_NOW");
  const projectConfig = loadProjectConfig(projectRoot);
  const automationConfig = projectConfig.automation;
  const heartbeat = await heartbeatNexusWorkItemAuthorityClaim({
    projectRoot,
    projectConfig,
    automationConfig,
    authorityClaim,
    leaseDurationMs: automationConfig.workItemClaims.leaseDurationMs,
    homePath,
    env: process.env,
    now: () => heartbeatNow,
  });
  const authority = new NexusPostgresWorkItemClaimAuthority({
    client: await postgresClient(),
  });
  const release = await authority.releaseClaim({
    key: authorityClaim.key,
    leaseToken,
    now: new Date(releaseNow),
  });
  const postReleaseVerify = await verifyNexusWorkItemAuthorityClaim({
    projectRoot,
    projectConfig,
    automationConfig,
    authorityClaim,
    homePath,
    env: process.env,
    now: () => releaseNow,
  });
  writeJson({
    heartbeat: simplifyAuthorityResult(heartbeat),
    release: simplifyAuthorityResult(release),
    postReleaseVerify: simplifyAuthorityResult(postReleaseVerify),
  });
}

async function inspect() {
  const workItemId = requiredEnv("CANARY_WORK_ITEM_ID");
  const client = await postgresClient();
  const rows = await client.transaction((transaction) =>
    transaction.query(
      'SELECT work_item_id AS "workItemId", state, fencing_token AS "fencingToken", released_at AS "releasedAt", last_heartbeat_at AS "lastHeartbeatAt" FROM dev_nexus_work_item_claims WHERE work_item_id = $1',
      [workItemId],
    )
  );
  writeJson({ rows: rows.rows });
}

async function postgresClient() {
  return createNexusNodePostgresClaimSqlClient({
    connectionString: requiredEnv("DEV_NEXUS_CLAIMS_DATABASE_URL"),
    schema: requiredEnv("DEV_NEXUS_CLAIMS_SCHEMA"),
    applicationName: "dev-nexus-postgres-container-canary",
  });
}

class CanaryProvider {
  provider = "github";
  capabilities = {
    createItem: false,
    listItems: true,
    getItem: true,
    updateItem: true,
    comment: true,
    labels: true,
    assignees: true,
    milestones: true,
    board: false,
    boardStatus: false,
    draftItems: false,
    webhooks: false,
  };
  updates = [];
  comments = [];

  constructor(item) {
    this.items = [structuredClone(item)];
  }

  async createWorkItem() {
    throw new Error("not implemented");
  }

  async listWorkItems(query) {
    return this.items.filter((item) => matchesQuery(item, query)).map(cloneItem);
  }

  async getWorkItem(ref) {
    return cloneItem(this.findItem(ref));
  }

  async updateWorkItem(ref, patch) {
    this.updates.push({ ref: structuredClone(ref), patch: structuredClone(patch) });
    const item = this.findItem(ref);
    Object.assign(item, patch);
    return cloneItem(item);
  }

  async addComment(ref, body) {
    this.comments.push({ ref: structuredClone(ref), body });
    return {
      id: "comment-" + this.comments.length,
      body,
      author: "container-canary",
    };
  }

  findItem(ref) {
    const id = ref.id ?? ref.externalRef?.itemId;
    const item = this.items.find(
      (candidate) =>
        candidate.id === id ||
        candidate.externalRef?.itemId === id ||
        String(candidate.externalRef?.itemNumber) === String(id),
    );
    if (!item) {
      throw new Error("missing canary item " + id);
    }
    return item;
  }
}

function workItem(id) {
  return {
    id,
    title: "PostgreSQL container race canary",
    description: "Synthetic canary item. No provider writes are made.",
    status: "ready",
    provider: "github",
    labels: ["postgres-container-canary"],
    assignees: [],
    milestone: null,
    createdAt: "2026-05-23T09:00:00.000Z",
    updatedAt: "2026-05-23T09:00:00.000Z",
    closedAt: null,
    webUrl: "https://github.com/example/demo/issues/" + id,
    externalRef: {
      provider: "github",
      host: "github.com",
      repositoryOwner: "example",
      repositoryName: "demo",
      itemId: id,
      itemKey: id,
    },
  };
}

function matchesQuery(item, query) {
  const statuses = Array.isArray(query.status)
    ? query.status
    : query.status
      ? [query.status]
      : [];
  if (statuses.length > 0 && !statuses.includes(item.status)) {
    return false;
  }
  if (query.labels?.some((label) => !item.labels?.includes(label))) {
    return false;
  }
  if (query.search && !item.title.includes(query.search)) {
    return false;
  }
  return true;
}

function simplifyClaim(claim) {
  return {
    status: claim.status,
    reason: claim.reason,
    componentId: claim.componentId,
    trackerId: claim.trackerId,
    owner: claim.owner,
    authorityClaim: claim.authorityClaim,
    workItem: claim.workItem
      ? {
          id: claim.workItem.id,
          status: claim.workItem.status,
        }
      : undefined,
  };
}

function simplifyAuthorityResult(result) {
  return {
    status: result.status,
    reason: result.reason,
    claim: result.claim
      ? {
          state: result.claim.state,
          fencingToken: result.claim.fencingToken,
          releasedAt: result.claim.releasedAt,
          lastHeartbeatAt: result.claim.lastHeartbeatAt,
          owner: result.claim.owner,
        }
      : undefined,
  };
}

function cloneItem(item) {
  return {
    ...item,
    labels: item.labels ? [...item.labels] : undefined,
    assignees: item.assignees ? [...item.assignees] : undefined,
    externalRef: item.externalRef ? { ...item.externalRef } : undefined,
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(name + " must be set");
  }
  return value;
}

function quotePostgresIdentifier(value) {
  return '"' + value.replaceAll('"', '""') + '"';
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

await main();
`;
}
