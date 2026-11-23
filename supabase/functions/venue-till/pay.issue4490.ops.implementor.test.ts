// #4490 spec 08 O2 — venue-till: scan to pay and tap start. The server prices
// the carrier (the body's amount is ignored), the pay URL and returns come from
// env (never the hard-coded production origin), the anonymous code actions are
// rate-limited and answer one 404 for every unknown code, the provider pages are
// created for the server's total, Stripe pages are expired before a cancel, and
// confirm_return finalizes once through the shared finalizer.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createVenueTillHandler, type TillClient } from "./index.ts";
import { handleVenueOrderPaystackCharge } from "../_shared/venueOrderWebhook.ts";
import { generateTillCode, TILL_CODE_RE } from "../_shared/venueTillCard.ts";

const VENUE = "00000000-4490-4000-8000-0000000002a1";
const BRAND = "00000000-4490-4000-8000-0000000002b0";
const SALE = "00000000-4490-4000-8000-0000000002c1";
const STAFF = "00000000-4490-4000-8000-0000000002f1";
const PAYMENT = "00000000-4490-4000-8000-0000000002e1";
const CARRIER = "00000000-4490-4000-8000-0000000002e9";
const REQ = "00000000-4490-4000-8000-0000000002e2";
const CODE = "QXR7KM2P";
// The Stripe brand in these fixtures settles in pounds.
const STRIPE_CURRENCY = "GBP";

type Row = Record<string, unknown>;
type Call = { name: string; params: Record<string, unknown> };

function fakeDb(tables: Record<string, Row[]>) {
  const updates: Array<{ table: string; patch: Row }> = [];
  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "update" | "insert" = "select";
    let payload: Row | null = null;
    const rows = () =>
      (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const run = () => {
      if (mode === "update") {
        updates.push({ table, patch: payload as Row });
        const hit = rows();
        for (const r of hit) Object.assign(r, payload);
        return { data: hit, error: null };
      }
      return { data: rows(), error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      is: (
        c: string,
        v: unknown,
      ) => (filters.push((r) => (r[c] ?? null) === v), b),
      update: (p: Row) => ((mode = "update"), (payload = p), b),
      maybeSingle: () =>
        Promise.resolve({
          data: (run().data as Row[])[0] ?? null,
          error: null,
        }),
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return b;
  }
  return { from, updates };
}

function world(opts: {
  provider?: "paystack" | "stripe";
  limiterAllows?: boolean;
  view?: Row;
  pageStatus?: string;
} = {}) {
  const provider = opts.provider ?? "paystack";
  const calls: Call[] = [];
  const tables: Record<string, Row[]> = {
    venue_till_sales: [{
      id: SALE,
      venue_id: VENUE,
      brand_id: BRAND,
      session_id: "s",
      qr_spot_id: null,
      currency: provider === "paystack" ? "NGN" : "GBP",
      state: "open",
      version: 3,
      check_label: "Ada",
    }],
    venue_till_payments: [],
    venue_till_pay_codes: [{ code: CODE, payment_id: PAYMENT }],
    venue_orders: [{
      id: CARRIER,
      till_payment_id: PAYMENT,
      fulfillment_status: "payment_only",
      provider,
      paystack_reference: null,
      stripe_account_id: provider === "stripe" ? "acct_1" : null,
      stripe_checkout_session_id: provider === "stripe" ? "cs_1" : null,
      metadata: {},
      total_cents: 600000,
      currency: provider === "paystack" ? "NGN" : "GBP",
      brand_id: BRAND,
    }],
    brands: [{ id: BRAND, payout_hold_cutover_at: "2026-01-01" }],
  };
  const db = fakeDb(tables);
  let viewPaid = false;
  const client: TillClient = {
    auth: {
      getUser: (jwt: string) =>
        Promise.resolve(
          jwt === "staff-jwt"
            ? { data: { user: { id: STAFF } }, error: null }
            : { data: null, error: { message: "bad" } },
        ),
    },
    from: db.from,
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      switch (name) {
        case "pg_venue_order_rate_limit_hit":
          return Promise.resolve({
            data: { allowed: opts.limiterAllows ?? true },
            error: null,
          });
        case "resolve_brand_pricing_inputs":
          return Promise.resolve({
            data: [
              provider === "paystack"
                ? {
                  pass_tax: false,
                  pass_mingla_fee: false,
                  pass_service_fee: false,
                  pricing_region: "NG",
                  pricing_currency: "NGN",
                  effective_take_rate_bps: 150,
                  take_rate_source: "platform_default",
                  stripe_account_id: null,
                  stripe_charges_enabled: false,
                  payment_provider: "paystack",
                  payment_country: "NG",
                  paystack_subaccount_code: null,
                  vat_rate_bps: 750,
                }
                : {
                  pass_tax: false,
                  pass_mingla_fee: true,
                  pass_service_fee: false,
                  pricing_region: "GB",
                  pricing_currency: STRIPE_CURRENCY,
                  effective_take_rate_bps: 150,
                  take_rate_source: "platform_default",
                  stripe_account_id: "acct_1",
                  stripe_charges_enabled: true,
                  payment_provider: "stripe",
                  payment_country: "GB",
                  paystack_subaccount_code: null,
                  vat_rate_bps: null,
                },
            ],
            error: null,
          });
        case "issue_4490_till_card_prepare":
          return Promise.resolve({
            data: {
              version: 5,
              currency: provider === "paystack" ? "NGN" : "GBP",
              amountMinor: 550000,
              serviceChargeMinor: 50000,
              sentOrderIds: [],
            },
            error: null,
          });
        case "issue_4490_till_card_start":
          return Promise.resolve({
            data: {
              paymentId: PAYMENT,
              amountMinor: 550000,
              tipMinor: params.p_tip_minor,
              chargedMinor: (params.p_money as Row).totalCents,
              state: "pending",
              replayed: false,
              code: params.p_code,
              codeStatus: "open",
              expiresAt: "2026-11-22T20:15:00Z",
            },
            error: null,
          });
        case "issue_4490_till_sale_projection":
          return Promise.resolve({
            data: { id: SALE, state: "paying" },
            error: null,
          });
        case "biz_tap_to_pay_release":
          return Promise.resolve({
            data: { iphone: true, android: true },
            error: null,
          });
        case "issue_4490_till_pay_code_view":
          if (params.p_code !== CODE) {
            return Promise.resolve({
              data: null,
              error: { message: "pay_code_not_found", code: "P0002" },
            });
          }
          return Promise.resolve({
            data: {
              ...(opts.view ?? { status: "opened", amountMinor: 600000 }),
              paid: viewPaid,
            },
            error: null,
          });
        case "issue_4490_till_pay_code_buyer":
          return Promise.resolve({
            data: {
              carrierOrderId: CARRIER,
              paymentId: PAYMENT,
              brandId: BRAND,
              provider,
              stripeAccountId: provider === "stripe" ? "acct_1" : null,
              currency: provider === "paystack" ? "NGN" : "GBP",
              totalCents: 600000,
              applicationFeeCents: 24750,
              venueName: "Gameland",
              continuation: null,
            },
            error: null,
          });
        case "issue_4490_till_pay_code_status":
          return Promise.resolve({
            data: {
              code: CODE,
              status: "opened",
              paymentId: PAYMENT,
              paymentState: "pending",
            },
            error: null,
          });
        case "issue_4490_till_card_cancel":
          return Promise.resolve({
            data: { paymentId: PAYMENT, state: "cancelled" },
            error: null,
          });
        case "pg_venue_order_finalize_payment":
          viewPaid = true;
          return Promise.resolve({
            data: {
              status: calls.filter((c) => c.name === name).length > 1
                ? "replayed"
                : "finalized",
            },
            error: null,
          });
        default:
          return Promise.resolve({ data: null, error: null });
      }
    },
  };
  const stripeCalls: Array<{ op: string; args: unknown[] }> = [];
  const stripe = () => ({
    checkout: {
      sessions: {
        create: (...args: unknown[]) => {
          stripeCalls.push({ op: "create", args });
          return Promise.resolve({
            id: "cs_new",
            url: "https://checkout.stripe.com/c/pay/cs_new",
          });
        },
        expire: (...args: unknown[]) => {
          stripeCalls.push({ op: "expire", args });
          return Promise.resolve({ status: opts.pageStatus ?? "expired" });
        },
        retrieve: (...args: unknown[]) => {
          stripeCalls.push({ op: "retrieve", args });
          return Promise.resolve({ status: opts.pageStatus ?? "open" });
        },
      },
    },
  });
  const paystackCalls: Array<Record<string, unknown>> = [];
  const env: Record<string, string> = {
    SUPABASE_URL: "http://127.0.0.1:57521",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    BUSINESS_WEB_ORIGIN: "http://localhost:8491",
  };
  const handler = createVenueTillHandler({
    client: () => client,
    env: (n) => env[n],
    notifyPlaced: () => Promise.resolve(),
    stripe,
    paystackInit: (params) => {
      paystackCalls.push(params as unknown as Record<string, unknown>);
      return Promise.resolve({
        authorization_url: "https://checkout.paystack.com/abc",
        access_code: "abc",
        reference: String(params.reference),
      });
    },
    paystackVerify: () =>
      Promise.resolve({
        status: "success",
        amount: 600000,
        currency: "NGN",
        channel: "bank_transfer",
        id: 77,
        fees: 9000,
      }),
    generateCode: () => CODE,
  });
  return {
    handler,
    calls,
    tables,
    stripeCalls,
    paystackCalls,
    env,
    updates: db.updates,
  };
}

const post = (body: Row, jwt: string | null = "staff-jwt") =>
  new Request("http://x/venue-till", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      "x-forwarded-for": "10.0.0.9",
    },
    body: JSON.stringify(body),
  });

Deno.test("O2-E1 pay_code_create prices the carrier on the server; the body's amount is ignored; the pay URL comes from env", async () => {
  const w = world();
  const res = await w.handler(post({
    action: "pay_code_create",
    venueId: VENUE,
    saleId: SALE,
    tipMinor: 50000,
    clientRequestId: REQ,
    expectedVersion: 3,
    amountMinor: 1,
  }));
  assertEquals(res.status, 200);
  const data = (await res.json()).data;
  assertEquals(data.code, CODE);
  assertEquals(data.payUrl, `http://localhost:8491/pay/till/${CODE}`);
  const start = w.calls.find((c) => c.name === "issue_4490_till_card_start")!;
  const money = start.params.p_money as Row;
  // 5,000.00 lines + 500.00 service charge; 4.5% on 5,500.00 = 247.50 (absorbed); tip on top.
  assertEquals(money.subtotalCents, 500000);
  assertEquals(money.serviceChargeCents, 50000);
  assertEquals(money.tipCents, 50000);
  assertEquals(
    (money.minglaFeeCents as number) +
      (money.platformServiceFeeCents as number),
    24750,
  );
  assertEquals(money.totalCents, 600000);
  assertEquals(start.params.p_expected_version, 5);
  assertEquals(start.params.p_method, "scan");
});

Deno.test("O2-E2 without a configured origin the pay URL is the production origin, never a request-supplied one", async () => {
  const w = world();
  delete w.env.BUSINESS_WEB_ORIGIN;
  const res = await w.handler(
    post({
      action: "pay_code_create",
      venueId: VENUE,
      saleId: SALE,
      tipMinor: 0,
      clientRequestId: REQ,
      expectedVersion: 3,
      origin: "https://evil.example",
    }),
  );
  const data = (await res.json()).data;
  assert(String(data.payUrl).startsWith("https://"));
  assertFalse(String(data.payUrl).includes("evil"));
});

Deno.test("O2-E3 tap on a Paystack brand is refused (Nigeria never has tap)", async () => {
  const w = world();
  const res = await w.handler(
    post({
      action: "pay_tap_start",
      venueId: VENUE,
      saleId: SALE,
      tipMinor: 0,
      clientRequestId: REQ,
      expectedVersion: 3,
      platform: "ios",
    }),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "till_tap_not_available");
  assertFalse(w.calls.some((c) => c.name === "issue_4490_till_card_start"));
});

Deno.test("O2-E4 tap start on a released GB Stripe brand makes a tap payment for the server's total", async () => {
  const w = world({ provider: "stripe" });
  const res = await w.handler(
    post({
      action: "pay_tap_start",
      venueId: VENUE,
      saleId: SALE,
      tipMinor: 0,
      clientRequestId: REQ,
      expectedVersion: 3,
      platform: "ios",
    }),
  );
  assertEquals(res.status, 200);
  const start = w.calls.find((c) => c.name === "issue_4490_till_card_start")!;
  assertEquals(start.params.p_method, "tap");
  assertEquals(start.params.p_code, null);
  assertEquals((start.params.p_money as Row).provider, "stripe");
  assertEquals((start.params.p_money as Row).stripeAccountId, "acct_1");
});

Deno.test("O2-E5 anonymous code_view: unknown and malformed codes answer the same 404; a limited IP answers 429", async () => {
  const w = world();
  for (const code of ["ZZZZ2222", "abc", ""]) {
    const res = await w.handler(post({ action: "code_view", code }, null));
    assertEquals(res.status, 404);
    assertEquals((await res.json()).code, "pay_code_not_found");
  }
  const ok = await w.handler(
    post({ action: "code_view", code: CODE.toLowerCase() }, null),
  );
  assertEquals(ok.status, 200);
  const limited = world({ limiterAllows: false });
  const res = await limited.handler(
    post({ action: "code_view", code: CODE }, null),
  );
  assertEquals(res.status, 429);
  assertFalse(
    limited.calls.some((c) => c.name === "issue_4490_till_pay_code_view"),
  );
});

Deno.test("O2-E6 code_pay (Paystack) initialises the server total with bank transfer, returns to the env origin, carrier in metadata", async () => {
  const w = world();
  const res = await w.handler(post({
    action: "code_pay",
    code: CODE,
    amountMinor: 1,
    buyer: {
      name: "Ada Guest",
      email: "ada@gmail.com",
      phone: "08031234567",
      phoneCountryIso: "NG",
    },
  }, null));
  assertEquals(res.status, 200);
  const init = w.paystackCalls[0];
  assertEquals(init.amountSubunits, 600000);
  assert((init.channels as string[]).includes("bank_transfer"));
  assertEquals(
    init.callbackUrl,
    `http://localhost:8491/pay/till/${CODE}?paid=1`,
  );
  assertEquals((init.metadata as Row).mingla_venue_order_id, CARRIER);
  assert(String(init.reference).startsWith("mingla_vo_" + CARRIER));
  const buyer = w.calls.find((c) =>
    c.name === "issue_4490_till_pay_code_buyer"
  )!;
  assertEquals(buyer.params.p_phone_e164, "+2348031234567");
});

Deno.test("O2-E7 code_pay refuses a reserved email domain in words before any provider call", async () => {
  const w = world();
  const res = await w.handler(
    post({
      action: "code_pay",
      code: CODE,
      buyer: {
        name: "Ada",
        email: "ada@example.test",
        phone: "+2348031234567",
      },
    }, null),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, "buyer_email_undeliverable");
  assertEquals(w.paystackCalls.length, 0);
});

Deno.test("O2-E8 code_pay (Stripe) makes a hosted page on the connected account with the application fee and the carrier id", async () => {
  const w = world({ provider: "stripe" });
  const res = await w.handler(
    post({
      action: "code_pay",
      code: CODE,
      buyer: {
        name: "Ada Guest",
        email: "ada@gmail.com",
        phone: "+447700900123",
      },
    }, null),
  );
  assertEquals(res.status, 200);
  const create = w.stripeCalls.find((c) => c.op === "create")!;
  const [params, options] = create.args as [Row, Row];
  assertEquals(options.stripeAccount, "acct_1");
  assertEquals(options.idempotencyKey, `till_code_pay:${CARRIER}`);
  const pid = params.payment_intent_data as Row;
  assertEquals(pid.application_fee_amount, 24750);
  assertEquals((pid.metadata as Row).mingla_venue_order_id, CARRIER);
  assertEquals(
    (params.line_items as Row[])[0].price_data &&
      ((params.line_items as Row[])[0].price_data as Row).unit_amount,
    600000,
  );
  assertEquals(
    params.success_url,
    `http://localhost:8491/pay/till/${CODE}?paid=1`,
  );
});

Deno.test("O2-E9 pay_code_cancel expires the Stripe page first; a page that completed is never cancelled", async () => {
  const done = world({ provider: "stripe", pageStatus: "complete" });
  const res = await done.handler(
    post({ action: "pay_code_cancel", venueId: VENUE, code: CODE }),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "till_payment_landing");
  assertFalse(done.calls.some((c) => c.name === "issue_4490_till_card_cancel"));
  const open = world({ provider: "stripe", pageStatus: "expired" });
  const ok = await open.handler(
    post({ action: "pay_code_cancel", venueId: VENUE, code: CODE }),
  );
  assertEquals(ok.status, 200);
  assertEquals(open.stripeCalls[0].op, "expire");
  assert(open.calls.some((c) => c.name === "issue_4490_till_card_cancel"));
});

Deno.test("O2-E10 confirm_return verifies with Paystack, stamps the channel and finalizes once (idempotent)", async () => {
  const w = world();
  w.tables.venue_orders[0].paystack_reference = "mingla_vo_x";
  const first = await w.handler(
    post({
      action: "confirm_return",
      code: CODE,
      reference: "mingla_vo_somebody_else",
    }, null),
  );
  assertEquals((await first.json()).data.result, "confirmed");
  const fin = w.calls.filter((c) =>
    c.name === "pg_venue_order_finalize_payment"
  );
  assertEquals(fin.length, 1);
  assertEquals(fin[0].params.p_payment_intent_id, "mingla_vo_x");
  assertEquals(
    (w.tables.venue_orders[0].metadata as Row).provider_channel,
    "bank_transfer",
  );
  const second = await w.handler(
    post({ action: "confirm_return", code: CODE }, null),
  );
  assertEquals((await second.json()).data.result, "confirmed");
  assertEquals(
    w.calls.filter((c) => c.name === "pg_venue_order_finalize_payment").length,
    1,
  );
});

Deno.test("O2-E11 staff pay-code actions need a signed-in member", async () => {
  const w = world();
  const res = await w.handler(
    post({
      action: "pay_code_create",
      venueId: VENUE,
      saleId: SALE,
      tipMinor: 0,
      clientRequestId: REQ,
      expectedVersion: 3,
    }, null),
  );
  assertEquals(res.status, 401);
});

Deno.test("O2-E12 the Paystack webhook path keeps a Till carrier's channel; an unknown channel is not stored", async () => {
  const w = world();
  w.tables.venue_orders[0].paystack_reference = "mingla_vo_y";
  const client = {
    from: (t: string) =>
      (w as unknown as { handler: unknown }) && fakeDbFrom(w.tables)(t),
    rpc: () => Promise.resolve({ data: { status: "finalized" }, error: null }),
  };
  await handleVenueOrderPaystackCharge(client, "mingla_vo_y", {
    amount: 600000,
    currency: "NGN",
    channel: "ussd",
    id: 1,
  });
  assertEquals(
    (w.tables.venue_orders[0].metadata as Row).provider_channel,
    "ussd",
  );
  w.tables.venue_orders[0].metadata = {};
  await handleVenueOrderPaystackCharge(client, "mingla_vo_y", {
    amount: 600000,
    currency: "NGN",
    channel: "mobile_money",
    id: 2,
  });
  assertEquals(
    (w.tables.venue_orders[0].metadata as Row).provider_channel,
    undefined,
  );
});

function fakeDbFrom(tables: Record<string, Row[]>) {
  return fakeDb(tables).from;
}

Deno.test("O2-E13 pay codes use the door alphabet (no 0/O/1/I/L), 8 characters", () => {
  for (let i = 0; i < 200; i++) assert(TILL_CODE_RE.test(generateTillCode()));
  assertFalse(TILL_CODE_RE.test("O1LI0000"));
});
