// Issue #4271 follow-up — door-tap-intent create stores the host-typed buyer
// name on the intent (door_tap_intents.buyer_name) the same way it stores the
// buyer phone, so biz_door_tap_record can copy it onto the sale.
//   - a string name is trimmed and stored; blank, null or missing stores none
//     (old app builds send nothing and still work);
//   - a non-string name, or one over 120 characters, is refused with 400
//     before anything is written or charged (the cash door sale's rule);
//   - the name never reaches a log line;
//   - a name holding U+0000 or a lone UTF-16 surrogate is refused with 400
//     (Postgres text can't store it; it used to be a 500 that echoed part of
//     the name in the database logs); valid emoji still pass;
//   - buyer_name is always in the written row (null when none), so a re-price
//     retry without a name clears a stale one, like buyer_phone_e164.
//
// fails-on-revert: dropping buyer_name from the stored intent row, the
// validation in doorTapBuyerName, the unstorable-text check, or making
// buyer_name conditional again fails an assertion here.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createDoorTapIntentHandler, DOOR_BUYER_NAME_MAX, doorTapBuyerName } from "../index.ts";
import {
  type DbOp,
  FakeDb,
  fakeStripe,
  post,
  PRICING_ROW,
} from "../../_shared/__tests__/doorPayFakes.ts";

const EVENT = "42710000-0000-4000-8000-0000000000b1";
const TIER = "42710000-0000-4000-8000-0000000000b2";
const BRAND = "42710000-0000-4000-8000-0000000000b3";
const ACTOR = "42710000-0000-4000-8000-0000000000b4";
const REQ = "42710000-0000-4000-8000-0000000000b5";
const INTENT = "42710000-0000-4000-8000-0000000000b6";

function makeDb(existing = false) {
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
        if (!existing) return { data: null, error: null };
        // An earlier attempt stored the intent but never reached Stripe.
        return {
          data: {
            id: INTENT, stripe_payment_intent_id: null, stripe_account_id: "acct_door1",
            stripe_location_id: "tml_door1", total_cents: 2090, currency: "USD",
            fee_cents: 90, subtotal_cents: 2000,
          },
          error: null,
        };
      }
      if (op.table === "door_tap_intents" && (op.action === "insert" || op.action === "update")) {
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

async function create(extra: Record<string, unknown>, existing = false) {
  const db = makeDb(existing);
  const stripe = fakeStripe();
  const res = await createDoorTapIntentHandler({
    serviceClient: () => db,
    userIdFromAuthHeader: () => Promise.resolve(ACTOR),
    stripe: () => stripe.client,
  })(post({
    action: "create", platform: "ios", eventId: EVENT, eventDateId: null, clientRequestId: REQ,
    lines: [{ ticketTypeId: TIER, quantity: 1 }], ...extra,
  }));
  const inserts = db.opsOn("door_tap_intents", "insert");
  const updates = db.opsOn("door_tap_intents", "update");
  const stored = (inserts[0]?.payload ?? updates[0]?.payload ?? null) as Record<string, unknown> | null;
  return { res, stored, inserts, updates, stripe };
}

/** Runs fn with console captured; returns everything written to the console. */
async function captureConsole(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const sink = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = sink; console.info = sink; console.warn = sink; console.error = sink; console.debug = sink;
  try {
    await fn();
  } finally {
    Object.assign(console, saved);
  }
  return lines.join("\n");
}

Deno.test("#4271 tap create stores the trimmed buyer name next to the phone", async () => {
  const { res, stored } = await create({
    buyerName: "  Ada Lovelace  ", buyerPhone: "+12025550123", phoneCountryIso: "US",
  });
  assertEquals(res.status, 200);
  assert(stored !== null, "the intent row is stored");
  assertEquals(stored.buyer_name, "Ada Lovelace");
  assertEquals(stored.buyer_phone_e164, "+12025550123");
});

Deno.test("#4271 tap create without a name stores none (old app builds)", async () => {
  for (const extra of [{}, { buyerName: null }, { buyerName: "   " }]) {
    const { res, stored } = await create(extra);
    assertEquals(res.status, 200);
    assert(stored !== null);
    assertEquals(stored.buyer_name ?? null, null);
  }
});

Deno.test("#4271 tap create refuses a non-string or too-long name before any write or charge", async () => {
  for (const buyerName of [42, true, { first: "Ada" }, ["Ada"], "x".repeat(DOOR_BUYER_NAME_MAX + 1)]) {
    const { res, inserts, stripe } = await create({ buyerName });
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, "buyer_name_invalid");
    assertEquals(inserts.length, 0);
    assertEquals(stripe.calls.length, 0);
  }
});

Deno.test("#4271 doorTapBuyerName counts characters, not UTF-16 units", () => {
  const emoji = "\u{1F600}";
  assertEquals(doorTapBuyerName(emoji.repeat(DOOR_BUYER_NAME_MAX)), {
    ok: true, value: emoji.repeat(DOOR_BUYER_NAME_MAX),
  });
  assertEquals(doorTapBuyerName(emoji.repeat(DOOR_BUYER_NAME_MAX + 1)), { ok: false });
  assertEquals(doorTapBuyerName("x".repeat(DOOR_BUYER_NAME_MAX)).ok, true);
});

Deno.test("#4271 the buyer name never reaches a log line", async () => {
  const NAME = "Zelda Unloggable Q7";
  const output = await captureConsole(async () => {
    await create({ buyerName: NAME });
    await create({ buyerName: NAME + "x".repeat(DOOR_BUYER_NAME_MAX) });
  });
  assert(!output.includes("Zelda"), "the buyer name was logged");
});

Deno.test("#4271 tap create refuses U+0000 and lone surrogates with 400, before any write or charge", async () => {
  const unstorable = [
    "Ada\u0000Lovelace", // NUL
    "\u0000",
    "Ada\uD800", // high surrogate at the end
    "Ada\uD800Lovelace", // high surrogate not followed by a low one
    "\uDC00Ada", // low surrogate with no high before it
    "Ada\uDE00\uD83D", // reversed pair
    "\uD83D\uDE00\uDE00", // a valid pair then a stray low
  ];
  for (const buyerName of unstorable) {
    assertEquals(doorTapBuyerName(buyerName), { ok: false }, JSON.stringify(buyerName));
    const { res, inserts, updates, stripe } = await create({ buyerName });
    assertEquals(res.status, 400, `${JSON.stringify(buyerName)} must be a 400`);
    assertEquals((await res.json()).error, "buyer_name_invalid");
    assertEquals(inserts.length + updates.length, 0);
    assertEquals(stripe.calls.length, 0);
  }
});

Deno.test("#4271 emoji and other astral characters still pass the unstorable-text check", async () => {
  for (const name of ["Ada \u{1F600}", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", "\u{20BB7}\u{1D11E} Zoe", "Ad\u00E9le"]) {
    assertEquals(doorTapBuyerName(name), { ok: true, value: name });
    const { res, stored } = await create({ buyerName: name });
    assertEquals(res.status, 200);
    assertEquals(stored?.buyer_name, name);
  }
});

Deno.test("#4271 buyer_name is always written, so a re-price retry without a name clears a stale one", async () => {
  // First insert without a name: the column is present and null.
  const fresh = await create({});
  assertEquals(fresh.res.status, 200);
  assert(fresh.stored !== null && "buyer_name" in fresh.stored, "insert must carry buyer_name");
  assertEquals(fresh.stored.buyer_name, null);
  // Re-price of an intent that never reached Stripe, now without a name.
  const retry = await create({}, true);
  assertEquals(retry.res.status, 200);
  assertEquals(retry.inserts.length, 0);
  assert(retry.updates.length >= 1, "the existing intent is re-priced");
  const row = retry.updates[0].payload as Record<string, unknown>;
  assert("buyer_name" in row, "re-price update must overwrite buyer_name");
  assertEquals(row.buyer_name, null);
  assert("buyer_phone_e164" in row);
  assertEquals(row.buyer_phone_e164, null);
});
