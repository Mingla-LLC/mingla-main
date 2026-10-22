/** #3697 Wave 2 — browser/server identity and provider-body reliability. */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConversionSendInput, SenderConnection } from "../adConversionFire.ts";
import { sendMetaConversion } from "../metaCapi.ts";
import { sendSnapConversion } from "../snapCapi.ts";
import { sendTikTokConversion } from "../tiktokEvents.ts";

const connection: SenderConnection = {
  pixelId: "pixel-3697",
  tokenEnvVar: "TEST_TOKEN",
};

function input(eventName = "Purchase"): ConversionSendInput {
  return {
    eventId: "action-3697",
    eventName,
    valueCents: 4200,
    currency: "NGN",
    contentId: "event-3697",
    brandId: "brand-3697",
    eventSourceUrl: "https://usemingla.com/e/brand/event",
    hashedEmail: "hashed-email",
    hashedPhone: "hashed-phone",
    fbc: "fb.1.1.click",
    fbp: "fb.1.1.browser",
    externalId: "hashed-buyer-id",
    ttp: "tiktok-cookie",
    scCookie1: "snap-cookie",
    externalClickId: "platform-click",
    clientIpAddress: "203.0.113.9",
    clientUserAgent: "Issue3697/2.0",
    eventTimeMs: 1_800_000_000_000,
  };
}

function capture(body: Record<string, unknown> = {}) {
  let sent: Record<string, unknown> = {};
  return {
    fetchImpl: ((_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as typeof fetch,
    sent: () => sent,
  };
}

Deno.test("#3697 Meta CAPI carries event content and brand identity", async () => {
  const wire = capture();
  const result = await sendMetaConversion(input(), connection, {
    getToken: () => "token",
    fetchImpl: wire.fetchImpl,
  });
  assertEquals(result.status, "sent");
  const event = (wire.sent().data as Record<string, unknown>[])[0];
  assertEquals(event.custom_data, {
    value: 42,
    currency: "NGN",
    content_ids: ["event-3697"],
    content_type: "product",
    brand_id: "brand-3697",
  });
});

Deno.test("#3697 TikTok CAPI carries event, brand, _ttp and external buyer id", async () => {
  const wire = capture({ code: 0, message: "OK" });
  const result = await sendTikTokConversion(input("CompletePayment"), connection, {
    getToken: () => "token",
    fetchImpl: wire.fetchImpl,
  });
  assertEquals(result.status, "sent");
  const event = (wire.sent().data as Record<string, unknown>[])[0];
  assertEquals(event.user, {
    email: "hashed-email",
    phone: "hashed-phone",
    ttclid: "platform-click",
    external_id: "hashed-buyer-id",
    ttp: "tiktok-cookie",
    ip: "203.0.113.9",
    user_agent: "Issue3697/2.0",
  });
  assertEquals(event.properties, {
    value: 42,
    currency: "NGN",
    content_id: "event-3697",
    content_type: "product",
    brand_id: "brand-3697",
  });
});

Deno.test("#3697 Snap CAPI carries item, brand and external buyer id", async () => {
  const wire = capture({ request_status: "SUCCESS", results: [{ sub_request_status: "SUCCESS" }] });
  const result = await sendSnapConversion(input("PURCHASE"), connection, {
    getToken: () => "token",
    fetchImpl: wire.fetchImpl,
  });
  assertEquals(result.status, "sent");
  const event = (wire.sent().data as Record<string, unknown>[])[0];
  assertEquals((event.user_data as Record<string, unknown>).external_id, "hashed-buyer-id");
  assertEquals(event.custom_data, {
    value: 42,
    currency: "NGN",
    item_ids: ["event-3697"],
    content_type: "product",
    brand_id: "brand-3697",
  });
});

Deno.test("#3697 Snap CAPI treats a 200 provider envelope failure as failed", async () => {
  const outer = capture({ request_status: "ERROR", debug_message: "invalid event" });
  const outerResult = await sendSnapConversion(input("PURCHASE"), connection, {
    getToken: () => "token",
    fetchImpl: outer.fetchImpl,
  });
  assertEquals(outerResult, {
    channel: "snap",
    status: "failed",
    reason: "request_status_error",
    httpStatus: 200,
  });

  const nested = capture({
    request_status: "SUCCESS",
    results: [{ sub_request_status: "FAILURE", errors: [{ message: "bad item" }] }],
  });
  const nestedResult = await sendSnapConversion(input("PURCHASE"), connection, {
    getToken: () => "token",
    fetchImpl: nested.fetchImpl,
  });
  assertEquals(nestedResult, {
    channel: "snap",
    status: "failed",
    reason: "sub_request_status_failure",
    httpStatus: 200,
  });
});
