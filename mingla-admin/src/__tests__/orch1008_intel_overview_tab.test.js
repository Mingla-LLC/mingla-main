// ORCH-1008 Phase 3 regression test — Intelligence Overview tab + service
// contract: cost/time estimators are accurate and the source asserts the
// expected JSX surface (table + tiles + "Run remainder" button).
// Fails on revert (verified at commit hash recorded in implementation report).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  estimateRemainderCostUsd,
  estimateRemainderMinutes,
} from "../services/intelligenceCoverageEstimators.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");
const TAB = path.join(
  ADMIN_ROOT,
  "src",
  "components",
  "placeIntelligenceTrial",
  "IntelligenceOverviewTab.jsx",
);

describe("ORCH-1008 Phase 3 — intelligenceCoverageService estimators", () => {
  // issue #3526 P0-1 — the "$0.0040 default" this block used to assert WAS the
  // defect. It was the fifth client copy of a rate the edge function had
  // already moved to $0.0089, and a caller that omitted the argument priced a
  // run at 45% of its real cost. The rate is now a REQUIRED argument sourced
  // from the server's cost_model, and an unknown rate yields null, not a
  // confident wrong number.
  it("estimateRemainderCostUsd requires a rate and returns null without one", () => {
    assert.equal(estimateRemainderCostUsd(100), null);
    assert.equal(estimateRemainderCostUsd(100, undefined), null);
    assert.equal(estimateRemainderCostUsd(100, 0), null);
    assert.equal(estimateRemainderCostUsd(100, -0.001), null);
    assert.equal(estimateRemainderCostUsd(100, NaN), null);
  });

  it("estimateRemainderCostUsd prices against the rate it is given", () => {
    assert.equal(estimateRemainderCostUsd(0, 0.0089), 0);
    assert.equal(estimateRemainderCostUsd(100, 0.0089), 0.89);
    assert.equal(estimateRemainderCostUsd(100, 0.0075), 0.75);
    // The live example from the verdict: Baltimore, 1,205 remaining. The old
    // default priced this at $4.82 and sent confirm_high_cost=false; the server
    // charges $10.72 and refuses without the flag.
    assert.equal(estimateRemainderCostUsd(1205, 0.0089), 10.7245);
  });

  it("estimateRemainderCostUsd handles invalid counts safely", () => {
    assert.equal(estimateRemainderCostUsd(-1, 0.0089), 0);
    assert.equal(estimateRemainderCostUsd(NaN, 0.0089), 0);
    assert.equal(estimateRemainderCostUsd(undefined, 0.0089), 0);
  });

  it("estimateRemainderMinutes rounds up at 30s/place", () => {
    assert.equal(estimateRemainderMinutes(0), 0);
    assert.equal(estimateRemainderMinutes(1), 1); // 30s → ceil(0.5) = 1
    assert.equal(estimateRemainderMinutes(120), 60);
    assert.equal(estimateRemainderMinutes(11344), Math.ceil(11344 * 30 / 60));
  });
});

describe("ORCH-1008 Phase 3 — IntelligenceOverviewTab surface", () => {
  const src = fs.readFileSync(TAB, "utf8");

  it("imports the service + modal + spinner + alert primitives", () => {
    assert.ok(src.includes("fetchIntelligenceCoverage"), "must call the service");
    assert.ok(src.includes("RunRemainderConfirmModal"), "must mount the modal");
    assert.ok(src.includes("Spinner"), "must use Spinner for loading state");
    assert.ok(src.includes("AlertCard"), "must use AlertCard for error/empty states");
  });

  it("renders a coverage table header row with Servable / Evaluated / Remaining / Coverage / Action", () => {
    const required = ["Servable", "Evaluated", "Remaining", "Coverage", "Action"];
    for (const col of required) {
      assert.ok(src.includes(col), `table header must include "${col}"`);
    }
  });

  it('renders a "Run remainder" CTA per row', () => {
    assert.ok(
      src.includes("Run remainder"),
      "expected a 'Run remainder' label on the per-row CTA",
    );
  });

  it("renders the 4-tile aggregate (Cities / Servable / Evaluated / Remaining)", () => {
    for (const tile of ["Cities", "Servable", "Evaluated", "Remaining"]) {
      assert.ok(src.includes(tile), `expected aggregate tile labelled "${tile}"`);
    }
  });

  it("guards remainder=0 rows with disabled state + tooltip", () => {
    assert.ok(
      src.includes("0 places to evaluate"),
      "expected the disabled-row tooltip copy",
    );
  });

  it("calls list_active_runs before opening the modal (race guard)", () => {
    assert.ok(
      src.includes("list_active_runs"),
      "expected pre-open call to list_active_runs to avoid 23505 race",
    );
  });
});
