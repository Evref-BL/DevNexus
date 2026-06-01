export class NexusConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusConfigError";
  }
}

export function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

export function requiredString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a non-empty string`,
    );
  }

  return value;
}

export function requiredBoundedString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
  maxLength: number,
): string {
  const value = requiredString(record, key, pathName);
  if (value.length > maxLength) {
    throw new NexusConfigError(
      `${pathName}.${key} must be at most ${maxLength} characters`,
    );
  }

  return value;
}

export function optionalString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a non-empty string`,
    );
  }

  return value;
}

export function requiredProjectRelativePath(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = requiredString(record, key, pathName).trim();
  if (
    value.split(/[\\/]/u).some((part) => part === "..") ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  ) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a project-relative path`,
    );
  }

  return value;
}

export function requiredDependencyProjectionTargetPath(
  record: Record<string, unknown>,
  pathName: string,
  allowsOutsideWorker: boolean,
): string {
  const value = requiredString(record, "target", pathName).trim();
  if (
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith("/") ||
    value.startsWith("\\")
  ) {
    throw new NexusConfigError(
      `${pathName}.target must be a relative path`,
    );
  }
  if (
    !allowsOutsideWorker &&
    value.split(/[\\/]/u).some((part) => part === "..")
  ) {
    throw new NexusConfigError(
      `${pathName}.target must be a project-relative path unless sourceComponentId is declared`,
    );
  }

  return value;
}

export function nullableString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a non-empty string or null`,
    );
  }

  return value;
}

export function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a non-empty string or null`,
    );
  }

  return value;
}

export function optionalInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | null | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new NexusConfigError(`${pathName}.${key} must be an integer or null`);
  }

  return value;
}

export function optionalStringRecord(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): Record<string, string> | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  const valueRecord = assertRecord(value, `${pathName}.${key}`);
  for (const [recordKey, recordValue] of Object.entries(valueRecord)) {
    if (typeof recordValue !== "string") {
      throw new NexusConfigError(
        `${pathName}.${key}.${recordKey} must be a string`,
      );
    }
  }

  return valueRecord as Record<string, string>;
}

export function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new NexusConfigError(`${pathName}.${key} must be a boolean`);
  }

  return value;
}

export function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new NexusConfigError(`${pathName}.${key} must be an array`);
  }
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new NexusConfigError(
        `${pathName}.${key}[${index}] must be a non-empty string`,
      );
    }
  }

  return [...value];
}

export function optionalUniqueStringArray(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string[] | undefined {
  const values = optionalStringArray(record, key, pathName);
  if (!values) {
    return undefined;
  }
  assertUniqueValues(values, `${pathName}.${key}`);

  return values;
}

export function optionalNullablePositiveInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a positive integer or null`,
    );
  }

  return value;
}

export function assertUniqueValues(values: readonly string[], pathName: string): void {
  const uniqueValues = new Set<string>();
  for (const value of values) {
    if (uniqueValues.has(value)) {
      throw new NexusConfigError(`${pathName} contains duplicate value: ${value}`);
    }
    uniqueValues.add(value);
  }
}
