#!/usr/bin/env node
//
// #2306 — native modules added after a shipped binary must be reached LAZILY.
//
// A missing native module throws at MODULE EVAL, not at call time. So a bare
// static import of a package that postdates a shipped binary does not degrade
// on that binary — it breaks whatever screen pulls the module in. That is the
// netinfo brick (COMMS-0138) and the 2026-07-02 stuck-on-splash, and it is what
// kept #2107's update gate from being deliverable by OTA to the installs that
// most needed it.
//
// Each guarded package therefore has exactly ONE owner module, which requires it
// inside a try. This gate fails the build if a second reach appears.
//
//   --self-test  proves the check catches a re-introduced bare import.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const GUARDED = [
  {
    pkg: "expo-secure-store",
    owner: "app-mobile/src/lib/secureStoreSafe.ts",
    roots: ["app-mobile/src", "app-mobile/app"],
  },
  {
    pkg: "react-native-get-random-values",
    owner: "mingla-business/src/lib/secureRandomSafe.ts",
    roots: ["mingla-business/src", "mingla-business/app"],
  },
  {
    // #1758's original guard, folded in so all three share one contract.
    pkg: "@react-native-community/netinfo",
    owner: "mingla-business/src/lib/netinfoSafe.ts",
    roots: ["mingla-business/src", "mingla-business/app"],
  },
];

function walk(relativeDir) {
  const absolute = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absolute)) return [];
  const out = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const child = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) out.push(...walk(child));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(child);
  }
  return out;
}

export function validate(readFile, { extraReach = null } = {}) {
  const failures = [];
  for (const { pkg, owner, roots } of GUARDED) {
    const ownerSource = readFile(owner);
    if (ownerSource === null) {
      failures.push(`${owner} is missing — ${pkg} has no sole owner`);
      continue;
    }
    if (!new RegExp(`require\\(\\s*["']${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(ownerSource)) {
      failures.push(`${owner} must reach ${pkg} through a dynamic require()`);
    }
    if (!/try\s*\{/.test(ownerSource) || !/catch/.test(ownerSource)) {
      failures.push(`${owner} must wrap the require in try/catch so a missing native module cannot throw at eval`);
    }
    if (new RegExp(`^import[^\\n]*["']${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "m").test(ownerSource)) {
      failures.push(`${owner} must not ALSO static-import ${pkg}`);
    }
    const files = roots.flatMap(walk);
    for (const file of files) {
      if (file === owner) continue;
      const source = readFile(file);
      if (source === null) continue;
      if (new RegExp(`["']${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(source)) {
        failures.push(`${file} reaches ${pkg} directly — route it through ${owner}`);
      }
    }
    if (extraReach !== null && extraReach.pkg === pkg) {
      if (new RegExp(`["']${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(extraReach.source)) {
        failures.push(`${extraReach.file} reaches ${pkg} directly — route it through ${owner}`);
      }
    }
  }
  return failures;
}

const readFile = (relative) => {
  const absolute = path.join(ROOT, relative);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
};

function selfTest() {
  const clean = validate(readFile);
  if (clean.length > 0) {
    console.error("#2306 self-test: the clean tree unexpectedly failed:");
    for (const f of clean) console.error(`  - ${f}`);
    process.exit(1);
  }
  const reintroduced = validate(readFile, {
    extraReach: {
      pkg: "expo-secure-store",
      file: "app-mobile/src/services/someNewScreen.ts",
      source: 'import * as SecureStore from "expo-secure-store";\n',
    },
  });
  if (reintroduced.length === 0) {
    console.error("#2306 self-test: a re-introduced bare import was NOT caught — this gate proves nothing");
    process.exit(1);
  }
  const ownerless = validate((rel) =>
    rel === "app-mobile/src/lib/secureStoreSafe.ts" ? null : readFile(rel));
  if (ownerless.length === 0) {
    console.error("#2306 self-test: a deleted owner module was NOT caught");
    process.exit(1);
  }
  console.log("#2306 self-test passed (clean green; re-introduced import and deleted owner both caught).");
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const failures = validate(readFile);
  if (failures.length > 0) {
    console.error("#2306 lazy-native-import gate FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("\nA native module added after a shipped binary must be required lazily inside a try,");
    console.error("through its sole owner — otherwise an OTA to that binary breaks on module eval.");
    process.exit(1);
  }
  console.log("#2306 lazy-native-import gate: every guarded package has one lazy owner.");
}

main();
