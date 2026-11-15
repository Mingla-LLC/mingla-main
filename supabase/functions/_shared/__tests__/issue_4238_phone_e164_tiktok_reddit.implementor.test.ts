// MINGLA-INVARIANT: I-4238-PHONE-HASH-PER-PLATFORM | issue #4238 | TikTok and Reddit receive the SHA-256 of the E.164 phone WITH the leading `+` (Step 0 Z5/Z6, like Google), while Meta and Snap keep the digits-only hash.
/**
 * #4238 P2-1. TikTok (Events API user.phone) and Reddit (CAPI v3
 * user.phone_number) were sent the digits-only hash, which never matches the
 * E.164 hash those platforms compute. Hermetic: real identityHashes, real
 * senders, stubbed fetch.
 */
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ConversionSendInput } from "../adConversionFire.ts";
import { identityHashes } from "../adIdentity.ts";
import { buildRedditConversionBody } from "../redditCapi.ts";
import { sendTikTokConversion } from "../tiktokEvents.ts";

async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function input(): Promise<ConversionSendInput> {
  const ids = await identityHashes("buyer@example.com", "+44 7700 900123");
  return {
    eventId: "order-4238-p21",
    eventName: "CompletePayment",
    valueCents: 2500,
    currency: "GBP",
    eventSourceUrl: "https://host.usemingla.com/e/brand/event",
    fbc: null,
    fbp: null,
    externalClickId: null,
    clientIpAddress: "203.0.113.7",
    clientUserAgent: "Mozilla/5.0",
    eventTimeMs: Date.parse("2026-11-14T09:00:00.000Z"),
    ...ids,
  };
}

Deno.test("#4238 P2-1 the E.164 hash keeps the + and differs from the digits-only hash", async () => {
  const i = await input();
  assertEquals(i.hashedPhoneE164, await sha256Hex("+447700900123"));
  assertEquals(i.hashedPhone, await sha256Hex("447700900123"));
  assertNotEquals(i.hashedPhoneE164, i.hashedPhone);
});

Deno.test("#4238 P2-1 TikTok user.phone is the E.164-with-+ hash", async () => {
  const i = await input();
  let body: Record<string, unknown> | null = null;
  const result = await sendTikTokConversion(
    i,
    { pixelId: "D9B98EBC77U1EOHV2O0G", tokenEnvVar: "TIKTOK_EVENTS_ACCESS_TOKEN" } as never,
    {
      getToken: () => "token",
      fetchImpl: ((_u: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return Promise.resolve(new Response(JSON.stringify({ code: 0, message: "OK" }), { status: 200 }));
      }) as typeof fetch,
    },
  );
  assertEquals(result.status, "sent");
  assert(body);
  const user = ((body as Record<string, unknown>).data as Array<Record<string, Record<string, unknown>>>)[0].user;
  assertEquals(user.phone, await sha256Hex("+447700900123"));
});

Deno.test("#4238 P2-1 Reddit user.phone_number is the E.164-with-+ hash", async () => {
  const body = buildRedditConversionBody(await input());
  const event = ((body.data as Record<string, unknown>).events as Array<Record<string, Record<string, unknown>>>)[0];
  assertEquals(event.user.phone_number, await sha256Hex("+447700900123"));
});
