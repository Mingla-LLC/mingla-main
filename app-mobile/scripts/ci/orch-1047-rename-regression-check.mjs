#!/usr/bin/env node
/**
 * ORCH-1047 — implementor happy-path regression check.
 *
 * Verifies the TS authority (`mingla-business/src/utils/brandRole.ts`) reflects
 * the rename to `brand_owner` and that no active source file still ships the
 * old `account_owner` literal. Append-only per ORCH-0840.
 *
 * Run: `node app-mobile/scripts/ci/orch-1047-rename-regression-check.mjs`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../");

const failures = [];
const passes = [];
function check(label, cond, detail = "") {
  if (cond) {
    passes.push(label);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Test 1: TS authority — BRAND_ROLE_RANK.brand_owner === 60
// Read source rather than import (the file uses TS type assertions). A simple
// regex-extract is sufficient because the constant block is fixed-format.
const brandRolePath = path.join(
  repoRoot,
  "mingla-business/src/utils/brandRole.ts",
);
const brandRoleSrc = fs.readFileSync(brandRolePath, "utf8");
const rankMatch = brandRoleSrc.match(
  /export const BRAND_ROLE_RANK\s*=\s*\{([\s\S]*?)\}\s*as const/,
);
check("Test 1 (TS authority readable)", !!rankMatch);
const rankBody = rankMatch ? rankMatch[1] : "";
check(
  "Test 1a (BRAND_ROLE_RANK.brand_owner === 60)",
  /brand_owner\s*:\s*60/.test(rankBody),
);

// ── Test 2: BRAND_ROLE_RANK.account_owner removed (old key gone)
check(
  "Test 2 (BRAND_ROLE_RANK.account_owner removed)",
  !/account_owner\s*:/.test(rankBody),
  "old key still present in constant",
);

// ── Test 3: roleDisplayName('brand_owner') === 'Brand owner'
const displayMatch = brandRoleSrc.match(
  /case\s+"brand_owner":[\s\n]*return\s+"([^"]+)";/,
);
check(
  "Test 3 (roleDisplayName('brand_owner') === 'Brand owner')",
  !!displayMatch && displayMatch[1] === "Brand owner",
  displayMatch ? `got: ${displayMatch[1]}` : "case not found",
);

// ── Test 4: static grep — zero matches for the dead literal in active source.
const SCAN_DIRS = [
  "mingla-business/src",
  "mingla-admin/src",
  "app-mobile/src",
  "supabase/functions",
];
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "__tests__",
]);

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile() && EXTS.has(path.extname(ent.name))) yield full;
  }
}

const stragglers = [];
for (const rel of SCAN_DIRS) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes("account_owner")) continue;
    // honor the inline allow annotation the strict-grep gate also respects
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      if (!line.includes("account_owner")) return;
      if (line.includes("orch-strict-grep-allow account_owner")) return;
      stragglers.push(`${path.relative(repoRoot, file)}:${idx + 1}`);
    });
  }
}
check(
  "Test 4 (no account_owner literal in active TS / edge-fn source)",
  stragglers.length === 0,
  stragglers.length > 0 ? stragglers.slice(0, 5).join(", ") : "",
);

// ── Report
console.log("ORCH-1047 regression check");
console.log(`  PASS: ${passes.length}`);
console.log(`  FAIL: ${failures.length}`);
if (failures.length > 0) {
  console.error("Failures:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("All ORCH-1047 happy-path tests PASS.");
