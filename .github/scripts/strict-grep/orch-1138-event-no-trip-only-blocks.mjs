#!/usr/bin/env node
/**
 * ORCH-1138 Leg 2 [public event page redesign] — NO trip-only blocks on the event
 * page — strict-grep gate. Amended by issue #3284 [refund terms on events and
 * experiences].
 *
 * Enforces I-PROPOSED-1138-EVENT-ON-FOUNDATION (SPEC §6 / §9 G-2 / N2 / N3 / rule
 * 9): the event page files (the shared body, the FOUNDATION render path + the
 * consumer event screen) MUST NOT carry a booking-deadline strip, a per-day
 * itinerary spine, a departure→destination route line, or a pay-in-full /
 * installment toggle / split-CTA. The event model has none of those fields —
 * rendering them would fabricate data (Constitution rule 9).
 *
 * #3284 — the event page's refund ladder is the shared OfferingRefundLadder fed by
 * real `events.refund_policy`, written by the organiser and validated by
 * `events_refund_policy_valid`. N2 was a rule-9 protection (no refund block with
 * nothing behind it), and I-3284-UNKNOWN-IS-NOT-NONE now does that job more
 * precisely: a missing key renders nothing. So:
 *   - the bare ladder token is no longer banned. It never matched the renamed
 *     component anyway (there is no word boundary inside OfferingRefundLadder);
 *   - the trip-named alias IS banned: the event page mounts the ladder under its
 *     own name with the event noun, never trip copy;
 *   - a REQUIRED list proves the shared body actually mounts the ladder with the
 *     event noun, because a ban-only gate cannot notice a surface that forgot it.
 *
 * Scoped files (comments stripped so explanatory doc comments never false-fire):
 *   - mingla-business/src/components/event/FoundationEventPreview.tsx (web/biz FOUNDATION wrapper)
 *   - app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx
 *   - mingla-business/src/components/event/PublicEventPage.tsx (adapter)
 *   - app-mobile/src/components/offering/ConsumerEventReserveBar.tsx
 *   - packages/offering-rendering/EventOfferingBody.tsx (#3284 — the shared body
 *     is where event rendering actually lives, I-PROPOSED-1167-SHELL-AGNOSTIC-BODY)
 *
 * Banned tokens (active code): TripRefundLadder, RefundPolicyDisplay,
 * bookingDeadline, booking_deadline, splitCtas, ReserveSplitCtas,
 * paymentPlanChoice, installmentSchedule, "Pay over time", "Pay in full",
 * "Day by day" itinerary spine, "Leaving from" route legs.
 *
 * Required tokens (active code): EventOfferingBody.tsx mounts OfferingRefundLadder
 * with offeringType="event".
 *
 * Self-test, both forms prove fails-on-revert against in-memory copies:
 *   node orch-1138-event-no-trip-only-blocks.mjs --self-test
 *     runs (i) a trip-only prop injected into the body and (ii) the required
 *     ladder tokens stripped from the body; exits 0 only when BOTH trip the gate.
 *   ORCH1138_SIMULATE_REVERT=1 node orch-1138-event-no-trip-only-blocks.mjs
 *     injects case (i) into every scoped file → the gate MUST exit 1.
 *
 * Exit codes: 0 — clean (or self-test proven) · 1 — violation.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const simulateRevert = process.env.ORCH1138_SIMULATE_REVERT === "1";
const selfTest = process.argv.includes("--self-test");

const EVENT_BODY = "packages/offering-rendering/EventOfferingBody.tsx";

const FILES = [
  "mingla-business/src/components/event/FoundationEventPreview.tsx",
  "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
  "mingla-business/src/components/event/PublicEventPage.tsx",
  // ORCH-1168: EventReserveBar.tsx DELETED (dead code; ORCH-1167 replaced the
  // event reserve bar with the shared @mingla/offering-rendering EventOfferingFloatingBar).
  "app-mobile/src/components/offering/ConsumerEventReserveBar.tsx",
  // #3284 — the shared body is where event rendering actually lives (I-PROPOSED-1167-SHELL-AGNOSTIC-BODY).
  EVENT_BODY,
];

// Trip-only render tokens that must NEVER appear in event-page active code.
const BANNED = [
  { re: /\bTripRefundLadder\b/, why: 'TripRefundLadder — the trip-named alias; event pages mount OfferingRefundLadder with offeringType="event" (#3284).' },
  { re: /\bRefundPolicyDisplay\b/, why: "RefundPolicyDisplay — the operator/buyer-cancel timeline (with its 'You're here' marker) is not the public event renderer; use OfferingRefundLadder (#3284)." },
  { re: /\bbookingDeadline\b/, why: "bookingDeadline — events set sale cutoffs per ticket tier (sale_end_at); an event-level booking deadline would be a second, conflicting authority (#3284 §3.3)." },
  { re: /\bbooking_deadline\b/, why: "booking_deadline — no event-level deadline strip; per-tier sale windows are the single cutoff authority (#3284 §3.3)." },
  { re: /\bsplitCtas\b/, why: "splitCtas — events have no pay-over-time split CTA (N3)." },
  { re: /\bReserveSplitCtas\b/, why: "ReserveSplitCtas — events have no split-CTA (N3)." },
  { re: /\bpaymentPlanChoice\b/, why: "paymentPlanChoice — events have no installment plan; the checkout omits it (N3 / G-3)." },
  { re: /\binstallmentSchedule\b/, why: "installmentSchedule — events have no installment plan (N3)." },
  { re: /Pay over time/, why: '"Pay over time" — the pay-over-time toggle is trip-only (N3).' },
  { re: /Pay in full/, why: '"Pay in full" — the pay-in-full toggle is trip-only (N3).' },
  { re: /Day by day/, why: '"Day by day" — the itinerary spine is trip-only (N4 / rule 9).' },
  { re: /Leaving from/, why: '"Leaving from" — the departure→destination route line is trip-only (rule 9).' },
];

// #3284 — positive checks: a ban-only gate cannot notice that the body forgot the
// ladder, and app-mobile has no typecheck gate to catch a dropped prop.
const REQUIRED = [
  { file: EVENT_BODY, re: /\bOfferingRefundLadder\b/, why: "the event body must mount the shared OfferingRefundLadder (#3284)." },
  { file: EVENT_BODY, re: /offeringType="event"/, why: 'the ladder must receive offeringType="event", never trip copy (#3284).' },
];

const stripComments = (src) =>
  src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

// Case (i): a trip-only prop on a ladder element in active code. Appended at the
// END of the file, never spliced at the first "export " — that match can sit
// inside a comment ("// Re-export …"), where stripping would hide the injection
// and the self-test would pass for the wrong reason.
const injectTripOnlyProp = (raw) =>
  `${raw}\nconst __reverted = <OfferingRefundLadder bookingDeadline={x} />;\n`;

// Case (ii): the body stops mounting the ladder with the event noun.
const stripRequiredTokens = (raw) =>
  raw
    .replace(/\bOfferingRefundLadder\b/g, "RemovedLadder")
    .replace(/offeringType="event"/g, "");

/** Run every check over `sources` (rel path → raw text). Returns violations. */
function check(sources) {
  const violations = [];
  for (const rel of FILES) {
    const raw = sources.get(rel);
    if (raw === undefined) {
      violations.push(`Scoped file missing: ${rel}`);
      continue;
    }
    const code = stripComments(raw);
    for (const { re, why } of BANNED) {
      if (re.test(code)) violations.push(`${rel}: ${why}`);
    }
  }
  for (const { file, re, why } of REQUIRED) {
    const raw = sources.get(file);
    if (raw === undefined) continue; // already reported as missing
    if (!re.test(stripComments(raw))) {
      violations.push(`${file}: REQUIRED — ${why}`);
    }
  }
  return violations;
}

function readSources() {
  const sources = new Map();
  for (const rel of FILES) {
    const abs = join(ROOT, rel);
    if (existsSync(abs)) sources.set(rel, readFileSync(abs, "utf8"));
  }
  return sources;
}

function runSelfTest() {
  const real = readSources();
  const failures = [];

  const injected = new Map(real);
  injected.set(EVENT_BODY, injectTripOnlyProp(real.get(EVENT_BODY) ?? ""));
  const injectedViolations = check(injected);
  if (!injectedViolations.some((v) => v.startsWith(`${EVENT_BODY}: bookingDeadline`))) {
    failures.push("(i) a bookingDeadline prop injected into the event body did NOT trip the gate.");
  }

  const stripped = new Map(real);
  stripped.set(EVENT_BODY, stripRequiredTokens(real.get(EVENT_BODY) ?? ""));
  const strippedViolations = check(stripped);
  const requiredHits = strippedViolations.filter((v) => v.includes("REQUIRED"));
  if (requiredHits.length !== REQUIRED.length) {
    failures.push(
      `(ii) stripping the ladder tokens from the event body tripped ${requiredHits.length} of ${REQUIRED.length} REQUIRED checks.`,
    );
  }

  const synthetic = new Map(real);
  synthetic.set(EVENT_BODY, 'const Body = () => <OfferingRefundLadder offeringType="event" />;\n');
  if (check(synthetic).some((v) => v.startsWith(EVENT_BODY))) {
    failures.push("a minimal body that mounts the ladder with the event noun wrongly tripped the gate.");
  }

  if (failures.length > 0) {
    console.error("\n[ORCH-1138 — event-no-trip-only-blocks] SELF-TEST FAILED:\n");
    for (const f of failures) console.error(`  • ${f}\n`);
    process.exit(1);
  }
  console.log(
    "[ORCH-1138 — event-no-trip-only-blocks] SELF-TEST PASS — a trip-only prop and a missing ladder both trip the gate.",
  );
  process.exit(0);
}

if (selfTest) runSelfTest();

const sources = readSources();
if (simulateRevert) {
  // Inject a trip-only prop into active code in every scoped file.
  for (const [rel, raw] of sources) sources.set(rel, injectTripOnlyProp(raw));
}
const violations = check(sources);

if (violations.length > 0) {
  console.error("\n[ORCH-1138 — event-no-trip-only-blocks] VIOLATIONS:\n");
  for (const v of violations) console.error(`  • ${v}\n`);
  console.error(
    simulateRevert
      ? "ORCH-1138 gate FAILED under SIMULATE_REVERT — expected (fails-on-revert proven)."
      : "Per SPEC_ORCH-1138_LEG2_EVENT_PAGE.md (N2/N3/N4/rule 9) and #3284 — the event page carries NO booking-deadline strip, itinerary spine, route line, or pay-toggle/split-CTA; its refund ladder is the shared OfferingRefundLadder fed by real `events.refund_policy` (#3284).",
  );
  process.exit(1);
}

console.log(
  "[ORCH-1138 — event-no-trip-only-blocks] PASS — no deadline/itinerary/route/pay-toggle in the event page files; the body mounts the shared refund ladder with the event noun.",
);
process.exit(0);
