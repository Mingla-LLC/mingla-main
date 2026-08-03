import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  handleStayPaystackChargeSuccess,
  handleStayStripeDispute,
  handleStayStripePaymentEvent,
  isStayPaystackCharge,
  isStayStripePaymentEvent,
} from "./stayPaymentWebhook.ts";

Deno.test("Stripe Stay success finalizes only the typed Stay attempt", async () => {
  let rpc: { name: string; params: Record<string, unknown> } | null = null;
  const event = {
    id: "evt_stay",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_stay",
        amount_received: 30000,
        currency: "usd",
        latest_charge: "ch_stay",
        metadata: {
          mingla_purpose: "stay_reservation",
          stay_group_id: "00000000-1389-4000-8000-000000000301",
          stay_payment_attempt_id:
            "00000000-1389-4000-8000-000000000302",
        },
      },
    },
  };
  assertEquals(isStayStripePaymentEvent(event), true);
  await handleStayStripePaymentEvent({
    rpc: (name: string, params: Record<string, unknown>) => {
      rpc = { name, params };
      return Promise.resolve({ data: {}, error: null });
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
      }),
    }),
  }, event);
  assertObjectMatch(rpc ?? {}, {
    name: "issue_1389_finalize_payment",
    params: {
      p_provider: "stripe",
      p_provider_payment_ref: "pi_stay",
      p_provider_charge_ref: "ch_stay",
      p_amount_minor: 30000,
      p_currency_code: "USD",
    },
  });
});

Deno.test("Stripe Stay dispute is contained by the typed Stay dispute RPC", async () => {
  let rpcParams: Record<string, unknown> | null = null;
  const brandId = await handleStayStripeDispute({
    rpc: (_name: string, params: Record<string, unknown>) => {
      rpcParams = params;
      return Promise.resolve({
        data: { matched: true, brandId: "brand-stay" },
        error: null,
      });
    },
  }, {
    id: "evt_dispute_stay",
    type: "charge.dispute.created",
    data: {
      object: {
        id: "dp_stay",
        charge: "ch_stay",
        amount: 30000,
        currency: "usd",
        status: "needs_response",
      },
    },
  });
  assertEquals(brandId, "brand-stay");
  assertObjectMatch(rpcParams ?? {}, {
    p_provider_charge_ref: "ch_stay",
    p_dispute_ref: "dp_stay",
    p_amount_minor: 30000,
    p_currency_code: "USD",
  });
});

Deno.test("Paystack Stay charge is reverified before finalization", async () => {
  let rpcParams: Record<string, unknown> | null = null;
  const data = {
    reference: "mingla_stay_abc",
    metadata: { mingla_purpose: "stay_reservation" },
  };
  assertEquals(isStayPaystackCharge(data), true);
  await handleStayPaystackChargeSuccess({
    rpc: (_name: string, params: Record<string, unknown>) => {
      rpcParams = params;
      return Promise.resolve({ data: {}, error: null });
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }),
      }),
    }),
  }, data, "paystack:digest", () =>
    Promise.resolve({
      id: 99,
      reference: "mingla_stay_abc",
      status: "success",
      amount: 45000,
      fees: 800,
      currency: "NGN",
      metadata: {
        mingla_purpose: "stay_reservation",
        stay_group_id: "00000000-1389-4000-8000-000000000311",
      },
    }));
  assertObjectMatch(rpcParams ?? {}, {
    p_provider: "paystack",
    p_provider_event_id: "paystack:digest",
    p_amount_minor: 45000,
    p_provider_fee_minor: 800,
    p_currency_code: "NGN",
  });
});
