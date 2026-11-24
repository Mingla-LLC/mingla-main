/**
 * issue #4522 rework (tester F2, F10) — trip-balance-pay and the flexible
 * row it opens.
 *
 * F10: a client key reused for another amount is refused by the database
 * (flex_client_key_reused, 409) before any provider call, and a provider
 * failure on a REPLAYED payment never closes it (it may be live in another
 * tab). Only a payment this request opened is closed.
 * N3 (replaces F2's best-effort cancel): an earlier open payment is checked
 * with the provider before a new begin and released only on its answer.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { handleTripBalancePay, type StripeLike } from "../index.ts";
import { fakeSupabase } from "../../_shared/installments/__tests__/issue_3645_fake_supabase.ts";

const ORDER = "45220000-0000-4000-8000-0000000f1001";
const BUYER = "45220000-0000-4000-8000-0000000f1002";
const FLEX = "45220000-0000-4000-8000-0000000f1003";

function world(begin: { data: unknown; error: { message: string } | null }) {
  return fakeSupabase({
    rpc: (name) => {
      if (name === "issue_4522_plan_v2_enabled") return { data: true, error: null };
      if (name === "issue_4522_begin_flex_payment") return begin;
      return { data: { ok: true }, error: null };
    },
    table: (op) => {
      if (op.table === "orders" && op.columns === "id") return { data: { id: ORDER }, error: null };
      if (op.table === "orders") {
        return { data: { id: ORDER, buyer_email: "b@example.test", payment_status: "paid", cancelled_at: null,
          stripe_customer_id_on_connected_account: "cus_1", saved_payment_method_id: "pm_1",
          events: { brand_id: "brand-1", status: "scheduled" } }, error: null };
      }
      if (op.table === "order_installments" && op.columns === "provider") return { data: { provider: "stripe" }, error: null };
      if (op.table === "order_installments") return { data: { referral_share_minor: 0, currency: "USD" }, error: null };
      if (op.table === "stripe_connect_accounts") return { data: { stripe_account_id: "acct_1" }, error: null };
      return { data: null, error: null };
    },
  });
}

const start = () =>
  new Request("http://local/trip-balance-pay", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer buyer-jwt" },
    body: JSON.stringify({ action: "start", orderId: ORDER, amountMinor: 70000, expectedRemainingMinor: 90000,
      clientKey: "client-key-f10", method: "saved_card" }),
  });

function deps(fake: ReturnType<typeof world>, calls: unknown[], failCreate = false, failCancel = false) {
  return {
    // deno-lint-ignore no-explicit-any
    supabase: fake.client as any,
    userIdFromJwt: () => Promise.resolve(BUYER),
    stripe: (): StripeLike => ({
      ephemeralKeys: { create: () => Promise.resolve({ secret: "ek_1" }) },
      paymentIntents: {
        create: (params) => {
          calls.push({ create: params.amount });
          return failCreate
            ? Promise.reject(new Error("idempotency_key_in_use"))
            : Promise.resolve({ id: "pi_new", client_secret: "sec", status: "requires_confirmation" });
        },
        cancel: (id) => {
          calls.push({ cancel: id });
          return failCancel ? Promise.reject(new Error("already_succeeded")) : Promise.resolve({});
        },
      },
    }),
    feeRate: () => Promise.resolve({ totalBps: 450, takeRateBps: 150, source: "brand_override" as const }),
    publishableKey: () => "pk_test",
  };
}

Deno.test("F10: a reused key for another amount is a 409 and reaches no provider", async () => {
  const fake = world({ data: null, error: { message: "flex_client_key_reused" } });
  const calls: unknown[] = [];
  const res = await handleTripBalancePay(start(), deps(fake, calls));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "flex_client_key_reused");
  assertEquals(calls, []);
  assertEquals(fake.rpcCalls.some((c) => c.name === "issue_4522_close_failed_flex"), false);
});

Deno.test("F10: a provider failure on a replayed payment never closes it", async () => {
  const fake = world({ data: { installmentId: FLEX, amountMinor: 70000, currency: "USD", status: "scheduled", replayed: true, released: [] }, error: null });
  const res = await handleTripBalancePay(start(), deps(fake, [], true));
  assertEquals(res.status, 502);
  assertEquals(fake.rpcCalls.some((c) => c.name === "issue_4522_close_failed_flex"), false);
});

Deno.test("F10: a provider failure on a payment this request opened closes it", async () => {
  const fake = world({ data: { installmentId: FLEX, amountMinor: 70000, currency: "USD", status: "scheduled", replayed: false, released: [] }, error: null });
  const res = await handleTripBalancePay(start(), deps(fake, [], true));
  assertEquals(res.status, 502);
  assertEquals(fake.rpcCalls.filter((c) => c.name === "issue_4522_close_failed_flex").length, 1);
});

Deno.test("F10: replaying a payment that already finished starts nothing new", async () => {
  const fake = world({ data: { installmentId: FLEX, amountMinor: 70000, currency: "USD", status: "collected", replayed: true, released: [] }, error: null });
  const calls: unknown[] = [];
  const res = await handleTripBalancePay(start(), deps(fake, calls));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "balance_changed");
  assertEquals(calls, []);
});

// issue #4522 (N3) — begin asks the provider about an earlier open payment
// first: only a confirmed cancel releases it; a success is settled through
// the webhook's own success path; a payment still processing is kept and the
// new begin answers 409. Time alone never releases anything.
function worldWithOpen(status: string, opts: { cancelTo?: string; failCancel?: boolean } = {}) {
  const settled: unknown[] = [];
  const calls: unknown[] = [];
  const fake = fakeSupabase({
    rpc: (name, args) => {
      if (name === "issue_4522_plan_v2_enabled") return { data: true, error: null };
      if (name === "issue_4522_flex_payments_to_verify") {
        return { data: [{ installmentId: "old-flex", orderId: ORDER, provider: "stripe",
          stripePaymentIntentId: "pi_old", attemptCount: 0, pastCeiling: false }], error: null };
      }
      if (name === "issue_4522_release_flex_verified") {
        calls.push({ release: (args as Record<string, unknown>).p_verified, ref: (args as Record<string, unknown>).p_provider_ref });
        return { data: { ok: true, released: true }, error: null };
      }
      if (name === "issue_4522_begin_flex_payment") {
        return { data: { installmentId: FLEX, amountMinor: 70000, currency: "USD", status: "scheduled", replayed: false, released: [] }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
    table: (op) => {
      if (op.table === "orders" && op.columns === "id") return { data: { id: ORDER }, error: null };
      if (op.table === "orders") {
        return { data: { id: ORDER, buyer_email: "b@example.test", payment_status: "paid", cancelled_at: null,
          stripe_customer_id_on_connected_account: "cus_1", saved_payment_method_id: "pm_1",
          events: { brand_id: "brand-1", status: "scheduled" } }, error: null };
      }
      if (op.table === "order_installments" && op.columns === "provider") return { data: { provider: "stripe" }, error: null };
      if (op.table === "order_installments") return { data: { referral_share_minor: 0, currency: "USD" }, error: null };
      if (op.table === "stripe_connect_accounts") return { data: { stripe_account_id: "acct_1" }, error: null };
      return { data: null, error: null };
    },
  });
  const d = {
    // deno-lint-ignore no-explicit-any
    supabase: fake.client as any,
    userIdFromJwt: () => Promise.resolve(BUYER),
    stripe: (): StripeLike => ({
      ephemeralKeys: { create: () => Promise.resolve({ secret: "ek_1" }) },
      paymentIntents: {
        retrieve: (id: string) => {
          calls.push({ retrieve: id });
          return Promise.resolve({ id, status, metadata: { mingla_installment_id: "old-flex" } });
        },
        cancel: (id: string) => {
          calls.push({ cancel: id });
          return opts.failCancel ? Promise.reject(new Error("already_succeeded"))
            : Promise.resolve({ id, status: opts.cancelTo ?? "canceled" });
        },
        create: (params: Record<string, unknown>) => {
          calls.push({ create: params.amount });
          return Promise.resolve({ id: "pi_new", client_secret: "sec", status: "requires_confirmation" });
        },
      },
    }),
    settleStripe: (_s: unknown, pi: Record<string, unknown>) => {
      settled.push(pi.id);
      return Promise.resolve();
    },
    alertOps: () => Promise.resolve(),
    feeRate: () => Promise.resolve({ totalBps: 450, takeRateBps: 150, source: "brand_override" as const }),
    publishableKey: () => "pk_test",
  };
  return { fake, d, calls, settled };
}

Deno.test("N3: an earlier payment the buyer abandoned is released only after the provider confirms the cancel", async () => {
  const { d, calls, settled } = worldWithOpen("requires_payment_method");
  const res = await handleTripBalancePay(start(), d);
  assertEquals(res.status, 200);
  assertEquals(calls.slice(0, 4), [{ retrieve: "pi_old" }, { cancel: "pi_old" },
    { release: "provider_canceled", ref: "pi_old" }, { create: 70000 }]);
  assertEquals(settled, []);
});

Deno.test("N3: an earlier payment that really succeeded is settled, never released", async () => {
  const { d, calls, settled } = worldWithOpen("succeeded");
  await handleTripBalancePay(start(), d);
  assertEquals(settled, ["pi_old"]);
  assertEquals(calls.some((c) => (c as { release?: string }).release !== undefined), false);
  assertEquals(calls.some((c) => (c as { cancel?: string }).cancel !== undefined), false);
});

Deno.test("N3: a cancel that loses to a confirmation reads back the success and settles it", async () => {
  // The cancel fails (it was just confirmed); the read-back says succeeded.
  const w = worldWithOpen("requires_confirmation", { failCancel: true });
  let reads = 0;
  const base = w.d.stripe();
  w.d.stripe = () => ({ ...base, paymentIntents: { ...base.paymentIntents,
    retrieve: (id: string) => {
      reads += 1;
      return Promise.resolve({ id, status: reads === 1 ? "requires_confirmation" : "succeeded" });
    } } });
  await handleTripBalancePay(start(), w.d);
  assertEquals(w.settled, ["pi_old"]);
  assertEquals(w.calls.some((c) => (c as { release?: string }).release !== undefined), false);
});

Deno.test("N3: a payment still processing is kept (no release, no cancel)", async () => {
  for (const status of ["processing", "requires_action"]) {
    const { d, calls, settled } = worldWithOpen(status);
    await handleTripBalancePay(start(), d);
    assertEquals(calls.some((c) => (c as { release?: string }).release !== undefined), false, status);
    assertEquals(calls.some((c) => (c as { cancel?: string }).cancel !== undefined), false, status);
    assertEquals(settled, [], status);
  }
});
