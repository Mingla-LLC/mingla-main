/**
 * #2099 §D6 — Playwright global setup: build the harness bundle before any spec
 * runs, and fail the whole run if the bundle does not contain the REAL dialog.
 * `bundle.mjs` exits non-zero on that, so a vacuous harness can never reach the
 * assertions.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export default function globalSetup() {
  const here = dirname(fileURLToPath(import.meta.url));
  const result = spawnSync(process.execPath, [join(here, "bundle.mjs")], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("issue-2099: the §D6 browser harness failed to bundle");
  }
}
