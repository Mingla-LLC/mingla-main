// META-ORCH-1009 Sub-D — admin UI test for the per-place "Re-evaluate AI
// signals" button in PlaceDetailModal.
//
// SPEC: Mingla_Artifacts/specs/SPEC_META-ORCH-1009_SUB_D_REFRESH_CRON.md §3.3
// Acceptance: L3-01 (button renders), L3-02 (POSTs admin_reeval_place + 200
// success path), L3-04 ("Last AI Evaluated" timestamp displayed).
//
// Source-inspect pattern (same as orch1008_*.test.js): boots no React; reads
// the JSX file as text + asserts the load-bearing strings exist. Fails on
// revert: removing the button JSX or handler flips T-01 / T-02 → fail.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_ROOT = path.resolve(__dirname, "..", "..");
const PAGE = path.join(ADMIN_ROOT, "src", "pages", "PlacePoolManagementPage.jsx");

const SOURCE = fs.readFileSync(PAGE, "utf8");

describe("META-ORCH-1009 Sub-D — Re-evaluate AI signals button", () => {
  it("T-01: button JSX rendered with the documented label", () => {
    assert.ok(
      SOURCE.includes("Re-evaluate AI signals"),
      "button label 'Re-evaluate AI signals' missing from PlaceDetailModal",
    );
  });

  it("T-02: handleReeval handler defined + invokes admin_reeval_place action", () => {
    assert.ok(
      SOURCE.includes("const handleReeval = async"),
      "handleReeval handler missing",
    );
    assert.ok(
      SOURCE.includes('"run-place-intelligence-trial"'),
      "supabase.functions.invoke target edge fn missing",
    );
    assert.ok(
      SOURCE.includes('action: "admin_reeval_place"'),
      "handler does not invoke admin_reeval_place action",
    );
    assert.ok(
      SOURCE.includes("place_pool_id: place.id"),
      "handler does not pass place_pool_id from the modal place",
    );
  });

  it("T-03: pending state disables the button (loading UI)", () => {
    assert.ok(
      SOURCE.includes("setReeval({ pending: true"),
      "pending-true setState missing",
    );
    assert.ok(
      SOURCE.includes("loading={reeval.pending}"),
      "Button loading prop not wired to reeval.pending",
    );
    assert.ok(
      SOURCE.includes("disabled={reeval.pending}"),
      "Button disabled prop not wired to reeval.pending",
    );
  });

  it("T-04: rate-limit (429) toast variant differentiates from generic failure", () => {
    // Sub-D operator decision: rate-limited gets a 'warning' toast so it
    // does not look like a hard error.
    assert.ok(
      SOURCE.includes('"rate_limited"'),
      "rate_limited error code not handled in handler",
    );
    assert.ok(
      SOURCE.includes('"warning"'),
      "warning toast variant not used for rate-limited case",
    );
  });

  it("T-05: 'Last AI Evaluated' timestamp surfaced in Data Freshness", () => {
    assert.ok(
      SOURCE.includes("Last AI Evaluated"),
      "Last AI Evaluated field missing from Data Freshness section",
    );
    assert.ok(
      SOURCE.includes("aiLastEvaluatedAt"),
      "aiLastEvaluatedAt derived value missing",
    );
    assert.ok(
      SOURCE.includes("place.ai_signal_scores"),
      "aiLastEvaluatedAt does not read from place.ai_signal_scores",
    );
  });

  it("T-06: success toast describes the ~16 min deck-refresh expectation", () => {
    assert.ok(
      SOURCE.includes("Re-evaluation queued"),
      "success toast title missing",
    );
    assert.ok(
      SOURCE.includes("~16 min"),
      "success toast does not communicate the ~16 min deck-refresh window",
    );
  });
});
