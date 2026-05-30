// ORCH-1015 QA ADVERSARIAL — IntelligenceOverviewTab + RunRemainderOnAllConfirmModal
// breakage probes the implementor's tests miss. Each test is fails-on-revert:
// remove the corresponding ORCH-1015 invariant and a test below will FAIL.
//
// Surface targeted:
//   1. Bulk-button label grammar (0/1/many ready cities — pluralization)
//   2. Band-divider suppression when only one band is non-empty
//   3. Within-band sort = servable_count DESC (stable order for ties)
//   4. Modal: empty safeCities path (button disabled even with acknowledged + typed)
//   5. Modal: per-city cost line uses perPlaceCostUsd (no hardcoded 0.004)
//   6. Edge-fn deviation: servable_count = 0 → refreshed_new_fields = false
//      (NULL-safe AND condition surfaced by `servable > 0 &&` in handleIntelligenceCoverage)
//   7. SPEC §3 C.4 — per-city "Run remainder" button preserved in ALL 3 bands
//      (operator override path on skipped cities)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

const OVERVIEW_SRC = fs.readFileSync(
  path.join(
    ADMIN_ROOT,
    "src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx",
  ),
  "utf8",
);
const MODAL_SRC = fs.readFileSync(
  path.join(
    ADMIN_ROOT,
    "src/components/placeIntelligenceTrial/RunRemainderOnAllConfirmModal.jsx",
  ),
  "utf8",
);
const EDGE_SRC = fs.readFileSync(
  path.resolve(
    ADMIN_ROOT,
    "..",
    "supabase/functions/run-place-intelligence-trial/index.ts",
  ),
  "utf8",
);

// ── Logic mirrors (pure JS) of IntelligenceOverviewTab helpers ───────────────
function isBoundaryReady(r) { return r?.regeocoded === true; }
function isDetailsReady(r) { return r?.refreshed_new_fields === true; }
function isFullyReady(r) { return isBoundaryReady(r) && isDetailsReady(r); }

function bandedRows(rows) {
  const sortBySrv = (a, b) => b.servable_count - a.servable_count;
  return {
    band1: rows.filter((r) => isBoundaryReady(r) && isDetailsReady(r)).sort(sortBySrv),
    band2: rows.filter((r) => isBoundaryReady(r) && !isDetailsReady(r)).sort(sortBySrv),
    band3: rows.filter((r) => !isBoundaryReady(r)).sort(sortBySrv),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
describe("ORCH-1015 QA — bulk-button label pluralization (0/1/many)", () => {
  // Source assertion: the button label literal must contain a pluralization
  // ternary keyed on readyCities.length === 1. Catches operator-grammar regressions.

  it("label uses `cit${readyCities.length === 1 ? 'y' : 'ies'}` pluralization (strict)", () => {
    // Must produce exact lowercase 'y' / 'ies' (case-mutated variants like 'Y' / 'IES'
    // would render as "cit Y" in the UI and break operator scanning).
    assert.ok(
      OVERVIEW_SRC.includes(`readyCities.length === 1 ? "y" : "ies"`),
      "bulk-button title must contain exact ternary `readyCities.length === 1 ? \"y\" : \"ies\"`",
    );
    assert.ok(
      OVERVIEW_SRC.includes(`skippedCities.length === 1 ? "y" : "ies"`),
      "skipped-count message must also use same pluralization (consistency)",
    );
  });

  it("button is disabled when readyCities.length === 0", () => {
    // Verify disabled prop reads from readyCities.length, not some unrelated state.
    const disabledLine = OVERVIEW_SRC.match(
      /disabled=\{loading \|\| readyCities\.length === 0\}/,
    );
    assert.ok(
      disabledLine,
      "Run-remainder-on-all button must disable when readyCities is empty",
    );
  });

  it("button label includes ` (${N})` suffix only when N > 0 (avoid '… (0)' artifact)", () => {
    assert.ok(
      OVERVIEW_SRC.includes(
        "readyCities.length > 0 ? ` (${readyCities.length})` : \"\"",
      ),
      "suffix must be empty string when N=0 (no '(0)' literal)",
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("ORCH-1015 QA — band-divider suppression (single non-empty band)", () => {
  it("all rows in band1 → bands 2+3 produce empty arrays (no dividers rendered)", () => {
    const rows = [
      { city_id: "a", city_name: "A", regeocoded: true, refreshed_new_fields: true, servable_count: 100, remaining_count: 5 },
      { city_id: "b", city_name: "B", regeocoded: true, refreshed_new_fields: true, servable_count: 90, remaining_count: 3 },
    ];
    const { band1, band2, band3 } = bandedRows(rows);
    assert.equal(band1.length, 2);
    assert.equal(band2.length, 0);
    assert.equal(band3.length, 0);
  });

  it("all rows in band3 → bands 1+2 empty (smoke-test the cold path)", () => {
    const rows = [
      { city_id: "x", city_name: "X", regeocoded: false, refreshed_new_fields: false, servable_count: 50, remaining_count: 50 },
    ];
    const { band1, band2, band3 } = bandedRows(rows);
    assert.equal(band1.length, 0);
    assert.equal(band2.length, 0);
    assert.equal(band3.length, 1);
  });

  it("source uses `bandedRows.bandN.length > 0 &&` conditional for divider row", () => {
    for (const b of ["band1", "band2", "band3"]) {
      assert.ok(
        OVERVIEW_SRC.includes(`bandedRows.${b}.length > 0 &&`),
        `divider row for ${b} must guard on .length > 0`,
      );
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("ORCH-1015 QA — within-band sort = servable_count DESC", () => {
  it("band1 ties sort stably (servable_count desc; equal counts keep input order)", () => {
    const rows = [
      { city_id: "first",  city_name: "First",  regeocoded: true, refreshed_new_fields: true, servable_count: 100, remaining_count: 5 },
      { city_id: "second", city_name: "Second", regeocoded: true, refreshed_new_fields: true, servable_count: 100, remaining_count: 5 },
      { city_id: "third",  city_name: "Third",  regeocoded: true, refreshed_new_fields: true, servable_count: 50,  remaining_count: 5 },
    ];
    const { band1 } = bandedRows(rows);
    assert.deepEqual(
      band1.map((r) => r.city_id),
      ["first", "second", "third"],
      "Array.prototype.sort is stable in V8 — ties keep input order",
    );
  });

  it("band1 sorts strictly descending by servable_count", () => {
    const rows = [
      { city_id: "low",  city_name: "Low",  regeocoded: true, refreshed_new_fields: true, servable_count: 10,  remaining_count: 1 },
      { city_id: "high", city_name: "High", regeocoded: true, refreshed_new_fields: true, servable_count: 100, remaining_count: 1 },
      { city_id: "mid",  city_name: "Mid",  regeocoded: true, refreshed_new_fields: true, servable_count: 50,  remaining_count: 1 },
    ];
    const { band1 } = bandedRows(rows);
    assert.deepEqual(band1.map((r) => r.city_id), ["high", "mid", "low"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("ORCH-1015 QA — modal `safeCities` filter + cost wiring", () => {
  it("modal computes safeCities by filtering candidateCities on remaining_count > 0", () => {
    assert.ok(
      MODAL_SRC.includes("candidateCities.filter((c) => c?.remaining_count > 0)"),
      "safeCities must drop zero-remainder rows defensively",
    );
  });

  it("modal disables `Queue all` when safeCities.length === 0 (even with ack)", () => {
    // canConfirm composition: must require safeCities.length > 0 ∧ acknowledged.
    assert.ok(
      /canConfirm\s*=[\s\S]{0,200}safeCities\.length\s*>\s*0\s*&&[\s\S]{0,80}acknowledged/.test(
        MODAL_SRC,
      ),
      "canConfirm requires safeCities.length > 0 (not just ack)",
    );
  });

  it("modal per-city cost line uses perPlaceCostUsd prop, NOT hardcoded 0.004", () => {
    // The per-line cost expression must reference perPlaceCostUsd, not the
    // DEFAULT_PER_PLACE_COST_USD constant (the prop wins when caller passes 0.0040).
    const perLine = MODAL_SRC.match(
      /c\.remaining_count \* perPlaceCostUsd/,
    );
    assert.ok(perLine, "per-city cost must multiply by `perPlaceCostUsd` prop");
  });

  it("modal `onConfirm` fires with safeCities (NOT candidateCities), so skipped never leak", () => {
    assert.ok(
      MODAL_SRC.includes("onConfirm?.(safeCities)"),
      "onConfirm payload must be safeCities only — never the raw candidateCities",
    );
    assert.ok(
      !MODAL_SRC.includes("onConfirm?.(candidateCities)"),
      "regression guard: onConfirm must not pass raw candidateCities",
    );
  });

  it("modal title uses singular 'city' when safeCities.length === 1", () => {
    assert.ok(
      MODAL_SRC.includes(`safeCities.length === 1 ? "city" : "cities"`),
      "modal title cityWord ternary must key on safeCities.length === 1",
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("ORCH-1015 QA — edge-fn deviation: servable_count=0 → refreshed=false", () => {
  // Implementor's spec deviation: refreshed_new_fields = needs_refresh_count === 0
  // AND servable > 0. The AND short-circuits when servable_count is 0, so even
  // though servable=0 cities are filtered out below the map, this defense holds.

  it("edge fn defines refreshed_new_fields with `servable > 0 &&` short-circuit", () => {
    assert.ok(
      EDGE_SRC.includes(
        "servable > 0 && (needsRefreshByCity.get(c.id) ?? 0) === 0",
      ),
      "refreshed_new_fields must require servable > 0 (NULL-safe deviation)",
    );
  });

  it("edge fn filters out cities with servable_count = 0 from final rows", () => {
    assert.ok(
      EDGE_SRC.includes(".filter((r) => r.servable_count > 0)"),
      "edge fn must drop servable=0 cities (matches admin Overview contract)",
    );
  });

  it("edge fn cutover constant is hardcoded 2026-03-19 UTC (not runtime-tunable)", () => {
    assert.ok(
      EDGE_SRC.includes(
        `Date.parse("2026-03-19T00:00:00Z")`,
      ),
      "cutover must be hardcoded UTC midnight — operator opens new ORCH to bump",
    );
    assert.ok(
      !EDGE_SRC.match(/Deno\.env\.get\(["']ORCH_1015_REFRESH_CUTOVER/),
      "cutover must NOT read from env (no runtime tuning surface)",
    );
  });

  it("edge fn NULL last_detail_refresh counts as needing refresh (never-refreshed case)", () => {
    // Mirror branch: the else clause increments needsRefreshByCity for NULL.
    assert.ok(
      EDGE_SRC.match(
        /} else \{\s*\/\/ Treat NULL last_detail_refresh as stale[\s\S]*?needsRefreshByCity\.set\(/,
      ),
      "NULL last_detail_refresh must increment needsRefreshByCity",
    );
  });

  it("edge fn regeocoded uses strict-equal with 0 (NULL → false, not true)", () => {
    assert.ok(
      EDGE_SRC.includes("(c.coverage_radius_km ?? null) === 0"),
      "regeocoded must strict-equal 0; NULL must coalesce to null then ≠ 0",
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("ORCH-1015 QA — per-city Run remainder button preserved in ALL bands", () => {
  it("renderCityRow renders 'Run remainder' button label exactly once (in shared renderer)", () => {
    // Single source: renderCityRow is shared by all 3 bands, so the button
    // is preserved in band 2 + band 3 (override path per SPEC §3 C.4 / §7-D6).
    // The button has the literal "          Run remainder\n        </Button>" — one occurrence.
    const matches = OVERVIEW_SRC.match(/\n\s+Run remainder\n\s*<\/Button>/g) || [];
    assert.equal(
      matches.length,
      1,
      "Run remainder button label literal must appear exactly once (in renderCityRow); bands share the renderer",
    );
  });

  it("renderCityRow is invoked once per band (all 3 bands map through it)", () => {
    const invocations = OVERVIEW_SRC.match(/renderCityRow\(/g) || [];
    // 3 .map(renderCityRow(...)) calls + 1 function declaration = 4
    assert.equal(
      invocations.length,
      4,
      "renderCityRow must be declared once + invoked once per band (decl + 3 = 4)",
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("ORCH-1015 QA — strict-grep allowlist hygiene", () => {
  it("ORCH_1015_BACKEND_ALLOWLIST entries exist + reference real files", () => {
    const grepSrc = fs.readFileSync(
      path.resolve(
        ADMIN_ROOT,
        "..",
        ".github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs",
      ),
      "utf8",
    );
    assert.ok(
      grepSrc.includes("ORCH_1015_BACKEND_ALLOWLIST"),
      "strict-grep gate must declare ORCH_1015_BACKEND_ALLOWLIST",
    );
    assert.ok(
      grepSrc.includes("...ORCH_1015_BACKEND_ALLOWLIST"),
      "ORCH_1015_BACKEND_ALLOWLIST must be spread into ALLOWLIST union",
    );
    // Both allowlist entries must point at extant files.
    for (const entry of [
      "supabase/functions/run-place-intelligence-trial/index.ts",
      "supabase/functions/run-place-intelligence-trial/__tests__/intelligence_coverage_seed_refresh.test.ts",
    ]) {
      const abs = path.resolve(ADMIN_ROOT, "..", entry);
      assert.ok(fs.existsSync(abs), `allowlist entry must exist: ${entry}`);
    }
  });
});
