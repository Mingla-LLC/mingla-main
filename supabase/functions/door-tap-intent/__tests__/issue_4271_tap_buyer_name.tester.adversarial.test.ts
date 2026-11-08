// Issue #4271 follow-up — independent tester adversarial proof for the buyer
// name door-tap-intent create stores on the intent. A different angle from the
// implementor's happy path:
//   - the RE-PRICE branch (an earlier attempt stored the intent but never
//     reached Stripe) carries the name in its UPDATE, and a replay of an intent
//     that already has a PaymentIntent writes nothing at all;
//   - names made only of whitespace JavaScript trims but Postgres btrim does
//     not (tab, newline, NBSP, ideographic space) store no name, and padded
//     names are stored trimmed;
//   - every name the edge stores satisfies the column's CHECK
//     (buyer_name = btrim(buyer_name) AND char_length BETWEEN 1 AND 120, with
//     char_length counting code points), so a name the edge accepts can never
//     turn into a 500 at insert; and every name it refuses is refused before
//     any write or Stripe call;
//   - the name stays out of the logs on the failure path too.
//
// fails-on-revert: dropping buyer_name from intentRow, or doorTapBuyerName's
// trim, fails an assertion here.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createDoorTapIntentHandler } from "../index.ts";
import {
  type DbOp,
  FakeDb,
  fakeStripe,
  post,
  PRICING_ROW,
} from "../../_shared/__tests__/doorPayFakes.ts";

const EVENT = "42710000-0000-4000-8000-0000000000c1";
const TIER = "42710000-0000-4000-8000-0000000000c2";
const BRAND = "42710000-0000-4000-8000-0000000000c3";
const ACTOR = "42710000-0000-4000-8000-0000000000c4";
const REQ = "42710000-0000-4000-8000-0000000000c5";
const INTENT = "42710000-0000-4000-8000-0000000000c6";

type Existing = null | { stripe_payment_intent_id: string | null };

function makeDb(existing: Existing, insertError: string | null = null) {
  return new FakeDb(
    (op: DbOp) => {
      if (op.table === "events") {
        return {
          data: {
            brand_id: BRAND,
            brands: {
              id: BRAND, name: "Door Brand", address: "1 Main St", city: "Austin",
              country_code: "US", payment_country: "US", payment_provider: "stripe",
              stripe_connect_id: "acct_door1", stripe_charges_enabled: true,
              payout_hold_cutover_at: null,
            },
          },
          error: null,
        };
      }
      if (op.table === "brand_terminal_locations" && op.action === "select") {
        return { data: null, error: null };
      }
      if (op.table === "door_tap_intents" && op.action === "select") {
        if (existing === null) return { data: null, error: null };
        return {
          data: {
            id: INTENT,
            stripe_payment_intent_id: existing.stripe_payment_intent_id,
            stripe_account_id: "acct_door1",
            stripe_location_id: "tml_door1",
            total_cents: 2090, currency: "USD", fee_cents: 90, subtotal_cents: 2000,
          },
          error: null,
        };
      }
      if (op.table === "door_tap_intents" && (op.action === "insert" || op.action === "update")) {
        if (insertError !== null) return { data: null, error: { message: insertError, code: "23514" } };
        return { data: { id: INTENT }, error: null };
      }
      return { data: null, error: null };
    },
    (name) => {
      if (name === "biz_tap_to_pay_release") return { data: { iphone: true, android: true }, error: null };
      if (name === "issue_4271_can_take_door_payment") return { data: true, error: null };
      if (name === "issue_4271_door_quote_lines") {
        return {
          data: {
            brandId: BRAND, currency: "USD", subtotalCents: 2000,
            lines: [{ ticketTypeId: TIER, name: "Door entry", quantity: 1, unitCents: 2000 }],
          },
          error: null,
        };
      }
      if (name === "resolve_event_pricing_inputs") return { data: [PRICING_ROW], error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  );
}

async function create(
  extra: Record<string, unknown>,
  existing: Existing = null,
  insertError: string | null = null,
) {
  const db = makeDb(existing, insertError);
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: () => Promise.resolve(ACTOR),
    stripe: () => stripe.client,
  })(post({
    action: "create", platform: "ios", eventId: EVENT, eventDateId: null, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1 }], ...extra,
  }));
  // The first write to the intent row is the one that carries the sale facts.
  const writes = db.ops.filter((o) =>
    o.table === "door_tap_intents" && (o.action === "insert" || o.action === "update")
  );
  const stored = (writes[0]?.payload ?? null) as Record<string, unknown> | null;
  return { res, db, stored, writes, stripe };
}

/** The column's CHECK, as Postgres evaluates it (btrim strips only U+0020). */
function satisfiesColumnCheck(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  const btrimmed = value.replace(/^ +/u, "").replace(/ +$/u, "");
  const charLength = Array.from(value).length; // char_length on UTF8 = code points
  return value === btrimmed && charLength >= 1 && charLength <= 120;
}

Deno.test("#4271 tester: the re-price branch carries the name in its UPDATE", async () => {
  const { res, db, stored } = await create(
    { buyerName: "\tAda Lovelace\n" },
    { stripe_payment_intent_id: null },
  );
  assertEquals(res.status, 200);
  assertEquals(db.opsOn("door_tap_intents", "insert").length, 0, "re-price must not insert a second intent");
  const updates = db.opsOn("door_tap_intents", "update");
  assert(updates.length >= 1, "the existing intent is re-priced");
  assert(stored !== null);
  assertEquals(stored.buyer_name, "Ada Lovelace");
  assertEquals(stored.buyer_phone_e164, null);
  // Guarded so a racing attempt that already reached Stripe is not overwritten.
  assert(
    updates[0].filters.some(([op, col, v]) => op === "is" && col === "stripe_payment_intent_id" && v === null),
    "the re-price update must stay guarded on stripe_payment_intent_id IS NULL",
  );
});

Deno.test("#4271 tester: a replay of an intent that reached Stripe writes no name", async () => {
  const { res, writes, stripe } = await create(
    { buyerName: "Someone Else" },
    { stripe_payment_intent_id: "pi_existing1" },
  );
  assertEquals(res.status, 200);
  assertEquals(writes.length, 0, "a replay must not rewrite the stored intent");
  assertEquals(stripe.calls.filter((c) => c.method === "paymentIntents.create").length, 0);
});

Deno.test("#4271 tester: whitespace only JavaScript trims is no name; padding is trimmed", async () => {
  for (const blank of ["\t", "\n", "\r\n", " ", "　", "﻿", " \t \n "]) {
    const { res, stored } = await create({ buyerName: blank });
    assertEquals(res.status, 200, `blank ${JSON.stringify(blank)} must not be refused`);
    assert(stored !== null);
    assertEquals(stored.buyer_name ?? null, null, `blank ${JSON.stringify(blank)} must store no name`);
  }
  const { stored } = await create({ buyerName: " 　 Ada Lovelace \t\n" });
  assertEquals(stored?.buyer_name, "Ada Lovelace");
});

Deno.test("#4271 tester: every stored name satisfies the column CHECK; every refusal writes nothing", async () => {
  const family = "\u{1F468}‍\u{1F469}‍\u{1F467}"; // 5 code points
  const hostile: unknown[] = [
    "Ada\tLovelace", "Ada\nLovelace", "Ada Lovelace", "​Ada", "é".repeat(60),
    "\u{1F600}".repeat(120), "\u{1F600}".repeat(121), family.repeat(24), family.repeat(24) + "x",
    " " + "x".repeat(120) + " ", "\t" + "x".repeat(121), "x".repeat(119) + "́́",
    "Ada", "  ", 0, false, [], {},
  ];
  for (const buyerName of hostile) {
    const { res, stored, writes, stripe } = await create({ buyerName });
    const label = JSON.stringify(buyerName);
    if (res.status === 200) {
      assert(stored !== null);
      assert(satisfiesColumnCheck(stored.buyer_name), `accepted ${label} would violate the CHECK`);
    } else {
      assertEquals(res.status, 400, `${label} must be a 400, not ${res.status}`);
      assertEquals((await res.json()).error, "buyer_name_invalid");
      assertEquals(writes.length, 0, `${label} wrote before refusing`);
      assertEquals(stripe.calls.length, 0, `${label} reached Stripe before refusing`);
    }
  }
  // The exact boundary, in code points.
  assertEquals((await create({ buyerName: "\u{1F600}".repeat(120) })).res.status, 200);
  assertEquals((await create({ buyerName: "\u{1F600}".repeat(121) })).res.status, 400);
  assertEquals((await create({ buyerName: family.repeat(24) + "x" })).res.status, 400);
  assertEquals((await create({ buyerName: " " + "x".repeat(120) + " " })).res.status, 200);
});

Deno.test("#4271 tester: the name stays out of the logs when the intent write fails", async () => {
  const NAME = "Quentin Neverlogged";
  const lines: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const sink = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = sink; console.info = sink; console.warn = sink; console.error = sink; console.debug = sink;
  try {
    const failed = await create(
      { buyerName: NAME },
      null,
      'new row for relation "door_tap_intents" violates check constraint "door_tap_intents_buyer_name_check"',
    );
    assertEquals(failed.res.status, 500);
    await create({ buyerName: NAME }, { stripe_payment_intent_id: null });
    await create({ buyerName: NAME }, { stripe_payment_intent_id: "pi_existing1" });
  } finally {
    Object.assign(console, saved);
  }
  assert(lines.length > 0, "the failure path must log something");
  assert(!lines.join("\n").includes("Neverlogged"), "the buyer name was logged");
});
