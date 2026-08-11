// ===========================================================================
// Issue #1819 H-2 — the idempotency key was a global, client-chosen namespace.
//
// Two halves, both executed:
//   * the DERIVED key collapsed to the literal "new" when no sitting existed,
//     so two counter-pickup guests at one venue derived the SAME key and the
//     second was handed the first's order;
//   * the REPLAY READ matched on the key alone, so a collision returned
//     ANOTHER BRAND'S order id, total and payment status.
//
// The read is proved against a fake client that holds a real in-memory table
// and genuinely applies the filters, so a cross-brand row is not returned
// because the QUERY excludes it — not because a stub was told to say so.
// ===========================================================================

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  venueOrderIdempotencyFingerprint,
  venueOrderIdempotencyKey,
} from "../venueOrderPricing.ts";
import { findReplayableVenueOrder } from "../venueOrderCore.ts";

const CART = [
  { menuItemId: "item-1", quantity: 1, modifierIds: [], notes: null },
];

// ---------------------------------------------------------------------------
// The collision the tester found.
// ---------------------------------------------------------------------------
Deno.test("H-2: two counter-pickup guests with identical carts do NOT collide", () => {
  // Neither has a sitting yet — this is the exact case that used to derive the
  // literal "new" for both.
  const ada = venueOrderIdempotencyFingerprint({
    scopeId: "no-session",
    buyerKey: "ada@example.test|+12015550199",
    lines: CART,
    tipBps: null,
  });
  const bola = venueOrderIdempotencyFingerprint({
    scopeId: "no-session",
    buyerKey: "bola@example.test|+12015550111",
    lines: CART,
    tipBps: null,
  });
  assertNotEquals(
    ada,
    bola,
    "two different guests ordering the same thing must not derive the same key — the second would be handed the first's order",
  );
});

Deno.test("H-2: the SAME guest retrying the SAME cart still derives one key", () => {
  // The crash-safety floor has to keep working, or the fix trades a collision
  // for a double charge.
  const first = venueOrderIdempotencyFingerprint({
    scopeId: "no-session",
    buyerKey: "ada@example.test|+12015550199",
    lines: CART,
    tipBps: null,
  });
  const retry = venueOrderIdempotencyFingerprint({
    scopeId: "no-session",
    buyerKey: "ADA@Example.Test|+12015550199",
    lines: CART,
    tipBps: null,
  });
  assertEquals(first, retry, "a retry (same caller, same cart) must collapse to one order");
});

Deno.test("H-2: two people at ONE table ordering the same round are two orders", () => {
  // The same collision inside a sitting: before the buyer was mixed in, two
  // guests at one table ordering an identical round collapsed into one order.
  const a = venueOrderIdempotencyFingerprint({
    scopeId: "session-1",
    buyerKey: "ada@example.test|+12015550199",
    lines: CART,
    tipBps: 1000,
  });
  const b = venueOrderIdempotencyFingerprint({
    scopeId: "session-1",
    buyerKey: "bola@example.test|+12015550111",
    lines: CART,
    tipBps: 1000,
  });
  assertNotEquals(a, b);
});

Deno.test("H-2: the sitting, the cart and the tip all still move the key", async () => {
  const sha = async (v: string) => {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const base = {
    scopeId: "session-1",
    buyerKey: "ada@example.test|+12015550199",
    lines: CART,
    tipBps: null as number | null,
  };
  const k = await venueOrderIdempotencyKey(base, sha);
  assertNotEquals(k, await venueOrderIdempotencyKey({ ...base, scopeId: "session-2" }, sha));
  assertNotEquals(k, await venueOrderIdempotencyKey({ ...base, tipBps: 1500 }, sha));
  assertNotEquals(
    k,
    await venueOrderIdempotencyKey({
      ...base,
      lines: [{ ...CART[0], quantity: 2 }],
    }, sha),
  );
  // ...and it is stable for identical input.
  assertEquals(k, await venueOrderIdempotencyKey({ ...base }, sha));
  assert(k.startsWith("venue_order:session-1:"));
});

// ---------------------------------------------------------------------------
// The leak. A fake client that REALLY filters.
// ---------------------------------------------------------------------------
interface Row {
  id: string;
  brand_id: string;
  venue_id: string;
  idempotency_key: string;
  total_cents: number;
  currency: string;
  payment_status: string;
}

// deno-lint-ignore no-explicit-any
function tableClient(rows: Row[], opts: { error?: string } = {}): any {
  return {
    from(_table: string) {
      const filters: Array<[string, unknown]> = [];
      const self = {
        select: () => self,
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return self;
        },
        maybeSingle() {
          if (opts.error) return Promise.resolve({ data: null, error: { message: opts.error } });
          const matched = rows.filter((r) =>
            filters.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v)
          );
          // Real PostgREST maybeSingle() errors on multiple rows; the point here
          // is what the FILTERS admit, so return the first — the pessimistic
          // reading of what the shipped unscoped read would have handed back.
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        },
      };
      return self;
    },
  };
}

const BRAND_A = "brand-a";
const BRAND_B = "brand-b";
const SHARED_KEY = "client-chosen-key-collision";
const ROWS: Row[] = [
  {
    id: "order-a",
    brand_id: BRAND_A,
    venue_id: "venue-a",
    idempotency_key: SHARED_KEY,
    total_cents: 9900,
    currency: "GBP",
    payment_status: "paid",
  },
  {
    id: "order-b",
    brand_id: BRAND_B,
    venue_id: "venue-b",
    idempotency_key: SHARED_KEY,
    total_cents: 500,
    currency: "GBP",
    payment_status: "pending",
  },
];

Deno.test("H-2: the replay read never surfaces another brand's order", async () => {
  const client = tableClient(ROWS);

  const forB = await findReplayableVenueOrder(client, {
    brandId: BRAND_B,
    venueId: "venue-b",
    idempotencyKey: SHARED_KEY,
  });
  assert(forB !== null);
  assertStrictEquals(forB.id, "order-b");
  assertStrictEquals(
    forB.total_cents,
    500,
    "brand B's guest must never be shown brand A's GBP99.00 total",
  );
  assertStrictEquals(forB.payment_status, "pending");

  const forA = await findReplayableVenueOrder(client, {
    brandId: BRAND_A,
    venueId: "venue-a",
    idempotencyKey: SHARED_KEY,
  });
  assertStrictEquals(forA?.id, "order-a");

  // Vacuity guard: if the fixture did not actually hold a colliding foreign
  // row, the assertions above prove nothing at all.
  assertStrictEquals(
    ROWS.filter((r) => r.idempotency_key === SHARED_KEY).length,
    2,
    "the collision must exist for the scoping to be under test",
  );
});

Deno.test("H-2: a key belonging to another tenant resolves to NOTHING, not to their order", async () => {
  const client = tableClient(ROWS);
  // Brand B presents brand A's venue — the cross-tenant probe.
  assertStrictEquals(
    await findReplayableVenueOrder(client, {
      brandId: BRAND_B,
      venueId: "venue-a",
      idempotencyKey: SHARED_KEY,
    }),
    null,
  );
  // A third brand that never ordered gets nothing at all.
  assertStrictEquals(
    await findReplayableVenueOrder(client, {
      brandId: "brand-c",
      venueId: "venue-c",
      idempotencyKey: SHARED_KEY,
    }),
    null,
  );
});

Deno.test("H-2: the replay read filters on ALL THREE columns", async () => {
  // Asserted on the WIRE: drop any one of the three and the query would admit a
  // foreign row. This is what makes the two tests above structural rather than
  // a property of the fixture's ordering.
  const seen: Array<[string, unknown]> = [];
  // deno-lint-ignore no-explicit-any
  const spy: any = {
    from: () => {
      const self = {
        select: () => self,
        eq: (c: string, v: unknown) => {
          seen.push([c, v]);
          return self;
        },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return self;
    },
  };
  await findReplayableVenueOrder(spy, {
    brandId: BRAND_A,
    venueId: "venue-a",
    idempotencyKey: SHARED_KEY,
  });
  assertEquals(
    seen.map(([c]) => c).sort(),
    ["brand_id", "idempotency_key", "venue_id"],
  );
});

Deno.test("H-2: a failed replay lookup throws rather than silently minting a second order", async () => {
  await assertRejects(
    () =>
      findReplayableVenueOrder(tableClient(ROWS, { error: "connection reset" }), {
        brandId: BRAND_A,
        venueId: "venue-a",
        idempotencyKey: SHARED_KEY,
      }),
    Error,
    "venue_order_replay_lookup_failed",
  );
});
