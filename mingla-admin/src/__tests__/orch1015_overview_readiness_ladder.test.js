// ORCH-1015 Finding B regression test — IntelligenceOverviewTab.jsx renders
// the 3-band readiness ladder + binary badges + smart-skip bulk launcher.
//
// Source-file inspection (no JSDOM, no JSX loader; mirrors the
// orch1014_overview_three_columns.test.js pattern this replaces). Asserts:
//   - imports the NEW BoundaryReadinessBadge + DetailsReadinessBadge
//   - does NOT import the deleted SeedStatusBadge or RefreshStatusBadge
//   - renders the NEW headers "Boundary" + "Details (new Google fields)"
//   - badge prop wiring uses regeocoded + refreshed_new_fields + needs_refresh_count
//   - bandedRows memo exists + the 3 band labels appear verbatim
//   - readyCities / skippedCities memos exist (smart-skip)
//   - new badges contain NO <Button>, <a>, or onClick (read-only contract)
//   - RunRemainderOnAllConfirmModal source: accepts skippedCities prop,
//     renders 'Skipped — needs prep first' heading, calls onConfirm(safeCities)
//
// Also includes a smart-skip unit test (pure JS, in-test predicate) — given
// 9-city fixture, asserts the ready/skipped split per SPEC §4 Finding B/C.
//
// Fails-on-revert: if any of these contracts regress, this test FAILS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

const OVERVIEW_TAB_PATH = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "IntelligenceOverviewTab.jsx",
);
const OVERVIEW_SRC = fs.readFileSync(OVERVIEW_TAB_PATH, "utf8");

const MODAL_PATH = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "RunRemainderOnAllConfirmModal.jsx",
);
const MODAL_SRC = fs.readFileSync(MODAL_PATH, "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// 1. Imports — new badges in, old badges out.
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1015 — IntelligenceOverviewTab imports new readiness badges", () => {
  it("imports BoundaryReadinessBadge from ./BoundaryReadinessBadge", () => {
    assert.ok(
      /import\s+\{\s*BoundaryReadinessBadge\s*\}\s+from\s+["']\.\/BoundaryReadinessBadge["']/.test(
        OVERVIEW_SRC,
      ),
      "must import BoundaryReadinessBadge from ./BoundaryReadinessBadge",
    );
  });

  it("imports DetailsReadinessBadge from ./DetailsReadinessBadge", () => {
    assert.ok(
      /import\s+\{\s*DetailsReadinessBadge\s*\}\s+from\s+["']\.\/DetailsReadinessBadge["']/.test(
        OVERVIEW_SRC,
      ),
      "must import DetailsReadinessBadge from ./DetailsReadinessBadge",
    );
  });

  it("does NOT import the deleted SeedStatusBadge anywhere (regression guard)", () => {
    assert.equal(
      /SeedStatusBadge/.test(OVERVIEW_SRC),
      false,
      "SeedStatusBadge must be fully removed from IntelligenceOverviewTab",
    );
  });

  it("does NOT import the deleted RefreshStatusBadge anywhere (regression guard)", () => {
    assert.equal(
      /RefreshStatusBadge/.test(OVERVIEW_SRC),
      false,
      "RefreshStatusBadge must be fully removed from IntelligenceOverviewTab",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Headers — Boundary | Details before Servable.
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1015 — column headers swap to Boundary + Details (new Google fields)", () => {
  it("renders a 'Boundary' <th> header", () => {
    assert.ok(
      /<th[^>]*>\s*Boundary\s*<\/th>/.test(OVERVIEW_SRC),
      "must render <th>…Boundary…</th>",
    );
  });

  it("renders a 'Details (new Google fields)' <th> header", () => {
    assert.ok(
      /<th[^>]*>\s*Details \(new Google fields\)\s*<\/th>/.test(OVERVIEW_SRC),
      "must render <th>…Details (new Google fields)…</th>",
    );
  });

  it("Boundary header comes BEFORE Details which comes BEFORE >Servable<", () => {
    const boundaryIdx = OVERVIEW_SRC.indexOf("Boundary");
    const detailsIdx = OVERVIEW_SRC.indexOf("Details (new Google fields)");
    const servableIdx = OVERVIEW_SRC.indexOf(">Servable<");
    assert.ok(boundaryIdx > 0, "Boundary header must exist");
    assert.ok(detailsIdx > 0, "Details header must exist");
    assert.ok(servableIdx > 0, "Servable header must exist");
    assert.ok(boundaryIdx < detailsIdx, "Boundary must come before Details");
    assert.ok(detailsIdx < servableIdx, "Details must come before Servable");
  });

  it("the deleted 'Seed status' / 'Refresh status' header text is gone", () => {
    assert.equal(
      OVERVIEW_SRC.includes("Seed status"),
      false,
      "deleted 'Seed status' header must be gone",
    );
    assert.equal(
      OVERVIEW_SRC.includes("Refresh status"),
      false,
      "deleted 'Refresh status' header must be gone",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Badge prop wiring — regeocoded + refreshed_new_fields + needs_refresh_count.
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1015 — badge prop wiring from row fields", () => {
  it("instantiates <BoundaryReadinessBadge regeocoded={row.regeocoded}", () => {
    assert.ok(
      /<BoundaryReadinessBadge\s+regeocoded=\{row\.regeocoded\}/.test(OVERVIEW_SRC),
      "BoundaryReadinessBadge must wire regeocoded={row.regeocoded}",
    );
  });

  it("instantiates <DetailsReadinessBadge with refreshed={row.refreshed_new_fields} + needs_refresh_count", () => {
    assert.ok(
      /<DetailsReadinessBadge\b/.test(OVERVIEW_SRC),
      "must instantiate <DetailsReadinessBadge>",
    );
    assert.ok(
      /refreshed=\{row\.refreshed_new_fields\}/.test(OVERVIEW_SRC),
      "DetailsReadinessBadge must wire refreshed={row.refreshed_new_fields}",
    );
    assert.ok(
      /needs_refresh_count=\{row\.needs_refresh_count\b/.test(OVERVIEW_SRC),
      "DetailsReadinessBadge must wire needs_refresh_count={row.needs_refresh_count}",
    );
  });

  it("the 2 new badge cells do NOT contain <Button>, <a>, or onClick (read-only)", () => {
    const boundaryStart = OVERVIEW_SRC.indexOf("<BoundaryReadinessBadge");
    assert.ok(boundaryStart > 0, "BoundaryReadinessBadge must be present");
    const detailsStart = OVERVIEW_SRC.indexOf("<DetailsReadinessBadge");
    assert.ok(
      detailsStart > boundaryStart,
      "DetailsReadinessBadge must follow BoundaryReadinessBadge",
    );
    // End = first </td> after DetailsReadinessBadge
    const detailsCloseTd = OVERVIEW_SRC.indexOf("</td>", detailsStart);
    assert.ok(detailsCloseTd > detailsStart, "Details cell must close with </td>");
    const slice = OVERVIEW_SRC.slice(boundaryStart, detailsCloseTd);
    assert.ok(!/\bonClick\s*=/.test(slice), "no onClick in Boundary/Details cells");
    assert.ok(!/<Button\b/.test(slice), "no <Button> in Boundary/Details cells");
    assert.ok(!/<a\s/.test(slice), "no <a> anchor in Boundary/Details cells");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Banded ladder — memo + 3 verbatim band labels.
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1015 — 3-band ladder layout", () => {
  it("declares a bandedRows useMemo (asserts banded structure exists)", () => {
    assert.ok(
      /bandedRows\s*=\s*useMemo/.test(OVERVIEW_SRC),
      "must declare `const bandedRows = useMemo(...)`",
    );
  });

  it("contains all 3 verbatim band labels per SPEC §3 B.2", () => {
    assert.ok(
      OVERVIEW_SRC.includes("Ready — boundary current + details current"),
      "band1 label must appear verbatim",
    );
    assert.ok(
      OVERVIEW_SRC.includes("Needs detail refresh"),
      "band2 label must appear verbatim",
    );
    assert.ok(
      OVERVIEW_SRC.includes("Needs re-seed (deprecated boundary)"),
      "band3 label must appear verbatim",
    );
  });

  it("renders divider rows using <tr data-band='band1|band2|band3'>", () => {
    assert.ok(
      /data-band="band1"/.test(OVERVIEW_SRC),
      "must mark band1 divider with data-band='band1'",
    );
    assert.ok(
      /data-band="band2"/.test(OVERVIEW_SRC),
      "must mark band2 divider with data-band='band2'",
    );
    assert.ok(
      /data-band="band3"/.test(OVERVIEW_SRC),
      "must mark band3 divider with data-band='band3'",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Smart-skip memos exist + bulk button copy.
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1015 — smart-skip bulk launcher + memos", () => {
  it("declares readyCities + skippedCities memos (replaces candidateCities)", () => {
    assert.ok(
      /const\s+readyCities\s*=\s*useMemo/.test(OVERVIEW_SRC),
      "must declare `const readyCities = useMemo(...)`",
    );
    assert.ok(
      /const\s+skippedCities\s*=\s*useMemo/.test(OVERVIEW_SRC),
      "must declare `const skippedCities = useMemo(...)`",
    );
  });

  it("header button label = 'Run remainder on all ready cities'", () => {
    assert.ok(
      OVERVIEW_SRC.includes("Run remainder on all ready cities"),
      "header button must label 'Run remainder on all ready cities'",
    );
  });

  it("modal call site passes skippedCities prop", () => {
    assert.ok(
      /skippedCities=\{skippedCities\}/.test(OVERVIEW_SRC),
      "<RunRemainderOnAllConfirmModal> must receive skippedCities={skippedCities}",
    );
  });

  it("modal call site passes readyCities as candidateCities (dispatched cities)", () => {
    assert.ok(
      /candidateCities=\{readyCities\}/.test(OVERVIEW_SRC),
      "<RunRemainderOnAllConfirmModal> must receive candidateCities={readyCities}",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Smart-skip unit test — given a synthetic fixture, the ready/skipped
//    split matches SPEC §4 Finding B smart-skip test.
// ─────────────────────────────────────────────────────────────────────────────

// Mirror the in-component predicates (which aren't exported — keeping the
// test bound to the component file means a SPEC-divergent refactor here
// fails the source-scan tests above; this section asserts the LOGIC matches.
function isBoundaryReady(r) {
  return r?.regeocoded === true;
}
function isDetailsReady(r) {
  return r?.refreshed_new_fields === true;
}
function isFullyReady(r) {
  return isBoundaryReady(r) && isDetailsReady(r);
}

describe("ORCH-1015 — smart-skip ready/skipped split (logic mirror)", () => {
  const rows = [
    // band 1 — 4 ready cities with remainder, 1 ready with 0 remaining
    { city_id: "a", city_name: "A", regeocoded: true, refreshed_new_fields: true, remaining_count: 10, servable_count: 100 },
    { city_id: "b", city_name: "B", regeocoded: true, refreshed_new_fields: true, remaining_count: 5, servable_count: 80 },
    { city_id: "c", city_name: "C", regeocoded: true, refreshed_new_fields: true, remaining_count: 0, servable_count: 70 },
    { city_id: "d", city_name: "D", regeocoded: true, refreshed_new_fields: true, remaining_count: 3, servable_count: 60 },
    { city_id: "e", city_name: "E", regeocoded: true, refreshed_new_fields: true, remaining_count: 7, servable_count: 50 },
    // band 2 — 3 boundary-only cities with remainder
    { city_id: "f", city_name: "F", regeocoded: true, refreshed_new_fields: false, remaining_count: 12, needs_refresh_count: 12, servable_count: 90 },
    { city_id: "g", city_name: "G", regeocoded: true, refreshed_new_fields: false, remaining_count: 8, needs_refresh_count: 8, servable_count: 75 },
    { city_id: "h", city_name: "H", regeocoded: true, refreshed_new_fields: false, remaining_count: 4, needs_refresh_count: 4, servable_count: 40 },
    // band 3 — 1 boundary-needs-reseed city with remainder
    { city_id: "i", city_name: "I", regeocoded: false, refreshed_new_fields: false, remaining_count: 20, needs_refresh_count: 20, servable_count: 200 },
  ];

  const readyCities = rows
    .filter((r) => r.remaining_count > 0 && isFullyReady(r))
    .map((r) => ({ city_id: r.city_id, city_name: r.city_name, remaining_count: r.remaining_count }));

  const skippedCities = rows
    .filter((r) => r.remaining_count > 0 && !isFullyReady(r))
    .map((r) => ({
      city_id: r.city_id,
      city_name: r.city_name,
      remaining_count: r.remaining_count,
      regeocoded: r.regeocoded,
      refreshed_new_fields: r.refreshed_new_fields,
      skip_reason: !r.regeocoded ? "needs reseed" : "needs detail refresh",
    }));

  it("readyCities.length === 4 (a, b, d, e — c excluded by remaining_count > 0)", () => {
    assert.equal(readyCities.length, 4);
    assert.deepEqual(
      readyCities.map((c) => c.city_id).sort(),
      ["a", "b", "d", "e"],
    );
  });

  it("skippedCities.length === 4 (f, g, h boundary-only + i band-3)", () => {
    assert.equal(skippedCities.length, 4);
    assert.deepEqual(
      skippedCities.map((c) => c.city_id).sort(),
      ["f", "g", "h", "i"],
    );
  });

  it("band-3 city 'I' has skip_reason 'needs reseed'", () => {
    const i = skippedCities.find((c) => c.city_id === "i");
    assert.ok(i, "city I must be in skipped list");
    assert.equal(i.skip_reason, "needs reseed");
  });

  it("band-2 city 'F' has skip_reason 'needs detail refresh'", () => {
    const f = skippedCities.find((c) => c.city_id === "f");
    assert.ok(f, "city F must be in skipped list");
    assert.equal(f.skip_reason, "needs detail refresh");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Modal source-scan — accepts skippedCities, renders 'Skipped — needs prep
//    first' heading, calls onConfirm(safeCities).
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1015 — RunRemainderOnAllConfirmModal smart-skip behavior", () => {
  it("accepts skippedCities prop with default []", () => {
    assert.ok(
      /skippedCities\s*=\s*\[\]/.test(MODAL_SRC),
      "must accept skippedCities = [] default prop",
    );
  });

  it("renders 'Skipped — needs prep first' heading when skippedCities.length > 0", () => {
    assert.ok(
      MODAL_SRC.includes("Skipped — needs prep first"),
      "modal must render 'Skipped — needs prep first' heading verbatim",
    );
    // Gated on skippedCities.length > 0
    assert.ok(
      /skippedCities\.length\s*>\s*0/.test(MODAL_SRC),
      "skipped panel must be gated on skippedCities.length > 0",
    );
  });

  it("renders each skip_reason in the skipped list", () => {
    assert.ok(
      /\{c\.skip_reason\}/.test(MODAL_SRC),
      "must render {c.skip_reason} for each skipped city",
    );
  });

  it("onConfirm fires with safeCities only (skipped never enters dispatcher)", () => {
    assert.ok(
      /onConfirm\?\.\(safeCities\)/.test(MODAL_SRC),
      "onConfirm?.(safeCities) must be the call site — skipped cities never enqueued",
    );
  });

  it("title contains 'ready' (literal)", () => {
    assert.ok(
      /Run remainder on \$\{safeCities\.length\} ready/.test(MODAL_SRC),
      "title must read 'Run remainder on N ready cit(y|ies)'",
    );
  });
});
