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
  it("estimateRemainderCostUsd uses default $0.0040/place", () => {
    assert.equal(estimateRemainderCostUsd(0), 0);
    assert.equal(estimateRemainderCostUsd(100), 0.4);
    assert.equal(estimateRemainderCostUsd(1500), 6);
    assert.equal(estimateRemainderCostUsd(11344), 45.376);
  });

  it("estimateRemainderCostUsd honors override rate", () => {
    assert.equal(estimateRemainderCostUsd(100, 0.0075), 0.75);
  });

  it("estimateRemainderCostUsd handles invalid input safely", () => {
    assert.equal(estimateRemainderCostUsd(-1), 0);
    assert.equal(estimateRemainderCostUsd(NaN), 0);
    assert.equal(estimateRemainderCostUsd(undefined), 0);
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
