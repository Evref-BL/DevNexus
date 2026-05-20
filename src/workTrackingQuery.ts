import type { WorkItem, WorkStatus, WorkStatusQuery } from "./workTrackingTypes.js";

export const openWorkStatuses: readonly WorkStatus[] = [
  "todo",
  "ready",
  "in_progress",
  "blocked",
];
export const closedWorkStatuses: readonly WorkStatus[] = ["done", "wont_do"];
export const workStatuses: readonly WorkStatus[] = [
  ...openWorkStatuses,
  ...closedWorkStatuses,
];

const openWorkStatusSet = new Set<WorkStatus>(openWorkStatuses);
const closedWorkStatusSet = new Set<WorkStatus>(closedWorkStatuses);
const workStatusSet = new Set<WorkStatus>(workStatuses);

export interface WorkTrackingQueryErrorOptions {
  errorFactory?: (message: string) => Error;
}

export interface WorkStatusValidationOptions extends WorkTrackingQueryErrorOptions {
  invalidStatusMessage?: (status: string) => string;
}

export interface WorkItemSearchOptions {
  extraValues?: (item: WorkItem) => Array<string | null | undefined>;
}

export function isWorkStatus(value: unknown): value is WorkStatus {
  return typeof value === "string" && workStatusSet.has(value as WorkStatus);
}

export function isOpenWorkStatus(status: WorkStatus): boolean {
  return openWorkStatusSet.has(status);
}

export function isClosedWorkStatus(status: WorkStatus): boolean {
  return closedWorkStatusSet.has(status);
}

export function assertWorkStatus(
  status: string,
  options: WorkStatusValidationOptions = {},
): asserts status is WorkStatus {
  if (!isWorkStatus(status)) {
    throw queryError(
      options.invalidStatusMessage?.(status) ??
        `Invalid work status: ${status}; expected ${workStatuses.join(", ")}`,
      options,
    );
  }
}

export function expandWorkStatusQuery(
  status: WorkStatusQuery | WorkStatusQuery[] | undefined,
  options: WorkStatusValidationOptions = {},
): Set<WorkStatus> | undefined {
  if (status === undefined) {
    return undefined;
  }

  const values = Array.isArray(status) ? status : [status];
  const normalized = new Set<WorkStatus>();
  for (const value of values) {
    if (value === "open") {
      addStatuses(normalized, openWorkStatuses);
      continue;
    }
    if (value === "closed") {
      addStatuses(normalized, closedWorkStatuses);
      continue;
    }

    const candidate = String(value);
    assertWorkStatus(candidate, options);
    normalized.add(candidate);
  }

  return normalized;
}

export function workStatusSetHasOpen(
  statuses: ReadonlySet<WorkStatus> | undefined,
): boolean {
  return Boolean(statuses && openWorkStatuses.some((status) => statuses.has(status)));
}

export function workStatusSetHasClosed(
  statuses: ReadonlySet<WorkStatus> | undefined,
): boolean {
  return Boolean(
    statuses && closedWorkStatuses.some((status) => statuses.has(status)),
  );
}

export function matchesWorkStatusFilter(
  item: Pick<WorkItem, "status">,
  statuses: ReadonlySet<WorkStatus> | undefined,
): boolean {
  return !statuses || statuses.size === 0 || statuses.has(item.status);
}

export function normalizeWorkItemLimit(
  limit: number | undefined,
  options: WorkTrackingQueryErrorOptions = {},
): number | undefined {
  if (limit === undefined) {
    return undefined;
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw queryError("limit must be a non-negative integer", options);
  }

  return limit;
}

export function normalizeWorkItemStringArray(
  values: unknown,
  pathName: string,
  options: WorkTrackingQueryErrorOptions = {},
): string[] {
  if (values === undefined) {
    return [];
  }
  if (!Array.isArray(values)) {
    throw queryError(`${pathName} must be an array`, options);
  }

  return dedupeStrings(
    values.map((value, index) =>
      requiredNonEmptyWorkItemString(value, `${pathName}[${index}]`, options),
    ),
  );
}

export function requiredNonEmptyWorkItemString(
  value: unknown,
  pathName: string,
  options: WorkTrackingQueryErrorOptions = {},
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw queryError(`${pathName} must be a non-empty string`, options);
  }

  return value.trim();
}

export function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

export function matchesRequiredStrings(
  itemValues: readonly string[] | undefined,
  requiredValues: readonly string[],
): boolean {
  return requiredValues.every((value) => itemValues?.includes(value));
}

export function normalizeWorkItemSearch(
  search: string | undefined,
): string | undefined {
  const normalized = search?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function matchesWorkItemSearch(
  item: WorkItem,
  search: string | undefined,
  options: WorkItemSearchOptions = {},
): boolean {
  const normalized = normalizeWorkItemSearch(search);
  if (!normalized) {
    return true;
  }

  const values = [
    item.id,
    item.title,
    item.description ?? "",
    ...(options.extraValues?.(item) ?? []),
  ];
  return values.some((value) => value?.toLowerCase().includes(normalized));
}

function addStatuses(
  target: Set<WorkStatus>,
  statuses: readonly WorkStatus[],
): void {
  for (const status of statuses) {
    target.add(status);
  }
}

function queryError(
  message: string,
  options: WorkTrackingQueryErrorOptions,
): Error {
  return options.errorFactory?.(message) ?? new Error(message);
}
