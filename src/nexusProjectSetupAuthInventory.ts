import fs from "node:fs";
import path from "node:path";
import type {
  NexusProjectSetupAnswers,
  NexusProjectSetupAuthCapabilityCheck,
  NexusProjectSetupAuthInventory,
  NexusProjectSetupAuthInventoryEntry,
  NexusProjectSetupAuthProfileAnswers,
  NexusProjectSetupAuthProvider,
  NexusProjectSetupAuthReference,
  NexusProjectSetupAuthRequirement,
  NexusProjectSetupCredentialMethod,
  NexusProjectSetupMissingAuthReference,
} from "./nexusProjectSetupModel.js";

export type {
  NexusProjectSetupAuthCapabilityCheck,
  NexusProjectSetupAuthCapabilityStatus,
  NexusProjectSetupAuthInventory,
  NexusProjectSetupAuthInventoryEntry,
  NexusProjectSetupAuthReference,
  NexusProjectSetupAuthRequirement,
  NexusProjectSetupMissingAuthReference,
} from "./nexusProjectSetupModel.js";

export interface BuildNexusProjectSetupAuthInventoryOptions {
  env?: Record<string, string | undefined>;
  pathEnv?: string;
  commandExists?: (command: string) => boolean;
}

export function buildNexusProjectSetupAuthInventory(
  answers: NexusProjectSetupAnswers,
  options: BuildNexusProjectSetupAuthInventoryOptions = {},
): NexusProjectSetupAuthInventory {
  const references = collectAuthReferences(answers);
  const referencesByProfile = groupReferencesByProfile(references);
  const profileById = new Map(
    (answers.authProfiles ?? []).map((profile) => [profile.id, profile]),
  );
  const commandExists = options.commandExists ?? defaultCommandExists(options.pathEnv);
  const env = options.env ?? process.env;
  const profiles = [...profileById.values()].map((profile) =>
    buildAuthInventoryEntry({
      profile,
      references: referencesByProfile.get(profile.id) ?? [],
      env,
      commandExists,
    }),
  );
  const missingProfiles = [...referencesByProfile.entries()]
    .filter(([profileId]) => !profileById.has(profileId))
    .map(([profileId, profileReferences]) => ({
      profileId,
      references: profileReferences,
      nextAction: `Add authProfiles[] entry '${profileId}' with a host-local credential reference; do not paste raw tokens into setup answers.`,
    }));

  return {
    profiles,
    missingProfiles,
    requiredNowProfileIds: profiles
      .filter((profile) => profile.highestRequirement === "required_now")
      .map((profile) => profile.id),
    providerMutationOnlyProfileIds: profiles
      .filter((profile) => profile.highestRequirement === "provider_mutation_only")
      .map((profile) => profile.id),
    optionalLaterProfileIds: profiles
      .filter((profile) => profile.highestRequirement === "optional_later")
      .map((profile) => profile.id),
    summary: renderAuthInventorySummary(profiles, missingProfiles),
  };
}

function collectAuthReferences(
  answers: NexusProjectSetupAnswers,
): Array<{ profileId: string; reference: NexusProjectSetupAuthReference }> {
  const refs: Array<{ profileId: string; reference: NexusProjectSetupAuthReference }> = [];
  const push = (
    profileId: string | undefined,
    reference: NexusProjectSetupAuthReference,
  ) => {
    if (!profileId) {
      return;
    }
    refs.push({ profileId, reference });
  };

  push(answers.hostingIntent?.humanAuthProfileId, {
    path: "hostingIntent.humanAuthProfileId",
    purpose: "Read hosting status and perform manual human repository actions.",
    provider: answers.hostingIntent?.provider,
    requirement: "required_now",
  });
  push(answers.hostingIntent?.automationAuthProfileId, {
    path: "hostingIntent.automationAuthProfileId",
    purpose: "Use the automation account for agent-created Git/provider activity.",
    provider: answers.hostingIntent?.provider,
    requirement: "required_now",
  });
  push(answers.hostingIntent?.providerMutationAuthProfileId, {
    path: "hostingIntent.providerMutationAuthProfileId",
    purpose: "Apply provider mutations such as repository creation or access repair.",
    provider: answers.hostingIntent?.provider,
    requirement: "provider_mutation_only",
  });
  push(answers.publication?.automationAuthProfileId, {
    path: "publication.automationAuthProfileId",
    purpose: "Publish agent-created branches, pushes, or review handoffs as automation.",
    requirement: "required_now",
  });
  push(answers.publication?.humanAuthProfileId, {
    path: "publication.humanAuthProfileId",
    purpose: "Document the manual human publication account.",
    requirement: "optional_later",
  });

  for (const [index, tracker] of (answers.workTrackers ?? []).entries()) {
    push(tracker.authProfileId, {
      path: `workTrackers[${index}].authProfileId`,
      purpose: `Read or coordinate ${tracker.provider} work tracker ${tracker.id}.`,
      provider: tracker.provider,
      requirement: tracker.role === "primary" ? "required_now" : "optional_later",
    });
  }

  for (const [index, check] of (answers.readinessChecks ?? []).entries()) {
    push(check.requiresAuthProfileId, {
      path: `readinessChecks[${index}].requiresAuthProfileId`,
      purpose: check.title,
      provider: check.provider,
      requirement: "required_now",
    });
  }

  return refs;
}

function groupReferencesByProfile(
  refs: Array<{ profileId: string; reference: NexusProjectSetupAuthReference }>,
): Map<string, NexusProjectSetupAuthReference[]> {
  const grouped = new Map<string, NexusProjectSetupAuthReference[]>();
  for (const ref of refs) {
    grouped.set(ref.profileId, [...(grouped.get(ref.profileId) ?? []), ref.reference]);
  }
  return grouped;
}

function buildAuthInventoryEntry(options: {
  profile: NexusProjectSetupAuthProfileAnswers;
  references: NexusProjectSetupAuthReference[];
  env: Record<string, string | undefined>;
  commandExists: (command: string) => boolean;
}): NexusProjectSetupAuthInventoryEntry {
  return {
    id: options.profile.id,
    provider: options.profile.provider,
    actorKind: options.profile.actorKind,
    account: options.profile.account ?? null,
    host: options.profile.host ?? null,
    credentialMethodKind: options.profile.credentialMethod.kind,
    credentialReference: credentialReference(options.profile.credentialMethod),
    highestRequirement: highestRequirement(options.references),
    references: options.references,
    capabilityChecks: [
      capabilityCheckForCredentialMethod({
        profile: options.profile,
        env: options.env,
        commandExists: options.commandExists,
      }),
    ],
  };
}

function capabilityCheckForCredentialMethod(options: {
  profile: NexusProjectSetupAuthProfileAnswers;
  env: Record<string, string | undefined>;
  commandExists: (command: string) => boolean;
}): NexusProjectSetupAuthCapabilityCheck {
  const method = options.profile.credentialMethod;
  switch (method.kind) {
    case "provider_cli": {
      const exists = options.commandExists(method.cli);
      return {
        id: `${options.profile.id}-provider-cli`,
        title: `Find ${method.cli} CLI`,
        status: exists ? "available" : "missing",
        summary: exists
          ? `${method.cli} is available on PATH.`
          : `${method.cli} is not available on PATH.`,
        nextAction: providerCliNextAction(method, options.profile.provider),
      };
    }
    case "environment_variable": {
      const exists = !!options.env[method.variable];
      return {
        id: `${options.profile.id}-environment-variable`,
        title: `Check ${method.variable} environment variable`,
        status: exists ? "available" : "missing",
        summary: exists
          ? `${method.variable} is defined; value was not read.`
          : `${method.variable} is not defined.`,
        nextAction: `Define ${method.variable} in the host-local agent environment; do not write its value to workspace config.`,
      };
    }
    case "http_api_token_reference":
      return manualReferenceCheck(
        options.profile.id,
        "HTTP API token reference",
        method.reference,
      );
    case "token_store_reference":
      return manualReferenceCheck(
        options.profile.id,
        "Token store reference",
        method.reference,
      );
    case "manual":
      return {
        id: `${options.profile.id}-manual`,
        title: "Manual credential check",
        status: "manual",
        summary: "Manual credential instructions are recorded without shared secrets.",
        nextAction: method.instructions ?? "Verify this credential manually on the host.",
      };
  }
}

function manualReferenceCheck(
  profileId: string,
  title: string,
  reference: string,
): NexusProjectSetupAuthCapabilityCheck {
  return {
    id: `${profileId}-manual-reference`,
    title,
    status: "manual",
    summary: `${title} is configured as ${reference}; value was not read.`,
    nextAction: "Verify the referenced host-local credential store entry before provider operations.",
  };
}

function providerCliNextAction(
  method: Extract<NexusProjectSetupCredentialMethod, { kind: "provider_cli" }>,
  provider: NexusProjectSetupAuthProvider,
): string {
  const configDir = method.configDir ? ` with ${method.configDir}` : "";
  if (method.cli === "gh" || provider === "github") {
    return `Run gh auth status${configDir} and ensure the intended human or bot account is active.`;
  }
  if (method.cli === "glab" || provider === "gitlab") {
    return `Run glab auth status${configDir} and ensure the intended human or bot account is active.`;
  }
  if (method.cli === "jira" || provider === "jira") {
    return `Run jira me${configDir} or the configured Jira CLI status command for this profile.`;
  }

  return `Run ${method.cli} provider auth/status checks${configDir}.`;
}

function credentialReference(method: NexusProjectSetupCredentialMethod): string | null {
  switch (method.kind) {
    case "provider_cli":
      return method.configDir ?? method.cli;
    case "environment_variable":
      return method.variable;
    case "http_api_token_reference":
    case "token_store_reference":
      return method.reference;
    case "manual":
      return method.instructions ?? null;
  }
}

function highestRequirement(
  references: NexusProjectSetupAuthReference[],
): NexusProjectSetupAuthRequirement {
  if (references.some((reference) => reference.requirement === "required_now")) {
    return "required_now";
  }
  if (references.some((reference) => reference.requirement === "provider_mutation_only")) {
    return "provider_mutation_only";
  }
  return "optional_later";
}

function renderAuthInventorySummary(
  profiles: NexusProjectSetupAuthInventoryEntry[],
  missingProfiles: NexusProjectSetupMissingAuthReference[],
): string {
  const requiredNow = profiles.filter((profile) => profile.highestRequirement === "required_now").length;
  const providerMutationOnly = profiles.filter((profile) => profile.highestRequirement === "provider_mutation_only").length;
  const missing = missingProfiles.length;
  return `${profiles.length} auth profile(s); ${requiredNow} required now; ${providerMutationOnly} provider-mutation-only; ${missing} missing referenced profile(s).`;
}

function defaultCommandExists(pathEnv = process.env.PATH ?? ""): (command: string) => boolean {
  const searchPaths = pathEnv.split(path.delimiter).filter(Boolean);
  return (command: string): boolean => {
    if (command.includes(path.sep)) {
      return fs.existsSync(command);
    }
    return searchPaths.some((searchPath) => fs.existsSync(path.join(searchPath, command)));
  };
}
