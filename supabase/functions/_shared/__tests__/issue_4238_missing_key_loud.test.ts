// MINGLA-INVARIANT: I-4238-MISSING-KEY-LOUD | issue #4238 | a CAPI sender never returns skipped for a configuration or auth reason (no_pixel, no_token_name, no_token, pending_config); the failure is recorded as failed so ad-conversion-retry retries it for 72 h and the tracking-health run alerts once per (channel, reason) per 6 h.
/**
 * #4238 W1-2 (D15). From 30 Oct to 12 Nov the four consumer CAPI keys were
 * missing and every send was a terminal `skipped / no_token`: never retried,
 * never alerted. These tests pin the senders and the fire helper to `failed`.
 * Hermetic: no network, no real DB, no real token.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sendMetaConversion } from "../metaCapi.ts";
import { sendTikTokConversion } from "../tiktokEvents.ts";
import { sendSnapConversion } from "../snapCapi.ts";
import { sendRedditConversion } from "../redditCapi.ts";
import { sendGoogleConversion } from "../googleConversionUpload.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  type SenderConnection,
} from "../adConversionFire.ts";
import { classifyReason } from "../adSendOutcome.ts";

const input: ConversionSendInput = {
  eventId: "order-4238-loud",
  eventName: "Purchase",
  valueCents: 1000,
  currency: "GBP",
  eventSourceUrl: null,
  hashedEmail: null,
  hashedPhone: null,
  fbc: null,
  fbp: null,
  externalClickId: null,
  clientIpAddress: null,
  clientUserAgent: null,
  eventTimeMs: 1_700_000_000_000,
};

let fetchCalls = 0;
const noFetch = (() => {
  fetchCalls += 1;
  return Promise.resolve(new Response("{}", { status: 200 }));
}) as unknown as typeof fetch;

const conn = (pixelId: string | null, tokenEnvVar: string | null): SenderConnection => ({
  pixelId,
  tokenEnvVar,
  lane: "consumer",
});

const SENDERS = [
  ["meta", sendMetaConversion, "META_CAPI_ACCESS_TOKEN", "no_token"],
  ["tiktok", sendTikTokConversion, "TIKTOK_EVENTS_ACCESS_TOKEN", "no_token"],
  ["snap", sendSnapConversion, "SNAPCHAT_CAPI_TOKEN", "no_token"],
  // Reddit keeps its historical reason string (spec W1-2 item 1).
  ["reddit", sendRedditConversion, "REDDIT_ADS_CAPI_TOKEN", "pending_config"],
] as const;

for (const [channel, send, tokenName, missingReason] of SENDERS) {
  Deno.test(`#4238 W1-2 ${channel}: a missing token is failed/${missingReason}, never skipped, and sends nothing`, async () => {
    fetchCalls = 0;
    const res = await send(input, conn("px-1", tokenName), {
      getToken: () => undefined,
      fetchImpl: noFetch,
    });
    assertEquals(res.status, "failed");
    assertEquals(res.reason, missingReason);
    assertEquals(classifyReason(res.reason), "config");
    assertEquals(fetchCalls, 0);
  });

  Deno.test(`#4238 W1-2 ${channel}: a missing pixel or token name is failed, never skipped`, async () => {
    const noPixel = await send(input, conn(null, tokenName), {
      getToken: () => "tok",
      fetchImpl: noFetch,
    });
    assertEquals([noPixel.status, noPixel.reason], ["failed", "no_pixel"]);
    const noName = await send(input, conn("px-1", null), {
      getToken: () => "tok",
      fetchImpl: noFetch,
    });
    assertEquals([noName.status, noName.reason], ["failed", "no_token_name"]);
  });
}

Deno.test("#4238 W1-2 google: no conversion action is failed/pending_config; no click stays skipped/no_google_click", async () => {
  const noAction = await sendGoogleConversion(
    { ...input, externalClickId: "gclid-1" },
    { pixelId: null, tokenEnvVar: null, conversionActionResource: null },
  );
  assertEquals([noAction.status, noAction.reason], ["failed", "pending_config"]);
  const noClick = await sendGoogleConversion(input, {
    pixelId: null,
    tokenEnvVar: null,
    conversionActionResource: "customers/1/conversionActions/2",
  });
  assertEquals([noClick.status, noClick.reason], ["skipped", "no_google_click"]);
  assertEquals(classifyReason("no_google_click"), "not_applicable");
});

Deno.test("#4238 W1-2 consent reasons stay skipped / pending (unchanged)", () => {
  assertEquals(classifyReason("consent_rejected"), "consent");
  assertEquals(classifyReason("tracking_opt_out"), "consent");
  assertEquals(classifyReason("consent_pending_retryable"), "consent_pending");
});

/** Fake supabase: canned row per table; records every ad_conversions update. */
function fakeDb(tables: Record<string, unknown>) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const from = (table: string) => {
    const canned = tables[table] ?? null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      in: () => builder,
      maybeSingle: () => Promise.resolve({ data: canned, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      update: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return builder;
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: canned, error: null }),
    };
    return builder;
  };
  return {
    client: { from } as unknown as Parameters<typeof fireAdConversion>[0],
    updates,
  };
}

Deno.test("#4238 W1-2 fireAdConversion writes meta_capi_status='failed' with reason no_token when the key is missing", async () => {
  const { client, updates } = fakeDb({
    orders: {
      id: "order-4238-loud",
      event_id: "ev-1",
      total_cents: 1000,
      currency: "GBP",
      buyer_email: null,
      buyer_phone: null,
      payment_status: "paid",
      source: "online_checkout",
    },
    events: { brand_id: "brand-1" },
    ticket_checkout_sessions: {},
    ad_conversions: null,
    ad_attribution_touches: null,
    ad_connections: { extra: { dataset_id: "px-meta", pixel_id: "px" } },
  });
  const res = await fireAdConversion(client, { orderId: "order-4238-loud" }, {
    getToken: () => undefined,
    fetchImpl: noFetch,
    senders: {
      google: () =>
        Promise.resolve({ channel: "google", status: "skipped", reason: "no_google_click" }),
    },
  });
  assertEquals(res.ok, true);
  const write = updates.find((entry) =>
    entry.table === "ad_conversions" && "meta_capi_status" in entry.values
  );
  assertEquals(write?.values.meta_capi_status, "failed");
  const response = write?.values.provider_response as Record<string, { status: string; reason: string }>;
  assertEquals(response.meta.reason, "no_token");
  assertEquals(write?.values.tiktok_events_status, "failed");
  assertEquals(write?.values.snap_capi_status, "failed");
  assertEquals(write?.values.reddit_capi_status, "failed");
});
