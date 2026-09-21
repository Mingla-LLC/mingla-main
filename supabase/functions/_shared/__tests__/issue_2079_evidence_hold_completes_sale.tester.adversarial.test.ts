// #2079 — ADVERSARIAL guard on the evidence-hold release, from the opposite
// angle to the implementor suite: not "does a proven payment complete the
// sale", but "can anything make us complete a sale, or lose a refund, on
// evidence we do not actually have".
//
// Every case below asserts a NEGATIVE: zero release calls, or a throw. The
// money rule is that a sale completes only on evidence the payment is
// genuinely captured, and that a refund obligation is never deleted twice,
// never deleted for an already-reversed payment, and never deleted because a
// provider figure was missing or ambiguous.
//
// Covered: duplicate webhook delivery, a charge that arrives late, a hold that
// never verifies, an already-refunded session, an unusable provider amount, a
// Paystack transaction with no id, a transaction the provider will not call
// successful, and a release RPC that errors.

import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { releaseTicketEvidenceHold } from "../ticketEvidenceHold.ts";
import { routeStripeEvent } from "../stripeWebhookRouter.ts";
import { handlePaystackChargeSuccess } from "../paystackWebhookRouter.ts";

const RELEASE_RPC = "release_ticket_checkout_evidence_hold";
const VERIFY_RPC = "issue_2079_verify_ticket_paid_identity";
const FINALIZE_RPC = "biz_ticket_checkout_finalize";

type Row = Record<string, unknown>;

class FakeDb {
  rpcs: Array<{ fn: string; args: Row }> = [];
  session: Row | null;
  releaseOutcome: Row = { outcome: "released", refundsReleased: 1 };
  releaseError: { message: string } | null = null;
  /** Set when the release is answered `released`: the row is back in flight. */
  releasedSessions: string[] = [];

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
      if (this.releaseError) {
        return Promise.resolve({ data: null, error: this.releaseError });
      }
      if (this.releaseOutcome.outcome === "released") {
        this.releasedSessions.push(String(args.p_checkout_session_id));
        // The real owner puts the row back in flight, so a duplicate delivery
        // no longer sees a hold.
        if (this.session) {
          this.session = { ...this.session, reversal_state: "none" };
        }
      }
      return Promise.resolve({ data: this.releaseOutcome, error: null });
    }
    if (fn === VERIFY_RPC) {
      const charge = typeof args.p_stripe_charge_id === "string"
        ? args.p_stripe_charge_id
        : "";
      // Mirrors the live RPC: no charge id is never a verified Stripe payment.
      return Promise.resolve({
        data: { outcome: /^ch_[A-Za-z0-9]+$/.test(charge) ? "verified" : "attention" },
        error: null,
      });
    }
    if (fn === FINALIZE_RPC) {
      if (this.session) {
        this.session = { ...this.session, order_id: "order_2079" };
      }
      return Promise.resolve({
        data: { outcome: "finalized", orderId: "order_2079" },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }

  count(fn: string): number {
    return this.rpcs.filter((c) => c.fn === fn).length;
  }
}

function heldStripeSession(over: Row = {}): Row {
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
    ...over,
  };
}

function succeededEvent(object: Row) {
  return {
    id: "evt_1",
    account: "acct_1",
    type: "payment_intent.succeeded",
    data: { object },
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

Deno.test("#2079 ADV duplicate webhook delivery releases once, never twice", async () => {
  const db = new FakeDb(heldStripeSession());
  const pi = {
    id: "pi_held",
    latest_charge: "ch_held",
    amount_received: 1000,
    currency: "usd",
    payment_method_types: ["card"],
  };
  await withStubbedEnv(async () => {
    await routeStripeEvent(db as never, {} as never, succeededEvent(pi) as never);
    // Stripe redelivers the SAME event. The session now has its order.
    await routeStripeEvent(db as never, {} as never, succeededEvent(pi) as never);
  });
  assertEquals(
    db.count(RELEASE_RPC),
    1,
    "a redelivered event must not ask the release owner a second time",
  );
  assertEquals(db.releasedSessions, ["sess_held"]);
});

Deno.test("#2079 ADV a webhook with no charge id never releases the hold", async () => {
  const db = new FakeDb(heldStripeSession());
  await withStubbedEnv(() =>
    routeStripeEvent(
      db as never,
      {} as never,
      succeededEvent({
        id: "pi_held",
        amount_received: 1000,
        currency: "usd",
        payment_method_types: ["card"],
      }) as never,
    )
  );
  assertEquals(
    db.count(RELEASE_RPC),
    0,
    "a sale must never complete on a missing charge",
  );
  assertEquals(db.count(FINALIZE_RPC), 0, "an unverified payment is never finalized");
  assert(db.count(VERIFY_RPC) > 0, "the ordinary hold path must still run");
});

Deno.test("#2079 ADV a late charge releases only on the delivery that carries it", async () => {
  const db = new FakeDb(heldStripeSession());
  await withStubbedEnv(async () => {
    await routeStripeEvent(
      db as never,
      {} as never,
      succeededEvent({
        id: "pi_held",
        amount_received: 1000,
        currency: "usd",
        payment_method_types: ["card"],
      }) as never,
    );
    assertEquals(db.count(RELEASE_RPC), 0);
    await routeStripeEvent(
      db as never,
      {} as never,
      succeededEvent({
        id: "pi_held",
        latest_charge: { id: "ch_late" },
        amount_received: 1000,
        currency: "usd",
        payment_method_types: ["card"],
      }) as never,
    );
  });
  assertEquals(db.count(RELEASE_RPC), 1);
  const release = db.rpcs.find((c) => c.fn === RELEASE_RPC);
  assertEquals(release?.args.p_stripe_charge_id, "ch_late");
});

Deno.test("#2079 ADV a hold the owner refuses to lift still ends at the refund", async () => {
  const db = new FakeDb(heldStripeSession());
  db.releaseOutcome = { outcome: "refund_kept", reason: "sale_unavailable" };
  await withStubbedEnv(() =>
    routeStripeEvent(
      db as never,
      {} as never,
      succeededEvent({
        id: "pi_held",
        latest_charge: "ch_held",
        amount_received: 1000,
        currency: "usd",
        payment_method_types: ["card"],
      }) as never,
    )
  );
  assertEquals(db.count(RELEASE_RPC), 1);
  assertEquals(db.releasedSessions, [], "a kept refund must not mark a release");
  // The ordinary path still runs: the refund the owner kept is the outcome.
  assert(db.count(VERIFY_RPC) > 0);
});

Deno.test("#2079 ADV an already-refunded session is never re-opened", async () => {
  for (const reversal of ["paid_reversed", "none"]) {
    const db = new FakeDb(heldStripeSession({ reversal_state: reversal }));
    await withStubbedEnv(() =>
      routeStripeEvent(
        db as never,
        {} as never,
        succeededEvent({
          id: "pi_held",
          latest_charge: "ch_held",
          amount_received: 1000,
          currency: "usd",
          payment_method_types: ["card"],
        }) as never,
      )
    );
    assertEquals(
      db.count(RELEASE_RPC),
      0,
      `reversal_state=${reversal} must never reach the release owner`,
    );
  }
});

Deno.test("#2079 ADV an unusable provider amount never releases the hold", async () => {
  for (
    const pi of [
      { id: "pi_held", latest_charge: "ch_held", currency: "usd" },
      { id: "pi_held", latest_charge: "ch_held", amount_received: 1000 },
      {
        id: "pi_held",
        latest_charge: "ch_held",
        amount_received: "1000",
        currency: "usd",
      },
    ]
  ) {
    const db = new FakeDb(heldStripeSession());
    await withStubbedEnv(() =>
      routeStripeEvent(
        db as never,
        {} as never,
        succeededEvent({ ...pi, payment_method_types: ["card"] }) as never,
      )
    );
    assertEquals(
      db.count(RELEASE_RPC),
      0,
      "a sale must never complete on an amount we cannot read",
    );
  }
});

Deno.test("#2079 ADV Paystack: no transaction id, and no successful verify, never release", async () => {
  const held = {
    id: "sess_ng",
    status: "failed",
    order_id: null,
    total_cents: 1000,
    currency: "NGN",
    reversal_state: "paid_reversal_pending",
  };

  const noId = new FakeDb({ ...held });
  await withStubbedEnv(() =>
    handlePaystackChargeSuccess(noId as never, { reference: "mingla_ng" }, () =>
      Promise.resolve({
        status: "success",
        amount: 1000,
        currency: "NGN",
        channel: "card",
      }))
  );
  assertEquals(noId.count(RELEASE_RPC), 0, "no transaction id is not evidence");

  const notSuccess = new FakeDb({ ...held });
  const result = await withStubbedEnv(() =>
    handlePaystackChargeSuccess(notSuccess as never, { reference: "mingla_ng" }, () =>
      Promise.resolve({
        status: "abandoned",
        id: 4200099,
        amount: 1000,
        currency: "NGN",
      }))
  );
  assertEquals(result.status, "verify_not_success");
  assertEquals(notSuccess.count(RELEASE_RPC), 0);
  assertEquals(notSuccess.count(FINALIZE_RPC), 0);

  const wrongAmount = new FakeDb({ ...held });
  await withStubbedEnv(() =>
    handlePaystackChargeSuccess(wrongAmount as never, { reference: "mingla_ng" }, () =>
      Promise.resolve({
        status: "success",
        id: 4200099,
        amount: 999,
        currency: "NGN",
      }))
  );
  assertEquals(
    wrongAmount.count(RELEASE_RPC),
    0,
    "a mismatched amount must never reach the release owner",
  );
});

Deno.test("#2079 ADV a failing release RPC throws; it is never read as released", async () => {
  const db = new FakeDb(null);
  db.releaseError = { message: "deadlock detected" };
  await assertRejects(
    () =>
      releaseTicketEvidenceHold(db as never, {
        checkoutSessionId: "sess_held",
        provider: "stripe",
        paymentReference: "pi_held",
        paystackTransactionId: null,
        stripeChargeId: "ch_held",
        observedAccountReference: "acct_1",
        amountCents: 1000,
        currency: "USD",
      }),
    Error,
    "ticket evidence hold release failed",
  );

  // An unknown answer is treated as "still held", never as a release.
  const unknown = new FakeDb(null);
  unknown.releaseOutcome = { outcome: "something_new" };
  assertEquals(
    await releaseTicketEvidenceHold(unknown as never, {
      checkoutSessionId: "sess_held",
      provider: "stripe",
      paymentReference: "pi_held",
      paystackTransactionId: null,
      stripeChargeId: "ch_held",
      observedAccountReference: "acct_1",
      amountCents: 1000,
      currency: "USD",
    }),
    { outcome: "not_held" },
  );

  // The buyer's confirm refuses to continue rather than guess.
  const confirm = Deno.readTextFileSync(
    "supabase/functions/ticket-checkout-confirm/index.ts",
  );
  const release = confirm.indexOf("releaseTicketEvidenceHold(");
  const failure = confirm.indexOf('"paid_identity_capture_failed"', release);
  const verify = confirm.indexOf(`"${VERIFY_RPC}"`, release);
  assert(release >= 0 && failure > release && failure < verify);
});

Deno.test("#2079 ADV the release owner cannot cancel a refund anything has touched", () => {
  const migration = Deno.readTextFileSync(
    "supabase/migrations/20270711130000_ticket_evidence_hold_completes_sale.sql",
  );
  // #1221's money ledger is append-only. The release must RETIRE the obligation
  // in place and must never delete a refund or one of its ledger allocations —
  // the trigger would refuse it anyway (`append_only`), and the FK is
  // ON DELETE RESTRICT, so a delete is a red CI job, not a silent bug.
  assert(
    !/\bDELETE\s+FROM\s+public\.source_refund/i.test(migration),
    "the release deletes a refund or a ledger allocation; #1221's ledger is append-only",
  );
  const loop = migration.indexOf("FOR v_refund IN");
  const retire = migration.indexOf(
    "UPDATE public.source_refunds SET\n    financial_state='reconciled'",
    loop,
  );
  assert(loop >= 0 && retire > loop, "refunds are retired before they are checked");
  const guards = migration.slice(loop, retire);
  for (
    const guard of [
      "v_refund.provider_refund_id IS NOT NULL",
      "v_refund.buyer_refund_processed_cents<>0",
      "v_refund.fee_reversal_processed_cents<>0",
      "v_refund.active_buyer_attempt_no<>0",
      "public.source_refund_attempts",
      "public.source_refund_events",
      "public.source_refund_notification_deliveries",
      "public.payment_webhook_events",
      "public.source_refund_ledger_allocations",
      "v_refund.lease_owner IS NOT NULL",
    ]
  ) {
    assert(guards.includes(guard), `missing refund guard: ${guard}`);
  }
  assert(
    guards.includes("'refund_in_progress'"),
    "a touched refund must be kept, not released",
  );
  // The retirement itself is terminal for the worker and honest about money.
  const retirement = migration.slice(retire, retire + 800);
  for (
    const field of [
      "financial_state='reconciled'",
      "ops_status='resolved'",
      "last_error_code='sale_completed_no_refund_due'",
      "lease_owner=NULL",
      "next_retry_at=NULL",
      "attention_expires_at=NULL",
    ]
  ) {
    assert(retirement.includes(field), `retirement missing ${field}`);
  }
  // The whole retirement statement, not a fixed window: it now carries the
  // cancelled leg states and the provider identity as well.
  const retireEnd = migration.indexOf("WHERE id=ANY(v_refund_ids);", retire);
  assert(retireEnd > retire, "the retirement never ends");
  const retireStmt = migration.slice(retire, retireEnd);
  // CANCELLED, NOT PAID. #1221 has no state that means "closed, nothing owed",
  // so one was added; without it `financial_state='reconciled'` beside a leg
  // that is still 'needs_attention' / 'queued' is a row source_refunds refuses
  // outright, and the release cannot complete at all.
  for (
    const field of [
      "buyer_state='cancelled_no_refund_due'",
      "fee_state=CASE WHEN fee_reversal_required_cents=0",
      "THEN 'not_required' ELSE 'cancelled_no_reversal_due' END",
    ]
  ) {
    assert(retireStmt.includes(field), `retirement missing ${field}`);
  }
  // The fee leg is derived from the money owed, never copied from whatever the
  // leg happened to say: #1221 requires (fee_state = 'not_required') =
  // (fee_reversal_required_cents = 0), so a checkout with no platform fee must
  // keep 'not_required'.
  assert(
    !/fee_state='cancelled_no_reversal_due'[,\n]/.test(retireStmt),
    "the fee leg is cancelled unconditionally; a zero-fee refund must stay not_required",
  );
  // The provider identity this hold was MISSING is recorded, or the retired row
  // is a ticket late refund out of 'needs_attention' that still cannot name its
  // charge — which source_refunds_issue_2079_execution_ready refuses — and the
  // reopen can no longer recognise its own retirement.
  for (
    const field of [
      "paystack_transaction_id=CASE WHEN refund_kind='late_payment_no_value'",
      "stripe_charge_id=CASE WHEN refund_kind='late_payment_no_value'",
      "COALESCE(paystack_transaction_id,v_paystack_id)",
      "COALESCE(stripe_charge_id,p_stripe_charge_id)",
    ]
  ) {
    assert(retireStmt.includes(field), `retirement missing ${field}`);
  }
  // It must never claim money moved. Scoped to the release function body: the
  // migration's CHECK constraints legitimately quote 'processed' when they say
  // what a reconciled refund is allowed to be.
  const releaseStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.release_ticket_checkout_evidence_hold(",
  );
  const releaseEnd = migration.indexOf("END $$;", releaseStart);
  assert(releaseStart >= 0 && releaseEnd > releaseStart, "the release owner is gone");
  const releaseBody = migration.slice(releaseStart, releaseEnd);
  assert(!/buyer_state\s*=\s*'processed'/.test(releaseBody));
  assert(!/fee_state\s*=\s*'processed'/.test(releaseBody));
  assert(!/buyer_refund_processed_cents\s*=\s*[1-9]/.test(migration));
  assert(!/provider_refund_id\s*=\s*'/.test(migration));
  // And the widened invariant is re-added AT LEAST AS STRICT: the cancelled
  // pairing is admissible only with nothing processed on either leg and no
  // provider refund identity, and a cancelled leg is pinned to a terminal
  // financial_state so no stray recompute can silently re-open it.
  for (
    const clause of [
      "ADD CONSTRAINT source_refunds_issue_2079_reconciled_settlement",
      "OR (\n      buyer_state = 'processed'\n      AND fee_state = ANY (ARRAY['processed','not_required'])\n    )",
      "AND buyer_refund_processed_cents = 0",
      "AND fee_reversal_processed_cents = 0",
      "ADD CONSTRAINT source_refunds_issue_2079_cancelled_legs_moved_no_money",
      "AND financial_state = 'reconciled'",
    ]
  ) {
    assert(migration.includes(clause), `reconciled invariant missing ${clause}`);
  }
  // And it appends #1221's own compensating record rather than rewriting one.
  assert(migration.includes("INSERT INTO public.source_refund_events("));
  assert(migration.includes("'ops_resolved'"));
  assert(migration.includes("'sale_completed_no_refund_due'"));
  // The revocation rows land in a state the claim RPC never re-claims, so no
  // worker can neutralize a sale that has completed.
  assert(migration.includes("state='sale_completed'"));
  assert(
    !/issue_1930_claim_revocations[\s\S]{0,400}sale_completed/.test(migration),
    "sale_completed must not be made claimable",
  );
  // And the #2168 handoff refuses to open a second refund for owned money.
  assert(migration.includes("RETURN 'already_owned';"));
});

// A release hands the session back for a finalize that may still fail. Two
// things must survive that window or a buyer who has paid is left with nothing
// and nobody looking: the session must re-hold its seat, and the retirement
// must be undone if the sale does not complete. Delete either and a paid buyer
// can be stranded silently and permanently.
Deno.test("#2079 ADV a release that does not end in a sale still owes the buyer", () => {
  const migration = Deno.readTextFileSync(
    "supabase/migrations/20270711130000_ticket_evidence_hold_completes_sale.sql",
  );
  assert(
    migration.includes(
      "expires_at=now()+GREATEST(v_session.expires_at-v_session.created_at,interval '0')",
    ),
    "a released session does not re-hold its inventory, so its seat can be sold to someone else",
  );
  const reopen = migration.indexOf("'sale_not_completed_after_release'");
  assert(reopen >= 0, "a retired obligation is never re-opened when the sale fails");
  assert(migration.includes("'outcome','reopened'"));
  // The re-open must restore a real, claimable obligation — not a cosmetic flag.
  const window = migration.slice(Math.max(0, reopen - 1500), reopen + 1500);
  for (
    const token of [
      "v_existing.financial_state='reconciled'",
      "v_existing.last_error_code='sale_completed_no_refund_due'",
      "v_existing.buyer_refund_processed_cents=0",
      "v_existing.provider_refund_id IS NULL",
      "buyer_state='queued'",
      "financial_state='pending'",
      // The obligation is only half re-opened if the fee leg stays cancelled:
      // a reversal nobody performs, sitting on a refund that does pay.
      "fee_state=CASE WHEN fee_reversal_required_cents=0",
      // And only the release's own retirement may be re-opened. The leg state
      // is the non-forgeable half of that marker.
      "v_existing.buyer_state='cancelled_no_refund_due'",
    ]
  ) {
    assert(window.includes(token), `reopen missing ${token}`);
  }
  // It must only re-open its own retirement, on matching provider identity.
  assert(window.includes("v_existing.provider=p_provider"));
  assert(
    window.includes("v_existing.provider_payment_reference=p_payment_reference"),
  );
  // And it must HARD-FAIL the session. The release left it in flight with a
  // live expires_at; reconcile-stuck-checkouts batches exactly those statuses,
  // so a session left live is finalized into a real ticket once the sale
  // recovers — while this refund also pays. Nothing cancels a refund on mint.
  const upTo = migration.slice(reopen, migration.indexOf("'outcome','reopened'", reopen));
  assert(
    upTo.includes(
      "UPDATE public.ticket_checkout_sessions SET reversal_state='paid_reversal_pending',",
    ) && upTo.includes("status='failed'") &&
      upTo.includes("WHERE id=v_session.id AND order_id IS NULL"),
    "a reopened obligation leaves its session finalizable — the buyer can keep the ticket and the refund",
  );
  // The audit key must be unique per reopen, not second-granularity.
  assert(
    !/evidence-hold-reopened:[\s\S]{0,160}extract\(epoch/.test(migration),
    "two reopens in the same second silently drop one audit record",
  );
});
