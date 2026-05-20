import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

describe("automation imports", () => {
  it("stay acyclic across automation modules", () => {
    expect(findAutomationImportCycles()).toEqual([]);
  });
});

function findAutomationImportCycles(): string[] {
  const graph = automationImportGraph();
  const cycles = new Map<string, string[]>();

  for (const moduleName of graph.keys()) {
    visitModule(moduleName, moduleName, [moduleName], new Set([moduleName]), graph, cycles);
  }

  return [...cycles.values()].map((cycle) => cycle.join(" -> ")).sort();
}

function automationImportGraph(): Map<string, string[]> {
  const modules = automationSourceFiles();
  const moduleBySpecifier = new Map(
    modules.flatMap((fileName) => {
      const moduleName = fileName.replace(/\.ts$/u, "");
      return [
        [`./${moduleName}.js`, fileName],
        [`./${moduleName}`, fileName],
      ];
    }),
  );
  const graph = new Map<string, string[]>();

  for (const fileName of modules) {
    const text = fs.readFileSync(path.join(sourceDir, fileName), "utf8");
    const source = ts.createSourceFile(
      fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const imports: string[] = [];
    source.forEachChild((node) => {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) {
        return;
      }

      const imported = moduleBySpecifier.get(node.moduleSpecifier.text);
      if (imported) {
        imports.push(imported);
      }
    });
    graph.set(fileName, imports);
  }

  return graph;
}

function automationSourceFiles(): string[] {
  return fs
    .readdirSync(sourceDir)
    .filter(
      (fileName) =>
        fileName.startsWith("nexusAutomation") &&
        fileName.endsWith(".ts") &&
        !fileName.endsWith(".test.ts"),
    )
    .sort();
}

function visitModule(
  start: string,
  moduleName: string,
  stack: string[],
  seen: Set<string>,
  graph: Map<string, string[]>,
  cycles: Map<string, string[]>,
): void {
  for (const imported of graph.get(moduleName) ?? []) {
    if (imported === start) {
      const cycle = [...stack, imported];
      cycles.set(canonicalCycleKey(cycle), cycle);
      continue;
    }
    if (seen.has(imported)) {
      continue;
    }

    seen.add(imported);
    visitModule(start, imported, [...stack, imported], seen, graph, cycles);
    seen.delete(imported);
  }
}

function canonicalCycleKey(cycle: readonly string[]): string {
  const nodes = cycle.slice(0, -1);
  const rotations = nodes.map((_, index) =>
    [...nodes.slice(index), ...nodes.slice(0, index)].join(" -> "),
  );
  return rotations.sort()[0]!;
}
