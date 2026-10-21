/** toward #3697 approved ad-learning fixes — hermetic runtime proof. */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type {
  ConversionSendInput,
  SenderConnection,
} from "../adConversionFire.ts";
import { preserveObservedSpend } from "../adSpendSync.ts";
import { sendMetaConversion } from "../metaCapi.ts";
import { sendSnapConversion } from "../snapCapi.ts";
import { parseSnapchatPixelSignal } from "../snapchat.ts";

function conversionInput(): ConversionSendInput {
  return {
    eventId: "checkout-3697",
    eventName: "InitiateCheckout",
    valueCents: 2400,
    currency: "USD",
    eventSourceUrl: null,
    hashedEmail: null,
    hashedPhone: null,
    fbc: "fb.1.1.click",
    fbp: "fb.1.1.browser",
    externalId: "hashed-buyer-id",
    scCookie1: "snap-cookie",
    externalClickId: "snap-click",
    clientIpAddress: "203.0.113.8",
    clientUserAgent: "Issue3697/1.0",
    eventTimeMs: 1_800_000_000_000,
  };
}

const connection: SenderConnection = {
  pixelId: "pixel-3697",
  tokenEnvVar: "TEST_CAPI_TOKEN",
};

Deno.test("#3697 Snap pixel signal is derived from real domain event totals", () => {
  assertEquals(
    parseSnapchatPixelSignal({
      timeseries_stats: [{
        timeseries_stat: {
          domains: [
            { domain_name: "usemingla.com", total_events: 4 },
            { domain_name: "business.usemingla.com", total_events: 2 },
          ],
        },
      }],
    }),
    { hasSignal: true, totalEvents: 6 },
  );
  assertEquals(parseSnapchatPixelSignal({ timeseries_stats: [] }), {
    hasSignal: false,
    totalEvents: 0,
  });
});

Deno.test("#3697 spend sync never replaces observed non-zero spend with zero", () => {
  const incoming = [{
    campaign_id: "campaign-3697",
    platform: "meta" as const,
    spend_date: "2026-10-21",
    spend_cents: 0,
    impressions: 0,
    clicks: 0,
    currency: "USD",
  }, {
    campaign_id: "campaign-3697",
    platform: "meta" as const,
    spend_date: "2026-10-22",
    spend_cents: 250,
    impressions: 10,
    clicks: 1,
    currency: "USD",
  }];
  assertEquals(
    preserveObservedSpend(incoming, [{
      spend_date: "2026-10-21",
      spend_cents: 4800,
    }]),
    [incoming[1]],
  );
});

Deno.test("#3697 Meta CAPI sends external_id plus browser and request match data", async () => {
  let sent: Record<string, unknown> = {};
  const result = await sendMetaConversion(conversionInput(), connection, {
    getToken: () => "token",
    fetchImpl: (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assertEquals(result.status, "sent");
  const event = (sent.data as Record<string, unknown>[])[0];
  assertEquals(event.event_id, "checkout-3697");
  assertEquals(event.event_name, "InitiateCheckout");
  assertEquals(event.user_data, {
    external_id: ["hashed-buyer-id"],
    fbc: "fb.1.1.click",
    fbp: "fb.1.1.browser",
    client_ip_address: "203.0.113.8",
    client_user_agent: "Issue3697/1.0",
  });
});

Deno.test("#3697 Snap CAPI sends sc_cookie1, click id and shared dedup id", async () => {
  let sent: Record<string, unknown> = {};
  const input = { ...conversionInput(), eventName: "START_CHECKOUT" };
  const result = await sendSnapConversion(input, connection, {
    getToken: () => "token",
    fetchImpl: (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });
  assertEquals(result.status, "sent");
  const event = (sent.data as Record<string, unknown>[])[0];
  assertEquals(event.client_dedup_id, "checkout-3697");
  assertEquals(event.event_name, "START_CHECKOUT");
  assertEquals(event.user_data, {
    sc_click_id: "snap-click",
    sc_cookie1: "snap-cookie",
    client_ip_address: "203.0.113.8",
    client_user_agent: "Issue3697/1.0",
  });
});
