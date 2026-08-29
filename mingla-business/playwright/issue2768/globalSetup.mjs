import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default function globalSetup() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const result = spawnSync(process.execPath, [path.join(here, "bundle.mjs")], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`issue #2768 browser bundle failed (${result.status})`);
  }
}
