import {
  createNexusProviderHttpClient,
  type NexusProviderHttpClient,
} from "./nexusProviderHttpClient.js";
import type {
  CreateWorkTrackerProviderOptions,
} from "../work-items/workTrackingProviderService.js";

export interface NexusProviderFreshnessOptions {
  httpClient?: NexusProviderHttpClient;
}

export function providerOptionsWithFreshnessCache(
  providerOptions: CreateWorkTrackerProviderOptions | undefined,
  options: NexusProviderFreshnessOptions = {},
): CreateWorkTrackerProviderOptions {
  if (providerOptions?.github?.httpClient) {
    return providerOptions;
  }

  const httpClient = options.httpClient ??
    createNexusProviderHttpClient({
      fetch: providerOptions?.github?.fetch,
      concurrency: providerOptions?.github?.requestConcurrency ?? 1,
    });

  return {
    ...providerOptions,
    github: {
      ...providerOptions?.github,
      httpClient,
    },
  };
}
