// #2079 — a paid ticket held only because our own first signal lacked a piece
// of evidence completes the sale once complete evidence arrives.
//
// IMPLEMENTOR happy path. Proves the release owner is asked BEFORE the
// ordinary verify + finalize, with the provider's own figures, and that each
// identity lands in its own slot (the original #2079 bug was the Paystack
// numeric transaction id being written into the reference slot).
//
// Delete the release call from either router and the ordering tests below
// fail; swap the two Paystack identity slots and the slot test fails.

import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  isEvidenceHoldCandidate,
  releaseTicketEvidenceHold,
  stripePaymentIntentAmount,
} from "../ticketEvidenceHold.ts";
import { routeStripeEvent } from "../stripeWebhookRouter.ts";
import { handlePaystackChargeSuccess } from "../paystackWebhookRouter.ts";

const RELEASE_RPC = "release_ticket_checkout_evidence_hold";
const VERIFY_RPC = "issue_2079_verify_ticket_paid_identity";
const FINALIZE_RPC = "biz_ticket_checkout_finalize";

type Row = Record<string, unknown>;

/** A Supabase stand-in with just the surface these two routers touch. */
class FakeDb {
  rpcs: Array<{ fn: string; args: Row }> = [];
  session: Row | null;
  releaseOutcome: Row = { outcome: "released", refundsReleased: 1 };

  constructor(session: Row | null) {
    this.session = session;
  }

  from(table: string) {
    // deno-lint-ignore no-explicit-any
    const self = this as any;
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      in: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => Promise.resolve({ data: [], error: null }),
      update: () => builder,
      insert: () => Promise.resolve({ error: null }),
      upsert: () => Promise.resolve({ error: null }),
      maybeSingle: () =>
        Promise.resolve({
          data: table === "ticket_checkout_sessions" ? self.session : null,
          error: null,
        }),
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    };
    return builder;
  }

  rpc(fn: string, args: Row) {
    this.rpcs.push({ fn, args });
    if (fn === RELEASE_RPC) {
      return Promise.resolve({ data: this.releaseOutcome, error: null });
    }
    if (fn === VERIFY_RPC) {
      return Promise.resolve({ data: { outcome: "verified" }, error: null });
    }
    if (fn === FINALIZE_RPC) {
      return Promise.resolve({
        data: { outcome: "finalized", orderId: "order_2079" },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }
}

function heldStripeSession(): Row {
  return {
    id: "sess_held",
    brand_id: "brand_1",
    event_id: "event_1",
    order_id: null,
    tax_amount_cents: 0,
    tax_calculation_id: null,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: "pi_held",
    stripe_account_id: "acct_1",
    provider_flow: "stripe_native",
    reversal_state: "paid_reversal_pending",
  };
}

function withStubbedEnv<T>(run: () => Promise<T>): Promise<T> {
  const priorPepper = Deno.env.get("app.qr_token_pepper");
  const priorUrl = Deno.env.get("SUPABASE_URL");
  const priorKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const priorFetch = globalThis.fetch;
  Deno.env.set("app.qr_token_pepper", "12345678901234567890123456789012");
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  globalThis.fetch = (() =>
    Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
  const restore = () => {
    globalThis.fetch = priorFetch;
    if (priorPepper === undefined) Deno.env.delete("app.qr_token_pepper");
    else Deno.env.set("app.qr_token_pepper", priorPepper);
    if (priorUrl !== undefined) Deno.env.set("SUPABASE_URL", priorUrl);
    if (priorKey !== undefined) {
      Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", priorKey);
    }
  };
  return run().finally(restore);
}

Deno.test("#2079 a held session is a release candidate; a sold or reversed one is not", () => {
  assert(isEvidenceHoldCandidate(heldStripeSession()));
  assert(
    !isEvidenceHoldCandidate({
      ...heldStripeSession(),
      order_id: "order_1",
    }),
    "a session that already has an order is never a hold",
  );
  assert(
    !isEvidenceHoldCandidate({
      ...heldStripeSession(),
      reversal_state: "paid_reversed",
    }),
    "an already-refunded session is never a hold",
  );
  assert(!isEvidenceHoldCandidate({ ...heldStripeSession(), reversal_state: "none" }));
  assert(!isEvidenceHoldCandidate(null));
});

Deno.test("#2079 the provider's own figures come from amount_received, never a guess", () => {
  assertEquals(
    stripePaymentIntentAmount({ amount_received: 1000, amount: 1500, currency: "usd" }),
    { amountCents: 1000, currency: "USD" },
  );
  assertEquals(
    stripePaymentIntentAmount({ amount: 1500, currency: "ngn" }),
    { amountCents: 1500, currency: "NGN" },
  );
  assertEquals(stripePaymentIntentAmount({ currency: "usd" }), null);
  assertEquals(stripePaymentIntentAmount({ amount_received: 1000 }), null);
  assertEquals(
    stripePaymentIntentAmount({ amount_received: 1000, currency: "dollars" }),
    null,
  );
  assertEquals(
    stripePaymentIntentAmount({ amount_received: 10.5, currency: "usd" }),
    null,
  );
});

Deno.test("#2079 the release owner receives every identity in its own slot", async () => {
  const db = new FakeDb(null);
  const outcome = await releaseTicketEvidenceHold(db as never, {
    checkoutSessionId: "sess_held",
    provider: "paystack",
    paymentReference: "mingla_ref_abc",
    paystackTransactionId: "4200099",
    stripeChargeId: null,
    observedAccountReference: null,
    amountCents: 1000,
    currency: "NGN",
  });
  assertEquals(outcome, { outcome: "released", refundsReleased: 1 });
  assertEquals(db.rpcs.length, 1);
  assertEquals(db.rpcs[0].fn, RELEASE_RPC);
  assertEquals(db.rpcs[0].args, {
    p_checkout_session_id: "sess_held",
    p_provider: "paystack",
    // The immutable merchant reference, NEVER the numeric transaction id.
    p_payment_reference: "mingla_ref_abc",
    p_paystack_transaction_id: "4200099",
    p_stripe_charge_id: null,
    p_observed_account_reference: null,
    p_amount_cents: 1000,
    p_currency: "NGN",
  });
});

Deno.test("#2079 Stripe: the hold is released before verify and finalize", async () => {
  const db = new FakeDb(heldStripeSession());
  await withStubbedEnv(() =>
    routeStripeEvent(db as never, {} as never, {
      id: "evt_1",
      account: "acct_1",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_held",
          latest_charge: "ch_held",
          amount_received: 1000,
          currency: "usd",
          payment_method_types: ["card"],
        },
      },
    } as never)
  );
  const order = db.rpcs.map((c) => c.fn);
  const release = order.indexOf(RELEASE_RPC);
  const verify = order.indexOf(VERIFY_RPC);
  const finalize = order.indexOf(FINALIZE_RPC);
  assert(release >= 0, "the webhook never asked the release owner");
  assert(verify > release, "verify must run after the release");
  assert(finalize > verify, "finalize must run after verify");
  assertEquals(db.rpcs[release].args, {
    p_checkout_session_id: "sess_held",
    p_provider: "stripe",
    p_payment_reference: "pi_held",
    p_paystack_transaction_id: null,
    p_stripe_charge_id: "ch_held",
    p_observed_account_reference: "acct_1",
    p_amount_cents: 1000,
    p_currency: "USD",
  });
});

Deno.test("#2079 Paystack: the verified transaction releases the hold before finalize", async () => {
  const db = new FakeDb({
    id: "sess_ng",
    status: "failed",
    order_id: null,
    total_cents: 1000,
    currency: "NGN",
    reversal_state: "paid_reversal_pending",
  });
  const result = await withStubbedEnv(() =>
    handlePaystackChargeSuccess(
      db as never,
      { reference: "mingla_ng_ref" },
      () =>
        Promise.resolve({
          status: "success",
          id: 4200099,
          amount: 1000,
          currency: "NGN",
          channel: "card",
          reference: "mingla_ng_ref",
        }),
    )
  );
  assertEquals(result.status, "finalized");
  const order = db.rpcs.map((c) => c.fn);
  const release = order.indexOf(RELEASE_RPC);
  const finalize = order.indexOf(FINALIZE_RPC);
  assert(release >= 0, "the Paystack handler never asked the release owner");
  assert(finalize > release, "finalize must run after the release");
  assertEquals(db.rpcs[release].args.p_payment_reference, "mingla_ng_ref");
  assertEquals(db.rpcs[release].args.p_paystack_transaction_id, "4200099");
  assertEquals(db.rpcs[release].args.p_stripe_charge_id, null);
  assertEquals(db.rpcs[release].args.p_amount_cents, 1000);
  assertEquals(db.rpcs[release].args.p_currency, "NGN");
});

Deno.test("#2079 the buyer's own confirm and the sweep both ask the release owner first", () => {
  const confirm = Deno.readTextFileSync(
    "supabase/functions/ticket-checkout-confirm/index.ts",
  );
  const sweep = Deno.readTextFileSync(
    "supabase/functions/reconcile-stuck-checkouts/index.ts",
  );
  for (const [name, source] of [["confirm", confirm], ["sweep", sweep]]) {
    const release = source.indexOf("releaseTicketEvidenceHold(");
    assert(release >= 0, `${name} never calls the release owner`);
  }
  const confirmVerify = confirm.indexOf(`"${VERIFY_RPC}"`);
  const confirmRelease = confirm.indexOf("releaseTicketEvidenceHold(");
  assert(
    confirmRelease < confirmVerify,
    "confirm must release the hold before it verifies paid identity",
  );
  // The sweep only ever READS Stripe for a hold: a release is preceded by a
  // succeeded check, never by a mutating provider call.
  assert(sweep.includes('pi.status !== "succeeded"'));
  assert(sweep.includes("retrievePaymentIntentReadOnly("));
});

Deno.test("#2079 the release owner is service-role only and evidence-only by contract", () => {
  const migration = Deno.readTextFileSync(
    "supabase/migrations/20270711130000_ticket_evidence_hold_completes_sale.sql",
  );
  assert(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.release_ticket_checkout_evidence_hold(",
    ),
  );
  assert(migration.includes("GRANT EXECUTE ON FUNCTION public.release_ticket_checkout_evidence_hold("));
  assert(migration.includes("IF current_user NOT IN ('postgres','service_role') THEN"));
  // Only a hold whose EVERY revocation row names a missing-evidence reason may
  // be lifted. A genuine late payment after sale closure is never touched.
  assert(migration.includes("bool_and(o.reason=ANY(v_evidence_reasons))"));
  for (
    const reason of [
      "paid_provider_charge_missing",
      "paid_provider_transaction_id_invalid",
      "paid_provider_attempt_missing",
      "paid_provider_reference_missing",
    ]
  ) {
    assert(migration.includes(reason), `evidence reason ${reason} missing`);
  }
});
