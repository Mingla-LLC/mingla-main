import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@mingla/blog-document": path.resolve(__dirname, "../packages/blog-document/src/index.ts"),
      // #4523 — the Mingla calendar for plain React DOM. The more specific key first.
      "@mingla/calendar-web/calendar.css": path.resolve(__dirname, "../packages/calendar-web/src/calendar.css"),
      "@mingla/calendar-web": path.resolve(__dirname, "../packages/calendar-web/src/index.ts"),
    },
    // The package sits outside this app's node_modules, so its `react` must resolve to the app's one copy.
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "dist",
  },
  server: {
    fs: {
      // ISSUE-1001 — the admin imports the canonical brand-asset masters from
      // ../packages/brand-assets/. The repo root has no package.json, so Vite's
      // workspace detection stops at mingla-admin/ and the dev server would 403
      // the /@fs/ request for anything above it. Allow the repo root (covers
      // the admin root + packages/). `vite build` (Rollup) has no such
      // restriction — this is dev-server-only.
      allow: [path.resolve(__dirname, "..")],
    },
  },
});
