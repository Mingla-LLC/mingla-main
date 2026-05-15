#!/usr/bin/env node
// META-ORCH-0827 Pass 2 — package isolation gate.
//
// Code inside packages/*/ MUST NOT import from any consuming app's src/
// or app/ directory. This preserves I-MOR-0827-PACKAGE-ISOLATION:
// shared rendering components are pure-presentational with no
// back-references to the apps that consume them.
//
// Allowed package imports:
//   - React, React Native, Expo, third-party libs
//   - Same-package files (./)
//   - Other @mingla/* packages
//
// Forbidden:
//   - Anything from app-mobile/src/, app-mobile/app/
//   - Anything from mingla-business/src/, mingla-business/app/
//   - Anything from mingla-admin/src/

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packagesRoot = path.join(root, "packages");

if (!fs.existsSync(packagesRoot)) {
  console.log("packages/ directory does not exist — nothing to check.");
  process.exit(0);
}

const failures = [];

const forbiddenPatterns = [
  /from\s+["'][^"']*app-mobile\/(?:src|app)\//,
  /from\s+["'][^"']*mingla-business\/(?:src|app)\//,
  /from\s+["'][^"']*mingla-admin\/src\//,
  /from\s+["']\.\.\/\.\.\/(?:app-mobile|mingla-business|mingla-admin)\//,
  /require\(\s*["'][^"']*(?:app-mobile|mingla-business|mingla-admin)\/(?:src|app)\//,
];

const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    if (entry.name === "__tests__") continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) continue;
    const relativePath = path.relative(root, absolutePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(source)) {
        failures.push(
          `${relativePath} import-scan: package imports from app source. ` +
            `Violates I-MOR-0827-PACKAGE-ISOLATION. Shared rendering ` +
            `packages must be pure-presentational; pass app-specific data ` +
            `as props instead.`,
        );
        break;
      }
    }
  }
};

walk(packagesRoot);

if (failures.length > 0) {
  console.error("\nMETA-ORCH-0827 package isolation gate FAILED:\n");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error("");
  process.exit(1);
}

console.log("META-ORCH-0827 package isolation gate PASS.");
