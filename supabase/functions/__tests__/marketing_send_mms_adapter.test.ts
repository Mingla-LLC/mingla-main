// ORCH-1282 — MMS media threading through the SMS adapter.
//
// Proves the per-market media rule (I-PROPOSED-1282-MMS-NG-DROPS-MEDIA):
//   - US / Twilio: mediaUrls are appended as the Twilio `MediaUrl` form param
//     (which promotes the message to MMS — Twilio Create Message docs).
//   - NG / Termii: the Termii `/api/sms/send` path is taken and NO media param
//     is transmitted (SMS-only; Termii `type:"plain"` carries no media).
//
// fails-on-revert: reverting the `params.append("MediaUrl", u)` loop in
// twilioSend makes the US body no longer contain `MediaUrl=` → the
// `capturedBody.includes("MediaUrl=https%3A")` assertion FAILS. Reverting the
// NG→Termii routing (so NG hits Twilio with mediaUrls) makes the "NG never
// hits Twilio" + "no media param" assertions FAIL.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";

// ===========================================================================
// #2218 — PIN THE CLOCK. ADDITIVE; NO ASSERTION BELOW IS CHANGED OR REMOVED.
// ===========================================================================
// Nigerian operators refuse Termii's `generic` route 20:00-08:00 WAT
// (https://developers.termii.com/campaign), and since #2218 the adapter DEFERS
// a Nigerian send inside that window instead of handing it to a route that
// cannot carry it. Every assertion in this file that expects a +234 send to
// reach Termii was therefore, before this line, silently also asserting "…and
// CI happens to be running between 08:00 and 20:00 WAT" — true for thirteen
// hours a day and red for the other eleven.
//
// Pinning the module clock to 12:00 WAT makes those assertions mean what they
// were always written to mean: given the network is carrying traffic, this is
// the route, the channel and the payload. The complementary behaviour — that
// the SAME call DEFERS at 21:00 and at 03:00 — is asserted in
// smsAdapter.issue2218.test.ts, which pins its own instants per case.
import { __pinNgClockInsideWindow } from "../_shared/ngSmsEmbargo.ts";
__pinNgClockInsideWindow();


const MEDIA_URL =
  "https://x.supabase.co/storage/v1/object/public/brand_covers/brand-1/marketing-mms/tok.jpg";

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of keys) snap[k] = Deno.env.get(k);
  return snap;
}
function restoreEnv(snap: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
}

const US_KEYS = [
  "SMS_LIVE_ENABLED_US",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
];
const NG_KEYS = [
  "SMS_LIVE_ENABLED_NG",
  "TERMII_API_KEY",
  "TERMII_BASE_URL",
  "TERMII_SENDER_ID",
];

function setUsEnv() {
  Deno.env.set("SMS_LIVE_ENABLED_US", "true");
  Deno.env.set("TWILIO_ACCOUNT_SID", "ACtest");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tokentest");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MGtest");
}
function setNgEnv() {
  Deno.env.set("SMS_LIVE_ENABLED_NG", "true");
  Deno.env.set("TERMII_API_KEY", "tk_test");
  Deno.env.set("TERMII_BASE_URL", "https://v3.api.termii.com");
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
}

Deno.test("US MMS: mediaUrls appended as the Twilio MediaUrl form param", async () => {
  const snap = snapshotEnv(US_KEYS);
  setUsEnv();

  let capturedUrl = "";
  let capturedBody = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedBody = String(init?.body ?? "");
    return Promise.resolve(new Response(JSON.stringify({ sid: "SMx" }), { status: 201 }));
  }) as typeof fetch;

  try {
    const result = await smsAdapter.send({
      to: "+15551112222",
      brandName: "Test Brand",
      message: "Look at this",
      countryCode: "US",
      mediaUrls: [MEDIA_URL],
    });
    assert(capturedUrl.includes("api.twilio.com"), `expected Twilio, got ${capturedUrl}`);
    // URLSearchParams encodes ":" → "%3A", so the media URL rides as MediaUrl=https%3A...
    assert(
      capturedBody.includes("MediaUrl=https%3A"),
      `expected MediaUrl in body, got: ${capturedBody}`,
    );
    assertEquals(result.status, "sent");
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv(snap);
  }
});

Deno.test("US SMS (no media): body carries NO MediaUrl param (regression pin)", async () => {
  const snap = snapshotEnv(US_KEYS);
  setUsEnv();

  let capturedBody = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    return Promise.resolve(new Response(JSON.stringify({ sid: "SMy" }), { status: 201 }));
  }) as typeof fetch;

  try {
    const result = await smsAdapter.send({
      to: "+15551112222",
      brandName: "Test Brand",
      message: "No photo here",
      countryCode: "US",
    });
    assert(!capturedBody.includes("MediaUrl"), `unexpected MediaUrl: ${capturedBody}`);
    assertEquals(result.status, "sent");
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv(snap);
  }
});

Deno.test("NG MMS: Termii path taken; NO media param transmitted (SMS-only)", async () => {
  const snap = snapshotEnv(NG_KEYS);
  setNgEnv();

  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(
      new Response(JSON.stringify({ code: "ok", message_id: "tm_1" }), { status: 200 }),
    );
  }) as typeof fetch;

  try {
    const result = await smsAdapter.send({
      to: "+2348012345678",
      brandName: "Test Brand",
      message: "Look at this",
      countryCode: "NG",
      messageType: "marketing",
      mediaUrls: [MEDIA_URL],
    });
    assert(capturedUrl.includes("/api/sms/send"), `expected Termii, got ${capturedUrl}`);
    assert(!capturedUrl.includes("api.twilio.com"), "NG must NOT hit Twilio");
    // The Termii JSON payload carries the text only — no media in any form.
    assertEquals(capturedBody.MediaUrl, undefined);
    assertEquals(capturedBody.media_urls, undefined);
    assertEquals(capturedBody.media, undefined);
    assertEquals(typeof capturedBody.sms, "string");
    assertEquals(capturedBody.channel, "generic");
    assertEquals(result.status, "sent");
  } finally {
    globalThis.fetch = realFetch;
    restoreEnv(snap);
  }
});
