#!/usr/bin/env node
/**
 * ORCH-0852 [Buyer-web confirmation QR clipped + wallet passes inert +
 * in-app-browser stuck after payment] — strict-grep gate.
 *
 * Enforces TWO invariants codified in
 * Mingla_Artifacts/specs/SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md:
 *
 *   I-CHECKOUT-OWN-CONFIRM-PATH — buyer-facing checkout routes MUST own the
 *     order-confirmation path by calling `confirmTicketCheckout` directly
 *     against Stripe via the `ticket-checkout-confirm` edge function. They
 *     MUST NOT depend on `pollTicketCheckoutStatus` for buyer-visible
 *     success rendering. Polling-and-giving-up is forbidden — Stripe
 *     webhook timing must not gate UI success state.
 *
 *   I-CHECKOUT-NO-POLL-AND-FAIL — post-payment buyer-facing UI MUST NOT
 *     enter a "polled-and-gave-up" stranded state. Banned literals:
 *     `finalizing`, `finalizingTimedOut`, `webResumeError`, plus banned
 *     user-facing copy `"Payment received"`, `"Finalizing your tickets"`,
 *     `"Check now"`, `"Help me find my order"` (the latter two are
 *     band-aid affordances superseded by the bulletproof architecture).
 *
 * Scope: `mingla-business/app/checkout/[eventId]/payment.tsx`,
 *        `mingla-business/app/checkout/[eventId]/confirm.tsx`,
 *        `mingla-business/app/o/[orderId].tsx`.
 *
 * Comments are stripped before scanning so historical references can
 * remain in headers without false positives.
 *
 * Exit codes:
 *   0 — clean
 *   1 — violation
 *
 * Per SPEC_ORCH-0852 §"Regression Prevention".
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

const SCOPED_FILES = [
  "mingla-business/app/checkout/[eventId]/payment.tsx",
  "mingla-business/app/checkout/[eventId]/confirm.tsx",
  "mingla-business/app/o/[orderId].tsx",
];

const BANNED_IDENTIFIERS = [
  /\bfinalizingTimedOut\b/,
  /\bsetFinalizing\b/,
  /\bfinalizingRef\b/,
  /\bwebResumeError\b/,
  /\bsetWebResumeError\b/,
];

const BANNED_LITERALS = [
  /"Payment received"/,
  /'Payment received'/,
  /"Finalizing your tickets"/,
  /'Finalizing your tickets'/,
  /"Check now"/,
  /'Check now'/,
  /"Help me find my order"/,
  /'Help me find my order'/,
];

const REQUIRED_CALLER_IDENTIFIER = /\bconfirmTicketCheckout\b/;
const BANNED_CALLER_IDENTIFIER = /\bpollTicketCheckoutStatus\b/;

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Both payment.tsx (M0) and confirm.tsx (M1) MUST call confirmTicketCheckout.
const callerRequired = [
  "mingla-business/app/checkout/[eventId]/payment.tsx",
  "mingla-business/app/checkout/[eventId]/confirm.tsx",
];

// Pure verdict (behavior-preserving refactor). `files` maps each scoped path to
// its raw content, or null if absent. Pushes { file, msg } records into
// `violations` in the same order (SCOPED_FILES loop → callerRequired loop) as
// before. Never touches disk.
function check(files, violations) {
  for (const rel of SCOPED_FILES) {
    const raw = files[rel];
    if (raw == null) {
      violations.push({
        file: rel,
        msg: "Scoped file missing — ORCH-0852 expects this file present.",
      });
      continue;
    }
    const stripped = stripComments(raw);

    for (const pattern of BANNED_IDENTIFIERS) {
      if (pattern.test(stripped)) {
        violations.push({
          file: rel,
          msg: `Banned identifier match for ${pattern} — remove per I-CHECKOUT-NO-POLL-AND-FAIL.`,
        });
      }
    }

    for (const pattern of BANNED_LITERALS) {
      if (pattern.test(stripped)) {
        violations.push({
          file: rel,
          msg: `Banned user-facing copy match for ${pattern} — the bulletproof architecture replaces this dead-end copy.`,
        });
      }
    }

    if (BANNED_CALLER_IDENTIFIER.test(stripped)) {
      violations.push({
        file: rel,
        msg: "`pollTicketCheckoutStatus` is forbidden in buyer-facing checkout routes — use `confirmTicketCheckout` (sync) + `useOrderRealtimeSubscription` (fallback) per I-CHECKOUT-OWN-CONFIRM-PATH.",
      });
    }
  }

  for (const rel of callerRequired) {
    const raw = files[rel];
    if (raw == null) continue;
    const stripped = stripComments(raw);
    if (!REQUIRED_CALLER_IDENTIFIER.test(stripped)) {
      violations.push({
        file: rel,
        msg: "Must call `confirmTicketCheckout` (synchronous own-confirm path) per I-CHECKOUT-OWN-CONFIRM-PATH.",
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (map) => {
    const v = [];
    check(map, v);
    return v;
  };

  const PAYMENT = "mingla-business/app/checkout/[eventId]/payment.tsx";
  const CONFIRM = "mingla-business/app/checkout/[eventId]/confirm.tsx";
  const ORDER = "mingla-business/app/o/[orderId].tsx";
  const GOOD = {
    [PAYMENT]: "const r = await confirmTicketCheckout(sessionId);",
    [CONFIRM]: "const r = await confirmTicketCheckout(id); render(r.tickets);",
    [ORDER]: "const orderId = params.orderId;",
  };

  // GOOD: payment + confirm own the confirmation path; no poll-and-strand → silent.
  if (run(GOOD).length) self.push("GOOD (own-confirm path, no strand copy) wrongly flagged");

  // BAD1 (revert-style): the poll-and-give-up pattern is re-introduced → fires.
  const bad1 = {
    ...GOOD,
    [PAYMENT]: GOOD[PAYMENT] + "\nif (pollTicketCheckoutStatus()) { finalizingTimedOut = true; }",
  };
  if (run(bad1).length === 0) self.push("BAD1 (pollTicketCheckoutStatus / finalizingTimedOut re-added) not flagged");

  // BAD2 (regression, different angle): banned dead-end copy re-appears → fires.
  const bad2 = {
    ...GOOD,
    [CONFIRM]: GOOD[CONFIRM] + '\nconst msg = "Finalizing your tickets";',
  };
  if (run(bad2).length === 0) self.push('BAD2 ("Finalizing your tickets" banned copy re-added) not flagged');

  if (self.length) {
    console.error("I-CHECKOUT-OWN-CONFIRM-PATH self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-CHECKOUT-OWN-CONFIRM-PATH self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const files = {};
for (const rel of [...SCOPED_FILES, ...callerRequired]) {
  if (rel in files) continue;
  const abs = join(ROOT, rel);
  files[rel] = existsSync(abs) ? readFileSync(abs, "utf8") : null;
}

const violations = [];
check(files, violations);

if (violations.length > 0) {
  console.error(
    "\n[ORCH-0852 — i-checkout-own-confirm-path] VIOLATIONS:\n",
  );
  for (const v of violations) {
    console.error(`  • ${v.file}\n    ${v.msg}\n`);
  }
  console.error(
    "Per SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md — buyer checkout flows own the confirmation path; webhook-poll-and-strand patterns are forbidden.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-0852 — i-checkout-own-confirm-path] PASS — buyer checkout flows own their confirmation path; no poll-and-strand patterns present.",
);
process.exit(0);
