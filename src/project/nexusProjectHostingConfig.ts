import type {
  NexusProjectHostingAccessPrincipalKind,
  NexusProjectHostingAccessRole,
  NexusProjectHostingConfig,
  NexusProjectHostingInvitationPolicy,
  NexusProjectHostingProviderName,
  NexusProjectHostingRequiredPermission,
  NexusProjectHostingRemoteProtocol,
  NexusProjectHostingRemoteRole,
  NexusProjectHostingRepositoryVisibility,
} from "./nexusProjectHosting.js";
import {
  NexusConfigError,
  assertRecord,
  optionalBoolean,
  optionalString,
  optionalStringRecord,
  requiredString,
} from "./nexusProjectConfigValidation.js";

function validateProjectHostingProviderName(
  value: unknown,
  pathName: string,
): NexusProjectHostingProviderName {
  if (value === "github") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be github`);
}

function validateProjectHostingRepositoryVisibility(
  value: unknown,
  pathName: string,
): NexusProjectHostingRepositoryVisibility {
  if (value === undefined) {
    return "private";
  }
  if (value === "public" || value === "private" || value === "internal") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be public, private, or internal`);
}

function validateProjectHostingRemoteProtocol(
  value: unknown,
  pathName: string,
): NexusProjectHostingRemoteProtocol {
  if (value === undefined) {
    return "ssh";
  }
  if (value === "ssh" || value === "https") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be ssh or https`);
}

function validateProjectHostingRemoteRole(
  value: unknown,
  pathName: string,
): NexusProjectHostingRemoteRole {
  if (value === undefined) {
    return "other";
  }
  if (value === "human" || value === "automation" || value === "other") {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be human, automation, or other`);
}

function validateProjectHostingAccessPrincipalKind(
  value: unknown,
  pathName: string,
): NexusProjectHostingAccessPrincipalKind {
  if (
    value === "human" ||
    value === "machine_user" ||
    value === "team" ||
    value === "deploy_key" ||
    value === "app"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be human, machine_user, team, deploy_key, or app`,
  );
}

function validateProjectHostingAccessRole(
  value: unknown,
  pathName: string,
): NexusProjectHostingAccessRole {
  if (
    value === "human" ||
    value === "automation" ||
    value === "reviewer" ||
    value === "observer" ||
    value === "other"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be human, automation, reviewer, observer, or other`,
  );
}

function validateProjectHostingRequiredPermission(
  value: unknown,
  pathName: string,
): NexusProjectHostingRequiredPermission {
  if (
    value === "read" ||
    value === "write" ||
    value === "maintain" ||
    value === "admin"
  ) {
    return value;
  }

  throw new NexusConfigError(`${pathName} must be read, write, maintain, or admin`);
}

function validateProjectHostingInvitationPolicy(
  value: unknown,
  pathName: string,
): NexusProjectHostingInvitationPolicy {
  if (value === undefined) {
    return "require_accepted";
  }
  if (
    value === "require_accepted" ||
    value === "allow_pending" ||
    value === "auto_accept" ||
    value === "manual"
  ) {
    return value;
  }

  throw new NexusConfigError(
    `${pathName} must be require_accepted, allow_pending, auto_accept, or manual`,
  );
}

function validateProjectHostingRepositoryConfig(
  value: unknown,
): NexusProjectHostingConfig["repository"] {
  const pathName = "workspace config.hosting.repository";
  const record =
    value === undefined ? {} : assertRecord(value, pathName);
  const name = optionalString(record, "name", pathName);
  const nameTemplate = optionalString(record, "nameTemplate", pathName);
  if (name !== undefined && nameTemplate !== undefined) {
    throw new NexusConfigError(
      `${pathName} must define either name or nameTemplate, not both`,
    );
  }

  return {
    ...(name !== undefined ? { name } : {}),
    ...(nameTemplate !== undefined ? { nameTemplate } : {}),
    visibility: validateProjectHostingRepositoryVisibility(
      record.visibility,
      `${pathName}.visibility`,
    ),
    defaultBranch:
      optionalString(record, "defaultBranch", pathName) ?? "main",
  };
}

function validateProjectHostingRemoteConfig(
  value: unknown,
  index: number,
): NexusProjectHostingConfig["remotes"][number] {
  const pathName = `workspace config.hosting.remotes[${index}]`;
  const record = assertRecord(value, pathName);
  const protocol = validateProjectHostingRemoteProtocol(
    record.protocol,
    `${pathName}.protocol`,
  );
  const authProfile = optionalString(record, "authProfile", pathName);
  const host = optionalString(record, "host", pathName);
  const sshHost = optionalString(record, "sshHost", pathName);
  if (protocol === "https" && sshHost !== undefined) {
    throw new NexusConfigError(
      `${pathName}.sshHost is only valid for ssh remotes`,
    );
  }

  return {
    name: requiredString(record, "name", pathName),
    role: validateProjectHostingRemoteRole(record.role, `${pathName}.role`),
    protocol,
    ...(authProfile !== undefined ? { authProfile } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(sshHost !== undefined ? { sshHost } : {}),
  };
}

function validateProjectHostingRemotes(
  value: unknown,
): NexusProjectHostingConfig["remotes"] {
  if (value === undefined) {
    return [
      {
        name: "origin",
        role: "human",
        protocol: "ssh",
      },
    ];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("workspace config.hosting.remotes must be an array");
  }
  if (value.length === 0) {
    throw new NexusConfigError(
      "workspace config.hosting.remotes must not be empty",
    );
  }

  const remotes = value.map((remote, index) =>
    validateProjectHostingRemoteConfig(remote, index),
  );
  const names = new Set<string>();
  for (const remote of remotes) {
    if (names.has(remote.name)) {
      throw new NexusConfigError(
        `workspace config.hosting.remotes contains duplicate name: ${remote.name}`,
      );
    }
    names.add(remote.name);
  }

  return remotes;
}

function validateProjectHostingAccessPrincipalConfig(
  value: unknown,
  index: number,
): NexusProjectHostingConfig["access"][number] {
  const pathName = `workspace config.hosting.access[${index}]`;
  const record = assertRecord(value, pathName);
  const authProfile = optionalString(record, "authProfile", pathName);
  const requiredProviderPermissions = optionalStringRecord(
    record,
    "requiredProviderPermissions",
    pathName,
  );

  return {
    kind: validateProjectHostingAccessPrincipalKind(
      record.kind,
      `${pathName}.kind`,
    ),
    providerIdentity: requiredString(record, "providerIdentity", pathName),
    role: validateProjectHostingAccessRole(record.role, `${pathName}.role`),
    requiredPermission: validateProjectHostingRequiredPermission(
      record.requiredPermission,
      `${pathName}.requiredPermission`,
    ),
    ...(requiredProviderPermissions !== undefined
      ? { requiredProviderPermissions }
      : {}),
    ...(authProfile !== undefined ? { authProfile } : {}),
    invitationPolicy: validateProjectHostingInvitationPolicy(
      record.invitationPolicy,
      `${pathName}.invitationPolicy`,
    ),
  };
}

function validateProjectHostingAccess(
  value: unknown,
): NexusProjectHostingConfig["access"] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new NexusConfigError("workspace config.hosting.access must be an array");
  }

  const access = value.map((principal, index) =>
    validateProjectHostingAccessPrincipalConfig(principal, index),
  );
  const identities = new Set<string>();
  for (const principal of access) {
    const identityKey =
      `${principal.kind}:${principal.providerIdentity}`.toLowerCase();
    if (identities.has(identityKey)) {
      throw new NexusConfigError(
        `workspace config.hosting.access contains duplicate principal: ` +
          `${principal.kind}:${principal.providerIdentity}`,
      );
    }
    identities.add(identityKey);
  }

  return access;
}

function validateProjectHostingProvisioningConfig(
  value: unknown,
): NexusProjectHostingConfig["provisioning"] {
  const pathName = "workspace config.hosting.provisioning";
  const record =
    value === undefined ? {} : assertRecord(value, pathName);
  const providerMutationAuthProfile = optionalString(
    record,
    "providerMutationAuthProfile",
    pathName,
  );

  return {
    allowCreate: optionalBoolean(record, "allowCreate", pathName) ?? false,
    allowLocalRemoteRepair:
      optionalBoolean(record, "allowLocalRemoteRepair", pathName) ?? false,
    allowAccessRepair:
      optionalBoolean(record, "allowAccessRepair", pathName) ?? false,
    allowInvitationAcceptance:
      optionalBoolean(record, "allowInvitationAcceptance", pathName) ?? false,
    allowDefaultBranchRepair:
      optionalBoolean(record, "allowDefaultBranchRepair", pathName) ?? false,
    allowVisibilityRepair:
      optionalBoolean(record, "allowVisibilityRepair", pathName) ?? false,
    ...(providerMutationAuthProfile !== undefined
      ? { providerMutationAuthProfile }
      : {}),
  };
}

const sharedHostingSecretFieldNames = new Set([
  "token",
  "accessToken",
  "privateKey",
  "privateKeyPath",
  "sshPrivateKey",
  "githubCliConfigDir",
  "ghConfigDir",
  "browserSession",
  "sessionCookie",
  "credentialPath",
  "credentials",
]);

function rejectSharedHostingSecretFields(value: unknown, pathName: string): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      rejectSharedHostingSecretFields(entry, `${pathName}[${index}]`),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const childPath = `${pathName}.${key}`;
    if (sharedHostingSecretFieldNames.has(key)) {
      throw new NexusConfigError(
        `${childPath} must not be stored in shared hosting config; ` +
          "use a host-local auth profile reference instead",
      );
    }
    rejectSharedHostingSecretFields(childValue, childPath);
  }
}

export function validateProjectHostingConfig(
  value: unknown,
): NexusProjectHostingConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const pathName = "workspace config.hosting";
  const record = assertRecord(value, pathName);
  rejectSharedHostingSecretFields(record, pathName);
  const authProfile = optionalString(record, "authProfile", pathName);

  return {
    provider: validateProjectHostingProviderName(
      record.provider,
      `${pathName}.provider`,
    ),
    namespace: requiredString(record, "namespace", pathName),
    repository: validateProjectHostingRepositoryConfig(record.repository),
    ...(authProfile !== undefined ? { authProfile } : {}),
    remotes: validateProjectHostingRemotes(record.remotes),
    access: validateProjectHostingAccess(record.access),
    provisioning: validateProjectHostingProvisioningConfig(record.provisioning),
  };
}
