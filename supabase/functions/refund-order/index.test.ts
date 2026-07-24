import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

// Source-introspection tests. Mirrors the pattern used by other Mingla edge functions
// (e.g., stripe-kyc-stall-reminder/index.test.ts). Live-fire integration verification
// is owned by Claude `mingla-forensics` (TEST mode) per ORCH-0787 spec §11 T-01..T-28.

const SOURCE = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

Deno.test("refund-order: uses shared stripeTicketRefund factory (I-PROPOSED-Q)", () => {
  assert(SOURCE.includes('from "../_shared/stripe.ts"'));
  assert(SOURCE.includes("stripeTicketRefund"));
  // No inline Stripe instantiation, no inline apiVersion literal.
  assertFalse(/new\s+Stripe\s*\(/.test(SOURCE));
  assertFalse(/apiVersion\s*:/.test(SOURCE));
});

Deno.test("refund-order: direct-charge refund forbids reverse_transfer", () => {
  const code = stripComments(SOURCE);
  assertFalse(code.includes("reverse_transfer"));
  assert(code.includes("refund_application_fee"));
});

Deno.test("refund-order: scopes the refund to the connected account", () => {
  const code = stripComments(SOURCE);
  assert(code.includes("stripeAccount: connectedAccountId"));
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
