import process from "node:process";
import { describe, expect, it } from "vitest";
import {
  secureRandomHex,
  secureRandomIdSuffix,
  temporaryStoreNonce,
} from "../src/nexusSecureRandom.js";

describe("nexus secure random helpers", () => {
  it("returns hex tokens with stable public shapes", () => {
    expect(secureRandomHex(4)).toMatch(/^[0-9a-f]{8}$/u);
    expect(secureRandomIdSuffix()).toMatch(/^[0-9a-f]{8}$/u);
    expect(temporaryStoreNonce()).toMatch(
      new RegExp(`^${process.pid}-\\d+-[0-9a-f]{16}$`, "u"),
    );
  });
});
