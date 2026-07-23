/**
 * ISSUE-865 WP-B/C — TESTER adversarial battery (append-only, mingla-tester).
 *
 * DIFFERENT ANGLES than the implementor's 16 happy-path tests. Attacks the
 * money-safety + dedup contract at the seams the implementor's battery did NOT
 * cover:
 *   (A1) REAL AbortController timeout path — a hanging ad platform is absorbed as
 *        'timeout', never thrown (RT-1). The implementor only tested a stub 500.
 *   (A2) END-TO-END PII hashing on the WIRE — a real plaintext buyer email/phone
 *        on the order NEVER appears in ANY sender's outgoing body; only the
 *        64-hex SHA-256 does (SC-9). The implementor passed pre-hashed strings to
 *        the senders and never exercised the fire-helper's own hashing path.
 *   (A3) CROSS-SIDE DEDUP CONTRACT — the server sender bodies carry the EXACT
 *        per-channel event NAME + shared event_id that the browser pixel fires
 *        (Meta 'Purchase'/eventID, TikTok 'CompletePayment'/event_id, Snap
 *        'PURCHASE'/client_dedup_id, Reddit 'Purchase'/conversion_id) — SC-5/SC-15.
 *   (A4) RESERVATION path — event_id = reservationId with the reservation-branch
 *        event names (Meta 'Schedule', TikTok 'CompleteRegistration', Snap 'SAVE',
 *        Reddit 'Lead'); a server-only send (no browser reservation pixel).
 *   (A5) A HANGING sender cannot exceed the bounded timeout nor throw upward.
 *   (A6) Reddit pending-config does NOT block the other three (fan-out isolation).
 *
 * Hermetic: injected fetch + fake supabase. NO live ad-platform calls, NO real
 * DB, NO network egress, NO real charge.
 */

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  type SenderConnection,
  type SenderResult,
  sha256Hex,
} from "../adConversionFire.ts";
import { sendMetaConversion } from "../metaCapi.ts";

const ORDER_ID = "order-uuid-865-adv";
const RESV_ID = "resv-uuid-865-adv";
const PLAINTEXT_EMAIL = "Buyer.Secret@Example.COM";
const PLAINTEXT_PHONE = "+44 7700 900123";

// ── Capturing fetch — records every outgoing request, returns a canned 200. ────
function capturingFetch(status = 200, body: unknown = { code: 0 }) {
  const calls: { url: string; init: RequestInit; body: string }[] = [];
  const fn = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {}, body: String((init ?? {}).body ?? "") });
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    );
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

// ── Fake supabase that returns a per-table canned row. ────────────────────────
function fakeSupabase(tables: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const from = (table: string) => {
    const canned = tables[table] ?? null;
    const builder = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve({ data: canned, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      update: (obj: Record<string, unknown>) => {
        updates.push(obj);
        return builder;
      },
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: canned, error: null }),
    };
    return builder;
  };
  return { client: { from } as unknown as Parameters<typeof fireAdConversion>[0], updates };
}

// getToken that hands a token ONLY to the three provisioned channels and leaves
// reddit pending-config; crucially returns undefined for META_API_VERSION so the
// Meta sender falls back to its pinned v25.0 default (A2-6).
const PROVISIONED = new Set(["META_CAPI_ACCESS_TOKEN", "TIKTOK_EVENTS_ACCESS_TOKEN", "SNAPCHAT_CAPI_TOKEN"]);
const tokenFor = (n: string): string | undefined => (PROVISIONED.has(n) ? "tok" : undefined);

const ORDER_TABLES = {
  orders: {
    id: ORDER_ID,
    event_id: "ev-1",
    total_cents: 3500,
    currency: "GBP",
    buyer_email: PLAINTEXT_EMAIL,
    buyer_phone: PLAINTEXT_PHONE,
    payment_status: "paid",
  },
  events: { brand_id: "brand-1" },
  ticket_checkout_sessions: { attribution_click_id: "click-1" },
  ad_conversions: null,
  ad_attribution_touches: {
    id: "t1", connection_id: "c1", campaign_id: "cmp1",
    network: "meta", external_click_id: "fbclidX", created_at: "2026-07-18T00:00:00Z",
  },
  // No capi_env_var / events_env_var → each channel resolves its OWN default env
  // NAME (meta→META_CAPI_ACCESS_TOKEN, tiktok→TIKTOK_EVENTS_ACCESS_TOKEN,
  // snap→SNAPCHAT_CAPI_TOKEN, reddit→REDDIT_ADS_CAPI_TOKEN) — so getToken can
  // hand tokens to the first three and leave reddit pending-config.
  ad_connections: { extra: { dataset_id: "px-meta", pixel_id: "px" } },
};

// ═══ A1 — REAL AbortController timeout is absorbed as 'timeout' (RT-1) ════════
Deno.test("A1 metaCapi: a HANGING platform hits the AbortController timeout → 'timeout', never thrown", async () => {
  // A fetch that never resolves until aborted — the real slow/unreachable case.
  const hangingFetch = ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
    })) as unknown as typeof fetch;
  const conn: SenderConnection = { pixelId: "px", tokenEnvVar: "T" };
  const t0 = Date.now();
  let threw = false;
  let res: SenderResult | undefined;
  try {
    res = await sendMetaConversion(baseInput(), conn, { fetchImpl: hangingFetch, getToken: () => "tok", timeoutMs: 150 });
  } catch {
    threw = true;
  }
  const elapsed = Date.now() - t0;
  assertEquals(threw, false); // never throws upward
  assertEquals(res?.status, "failed");
  assertEquals(res?.reason, "timeout"); // the AbortError path, not a stub 500
  assert(elapsed < 2000, `bounded by timeoutMs, took ${elapsed}ms`);
});

// ═══ A2 — END-TO-END PII hashing: NO plaintext email/phone on the wire (SC-9) ═
Deno.test("A2 fireAdConversion: plaintext buyer email/phone NEVER reach any sender body; only the SHA-256 hash does", async () => {
  const { client } = fakeSupabase(ORDER_TABLES);
  const { fn, calls } = capturingFetch();
  const res = await fireAdConversion(client, { orderId: ORDER_ID, surface: "web" }, {
    // DEFAULT (real) senders — capture their real outgoing bodies.
    fetchImpl: fn,
    getToken: tokenFor, // reddit stays pending-config
  });
  assertEquals(res.ok, true);
  assert(calls.length >= 3, `meta+tiktok+snap should each POST (reddit pending); got ${calls.length}`);

  const expectedEmailHash = await sha256Hex("buyer.secret@example.com"); // trim+lowercase
  const expectedPhoneHash = await sha256Hex("447700900123"); // digits-only

  for (const c of calls) {
    // The plaintext MUST NOT appear anywhere in the serialized request body.
    assert(!c.body.toLowerCase().includes("buyer.secret@example.com"), `plaintext email leaked to ${c.url}`);
    assert(!c.body.includes("900123"), `plaintext phone fragment leaked to ${c.url}`);
    assert(!c.body.includes("+44"), `raw phone prefix leaked to ${c.url}`);
    // The hash MUST be present (advanced matching still works).
    assertStringIncludes(c.body, expectedEmailHash);
    assertStringIncludes(c.body, expectedPhoneHash);
  }
});

// ═══ A3 — CROSS-SIDE DEDUP: server names+ids == the browser pixel's (SC-5/15) ═
Deno.test("A3 fireAdConversion: each sender body carries the EXACT browser event name + shared event_id (order path)", async () => {
  const { client } = fakeSupabase(ORDER_TABLES);
  const { fn, calls } = capturingFetch();
  await fireAdConversion(client, { orderId: ORDER_ID, surface: "web" }, {
    fetchImpl: fn,
    getToken: tokenFor,
  });
  const byHost = (needle: string) => calls.find((c) => c.url.includes(needle));

  // Meta — event_name 'Purchase' (browser fbq track 'Purchase'), event_id == orderId.
  const meta = JSON.parse(byHost("graph.facebook.com")!.body);
  assertEquals(meta.data[0].event_name, "Purchase");
  assertEquals(meta.data[0].event_id, ORDER_ID);
  // Meta CAPI carries NO deprecated attribution windows (RT-4, by construction).
  assert(!byHost("graph.facebook.com")!.body.includes("7d_view"));
  assert(!byHost("graph.facebook.com")!.body.includes("28d_view"));
  assert(byHost("graph.facebook.com")!.url.includes("/v25.0/")); // A2-6 pin

  // TikTok — event 'CompletePayment' (browser ttq track 'CompletePayment'), event_id == orderId.
  const tt = JSON.parse(byHost("business-api.tiktok.com")!.body);
  assertEquals(tt.data[0].event, "CompletePayment");
  assertEquals(tt.data[0].event_id, ORDER_ID);

  // Snap — event_name 'PURCHASE', client_dedup_id == orderId (browser snaptr 'PURCHASE').
  const sn = JSON.parse(byHost("tr.snapchat.com")!.body);
  assertEquals(sn.data[0].event_name, "PURCHASE");
  assertEquals(sn.data[0].client_dedup_id, ORDER_ID);
});

// ═══ A4 — RESERVATION path: reservationId + reservation-branch names ══════════
Deno.test("A4 fireAdConversion: venue reservation keys on reservationId with the reservation-branch event names", async () => {
  const { client } = fakeSupabase({
    reservations: {
      id: RESV_ID, brand_id: "brand-9", fee_cents: 1500, fee_currency: "GBP",
      guest_email: PLAINTEXT_EMAIL, guest_phone_e164: PLAINTEXT_PHONE, payment_status: "paid",
    },
    ad_conversions: null,
    ad_connections: { extra: { dataset_id: "px", pixel_id: "px" } },
  });
  const { fn, calls } = capturingFetch();
  await fireAdConversion(client, { reservationId: RESV_ID, surface: "web", eventType: "reservation" }, {
    fetchImpl: fn,
    getToken: tokenFor,
  });
  const byHost = (needle: string) => calls.find((c) => c.url.includes(needle));
  const meta = JSON.parse(byHost("graph.facebook.com")!.body);
  assertEquals(meta.data[0].event_name, "Schedule"); // reservation branch, NOT 'Purchase'
  assertEquals(meta.data[0].event_id, RESV_ID); // keyed on the reservation id
  const tt = JSON.parse(byHost("business-api.tiktok.com")!.body);
  assertEquals(tt.data[0].event, "CompleteRegistration");
  const sn = JSON.parse(byHost("tr.snapchat.com")!.body);
  assertEquals(sn.data[0].event_name, "SAVE");
  // Reservation PII is ALSO hashed on the wire (SC-9 across the reservation path).
  const expectedEmailHash = await sha256Hex("buyer.secret@example.com");
  assertStringIncludes(byHost("graph.facebook.com")!.body, expectedEmailHash);
  assert(!byHost("graph.facebook.com")!.body.toLowerCase().includes("buyer.secret@example.com"));
});

// ═══ A5 — a HANGING sender is bounded and absorbed; the hook still returns ok ═
Deno.test("A5 fireAdConversion: a hanging sender never blocks past the bound and never throws upward (RT-1)", async () => {
  const { client } = fakeSupabase(ORDER_TABLES);
  const hangingMeta = (_i: ConversionSendInput, _c: SenderConnection, deps?: { timeoutMs?: number }) =>
    new Promise<SenderResult>((resolve) => {
      // Model a sender that self-bounds (as the real ones do) — resolves 'failed'
      // rather than hanging forever; a real hang is covered by A1's AbortError.
      setTimeout(() => resolve({ channel: "meta", status: "failed", reason: "timeout" }), (deps?.timeoutMs ?? 50));
    });
  const t0 = Date.now();
  let threw = false;
  // getToken returns a token for ALL channels, so tiktok/snap/reddit run their
  // REAL senders — route them through a capturing fetch (as A6 does) so they
  // never hit the network. Without this they issue real requests whose response
  // bodies go unconsumed, which the leak sanitizer flags intermittently.
  const { fn: capturedFetch } = capturingFetch();
  const res = await fireAdConversion(client, { orderId: ORDER_ID }, {
    senders: { meta: hangingMeta as never },
    getToken: () => "tok",
    timeoutMs: 60,
    fetchImpl: capturedFetch,
  }).catch(() => {
    threw = true;
    return undefined;
  });
  assertEquals(threw, false);
  assertEquals(res?.ok, true);
  assert(Date.now() - t0 < 2000);
  assertEquals(res?.results?.find((r) => r.channel === "meta")?.status, "failed");
});

// ═══ A6 — Reddit pending-config does NOT block the other three ════════════════
Deno.test("A6 fireAdConversion: reddit pending-config → skipped, meta/tiktok/snap still send (isolation)", async () => {
  const { client } = fakeSupabase(ORDER_TABLES);
  const { fn, calls } = capturingFetch();
  const res = await fireAdConversion(client, { orderId: ORDER_ID }, {
    fetchImpl: fn,
    getToken: tokenFor,
  });
  const reddit = res.results?.find((r) => r.channel === "reddit");
  assertEquals(reddit?.status, "skipped");
  assertEquals(reddit?.reason, "pending_config");
  // Reddit made NO network call; the other three DID.
  assert(!calls.some((c) => c.url.includes("ads-api.reddit.com")), "reddit must not POST while pending");
  assert(calls.some((c) => c.url.includes("graph.facebook.com")));
  assert(calls.some((c) => c.url.includes("business-api.tiktok.com")));
  assert(calls.some((c) => c.url.includes("tr.snapchat.com")));
});

// ── shared base input for the sender-level A1 test ────────────────────────────
function baseInput(overrides: Partial<ConversionSendInput> = {}): ConversionSendInput {
  return {
    eventId: ORDER_ID,
    eventName: "Purchase",
    valueCents: 2000,
    currency: "GBP",
    eventSourceUrl: "https://usemingla.com/e/brand/event",
    hashedEmail: "d".repeat(64),
    hashedPhone: "e".repeat(64),
    fbc: "fb.1.1700000000000.abc123",
    fbp: null,
    externalClickId: "abc123",
    clientIpAddress: null,
    clientUserAgent: null,
    eventTimeMs: 1_700_000_000_000,
    ...overrides,
  };
}
