/**
 * #2099 — Admin web contract guard (Amendment 4 §D3, Amendment 5 §E1/§E3).
 *
 * `mingla-admin` has no component-render harness, so this is a STRUCTURAL guard
 * over the extracted panel, the Claims page's wiring and the thin service. The
 * behavioural Admin proof is the §D6 browser runtime matrix, which the
 * INDEPENDENT TESTER re-drives and posts on the issue (Amendment 12 §M3) — this
 * file does not claim to substitute for it.
 *
 * What it pins that a source scan genuinely can:
 *   · the shared `HighRiskActionModal` is REUSED, never forked or copied, and
 *     the panel supplies the exact proposed slug as its `confirmPhrase`;
 *   · the panel — not `ClaimsPage` — owns the proposal state, so the Amendment 5
 *     stale contract has one owner;
 *   · on `STALE_VERSION` / `DEPENDENCY_SCHEMA_CHANGED` the modal is UNMOUNTED
 *     (clearing its internally-owned reason AND phrase) and no success toast,
 *     optimistic update or reload runs;
 *   · the panel renders the server's SAFE dependency counts, never SQL, table
 *     names or row values;
 *   · both RPCs are called with the preview's own CAS values and fingerprints —
 *     the client never invents one.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const panel = read(
  "mingla-admin/src/components/claims/PendingVenueIdentityCorrectionPanel.jsx",
);
const page = read("mingla-admin/src/pages/ClaimsPage.jsx");
const service = read("mingla-admin/src/services/adminClaimsService.js");

const contains = (haystack, needle, label) =>
  assert.ok(haystack.includes(needle), `${label}: expected to find ${JSON.stringify(needle)}`);

test("#2099 Admin reuses the shared high-risk modal and owns its own proposal state", () => {
  contains(panel, 'from "../entity/HighRiskActionModal"', "panel");
  contains(panel, "<HighRiskActionModal", "panel");
  contains(panel, "confirmPhrase={proposal.slug}", "panel");
  contains(panel, 'confirmLabel="Correct pending venue"', "panel");
  contains(panel, "Correct venue identity", "panel");
  contains(panel, "Check eligibility", "panel");

  // ClaimsPage supplies only the selected venue and the reload callback.
  contains(page, "<PendingVenueIdentityCorrectionPanel", "page");
  contains(page, "onCorrected={reloadAfterIdentityCorrection}", "page");
  assert.ok(
    !/const \[proposal/.test(page),
    "ClaimsPage must not own the #2099 proposal state — the panel does",
  );
  contains(page, 'stay: "Stay"', "page");
});

test("#2099 Admin stale recovery unmounts the modal and never reports success", () => {
  contains(panel, "STALE_VERSION", "panel");
  contains(panel, "DEPENDENCY_SCHEMA_CHANGED", "panel");
  contains(panel, "setReviewOpen(false)", "panel");
  contains(panel, "setReviewKey((n) => n + 1)", "panel");
  contains(panel, "recoverFromStale", "panel");
  // The stale branch RETURNS before `onCorrected` — no toast, no reload.
  const staleBranch = panel.slice(
    panel.indexOf("if (STALE_CODES.has("),
    panel.indexOf("onCorrected?.()"),
  );
  assert.ok(staleBranch.length > 0, "the stale branch must precede the success call");
  contains(staleBranch, "await recoverFromStale(", "stale branch");
  contains(staleBranch, "return;", "stale branch");
});

test("#2099 Admin renders SAFE dependency counts only — never SQL or row values", () => {
  contains(panel, "dependency_counts", "panel");
  contains(panel, "lane.safe_label", "panel");
  contains(panel, "lane.count", "panel");
  contains(panel, "lane.classification", "panel");
  for (const leak of ["SELECT ", "venue_listings", "place_pool", "brand_hours"]) {
    assert.ok(
      !panel.includes(leak),
      `the panel must never surface ${leak} to an operator`,
    );
  }
});

test("#2099 Admin service is a thin caller of the one sealed writer", () => {
  contains(service, "preview_pending_venue_identity_correction", "service");
  contains(service, "correct_pending_venue_identity", "service");
  contains(service, "p_expected_schema_fingerprint: preview.schema_fingerprint", "service");
  contains(service, "p_expected_state_fingerprint: preview.state_fingerprint", "service");
  contains(service, "p_expected_updated_at: preview.current.updated_at", "service");
  // No direct write to a #2099-owned table may be reachable from Admin: the
  // RPC is the single mutation owner.
  for (const table of ["venue_identity_correction_audit", "issue_2099_dependency_schema_guard"]) {
    assert.ok(
      !service.includes(table),
      `adminClaimsService must never touch ${table} directly`,
    );
  }
});
