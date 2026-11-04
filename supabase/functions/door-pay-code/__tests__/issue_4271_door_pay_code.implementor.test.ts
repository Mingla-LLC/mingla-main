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
} = {}) {
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
        return { data: [PRICING_ROW], error: null };
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

function handler(db: FakeDb, codes: string[] = ["ABCD2345"]) {
  const queue = [...codes];
  return createDoorPayCodeHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: (req) =>
      Promise.resolve(req.headers.get("authorization") ? ACTOR : null),
    now: () => NOW,
    generateCode: () => queue.shift() ?? "ZZZZ2222",
  });
}

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
  assertEquals(
    (db.opsOn("door_pay_codes", "update")[0].payload as Record<string, unknown>).status,
    "expired",
  );
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
