// META-ORCH-1074 Sub-A — regression test: dual-app push routing.
//
// Asserts the keystone routing contract (SC-A1 / SC-A2):
//   * resolveOneSignalApp() maps business.*/stripe.* → "business", else
//     "consumer".
//   * sendPush() with app:"business" hits OneSignal with the BUSINESS app_id +
//     business REST key (not the consumer creds).
//   * sendPush() with app:"business" and MISSING business creds skips + returns
//     false and NEVER falls back to the consumer app_id (no cross-app leak).
//
// OneSignal is mocked via a globalThis.fetch stub; we assert on the captured
// request body (app_id) + Authorization header. Live SC-A1 verification is a
// post-deploy step for the orchestrator/tester.
//
// Run: deno test --allow-env supabase/functions/_shared/__tests__/meta_orch_1074_push_routing.test.ts

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const CONSUMER_APP_ID = "11111111-1111-1111-1111-111111111111";
const CONSUMER_KEY = "consumer-rest-key";
const BUSINESS_APP_ID = "22222222-2222-2222-2222-222222222222";
const BUSINESS_KEY = "business-rest-key";

function setAllCreds() {
  Deno.env.set("ONESIGNAL_APP_ID", CONSUMER_APP_ID);
  Deno.env.set("ONESIGNAL_REST_API_KEY", CONSUMER_KEY);
  Deno.env.set("ONESIGNAL_BUSINESS_APP_ID", BUSINESS_APP_ID);
  Deno.env.set("ONESIGNAL_BUSINESS_REST_API_KEY", BUSINESS_KEY);
}

interface CapturedRequest {
  appId: string;
  auth: string;
}

function stubFetch(captured: CapturedRequest[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const bodyStr = typeof init?.body === "string" ? init.body : "{}";
    const parsed = JSON.parse(bodyStr);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    captured.push({
      appId: parsed.app_id,
      auth: headers["Authorization"] ?? "",
    });
    return Promise.resolve(
      new Response(JSON.stringify({ id: "notif-123" }), { status: 200 }),
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

Deno.test("resolveOneSignalApp routes by type prefix", async () => {
  setAllCreds();
  const { resolveOneSignalApp } = await import("../push-utils.ts");
  assertEquals(resolveOneSignalApp("business.order_paid"), "business");
  assertEquals(resolveOneSignalApp("business.payout_paid"), "business");
  assertEquals(resolveOneSignalApp("stripe.payout_failed"), "business");
  assertEquals(resolveOneSignalApp("friend_request_received"), "consumer");
  assertEquals(resolveOneSignalApp("re_engagement"), "consumer");
  assertEquals(resolveOneSignalApp(undefined), "consumer");
  assertEquals(resolveOneSignalApp(null), "consumer");
});

Deno.test("sendPush(app:business) uses the BUSINESS app_id + key", async () => {
  setAllCreds();
  const captured: CapturedRequest[] = [];
  const restore = stubFetch(captured);
  try {
    const { sendPush } = await import("../push-utils.ts");
    const ok = await sendPush({
      targetUserId: "user-1",
      title: "New sale 🎉",
      body: "Test: $15.00 just came in.",
      app: "business",
    });
    assertEquals(ok, true);
    assertEquals(captured.length, 1);
    // Keystone: business push must carry the BUSINESS app_id, not consumer.
    assertEquals(captured[0].appId, BUSINESS_APP_ID);
    assertStringIncludes(captured[0].auth, BUSINESS_KEY);
  } finally {
    restore();
  }
});

Deno.test("sendPush(app:consumer/default) uses the CONSUMER app_id", async () => {
  setAllCreds();
  const captured: CapturedRequest[] = [];
  const restore = stubFetch(captured);
  try {
    const { sendPush } = await import("../push-utils.ts");
    const ok = await sendPush({
      targetUserId: "user-2",
      title: "Hi",
      body: "consumer push",
      // app omitted → defaults to consumer (backward-compatible).
    });
    assertEquals(ok, true);
    assertEquals(captured[0].appId, CONSUMER_APP_ID);
    assertStringIncludes(captured[0].auth, CONSUMER_KEY);
  } finally {
    restore();
  }
});

Deno.test("SC-A2: business push with MISSING business creds skips, no consumer fallback", async () => {
  // Consumer creds present, business creds absent.
  Deno.env.set("ONESIGNAL_APP_ID", CONSUMER_APP_ID);
  Deno.env.set("ONESIGNAL_REST_API_KEY", CONSUMER_KEY);
  Deno.env.delete("ONESIGNAL_BUSINESS_APP_ID");
  Deno.env.delete("ONESIGNAL_BUSINESS_REST_API_KEY");

  const captured: CapturedRequest[] = [];
  const restore = stubFetch(captured);
  try {
    const { sendPush } = await import("../push-utils.ts");
    const ok = await sendPush({
      targetUserId: "user-3",
      title: "New sale",
      body: "should not deliver",
      app: "business",
    });
    // Skipped: returns false AND never sent (no fetch captured), so it
    // physically cannot have leaked to the consumer app_id.
    assertEquals(ok, false);
    assertEquals(captured.length, 0);
  } finally {
    restore();
    setAllCreds();
  }
});
