#!/usr/bin/env node
/**
 * ORCH-1120 [Published-trip Settings tab → editable refund tiers + booking
 * deadline + bookings-closed (sales-gated)] — strict-grep gate.
 *
 * Enforces I-PROPOSED-1120-PUBLISHED-REFUND-DEADLINE-VIA-GATED-RPC:
 *
 * Published-trip refund/deadline/bookings-closed edits MUST route through the
 * sales-gated biz_update_live_trip RPC, NEVER the sales-unaware
 * refundPolicyService direct writes (updateRefundPolicy / updateBookingDeadline).
 * The standalone service functions are draft-wizard-only (INVESTIGATE F-4 /
 * DISC-1120-A — they have ZERO sales-gate; calling them from the published path
 * would let a planner silently downgrade refund terms out from under paid
 * buyers).
 *
 * REWORK (2026-06-12, Seth device feedback): the Settings accordion was a
 * duplicate save path (its own button + reason dialog + mutation). It is now a
 * PURE CONTROLLED EDITOR; the gated save was consolidated into the parent
 * EditPublishedTripScreen.tsx (the single bottom Save button). The invariant is
 * UNCHANGED — published refund/deadline/closed edits still route through the
 * sales-gated biz_update_live_trip RPC — but the required gated-save call now
 * lives in the SCREEN, not the accordion.
 *
 * FAILS if:
 *   - EditPublishedTripScreen.tsx OR EditPublishedTripSettingsAccordion.tsx
 *     imports or calls `updateRefundPolicy` / `updateBookingDeadline`.
 *   - EditPublishedTripScreen.tsx does not call `updateLiveTripFields`
 *     (directly or via the `useUpdateLiveTripFields` hook) — the single
 *     sales-gated write path for published-trip Settings edits.
 *
 * Comments are stripped before scanning so historical references in headers
 * don't cause false positives.
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(screenSrc, accordionSrc, failures)` is exercised with a GOOD
 * fixture (specificity) and ≥2 DISTINCT BAD fixtures (sensitivity). The
 * disk-reading main path calls the SAME `check(...)`; behavior-preserving
 * refactor.
 *
 * Exit codes: 0 — clean; 1 — violation.
 *
 * Per SPEC_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE.md §9.1.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const TRIP_DIR = "mingla-business/src/components/trip";
const SCREEN = `${TRIP_DIR}/EditPublishedTripScreen.tsx`;
const ACCORDION = `${TRIP_DIR}/EditPublishedTripSettingsAccordion.tsx`;

const BANNED_DIRECT_WRITERS = [
  /\bupdateRefundPolicy\b/,
  /\bupdateBookingDeadline\b/,
];

// Post-REWORK the gated save lives in the parent screen (single Save button),
// not the accordion (now a pure controlled editor).
const REQUIRED_IN_SCREEN = [
  /\bupdateLiveTripFields\b/,
  /\buseUpdateLiveTripFields\b/,
];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Pure verdict. `screenSrc` / `accordionSrc` = raw source of the two scoped
 * files, or `null` when the file is absent on disk. Pushes violation records
 * ({ file, msg }) into `failures`. Behavior-preserving extraction of the
 * original banned-writer + required-gated-save assertions.
 */
function check(screenSrc, accordionSrc, failures) {
  const entries = [
    [SCREEN, screenSrc],
    [ACCORDION, accordionSrc],
  ];
  for (const [rel, src] of entries) {
    if (src == null) {
      failures.push({
        file: rel,
        msg: "Scoped file missing — ORCH-1120 expects this file present.",
      });
      continue;
    }
    const stripped = stripComments(src);
    for (const pattern of BANNED_DIRECT_WRITERS) {
      if (pattern.test(stripped)) {
        failures.push({
          file: rel,
          msg: `Banned direct refund write ${pattern} — published-trip refund/deadline edits MUST route through biz_update_live_trip (the sales-gated RPC), NEVER the sales-unaware refundPolicyService. Those functions are draft-wizard-only.`,
        });
      }
    }
  }

  // The parent screen must save through the gated RPC path (single Save button).
  if (screenSrc != null) {
    const stripped = stripComments(screenSrc);
    const hasGatedSave = REQUIRED_IN_SCREEN.some((p) => p.test(stripped));
    if (!hasGatedSave) {
      failures.push({
        file: SCREEN,
        msg: "Must save via `updateLiveTripFields` (or the `useUpdateLiveTripFields` hook) — the single sales-gated write path for published-trip Settings edits.",
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  // GOOD: screen saves via the gated hook + call; no banned writers; accordion
  // is a pure controlled editor → silent.
  const goodScreen =
    'import { useUpdateLiveTripFields } from "../../hooks/useTrips";\n' +
    "const mutation = useUpdateLiveTripFields();\n" +
    "const onSave = () => updateLiveTripFields(payload);\n";
  const goodAccordion = "export const SettingsAccordion = (props) => renderEditor(props);\n";
  let f = [];
  check(goodScreen, goodAccordion, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.map((v) => v.file).join("; "));

  // BAD1 (revert-style): a direct updateRefundPolicy( call re-added to the
  // screen → fires (the gated save is still present).
  const bad1Screen = goodScreen + "const r = updateRefundPolicy(newTiers);\n";
  f = [];
  check(bad1Screen, goodAccordion, f);
  if (f.length === 0) self.push("BAD1 (updateRefundPolicy re-added to screen) not flagged");

  // BAD2 (regression, different angle): the gated save call removed from the
  // screen (published edits now unguarded) → fires.
  const bad2Screen =
    "const onSave = () => persistSomethingElse(payload);\n";
  f = [];
  check(bad2Screen, goodAccordion, f);
  if (f.length === 0) self.push("BAD2 (gated updateLiveTripFields save removed) not flagged");

  if (self.length) {
    console.error("[ORCH-1120 — i-proposed-1120-published-refund-via-gated-rpc] self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("[ORCH-1120 — i-proposed-1120-published-refund-via-gated-rpc] self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const screenAbs = join(ROOT, SCREEN);
const accordionAbs = join(ROOT, ACCORDION);
const screenSrc = existsSync(screenAbs) ? readFileSync(screenAbs, "utf8") : null;
const accordionSrc = existsSync(accordionAbs) ? readFileSync(accordionAbs, "utf8") : null;

const violations = [];
check(screenSrc, accordionSrc, violations);

if (violations.length > 0) {
  console.error(
    "\n[ORCH-1120 — i-proposed-1120-published-refund-via-gated-rpc] VIOLATIONS:\n",
  );
  for (const v of violations) {
    console.error(`  • ${v.file}\n    ${v.msg}\n`);
  }
  console.error(
    "Per SPEC_ORCH-1120 §9.1 — published refund/deadline/bookings-closed edits route through the sales-gated biz_update_live_trip RPC. The refundPolicyService direct writes stay draft-wizard-only.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-1120 — i-proposed-1120-published-refund-via-gated-rpc] PASS — published-trip Settings saves route through the sales-gated biz_update_live_trip RPC; no sales-unaware refundPolicyService writes on the published path.",
);
process.exit(0);
