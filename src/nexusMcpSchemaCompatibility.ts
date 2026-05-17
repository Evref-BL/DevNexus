export interface McpInputSchemaProviderIssue {
  kind:
    | "union_type"
    | "composition"
    | "null_enum"
    | "implicit_open_object";
  path: string;
  summary: string;
}

export function providerCompatibleMcpTools<
  T extends { inputSchema: Record<string, unknown> },
>(tools: readonly T[]): T[] {
  return tools.map((tool) => ({
    ...tool,
    inputSchema: providerCompatibleMcpSchema(tool.inputSchema),
  }));
}

export function providerCompatibleMcpSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return normalizeSchemaValue(schema) as Record<string, unknown>;
}

export function listMcpInputSchemaProviderIssues(
  schema: unknown,
  pathName = "$",
): McpInputSchemaProviderIssue[] {
  const issues: McpInputSchemaProviderIssue[] = [];
  collectMcpInputSchemaProviderIssues(schema, pathName, issues);
  return issues;
}

function normalizeSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSchemaValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  const firstComposition = firstCompositionAlternative(source);
  if (firstComposition) {
    Object.assign(normalized, normalizeSchemaValue(firstComposition));
  }

  for (const [key, child] of Object.entries(source)) {
    if (key === "oneOf" || key === "anyOf" || key === "allOf" || key === "not") {
      continue;
    }
    if (key === "type" && Array.isArray(child)) {
      normalized.type =
        child.find((candidate) => candidate !== "null") ?? "string";
      continue;
    }
    if (key === "enum" && Array.isArray(child)) {
      normalized.enum = child.filter((candidate) => candidate !== null);
      continue;
    }

    normalized[key] = normalizeSchemaValue(child);
  }

  if (
    normalized.type === "object" &&
    normalized.properties === undefined &&
    normalized.additionalProperties === undefined
  ) {
    normalized.additionalProperties = true;
  }

  return normalized;
}

function firstCompositionAlternative(
  schema: Record<string, unknown>,
): Record<string, unknown> | null {
  for (const key of ["oneOf", "anyOf", "allOf"]) {
    const alternatives = schema[key];
    if (!Array.isArray(alternatives)) {
      continue;
    }
    const first = alternatives.find(
      (candidate) =>
        !!candidate && typeof candidate === "object" && !Array.isArray(candidate),
    );
    if (first) {
      return first as Record<string, unknown>;
    }
  }

  return null;
}

function collectMcpInputSchemaProviderIssues(
  value: unknown,
  pathName: string,
  issues: McpInputSchemaProviderIssue[],
): void {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectMcpInputSchemaProviderIssues(item, `${pathName}[${index}]`, issues),
    );
    return;
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.type)) {
    issues.push({
      kind: "union_type",
      path: `${pathName}.type`,
      summary: "Use a single JSON Schema type in MCP tool schemas.",
    });
  }
  for (const key of ["oneOf", "anyOf", "allOf", "not"]) {
    if (record[key] !== undefined) {
      issues.push({
        kind: "composition",
        path: `${pathName}.${key}`,
        summary: "Avoid schema composition in provider-facing MCP tool schemas.",
      });
    }
  }
  if (Array.isArray(record.enum) && record.enum.includes(null)) {
    issues.push({
      kind: "null_enum",
      path: `${pathName}.enum`,
      summary: "Do not include null in provider-facing MCP tool schema enums.",
    });
  }
  if (
    record.type === "object" &&
    record.properties === undefined &&
    record.additionalProperties === undefined
  ) {
    issues.push({
      kind: "implicit_open_object",
      path: pathName,
      summary:
        "Object schemas should declare properties or additionalProperties explicitly.",
    });
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === "description") {
      continue;
    }
    collectMcpInputSchemaProviderIssues(child, `${pathName}.${key}`, issues);
  }
}
