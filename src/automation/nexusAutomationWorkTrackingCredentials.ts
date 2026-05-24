import path from "node:path";
import {
  resolveNexusCurrentAutomationActor,
} from "../authority/nexusAuthority.js";
import {
  resolveNexusPublicationPolicy,
} from "../publication/nexusPublicationPolicy.js";
import {
  createHostAuthProfileCredentialBroker,
} from "../providers/nexusProviderCredentialBroker.js";
import {
  defaultNexusHomePath,
  loadNexusHomeConfigFile,
  validateNexusHomeConfigBase,
} from "../project/nexusHomeConfig.js";
import { resolveNexusProjectPath } from "../runtime/nexusPathResolver.js";
import type {
  NexusProjectConfig,
} from "../project/nexusProjectConfig.js";
import type {
  NexusHostingAuthProfileConfig,
} from "../project/nexusProjectHosting.js";
import type {
  ResolvedNexusProjectComponent,
} from "../project/nexusProjectLifecycle.js";
import {
  defaultNexusWorkItemDiscoveryCredentialResolver,
  type NexusWorkItemDiscoveryCredentialResolver,
} from "../work-items/nexusWorkItemDiscoveryStatus.js";
import type {
  CreateWorkTrackerProviderOptions,
} from "../work-items/workTrackingProviderService.js";

export function loadNexusAutomationAuthProfiles(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  homePath?: string;
  authProfiles?: NexusHostingAuthProfileConfig[];
}): NexusHostingAuthProfileConfig[] {
  if (options.authProfiles) {
    return options.authProfiles;
  }

  const homePath = options.homePath
    ? path.resolve(options.homePath)
    : options.projectConfig.home
      ? resolveNexusProjectPath({
          projectRoot: options.projectRoot,
          value: options.projectConfig.home,
        })
      : defaultNexusHomePath();
  try {
    return loadNexusHomeConfigFile(
      homePath,
      validateNexusHomeConfigBase,
    ).authProfiles ?? [];
  } catch {
    return [];
  }
}

export function automationWorkTrackerProviderOptions(options: {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  component: ResolvedNexusProjectComponent;
  workTrackingProvider?: string | null;
  baseOptions?: CreateWorkTrackerProviderOptions;
  homePath?: string;
  authProfiles?: NexusHostingAuthProfileConfig[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date | string;
}): CreateWorkTrackerProviderOptions | undefined {
  const trackerProvider =
    options.workTrackingProvider ?? options.component.workTracking?.provider;
  if (options.baseOptions?.credentials || !trackerProvider) {
    return options.baseOptions;
  }
  const authProfiles = loadNexusAutomationAuthProfiles(options);
  const publication = resolveNexusPublicationPolicy(
    options.projectConfig,
    options.component,
  );
  const currentActor = resolveNexusCurrentAutomationActor({
    authority: options.projectConfig.authority,
    componentId: options.component.id,
    publication,
    authProfiles,
    repository: options.component.remoteUrl,
  });
  if (
    !currentActor.profileId ||
    !automationActorCanReadTrackerProvider(
      currentActor.expectedProvider,
      trackerProvider,
    )
  ) {
    return options.baseOptions;
  }

  return {
    ...options.baseOptions,
    credentials: {
      broker: createHostAuthProfileCredentialBroker({
        authProfiles,
        env: options.env,
        now: options.now,
      }),
      purpose: "api",
      profileId: currentActor.profileId,
      actorId: currentActor.expectedActorId,
      providerIdentity: currentActor.expectedHandle,
    },
  };
}

export function automationWorkItemDiscoveryCredentialResolver(options: {
  env: NodeJS.ProcessEnv;
  authProfiles: NexusHostingAuthProfileConfig[];
}): NexusWorkItemDiscoveryCredentialResolver {
  const envResolver = defaultNexusWorkItemDiscoveryCredentialResolver(options.env);
  return (input) => {
    const envStatus = envResolver(input);
    if (envStatus.status !== "missing") {
      return envStatus;
    }
    if (
      options.authProfiles.some((profile) =>
        authProfileCanReadProvider(profile, input.provider)
      )
    ) {
      return {
        status: "available",
        required: true,
        message: `Host-local auth profile is available for ${input.provider}.`,
      };
    }

    return envStatus;
  };
}

function automationActorCanReadTrackerProvider(
  actorProvider: string | null,
  trackerProvider: string,
): boolean {
  return (
    !actorProvider ||
    actorProvider.localeCompare(trackerProvider, undefined, {
      sensitivity: "accent",
    }) === 0
  );
}

function authProfileCanReadProvider(
  profile: NexusHostingAuthProfileConfig,
  provider: string,
): boolean {
  if (
    profile.provider.localeCompare(provider, undefined, {
      sensitivity: "accent",
    }) !== 0
  ) {
    return false;
  }
  if (!profile.purposes || profile.purposes.length === 0) {
    return true;
  }

  return profile.purposes.includes("api") || profile.purposes.includes("cli");
}
