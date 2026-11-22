/**
 * issue #4522 rework (tester F2, F10) — trip-balance-pay and the flexible
 * row it opens.
 *
 * F10: a client key reused for another amount is refused by the database
 * (flex_client_key_reused, 409) before any provider call, and a provider
 * failure on a REPLAYED payment never closes it (it may be live in another
 * tab). Only a payment this request opened is closed.
 * F2: a begin that released an abandoned payment cancels its PaymentIntent,
 * best-effort; a failing cancel never blocks the new payment.
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

Deno.test("F2: the released abandoned PaymentIntent is cancelled; a failed cancel never blocks", async () => {
  for (const failCancel of [false, true]) {
    const fake = world({ data: { installmentId: FLEX, amountMinor: 70000, currency: "USD", status: "scheduled", replayed: false,
      released: [{ installmentId: "old-flex", provider: "stripe", stripePaymentIntentId: "pi_abandoned" }] }, error: null });
    const calls: unknown[] = [];
    const res = await handleTripBalancePay(start(), deps(fake, calls, false, failCancel));
    assertEquals(res.status, 200);
    assertEquals(calls[0], { cancel: "pi_abandoned" });
    assertEquals(calls[1], { create: 70000 });
  }
});
