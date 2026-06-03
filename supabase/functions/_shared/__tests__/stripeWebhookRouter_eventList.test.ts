import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { STRIPE_ROUTED_EVENT_TYPES } from "../stripeWebhookRouter.ts";

Deno.test("ORCH-0953 §3.4 (rev. ORCH-1054) — noisy live-cutover events are not routed", () => {
  const routed = new Set<string>(STRIPE_ROUTED_EVENT_TYPES);
  // ORCH-1054 revised ORCH-0953 §3.4: charge.succeeded IS now routed (it carries the
  // application_fee.id needed to fan-out partner splits via Stripe Transfer). Only
  // charge.failed and payment_intent.processing remain unsubscribed.
  assertEquals(routed.has("charge.succeeded"), true);
  assertEquals(routed.has("charge.failed"), false);
  assertEquals(routed.has("payment_intent.processing"), false);
});

Deno.test("ORCH-0953 §3.3 — dispute lifecycle events are routed", () => {
  const routed = new Set<string>(STRIPE_ROUTED_EVENT_TYPES);
  assert(routed.has("charge.dispute.created"));
  assert(routed.has("charge.dispute.updated"));
  assert(routed.has("charge.dispute.closed"));
});
