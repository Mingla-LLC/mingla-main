import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { STRIPE_ROUTED_EVENT_TYPES } from "../stripeWebhookRouter.ts";

Deno.test("ORCH-0953 §3.4 — noisy live-cutover events are not routed", () => {
  const routed = new Set<string>(STRIPE_ROUTED_EVENT_TYPES);
  assertEquals(routed.has("charge.succeeded"), false);
  assertEquals(routed.has("charge.failed"), false);
  assertEquals(routed.has("payment_intent.processing"), false);
});

Deno.test("ORCH-0953 §3.3 — dispute lifecycle events are routed", () => {
  const routed = new Set<string>(STRIPE_ROUTED_EVENT_TYPES);
  assert(routed.has("charge.dispute.created"));
  assert(routed.has("charge.dispute.updated"));
  assert(routed.has("charge.dispute.closed"));
});
