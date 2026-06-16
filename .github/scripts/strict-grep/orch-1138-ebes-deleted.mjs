#!/usr/bin/env node
/**
 * ORCH-1138 Leg 3 [public experience page redesign] — EBES FINAL DELETION —
 * strict-grep gate.
 *
 * Enforces I-PROPOSED-1138-EBES-DELETED (SPEC §6 / §9 #1):
 *
 *   ExpandedBusinessEventSheet (EBES) is DECOMMISSIONED. After Leg 3 repointed
 *   the deck experience + venue "experiences here" + chat events/trips off it,
 *   the file is DELETED and NOTHING in non-test, non-comment source imports or
 *   mounts it. The deck/venue/chat consumers render the foundation detail
 *   screens (ConsumerEventDetailScreen / ConsumerTripDetailScreen /
 *   ConsumerExperienceDetailScreen). Re-introducing EBES regresses the redesign.
 *
 * Asserts (comments stripped so historical EBES references in doc comments never
 * false-positive — only LIVE code references fail):
 *
 *   A. The EBES file itself (app-mobile/src/components/expandedCard/
 *      ExpandedBusinessEventSheet.tsx) does NOT exist.
 *   B. NO non-test source file under app-mobile/src imports
 *      `ExpandedBusinessEventSheet` or mounts `<ExpandedBusinessEventSheet`.
 *
 * Self-test: ORCH1138_SIMULATE_REVERT=1 makes the gate treat a sentinel as a
 * live EBES import → the gate MUST FAIL (fails-on-revert proof, SPEC §9 #1).
 *
 * Exit codes: 0 — clean · 1 — violation.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const EBES_FILE =
  "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx";
const SRC_DIR = join(ROOT, "app-mobile", "src");
const simulateRevert = process.env.ORCH1138_SIMULATE_REVERT === "1";

const stripComments = (src) =>
  src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const violations = [];

// ── A. the EBES file must be deleted ──
if (existsSync(join(ROOT, EBES_FILE))) {
  violations.push(
    `${EBES_FILE} still exists — EBES must be DELETED (ORCH-1138 Leg 3).`,
  );
}

// ── B. no live import / mount of EBES anywhere in non-test app-mobile source ──
const isTest = (p) =>
  p.includes("/__tests__/") || /\.test\.[a-z]+$/.test(p) || /\.test\./.test(p);

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(path);
  }
  return out;
};

const IMPORT_RE =
  /import[\s\S]*?ExpandedBusinessEventSheet[\s\S]*?from\s+['"][^'"]*ExpandedBusinessEventSheet['"]/;
const MOUNT_RE = /<ExpandedBusinessEventSheet\b/;

for (const file of walk(SRC_DIR)) {
  if (isTest(file)) continue;
  let raw = readFileSync(file, "utf8");
  if (simulateRevert) {
    // Inject a sentinel that LOOKS like a live EBES import so the gate fails.
    raw =
      raw +
      '\nimport { ExpandedBusinessEventSheet } from "./expandedCard/ExpandedBusinessEventSheet";\n<ExpandedBusinessEventSheet />;\n';
  }
  const code = stripComments(raw);
  const rel = file.slice(ROOT.length + 1);
  if (IMPORT_RE.test(code)) {
    violations.push(`${rel} still IMPORTS ExpandedBusinessEventSheet.`);
  }
  if (MOUNT_RE.test(code)) {
    violations.push(`${rel} still MOUNTS <ExpandedBusinessEventSheet>.`);
  }
}

if (violations.length > 0) {
  console.error("[ORCH-1138 ebes-deleted] FAIL — EBES is not fully decommissioned:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error(
    "\nEBES was decommissioned by ORCH-1138 Leg 3; deck/venue/chat use the " +
      "foundation detail screens (ConsumerEventDetailScreen / " +
      "ConsumerTripDetailScreen / ConsumerExperienceDetailScreen). " +
      "Re-introducing EBES regresses the experience-page redesign.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-1138 ebes-deleted] OK — ExpandedBusinessEventSheet deleted; zero live " +
    "imports/mounts in non-test source.",
);
process.exit(0);
