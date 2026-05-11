#!/usr/bin/env node
/**
 * ORCH-0787 strict-grep gate — order refund + cancel flow.
 *
 * Enforces SPEC §8.1:
 *   1. eventOrdersService no longer hardcodes `refunds: []` in fetchEventOrders.
 *   2. eventOrdersService no longer maps `'failed' → 'cancelled'` (I-PROPOSED-AB ORDER-CANCELLED-VS-FAILED-SEPARATION).
 *   3. Order detail page no longer hardcodes the four show* flags to `false`.
 *   4. RefundSheet does NOT call useOrderStore.recordRefund (uses useRefundOrder mutation).
 *   5. CancelOrderDialog does NOT call useOrderStore.cancelOrder (uses useCancelOrder mutation).
 *   6. refund-order edge function imports getStripe via _shared/stripe.ts (no inline `new Stripe(...)`).
 *   7. refund-order edge function does NOT include a literal `apiVersion:` (I-PROPOSED-Q enforcement).
 *   8. cancel-order edge function does NOT make any HTTP request to api.stripe.com (free orders only).
 *   9. brandStripeOrphanedRefundsService.ts queries `payload` / `type` / `stripe_event_id` (the real columns).
 *
 * Runs from repo root or mingla-business sub-tree (matching sibling gates).
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

// Strip TS/JS line + block comments before matching code-only patterns.
// Conservative: removes // ... to end-of-line and /* ... */ blocks (non-greedy).
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");

const readCode = (relativePath) => stripComments(read(relativePath));

const failures = [];

// `assertIncludes` checks the full file (comments included) because it's used to verify
// that required identifiers are referenced anywhere (import lines, code, or doc).
const assertIncludes = (file, needle, message) => {
  if (!read(file).includes(needle)) failures.push(`${file}: ${message}`);
};

// `assertNotIncludes` and `assertRegexAbsent` use the comment-stripped view so JSDoc
// references to deprecated patterns don't trigger false positives.
const assertNotIncludes = (file, needle, message) => {
  if (readCode(file).includes(needle)) failures.push(`${file}: ${message}`);
};

const assertRegexAbsent = (file, regex, message) => {
  if (regex.test(readCode(file))) failures.push(`${file}: ${message}`);
};

// ---- §8.1.1 + §8.1.2 — eventOrdersService server-truth refunds + status separation ----

assertNotIncludes(
  "mingla-business/src/services/eventOrdersService.ts",
  "refunds: [],",
  "ORCH-0787 §8.1.1: fetchEventOrders must not hardcode `refunds: []`. Query public.refunds via the joined select instead.",
);

assertRegexAbsent(
  "mingla-business/src/services/eventOrdersService.ts",
  /if\s*\(\s*status\s*===\s*["']failed["']\s*\)\s*return\s+["']cancelled["']/,
  "ORCH-0787 §8.1.2: statusFromPayment must not map 'failed' → 'cancelled'. ORDER-CANCELLED-VS-FAILED-SEPARATION.",
);

assertIncludes(
  "mingla-business/src/services/eventOrdersService.ts",
  "refunds (",
  "ORCH-0787: fetchEventOrders must SELECT joined `refunds (...)` from the orders query.",
);

assertIncludes(
  "mingla-business/src/services/eventOrdersService.ts",
  "refund_line_items (",
  "ORCH-0787: fetchEventOrders must SELECT joined `refund_line_items (...)` for line-level accounting.",
);

// ---- §8.1.3 — order detail page no hardcoded false flags ----

assertRegexAbsent(
  "mingla-business/app/event/[id]/orders/[oid]/index.tsx",
  /const\s+showRefundFull\s*=\s*false\s*;/,
  "ORCH-0787 §8.1.3: order detail page must not hardcode showRefundFull = false. Use deriveActionFlags(order, canRefund).",
);

assertIncludes(
  "mingla-business/app/event/[id]/orders/[oid]/index.tsx",
  "deriveActionFlags",
  "ORCH-0787: order detail must call deriveActionFlags to gate refund/cancel buttons.",
);

assertIncludes(
  "mingla-business/app/event/[id]/orders/[oid]/index.tsx",
  "RefundSheet",
  "ORCH-0787: order detail must import + render RefundSheet (not just toast 'coming soon').",
);

assertIncludes(
  "mingla-business/app/event/[id]/orders/[oid]/index.tsx",
  "CancelOrderDialog",
  "ORCH-0787: order detail must import + render CancelOrderDialog (not just toast 'coming soon').",
);

// ---- §8.1.4 — RefundSheet uses server mutation, not Zustand ----

assertNotIncludes(
  "mingla-business/src/components/orders/RefundSheet.tsx",
  "useOrderStore.recordRefund",
  "ORCH-0787 §8.1.4: RefundSheet must not call useOrderStore.recordRefund. Use useRefundOrder mutation instead.",
);

assertRegexAbsent(
  "mingla-business/src/components/orders/RefundSheet.tsx",
  /useOrderStore\(\s*\(\s*s\s*\)\s*=>\s*s\.recordRefund\s*\)/,
  "ORCH-0787 §8.1.4: RefundSheet must not select recordRefund from useOrderStore.",
);

assertIncludes(
  "mingla-business/src/components/orders/RefundSheet.tsx",
  "useRefundOrder",
  "ORCH-0787 §8.1.4: RefundSheet must import + call useRefundOrder mutation.",
);

// ---- §8.1.5 — CancelOrderDialog uses server mutation ----

assertNotIncludes(
  "mingla-business/src/components/orders/CancelOrderDialog.tsx",
  "useOrderStore.cancelOrder",
  "ORCH-0787 §8.1.5: CancelOrderDialog must not call useOrderStore.cancelOrder. Use useCancelOrder mutation instead.",
);

assertRegexAbsent(
  "mingla-business/src/components/orders/CancelOrderDialog.tsx",
  /useOrderStore\(\s*\(\s*s\s*\)\s*=>\s*s\.cancelOrder\s*\)/,
  "ORCH-0787 §8.1.5: CancelOrderDialog must not select cancelOrder from useOrderStore.",
);

assertIncludes(
  "mingla-business/src/components/orders/CancelOrderDialog.tsx",
  "useCancelOrder",
  "ORCH-0787 §8.1.5: CancelOrderDialog must import + call useCancelOrder mutation.",
);

// ---- §8.1.6 + §8.1.7 — refund-order uses shared Stripe client, no inline apiVersion ----

assertIncludes(
  "supabase/functions/refund-order/index.ts",
  'from "../_shared/stripe.ts"',
  "ORCH-0787 §8.1.6: refund-order must import from _shared/stripe.ts (I-PROPOSED-Q).",
);

assertIncludes(
  "supabase/functions/refund-order/index.ts",
  "stripeTicketRefund",
  "ORCH-0787 §8.1.6: refund-order must use stripeTicketRefund() factory.",
);

assertRegexAbsent(
  "supabase/functions/refund-order/index.ts",
  /apiVersion\s*:/,
  "ORCH-0787 §8.1.7: refund-order must not contain a literal `apiVersion:` (I-PROPOSED-Q).",
);

assertRegexAbsent(
  "supabase/functions/refund-order/index.ts",
  /new\s+Stripe\s*\(/,
  "ORCH-0787 §8.1.6: refund-order must not call `new Stripe(...)` directly. Use stripeTicketRefund().",
);

// ---- §8.1.8 — cancel-order does NOT call Stripe ----

assertNotIncludes(
  "supabase/functions/cancel-order/index.ts",
  "api.stripe.com",
  "ORCH-0787 §8.1.8: cancel-order must not make HTTP requests to api.stripe.com. Free orders only.",
);

assertNotIncludes(
  "supabase/functions/cancel-order/index.ts",
  "stripeTicketRefund",
  "ORCH-0787 §8.1.8: cancel-order must not import or use any Stripe factory.",
);

assertNotIncludes(
  "supabase/functions/cancel-order/index.ts",
  "stripe.refunds",
  "ORCH-0787 §8.1.8: cancel-order must not call Stripe Refunds API. Free orders only.",
);

// ---- §8.1.9 — orphan refund service uses real columns ----

assertNotIncludes(
  "mingla-business/src/services/brandStripeOrphanedRefundsService.ts",
  "raw_payload",
  "ORCH-0787 §8.1.9 (S-09 fix): brandStripeOrphanedRefundsService must use `payload` not `raw_payload`.",
);

assertRegexAbsent(
  "mingla-business/src/services/brandStripeOrphanedRefundsService.ts",
  /\.eq\(\s*["']event_type["']/,
  "ORCH-0787 §8.1.9: brandStripeOrphanedRefundsService must filter `type` not `event_type`.",
);

assertRegexAbsent(
  "mingla-business/src/services/brandStripeOrphanedRefundsService.ts",
  /\.select\(\s*["'][^"']*\bevent_id\b/,
  "ORCH-0787 §8.1.9: brandStripeOrphanedRefundsService must select `stripe_event_id` not `event_id`.",
);

assertIncludes(
  "mingla-business/src/services/brandStripeOrphanedRefundsService.ts",
  "stripe_event_id",
  "ORCH-0787 §8.1.9: brandStripeOrphanedRefundsService must select the real `stripe_event_id` column.",
);

// ---- §8.1.10 — Hermes-safe randomId, never bare crypto.randomUUID() in business UI ----
//
// React Native's Hermes runtime has no global `crypto`. A bare crypto.randomUUID()
// throws ReferenceError on device. RefundSheet + CancelOrderDialog use
// utils/randomId, which falls back to Date+Math.random when crypto is absent.

assertRegexAbsent(
  "mingla-business/src/components/orders/RefundSheet.tsx",
  /\bcrypto\.randomUUID\s*\(/,
  "ORCH-0787 §8.1.10: RefundSheet must not call bare crypto.randomUUID() — use randomId() from utils/randomId.",
);

assertRegexAbsent(
  "mingla-business/src/components/orders/CancelOrderDialog.tsx",
  /\bcrypto\.randomUUID\s*\(/,
  "ORCH-0787 §8.1.10: CancelOrderDialog must not call bare crypto.randomUUID() — use randomId() from utils/randomId.",
);

assertIncludes(
  "mingla-business/src/components/orders/RefundSheet.tsx",
  "randomId",
  "ORCH-0787 §8.1.10: RefundSheet must import + call randomId() from utils/randomId.",
);

assertIncludes(
  "mingla-business/src/components/orders/CancelOrderDialog.tsx",
  "randomId",
  "ORCH-0787 §8.1.10: CancelOrderDialog must import + call randomId() from utils/randomId.",
);

if (!fs.existsSync(path.join(root, "mingla-business/src/utils/randomId.ts"))) {
  failures.push("mingla-business/src/utils/randomId.ts: ORCH-0787 §8.1.10 shared randomId util missing");
}

// ---- Migration must exist ----

const migrationPath = "supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql";
if (!fs.existsSync(path.join(root, migrationPath))) {
  failures.push(`${migrationPath}: ORCH-0787 migration is missing`);
}

// ---- Result ----

if (failures.length > 0) {
  console.error("ORCH-0787 strict-grep gate failed:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log("ORCH-0787 strict-grep gate passed.");
