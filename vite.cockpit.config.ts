import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    globalThis: "window",
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    target: "es2022",
    outDir: "dist/cockpit-client",
    emptyOutDir: true,
    lib: {
      entry: "src/cockpit/client/nexusCockpitApp.tsx",
      formats: ["es"],
      fileName: () => "dev-nexus-cockpit.js",
    },
  },
});
