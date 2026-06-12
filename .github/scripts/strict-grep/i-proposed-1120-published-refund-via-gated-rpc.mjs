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

// The published-path files that must NOT touch the sales-unaware service.
const NO_DIRECT_REFUND_SERVICE_FILES = [SCREEN, ACCORDION];

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

const violations = [];

for (const rel of NO_DIRECT_REFUND_SERVICE_FILES) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push({
      file: rel,
      msg: "Scoped file missing — ORCH-1120 expects this file present.",
    });
    continue;
  }
  const stripped = stripComments(readFileSync(abs, "utf8"));
  for (const pattern of BANNED_DIRECT_WRITERS) {
    if (pattern.test(stripped)) {
      violations.push({
        file: rel,
        msg: `Banned direct refund write ${pattern} — published-trip refund/deadline edits MUST route through biz_update_live_trip (the sales-gated RPC), NEVER the sales-unaware refundPolicyService. Those functions are draft-wizard-only.`,
      });
    }
  }
}

// The parent screen must save through the gated RPC path (single Save button).
{
  const abs = join(ROOT, SCREEN);
  if (existsSync(abs)) {
    const stripped = stripComments(readFileSync(abs, "utf8"));
    const hasGatedSave = REQUIRED_IN_SCREEN.some((p) => p.test(stripped));
    if (!hasGatedSave) {
      violations.push({
        file: SCREEN,
        msg: "Must save via `updateLiveTripFields` (or the `useUpdateLiveTripFields` hook) — the single sales-gated write path for published-trip Settings edits.",
      });
    }
  }
}

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
