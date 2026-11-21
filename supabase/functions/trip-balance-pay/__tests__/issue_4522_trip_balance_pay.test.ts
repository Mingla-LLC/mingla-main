/**
 * issue #4522 — trip-balance-pay: who may pay, and what reaches the provider.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { handleTripBalancePay, type StripeLike } from "../index.ts";
import { fakeSupabase } from "../../_shared/installments/__tests__/issue_3645_fake_supabase.ts";

const ORDER = "45220000-0000-4000-8000-0000000000b1";
const BUYER = "45220000-0000-4000-8000-0000000000b2";
const FLEX = "45220000-0000-4000-8000-0000000000b3";
const BRAND = "45220000-0000-4000-8000-0000000000b4";

function post(body: Record<string, unknown>, jwt?: string): Request {
  return new Request("http://local/trip-balance-pay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function world(provider: "stripe" | "paystack", beginError?: string) {
  return fakeSupabase({
    rpc: (name) => {
      if (name === "issue_4522_begin_flex_payment") {
        return beginError ? { data: null, error: { message: beginError } } : {
          data: {
            installmentId: FLEX,
            amountMinor: 70000,
            currency: "USD",
            replayed: false,
          },
          error: null,
        };
      }
      if (name === "issue_4522_balance") {
        return {
          data: {
            orderId: ORDER,
            remainingMinor: 90000,
            canPayAnyAmount: true,
            terms: { v: 2 },
          },
          error: null,
        };
      }
      return { data: { ok: true }, error: null };
    },
    table: (op) => {
      if (op.table === "orders" && op.columns === "id") {
        const mine = op.filters.some(([, c, v]) =>
          c === "buyer_user_id" && v === BUYER
        );
        return { data: mine ? { id: ORDER } : null, error: null };
      }
      if (op.table === "orders") {
        return {
          data: {
            id: ORDER,
            buyer_email: "b@example.test",
            stripe_customer_id_on_connected_account: "cus_1",
            saved_payment_method_id: "pm_1",
            events: { brand_id: BRAND },
          },
          error: null,
        };
      }
      if (op.table === "order_installments" && op.columns === "provider") {
        return { data: { provider }, error: null };
      }
      if (op.table === "order_installments") {
        return {
          data: { referral_share_minor: 500, currency: "USD " },
          error: null,
        };
      }
      if (op.table === "stripe_connect_accounts") {
        return { data: { stripe_account_id: "acct_1" }, error: null };
      }
      return { data: null, error: null };
    },
  });
}

const deps = (fake: ReturnType<typeof world>, calls: Array<unknown>) => ({
  // deno-lint-ignore no-explicit-any
  supabase: fake.client as any,
  userIdFromJwt: (jwt: string) =>
    Promise.resolve(
      jwt === "buyer-jwt" ? BUYER : jwt === "other-jwt" ? "someone-else" : null,
    ),
  stripe: (): StripeLike => ({
    paymentIntents: {
      create: (params, options) => {
        calls.push({ params, options });
        return Promise.resolve({
          id: "pi_flex",
          client_secret: "pi_flex_secret",
          status: "requires_confirmation",
        });
      },
    },
  }),
  feeRate: () =>
    Promise.resolve({
      totalBps: 450,
      takeRateBps: 150,
      source: "brand_override" as const,
    }),
  chargePaystack: (input: { installmentId: string }) => {
    calls.push({ paystackCharge: input.installmentId });
    return Promise.resolve({ outcome: "collected" as never });
  },
});

Deno.test("no JWT and no token is refused; a stranger gets the same answer as a missing order", async () => {
  const fake = world("stripe");
  const calls: unknown[] = [];
  assertEquals(
    (await handleTripBalancePay(
      post({ action: "view", orderId: ORDER }),
      deps(fake, calls),
    )).status,
    401,
  );
  const stranger = await handleTripBalancePay(
    post({ action: "view", orderId: ORDER }, "other-jwt"),
    deps(fake, calls),
  );
  assertEquals(stranger.status, 404);
  assertEquals((await stranger.json()).error, "balance_not_found");
});

Deno.test("the buyer sees their balance", async () => {
  const fake = world("stripe");
  const res = await handleTripBalancePay(
    post({ action: "view", orderId: ORDER }, "buyer-jwt"),
    deps(fake, []),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.balance.remainingMinor, 90000);
  assertEquals("terms" in body.balance, false);
});

Deno.test("Stripe: a direct charge on the connected account with the instalment fee and the flex key", async () => {
  const fake = world("stripe");
  const calls: Array<
    { params: Record<string, unknown>; options: Record<string, unknown> }
  > = [];
  const res = await handleTripBalancePay(
    post({
      action: "start",
      orderId: ORDER,
      amountMinor: 70000,
      expectedRemainingMinor: 90000,
      clientKey: "client-key-001",
      method: "saved_card",
    }, "buyer-jwt"),
    deps(fake, calls),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).clientSecret, "pi_flex_secret");
  assertEquals(calls.length, 1);
  const { params, options } = calls[0];
  assertEquals(params.amount, 70000);
  assertEquals(params.currency, "usd");
  assertEquals(params.customer, "cus_1");
  assertEquals(params.payment_method, "pm_1");
  // 4.5% of 70,000 = 3,150 Mingla fee, plus the 500 referral share
  // (the same rule createInstallmentPI uses).
  assertEquals(params.application_fee_amount, 3650);
  assertEquals(
    (params.metadata as Record<string, string>).mingla_installment_id,
    FLEX,
  );
  assertEquals((params.metadata as Record<string, string>).mingla_flex, "1");
  assertEquals(options, {
    idempotencyKey: `flex:${ORDER}:client-key-001`,
    stripeAccount: "acct_1",
  });
  const begin = fake.rpcCalls.find((c) =>
    c.name === "issue_4522_begin_flex_payment"
  );
  assertEquals(begin?.args.p_method, "auto_card");
});

Deno.test("a database refusal keeps its name and nothing reaches the provider", async () => {
  const fake = world("stripe", "balance_payment_in_flight");
  const calls: unknown[] = [];
  const res = await handleTripBalancePay(
    post({
      action: "start",
      orderId: ORDER,
      amountMinor: 70000,
      expectedRemainingMinor: 90000,
      clientKey: "client-key-002",
      method: "saved_card",
    }, "buyer-jwt"),
    deps(fake, calls),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "balance_payment_in_flight");
  assertEquals(calls.length, 0);
});

Deno.test("Paystack: a saved card charges the flexible row; a new card in the app opens the balance page", async () => {
  const fake = world("paystack");
  const calls: unknown[] = [];
  const saved = await handleTripBalancePay(
    post({
      action: "start",
      orderId: ORDER,
      amountMinor: 70000,
      expectedRemainingMinor: 90000,
      clientKey: "client-key-003",
      method: "saved_card",
    }, "buyer-jwt"),
    deps(fake, calls),
  );
  assertEquals((await saved.json()).kind, "paystack_saved_card");
  assertEquals(calls, [{ paystackCharge: FLEX }]);
  const fresh = await handleTripBalancePay(
    post({
      action: "start",
      orderId: ORDER,
      amountMinor: 70000,
      expectedRemainingMinor: 90000,
      clientKey: "client-key-004",
      method: "new_card",
    }, "buyer-jwt"),
    { ...deps(fake, calls), mintToken: () => "a".repeat(43) },
  );
  const body = await fresh.json();
  assertEquals(body.kind, "open_page");
  assertEquals(
    String(body.url).endsWith(`/pay/balance/${"a".repeat(43)}`),
    true,
  );
});

Deno.test("bad input never reaches the database", async () => {
  const fake = world("stripe");
  const res = await handleTripBalancePay(
    post({
      action: "start",
      orderId: ORDER,
      amountMinor: 1.5,
      expectedRemainingMinor: 90000,
      clientKey: "short",
      method: "saved_card",
    }, "buyer-jwt"),
    deps(fake, []),
  );
  assertEquals(res.status, 400);
  assertEquals(fake.rpcCalls.length, 0);
});
