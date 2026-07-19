/**
 * ISSUE-865 WP-B — ad-conversion senders + shared fire helper (Stage B).
 *
 * Runtime battery (Deno). Covers:
 *   • each sender's WIRE SHAPE (endpoint / fields / hashing / shared event_id),
 *   • FAIL-OPEN (a 500 / timeout is absorbed, a status is recorded, the caller
 *     is never thrown at) — RT-1,
 *   • Reddit PENDING-CONFIG skip (token unset → 'skipped'/'pending_config',
 *     never an error) — SC-12,
 *   • the shared fire hook is IDEMPOTENT (one event → one send per channel; a
 *     replay with all-sent statuses re-sends nothing) — RT-2 / SC-3,
 *   • the DEDUP CONTRACT (the shared event_id reaches every sender) — SC-15,
 *   • the fire helper is FAIL-OPEN and OFF the critical path (a throwing DB or a
 *     throwing sender never propagates) — the fails-on-revert target.
 *
 * Append-only. Injectable deps (fetchImpl / getToken / senders / a fake supabase)
 * keep this hermetic — NO live ad-platform calls, NO network, NO real DB.
 */

import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { sendMetaConversion } from "../metaCapi.ts";
import { sendTikTokConversion } from "../tiktokEvents.ts";
import { sendSnapConversion } from "../snapCapi.ts";
import { sendRedditConversion } from "../redditCapi.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  persistAttributionClickId,
  type SenderConnection,
  type SenderResult,
  sha256Hex,
} from "../adConversionFire.ts";

const EVENT_ID = "order-uuid-865-shared";

function baseInput(overrides: Partial<ConversionSendInput> = {}): ConversionSendInput {
  return {
    eventId: EVENT_ID,
    eventName: "Purchase",
    valueCents: 2000,
    currency: "GBP",
    eventSourceUrl: "https://usemingla.com/e/brand/event",
    hashedEmail: "hashedemail",
    hashedPhone: "hashedphone",
    fbc: "fb.1.1700000000000.abc123",
    fbp: null,
    externalClickId: "abc123",
    clientIpAddress: null,
    clientUserAgent: null,
    eventTimeMs: 1_700_000_000_000,
    ...overrides,
  };
}

/** A fetch stub that records the last request + returns a canned Response. */
function stubFetch(status: number, body: unknown = { ok: true }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    );
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

// ── Meta sender ───────────────────────────────────────────────────────────────

Deno.test("metaCapi: wire shape — endpoint, event_id, event_name, hashed PII, fbc unhashed, token in body", async () => {
  const { fn, calls } = stubFetch(200);
  const conn: SenderConnection = { pixelId: "1949011972638955", tokenEnvVar: "META_CAPI_ACCESS_TOKEN", lane: "consumer" };
  const res = await sendMetaConversion(baseInput(), conn, {
    fetchImpl: fn,
    getToken: (n) => (n === "META_CAPI_ACCESS_TOKEN" ? "TESTTOKEN" : undefined),
  });
  assertEquals(res.status, "sent");
  assertEquals(calls.length, 1);
  // v25.0 pinned + pixel id in path; NO 7d_view/28d_view anywhere (CAPI has none).
  assert(calls[0].url.includes("/v25.0/1949011972638955/events"), calls[0].url);
  assert(!calls[0].url.includes("7d_view") && !calls[0].url.includes("28d_view"));
  const sent = JSON.parse(String(calls[0].init.body));
  assertEquals(sent.data[0].event_id, EVENT_ID); // dedup key
  assertEquals(sent.data[0].event_name, "Purchase"); // dedup pair
  assertEquals(sent.data[0].action_source, "website");
  assertEquals(sent.data[0].custom_data.value, 20); // 2000c -> 20.00
  assertEquals(sent.data[0].user_data.em, ["hashedemail"]);
  assertEquals(sent.data[0].user_data.fbc, "fb.1.1700000000000.abc123"); // UNHASHED
  assertEquals(sent.access_token, "TESTTOKEN"); // in the body, not the URL
  assert(!calls[0].url.includes("TESTTOKEN"), "token must not be in the URL");
});

Deno.test("metaCapi: FAIL-OPEN — a 500 is absorbed as 'failed', never thrown (RT-1)", async () => {
  const { fn } = stubFetch(500, { error: { message: "boom" } });
  const res = await sendMetaConversion(baseInput(), { pixelId: "px", tokenEnvVar: "T" }, {
    fetchImpl: fn,
    getToken: () => "tok",
  });
  assertEquals(res.status, "failed");
  assertEquals(res.httpStatus, 500);
});

Deno.test("metaCapi: skipped when the pixel id or token is absent (never errors)", async () => {
  const noPixel = await sendMetaConversion(baseInput(), { pixelId: null, tokenEnvVar: "T" }, { getToken: () => "tok" });
  assertEquals(noPixel.status, "skipped");
  const noToken = await sendMetaConversion(baseInput(), { pixelId: "px", tokenEnvVar: "T" }, { getToken: () => undefined });
  assertEquals(noToken.status, "skipped");
});

// ── TikTok sender ─────────────────────────────────────────────────────────────

Deno.test("tiktokEvents: endpoint + Access-Token header + shared event_id; code!=0 → failed", async () => {
  const { fn, calls } = stubFetch(200, { code: 0, message: "OK" });
  const res = await sendTikTokConversion(baseInput({ eventName: "CompletePayment" }), {
    pixelId: "D9B98EBC77U1EOHV2O0G",
    tokenEnvVar: "TIKTOK_EVENTS_ACCESS_TOKEN",
  }, { fetchImpl: fn, getToken: () => "ttok" });
  assertEquals(res.status, "sent");
  assert(calls[0].url.includes("business-api.tiktok.com/open_api/v1.3/event/track/"));
  assertEquals((calls[0].init.headers as Record<string, string>)["Access-Token"], "ttok");
  const sent = JSON.parse(String(calls[0].init.body));
  assertEquals(sent.event_source_id, "D9B98EBC77U1EOHV2O0G");
  assertEquals(sent.data[0].event_id, EVENT_ID);
  assertEquals(sent.data[0].event, "CompletePayment");

  // A 200 with a non-zero TikTok code is a SOFT failure.
  const soft = stubFetch(200, { code: 40001, message: "bad" });
  const res2 = await sendTikTokConversion(baseInput(), { pixelId: "px", tokenEnvVar: "T" }, {
    fetchImpl: soft.fn,
    getToken: () => "t",
  });
  assertEquals(res2.status, "failed");
});

// ── Snap sender ───────────────────────────────────────────────────────────────

Deno.test("snapCapi: endpoint w/ pixel + access_token query, client_dedup_id == shared event_id", async () => {
  const { fn, calls } = stubFetch(200);
  const res = await sendSnapConversion(baseInput({ eventName: "PURCHASE" }), {
    pixelId: "af5f8fc4-1ef6-41e7-81c5-042b7be7df38",
    tokenEnvVar: "SNAPCHAT_CAPI_TOKEN",
  }, { fetchImpl: fn, getToken: () => "snaptok" });
  assertEquals(res.status, "sent");
  assert(calls[0].url.includes("tr.snapchat.com/v3/af5f8fc4-1ef6-41e7-81c5-042b7be7df38/events"));
  const sent = JSON.parse(String(calls[0].init.body));
  assertEquals(sent.data[0].client_dedup_id, EVENT_ID); // dedup
  assertEquals(sent.data[0].event_name, "PURCHASE");
});

// ── Reddit sender — PENDING-CONFIG (SC-12) ────────────────────────────────────

Deno.test("redditCapi: token UNSET → skipped 'pending_config' (never errors, never blocks) — SC-12", async () => {
  const { fn, calls } = stubFetch(200);
  const res = await sendRedditConversion(baseInput({ eventName: "Purchase" }), {
    pixelId: "a2_jcfwvnfcfqcs",
    tokenEnvVar: "REDDIT_ADS_CAPI_TOKEN",
  }, { fetchImpl: fn, getToken: () => undefined }); // token not provisioned
  assertEquals(res.status, "skipped");
  assertEquals(res.reason, "pending_config");
  assertEquals(calls.length, 0); // no network attempted while pending
});

Deno.test("redditCapi: with a token it POSTs v3 conversion_events with the shared conversion_id", async () => {
  const { fn, calls } = stubFetch(200, { data: { message: "Successfully processed 1 conversion events." } });
  const res = await sendRedditConversion(baseInput({ eventName: "Purchase" }), {
    pixelId: "a2_jcfwvnfcfqcs",
    tokenEnvVar: "REDDIT_ADS_CAPI_TOKEN",
  }, { fetchImpl: fn, getToken: () => "rtok" });
  assertEquals(res.status, "sent");
  assert(calls[0].url.includes("ads-api.reddit.com/api/v3/pixels/a2_jcfwvnfcfqcs/conversion_events"));
  assertEquals((calls[0].init.headers as Record<string, string>).Authorization, "Bearer rtok");
  const sent = JSON.parse(String(calls[0].init.body));
  assertEquals(sent.events[0].event_metadata.conversion_id, EVENT_ID);
  assertEquals(sent.events[0].event_type.tracking_type, "Purchase"); // v3 shape
});

// ── Hashing helper (SC-9) ─────────────────────────────────────────────────────

Deno.test("sha256Hex matches the known SHA-256 (pgcrypto-parity) of an email", async () => {
  // printf 'a@b.com' | shasum -a 256
  const h = await sha256Hex("a@b.com");
  assertEquals(h, "fb98d44ad7501a959f3f4f4a3f004fe2d9e581ea6207e218c4b02c08a4d75adf");
  assert(/^[0-9a-f]{64}$/.test(h));
});

// ── Fake supabase for the fire helper ─────────────────────────────────────────

interface FakeTables {
  orders?: Record<string, unknown> | null;
  events?: Record<string, unknown> | null;
  ticket_checkout_sessions?: Record<string, unknown> | null;
  ad_conversions?: Record<string, unknown> | null;
  ad_attribution_touches?: Record<string, unknown> | null;
  ad_connections?: Record<string, unknown> | null;
}

function makeFakeSupabase(tables: FakeTables, opts: { throwOnFrom?: string } = {}) {
  const updates: Record<string, unknown>[] = [];
  const upserts: Record<string, unknown>[] = [];
  const from = (table: string) => {
    if (opts.throwOnFrom === table) throw new Error(`DB down: ${table}`);
    const canned = (tables as Record<string, unknown>)[table] ?? null;
    const builder = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve({ data: canned, error: null }),
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      update: (obj: Record<string, unknown>) => {
        updates.push(obj);
        return builder;
      },
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        resolve({ data: canned, error: null }),
    };
    return builder;
  };
  return { client: { from } as unknown as Parameters<typeof fireAdConversion>[0], updates, upserts };
}

function spySender(channel: SenderResult["channel"], record: string[]) {
  return (input: ConversionSendInput): Promise<SenderResult> => {
    record.push(`${channel}:${input.eventId}:${input.eventName}`);
    return Promise.resolve({ channel, status: "sent" });
  };
}

// ── Fire helper — DEDUP CONTRACT + one-send-per-channel ───────────────────────

Deno.test("fireAdConversion: resolves order, fans out ONCE per channel with the shared event_id (SC-15)", async () => {
  const { client, updates } = makeFakeSupabase({
    orders: { id: EVENT_ID, event_id: "ev-1", total_cents: 2000, currency: "GBP", buyer_email: "b@x.com", buyer_phone: "+447700900000" },
    events: { brand_id: "brand-1" },
    ticket_checkout_sessions: { attribution_click_id: "click-1" },
    ad_conversions: null, // no prior row → all channels pending
    ad_attribution_touches: { id: "t1", connection_id: "c1", campaign_id: "cmp1", network: "meta", external_click_id: "fbclidX", created_at: "2026-07-18T00:00:00Z" },
    ad_connections: { extra: { dataset_id: "px-meta", pixel_id: "px", capi_env_var: "META_CAPI_ACCESS_TOKEN", events_env_var: "TIKTOK_EVENTS_ACCESS_TOKEN", reddit_pixel_id: "a2_x" } },
  });
  const record: string[] = [];
  const res = await fireAdConversion(client, { orderId: EVENT_ID, surface: "web" }, {
    senders: {
      meta: spySender("meta", record),
      tiktok: spySender("tiktok", record),
      snap: spySender("snap", record),
      reddit: spySender("reddit", record),
    },
    getToken: () => "tok",
  });
  assertEquals(res.ok, true);
  assertEquals(res.deduped, false);
  // exactly one send per channel, each carrying the SHARED event_id = orderId.
  assertEquals(record.sort(), [
    `meta:${EVENT_ID}:Purchase`,
    `reddit:${EVENT_ID}:Purchase`,
    `snap:${EVENT_ID}:PURCHASE`,
    `tiktok:${EVENT_ID}:CompletePayment`,
  ]);
  // statuses persisted.
  assert(updates.length >= 1);
});

Deno.test("fireAdConversion: IDEMPOTENT — an already-sent row re-sends NOTHING (RT-2 / SC-3)", async () => {
  const { client } = makeFakeSupabase({
    orders: { id: EVENT_ID, event_id: "ev-1", total_cents: 2000, currency: "GBP" },
    events: { brand_id: "brand-1" },
    ad_conversions: {
      event_id: EVENT_ID,
      meta_capi_status: "sent",
      tiktok_events_status: "sent",
      snap_capi_status: "sent",
      reddit_capi_status: "skipped",
    },
  });
  const record: string[] = [];
  const res = await fireAdConversion(client, { orderId: EVENT_ID }, {
    senders: {
      meta: spySender("meta", record),
      tiktok: spySender("tiktok", record),
      snap: spySender("snap", record),
      reddit: spySender("reddit", record),
    },
  });
  assertEquals(res.deduped, true);
  assertEquals(record.length, 0); // replay → no second send
});

// ── Fire helper — FAIL-OPEN (the fails-on-revert target) ──────────────────────

Deno.test("fireAdConversion: FAIL-OPEN — a throwing DB is ABSORBED, never propagates (RT-1)", async () => {
  const { client } = makeFakeSupabase({ orders: null }, { throwOnFrom: "orders" });
  let threw = false;
  let result;
  try {
    result = await fireAdConversion(client, { orderId: EVENT_ID });
  } catch {
    threw = true;
  }
  assertEquals(threw, false); // the hook NEVER throws to the finalize caller
  assertEquals(result?.ok, false);
  assertEquals(result?.reason, "absorbed");
});

Deno.test("fireAdConversion: FAIL-OPEN — a throwing sender is absorbed; the hook still returns ok", async () => {
  const { client } = makeFakeSupabase({
    orders: { id: EVENT_ID, event_id: "ev-1", total_cents: 2000, currency: "GBP" },
    events: { brand_id: "brand-1" },
    ad_conversions: null,
    ad_connections: { extra: { dataset_id: "px", capi_env_var: "META_CAPI_ACCESS_TOKEN" } },
  });
  // A real sender is async + catches internally; the worst realistic failure is
  // a REJECTED promise (async throw) — Promise.allSettled must absorb it.
  const throwingMeta = async (): Promise<SenderResult> => {
    await Promise.resolve();
    throw new Error("meta exploded");
  };
  let threw = false;
  let res;
  try {
    res = await fireAdConversion(client, { orderId: EVENT_ID }, {
      senders: { meta: throwingMeta },
      getToken: () => "tok",
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, false);
  assertEquals(res?.ok, true);
  // the throwing channel is recorded as failed (Promise.allSettled path).
  const meta = res?.results?.find((r) => r.channel === "meta");
  assertEquals(meta?.status, "failed");
});

// ── P2-1 rework — attribution threading is DECOUPLED + FAIL-OPEN ───────────────
// The QA P2-1 hazard: if attribution_click_id is written on the FATAL
// checkout-creation UPDATE and the column is absent (edge fns deployed before
// migration 20270106000865), an ad-attributed checkout 409s and BLOCKS the
// buyer. The fix: persistAttributionClickId is its own error-swallowing write,
// off the fatal path — a missing column / any failure degrades to "attribution
// absent", the checkout completes normally.

function fakeUpdateSupabase(behavior: "column_absent" | "throws" | "ok") {
  const updateCalls: unknown[] = [];
  const from = () => {
    const builder = {
      update: (obj: unknown) => {
        updateCalls.push(obj);
        return builder;
      },
      eq: (): Promise<{ error: { message: string } | null }> => {
        if (behavior === "throws") return Promise.reject(new Error("connection reset"));
        if (behavior === "column_absent") {
          return Promise.resolve({ error: { message: 'column "attribution_click_id" does not exist' } });
        }
        return Promise.resolve({ error: null });
      },
    };
    return builder;
  };
  return { client: { from } as unknown as Parameters<typeof persistAttributionClickId>[0], updateCalls };
}

Deno.test("persistAttributionClickId: column ABSENT → the write fails but the helper does NOT throw (P2-1 — checkout still completes)", async () => {
  const { client, updateCalls } = fakeUpdateSupabase("column_absent");
  let threw = false;
  try {
    await persistAttributionClickId(client, "sess-1", "click-1");
  } catch {
    threw = true;
  }
  // The helper attempted the write (1 call) but ABSORBED the column-absent error.
  assertEquals(threw, false); // never throws → the ad-attributed checkout is not blocked
  assertEquals(updateCalls.length, 1);
});

Deno.test("persistAttributionClickId: a THROWING write is absorbed; a NULL click_id is a no-op (byte-identical for non-ad traffic)", async () => {
  const throwing = fakeUpdateSupabase("throws");
  let threw = false;
  try {
    await persistAttributionClickId(throwing.client, "sess-2", "click-2");
  } catch {
    threw = true;
  }
  assertEquals(threw, false);

  // Non-ad traffic: null click_id → the helper never touches the DB.
  const noop = fakeUpdateSupabase("ok");
  await persistAttributionClickId(noop.client, "sess-3", null);
  assertEquals(noop.updateCalls.length, 0);
});

Deno.test("P2-1 source guard: attribution_click_id is DECOUPLED from the fatal checkout-creation UPDATE", () => {
  const src = Deno.readTextFileSync(
    new URL("../../ticket-checkout-create/index.ts", import.meta.url),
  );
  // The decoupled, fail-open helper is called (not an inline write on the fatal path).
  assert(
    src.includes("persistAttributionClickId(supabase"),
    "ticket-checkout-create must call the decoupled persistAttributionClickId helper",
  );
  // Re-coupling into the fatal status-token UPDATE (`sessionUpdate.attribution_click_id = …`)
  // is FORBIDDEN — that is exactly the P2-1 buyer-blocking regression.
  assert(
    !src.includes("sessionUpdate.attribution_click_id"),
    "attribution_click_id must NOT be merged into the fatal sessionUpdate (P2-1 re-couple regression)",
  );
});
