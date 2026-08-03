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
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(files, exists, failures)` is exercised with a GOOD fixture
 * (specificity) and ≥2 DISTINCT BAD fixtures (sensitivity). The disk-reading
 * main path builds `files`/`exists` from disk and calls the SAME `check(...)`;
 * the refactor is behavior-preserving (identical verdict on the real tree).
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

// Strip TS/JS line + block comments before matching code-only patterns.
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");

// Repo-relative paths of the content files the gate inspects.
const F = {
  eventOrdersService: "mingla-business/src/services/eventOrdersService.ts",
  orderDetail: "mingla-business/app/event/[id]/orders/[oid]/index.tsx",
  refundSheet: "mingla-business/src/components/orders/RefundSheet.tsx",
  cancelDialog: "mingla-business/src/components/orders/CancelOrderDialog.tsx",
  refundOrderFn: "supabase/functions/refund-order/index.ts",
  cancelOrderFn: "supabase/functions/cancel-order/index.ts",
  orphanService: "mingla-business/src/services/brandStripeOrphanedRefundsService.ts",
};
const RANDOM_ID_UTIL = "mingla-business/src/utils/randomId.ts";
const MIGRATION = "supabase/migrations/20260520000000_orch_0787_order_refund_cancel.sql";

/**
 * Pure verdict. `files` = { <repo-relative path>: rawContent }. `exists` =
 * { randomId: boolean, migration: boolean }. Assertions mirror the on-disk
 * gate exactly: `assertIncludes` uses the full text (imports/doc count),
 * `assertNotIncludes`/`assertRegexAbsent` use the comment-stripped view.
 */
function check(files, exists, failures) {
  const read = (file) => files[file] ?? "";
  const readCode = (file) => stripComments(read(file));

  const assertIncludes = (file, needle, message) => {
    if (!read(file).includes(needle)) failures.push(`${file}: ${message}`);
  };
  const assertNotIncludes = (file, needle, message) => {
    if (readCode(file).includes(needle)) failures.push(`${file}: ${message}`);
  };
  const assertRegexAbsent = (file, regex, message) => {
    if (regex.test(readCode(file))) failures.push(`${file}: ${message}`);
  };

  // ---- §8.1.1 + §8.1.2 — eventOrdersService server-truth refunds + status separation ----
  assertNotIncludes(
    F.eventOrdersService,
    "refunds: [],",
    "ORCH-0787 §8.1.1: fetchEventOrders must not hardcode `refunds: []`. Query public.refunds via the joined select instead.",
  );
  assertRegexAbsent(
    F.eventOrdersService,
    /if\s*\(\s*status\s*===\s*["']failed["']\s*\)\s*return\s+["']cancelled["']/,
    "ORCH-0787 §8.1.2: statusFromPayment must not map 'failed' → 'cancelled'. ORDER-CANCELLED-VS-FAILED-SEPARATION.",
  );
  assertIncludes(
    F.eventOrdersService,
    "refunds (",
    "ORCH-0787: fetchEventOrders must SELECT joined `refunds (...)` from the orders query.",
  );
  assertIncludes(
    F.eventOrdersService,
    "refund_line_items (",
    "ORCH-0787: fetchEventOrders must SELECT joined `refund_line_items (...)` for line-level accounting.",
  );

  // ---- §8.1.3 — order detail page no hardcoded false flags ----
  assertRegexAbsent(
    F.orderDetail,
    /const\s+showRefundFull\s*=\s*false\s*;/,
    "ORCH-0787 §8.1.3: order detail page must not hardcode showRefundFull = false. Use deriveActionFlags(order, canRefund).",
  );
  assertIncludes(
    F.orderDetail,
    "deriveActionFlags",
    "ORCH-0787: order detail must call deriveActionFlags to gate refund/cancel buttons.",
  );
  assertIncludes(
    F.orderDetail,
    "RefundSheet",
    "ORCH-0787: order detail must import + render RefundSheet (not just toast 'coming soon').",
  );
  assertIncludes(
    F.orderDetail,
    "CancelOrderDialog",
    "ORCH-0787: order detail must import + render CancelOrderDialog (not just toast 'coming soon').",
  );

  // ---- §8.1.4 — RefundSheet uses server mutation, not Zustand ----
  assertNotIncludes(
    F.refundSheet,
    "useOrderStore.recordRefund",
    "ORCH-0787 §8.1.4: RefundSheet must not call useOrderStore.recordRefund. Use useRefundOrder mutation instead.",
  );
  assertRegexAbsent(
    F.refundSheet,
    /useOrderStore\(\s*\(\s*s\s*\)\s*=>\s*s\.recordRefund\s*\)/,
    "ORCH-0787 §8.1.4: RefundSheet must not select recordRefund from useOrderStore.",
  );
  assertIncludes(
    F.refundSheet,
    "useRefundOrder",
    "ORCH-0787 §8.1.4: RefundSheet must import + call useRefundOrder mutation.",
  );

  // ---- §8.1.5 — CancelOrderDialog uses server mutation ----
  assertNotIncludes(
    F.cancelDialog,
    "useOrderStore.cancelOrder",
    "ORCH-0787 §8.1.5: CancelOrderDialog must not call useOrderStore.cancelOrder. Use useCancelOrder mutation instead.",
  );
  assertRegexAbsent(
    F.cancelDialog,
    /useOrderStore\(\s*\(\s*s\s*\)\s*=>\s*s\.cancelOrder\s*\)/,
    "ORCH-0787 §8.1.5: CancelOrderDialog must not select cancelOrder from useOrderStore.",
  );
  assertIncludes(
    F.cancelDialog,
    "useCancelOrder",
    "ORCH-0787 §8.1.5: CancelOrderDialog must import + call useCancelOrder mutation.",
  );

  // ---- §8.1.6 + §8.1.7 — refund-order uses shared Stripe client, no inline apiVersion ----
  assertIncludes(
    F.refundOrderFn,
    'from "../_shared/stripe.ts"',
    "ORCH-0787 §8.1.6: refund-order must import from _shared/stripe.ts (I-PROPOSED-Q).",
  );
  assertIncludes(
    F.refundOrderFn,
    "stripeTicketRefund",
    "ORCH-0787 §8.1.6: refund-order must use stripeTicketRefund() factory.",
  );
  assertRegexAbsent(
    F.refundOrderFn,
    /apiVersion\s*:/,
    "ORCH-0787 §8.1.7: refund-order must not contain a literal `apiVersion:` (I-PROPOSED-Q).",
  );
  assertRegexAbsent(
    F.refundOrderFn,
    /new\s+Stripe\s*\(/,
    "ORCH-0787 §8.1.6: refund-order must not call `new Stripe(...)` directly. Use stripeTicketRefund().",
  );

  // ---- §8.1.8 — cancel-order does NOT call Stripe ----
  assertNotIncludes(
    F.cancelOrderFn,
    "api.stripe.com",
    "ORCH-0787 §8.1.8: cancel-order must not make HTTP requests to api.stripe.com. Free orders only.",
  );
  assertNotIncludes(
    F.cancelOrderFn,
    "stripeTicketRefund",
    "ORCH-0787 §8.1.8: cancel-order must not import or use any Stripe factory.",
  );
  assertNotIncludes(
    F.cancelOrderFn,
    "stripe.refunds",
    "ORCH-0787 §8.1.8: cancel-order must not call Stripe Refunds API. Free orders only.",
  );

  // ---- §8.1.9 — orphan refund service uses real columns ----
  assertNotIncludes(
    F.orphanService,
    "raw_payload",
    "ORCH-0787 §8.1.9 (S-09 fix): brandStripeOrphanedRefundsService must use `payload` not `raw_payload`.",
  );
  assertRegexAbsent(
    F.orphanService,
    /\.eq\(\s*["']event_type["']/,
    "ORCH-0787 §8.1.9: brandStripeOrphanedRefundsService must filter `type` not `event_type`.",
  );
  assertRegexAbsent(
    F.orphanService,
    /\.select\(\s*["'][^"']*\bevent_id\b/,
    "ORCH-0787 §8.1.9: brandStripeOrphanedRefundsService must select `stripe_event_id` not `event_id`.",
  );
  assertIncludes(
    F.orphanService,
    "stripe_event_id",
    "ORCH-0787 §8.1.9: brandStripeOrphanedRefundsService must select the real `stripe_event_id` column.",
  );

  // ---- §8.1.10 — Hermes-safe randomId, never bare crypto.randomUUID() in business UI ----
  assertRegexAbsent(
    F.refundSheet,
    /\bcrypto\.randomUUID\s*\(/,
    "ORCH-0787 §8.1.10: RefundSheet must not call bare crypto.randomUUID() — use randomId() from utils/randomId.",
  );
  assertRegexAbsent(
    F.cancelDialog,
    /\bcrypto\.randomUUID\s*\(/,
    "ORCH-0787 §8.1.10: CancelOrderDialog must not call bare crypto.randomUUID() — use randomId() from utils/randomId.",
  );
  assertIncludes(
    F.refundSheet,
    "randomId",
    "ORCH-0787 §8.1.10: RefundSheet must import + call randomId() from utils/randomId.",
  );
  assertIncludes(
    F.cancelDialog,
    "randomId",
    "ORCH-0787 §8.1.10: CancelOrderDialog must import + call randomId() from utils/randomId.",
  );

  if (!exists.randomId) {
    failures.push(`${RANDOM_ID_UTIL}: ORCH-0787 §8.1.10 shared randomId util missing`);
  }

  // ---- Migration must exist ----
  if (!exists.migration) {
    failures.push(`${MIGRATION}: ORCH-0787 migration is missing`);
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  const goodFiles = {
    [F.eventOrdersService]:
      'const q = supabase.from("orders").select("*, refunds ( id ), refund_line_items ( id )");\n' +
      'function statusFromPayment(status) { if (status === "failed") return "failed"; }\n',
    [F.orderDetail]:
      'import { RefundSheet } from "../../../../src/components/orders/RefundSheet";\n' +
      'import { CancelOrderDialog } from "../../../../src/components/orders/CancelOrderDialog";\n' +
      "const flags = deriveActionFlags(order, canRefund);\n",
    [F.refundSheet]:
      'import { useRefundOrder } from "../../hooks/useRefundOrder";\n' +
      'import { randomId } from "../../utils/randomId";\n' +
      "const id = randomId();\nconst m = useRefundOrder();\n",
    [F.cancelDialog]:
      'import { useCancelOrder } from "../../hooks/useCancelOrder";\n' +
      'import { randomId } from "../../utils/randomId";\n' +
      "const id = randomId();\nconst m = useCancelOrder();\n",
    [F.refundOrderFn]:
      'import { stripeTicketRefund } from "../_shared/stripe.ts";\n' +
      "const r = await stripeTicketRefund({ orderId });\n",
    [F.cancelOrderFn]:
      "// free orders only — no Stripe call here\n" +
      "const r = await cancelFreeOrder(orderId);\n",
    [F.orphanService]:
      'const q = supabase.from("stripe_events").select("payload, type, stripe_event_id").eq("type", "refund");\n',
  };
  const goodExists = { randomId: true, migration: true };

  // GOOD: all 9 contract points + both files present.
  let f = [];
  check(goodFiles, goodExists, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join(" | "));

  // BAD1 (revert-style): re-add inline `new Stripe(...)` + `apiVersion:` in
  // refund-order → §8.1.6/§8.1.7 fire.
  const bad1Files = {
    ...goodFiles,
    [F.refundOrderFn]:
      'import { stripeTicketRefund } from "../_shared/stripe.ts";\n' +
      'const s = new Stripe(key, { apiVersion: "2024-11-20.acacia" });\n',
  };
  f = [];
  check(bad1Files, goodExists, f);
  if (f.length === 0) self.push("BAD1 (inline new Stripe/apiVersion in refund-order) not flagged");

  // BAD2 (regression, different angle): re-introduce the 'failed' → 'cancelled'
  // status mapping in eventOrdersService → §8.1.2 fires.
  const bad2Files = {
    ...goodFiles,
    [F.eventOrdersService]:
      'const q = supabase.from("orders").select("*, refunds ( id ), refund_line_items ( id )");\n' +
      'function statusFromPayment(status) { if (status === "failed") return "cancelled"; }\n',
  };
  f = [];
  check(bad2Files, goodExists, f);
  if (f.length === 0) self.push("BAD2 ('failed'→'cancelled' status mapping re-introduced) not flagged");

  if (self.length) {
    console.error("ORCH-0787 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0787 self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const failures = [];

const files = {};
for (const rel of Object.values(F)) {
  files[rel] = fs.readFileSync(path.join(root, rel), "utf8");
}
const exists = {
  randomId: fs.existsSync(path.join(root, RANDOM_ID_UTIL)),
  migration: fs.existsSync(path.join(root, MIGRATION)),
};

check(files, exists, failures);

if (failures.length > 0) {
  console.error("ORCH-0787 strict-grep gate failed:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log("ORCH-0787 strict-grep gate passed.");
