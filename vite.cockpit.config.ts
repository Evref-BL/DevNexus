import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist/cockpit-client",
    emptyOutDir: true,
    lib: {
      entry: "src/cockpit/client/nexusCockpitClient.ts",
      formats: ["es"],
      fileName: () => "dev-nexus-cockpit.js",
    },
  },
});
