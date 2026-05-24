import { describe, expect, it } from "vitest";
import cockpitViteConfig from "../../vite.cockpit.config.js";

describe("cockpit Vite config", () => {
  it("inlines browser-safe production environment checks", () => {
    expect(typeof cockpitViteConfig).toBe("object");
    expect(cockpitViteConfig).toMatchObject({
      define: {
        globalThis: "window",
        "process.env.NODE_ENV": "\"production\"",
      },
    });
  });
});
