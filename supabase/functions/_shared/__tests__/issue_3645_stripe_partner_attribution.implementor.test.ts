// Issue #3645 — Stripe payout partner attribution is recorded from
// application_fee.created.
//
// Production proof (read-only): for our direct charges, charge.succeeded
// carries `application_fee: null` (only `application_fee_amount`) and lands
// about a second before the ticket order exists, so no Stripe order ever got a
// payout_partner_attributions row and the payout sweep stopped with 409
// partner_attribution_pending. The fee id first appears in
// application_fee.created, seconds later.
//
// Covers:
//   1. charge.succeeded (application_fee: null) then application_fee.created
//      → exactly one record_payout_partner_outcome call with the fee id,
//      charge.created as the sale time, the fee amount and currency, and the
//      partner resolved at charge time. A replay of the fee event stays one
//      row.
//   2. application_fee.created before the order exists → retryable failure
//      (endpoint answers 503 so Stripe redelivers) → after the order lands the
//      redelivery records exactly one outcome.
//   3. A non-ticket fee (installment charge) never waits and never writes.
//   4. A pre-cutover brand is left to the legacy path (no write).
//
// Run: deno test --allow-read --allow-env \
//   supabase/functions/_shared/__tests__/issue_3645_stripe_partner_attribution.implementor.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { routeStripeEvent } from "../stripeWebhookRouter.ts";
import {
  isStripeWebhookRetryableError,
  StripeWebhookRetryableError,
  stripeWebhookResponseStatus,
} from "../stripeWebhookRetry.ts";

const CHARGE_ID = "ch_3645_attr";
const FEE_ID = "fee_3645_attr";
const ORDER_ID = "36450000-0000-4000-8000-0000000a7001";
const BRAND_ID = "36450000-0000-4000-8000-0000000a7002";
const CHARGE_CREATED = 1_790_003_674;
const CHARGE_CREATED_ISO = new Date(CHARGE_CREATED * 1000).toISOString();

interface Attribution {
  p_key: string;
  p_order_id: string;
  p_brand_id: string;
  p_partner_account_id: string | null;
  p_provider_sale_at: string;
  p_mingla_fee_cents: number;
  p_partner_share_cents: number;
  p_currency: string;
  p_provider: string;
}

interface World {
  orders: Array<{ id: string; stripe_charge_id: string; brand_id: string }>;
  storedEvents: Array<{ type: string; payload: Record<string, unknown> }>;
  cutoverAt: string | null;
  partnerAtSale: string | null;
  attributions: Attribution[];
  outcomeCalls: Attribution[];
}

function world(overrides: Partial<World> = {}): World {
  return {
    orders: [],
    storedEvents: [],
    cutoverAt: "2026-09-12T13:37:50.735Z",
    partnerAtSale: null,
    attributions: [],
    outcomeCalls: [],
    ...overrides,
  };
}

function fakeSupabase(w: World) {
  // deno-lint-ignore no-explicit-any
  const sb: any = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "resolve_partner_for_brand_at_time") {
        assertEquals(args.p_at, CHARGE_CREATED_ISO);
        return Promise.resolve({ data: w.partnerAtSale, error: null });
      }
      if (name === "record_payout_partner_outcome") {
        const a = args as unknown as Attribution;
        w.outcomeCalls.push(a);
        // Mirrors the #1174 writer: one row per order / provider key, an
        // identical replay is a no-op, any drift is rejected.
        const prior = w.attributions.find((r) =>
          r.p_order_id === a.p_order_id || r.p_key === a.p_key
        );
        if (prior) {
          if (JSON.stringify(prior) !== JSON.stringify(a)) {
            return Promise.resolve({
              data: null,
              error: { message: "partner_attribution_replay_mismatch" },
            });
          }
        } else {
          w.attributions.push(a);
        }
        return Promise.resolve({
          data: {
            order_id: a.p_order_id,
            outcome: a.p_partner_account_id ? "partner" : "no_partner",
            held_status: a.p_partner_account_id ? "held" : null,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        upsert: () => Promise.resolve({ error: null }),
        insert: () => Promise.resolve({ error: null }),
        maybeSingle: () => {
          if (table === "orders" && "stripe_charge_id" in filters) {
            const o = w.orders.find((r) =>
              r.stripe_charge_id === filters.stripe_charge_id
            );
            return Promise.resolve({
              data: o ? { id: o.id } : null,
              error: null,
            });
          }
          if (table === "orders" && "id" in filters) {
            const o = w.orders.find((r) => r.id === filters.id);
            return Promise.resolve({
              data: o
                ? { event_id: "evt_row", events: { brand_id: o.brand_id } }
                : null,
              error: null,
            });
          }
          if (table === "payment_webhook_events") {
            const hit = w.storedEvents.find((e) =>
              e.type === filters.type &&
              // deno-lint-ignore no-explicit-any
              (e.payload as any).data.object.id ===
                filters["payload->data->object->>id"]
            );
            return Promise.resolve({
              data: hit ? { payload: hit.payload } : null,
              error: null,
            });
          }
          if (table === "brands") {
            return Promise.resolve({
              data: { payout_hold_cutover_at: w.cutoverAt },
              error: null,
            });
          }
          if (table === "stripe_connect_accounts") {
            return Promise.resolve({
              data: { brand_id: BRAND_ID },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  return sb;
}

const fakeStripe = {} as never;

function chargeSucceeded(metadata: Record<string, string>) {
  return {
    id: "evt_3645_charge",
    type: "charge.succeeded",
    account: "acct_3645",
    data: {
      object: {
        id: CHARGE_ID,
        object: "charge",
        application_fee: null,
        application_fee_amount: 45,
        currency: "usd",
        created: CHARGE_CREATED,
        payment_intent: "pi_3645_attr",
        metadata,
      },
    },
  };
}

const TICKET_METADATA = {
  mingla_event_id: "event-3645",
  mingla_checkout_session_id: "session-3645",
};

function feeCreated() {
  return {
    id: "evt_3645_fee",
    type: "application_fee.created",
    account: "acct_3645",
    data: {
      object: {
        id: FEE_ID,
        object: "application_fee",
        account: "acct_3645",
        amount: 45,
        amount_refunded: 0,
        currency: "usd",
        charge: CHARGE_ID,
        created: CHARGE_CREATED + 4,
        refunded: false,
      },
    },
  };
}

// The endpoint stores every event before routing it.
async function deliver(
  w: World,
  event: ReturnType<typeof chargeSucceeded> | ReturnType<typeof feeCreated>,
) {
  if (!w.storedEvents.some((e) => e.payload.id === event.id)) {
    w.storedEvents.push({
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
    });
  }
  // deno-lint-ignore no-explicit-any
  return await routeStripeEvent(fakeSupabase(w), fakeStripe, event as any);
}

Deno.test("#3645 charge.succeeded (fee null) then application_fee.created records exactly one outcome", async () => {
  const w = world();
  await deliver(w, chargeSucceeded(TICKET_METADATA));
  // The charge event cannot record: no fee id and (in production) no order.
  assertEquals(w.outcomeCalls.length, 0);

  w.orders.push({ id: ORDER_ID, stripe_charge_id: CHARGE_ID, brand_id: BRAND_ID });
  await deliver(w, feeCreated());

  assertEquals(w.attributions.length, 1);
  assertEquals(w.attributions[0], {
    p_key: FEE_ID,
    p_order_id: ORDER_ID,
    p_brand_id: BRAND_ID,
    p_partner_account_id: null,
    p_provider_sale_at: CHARGE_CREATED_ISO,
    p_mingla_fee_cents: 45,
    p_partner_share_cents: 0,
    p_currency: "usd",
    p_provider: "stripe",
  });

  // Stripe replays the fee event: still one row, no mismatch.
  await deliver(w, feeCreated());
  assertEquals(w.attributions.length, 1);
  assertEquals(w.outcomeCalls.length, 2);
});

Deno.test("#3645 a partner linked at charge time gets the 10% held share", async () => {
  const w = world({ partnerAtSale: "partner-3645" });
  await deliver(w, chargeSucceeded(TICKET_METADATA));
  w.orders.push({ id: ORDER_ID, stripe_charge_id: CHARGE_ID, brand_id: BRAND_ID });
  await deliver(w, feeCreated());
  assertEquals(w.attributions.length, 1);
  assertEquals(w.attributions[0].p_partner_account_id, "partner-3645");
  assertEquals(w.attributions[0].p_partner_share_cents, Math.round(45 * 0.1));
});

Deno.test("#3645 application_fee.created before the order exists is retryable, then succeeds on redelivery", async () => {
  const w = world();
  await deliver(w, chargeSucceeded(TICKET_METADATA));

  const err = await assertRejects(
    () => deliver(w, feeCreated()),
    StripeWebhookRetryableError,
    "partner_attribution_order_pending",
  );
  assert(isStripeWebhookRetryableError(err));
  assertEquals(w.outcomeCalls.length, 0);
  // The endpoint asks Stripe to redeliver while attempts remain …
  assertEquals(
    stripeWebhookResponseStatus({
      processingFailed: true,
      retryable: true,
      exhausted: false,
    }),
    503,
  );
  // … and stops once the attempt cap is reached; ordinary failures keep 200.
  assertEquals(
    stripeWebhookResponseStatus({
      processingFailed: true,
      retryable: true,
      exhausted: true,
    }),
    200,
  );
  assertEquals(
    stripeWebhookResponseStatus({
      processingFailed: true,
      retryable: false,
      exhausted: false,
    }),
    200,
  );

  // The order finalizes; Stripe redelivers the same fee event.
  w.orders.push({ id: ORDER_ID, stripe_charge_id: CHARGE_ID, brand_id: BRAND_ID });
  await deliver(w, feeCreated());
  assertEquals(w.attributions.length, 1);
  assertEquals(w.attributions[0].p_key, FEE_ID);
  assertEquals(w.attributions[0].p_provider_sale_at, CHARGE_CREATED_ISO);
});

Deno.test("#3645 a fee whose charge was not stored yet is retryable too", async () => {
  const w = world();
  w.orders.push({ id: ORDER_ID, stripe_charge_id: CHARGE_ID, brand_id: BRAND_ID });
  await assertRejects(
    () => deliver(w, feeCreated()),
    StripeWebhookRetryableError,
    "partner_attribution_charge_evidence_pending",
  );
  assertEquals(w.outcomeCalls.length, 0);
});

Deno.test("#3645 a non-ticket fee (installment charge) neither waits nor writes", async () => {
  const w = world();
  await deliver(
    w,
    chargeSucceeded({
      mingla_installment_id: "inst-3645",
      mingla_order_id: ORDER_ID,
    }),
  );
  await deliver(w, feeCreated());
  assertEquals(w.outcomeCalls.length, 0);
});

Deno.test("#3645 a pre-cutover brand is left untouched", async () => {
  const w = world({ cutoverAt: "2026-12-01T00:00:00.000Z" });
  await deliver(w, chargeSucceeded(TICKET_METADATA));
  w.orders.push({ id: ORDER_ID, stripe_charge_id: CHARGE_ID, brand_id: BRAND_ID });
  await deliver(w, feeCreated());
  assertEquals(w.outcomeCalls.length, 0);
});
