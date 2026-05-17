import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeNexusProjectPath,
  resolveNexusProjectPath,
} from "./index.js";

describe("nexus project path resolver", () => {
  it("resolves sourcesRoot paths from the project parent on each host style", () => {
    expect(
      resolveNexusProjectPath({
        projectRoot: "C:\\Users\\me\\dev-nexus\\dogfood",
        value: "sourcesRoot:dev-nexus",
        platform: "windows",
      }),
    ).toBe(path.win32.join("C:\\Users\\me\\dev-nexus", "sources", "dev-nexus"));

    expect(
      resolveNexusProjectPath({
        projectRoot: "/Users/me/dev-nexus/dogfood",
        value: "sourcesRoot:dev-nexus",
        platform: "macos",
      }),
    ).toBe(path.posix.join("/Users/me/dev-nexus", "sources", "dev-nexus"));
  });

  it("resolves explicit project-root and project-parent portable paths", () => {
    expect(
      resolveNexusProjectPath({
        projectRoot: "/Users/me/dev-nexus/dogfood",
        value: "projectRoot:components/dev-nexus",
        platform: "macos",
      }),
    ).toBe("/Users/me/dev-nexus/dogfood/components/dev-nexus");

    expect(
      resolveNexusProjectPath({
        projectRoot: "C:\\Users\\me\\dev-nexus\\dogfood",
        value: "projectParent:sources/dev-nexus",
        platform: "windows",
      }),
    ).toBe("C:\\Users\\me\\dev-nexus\\sources\\dev-nexus");
  });

  it("keeps relative config paths project-root based", () => {
    expect(
      resolveNexusProjectPath({
        projectRoot: "/Users/me/dev-nexus/dogfood",
        value: "components/dev-nexus",
        platform: "linux",
      }),
    ).toBe("/Users/me/dev-nexus/dogfood/components/dev-nexus");
  });

  it("preserves compatible absolute paths without treating them as portable", () => {
    expect(
      analyzeNexusProjectPath({
        projectRoot: "C:\\Users\\me\\dev-nexus\\dogfood",
        value: "C:\\dev\\code\\DevNexus",
        platform: "windows",
      }),
    ).toMatchObject({
      path: "C:\\dev\\code\\DevNexus",
      compatible: true,
      portable: false,
      base: "absolute",
    });
  });

  it("reports foreign absolute paths as incompatible instead of resolving under the project", () => {
    expect(
      analyzeNexusProjectPath({
        projectRoot: "/Users/me/dev-nexus/dogfood",
        value: "C:\\dev\\code\\DevNexus",
        platform: "macos",
      }),
    ).toMatchObject({
      path: "C:\\dev\\code\\DevNexus",
      compatible: false,
      portable: false,
      base: "absolute",
    });
  });
});
