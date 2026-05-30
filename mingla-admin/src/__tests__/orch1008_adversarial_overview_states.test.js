// ORCH-1008 adversarial test — IntelligenceOverviewTab state handling.
//
// Attack angles:
//   - Disabled-row guard wraps remaining_count <= 0 AND checkingActiveRun
//   - Service throws when payload is missing `rows`
//   - Service throws when payload.rows is not Array
//   - Refresh button is gated on `loading` (no double-fetch storm)
//   - "Go to Place Pool" button is only rendered when onTabChange is passed
//     (no crash on undefined callback)
//
// Fails-on-revert verified at: 72f164536 (IntelligenceOverviewTab.jsx +
// intelligenceCoverageService.js + RunRemainderConfirmModal.jsx did not
// exist).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");

const TAB = fs.readFileSync(
  path.join(
    ADMIN_ROOT,
    "src",
    "components",
    "placeIntelligenceTrial",
    "IntelligenceOverviewTab.jsx",
  ),
  "utf8",
);
const SERVICE = fs.readFileSync(
  path.join(ADMIN_ROOT, "src", "services", "intelligenceCoverageService.js"),
  "utf8",
);

describe("ORCH-1008 adversarial — IntelligenceOverviewTab state handling", () => {
  it("disables the Run remainder button when remaining_count <= 0 OR checkingActiveRun", () => {
    assert.ok(
      /const disabled\s*=\s*row\.remaining_count\s*<=\s*0\s*\|\|\s*checkingActiveRun/
        .test(TAB),
      "disabled flag must include BOTH remaining_count<=0 AND checkingActiveRun guards",
    );
  });

  it("Refresh button is gated on loading state (no double-fetch storm)", () => {
    // The button uses `disabled={loading}` per current source.
    const refreshBlock = TAB.slice(
      TAB.indexOf("Refresh"),
      TAB.indexOf("Refresh") + 400,
    );
    // The Button has disabled={loading} prop — assert it's present.
    assert.ok(
      /disabled=\{loading\}/.test(TAB),
      "Refresh button must be disabled while loading to prevent fetch storms",
    );
  });

  it("empty state's 'Go to Place Pool' button is only rendered when onTabChange is provided", () => {
    // Source uses `action={ onTabChange ? <Button .../> : undefined }`.
    assert.ok(
      /onTabChange\s*\?\s*\(/.test(TAB),
      "Go to Place Pool action must be guarded behind onTabChange truthiness",
    );
  });

  it("aggregate.coverage_pct guards against servable=0 (no NaN propagation)", () => {
    assert.ok(
      /totals\.servable\s*===\s*0\s*\?\s*0\s*:/.test(TAB),
      "aggregate coverage_pct must short-circuit on servable=0 to avoid NaN",
    );
  });

  it("modalCity payload pins (id, name, remaining_count) — never leaks other row fields", () => {
    const m = TAB.match(/setModalCity\(\{([\s\S]*?)\}\);/);
    assert.ok(m, "expected setModalCity({...}) call");
    const body = m[1];
    // Only id, name, remaining_count should be passed.
    const fields = [...body.matchAll(/(\w+):/g)].map((mm) => mm[1]);
    assert.deepEqual(
      fields.sort(),
      ["id", "name", "remaining_count"].sort(),
      `modalCity payload must contain exactly {id, name, remaining_count}; got ${JSON.stringify(fields)}`,
    );
  });

  it("the per-row 'Run remainder' click is gated by handleOpenRemainderModal pre-check", () => {
    // The button's onClick must point at the gated handler — not setModalCity
    // directly. Otherwise the active-run race guard is bypassed.
    assert.ok(
      /onClick=\{\(\)\s*=>\s*handleOpenRemainderModal\(row\)\}/.test(TAB),
      "per-row Run remainder onClick must route through handleOpenRemainderModal",
    );
    // The handler's first guard is row.remaining_count <= 0 → return.
    assert.ok(
      /if\s*\(row\.remaining_count\s*<=\s*0\)\s*return/.test(TAB),
      "handleOpenRemainderModal must early-return on remaining_count <= 0",
    );
  });
});

describe("ORCH-1008 adversarial — fetchIntelligenceCoverage payload validation", () => {
  it("throws on null/undefined payload", () => {
    assert.ok(
      /if\s*\(!data\s*\|\|\s*!Array\.isArray\(data\.rows\)\)/.test(SERVICE),
      "service must throw on null payload or missing rows array",
    );
  });

  it("throws with a descriptive message ('malformed payload')", () => {
    assert.ok(
      SERVICE.includes("intelligence_coverage returned malformed payload"),
      "error message must mention 'malformed payload' for triage",
    );
  });

  it("re-exports the pure-math estimators from the service module", () => {
    // The estimators are used by both the modal AND the service. The service
    // re-exports them so the modal can import from one place.
    assert.ok(
      /export\s*\{[\s\S]*estimateRemainderCostUsd[\s\S]*\}/.test(SERVICE),
      "service must re-export estimateRemainderCostUsd",
    );
    assert.ok(
      /export\s*\{[\s\S]*estimateRemainderMinutes[\s\S]*\}/.test(SERVICE),
      "service must re-export estimateRemainderMinutes",
    );
  });

  it("routes only through invokeWithRefresh (no raw fetch / direct supabase.from)", () => {
    assert.ok(
      /invokeWithRefresh\("run-place-intelligence-trial"/.test(SERVICE),
      "service must invoke run-place-intelligence-trial via invokeWithRefresh",
    );
    assert.ok(
      !/\bfetch\s*\(/.test(SERVICE),
      "no raw fetch() allowed",
    );
    assert.ok(
      !/supabase\.from\(/.test(SERVICE),
      "no direct supabase.from() allowed (must go through edge fn for admin gating)",
    );
  });
});
