import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface ImportEdge {
  from: string;
  to: string;
}

interface UnresolvedImport {
  from: string;
  specifier: string;
}

describe("source import graph", () => {
  it("keeps relative source imports resolved and acyclic", () => {
    const projectRoot = process.cwd();
    const sourceRoot = path.join(projectRoot, "src");
    const files = listSourceFiles(sourceRoot);
    const fileSet = new Set(files.map(normalizePath));
    const edges: ImportEdge[] = [];
    const unresolved: UnresolvedImport[] = [];

    for (const file of files) {
      const specifiers = relativeModuleSpecifiers(file);
      for (const specifier of specifiers) {
        const resolved = resolveRelativeSourceImport(file, specifier, fileSet);
        if (!resolved) {
          unresolved.push({
            from: path.relative(projectRoot, file),
            specifier,
          });
          continue;
        }
        edges.push({
          from: normalizePath(file),
          to: resolved,
        });
      }
    }

    expect(unresolved).toEqual([]);
    expect(findCycles(files.map(normalizePath), edges)).toEqual([]);
  });
});

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(entryPath));
      continue;
    }
    if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(entryPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function relativeModuleSpecifiers(filePath: string): string[] {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    const moduleSpecifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : null;
    if (moduleSpecifier?.startsWith(".")) {
      specifiers.push(moduleSpecifier);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text.startsWith(".")
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function resolveRelativeSourceImport(
  importerPath: string,
  specifier: string,
  fileSet: Set<string>,
): string | null {
  const basePath = path.resolve(path.dirname(importerPath), specifier);
  const extension = path.extname(basePath);
  const candidates = extension
    ? sourceExtensionsForImport(extension).map((sourceExtension) =>
        replaceExtension(basePath, sourceExtension),
      )
    : [
        `${basePath}.ts`,
        `${basePath}.tsx`,
        path.join(basePath, "index.ts"),
        path.join(basePath, "index.tsx"),
      ];

  for (const candidate of candidates.map(normalizePath)) {
    if (fileSet.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function sourceExtensionsForImport(extension: string): string[] {
  if (extension === ".js" || extension === ".jsx") {
    return [".ts", ".tsx"];
  }
  if (extension === ".mjs" || extension === ".cjs") {
    return [".mts", ".cts"];
  }

  return [extension];
}

function replaceExtension(filePath: string, extension: string): string {
  return path.join(
    path.dirname(filePath),
    `${path.basename(filePath, path.extname(filePath))}${extension}`,
  );
}

function findCycles(files: string[], edges: ImportEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const file of files) {
    adjacency.set(file, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }
  for (const destinations of adjacency.values()) {
    destinations.sort((left, right) => left.localeCompare(right));
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycleKeys = new Set<string>();
  const cycles: string[][] = [];

  function visit(file: string): void {
    if (visited.has(file)) {
      return;
    }
    if (visiting.has(file)) {
      recordCycle(file);
      return;
    }

    visiting.add(file);
    stack.push(file);
    for (const dependency of adjacency.get(file) ?? []) {
      visit(dependency);
    }
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  }

  function recordCycle(start: string): void {
    const startIndex = stack.indexOf(start);
    if (startIndex < 0) {
      return;
    }
    const cycle = [...stack.slice(startIndex), start];
    const key = canonicalCycleKey(cycle);
    if (cycleKeys.has(key)) {
      return;
    }
    cycleKeys.add(key);
    cycles.push(cycle.map((file) => path.relative(process.cwd(), file)));
  }

  for (const file of files) {
    visit(file);
  }

  return cycles.sort((left, right) => left.join(">").localeCompare(right.join(">")));
}

function canonicalCycleKey(cycle: string[]): string {
  const body = cycle.slice(0, -1);
  const rotations = body.map((_, index) => [
    ...body.slice(index),
    ...body.slice(0, index),
  ].join(">"));
  return rotations.sort()[0] ?? cycle.join(">");
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}
