#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const result = spawnSync(
  "npm",
  ["--prefix", "app-mobile", "run", "test:issue-3988"],
  {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`FAIL issue #3988 regression suites: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("PASS issue #3988 Discover/public-page/session regression suites");
