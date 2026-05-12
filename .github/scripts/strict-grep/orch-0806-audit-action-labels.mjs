#!/usr/bin/env node
/**
 * ORCH-0806 strict-grep gate — I-PROPOSED-BD AUDIT_LOG_HUMAN_READABLE.
 *
 * Enforces that every audit-log slug emitted by writeAudit() in
 * supabase/functions/** has a corresponding entry in
 * mingla-business/src/utils/auditActionLabels.ts (KNOWN_STATIC_SLUGS).
 *
 * Eight pattern checks (all must pass; any failure exits non-zero):
 *
 *   1. mingla-business/src/utils/auditActionLabels.ts exists.
 *   2. It exports resolveAuditActionLabel and AUDIT_CATEGORIES symbols.
 *   3. Every STATIC slug (string literal as 2nd arg to writeAudit) across
 *      supabase/functions/** appears in KNOWN_STATIC_SLUGS. (Dynamic slug
 *      construction via template literals or string concatenation is
 *      pattern-matched in the resolver and intentionally skipped here.)
 *   4. mingla-business/src/hooks/useAuditLog.ts uses useInfiniteQuery.
 *   5. mingla-business/src/hooks/useAuditLog.ts accepts a categoryFilter
 *      parameter.
 *   6. mingla-business/app/brand/[id]/audit-log.tsx imports
 *      resolveAuditActionLabel.
 *   7. audit-log.tsx no longer renders `<Text ... styles.rowAction>{r.action}`
 *      (the raw-slug primary render that ORCH-0806 replaces).
 *   8. audit-log.tsx iterates FILTER_OPTIONS (filter pill row present).
 *
 * Codified by ORCH-0806 SPEC §10.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const LABELS_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "utils",
  "auditActionLabels.ts",
);
const HOOK_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "hooks",
  "useAuditLog.ts",
);
const SCREEN_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "app",
  "brand",
  "[id]",
  "audit-log.tsx",
);
const FUNCTIONS_DIR = join(REPO_ROOT, "supabase", "functions");

const failures = [];

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx|mjs|js)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

// Check 1 — auditActionLabels.ts exists.
if (!existsSync(LABELS_PATH)) {
  failures.push(
    "Check 1 FAIL: mingla-business/src/utils/auditActionLabels.ts is missing",
  );
}

const labelsSrc = readOrEmpty(LABELS_PATH);

// Check 2 — exports the required symbols.
if (
  labelsSrc &&
  (!/export\s+const\s+resolveAuditActionLabel\b/.test(labelsSrc) ||
    !/export\s+const\s+AUDIT_CATEGORIES\b/.test(labelsSrc))
) {
  failures.push(
    "Check 2 FAIL: auditActionLabels.ts must export both resolveAuditActionLabel and AUDIT_CATEGORIES",
  );
}

// Extract KNOWN_STATIC_SLUGS from the labels file.
const known = new Set();
const knownBlock = labelsSrc.match(
  /KNOWN_STATIC_SLUGS\s*:[^=]*=\s*\[([\s\S]*?)\];/,
);
if (knownBlock !== null) {
  const re = /"([^"]+)"/g;
  let m;
  while ((m = re.exec(knownBlock[1])) !== null) {
    known.add(m[1]);
  }
}

// Check 3 — every static writeAudit slug in supabase/functions/** is in KNOWN_STATIC_SLUGS.
// writeAudit takes an object: writeAudit(supabase, { ..., action: "slug.literal", ... }).
// We scan files that call writeAudit and harvest every `action: "<literal>"` they declare.
// Template-literal or string-concat actions (dynamic slugs) are intentionally NOT counted
// here — they are pattern-matched in the resolver.
const fnFiles = walk(FUNCTIONS_DIR);
const emittedStatic = new Set();
const actionLiteralRe = /\baction\s*:\s*"([a-z0-9_.]+)"/g;
for (const file of fnFiles) {
  const src = readOrEmpty(file);
  if (!/writeAudit\s*\(/.test(src)) continue;
  let m;
  while ((m = actionLiteralRe.exec(src)) !== null) {
    emittedStatic.add(m[1]);
  }
}
const unmapped = [];
for (const slug of emittedStatic) {
  if (!known.has(slug)) unmapped.push(slug);
}
if (unmapped.length > 0) {
  failures.push(
    `Check 3 FAIL: ${unmapped.length} emitted static audit slug(s) missing from KNOWN_STATIC_SLUGS in auditActionLabels.ts:\n  - ${unmapped.join("\n  - ")}\nAdd them to the KNOWN_STATIC_SLUGS list and a matching case in resolveAuditActionLabel.`,
  );
}

// Check 4 — hook uses useInfiniteQuery.
const hookSrc = readOrEmpty(HOOK_PATH);
if (hookSrc && !/useInfiniteQuery/.test(hookSrc)) {
  failures.push(
    "Check 4 FAIL: useAuditLog.ts must use useInfiniteQuery for pagination (ORCH-0806 §6.3)",
  );
}

// Check 5 — hook accepts categoryFilter parameter.
if (hookSrc && !/categoryFilter\s*:\s*AuditCategoryFilter/.test(hookSrc)) {
  failures.push(
    "Check 5 FAIL: useAuditLog.ts must accept a categoryFilter: AuditCategoryFilter parameter (ORCH-0806 §6.3)",
  );
}

// Check 6 — screen imports resolveAuditActionLabel.
const screenSrc = readOrEmpty(SCREEN_PATH);
if (screenSrc && !/resolveAuditActionLabel/.test(screenSrc)) {
  failures.push(
    "Check 6 FAIL: audit-log.tsx must import resolveAuditActionLabel from auditActionLabels (ORCH-0806 §7.2)",
  );
}

// Check 7 — screen no longer renders the raw `r.action` slug via styles.rowAction.
if (screenSrc && /styles\.rowAction\b/.test(screenSrc)) {
  failures.push(
    "Check 7 FAIL: audit-log.tsx still references styles.rowAction — raw-slug render must be removed (ORCH-0806 §7.2)",
  );
}

// Check 8 — screen iterates FILTER_OPTIONS for the filter pill row.
if (screenSrc && !/FILTER_OPTIONS\.map/.test(screenSrc)) {
  failures.push(
    "Check 8 FAIL: audit-log.tsx must render category pills via FILTER_OPTIONS.map(...) (ORCH-0806 §7.1)",
  );
}

if (failures.length > 0) {
  console.error("ORCH-0806 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log(
  `ORCH-0806 strict-grep PASS — 8/8 checks (known=${known.size}, emitted-static=${emittedStatic.size}).`,
);
