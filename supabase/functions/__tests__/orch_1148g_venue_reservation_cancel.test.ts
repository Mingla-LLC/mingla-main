// META-ORCH-1148 2.2g — venue-reservation-cancel contract regression.
// Run:
//   deno test --allow-read supabase/functions/__tests__/orch_1148g_venue_reservation_cancel.test.ts
//
// Source-level contract pins (no live Stripe/SQL harness in the worktree). The
// cancel fn must: cancel as the user (auth.uid() ownership), then — ONLY when
// the RPC says refund_eligible — execute the Stripe deposit refund on the
// brand's CONNECTED account, idempotent on the reservation id, and flip
// payment_status to 'refunded'. A refund-side failure must keep the cancel
// (200, refunded:false) — never un-cancel a freed seat.

import { assert, assertMatch } from "jsr:@std/assert@1";

const FILE =
  "supabase/functions/venue-reservation-cancel/index.ts";
const SRC = Deno.readTextFileSync(FILE);
const CONFIG = Deno.readTextFileSync("supabase/config.toml");

Deno.test("G-1 cancels via pg_cancel_my_reservation called AS THE USER", () => {
  assertMatch(SRC, /userClient\(req\)/);
  assertMatch(SRC, /\.rpc\(\s*["']pg_cancel_my_reservation["']/);
});

Deno.test("G-2 owner-only: rejects unauthenticated callers", () => {
  assertMatch(SRC, /userIdFromAuthHeader\(req\)/);
  assertMatch(SRC, /not_authenticated/);
});

Deno.test("G-3 refund runs ONLY when eligible + a real paid charge exists", () => {
  // The guard short-circuits (returns refunded:false) unless eligible + fee + PI.
  assertMatch(
    SRC,
    /if\s*\(!refundEligible\s*\|\|\s*feeCents\s*<=\s*0\s*\|\|\s*!paymentIntentId\)/,
  );
});

Deno.test("G-4 refund is a direct-charge refund on the CONNECTED account", () => {
  assertMatch(SRC, /stripe_connect_id/);
  assertMatch(SRC, /refunds\.create/);
  assertMatch(SRC, /stripeAccount:\s*connectedAccountId/);
  assertMatch(SRC, /payment_intent:\s*paymentIntentId/);
  assertMatch(SRC, /amount:\s*feeCents/);
});

Deno.test("G-5 refund is idempotent on the reservation id", () => {
  assertMatch(SRC, /idempotencyKey:\s*`venue_resv_refund:\$\{reservation\.id\}`/);
});

Deno.test("G-6 success flips payment_status to refunded + returns the amount", () => {
  assertMatch(SRC, /payment_status:\s*["']refunded["']/);
  assertMatch(SRC, /refunded:\s*true/);
  assertMatch(SRC, /refundAmountCents:\s*feeCents/);
});

Deno.test("G-7 a refund failure keeps the cancel (200, refunded:false, refundError)", () => {
  // No 502 on the refund arm — the seat is already freed; only the money retries.
  assert(!/refunds\.create[\s\S]*?502/.test(SRC), "refund failure must not 502");
  assertMatch(SRC, /refundError/);
});

Deno.test("G-8 registered verify_jwt=false (the fn enforces auth itself)", () => {
  assertMatch(
    CONFIG,
    /\[functions\.venue-reservation-cancel\][\s\S]*?verify_jwt = false/,
  );
});
