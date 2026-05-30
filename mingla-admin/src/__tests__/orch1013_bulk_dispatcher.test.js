// ORCH-1013 Finding B regression — useBulkRunDispatcher invariants:
//   - hard cap inFlight ≤ 3 (I-PROPOSED-INTEL-BULK-DISPATCHER-CAP-3)
//   - 2s stagger between consecutive `starting` transitions
//     (I-PROPOSED-INTEL-BULK-DISPATCHER-STAGGER-2S)
//   - status enum: pending | starting | running | complete | failed |
//     skipped_concurrent
//   - 409 concurrent_run → skipped_concurrent + toast emitted
//   - tick interval 500ms; reconciles `running` against list_active_runs
//
// node:test + source-string assertions (mingla-admin pattern). Behavioural
// proof lives in the source-inspect; the runtime hook depends on
// invokeWithRefresh which is not stubbable without RTL/vitest.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");
const HOOK = path.join(ADMIN_ROOT, "src", "hooks", "useBulkRunDispatcher.js");

describe("ORCH-1013 Finding B — useBulkRunDispatcher invariants", () => {
  const src = fs.readFileSync(HOOK, "utf8");

  it("declares MAX_CONCURRENT = 3 (hard cap)", () => {
    assert.ok(
      /MAX_CONCURRENT\s*=\s*3\b/.test(src),
      "MAX_CONCURRENT constant must be 3",
    );
  });

  it("declares STAGGER_MS = 2000 (2s stagger between starts)", () => {
    assert.ok(
      /STAGGER_MS\s*=\s*2_?000\b/.test(src),
      "STAGGER_MS constant must be 2000ms",
    );
  });

  it("gates `pending → starting` on inFlight < MAX_CONCURRENT", () => {
    assert.ok(
      src.includes("inFlight >= MAX_CONCURRENT"),
      "tick must short-circuit when inFlight >= MAX_CONCURRENT",
    );
  });

  it("gates `pending → starting` on STAGGER_MS since lastStartedAt", () => {
    assert.ok(
      src.includes("now - lastStartedAt < STAGGER_MS"),
      "tick must enforce >= STAGGER_MS between consecutive starts",
    );
  });

  it("classifies 409 concurrent_run as skipped_concurrent", () => {
    assert.ok(
      src.includes('code === "concurrent_run"'),
      "must distinguish concurrent_run from generic failures",
    );
    assert.ok(
      src.includes('"skipped_concurrent"'),
      "status string 'skipped_concurrent' must be the 409 verdict",
    );
  });

  it("emits a toast on start failure", () => {
    // The hook calls onToast({ variant: 'warning', title: 'Couldn\'t start ...', description: msg }).
    assert.ok(
      src.includes("Couldn't start"),
      "toast title for start failure must include \"Couldn't start\"",
    );
    assert.ok(
      src.includes('variant: "warning"'),
      "toast must use warning variant for start failures",
    );
  });

  it("reconciles running → complete via list_active_runs (auto-queue trigger)", () => {
    assert.ok(
      src.includes("list_active_runs"),
      "must poll list_active_runs to detect server-side completion",
    );
    assert.ok(
      src.includes('status: "complete"'),
      "must flip running rows to complete when run_id drops out of list_active_runs",
    );
  });

  it("dedupes enqueue (same city_id twice → one entry)", () => {
    assert.ok(
      src.includes("existingIds.has(c.city_id)"),
      "enqueue must skip city_ids already in the queue",
    );
  });

  it("cancelAll only affects pending entries (in-flight runs use per-card cancel)", () => {
    assert.ok(
      src.includes('c.status === "pending"') &&
        src.includes("skipped_concurrent"),
      "cancelAll must only flip status=pending → skipped_concurrent",
    );
  });

  it("ports per-place cost ($0.0040) for confirm_high_cost gating", () => {
    // Each city's start_run call must pass confirm_high_cost when its individual
    // estimate exceeds $5 (per SPEC §3 B.5).
    assert.ok(
      /\*\s*0\.004\b/.test(src) || src.includes("PER_PLACE_COST_USD"),
      "per-place cost ($0.0040) must be applied to compute confirm_high_cost",
    );
    assert.ok(
      src.includes("confirm_high_cost"),
      "per-city start_run call must include confirm_high_cost flag",
    );
  });
});
