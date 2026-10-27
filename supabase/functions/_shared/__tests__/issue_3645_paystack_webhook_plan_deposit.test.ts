// Issue #3645 — a Paystack payment-plan deposit finalizes as a plan and binds
// its later payments (SC-6..SC-8). Fails on revert: restoring the hard-coded
// p_installment_plan_root:false makes "plan deposit creates instalment rows"
// fail (no plan root, no bind).
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handlePaystackChargeSuccess } from "../paystackWebhookRouter.ts";
import { fakeSupabase, ok, type TableOp } from "../installments/__tests__/issue_3645_fake_supabase.ts";

Deno.env.set("app.qr_token_pepper", "test-pepper-issue-3645-0000000000000000000");

const REF = "mingla_33333333-3333-4333-8333-333333333333";
const SCHEDULE = { fullPriceCents: 1_000_000, depositCents: 250_000, currency: "NGN",
  installments: [{ ordinal: 1, pct: 75, amountCents: 750_000, dueAt: "2027-03-01T12:00:00Z" }] };

function cardTxn(reusable: boolean, channel = "card") {
  return {
    status: "success", amount: 270_625, currency: "NGN", channel, id: 4200001, reference: REF,
    customer: { email: "payer@example.test", customer_code: "CUS_x" },
    authorization: { authorization_code: "AUTH_deposit01", reusable, channel, card_type: "visa", last4: "4081",
      exp_month: "12", exp_year: "2030", bank: "TEST BANK", signature: "SIG_x" },
  };
}

function harness(opts: { orderId?: string | null; unbound?: number; finalizeRoot?: boolean; schedule?: unknown }) {
  const fake = fakeSupabase({
    rpc: (name) => {
      if (name === "biz_ticket_checkout_finalize") {
        return ok({ outcome: "finalized", orderId: "order-1", installmentPlanRoot: opts.finalizeRoot ?? true });
      }
      if (name === "issue_3645_paystack_plan_bind") return ok({ ok: true, bound_count: 1 });
      return ok(null);
    },
    table: (op: TableOp) => {
      if (op.table === "ticket_checkout_sessions" && op.kind === "select") {
        return ok({ id: "sess-1", status: "awaiting_web_redirect", order_id: opts.orderId ?? null, total_cents: 270_625,
          currency: "NGN", reversal_state: null, brand_id: "brand-1", buyer_user_id: null,
          installment_schedule: opts.schedule === undefined ? SCHEDULE : opts.schedule, installment_charge_plan: {} });
      }
      if (op.table === "order_installments") return { data: null, error: null, count: opts.unbound ?? 0 };
      return ok(null);
    },
  });
  return fake;
}

const finalizeArgs = (f: ReturnType<typeof fakeSupabase>) =>
  f.rpcCalls.find((c) => c.name === "biz_ticket_checkout_finalize")?.args;
const bindArgs = (f: ReturnType<typeof fakeSupabase>) =>
  f.rpcCalls.find((c) => c.name === "issue_3645_paystack_plan_bind")?.args;

Deno.test("#3645 SC-6 plan deposit by reusable card: finalized as a plan root and bound with the verified card", async () => {
  const f = harness({});
  const r = await handlePaystackChargeSuccess(f.client as never, { reference: REF }, () => Promise.resolve(cardTxn(true)));
  assertEquals(r.status, "finalized");
  assertEquals(finalizeArgs(f)!.p_installment_plan_root, true);
  const bind = bindArgs(f)!;
  assertEquals(bind.p_order_id, "order-1");
  const auth = bind.p_authorization as Record<string, unknown>;
  assertEquals(auth.reusable, true);
  assertEquals(auth.authorization_email, "payer@example.test");
  assertEquals(auth.authorization_code, "AUTH_deposit01");
  assertEquals(auth.source_reference, REF);
});

Deno.test("#3645 SC-6 the card comes from verify, never from the webhook body", async () => {
  const f = harness({});
  await handlePaystackChargeSuccess(f.client as never,
    { reference: REF, authorization: { authorization_code: "AUTH_forged", reusable: true, channel: "card" } },
    () => Promise.resolve(cardTxn(true)));
  assertEquals((bindArgs(f)!.p_authorization as Record<string, unknown>).authorization_code, "AUTH_deposit01");
});

Deno.test("#3645 SC-7 deposit by bank transfer / non-reusable card: bound without a reusable card", async () => {
  const f = harness({});
  await handlePaystackChargeSuccess(f.client as never, { reference: REF }, () => Promise.resolve(cardTxn(false, "bank_transfer")));
  assertEquals((bindArgs(f)!.p_authorization as Record<string, unknown>).reusable, false);
  const g = harness({});
  const noAuth = { ...cardTxn(true) } as Record<string, unknown>;
  delete noAuth.authorization;
  await handlePaystackChargeSuccess(g.client as never, { reference: REF }, () => Promise.resolve(noAuth));
  assertEquals(bindArgs(g)!.p_authorization, null);
});

Deno.test("#3645 SC-8 replay with everything bound: no finalize, no bind", async () => {
  const f = harness({ orderId: "order-1", unbound: 0 });
  const r = await handlePaystackChargeSuccess(f.client as never, { reference: REF }, () => Promise.resolve(cardTxn(true)));
  assertEquals(r.status, "replayed");
  assertEquals(finalizeArgs(f), undefined);
  assertEquals(bindArgs(f), undefined);
});

Deno.test("#3645 SC-8 crash between finalize and bind heals on replay", async () => {
  const f = harness({ orderId: "order-1", unbound: 1 });
  const r = await handlePaystackChargeSuccess(f.client as never, { reference: REF }, () => Promise.resolve(cardTxn(true)));
  assertEquals(r.status, "replayed");
  assertEquals(bindArgs(f)!.p_order_id, "order-1");
});

Deno.test("#3645 full-pay Paystack checkout is unchanged: not a plan root, no bind", async () => {
  const f = harness({ schedule: null, finalizeRoot: false });
  await handlePaystackChargeSuccess(f.client as never, { reference: REF }, () => Promise.resolve(cardTxn(true)));
  assertEquals(finalizeArgs(f)!.p_installment_plan_root, false);
  assertEquals(bindArgs(f), undefined);
});

Deno.test("#3645 bind failure throws so the webhook inbox retries", async () => {
  const f = fakeSupabase({
    rpc: (name) => name === "biz_ticket_checkout_finalize"
      ? ok({ outcome: "finalized", orderId: "order-1", installmentPlanRoot: true })
      : name === "issue_3645_paystack_plan_bind" ? { data: null, error: { message: "installment_charge_plan_missing" } } : ok(null),
    table: (op) => op.table === "ticket_checkout_sessions"
      ? ok({ id: "sess-1", order_id: null, total_cents: 270_625, currency: "NGN", installment_schedule: SCHEDULE })
      : ok(null),
  });
  let threw = false;
  try {
    await handlePaystackChargeSuccess(f.client as never, { reference: REF }, () => Promise.resolve(cardTxn(true)));
  } catch (e) {
    threw = String(e).includes("paystack_plan_bind_failed");
  }
  assert(threw);
});
