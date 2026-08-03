/**
 * ISSUE-855 PR-0 [Phase-4 honest-numbers] — server-fire COALESCE backfill of the
 * attribution columns the browser's EARLY ad_conversions row leaves NULL.
 *
 * THE BUG (repairs the live #865 undercount): every finalized order/reservation
 * fires `fireAdConversion` server-side, which resolves the REAL brand_id /
 * order_id / value_cents / currency / mingla_event_id and UPSERTs the
 * ad_conversions row. But the browser also writes an EARLY row via
 * attribution-capture::recordConversion with brand_id / order_id /
 * mingla_event_id = NULL. Because the server upsert is ON CONFLICT (event_id) DO
 * NOTHING (ignoreDuplicates:true), when the browser row WINS the race those
 * columns stayed NULL forever — so `brand_conversion_rollup` (WHERE brand_id =
 * p_brand_id) and the live "Customers Mingla drove" tile silently UNDERCOUNTED
 * web conversions.
 *
 * THE FIX (step 4b in adConversionFire.ts): after the DO-NOTHING upsert, when a
 * row already existed, COALESCE-backfill each attribution column ONLY where the
 * stored value IS NULL and this fire resolved a value — never touching the
 * per-channel *_status columns (so the redelivery-dedup gate is intact and no
 * re-send is triggered), never clobbering an already-set value.
 *
 * Append-only. Hermetic — injected spy senders + a fake supabase; NO network,
 * NO real DB, NO live ad-platform calls.
 */

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  type SenderResult,
} from "../adConversionFire.ts";

const EVENT_ID = "order-uuid-855-pr0";
const BRAND_ID = "brand-855";
const MINGLA_EVENT_ID = "ev-855";

// The five attribution columns the fix backfills.
const ATTR_COLS = [
  "brand_id",
  "order_id",
  "value_cents",
  "currency",
  "mingla_event_id",
] as const;
// The per-channel status columns the fix must NEVER include in a backfill.
const STATUS_COLS = [
  "meta_capi_status",
  "tiktok_events_status",
  "snap_capi_status",
  "reddit_capi_status",
  "google_ads_status",
];

interface FakeTables {
  orders?: Record<string, unknown> | null;
  events?: Record<string, unknown> | null;
  ticket_checkout_sessions?: Record<string, unknown> | null;
  ad_conversions?: Record<string, unknown> | null;
  ad_attribution_touches?: Record<string, unknown> | null;
  ad_connections?: Record<string, unknown> | null;
}

/**
 * Fake supabase that records every ad_conversions upsert + update so the test can
 * inspect exactly what the fire wrote. Chain surface matches the sibling WP-B
 * harness (select/eq/not/order/maybeSingle/upsert/update/then) — deliberately NO
 * `.is`, because the production fix must express its COALESCE guard WITHOUT it.
 */
function makeFakeSupabase(tables: FakeTables) {
  const upserts: { row: Record<string, unknown> }[] = [];
  const updates: Record<string, unknown>[] = [];
  const from = (table: string) => {
    const canned = (tables as Record<string, unknown>)[table] ?? null;
    const builder = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve({ data: canned, error: null }),
      upsert: (row: Record<string, unknown>) => {
        if (table === "ad_conversions") upserts.push({ row });
        return Promise.resolve({ data: null, error: null });
      },
      update: (obj: Record<string, unknown>) => {
        if (table === "ad_conversions") updates.push(obj);
        return builder;
      },
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        resolve({ data: canned, error: null }),
    };
    return builder;
  };
  return {
    client: { from } as unknown as Parameters<typeof fireAdConversion>[0],
    upserts,
    updates,
  };
}

function spySender(
  channel: SenderResult["channel"],
  record: string[],
) {
  return (input: ConversionSendInput): Promise<SenderResult> => {
    record.push(`${channel}:${input.eventId}`);
    return Promise.resolve({ channel, status: "sent" });
  };
}

const spySenders = (record: string[]) => ({
  meta: spySender("meta", record),
  tiktok: spySender("tiktok", record),
  snap: spySender("snap", record),
  reddit: spySender("reddit", record),
  google: spySender("google", record),
});

const ORDER_TABLES = {
  orders: {
    id: EVENT_ID,
    event_id: MINGLA_EVENT_ID,
    total_cents: 2000,
    currency: "GBP",
    buyer_email: "b@x.com",
    buyer_phone: "+447700900000",
    payment_status: "paid",
  },
  events: { brand_id: BRAND_ID },
  ticket_checkout_sessions: { attribution_click_id: "click-1" },
  ad_attribution_touches: {
    id: "t1",
    connection_id: "c1",
    campaign_id: "cmp1",
    network: "meta",
    external_click_id: "fbclidX",
    created_at: "2026-07-18T00:00:00Z",
  },
  ad_connections: { extra: { dataset_id: "px-meta", pixel_id: "px" } },
};

/** The EARLY browser row: brand_id/order_id/mingla_event_id NULL, all statuses pending. */
function browserRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    event_id: EVENT_ID,
    brand_id: null,
    order_id: null,
    value_cents: null,
    currency: null,
    mingla_event_id: null,
    meta_capi_status: "pending",
    tiktok_events_status: "pending",
    snap_capi_status: "pending",
    reddit_capi_status: "pending",
    google_ads_status: "pending",
    ...overrides,
  };
}

/** The one recorded update that carries the backfill (contains brand_id/order_id/etc). */
function backfillUpdate(
  updates: Record<string, unknown>[],
): Record<string, unknown> | undefined {
  return updates.find((u) => ATTR_COLS.some((c) => c in u));
}

// ── 1. BROWSER ROW WINS → server fire backfills the NULL attribution columns ───

Deno.test("issue-855 PR-0: browser row wins → server fire backfills brand_id/order_id/value_cents/currency/mingla_event_id (NOT null)", async () => {
  const { client, updates } = makeFakeSupabase({
    ...ORDER_TABLES,
    ad_conversions: browserRow(), // the early browser row already exists
  });
  const record: string[] = [];
  const res = await fireAdConversion(client, {
    orderId: EVENT_ID,
    surface: "web",
  }, { senders: spySenders(record) });

  assertEquals(res.ok, true);
  assertEquals(res.deduped, false); // channels pending → the fire runs + sends

  const bf = backfillUpdate(updates);
  assert(
    bf,
    "a backfill update must be issued when the browser row won the race",
  );
  // The authoritative values resolved from the order are now written.
  assertEquals(bf.brand_id, BRAND_ID);
  assertEquals(bf.order_id, EVENT_ID);
  assertEquals(bf.value_cents, 2000);
  assertEquals(bf.currency, "GBP");
  assertEquals(bf.mingla_event_id, MINGLA_EVENT_ID);
  // HARD: the backfill NEVER touches a per-channel *_status column (dedup gate intact).
  for (const s of STATUS_COLS) {
    assert(
      !(s in bf),
      `backfill must not write ${s} (redelivery-dedup gate intact)`,
    );
  }
});

// ── 2. SERVER ROW FIRST (no prior row) → fresh insert, NO backfill write ───────

Deno.test("issue-855 PR-0: no prior row → full insert carries the values, NO extra backfill update", async () => {
  const { client, upserts, updates } = makeFakeSupabase({
    ...ORDER_TABLES,
    ad_conversions: null, // server wins → fresh insert
  });
  const record: string[] = [];
  const res = await fireAdConversion(client, {
    orderId: EVENT_ID,
    surface: "web",
  }, { senders: spySenders(record) });

  assertEquals(res.ok, true);
  // The freshly-inserted row already carries the authoritative values.
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].row.brand_id, BRAND_ID);
  assertEquals(upserts[0].row.order_id, EVENT_ID);
  assertEquals(upserts[0].row.value_cents, 2000);
  // No pre-existing row → the backfill branch is skipped entirely (no redundant write).
  assertEquals(
    backfillUpdate(updates),
    undefined,
    "the fresh-insert path must not issue a backfill update",
  );
});

// ── 3. ALREADY-POPULATED brand_id is NEVER overwritten ────────────────────────

Deno.test("issue-855 PR-0: an already-set brand_id is never clobbered; only the still-NULL columns are filled", async () => {
  const { client, updates } = makeFakeSupabase({
    ...ORDER_TABLES,
    ad_conversions: browserRow({
      brand_id: "brand-ALREADY-SET", // a prior server fire already resolved it
      // order_id / value_cents / currency / mingla_event_id remain NULL
    }),
  });
  const record: string[] = [];
  await fireAdConversion(client, { orderId: EVENT_ID, surface: "web" }, {
    senders: spySenders(record),
  });

  const bf = backfillUpdate(updates);
  assert(bf, "the still-NULL columns must still be backfilled");
  // brand_id is ALREADY set → it must NOT appear in the backfill payload.
  assert(
    !("brand_id" in bf),
    "an already-populated brand_id must NEVER be overwritten",
  );
  // The genuinely-NULL columns are still filled.
  assertEquals(bf.order_id, EVENT_ID);
  assertEquals(bf.value_cents, 2000);
  assertEquals(bf.mingla_event_id, MINGLA_EVENT_ID);
});

// ── 3b. A browser-set value_cents is preserved (COALESCE never nulls it out) ───

Deno.test("issue-855 PR-0: a value_cents the browser already set is preserved (never nulled by the fire)", async () => {
  const { client, updates } = makeFakeSupabase({
    ...ORDER_TABLES,
    ad_conversions: browserRow({ value_cents: 2000, currency: "GBP" }),
  });
  const record: string[] = [];
  await fireAdConversion(client, { orderId: EVENT_ID, surface: "web" }, {
    senders: spySenders(record),
  });

  const bf = backfillUpdate(updates);
  assert(
    bf,
    "brand_id/order_id/mingla_event_id are still NULL → a backfill runs",
  );
  // value_cents + currency were already set by the browser → excluded (no clobber).
  assert(
    !("value_cents" in bf),
    "an already-set value_cents must not be re-written",
  );
  assert(!("currency" in bf), "an already-set currency must not be re-written");
  assertEquals(bf.brand_id, BRAND_ID); // the actually-NULL column is filled
});

// ── 4. REDELIVERED WEBHOOK (all channels settled) → deduped, no send, no write ─

Deno.test("issue-855 PR-0: a redelivered webhook (all channels settled) re-sends NOTHING and writes NOTHING (status gate intact)", async () => {
  const { client, upserts, updates } = makeFakeSupabase({
    ...ORDER_TABLES,
    ad_conversions: browserRow({
      brand_id: BRAND_ID, // the first fire already backfilled + sent
      order_id: EVENT_ID,
      value_cents: 2000,
      currency: "GBP",
      mingla_event_id: MINGLA_EVENT_ID,
      meta_capi_status: "sent",
      tiktok_events_status: "sent",
      snap_capi_status: "sent",
      reddit_capi_status: "skipped",
      google_ads_status: "sent",
    }),
  });
  const record: string[] = [];
  const res = await fireAdConversion(client, { orderId: EVENT_ID }, {
    senders: spySenders(record),
  });

  assertEquals(res.deduped, true); // settled → early-return before step 4
  assertEquals(record.length, 0); // NO re-send (no double-count)
  assertEquals(upserts.length, 0); // never reached the upsert
  assertEquals(backfillUpdate(updates), undefined); // never reached the backfill
});
