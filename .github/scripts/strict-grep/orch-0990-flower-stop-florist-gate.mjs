#!/usr/bin/env node
/**
 * ORCH-0990 [Curated "Flowers" stop resolves to real florists] — strict-grep gate.
 *
 * Enforces the composite primary-type florist gate so the curated flowers stop
 * never regresses back to admitting non-bouquet businesses (event planners,
 * decorators, general contractors that Google mis-tags with a secondary
 * `florist` tag in types[]).
 *
 * On supabase/functions/_shared/signalRankFetch.ts:
 *   1. COMBO_SLUG_PRIMARY_TYPE_GATE exists, and its `flowers` entry includes
 *      primary type 'florist' AND groceryFloralTag: true. (Catches a revert of
 *      the gate that drives serve-time florist eligibility.)
 *   2. `flowers` is NOT present in COMBO_SLUG_TYPE_FILTER. (Catches re-introduction
 *      of the rejected types[]-only mechanism, which re-admits the RC-2 noise.)
 *   3. COMBO_SLUG_FILTER_MIN.flowers is present and === 0. (Catches a silent floor
 *      bump that would drop genuine low-scoring florists.)
 *
 * On the migration supabase/migrations/*_orch_0990_*.sql:
 *   4. The new RPC body contains p_primary_type_required AND p_grocery_floral_tag
 *      AND the literal 'grocery_store'/'supermarket' + ARRAY['florist'] carve-out
 *      AND the primary_type predicate. (Catches a revert to the types[]-only RPC
 *      that would re-admit service/general_contractor primaries.)
 *
 * Established by SPEC §9 (ORCH-0990).
 * See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SIGNAL_RANK_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "signalRankFetch.ts",
);
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

let violations = 0;
function fail(msg, hint) {
  violations += 1;
  console.error(`[ORCH-0990] ${msg}`);
  if (hint) console.error(`  ${hint}`);
}

// ── signalRankFetch.ts checks ────────────────────────────────────────────────

if (!existsSync(SIGNAL_RANK_PATH)) {
  fail(
    `expected file not found: ${relative(REPO_ROOT, SIGNAL_RANK_PATH)}`,
    "signalRankFetch.ts is the single source of truth for the flowers gate.",
  );
} else {
  const src = readFileSync(SIGNAL_RANK_PATH, "utf8");

  // Rule 1 — COMBO_SLUG_PRIMARY_TYPE_GATE.flowers gates on florist + groceryFloralTag.
  const gateMatch = src.match(
    /flowers\s*:\s*\{\s*primaryTypes\s*:\s*\[\s*['"]florist['"]\s*\]\s*,\s*groceryFloralTag\s*:\s*true\s*\}/,
  );
  if (!src.includes("COMBO_SLUG_PRIMARY_TYPE_GATE") || !gateMatch) {
    fail(
      "missing or altered COMBO_SLUG_PRIMARY_TYPE_GATE.flowers gate.",
      "flowers MUST gate on { primaryTypes: ['florist'], groceryFloralTag: true } — " +
        "the composite primary-type florist gate. Reverting it re-admits non-florists.",
    );
  }

  // Rule 2 — flowers must NOT be in COMBO_SLUG_TYPE_FILTER (rejected mechanism).
  const typeFilterBlock = src.match(
    /COMBO_SLUG_TYPE_FILTER\s*:\s*Record<string,\s*string\[\]>\s*=\s*\{([\s\S]*?)\};/,
  );
  if (typeFilterBlock && /\bflowers\s*:/.test(typeFilterBlock[1])) {
    fail(
      "`flowers` is present in COMBO_SLUG_TYPE_FILTER — the rejected types[]-only mechanism.",
      "Google over-applies the secondary `florist` tag in types[] to event planners / " +
        "contractors. flowers MUST gate on primary_type (COMBO_SLUG_PRIMARY_TYPE_GATE), not types[].",
    );
  }

  // Rule 3 — COMBO_SLUG_FILTER_MIN.flowers === 0.
  const floorMatch = src.match(
    /COMBO_SLUG_FILTER_MIN\s*:\s*Record<string,\s*number>\s*=\s*\{([\s\S]*?)\};/,
  );
  if (!floorMatch) {
    fail("could not locate COMBO_SLUG_FILTER_MIN block.");
  } else {
    const flowersFloor = floorMatch[1].match(/['"]flowers['"]\s*:\s*(\d+)/);
    if (!flowersFloor) {
      fail(
        "COMBO_SLUG_FILTER_MIN.flowers is missing.",
        "flowers MUST be explicitly set to 0 (order-only; the type gate is the honesty guarantee).",
      );
    } else if (flowersFloor[1] !== "0") {
      fail(
        `COMBO_SLUG_FILTER_MIN.flowers === ${flowersFloor[1]}, expected 0.`,
        "A positive floor drops real low-scoring florists (Lagos Fresh Flowers 33, Sparkle Gardens 0).",
      );
    }
  }
}

// ── migration check ──────────────────────────────────────────────────────────

let migFile = null;
if (existsSync(MIGRATIONS_DIR)) {
  migFile = readdirSync(MIGRATIONS_DIR).find(
    (f) => /_orch_0990_.*\.sql$/.test(f) && /fetch_local_signal_ranked/.test(f),
  );
}
if (!migFile) {
  fail(
    "ORCH-0990 fetch_local_signal_ranked migration not found in supabase/migrations/.",
    "Expected a *_orch_0990_fetch_local_signal_ranked_primary_type_gate.sql migration.",
  );
} else {
  const sql = readFileSync(join(MIGRATIONS_DIR, migFile), "utf8");
  const hasParams =
    sql.includes("p_primary_type_required") && sql.includes("p_grocery_floral_tag");
  const hasPrimaryPredicate = sql.includes(
    "pp.primary_type = ANY(p_primary_type_required)",
  );
  const hasGroceryCarveout =
    /pp\.primary_type = ANY\(ARRAY\['grocery_store','supermarket'\]\)/.test(sql) &&
    /pp\.types && ARRAY\['florist'\]/.test(sql);
  if (!hasParams || !hasPrimaryPredicate || !hasGroceryCarveout) {
    fail(
      `migration ${migFile} does not express the composite primary-type gate.`,
      "RPC MUST gate on pp.primary_type (NOT types[]-overlap alone) and carve out " +
        "grocery/supermarket + florist tag. Reverting to the types[]-only RPC re-admits " +
        "service/general_contractor primaries (the exact Lagos bug).",
    );
  }
}

if (violations === 0) {
  console.log(
    "[ORCH-0990] OK — flowers composite primary-type gate present; floor 0; no types[]-only revert.",
  );
  process.exit(0);
}

console.error(`[ORCH-0990] FAIL — ${violations} violation(s).`);
console.error(
  "  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-FLOWER-STOP-FLORIST-VERIFIED (DRAFT).",
);
process.exit(1);
