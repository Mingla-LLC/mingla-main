import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// Source-introspection tests. Mirrors the pattern used by other Mingla edge functions
// (e.g., stripe-kyc-stall-reminder/index.test.ts). Live-fire integration verification
// is owned by Claude `mingla-forensics` (TEST mode) per ORCH-0787 spec §11 T-01..T-28.

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("refund-order: uses shared stripeTicketRefund factory (I-PROPOSED-Q)", () => {
  assert(SOURCE.includes('from "../_shared/stripe.ts"'));
  assert(SOURCE.includes("stripeTicketRefund"));
  // No inline Stripe instantiation, no inline apiVersion literal.
  assertFalse(/new\s+Stripe\s*\(/.test(SOURCE));
  assertFalse(/apiVersion\s*:/.test(SOURCE));
});

Deno.test("refund-order: Stripe refund call passes reverse_transfer:true (destination charge model)", () => {
  assert(SOURCE.includes("reverse_transfer: true"));
  assert(SOURCE.includes("refund_application_fee"));
});

Deno.test("refund-order: never sends Stripe-Account header (platform-account refund)", () => {
  // Strip comments (line + block) before checking — the source has documentation
  // comments referencing the absence of the header, which is informative not a violation.
  const code = SOURCE
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
  assertFalse(code.includes('"Stripe-Account"'));
  assertFalse(code.includes("'Stripe-Account'"));
  assertFalse(code.includes("stripeAccount:"));
});

Deno.test("refund-order: two-step RPC pattern (biz_refund_order then biz_refund_order_commit)", () => {
  assert(SOURCE.includes('"biz_refund_order"'));
  assert(SOURCE.includes('"biz_refund_order_commit"'));
});

Deno.test("refund-order: requires Idempotency-Key header", () => {
  assert(SOURCE.includes("Idempotency-Key"));
  assert(SOURCE.includes("idempotency_key_required"));
});

Deno.test("refund-order: enqueues buyer notification on ticket_order_notifications", () => {
  assert(SOURCE.includes('"ticket_order_notifications"'));
  assert(SOURCE.includes('"buyer_refund_issued"'));
});

Deno.test("refund-order: writes audit row via _shared/audit.ts", () => {
  assert(SOURCE.includes("writeAudit"));
  assert(SOURCE.includes('"order_refund_issued"'));
});

Deno.test("refund-order: handles Stripe declined by marking refund failed via commit RPC", () => {
  // Failure path must call commit with p_status='failed' and p_stripe_refund_id=null.
  assert(SOURCE.includes('p_status: "failed"'));
  assert(SOURCE.includes("stripe_declined"));
});

Deno.test("refund-order: idempotent replay path returns existing refund without re-calling Stripe", () => {
  assert(SOURCE.includes("idempotent_replay"));
});
