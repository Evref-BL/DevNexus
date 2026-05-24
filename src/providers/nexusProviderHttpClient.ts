export type NexusProviderHttpMethod =
  | "GET"
  | "POST"
  | "PATCH"
  | "PUT"
  | "DELETE";

export interface NexusProviderRateLimit {
  limited: boolean;
  retryAfterSeconds?: number;
  remaining?: number;
  resetAt?: string;
  resource?: string;
}

export interface NexusProviderHttpCacheEntry {
  cacheKey: string;
  url: string;
  etag?: string;
  lastModified?: string;
  status: number;
  bodyText: string;
  headers: Record<string, string>;
  storedAt: string;
}

export interface NexusProviderHttpCache {
  get(cacheKey: string): NexusProviderHttpCacheEntry | undefined;
  set(cacheKey: string, entry: NexusProviderHttpCacheEntry): void;
}

export interface NexusProviderHttpClientOptions {
  fetch?: typeof fetch;
  cache?: NexusProviderHttpCache;
  concurrency?: number;
  now?: () => Date;
}

export interface NexusProviderHttpRequestOptions {
  method: NexusProviderHttpMethod;
  url: string | URL;
  headers?: Record<string, string>;
  body?: string;
  cacheKey?: string;
  conditional?: boolean;
}

export interface NexusProviderHttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  bodyText: string;
  fromCache: boolean;
  notModified: boolean;
  cacheKey?: string;
  rateLimit?: NexusProviderRateLimit;
}

export interface NexusProviderHttpJsonResponse<T>
  extends NexusProviderHttpResponse {
  body: T;
}

export interface NexusProviderHttpClient {
  request(
    options: NexusProviderHttpRequestOptions,
  ): Promise<NexusProviderHttpResponse>;
  requestJson<T>(
    options: NexusProviderHttpRequestOptions,
  ): Promise<NexusProviderHttpJsonResponse<T>>;
}

export function createNexusProviderHttpClient(
  options: NexusProviderHttpClientOptions = {},
): NexusProviderHttpClient {
  return new DefaultNexusProviderHttpClient(options);
}

class MemoryNexusProviderHttpCache implements NexusProviderHttpCache {
  private readonly entries = new Map<string, NexusProviderHttpCacheEntry>();

  get(cacheKey: string): NexusProviderHttpCacheEntry | undefined {
    return this.entries.get(cacheKey);
  }

  set(cacheKey: string, entry: NexusProviderHttpCacheEntry): void {
    this.entries.set(cacheKey, entry);
  }
}

class DefaultNexusProviderHttpClient implements NexusProviderHttpClient {
  private readonly fetchFn: typeof fetch;
  private readonly cache: NexusProviderHttpCache;
  private readonly concurrency: number;
  private readonly now: () => Date;
  private activeRequests = 0;
  private readonly queue: Array<() => void> = [];

  constructor(options: NexusProviderHttpClientOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.cache = options.cache ?? new MemoryNexusProviderHttpCache();
    this.concurrency = normalizeConcurrency(options.concurrency);
    this.now = options.now ?? (() => new Date());
  }

  async request(
    options: NexusProviderHttpRequestOptions,
  ): Promise<NexusProviderHttpResponse> {
    return this.withRequestSlot(() => this.requestNow(options));
  }

  async requestJson<T>(
    options: NexusProviderHttpRequestOptions,
  ): Promise<NexusProviderHttpJsonResponse<T>> {
    const response = await this.request(options);
    const body = parseJsonBody<T>(response.bodyText);
    return { ...response, body };
  }

  private async requestNow(
    options: NexusProviderHttpRequestOptions,
  ): Promise<NexusProviderHttpResponse> {
    const url = new URL(String(options.url));
    const method = options.method;
    const headers = { ...(options.headers ?? {}) };
    const cacheKey = cacheKeyForRequest(options, url);
    const cached = cacheKey ? this.cache.get(cacheKey) : undefined;
    if (shouldUseConditionalRequest(options, cached)) {
      if (cached?.etag && !hasHeader(headers, "if-none-match")) {
        headers["If-None-Match"] = cached.etag;
      }
      if (cached?.lastModified && !hasHeader(headers, "if-modified-since")) {
        headers["If-Modified-Since"] = cached.lastModified;
      }
    }

    const response = await this.fetchFn(url, {
      method,
      headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
    });
    const responseHeaders = headersRecord(response.headers);
    const rateLimit = providerRateLimit(response.status, response.headers);

    if (response.status === 304 && cached) {
      return {
        ok: true,
        status: 304,
        statusText: response.statusText || "Not Modified",
        url: url.toString(),
        headers: { ...cached.headers, ...responseHeaders },
        bodyText: cached.bodyText,
        fromCache: true,
        notModified: true,
        ...(cacheKey ? { cacheKey } : {}),
        ...(rateLimit ? { rateLimit } : {}),
      };
    }

    const bodyText = await response.text();
    const result: NexusProviderHttpResponse = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: url.toString(),
      headers: responseHeaders,
      bodyText,
      fromCache: false,
      notModified: false,
      ...(cacheKey ? { cacheKey } : {}),
      ...(rateLimit ? { rateLimit } : {}),
    };
    if (response.ok && cacheKey && shouldCacheResponse(options, response)) {
      this.cache.set(cacheKey, {
        cacheKey,
        url: url.toString(),
        ...(response.headers.get("etag")
          ? { etag: response.headers.get("etag")! }
          : {}),
        ...(response.headers.get("last-modified")
          ? { lastModified: response.headers.get("last-modified")! }
          : {}),
        status: response.status,
        bodyText,
        headers: responseHeaders,
        storedAt: this.now().toISOString(),
      });
    }

    return result;
  }

  private async withRequestSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeRequests >= this.concurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.activeRequests += 1;
    try {
      return await operation();
    } finally {
      this.activeRequests -= 1;
      this.queue.shift()?.();
    }
  }
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Provider HTTP concurrency must be a positive integer");
  }
  return value;
}

function cacheKeyForRequest(
  options: NexusProviderHttpRequestOptions,
  url: URL,
): string | undefined {
  if (options.method !== "GET") {
    return undefined;
  }
  return options.cacheKey ?? `${options.method} ${url.toString()}`;
}

function shouldUseConditionalRequest(
  options: NexusProviderHttpRequestOptions,
  cached: NexusProviderHttpCacheEntry | undefined,
): boolean {
  return options.method === "GET" &&
    options.conditional !== false &&
    Boolean(cached?.etag || cached?.lastModified);
}

function shouldCacheResponse(
  options: NexusProviderHttpRequestOptions,
  response: Response,
): boolean {
  return options.method === "GET" &&
    Boolean(response.headers.get("etag") || response.headers.get("last-modified"));
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}

function headersRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function parseJsonBody<T>(bodyText: string): T {
  if (!bodyText) {
    return null as T;
  }
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    return bodyText as T;
  }
}

function providerRateLimit(
  status: number,
  headers: Headers,
): NexusProviderRateLimit | undefined {
  const retryAfterSeconds = optionalPositiveNumber(headers.get("retry-after"));
  const remaining = optionalNonNegativeNumber(headers.get("x-ratelimit-remaining"));
  const resetAt = resetAtTimestamp(headers.get("x-ratelimit-reset"));
  const resource = nonEmpty(headers.get("x-ratelimit-resource"));
  const limited =
    status === 429 ||
    retryAfterSeconds !== undefined ||
    remaining === 0;
  if (!limited && remaining === undefined && resetAt === undefined && !resource) {
    return undefined;
  }

  return {
    limited,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(resetAt ? { resetAt } : {}),
    ...(resource ? { resource } : {}),
  };
}

function optionalPositiveNumber(value: string | null): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function optionalNonNegativeNumber(value: string | null): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function resetAtTimestamp(value: string | null): string | undefined {
  const epochSeconds = optionalNonNegativeNumber(value);
  return epochSeconds === undefined
    ? undefined
    : new Date(epochSeconds * 1000).toISOString();
}

function nonEmpty(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
