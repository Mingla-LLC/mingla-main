// ORCH-1199 — Playwright global setup: metro-bundle the SheetWeb harness before
// the real-Chromium measurement runs, so `npx playwright test -c
// playwright.orch1199.config.ts` is one self-contained command (no manual build).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default function globalSetup() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const res = spawnSync(process.execPath, [path.join(here, "bundle.mjs")], {
    stdio: "inherit",
  });
  if (res.status !== 0) {
    throw new Error(`ORCH-1199 bundle.mjs failed (exit ${res.status})`);
  }
}
