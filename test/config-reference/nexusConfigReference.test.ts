import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  nexusConfigReferenceEntries,
  nexusConfigReferenceParserFieldNames,
  renderNexusConfigReferenceMarkdown,
} from "../../src/index.js";

const parserSourceFiles = [
  "src/project/nexusProjectConfig.ts",
  "src/project/nexusHomeConfig.ts",
  "src/automation/nexusAutomationConfig.ts",
] as const;

function repoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function extractParserFieldNames(): string[] {
  const fields = new Set<string>();
  for (const relativePath of parserSourceFiles) {
    const text = repoFile(relativePath);
    for (const match of text.matchAll(
      /\b[A-Za-z0-9_]+\s*\(\s*(?:record|paths|identity|[A-Za-z0-9_]*Record)\s*,\s*[`'"]([A-Za-z0-9_-]+)[`'"]/gu,
    )) {
      fields.add(match[1]!);
    }
    for (const match of text.matchAll(
      /\b(?:record|paths|identity|[A-Za-z0-9_]*Record)\.([A-Za-z][A-Za-z0-9_]*)/gu,
    )) {
      fields.add(match[1]!);
    }
  }

  return [...fields].sort();
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/gu, "\n");
}

describe("DevNexus config reference", () => {
  it("keeps the checked-in docs generated from the reference renderer", () => {
    expect(normalizeLineEndings(repoFile("docs/user/configuration-reference.md"))).toBe(
      renderNexusConfigReferenceMarkdown("all"),
    );
  });

  it("covers the core discoverability areas from issue 389", () => {
    const paths = nexusConfigReferenceEntries.map((entry) => entry.path);
    expect(paths).toContain("components[]");
    expect(paths).toContain("workTrackers[]");
    expect(paths).toContain("agentTargets[]");
    expect(paths).toContain("plugins[]");
    expect(paths).toContain("hosting");
    expect(paths).toContain("automation.publication");
    expect(paths).toContain("automation.publication.gitIdentity.coAuthors[]");
    expect(paths).toContain("automation.gitWorkflows[]");
    expect(paths).toContain("runnerProfiles[]");
    expect(paths).toContain("authority");
    expect(paths).toContain("authProfiles[]");
    expect(paths).toContain("claimAuthorityProfiles[]");
  });

  it("keeps parser-accepted field names discoverable", () => {
    const parsedFields = extractParserFieldNames();
    const referencedFields = [...nexusConfigReferenceParserFieldNames].sort();

    expect(referencedFields).toEqual(parsedFields);
  });

  it("renders every parser field name in the user-facing reference", () => {
    const rendered = renderNexusConfigReferenceMarkdown("all");
    for (const fieldName of nexusConfigReferenceParserFieldNames) {
      expect(rendered).toContain(`\`${fieldName}\``);
    }
  });
});
