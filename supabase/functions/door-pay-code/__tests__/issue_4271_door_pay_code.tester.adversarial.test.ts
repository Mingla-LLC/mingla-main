// Issue #4271 — door-pay-code TESTER adversarial suite. Different angles from
// the implementor's happy path:
//   * view: a row that carries buyer / session / order / creator data (as a
//     future select or a joined row would) never leaks any of it, the select
//     never asks for buyer columns, and every answer key is on a whitelist.
//   * create: a phone that sends its own totals, prices and fee is ignored;
//     the server quote is the only source of money in the insert and answer.
//   * create / cancel / text_link: brand A's event manager on brand B's event
//     is refused BEFORE any write, and no bearer answers 401 before any read.
//   * text_link: an ambiguous legacy number is refused without a send, and a
//     cancelled code's refusal maps to 409 (not a 500).
//   * cancel (DEFECT probe): cancelling a code the guest has already opened
//     must also close the guest's in-flight checkout session, because the host
//     is then told "Nothing was charged".
//
// FAILS-ON-REVERT (verified by the tester): drop the canTakeDoorPayment check
// in handleCreate -> "brand A's manager cannot make ... brand B's code" fails.
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

const EVENT_B = "42719000-0000-4000-8000-0000000000b1";
const TIER = "42719000-0000-4000-8000-0000000000b2";
const BRAND_B = "42719000-0000-4000-8000-0000000000b3";
const CODE_ID = "42719000-0000-4000-8000-0000000000b4";
const MANAGER_OF_A = "42719000-0000-4000-8000-0000000000b5";
const SESSION = "42719000-0000-4000-8000-0000000000b6";
const NOW = Date.parse("2026-11-04T21:00:00Z");

const PII_EMAIL = "secret.guest@example.test";
const PII_PHONE = "+447700900999";
const PII_ORDER = "42719000-0000-4000-8000-0000000000e1";
const PII_CREATOR = "42719000-0000-4000-8000-0000000000e2";

function db(options: {
  canTake?: boolean;
  codeRow?: Record<string, unknown> | null;
  textLinkError?: string | null;
  selects?: string[];
}) {
  const fake = new FakeDb(
    (op: DbOp) => {
      if (op.table === "events") {
        return {
          data: { brands: { stripe_charges_enabled: true, payout_hold_cutover_at: null } },
          error: null,
        };
      }
      if (op.table === "door_pay_codes" && op.action === "insert") {
        const p = op.payload as Record<string, unknown>;
        return { data: { id: CODE_ID, code: p.code, expires_at: p.expires_at }, error: null };
      }
      if (op.table === "door_pay_codes" && op.action === "select") {
        return { data: options.codeRow ?? null, error: null };
      }
      if (op.table === "door_pay_codes" && op.action === "update") {
        return { data: { status: (op.payload as Record<string, unknown>).status }, error: null };
      }
      if (op.table === "ticket_types") {
        return { data: [{ id: TIER, name: "General", price_cents: 1500 }], error: null };
      }
      if (op.table === "event_dates") {
        return { data: [{ start_at: "2026-11-04T20:00:00Z" }], error: null };
      }
      return { data: null, error: null };
    },
    (name, args) => {
      if (name === "issue_4271_can_take_door_payment") {
        return { data: options.canTake ?? true, error: null };
      }
      // Retest T4: a close reads the code's live Stripe pages first, then one
      // RPC closes the code and revokes the checkout sessions it opened.
      if (name === "issue_4271_door_pay_code_live_pages") {
        return { data: { status: "opened", pages: [] }, error: null };
      }
      if (name === "issue_4271_door_pay_code_close") {
        return { data: { status: args.p_status, stripeExpire: [] }, error: null };
      }
      if (name === "issue_4271_door_quote_lines") {
        return {
          data: {
            brandId: BRAND_B,
            currency: "USD",
            subtotalCents: 3000,
            lines: [{ ticketTypeId: TIER, name: "General", quantity: 2, unitCents: 1500 }],
          },
          error: null,
        };
      }
      if (name === "resolve_event_pricing_inputs") return { data: [PRICING_ROW], error: null };
      if (name === "issue_4271_door_pay_code_text_link") {
        return options.textLinkError
          ? { data: null, error: { message: options.textLinkError } }
          : { data: { sent: true, count: 1 }, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  );
  // Record every column list the function asks for.
  const from = fake.from.bind(fake);
  // deno-lint-ignore no-explicit-any
  (fake as any).from = (table: string) => {
    const q = from(table);
    const select = q.select.bind(q);
    // deno-lint-ignore no-explicit-any
    (q as any).select = (columns?: string) => {
      options.selects?.push(`${table}:${columns ?? "*"}`);
      return select(columns);
    };
    return q;
  };
  return fake;
}

function handler(fake: FakeDb, actor: string | null = MANAGER_OF_A) {
  return createDoorPayCodeHandler({
    serviceClient: () => fake,
    userIdFromAuthHeader: (req) =>
      Promise.resolve(req.headers.get("authorization") ? actor : null),
    now: () => NOW,
    generateCode: () => "QRST2345",
  });
}

Deno.test("#4271 tester: view never leaks buyer, session, order or creator data", async () => {
  const selects: string[] = [];
  const fake = db({
    selects,
    codeRow: {
      id: CODE_ID,
      event_id: EVENT_B,
      event_date_id: null,
      lines: [{ ticketTypeId: TIER, quantity: 2 }],
      currency: "USD",
      subtotal_cents: 3000,
      fee_cents: 140,
      total_cents: 3140,
      status: "paid",
      expires_at: new Date(NOW - 60_000).toISOString(),
      // Columns a careless select or join could carry back:
      buyer_email: PII_EMAIL,
      buyer_phone_e164: PII_PHONE,
      order_id: PII_ORDER,
      checkout_session_id: SESSION,
      created_by: PII_CREATOR,
      failure_reason: "card_declined for " + PII_EMAIL,
      events: { title: "Night", location_text: null, city: "London", brands: { name: "B" } },
    },
  });
  const res = await handler(fake, null)(post({ action: "view", code: "QRST2345" }, false));
  assertEquals(res.status, 200);
  const text = await res.text();
  for (const secret of [PII_EMAIL, PII_PHONE, PII_ORDER, SESSION, PII_CREATOR, "card_declined"]) {
    assert(!text.includes(secret), `view leaked ${secret}`);
  }
  const body = JSON.parse(text);
  const allowed = new Set([
    "status", "eventId", "eventDateId", "eventName", "eventStartsAt", "venueLabel",
    "brandName", "lines", "subtotalCents", "feeCents", "totalCents", "currency", "expiresAt",
    // Final test P2-1: the provider name (stripe/paystack) is public and the
    // guest page needs it so a Paystack guest is never told they weren't charged.
    "provider",
  ]);
  for (const key of Object.keys(body)) assert(allowed.has(key), `view answered extra key ${key}`);
  assertEquals(body.status, "paid", "a paid code past its time stays paid, never expired");
  const codeSelect = selects.find((s) => s.startsWith("door_pay_codes:")) ?? "";
  assert(!/buyer|email|phone|created_by|order_id|checkout_session|ticket_checkout_sessions|orders/.test(codeSelect),
    `view selects private columns: ${codeSelect}`);
  // A paid (or expired) code is never re-flipped by a public read.
  assertEquals(fake.opsOn("door_pay_codes", "update").length, 0);
});

Deno.test("#4271 tester: create ignores the phone's own totals, prices and fee", async () => {
  const fake = db({});
  const res = await handler(fake)(post({
    action: "create",
    eventId: EVENT_B,
    eventDateId: null,
    lines: [{ ticketTypeId: TIER, quantity: 2, unitCents: 1, priceCents: 1 }],
    totalCents: 1,
    subtotalCents: 1,
    feeCents: 0,
    currency: "NGN",
    provider: "paystack",
    status: "paid",
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  const insert = fake.opsOn("door_pay_codes", "insert")[0].payload as Record<string, unknown>;
  assertEquals(insert.subtotal_cents, 3000);
  assert((insert.total_cents as number) > 3000, "the server fee must be added");
  assertEquals(insert.currency, "USD");
  assertEquals(insert.provider, "stripe");
  assertEquals(insert.status, "open");
  assertEquals(insert.lines, [{ ticketTypeId: TIER, quantity: 2 }]);
  assertEquals(body.totalCents, insert.total_cents);
  assertEquals(body.subtotalCents, 3000);
  assertEquals(body.lines[0].unitCents, 1500);
  assertEquals(body.payUrl, "https://host.usemingla.com/pay/door/QRST2345");
});

Deno.test("#4271 tester: brand A's manager cannot make, cancel or text brand B's code", async () => {
  const LIVE = {
    id: CODE_ID, event_id: EVENT_B, code: "QRST2345", status: "opened",
    expires_at: new Date(NOW + 60_000).toISOString(),
  };
  for (const body of [
    { action: "create", eventId: EVENT_B, lines: [{ ticketTypeId: TIER, quantity: 1 }] },
    { action: "cancel", codeId: CODE_ID },
    { action: "text_link", codeId: CODE_ID, phone: "+447700900123", phoneCountryIso: "GB" },
  ]) {
    const fake = db({ canTake: false, codeRow: LIVE });
    const res = await handler(fake)(post(body));
    assertEquals(res.status, 400, `${body.action} must be refused`);
    assertEquals((await res.json()).error, "door_access_denied");
    assertEquals(fake.opsOn("door_pay_codes", "insert").length, 0, `${body.action} inserted`);
    assertEquals(fake.opsOn("door_pay_codes", "update").length, 0, `${body.action} updated`);
    assert(!fake.rpcs.some((r) => r.name === "issue_4271_door_quote_lines"), `${body.action} priced`);
    assert(!fake.rpcs.some((r) => r.name === "issue_4271_door_pay_code_text_link"), `${body.action} texted`);
  }
});

Deno.test("#4271 tester: no bearer is 401 before any read or write", async () => {
  for (const body of [
    { action: "create", eventId: EVENT_B, lines: [{ ticketTypeId: TIER, quantity: 1 }] },
    { action: "cancel", codeId: CODE_ID },
    { action: "text_link", codeId: CODE_ID, phone: "+447700900123" },
  ]) {
    const fake = db({ codeRow: { id: CODE_ID, event_id: EVENT_B, code: "QRST2345", status: "open", expires_at: new Date(NOW + 1).toISOString() } });
    const res = await handler(fake, null)(post(body, false));
    assertEquals(res.status, 401, `${body.action} without a bearer`);
    assertEquals(fake.ops.length, 0, `${body.action} touched a table`);
    assertEquals(fake.rpcs.length, 0, `${body.action} called an rpc`);
  }
});

Deno.test("#4271 tester: text_link refuses an ambiguous number and maps a dead code to 409", async () => {
  const LIVE = {
    id: CODE_ID, event_id: EVENT_B, code: "QRST2345", status: "opened",
    expires_at: new Date(NOW + 60_000).toISOString(),
  };
  const bad = db({ codeRow: LIVE });
  const badRes = await handler(bad)(post({ action: "text_link", codeId: CODE_ID, phone: "12345" }));
  assertEquals(badRes.status, 400);
  assertEquals((await badRes.json()).error, "buyer_phone_invalid");
  assert(!bad.rpcs.some((r) => r.name === "issue_4271_door_pay_code_text_link"));

  const dead = db({ codeRow: LIVE, textLinkError: "door_code_unavailable" });
  const deadRes = await handler(dead)(post({
    action: "text_link", codeId: CODE_ID, phone: "+447700900123", phoneCountryIso: "GB",
  }));
  assertEquals(deadRes.status, 409);
  assertEquals((await deadRes.json()).error, "door_code_unavailable");
});

Deno.test("#4271 tester DEFECT: cancelling an opened code closes the guest's in-flight checkout", async () => {
  // The guest opened the code and is on the provider's page (the code is
  // linked to their checkout session). The host taps "Cancel sale" and is
  // told "The code no longer works. Nothing was charged." That is only true if
  // the cancel also stops the session: today the session stays payable and a
  // later payment flips the cancelled code to paid (reproduced on PG17).
  const fake = db({
    codeRow: {
      id: CODE_ID, event_id: EVENT_B, code: "QRST2345", status: "opened",
      checkout_session_id: SESSION,
      expires_at: new Date(NOW + 60_000).toISOString(),
    },
  });
  const res = await handler(fake)(post({ action: "cancel", codeId: CODE_ID }));
  assertEquals(res.status, 200);
  const closedSession = fake.ops.some((op) =>
    op.table === "ticket_checkout_sessions" && op.action === "update"
  ) || fake.rpcs.some((r) => /revoke|expire|cancel|close/i.test(r.name) && r.name !== "issue_4271_can_take_door_payment");
  assert(
    closedSession,
    "cancel left the linked checkout session payable: the guest can still be charged after the host is told nothing was charged",
  );
});
