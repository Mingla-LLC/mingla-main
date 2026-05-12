#!/usr/bin/env node
/**
 * ORCH-0809 strict-grep gate #2 — I-PROPOSED-BI DISCOVER_TM_CLASSIFICATION_BY_ID.
 *
 * Enforces that Discover Ticketmaster queries pass real `segmentId` and
 * `genreId` values resolved from the server-owned constants file. The
 * client never ships Ticketmaster classification ID literals (those
 * starting with `KZ`) and the edge function never silently falls back
 * to Music on an unknown segment slug.
 *
 * Seven pattern checks (all must pass):
 *
 *   1. supabase/functions/_shared/ticketmasterClassifications.ts exists.
 *   2. It exports DISCOVER_SEGMENT_ID, DISCOVER_GENRE_ID, and
 *      resolveTmClassification.
 *   3. It does not contain the literal "VERIFY" anywhere (every shipped
 *      slug must have a real TM ID or be removed from the union).
 *   4. supabase/functions/ticketmaster-events/index.ts imports
 *      resolveTmClassification AND DISCOVER_SEGMENT_ID from the shared
 *      classifications file.
 *   5. No file under app-mobile/src or app-mobile/app contains the
 *      literal "KZFzniwn" (Ticketmaster classification ID prefix) —
 *      client ships slugs only.
 *   6. DiscoverScreen.tsx does not contain the literal GENRE_TO_KEYWORDS
 *      (the old keyword-based genre proxy is removed).
 *   7. ORCH-0809 M2.1 post-audit reinforcement: ticketmaster-events/index.ts
 *      contains the literal `"unknown segmentSlug"` rejection — the
 *      edge function must 400 on unknown slugs instead of silently
 *      falling back to Music (Constitution #3 + #9 server-boundary guard).
 *
 * Codified by ORCH-0809 SPEC §9 Gate 2 + re-audit §13 recommendation.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const CLASSIFICATIONS_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "ticketmasterClassifications.ts",
);
const EDGE_FN_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "ticketmaster-events",
  "index.ts",
);
const DISCOVER_PATH = join(
  REPO_ROOT,
  "app-mobile",
  "src",
  "components",
  "DiscoverScreen.tsx",
);
const APP_MOBILE_SRC = join(REPO_ROOT, "app-mobile", "src");
const APP_MOBILE_APP = join(REPO_ROOT, "app-mobile", "app");

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

// Check 1 — classifications file exists.
if (!existsSync(CLASSIFICATIONS_PATH)) {
  failures.push(
    "Check 1 FAIL: supabase/functions/_shared/ticketmasterClassifications.ts is missing.",
  );
}

const classificationsSrc = readOrEmpty(CLASSIFICATIONS_PATH);

// Check 2 — required exports present.
if (
  classificationsSrc &&
  (!/export\s+const\s+DISCOVER_SEGMENT_ID\b/.test(classificationsSrc) ||
    !/export\s+const\s+DISCOVER_GENRE_ID\b/.test(classificationsSrc) ||
    !/export\s+function\s+resolveTmClassification\b/.test(classificationsSrc))
) {
  failures.push(
    "Check 2 FAIL: ticketmasterClassifications.ts must export DISCOVER_SEGMENT_ID, DISCOVER_GENRE_ID, and resolveTmClassification.",
  );
}

// Check 3 — no "VERIFY" literal (SPEC §5.3 mandate). We strip block + line
// comments first so meta-documentation that references the literal in a
// comment (e.g. "gate Check 3 forbids 'VERIFY' literals") doesn't self-trip.
const classificationsCodeOnly = classificationsSrc
  ? classificationsSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  : "";
if (classificationsCodeOnly && /"VERIFY"/.test(classificationsCodeOnly)) {
  failures.push(
    'Check 3 FAIL: ticketmasterClassifications.ts contains a "VERIFY" placeholder string in active code. Every shipped slug must resolve to a real TM ID or be removed from the union (SPEC §5.3).',
  );
}

// Check 4 — edge function imports the shared classifications.
const edgeSrc = readOrEmpty(EDGE_FN_PATH);
if (
  edgeSrc &&
  (!/resolveTmClassification/.test(edgeSrc) ||
    !/DISCOVER_SEGMENT_ID/.test(edgeSrc) ||
    !/from\s+["']\.\.\/_shared\/ticketmasterClassifications\.ts["']/.test(edgeSrc))
) {
  failures.push(
    "Check 4 FAIL: ticketmaster-events/index.ts must import resolveTmClassification AND DISCOVER_SEGMENT_ID from ../_shared/ticketmasterClassifications.ts.",
  );
}

// Check 5 — no KZFzniwn literals in app-mobile/.
const mobileFiles = [...walk(APP_MOBILE_SRC), ...walk(APP_MOBILE_APP)];
const tmIdLeaks = [];
for (const file of mobileFiles) {
  const fileSrc = readOrEmpty(file);
  if (/KZFzniwn/.test(fileSrc)) {
    tmIdLeaks.push(file.replace(REPO_ROOT + "/", ""));
  }
}
if (tmIdLeaks.length > 0) {
  failures.push(
    `Check 5 FAIL: ${tmIdLeaks.length} file(s) under app-mobile/ contain the literal "KZFzniwn" (Ticketmaster classification ID prefix). Client must never ship TM IDs (Constitution #2 — one owner per truth):\n  - ${tmIdLeaks.join("\n  - ")}`,
  );
}

// Check 6 — DiscoverScreen.tsx no longer references GENRE_TO_KEYWORDS.
const discoverSrc = readOrEmpty(DISCOVER_PATH);
// Strip comments so the historical-removal mention doesn't trip the gate.
function stripComments(s) {
  let out = s.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/\/\/[^\n]*/g, "");
  return out;
}
const discoverCodeOnly = discoverSrc ? stripComments(discoverSrc) : "";
if (discoverCodeOnly && /\bGENRE_TO_KEYWORDS\b/.test(discoverCodeOnly)) {
  failures.push(
    "Check 6 FAIL: DiscoverScreen.tsx still references GENRE_TO_KEYWORDS (the old keyword-based genre proxy). Genre filtering must flow through server-owned `genreId` resolution (SPEC §5.7).",
  );
}

// Check 7 — edge function 400s on unknown segmentSlug (M2.1 reinforcement).
// The actual literal in the edge function uses a template-literal with a
// substitution: `unknown segmentSlug: ${segmentSlug}`. We match the
// quote-agnostic phrase "unknown segmentSlug" across quote styles, but
// strip comments first so meta-documentation doesn't trip the check.
const edgeCodeOnlyForCheck7 = edgeSrc
  ? edgeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
  : "";
if (edgeCodeOnlyForCheck7 && !/unknown segmentSlug/.test(edgeCodeOnlyForCheck7)) {
  failures.push(
    "Check 7 FAIL: ticketmaster-events/index.ts must reject unknown segment slugs with HTTP 400 containing the phrase `unknown segmentSlug` in the response body. This is the M2.1 server-boundary guard restoring Constitution #3 + #9 (re-audit §13).",
  );
}

if (failures.length > 0) {
  console.error("ORCH-0809 Gate 2 (tm-classification-by-id) FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0809 Gate 2 (tm-classification-by-id) PASS — 7/7 checks.");
