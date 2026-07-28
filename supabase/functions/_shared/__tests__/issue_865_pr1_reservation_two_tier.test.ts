// ISSUE-865 PR1 WP-2 — reservation TWO-TIER + click-threading (NEW, append-only).
//
// The founder-locked two-tier, proven on the WIRE + in the persisted row:
//   • a PAID venue reservation (payment_status 'paid' + fee) with no explicit
//     eventType fires the value'd Purchase branch (Meta 'Purchase' carrying the
//     fee amount) — what the ads bid toward;
//   • a FREE RSVP (payment_status 'none', no fee) fires the lead-type branch
//     (Meta 'Schedule') at £0 — counted as a driven customer, never a Purchase;
//   • an EXPLICIT eventType:'reservation' still forces the lead branch even on a
//     paid row (back-compat with the shipped adversarial A4);
//   • the click_id threads BOTH ways — inline (free path holds it) and via the
//     reservation_checkout_sessions join (fee path) — so the conversion row +
//     send resolve reservation → touch → campaign.
//
// fails-on-revert target: revert the two-tier derivation (back to a flat
// eventType:'reservation') and the "paid → Purchase" case fails; revert the
// click resolution (back to clickId:null) and the threading cases fail.
//
// Hermetic: injected capturing fetch + a fake supabase (canned rows + captured
// upserts). NO live ad-platform calls, NO real DB, NO network.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { fireAdConversion } from "../adConversionFire.ts";

const RESV_ID = "resv-uuid-865-pr1";

function capturingFetch(status = 200, body: unknown = { code: 0 }) {
  const calls: { url: string; body: string }[] = [];
  const fn = (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    calls.push({ url: String(url), body: String((init ?? {}).body ?? "") });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

/** Fake supabase — per-table canned rows + captured upserts (the conversion row). */
function fakeSupabase(tables: Record<string, unknown>) {
  const upserts: Record<string, unknown>[] = [];
  const from = (table: string) => {
    const canned = tables[table] ?? null;
    const builder = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve({ data: canned, error: null }),
      upsert: (row: Record<string, unknown>) => {
        if (table === "ad_conversions") upserts.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      update: () => builder,
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        resolve({ data: canned, error: null }),
    };
    return builder;
  };
  return {
    client: { from } as unknown as Parameters<typeof fireAdConversion>[0],
    upserts,
  };
}

// getToken hands a token only to the three provisioned channels (reddit pending).
const PROVISIONED = new Set([
  "META_CAPI_ACCESS_TOKEN",
  "TIKTOK_EVENTS_ACCESS_TOKEN",
  "SNAPCHAT_CAPI_TOKEN",
]);
const tokenFor = (
  n: string,
): string | undefined => (PROVISIONED.has(n) ? "tok" : undefined);

const AD_CONNECTIONS = {
  ad_connections: { extra: { dataset_id: "px-meta", pixel_id: "px" } },
};

// ── TIER 1: PAID reservation → value'd Purchase ───────────────────────────────
Deno.test("WP-2 two-tier: a PAID reservation (no explicit eventType) fires Meta 'Purchase' carrying the fee value", async () => {
  const { client } = fakeSupabase({
    reservations: {
      id: RESV_ID,
      brand_id: "brand-1",
      fee_cents: 2500,
      fee_currency: "GBP",
      guest_email: "g@x.com",
      guest_phone_e164: "+447700900000",
      payment_status: "paid",
    },
    ad_conversions: null,
    ...AD_CONNECTIONS,
  });
  const { fn, calls } = capturingFetch();
  const res = await fireAdConversion(client, {
    reservationId: RESV_ID,
    surface: "web",
  }, {
    fetchImpl: fn,
    getToken: tokenFor,
  });
  assertEquals(res.ok, true);
  const meta = JSON.parse(
    calls.find((c) => c.url.includes("graph.facebook.com"))!.body,
  );
  assertEquals(meta.data[0].event_name, "Purchase"); // value'd Purchase, NOT 'Schedule'
  assertEquals(meta.data[0].event_id, RESV_ID);
  assertEquals(meta.data[0].custom_data.value, 25); // 2500c -> 25.00 (paid fee)
});

// ── TIER 2: FREE RSVP → lead-type at £0 ───────────────────────────────────────
Deno.test("WP-2 two-tier: a FREE RSVP (payment_status 'none', no fee) fires Meta 'Schedule' at £0 (lead, NOT Purchase)", async () => {
  const { client } = fakeSupabase({
    reservations: {
      id: RESV_ID,
      brand_id: "brand-1",
      fee_cents: null,
      fee_currency: null,
      guest_email: "g@x.com",
      guest_phone_e164: "+447700900000",
      payment_status: "none",
    },
    ad_conversions: null,
    ...AD_CONNECTIONS,
  });
  const { fn, calls } = capturingFetch();
  await fireAdConversion(client, { reservationId: RESV_ID, surface: "web" }, {
    fetchImpl: fn,
    getToken: tokenFor,
  });
  const meta = JSON.parse(
    calls.find((c) => c.url.includes("graph.facebook.com"))!.body,
  );
  assertEquals(meta.data[0].event_name, "Schedule"); // lead branch
  assertEquals(meta.data[0].custom_data.value, 0); // £0 — no revenue on a free RSVP
  const tt = JSON.parse(
    calls.find((c) => c.url.includes("business-api.tiktok.com"))!.body,
  );
  assertEquals(tt.data[0].event, "CompleteRegistration");
});

// ── OVERRIDE: explicit eventType 'reservation' forces lead even on a PAID row ──
Deno.test("WP-2 two-tier: explicit eventType 'reservation' forces the lead branch on a paid row (A4 back-compat)", async () => {
  const { client } = fakeSupabase({
    reservations: {
      id: RESV_ID,
      brand_id: "brand-9",
      fee_cents: 1500,
      fee_currency: "GBP",
      guest_email: "g@x.com",
      guest_phone_e164: "+447700900000",
      payment_status: "paid",
    },
    ad_conversions: null,
    ...AD_CONNECTIONS,
  });
  const { fn, calls } = capturingFetch();
  await fireAdConversion(client, {
    reservationId: RESV_ID,
    surface: "web",
    eventType: "reservation",
  }, {
    fetchImpl: fn,
    getToken: tokenFor,
  });
  const meta = JSON.parse(
    calls.find((c) => c.url.includes("graph.facebook.com"))!.body,
  );
  assertEquals(meta.data[0].event_name, "Schedule"); // explicit override respected
});

// ── THREADING: inline click_id resolves touch → the conversion row carries it ──
Deno.test("WP-2 threading: an INLINE clickId resolves the touch; the conversion row carries click_id + campaign_id", async () => {
  const { client, upserts } = fakeSupabase({
    reservations: {
      id: RESV_ID,
      brand_id: "brand-1",
      fee_cents: 2000,
      fee_currency: "GBP",
      guest_email: "g@x.com",
      guest_phone_e164: "+447700900000",
      payment_status: "paid",
    },
    ad_conversions: null,
    ad_attribution_touches: {
      id: "t-1",
      connection_id: "c-1",
      campaign_id: "cmp-1",
      network: "meta",
      external_click_id: "fbclidX",
      created_at: "2026-07-20T00:00:00Z",
    },
    ...AD_CONNECTIONS,
  });
  const { fn } = capturingFetch();
  await fireAdConversion(client, {
    reservationId: RESV_ID,
    surface: "web",
    clickId: "click-inline",
  }, {
    fetchImpl: fn,
    getToken: tokenFor,
  });
  const row = upserts.find((u) => u.event_id === RESV_ID)!;
  assertEquals(row.click_id, "click-inline");
  assertEquals(row.campaign_id, "cmp-1"); // resolved via the touch
  assertEquals(row.touch_id, "t-1");
});

// ── THREADING: session-join click_id (fee path had no inline clickId) ──────────
Deno.test("WP-2 threading: with no inline clickId, the reservation checkout session's attribution_click_id is used", async () => {
  const { client, upserts } = fakeSupabase({
    reservations: {
      id: RESV_ID,
      brand_id: "brand-1",
      fee_cents: 2000,
      fee_currency: "GBP",
      guest_email: "g@x.com",
      guest_phone_e164: "+447700900000",
      payment_status: "paid",
    },
    reservation_checkout_sessions: {
      attribution_click_id: "click-from-session",
    },
    ad_conversions: null,
    ad_attribution_touches: {
      id: "t-2",
      connection_id: "c-2",
      campaign_id: "cmp-2",
      network: "meta",
      external_click_id: "fbY",
      created_at: "2026-07-20T00:00:00Z",
    },
    ...AD_CONNECTIONS,
  });
  const { fn } = capturingFetch();
  await fireAdConversion(client, { reservationId: RESV_ID, surface: "web" }, {
    fetchImpl: fn,
    getToken: tokenFor,
  });
  const row = upserts.find((u) => u.event_id === RESV_ID)!;
  assertEquals(row.click_id, "click-from-session");
  assertEquals(row.campaign_id, "cmp-2");
});

// ── PII still hashed on the reservation Purchase wire (SC-9 regression guard) ──
Deno.test("WP-2: reservation Purchase PII is SHA-256 hashed on the wire (no plaintext leak)", async () => {
  const { client } = fakeSupabase({
    reservations: {
      id: RESV_ID,
      brand_id: "brand-1",
      fee_cents: 2500,
      fee_currency: "GBP",
      guest_email: "Guest.Secret@Example.COM",
      guest_phone_e164: "+44 7700 900123",
      payment_status: "paid",
    },
    ad_conversions: null,
    ...AD_CONNECTIONS,
  });
  const { fn, calls } = capturingFetch();
  await fireAdConversion(client, { reservationId: RESV_ID, surface: "web" }, {
    fetchImpl: fn,
    getToken: tokenFor,
  });
  const metaBody =
    calls.find((c) => c.url.includes("graph.facebook.com"))!.body;
  assert(
    !metaBody.toLowerCase().includes("guest.secret@example.com"),
    "plaintext email leaked",
  );
  assert(!metaBody.includes("900123"), "plaintext phone leaked");
  assertStringIncludes(metaBody, "em"); // hashed em[] field present
});
