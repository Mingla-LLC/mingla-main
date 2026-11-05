// Issue #4271 — door-pay-code implementor happy path.
//   create prices on the server and returns a pay link (never a ticket),
//   a caller without the payment permission is refused before any write,
//   view is public, flips open -> opened, reports expiry and carries no buyer
//   data, text_link sends to the guest's number and stops after three,
//   cancel refuses a paid code.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createDoorPayCodeHandler } from "../index.ts";
import {
  type DbOp,
  FakeDb,
  post,
  PRICING_ROW,
} from "../../_shared/__tests__/doorPayFakes.ts";
import {
  computeDoorMoney,
  DOOR_CODE_RE,
  effectiveDoorCodeStatus,
  generateDoorCode,
  makeDoorPayUrl,
} from "../../_shared/doorPay.ts";

const EVENT = "42710000-0000-4000-8000-000000000001";
const TIER = "42710000-0000-4000-8000-000000000002";
const BRAND = "42710000-0000-4000-8000-000000000003";
const CODE_ID = "42710000-0000-4000-8000-000000000004";
const ACTOR = "42710000-0000-4000-8000-000000000005";
const NOW = Date.parse("2026-11-04T20:00:00Z");

function makeDb(options: {
  canTake?: boolean;
  insertErrors?: Array<{ message: string; code?: string } | null>;
  codeRow?: Record<string, unknown> | null;
  textLinkError?: string | null;
  closeResult?: Record<string, unknown> | Array<Record<string, unknown>>;
  livePages?: Record<string, unknown>[];
  liveStatus?: string;
  latePayment?: Record<string, unknown> | null;
  dueCodes?: string[];
  pricing?: Record<string, unknown>;
} = {}) {
  const closeResults = Array.isArray(options.closeResult) ? [...options.closeResult] : null;
  const insertErrors = [...(options.insertErrors ?? [])];
  return new FakeDb(
    (op: DbOp) => {
      if (op.table === "events") {
        return {
          data: { brands: { stripe_charges_enabled: true, payout_hold_cutover_at: null } },
          error: null,
        };
      }
      if (op.table === "door_pay_codes" && op.action === "insert") {
        const err = insertErrors.shift() ?? null;
        if (err) return { data: null, error: err };
        const p = op.payload as Record<string, unknown>;
        return { data: { id: CODE_ID, code: p.code, expires_at: p.expires_at }, error: null };
      }
      if (op.table === "door_pay_codes" && op.action === "select") {
        return { data: options.codeRow ?? null, error: null };
      }
      if (op.table === "door_pay_codes" && op.action === "update") {
        const p = op.payload as Record<string, unknown>;
        return { data: { status: p.status }, error: null };
      }
      if (op.table === "ticket_types") {
        return { data: [{ id: TIER, name: "Door entry", price_cents: 2000 }], error: null };
      }
      if (op.table === "event_dates") {
        return { data: [{ start_at: "2026-11-04T19:00:00Z" }], error: null };
      }
      return { data: null, error: null };
    },
    (name, args) => {
      if (name === "issue_4271_can_take_door_payment") {
        assertEquals(args.p_actor_id, ACTOR);
        return { data: options.canTake ?? true, error: null };
      }
      if (name === "issue_4271_door_quote_lines") {
        return {
          data: {
            brandId: BRAND,
            currency: "USD",
            subtotalCents: 4000,
            lines: [{ ticketTypeId: TIER, name: "Door entry", quantity: 2, unitCents: 2000 }],
          },
          error: null,
        };
      }
      if (name === "resolve_event_pricing_inputs") {
        return { data: [{ ...PRICING_ROW, ...(options.pricing ?? {}) }], error: null };
      }
      if (name === "issue_4271_door_pay_code_live_pages") {
        return {
          data: { status: options.liveStatus ?? "opened", pages: options.livePages ?? [] },
          error: null,
        };
      }
      if (name === "issue_4271_door_pay_code_close") {
        const fixed = closeResults !== null
          ? closeResults.shift()
          : options.closeResult as Record<string, unknown> | undefined;
        return { data: fixed ?? { status: args.p_status, stripeExpire: [] }, error: null };
      }
      if (name === "issue_4271_door_pay_code_late_read") {
        return { data: options.latePayment ?? null, error: null };
      }
      if (name === "issue_4271_door_pay_codes_due") {
        return { data: options.dueCodes ?? [], error: null };
      }
      if (name === "issue_4271_door_pay_code_text_link") {
        return options.textLinkError
          ? { data: null, error: { message: options.textLinkError } }
          : { data: { sent: true, count: 1 }, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  );
}

function handler(
  db: FakeDb,
  codes: string[] = ["ABCD2345"],
  // deno-lint-ignore no-explicit-any
  stripe: any = null,
) {
  const queue = [...codes];
  return createDoorPayCodeHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: (req) =>
      Promise.resolve(req.headers.get("authorization") ? ACTOR : null),
    now: () => NOW,
    generateCode: () => queue.shift() ?? "ZZZZ2222",
    stripe: () => {
      if (stripe === null) throw new Error("stripe not expected in this test");
      return stripe;
    },
  });
}

// A Stripe page: `expire` answers per the page's state as Stripe does (it refuses
// a page that is no longer open), and `retrieve` reads it. `db` records order.
function fakeCheckoutStripe(options: {
  page?: "open" | "complete" | "expired";
  expireThrows?: boolean;
  retrieveThrows?: boolean;
  db?: FakeDb;
} = {}) {
  const expired: Array<{ id: string; options: Record<string, unknown> }> = [];
  const page = options.page ?? "open";
  // How many database calls had run when Stripe was first asked.
  let rpcsBeforeExpire: string[] | null = null;
  return {
    expired,
    rpcsBeforeExpire: () => rpcsBeforeExpire,
    client: {
      checkout: {
        sessions: {
          expire: (id: string, _params: unknown, options2: Record<string, unknown>) => {
            rpcsBeforeExpire ??= (options.db?.rpcs ?? []).map((r) => r.name);
            expired.push({ id, options: options2 });
            if (options.expireThrows || page !== "open") {
              return Promise.reject(new Error("Only Checkout Sessions with a status in [open] can be expired"));
            }
            return Promise.resolve({ id, status: "expired" });
          },
          retrieve: (id: string) => {
            if (options.retrieveThrows) return Promise.reject(new Error("stripe down"));
            return Promise.resolve({ id, status: page });
          },
        },
      },
    },
  };
}

const STRIPE_PAGE = {
  checkoutSessionId: "cs_door_live",
  stripeAccountId: "acct_door1",
  idempotencyKey: "ticket-attempt-1:expire",
};

Deno.test("#4271 create prices on the server and returns a pay link", async () => {
  const db = makeDb();
  const res = await handler(db)(post({
    action: "create",
    eventId: EVENT,
    eventDateId: null,
    lines: [{ ticketTypeId: TIER, quantity: 2 }],
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.code, "ABCD2345");
  assertEquals(body.payUrl, "https://host.usemingla.com/pay/door/ABCD2345");
  assertEquals(body.subtotalCents, 4000);
  // 1.5% take rate + 3% service fee, both passed to the guest.
  assertEquals(body.feeCents, 180);
  assertEquals(body.totalCents, 4180);
  assertEquals(body.currency, "USD");
  assertEquals(body.expiresAt, new Date(NOW + 10 * 60 * 1000).toISOString());
  assertEquals(body.lines[0].name, "Door entry");
  const [insert] = db.opsOn("door_pay_codes", "insert");
  const row = insert.payload as Record<string, unknown>;
  assertEquals(row.total_cents, 4180);
  assertEquals(row.created_by, ACTOR);
  assertEquals(row.provider, "stripe");
  // The stored basket carries ids and quantities only; prices stay on the server.
  assertEquals(row.lines, [{ ticketTypeId: TIER, quantity: 2 }]);
});

Deno.test("#4271 create refuses a caller without the payment permission", async () => {
  const db = makeDb({ canTake: false });
  const res = await handler(db)(post({
    action: "create",
    eventId: EVENT,
    lines: [{ ticketTypeId: TIER, quantity: 1 }],
  }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, "door_access_denied");
  assertEquals(db.opsOn("door_pay_codes").length, 0);
  assert(!db.rpcs.some((r) => r.name === "issue_4271_door_quote_lines"));
});

Deno.test("#4271 create draws a new code on a collision", async () => {
  const db = makeDb({ insertErrors: [{ message: "duplicate", code: "23505" }] });
  const res = await handler(db, ["AAAA2222", "BBBB3333"])(post({
    action: "create",
    eventId: EVENT,
    lines: [{ ticketTypeId: TIER, quantity: 1 }],
  }));
  assertEquals((await res.json()).code, "BBBB3333");
});

Deno.test("#4271 view is public, opens the code and carries no buyer data", async () => {
  const db = makeDb({
    codeRow: {
      id: CODE_ID,
      event_id: EVENT,
      event_date_id: null,
      lines: [{ ticketTypeId: TIER, quantity: 2 }],
      currency: "USD",
      subtotal_cents: 4000,
      fee_cents: 180,
      total_cents: 4180,
      status: "open",
      expires_at: new Date(NOW + 60_000).toISOString(),
      events: { title: "Door night", location_text: "The Hall", city: "Austin", brands: { name: "Brand" } },
    },
  });
  const res = await handler(db)(post({ action: "view", code: "abcd2345" }, false));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "opened");
  assertEquals(body.eventId, EVENT);
  assertEquals(body.eventDateId, null);
  assertEquals(body.eventName, "Door night");
  assertEquals(body.venueLabel, "The Hall");
  assertEquals(body.brandName, "Brand");
  assertEquals(body.totalCents, 4180);
  assertEquals(body.lines, [{ ticketTypeId: TIER, name: "Door entry", quantity: 2, unitCents: 2000 }]);
  for (const key of Object.keys(body)) {
    assert(!/buyer|email|phone|created_by|order/i.test(key), `view leaked ${key}`);
  }
  const flip = db.opsOn("door_pay_codes", "update")[0];
  assertEquals((flip.payload as Record<string, unknown>).status, "opened");
});

Deno.test("#4271 view reports an expired code as expired and stores it", async () => {
  const db = makeDb({
    codeRow: {
      id: CODE_ID, event_id: EVENT, event_date_id: null,
      lines: [{ ticketTypeId: TIER, quantity: 1 }], currency: "USD",
      subtotal_cents: 2000, fee_cents: 0, total_cents: 2000, status: "opened",
      expires_at: new Date(NOW - 1).toISOString(),
      events: { title: "Door night", location_text: null, city: null, brands: { name: "B" } },
    },
  });
  const body = await (await handler(db)(post({ action: "view", code: "ABCD2345" }, false))).json();
  assertEquals(body.status, "expired");
  // Rework (#4271 D4): the expiry is stored by the close RPC, which also
  // closes the checkout the code opened.
  const close = db.rpcs.find((r) => r.name === "issue_4271_door_pay_code_close");
  assertEquals(close?.args, { p_code_id: CODE_ID, p_status: "expired", p_confirmed_pages: [] });
  assertEquals(db.opsOn("door_pay_codes", "update").length, 0);
});

const LIVE_CODE = {
  id: CODE_ID, event_id: EVENT, code: "ABCD2345", status: "opened",
  expires_at: new Date(NOW + 60_000).toISOString(),
};

Deno.test("#4271 text_link sends the pay link to the guest's number", async () => {
  const db = makeDb({ codeRow: LIVE_CODE });
  const res = await handler(db)(post({
    action: "text_link", codeId: CODE_ID, phone: "07700 900123", phoneCountryIso: "GB",
  }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { sent: true, last4: "0123" });
  const call = db.rpcs.find((r) => r.name === "issue_4271_door_pay_code_text_link")!;
  assertEquals(call.args.p_phone_e164, "+447700900123");
  assertEquals(call.args.p_pay_url, "https://host.usemingla.com/pay/door/ABCD2345");
});

Deno.test("#4271 text_link stops after three texts", async () => {
  const db = makeDb({ codeRow: LIVE_CODE, textLinkError: "text_link_limit_reached" });
  const res = await handler(db)(post({
    action: "text_link", codeId: CODE_ID, phone: "+447700900123", phoneCountryIso: "GB",
  }));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error, "text_link_limit_reached");
});

Deno.test("#4271 cancel refuses a paid code", async () => {
  const db = makeDb({ codeRow: { ...LIVE_CODE, status: "paid" } });
  const res = await handler(db)(post({ action: "cancel", codeId: CODE_ID }));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).status, "paid");
  assertEquals(db.opsOn("door_pay_codes", "update").length, 0);
});

Deno.test("#4271 codes use the readable alphabet and the pay URL shape", () => {
  for (let i = 0; i < 200; i += 1) assert(DOOR_CODE_RE.test(generateDoorCode()));
  assertEquals(makeDoorPayUrl("https://host.usemingla.com/", "ABCD2345"),
    "https://host.usemingla.com/pay/door/ABCD2345");
  assertEquals(effectiveDoorCodeStatus("open", new Date(NOW - 1).toISOString(), NOW), "expired");
  assertEquals(effectiveDoorCodeStatus("paid", new Date(NOW - 1).toISOString(), NOW), "paid");
});

Deno.test("#4271 door money follows the event's pass switches", () => {
  const absorbed = computeDoorMoney(
    { ...PRICING_ROW, pass_mingla_fee: false, pass_service_fee: false },
    "stripe",
    4000,
  );
  assertEquals(absorbed.totalCents, 4000);
  assertEquals(absorbed.applicationFeeCents, 180);
  const ng = computeDoorMoney(
    { ...PRICING_ROW, pricing_currency: "NGN", pass_tax: true, vat_rate_bps: 750 },
    "paystack",
    10000,
  );
  // 10000 + 150 + 300 = 10450, plus 7.5% VAT passed = 784 -> 11234
  assertEquals(ng.totalCents, 11234);
});

Deno.test("#4271 retest T4: cancel asks Stripe first, then closes the code and its checkout", async () => {
  const db = makeDb({ codeRow: LIVE_CODE, livePages: [STRIPE_PAGE] });
  const stripe = fakeCheckoutStripe({ db });
  const res = await handler(db, undefined, stripe.client)(post({ action: "cancel", codeId: CODE_ID }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: "cancelled" });
  assertEquals(stripe.expired, [{
    id: "cs_door_live",
    options: { stripeAccount: "acct_door1", idempotencyKey: "ticket-attempt-1:expire" },
  }]);
  // Nothing was closed when Stripe was asked.
  assert(!stripe.rpcsBeforeExpire()!.includes("issue_4271_door_pay_code_close"));
  const close = db.rpcs.find((r) => r.name === "issue_4271_door_pay_code_close");
  assertEquals(close?.args, {
    p_code_id: CODE_ID,
    p_status: "cancelled",
    p_confirmed_pages: ["cs_door_live"],
  });
  // The code row is never written around the RPC.
  assertEquals(db.opsOn("door_pay_codes", "update").length, 0);
});

Deno.test("#4271 retest T4: cancel on a page Stripe says is paid leaves the code payable", async () => {
  const db = makeDb({ codeRow: LIVE_CODE, livePages: [STRIPE_PAGE] });
  const stripe = fakeCheckoutStripe({ db, page: "complete" });
  const res = await handler(db, undefined, stripe.client)(post({ action: "cancel", codeId: CODE_ID }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: "payment_landing" });
  assertEquals(db.rpcs.filter((r) => r.name === "issue_4271_door_pay_code_close").length, 0);
});

Deno.test("#4271 retest T4: no answer from Stripe closes nothing and claims nothing", async () => {
  const db = makeDb({ codeRow: LIVE_CODE, livePages: [STRIPE_PAGE] });
  const stripe = fakeCheckoutStripe({ db, expireThrows: true, retrieveThrows: true });
  const res = await handler(db, undefined, stripe.client)(post({ action: "cancel", codeId: CODE_ID }));
  assertEquals(await res.json(), { status: "checking" });
  assertEquals(db.rpcs.filter((r) => r.name === "issue_4271_door_pay_code_close").length, 0);
});

Deno.test("#4271 retest T4: Stripe refusing because the page already expired still closes", async () => {
  const db = makeDb({ codeRow: LIVE_CODE, livePages: [STRIPE_PAGE] });
  const stripe = fakeCheckoutStripe({ db, page: "expired" });
  const res = await handler(db, undefined, stripe.client)(post({ action: "cancel", codeId: CODE_ID }));
  assertEquals(await res.json(), { status: "cancelled" });
});

Deno.test("#4271 retest T4: a page that opened mid-close sends the close back to Stripe", async () => {
  const db = makeDb({
    codeRow: LIVE_CODE,
    livePages: [STRIPE_PAGE],
    closeResult: [{ status: "retry", stripeExpire: [] }, { status: "cancelled", stripeExpire: [] }],
  });
  const stripe = fakeCheckoutStripe({ db });
  const res = await handler(db, undefined, stripe.client)(post({ action: "cancel", codeId: CODE_ID }));
  assertEquals(await res.json(), { status: "cancelled" });
  assertEquals(stripe.expired.length, 2);
});

Deno.test("#4271 rework: a code paid while the host cancels answers paid", async () => {
  const db = makeDb({ codeRow: LIVE_CODE, closeResult: { status: "paid", stripeExpire: [] } });
  const res = await handler(db)(post({ action: "cancel", codeId: CODE_ID }));
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "door_code_unavailable", status: "paid" });
});

const PAST_CODE = {
  id: CODE_ID, event_id: EVENT, event_date_id: null, code: "ABCD2345",
  lines: [{ ticketTypeId: TIER, quantity: 1 }], currency: "USD",
  subtotal_cents: 2000, fee_cents: 0, total_cents: 2000, status: "opened",
  expires_at: new Date(NOW - 1).toISOString(),
  events: { title: "Door night", location_text: null, city: null, brands: { name: "B" } },
};

Deno.test("#4271 retest T4: a guest's view past 10 minutes can't kill a payment going through", async () => {
  const db = makeDb({ codeRow: PAST_CODE, livePages: [STRIPE_PAGE] });
  const stripe = fakeCheckoutStripe({ db, page: "complete" });
  const body = await (await handler(db, undefined, stripe.client)(
    post({ action: "view", code: "ABCD2345" }, false),
  )).json();
  assertEquals(body.status, "payment_landing");
  assertEquals(db.rpcs.filter((r) => r.name === "issue_4271_door_pay_code_close").length, 0);
});

Deno.test("#4271 retest T3: a closed code's view names a late refund, never the buyer", async () => {
  const db = makeDb({
    codeRow: { ...PAST_CODE, status: "cancelled" },
    latePayment: { state: "refunding", amountCents: 3135, currency: "GBP" },
  });
  const body = await (await handler(db)(post({ action: "view", code: "ABCD2345" }, false))).json();
  assertEquals(body.status, "cancelled");
  assertEquals(body.latePayment, { state: "refunding", amountCents: 3135, currency: "GBP" });
});

Deno.test("#4271 retest T4: settle is the server's answer to the host's clock", async () => {
  // Not past its time on the server's clock: nothing closes.
  const early = makeDb({ codeRow: LIVE_CODE });
  assertEquals(
    await (await handler(early)(post({ action: "settle", codeId: CODE_ID }))).json(),
    { status: "opened" },
  );
  assertEquals(early.rpcs.filter((r) => r.name === "issue_4271_door_pay_code_close").length, 0);
  // Past its time with a paid page: the code stays open for finalize.
  const landing = makeDb({ codeRow: PAST_CODE, livePages: [STRIPE_PAGE] });
  const stripe = fakeCheckoutStripe({ db: landing, page: "complete" });
  assertEquals(
    await (await handler(landing, undefined, stripe.client)(post({ action: "settle", codeId: CODE_ID }))).json(),
    { status: "payment_landing" },
  );
  assertEquals(landing.rpcs.filter((r) => r.name === "issue_4271_door_pay_code_close").length, 0);
  // Past its time with nothing live: closed, and only now "expired".
  const quiet = makeDb({ codeRow: PAST_CODE });
  assertEquals(
    await (await handler(quiet)(post({ action: "settle", codeId: CODE_ID }))).json(),
    { status: "expired" },
  );
  // A host without door payment access gets nothing.
  assertEquals(
    (await handler(makeDb({ codeRow: PAST_CODE, canTake: false }))(post({ action: "settle", codeId: CODE_ID }))).status,
    400,
  );
});

Deno.test("#4271 retest T4: the sweep closes due codes Stripe-first and only for the service role", async () => {
  const db = makeDb({ dueCodes: [CODE_ID], livePages: [STRIPE_PAGE] });
  const stripe = fakeCheckoutStripe({ db });
  const sweep = (authorization: string | null) =>
    createDoorPayCodeHandler({
      serviceClient: () => db,
      userIdFromAuthHeader: () => Promise.resolve(null),
      now: () => NOW,
      generateCode: () => "ZZZZ2222",
      stripe: () => stripe.client,
      serviceRoleKey: () => "service-key",
    })(new Request("https://example.test/fn", {
      method: "POST",
      headers: authorization === null ? {} : { authorization },
      body: JSON.stringify({ action: "sweep" }),
    }));
  assertEquals((await sweep(null)).status, 401);
  assertEquals((await sweep("Bearer user-token")).status, 401);
  assertEquals(db.rpcs.filter((r) => r.name === "issue_4271_door_pay_codes_due").length, 0);
  assertEquals(await (await sweep("Bearer service-key")).json(), { swept: { expired: 1 } });
  assert(!stripe.rpcsBeforeExpire()!.includes("issue_4271_door_pay_code_close"));
  assertEquals(db.rpcs.find((r) => r.name === "issue_4271_door_pay_code_close")?.args.p_status, "expired");
});

Deno.test("#4271 rework: Show a new code closes the code it replaces first", async () => {
  const OLD = "42710000-0000-4000-8000-0000000000aa";
  const newCode = () => post({
    action: "create", eventId: EVENT, eventDateId: null,
    lines: [{ ticketTypeId: TIER, quantity: 2 }],
    replacesCodeId: OLD,
  });
  const db = makeDb({
    codeRow: { id: OLD, event_id: EVENT, status: "opened" },
    livePages: [STRIPE_PAGE],
  });
  const stripe = fakeCheckoutStripe({ db });
  const res = await handler(db, undefined, stripe.client)(newCode());
  assertEquals(res.status, 200);
  const close = db.rpcs.find((r) => r.name === "issue_4271_door_pay_code_close");
  assertEquals(close?.args, { p_code_id: OLD, p_status: "expired", p_confirmed_pages: ["cs_door_live"] });
  assertEquals(stripe.expired.length, 1);
  // The old code is closed before the new one exists.
  const insertAt = db.ops.findIndex((op) => op.table === "door_pay_codes" && op.action === "insert");
  assert(insertAt > 0);
  const replacedPaid = makeDb({
    codeRow: { id: OLD, event_id: EVENT, status: "opened" },
    closeResult: { status: "paid", stripeExpire: [] },
  });
  const paidRes = await handler(replacedPaid)(newCode());
  assertEquals(paidRes.status, 409);
  assertEquals(replacedPaid.opsOn("door_pay_codes", "insert").length, 0);
  // A payment going through on the old page: no second code, the host hears why.
  const landing = makeDb({
    codeRow: { id: OLD, event_id: EVENT, status: "opened" },
    livePages: [STRIPE_PAGE],
  });
  const landingRes = await handler(landing, undefined, fakeCheckoutStripe({ page: "complete" }).client)(newCode());
  assertEquals(landingRes.status, 409);
  assertEquals(await landingRes.json(), { error: "door_code_unavailable", status: "payment_landing" });
  assertEquals(landing.opsOn("door_pay_codes", "insert").length, 0);
});

Deno.test("#4271 retest T6: a tax added on top at checkout refuses the pay code and the quote", async () => {
  for (const action of ["quote", "create"]) {
    const db = makeDb({ pricing: { pass_tax: true, pricing_region: "US" } });
    const res = await handler(db)(post({
      action, eventId: EVENT, eventDateId: null, lines: [{ ticketTypeId: TIER, quantity: 1 }],
    }));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, "door_tax_added_at_checkout");
    assertEquals(db.opsOn("door_pay_codes", "insert").length, 0);
  }
  // Host absorbs in the US, and an inclusive region passing tax: total can't grow.
  for (const pricing of [{ pass_tax: false, pricing_region: "US" }, { pass_tax: true, pricing_region: "GB" }]) {
    const res = await handler(makeDb({ pricing }))(post({
      action: "quote", eventId: EVENT, eventDateId: null, lines: [{ ticketTypeId: TIER, quantity: 1 }],
    }));
    assertEquals(res.status, 200);
  }
});

Deno.test("#4271 rework: quote answers the real total with no row written", async () => {
  const db = makeDb();
  const res = await handler(db)(post({
    action: "quote", eventId: EVENT, eventDateId: null,
    lines: [{ ticketTypeId: TIER, quantity: 2, priceCents: 1 }],
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.subtotalCents, 4000);
  assertEquals(body.currency, "USD");
  assert(body.feeCents > 0 && body.totalCents === body.subtotalCents + body.feeCents);
  assertEquals(db.opsOn("door_pay_codes").length, 0);
  const denied = await handler(makeDb({ canTake: false }))(post({
    action: "quote", eventId: EVENT, lines: [{ ticketTypeId: TIER, quantity: 1 }],
  }));
  assertEquals(denied.status, 400);
  assertEquals((await denied.json()).error, "door_access_denied");
  const anon = await handler(makeDb())(post({ action: "quote", eventId: EVENT, lines: [] }, false));
  assertEquals(anon.status, 401);
});
