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

const violations = [];

for (const rel of SCOPED_FILES) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) {
    violations.push({
      file: rel,
      msg: "Scoped file missing — ORCH-0852 expects this file present.",
    });
    continue;
  }
  const raw = readFileSync(abs, "utf8");
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

// Both payment.tsx (M0) and confirm.tsx (M1) MUST call confirmTicketCheckout.
const callerRequired = [
  "mingla-business/app/checkout/[eventId]/payment.tsx",
  "mingla-business/app/checkout/[eventId]/confirm.tsx",
];
for (const rel of callerRequired) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const raw = readFileSync(abs, "utf8");
  const stripped = stripComments(raw);
  if (!REQUIRED_CALLER_IDENTIFIER.test(stripped)) {
    violations.push({
      file: rel,
      msg: "Must call `confirmTicketCheckout` (synchronous own-confirm path) per I-CHECKOUT-OWN-CONFIRM-PATH.",
    });
  }
}

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
