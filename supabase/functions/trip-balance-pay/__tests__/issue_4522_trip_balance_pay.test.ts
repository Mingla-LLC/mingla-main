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

function world(
  provider: "stripe" | "paystack",
  beginError?: string,
  switchEnabled = true,
  over: { begin?: Record<string, unknown>; balance?: Record<string, unknown>; claims?: boolean[] } = {},
) {
  return fakeSupabase({
    rpc: (name) => {
      if (name === "issue_4522_claim_paid_in_full_notice" && over.claims !== undefined) {
        return { data: over.claims.shift() ?? false, error: null };
      }
      if (name === "issue_4522_resolve_balance_link") {
        return {
          data: {
            state: "payable",
            order_id: ORDER,
            trip_title: "Lagos Weekend",
            brand_name: "Mingla Trips",
          },
          error: null,
        };
      }
      if (name === "issue_4522_begin_flex_payment") {
        return beginError ? { data: null, error: { message: beginError } } : over.begin ? { data: over.begin, error: null } : {
          data: {
            installmentId: FLEX,
            amountMinor: 70000,
            currency: "USD",
            replayed: false,
          },
          error: null,
        };
      }
      if (name === "issue_4522_plan_v2_enabled") {
        return { data: switchEnabled, error: null };
      }
      if (name === "issue_4522_balance") {
        return {
          data: {
            orderId: ORDER,
            currency: "USD",
            depositMinor: 20000,
            paidMinor: 40000,
            remainingMinor: 90000,
            totalMinor: 130000,
            canPayAnyAmount: true,
            minPaymentMinor: 10000,
            paymentInFlight: false,
            nextPayment: {
              installmentId: "next-1",
              dueAt: "2027-03-01T00:00:00Z",
              amountMinor: 30000,
            },
            openRows: [],
            history: [],
            terms: { v: 2 },
            ...(over.balance ?? {}),
          },
          error: null,
        };
      }
      if (name === "issue_3645_begin_installment_attempt") {
        return {
          data: {
            ok: true,
            attempt_id: "attempt-1",
            reference: "ref-4522",
            amount_cents: 70000,
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
            payment_status: "paid",
            cancelled_at: null,
            stripe_customer_id_on_connected_account: "cus_1",
            saved_payment_method_id: "pm_1",
            payment_card_last4: "4242",
            events: {
              brand_id: BRAND,
              status: "scheduled",
              title: "Lagos Weekend",
              brands: { name: "Mingla Trips" },
            },
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
    ephemeralKeys: {
      create: (params, options) => {
        calls.push({ ephemeralKey: { params, options } });
        return Promise.resolve({ secret: "ek_test_balance" });
      },
    },
    paymentIntents: {
      create: (params, options) => {
        calls.push({ params, options });
        return Promise.resolve({
          id: "pi_flex",
          client_secret: "pi_flex_secret",
          status: "requires_confirmation",
        });
      },
      cancel: (id) => {
        calls.push({ cancel: id });
        return Promise.resolve({});
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
  publishableKey: () => "pk_test_balance",
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
  assertEquals(body.tripTitle, "Lagos Weekend");
  assertEquals(body.brandName, "Mingla Trips");
  assertEquals(body.provider, "stripe");
  assertEquals(body.savedCardLast4, "4242");
});

Deno.test("Stripe: a direct charge on the connected account with the instalment fee and the flex key", async () => {
  const fake = world("stripe");
  const calls: unknown[] = [];
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
  const response = await res.json();
  assertEquals(response.clientSecret, "pi_flex_secret");
  assertEquals(response.publishableKey, "pk_test_balance");
  assertEquals(response.customerId, "cus_1");
  assertEquals(response.customerEphemeralKeySecret, "ek_test_balance");
  assertEquals(calls.length, 2);
  const ephemeral = calls.find((value) =>
    typeof value === "object" && value !== null && "ephemeralKey" in value
  ) as {
    ephemeralKey: {
      params: Record<string, unknown>;
      options: Record<string, unknown>;
    };
  };
  assertEquals(ephemeral.ephemeralKey.params, { customer: "cus_1" });
  assertEquals(ephemeral.ephemeralKey.options.stripeAccount, "acct_1");
  assertEquals(
    ephemeral.ephemeralKey.options.idempotencyKey,
    "mingla_flex_ephkey:acct_1:cus_1:client-key-001",
  );
  const payment = calls.find((value) =>
    typeof value === "object" && value !== null && "params" in value
  ) as { params: Record<string, unknown>; options: Record<string, unknown> };
  const { params, options } = payment;
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

Deno.test("Stripe app payment fails closed before PI creation when saved-card customer config is unavailable", async () => {
  const fake = world("stripe");
  let piCalls = 0;
  const res = await handleTripBalancePay(
    post({
      action: "start",
      orderId: ORDER,
      amountMinor: 70000,
      expectedRemainingMinor: 90000,
      clientKey: "client-key-no-eph",
      method: "new_card",
    }, "buyer-jwt"),
    {
      ...deps(fake, []),
      stripe: (): StripeLike => ({
        ephemeralKeys: {
          create: () => Promise.resolve({ secret: null }),
        },
        paymentIntents: {
          create: () => {
            piCalls += 1;
            return Promise.reject(new Error("must_not_create"));
          },
          cancel: () => Promise.resolve({}),
        },
      }),
    },
  );
  assertEquals(res.status, 502);
  assertEquals(piCalls, 0);
  assertEquals(
    fake.rpcCalls.some((call) => call.name === "issue_4522_close_failed_flex"),
    true,
  );
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

Deno.test("Paystack app handoff stays inert while the server switch is off", async () => {
  const fake = world("paystack", undefined, false);
  const res = await handleTripBalancePay(
    post({
      action: "start",
      orderId: ORDER,
      amountMinor: 70000,
      expectedRemainingMinor: 90000,
      clientKey: "client-key-off",
      method: "new_card",
    }, "buyer-jwt"),
    { ...deps(fake, []), mintToken: () => "z".repeat(43) },
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "payment_plan_v2_unavailable");
  assertEquals(
    fake.rpcCalls.some((call) => call.name === "issue_4522_issue_balance_link"),
    false,
  );
});

Deno.test("Paystack balance-link return carries the starting balance so a failed attempt cannot look paid", async () => {
  const fake = world("paystack");
  let callbackUrl = "";
  const token = "b".repeat(43);
  const res = await handleTripBalancePay(
    post({
      action: "start",
      token,
      amountMinor: 70000,
      expectedRemainingMinor: 90000,
      clientKey: "client-key-005",
      method: "new_card",
    }),
    {
      ...deps(fake, []),
      initialize: (input) => {
        callbackUrl = input.callbackUrl ?? "";
        return Promise.resolve({
          authorization_url: "https://checkout.paystack.com/approved",
          access_code: "access-1",
          reference: "ref-4522",
        });
      },
    },
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).kind, "redirect");
  assertEquals(
    callbackUrl,
    `https://host.usemingla.com/pay/balance/${token}?return=1&expected=90000`,
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

// ── T4-3: never leave a balance the provider cannot charge ─────────────────

Deno.test("T4-3 an amount that would leave too little is refused by name; nothing reaches the provider", async () => {
  const fake = world("stripe", "flex_amount_leaves_unpayable_remainder");
  const calls: unknown[] = [];
  const res = await handleTripBalancePay(
    post({ action: "start", orderId: ORDER, amountMinor: 89_990, expectedRemainingMinor: 90000,
      clientKey: "client-key-t43a", method: "saved_card" }, "buyer-jwt"),
    deps(fake, calls),
  );
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error, "flex_amount_leaves_unpayable_remainder");
  assertEquals(calls.length, 0);
});

Deno.test("I-4522-NEVER-WRITE-OFF a whole balance below the provider's minimum: nothing is charged or written off, ops are alerted, no paid-in-full email", async () => {
  const fake = world("stripe", undefined, true, {
    begin: { installmentId: null, belowProviderMinimum: true, remainingMinor: 30, alertOps: true,
      order_id: ORDER, currency: "USD", amountMinor: 0 },
  });
  const calls: unknown[] = [];
  const alerts: string[][] = [];
  const res = await handleTripBalancePay(
    post({ action: "start", orderId: ORDER, amountMinor: 30, expectedRemainingMinor: 30,
      clientKey: "client-key-t43b", method: "saved_card" }, "buyer-jwt"),
    { ...deps(fake, calls), alertOps: (s: string, p: string[]) => { alerts.push([s, ...p]); return Promise.resolve(); } },
  );
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "balance_below_provider_minimum" });
  assertEquals(calls.length, 0);
  assertEquals(alerts.length, 1);
  assertEquals(alerts[0][0], "A trip balance is too small to charge");
  assertEquals(fake.rpcCalls.some((c) => c.name === "issue_4522_claim_paid_in_full_notice"), false);
});

Deno.test("T4-3 the Paystack new-card handoff applies the same rule before issuing a link; the quote is public", async () => {
  const fake = world("paystack", undefined, true, { balance: { maxPartialMinor: 80000, providerMinimumMinor: 10000 } });
  const res = await handleTripBalancePay(
    post({ action: "start", orderId: ORDER, amountMinor: 85000, expectedRemainingMinor: 90000,
      clientKey: "client-key-t43c", method: "new_card" }, "buyer-jwt"),
    { ...deps(fake, []), mintToken: () => "q".repeat(43) },
  );
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "flex_amount_leaves_unpayable_remainder", detail: "80000" });
  assertEquals(fake.rpcCalls.some((c) => c.name === "issue_4522_issue_balance_link"), false);
  const ok = await handleTripBalancePay(
    post({ action: "start", orderId: ORDER, amountMinor: 80000, expectedRemainingMinor: 90000,
      clientKey: "client-key-t43d", method: "new_card" }, "buyer-jwt"),
    { ...deps(fake, []), mintToken: () => "r".repeat(43) },
  );
  assertEquals((await ok.json()).kind, "open_page");
  const view = await handleTripBalancePay(post({ action: "view", orderId: ORDER }, "buyer-jwt"), deps(fake, []));
  const balance = (await view.json()).balance;
  assertEquals([balance.maxPartialMinor, balance.providerMinimumMinor], [80000, 10000]);
});

// issue #4522 rework 9 (T8-6) — FAILS-ON-REVERT: drop the provider-minimum
// refusal from the Paystack new-card handoff -> a balance link is issued for
// a balance the provider cannot charge -> red.
Deno.test("rework 9 T8-6: the Paystack new-card handoff issues no balance link for a balance below the provider minimum", async () => {
  const fake = world("paystack", undefined, true, {
    balance: { remainingMinor: 5000, providerMinimumMinor: 10000, minPaymentMinor: 10000, maxPartialMinor: null,
      nextPayment: { installmentId: "next-1", dueAt: "2027-03-01T00:00:00Z", amountMinor: 5000 } },
  });
  const res = await handleTripBalancePay(
    post({ action: "start", orderId: ORDER, amountMinor: 5000, expectedRemainingMinor: 5000,
      clientKey: "client-key-t86a", method: "new_card" }, "buyer-jwt"),
    { ...deps(fake, []), mintToken: () => "s".repeat(43) },
  );
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "balance_below_provider_minimum" });
  assertEquals(fake.rpcCalls.some((c) => c.name === "issue_4522_issue_balance_link"), false);
  // At the minimum the link is issued as before.
  const at = world("paystack", undefined, true, {
    balance: { remainingMinor: 10000, providerMinimumMinor: 10000, minPaymentMinor: 10000, maxPartialMinor: null },
  });
  const ok = await handleTripBalancePay(
    post({ action: "start", orderId: ORDER, amountMinor: 10000, expectedRemainingMinor: 10000,
      clientKey: "client-key-t86b", method: "new_card" }, "buyer-jwt"),
    { ...deps(at, []), mintToken: () => "t".repeat(43) },
  );
  assertEquals((await ok.json()).kind, "open_page");
});
