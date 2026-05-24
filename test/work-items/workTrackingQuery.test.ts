import { describe, expect, it } from "vitest";
import {
  assertWorkStatus,
  closedWorkStatuses,
  expandWorkStatusQuery,
  isClosedWorkStatus,
  matchesRequiredStrings,
  matchesWorkItemSearch,
  matchesWorkStatusFilter,
  normalizeWorkItemLimit,
  normalizeWorkItemSearch,
  normalizeWorkItemStringArray,
  openWorkStatuses,
  workStatusSetHasClosed,
  workStatusSetHasOpen,
  workStatuses,
} from "../../src/work-items/workTrackingQuery.js";
import type { WorkItem } from "../../src/work-items/workTrackingTypes.js";

function providerError(message: string): Error {
  return new Error(`Provider: ${message}`);
}

const item: WorkItem = {
  id: "tracker-7",
  title: "Ready task",
  description: "Filterable body",
  status: "ready",
  provider: "local",
  labels: ["bug"],
  assignees: ["alice"],
  milestone: null,
  createdAt: null,
  updatedAt: null,
  closedAt: null,
  webUrl: null,
  externalRef: {
    provider: "local",
    itemId: "tracker-7",
    itemKey: "FCD-7",
  },
};

describe("work tracking query helpers", () => {
  it("exposes the neutral work status sets in stable query order", () => {
    expect(openWorkStatuses).toEqual([
      "todo",
      "ready",
      "in_progress",
      "blocked",
    ]);
    expect(closedWorkStatuses).toEqual(["done", "wont_do"]);
    expect(workStatuses).toEqual([
      "todo",
      "ready",
      "in_progress",
      "blocked",
      "done",
      "wont_do",
    ]);
  });

  it("expands open and closed status aliases into concrete work statuses", () => {
    const expanded = expandWorkStatusQuery(["ready", "closed"]);

    expect([...(expanded ?? [])]).toEqual(["ready", "done", "wont_do"]);
    expect(workStatusSetHasOpen(expanded)).toBe(true);
    expect(workStatusSetHasClosed(expanded)).toBe(true);
    expect(matchesWorkStatusFilter(item, expanded)).toBe(true);
    expect(matchesWorkStatusFilter({ ...item, status: "blocked" }, expanded)).toBe(
      false,
    );
  });

  it("validates status values with provider-specific errors", () => {
    expect(() =>
      expandWorkStatusQuery("not_real" as never, {
        invalidStatusMessage: (status) =>
          `Invalid provider work status: ${status}`,
        errorFactory: providerError,
      }),
    ).toThrow(/Provider: Invalid provider work status: not_real/);

    expect(() =>
      assertWorkStatus("todo", { errorFactory: providerError }),
    ).not.toThrow();
  });

  it("normalizes limits, strings, required strings, and search text", () => {
    expect(normalizeWorkItemLimit(undefined)).toBeUndefined();
    expect(normalizeWorkItemLimit(0)).toBe(0);
    expect(() =>
      normalizeWorkItemLimit(1.5, { errorFactory: providerError }),
    ).toThrow(/Provider: limit must be a non-negative integer/);

    expect(
      normalizeWorkItemStringArray([" bug ", "bug", "docs"], "labels", {
        errorFactory: providerError,
      }),
    ).toEqual(["bug", "docs"]);
    expect(() =>
      normalizeWorkItemStringArray([""], "labels", {
        errorFactory: providerError,
      }),
    ).toThrow(/Provider: labels\[0\] must be a non-empty string/);

    expect(matchesRequiredStrings(["bug", "docs"], ["docs"])).toBe(true);
    expect(matchesRequiredStrings(["bug"], ["docs"])).toBe(false);
    expect(normalizeWorkItemSearch("  Body  ")).toBe("body");
  });

  it("matches search across core fields and optional provider fields", () => {
    expect(matchesWorkItemSearch(item, "ready")).toBe(true);
    expect(
      matchesWorkItemSearch(item, "fcd-7", {
        extraValues: (candidate) => [candidate.externalRef?.itemKey ?? ""],
      }),
    ).toBe(true);
    expect(matchesWorkItemSearch(item, "missing")).toBe(false);
    expect(isClosedWorkStatus("done")).toBe(true);
    expect(isClosedWorkStatus("blocked")).toBe(false);
  });
});
