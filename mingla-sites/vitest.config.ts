import { defineConfig } from "vitest/config";

// #4523 — @mingla/calendar-web is a linked workspace package that ships TypeScript
// source. Keep its link path (so its own `react` import resolves to this app's
// copy) and transform it instead of treating it as a prebuilt dependency.
export default defineConfig({
  resolve: { preserveSymlinks: true },
  test: { server: { deps: { inline: ["@mingla/calendar-web"] } } },
});
