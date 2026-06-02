
import type {
  NexusDashboardDataError,
  NexusDashboardDataResult,
} from "./nexusDashboardTypes.js";

export function capture<T>(producer: () => T): NexusDashboardDataResult<T> {
  try {
    return { ok: true, value: producer(), error: null };
  } catch (error) {
    return { ok: false, value: null, error: dataError(error) };
  }
}

export async function captureAsync<T>(
  producer: () => Promise<T>,
): Promise<NexusDashboardDataResult<T>> {
  try {
    return { ok: true, value: await producer(), error: null };
  } catch (error) {
    return { ok: false, value: null, error: dataError(error) };
  }
}

function dataError(error: unknown): NexusDashboardDataError {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function uniqueNonEmptyStrings(values: string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

export function latestIsoString(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length
    ? present.sort((left, right) => left.localeCompare(right)).at(-1) ?? null
    : null;
}

export function nodeId(kind: string, id: string): string {
  return `${kind}:${id.replace(/[^A-Za-z0-9_.:-]+/gu, "-")}`;
}

export function edgeId(from: string, to: string, kind: string): string {
  return `${from}->${to}:${kind}`;
}

export function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function nonEmptyString(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} must be non-empty`);
  }
  return trimmed;
}

export function plural(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}

export function compactDetail(value: string): string {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}
