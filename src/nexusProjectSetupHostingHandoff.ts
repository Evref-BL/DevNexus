import type {
  NexusProjectSetupAnswers,
  NexusProjectSetupAuthInventory,
  NexusProjectSetupHostingHandoff,
  NexusProjectSetupMetaHostingIntent,
} from "./nexusProjectSetupModel.js";

export type {
  NexusProjectSetupHostingHandoff,
  NexusProjectSetupHostingHandoffCommand,
  NexusProjectSetupHostingHandoffStatus,
} from "./nexusProjectSetupModel.js";

export function buildNexusProjectSetupHostingHandoff(
  answers: NexusProjectSetupAnswers,
  authInventory?: NexusProjectSetupAuthInventory,
): NexusProjectSetupHostingHandoff {
  if (!answers.hostingIntent) {
    return {
      status: "not_configured",
      provider: null,
      host: null,
      namespace: null,
      repositoryName: null,
      defaultBranch: null,
      metaProjectOnly: true,
      componentRepositoryHosting: "not_configured_by_project_setup",
      summary:
        "Workspace repository hosting intent is not configured; workspace setup will only write local DevNexus files.",
      commands: [],
      missingAuthProfileIds: [],
      providerMutationsDeferred: true,
    };
  }

  const missingAuthProfileIds = missingHostingAuthProfileIds(
    answers.hostingIntent,
    authInventory,
  );
  const projectRoot = shellQuote(answers.project.root);
  const status = missingAuthProfileIds.length > 0 ? "blocked_on_auth" : "planned";

  return {
    status,
    provider: answers.hostingIntent.provider,
    host: answers.hostingIntent.host ?? null,
    namespace: answers.hostingIntent.namespace,
    repositoryName: answers.hostingIntent.repositoryName,
    defaultBranch: answers.hostingIntent.defaultBranch ?? null,
    metaProjectOnly: true,
    componentRepositoryHosting: "not_configured_by_project_setup",
    summary: status === "blocked_on_auth"
      ? `Workspace repository hosting intent is configured for ${answers.hostingIntent.namespace}/${answers.hostingIntent.repositoryName}, but referenced auth profile(s) are missing: ${missingAuthProfileIds.join(", ")}.`
      : `Workspace repository hosting intent is configured for ${answers.hostingIntent.namespace}/${answers.hostingIntent.repositoryName}; provider mutations are deferred to explicit hosting plan/apply commands.`,
    commands: [
      {
        id: "hosting-status",
        title: "Inspect hosting status",
        command: `dev-nexus workspace hosting status ${projectRoot} --json`,
        providerMutation: false,
        allowedDuringProjectSetup: false,
        authProfileId:
          answers.hostingIntent.humanAuthProfileId ??
          answers.hostingIntent.automationAuthProfileId ??
          null,
      },
      {
        id: "hosting-plan",
        title: "Plan hosting changes",
        command: `dev-nexus workspace hosting plan ${projectRoot} --json`,
        providerMutation: false,
        allowedDuringProjectSetup: false,
        authProfileId:
          answers.hostingIntent.humanAuthProfileId ??
          answers.hostingIntent.automationAuthProfileId ??
          null,
      },
      {
        id: "hosting-apply",
        title: "Apply explicit hosting plan",
        command: `dev-nexus workspace hosting apply ${projectRoot} --json`,
        providerMutation: true,
        allowedDuringProjectSetup: false,
        authProfileId: answers.hostingIntent.providerMutationAuthProfileId ?? null,
      },
    ],
    missingAuthProfileIds,
    providerMutationsDeferred: true,
  };
}

function missingHostingAuthProfileIds(
  hosting: NexusProjectSetupMetaHostingIntent,
  authInventory: NexusProjectSetupAuthInventory | undefined,
): string[] {
  if (!authInventory) {
    return [];
  }
  const missing = new Set(authInventory.missingProfiles.map((profile) => profile.profileId));
  return [
    hosting.humanAuthProfileId,
    hosting.automationAuthProfileId,
    hosting.providerMutationAuthProfileId,
  ].filter((profileId): profileId is string => !!profileId && missing.has(profileId));
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) {
    return value;
  }

  return `'${value.replace(/'/gu, "'\\''")}'`;
}
