// MINGLA-INVARIANT: I-4238-TIKTOK-PIXEL-CODE | issue #4238 | the TikTok Events API event_source_id is the same pixel code the browser loads (extra.pixel_code); the numeric extra.pixel_id is never sent as event_source_id, and a missing code is failed/no_pixel.
/**
 * #4238 W1-4 (D3, D6 server half). Step 0 Z1 (TikTok Events API v1.3, read
 * 2026-11-14): for web events `event_source_id` takes the Pixel Code, and
 * pixel/list returns `pixel_code` next to `pixel_id`. The server was sending
 * the numeric id. Hermetic: fetch is stubbed; no token is real.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  selectTikTokPixel,
  type TikTokClient,
  tiktokFetchPixels,
  type TikTokPixelSnapshot,
} from "../tiktok.ts";
import { fireAdConversion } from "../adConversionFire.ts";

const NUMERIC_ID = "7662469356818858002";
const PIXEL_CODE = "D9B98EBC77U1EOHV2O0G";

const client: TikTokClient = {
  platform: "tiktok",
  token: "synthetic-token",
  advertiserId: "adv-1",
  apiVersion: "v1.3",
  apiBase: "https://business-api.tiktok.com",
};

Deno.test("#4238 W1-4 (a) pixel/list yields pixelCode next to the numeric pixelId", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          code: 0,
          message: "OK",
          data: {
            pixels: [{
              pixel_id: NUMERIC_ID,
              pixel_code: PIXEL_CODE,
              pixel_name: "Mingla",
              activity_status: "ACTIVE",
              events: [],
            }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as typeof fetch;
  try {
    const pixels = await tiktokFetchPixels(client);
    assertEquals(pixels.length, 1);
    assertEquals(pixels[0].pixelId, NUMERIC_ID);
    assertEquals(pixels[0].pixelCode, PIXEL_CODE);
  } finally {
    globalThis.fetch = realFetch;
  }
});

const pixel = (pixelId: string, pixelCode: string | null): TikTokPixelSnapshot => ({
  pixelId,
  pixelCode,
  pixelName: null,
  activityStatus: "ACTIVE",
  eventsCount: 0,
});

Deno.test("#4238 W1-4 selection: the expected browser code wins; no match is a mismatch, never the numeric id", () => {
  const list = [pixel("111", "OTHERCODE01"), pixel(NUMERIC_ID, PIXEL_CODE)];
  assertEquals(selectTikTokPixel(list, PIXEL_CODE), {
    pixel: list[1],
    pixelCode: PIXEL_CODE,
    mismatch: false,
  });
  assertEquals(selectTikTokPixel(list, "NOTLISTED01"), {
    pixel: list[0],
    pixelCode: null,
    mismatch: true,
  });
  // One listed pixel and no expected code: use its code.
  assertEquals(selectTikTokPixel([list[1]], null).pixelCode, PIXEL_CODE);
  // Several pixels and no expected code: ambiguous, store no code.
  assertEquals(selectTikTokPixel(list, null), {
    pixel: list[0],
    pixelCode: null,
    mismatch: true,
  });
  // A listed pixel without a code never falls back to its numeric id.
  assertEquals(selectTikTokPixel([pixel(NUMERIC_ID, null)], null), {
    pixel: pixel(NUMERIC_ID, null),
    pixelCode: null,
    mismatch: true,
  });
});

function fakeDb(extra: Record<string, unknown>) {
  const tables: Record<string, unknown> = {
    orders: {
      id: "order-4238-tt",
      event_id: "ev-1",
      total_cents: 1500,
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
    ad_connections: { extra },
  };
  const from = (table: string) => {
    const canned = tables[table] ?? null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      maybeSingle: () => Promise.resolve({ data: canned, error: null }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      update: () => builder,
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: canned, error: null }),
    };
    return builder;
  };
  return { from } as unknown as Parameters<typeof fireAdConversion>[0];
}

function capture() {
  const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fn = ((url: string | URL | Request, init?: RequestInit) => {
    bodies.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return Promise.resolve(
      new Response(JSON.stringify({ code: 0 }), { status: 200 }),
    );
  }) as unknown as typeof fetch;
  return { fn, bodies };
}

const onlyTikTokToken = (name: string): string | undefined =>
  name === "TIKTOK_EVENTS_ACCESS_TOKEN" ? "synthetic-token" : undefined;

Deno.test("#4238 W1-4 (b) a connection with both ids sends event_source_id = the pixel code", async () => {
  const { fn, bodies } = capture();
  const res = await fireAdConversion(
    fakeDb({ pixel_id: NUMERIC_ID, pixel_code: PIXEL_CODE }),
    { orderId: "order-4238-tt" },
    { fetchImpl: fn, getToken: onlyTikTokToken },
  );
  const tiktok = bodies.find((entry) => entry.url.includes("business-api.tiktok.com"));
  assertEquals(tiktok?.body.event_source_id, PIXEL_CODE);
  assertEquals(res.results?.find((result) => result.channel === "tiktok")?.status, "sent");
});

Deno.test("#4238 W1-4 (c) with no pixel_code the result is failed/no_pixel, never the numeric id", async () => {
  const { fn, bodies } = capture();
  const res = await fireAdConversion(
    fakeDb({ pixel_id: NUMERIC_ID }),
    { orderId: "order-4238-tt" },
    { fetchImpl: fn, getToken: onlyTikTokToken },
  );
  const tiktok = res.results?.find((result) => result.channel === "tiktok");
  assertEquals([tiktok?.status, tiktok?.reason], ["failed", "no_pixel"]);
  assertEquals(
    bodies.some((entry) => entry.url.includes("business-api.tiktok.com")),
    false,
  );
});
