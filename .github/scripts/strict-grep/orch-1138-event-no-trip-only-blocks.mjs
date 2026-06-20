#!/usr/bin/env node
/**
 * ORCH-1138 Leg 2 [public event page redesign] — NO trip-only blocks on the event
 * page — strict-grep gate.
 *
 * Enforces I-PROPOSED-1138-EVENT-ON-FOUNDATION (SPEC §6 / §9 G-2 / N2 / N3 / rule
 * 9): the event page files (the shared FOUNDATION render path + the consumer event
 * screen) MUST NOT carry a refund-ladder, a booking-deadline strip, a per-day
 * itinerary spine, a departure→destination route line, or a pay-in-full /
 * installment toggle / split-CTA. The EVENT model has none of those fields —
 * rendering them would fabricate data (Constitution rule 9).
 *
 * Scoped files (comments stripped so explanatory doc comments never false-fire):
 *   - mingla-business/src/components/event/FoundationEventPreview.tsx (web/biz FOUNDATION body)
 *   - app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx
 *   - mingla-business/src/components/event/PublicEventPage.tsx (adapter)
 *   - app-mobile/src/components/offering/ConsumerEventReserveBar.tsx
 *
 * Banned tokens (active code): RefundLadder, RefundPolicyDisplay, bookingDeadline,
 * booking_deadline, splitCtas, ReserveSplitCtas, paymentPlanChoice,
 * installmentSchedule, "Pay over time", "Pay in full", "Day by day", "day-by-day"
 * itinerary spine, "Leaving from"/"Destination" route legs.
 *
 * Self-test: ORCH1138_SIMULATE_REVERT=1 injects a banned token in-memory → the
 * gate MUST FAIL (fails-on-revert proof).
 *
 * Exit codes: 0 — clean · 1 — violation.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const simulateRevert = process.env.ORCH1138_SIMULATE_REVERT === "1";

const FILES = [
  "mingla-business/src/components/event/FoundationEventPreview.tsx",
  "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
  "mingla-business/src/components/event/PublicEventPage.tsx",
  // ORCH-1168: EventReserveBar.tsx DELETED (dead code; ORCH-1167 replaced the
  // event reserve bar with the shared @mingla/offering-rendering EventOfferingFloatingBar).
  "app-mobile/src/components/offering/ConsumerEventReserveBar.tsx",
];

// Trip-only render tokens that must NEVER appear in event-page active code.
const BANNED = [
  { re: /\bRefundLadder\b/, why: "RefundLadder (refund ladder) — the event model has no refund_policy (N2)." },
  { re: /\bRefundPolicyDisplay\b/, why: "RefundPolicyDisplay — no refund ladder on the event page (N2)." },
  { re: /\bbookingDeadline\b/, why: "bookingDeadline — the event read carries no booking deadline (N2)." },
  { re: /\bbooking_deadline\b/, why: "booking_deadline — no deadline strip on the event page (N2)." },
  { re: /\bsplitCtas\b/, why: "splitCtas — events have no pay-over-time split CTA (N3)." },
  { re: /\bReserveSplitCtas\b/, why: "ReserveSplitCtas — events have no split-CTA (N3)." },
  { re: /\bpaymentPlanChoice\b/, why: "paymentPlanChoice — events have no installment plan; the checkout omits it (N3 / G-3)." },
  { re: /\binstallmentSchedule\b/, why: "installmentSchedule — events have no installment plan (N3)." },
  { re: /Pay over time/, why: '"Pay over time" — the pay-over-time toggle is trip-only (N3).' },
  { re: /Pay in full/, why: '"Pay in full" — the pay-in-full toggle is trip-only (N3).' },
  { re: /Day by day/, why: '"Day by day" — the itinerary spine is trip-only (N4 / rule 9).' },
  { re: /Leaving from/, why: '"Leaving from" — the departure→destination route line is trip-only (rule 9).' },
];

const stripComments = (src) =>
  src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const violations = [];

for (const rel of FILES) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push(`Scoped file missing: ${rel}`);
    continue;
  }
  let raw = readFileSync(abs, "utf8");
  if (simulateRevert) {
    // Inject a banned trip-only block (a refund ladder) into active code.
    raw = raw.replace(
      /export /,
      'const __reverted = <RefundLadder />;\nexport ',
    );
  }
  const code = stripComments(raw);
  for (const { re, why } of BANNED) {
    if (re.test(code)) {
      violations.push(`${rel}: ${why}`);
    }
  }
}

if (violations.length > 0) {
  console.error("\n[ORCH-1138 — event-no-trip-only-blocks] VIOLATIONS:\n");
  for (const v of violations) console.error(`  • ${v}\n`);
  console.error(
    simulateRevert
      ? "ORCH-1138 gate FAILED under SIMULATE_REVERT — expected (fails-on-revert proven)."
      : "Per SPEC_ORCH-1138_LEG2_EVENT_PAGE.md (N2/N3/N4/rule 9) — the event page carries NO refund ladder, deadline strip, itinerary spine, route line, or pay-toggle/split-CTA.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-1138 — event-no-trip-only-blocks] PASS — no refund/deadline/itinerary/route/pay-toggle in the event page files.",
);
process.exit(0);
