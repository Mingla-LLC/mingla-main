// ORCH-1082 [business notification deep-link handlers] — TESTER adversarial
// regression: organiser-targeted pushes physically cannot land on the consumer
// OneSignal app.
//
// Distinct angle from the implementor happy-path (which is pure path parsing in
// `businessNotificationRouting.test.ts`): this test attacks the DELIVERY TARGET
// — which OneSignal application physically receives the push. The exact
// production bug an organiser hits is a push that silently delivers to the
// consumer app and is never seen on their business device.
//
// Coverage:
//   * 17a routing: resolveOneSignalApp("stripe.partner_detach_completed") ===
//     "business" AND the OLD "partner_stripe.detach_completed" === "consumer"
//     (proves the old emit was wrong + guards a partial re-prefix).
//   * 17a emit-shape (source): partner-stripe-detach emits the NEW type +
//     /partner/earnings deepLink, and contains NO stale strings.
//   * VC delivery-target (load-bearing): a sendPush({ app:"business" }) stubbed
//     fetch captures the BUSINESS app_id, never the consumer one.
//   * VC emit-shape (source): both venue_claim_review + venue_claim_feedback
//     sendPush payloads in admin-review-venue-claim include app: "business".
//
// Run: deno test --allow-env --allow-read \
//   supabase/functions/admin-review-venue-claim/__tests__/orch_1082_push_app_routing.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const CONSUMER_APP_ID = "11111111-1111-1111-1111-111111111111";
const CONSUMER_KEY = "consumer-rest-key";
const BUSINESS_APP_ID = "22222222-2222-2222-2222-222222222222";
const BUSINESS_KEY = "business-rest-key";

function setAllCreds(): void {
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
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const bodyStr = typeof init?.body === "string" ? init.body : "{}";
    const parsed = JSON.parse(bodyStr);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    captured.push({
      appId: parsed.app_id,
      auth: headers["Authorization"] ?? "",
    });
    return Promise.resolve(
      new Response(JSON.stringify({ id: "notif-1082" }), { status: 200 }),
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const SHARED = new URL("../../_shared/push-utils.ts", import.meta.url).pathname;
const DETACH = new URL("../../partner-stripe-detach/index.ts", import.meta.url)
  .pathname;
const VENUE = new URL("../index.ts", import.meta.url).pathname;

// ── 17a: type-prefix routing ────────────────────────────────────────────────
Deno.test("17a: stripe.partner_detach_completed routes to BUSINESS; old type → consumer", async () => {
  setAllCreds();
  const { resolveOneSignalApp } = await import("../../_shared/push-utils.ts");
  // New (fixed) type inherits the stripe.* business routing.
  assertEquals(resolveOneSignalApp("stripe.partner_detach_completed"), "business");
  // Old (broken) type fell to consumer — proving the bug + guarding a partial
  // re-prefix that leaves the old string somewhere.
  assertEquals(resolveOneSignalApp("partner_stripe.detach_completed"), "consumer");
});

// ── 17a: emit-shape source assertion ────────────────────────────────────────
Deno.test("17a: partner-stripe-detach emits the new type + /partner/earnings, no stale strings", async () => {
  const src = await Deno.readTextFile(DETACH);
  assertStringIncludes(src, '"stripe.partner_detach_completed"');
  assertStringIncludes(src, "mingla-business://partner/earnings");
  // The stale type + dead deep link must be gone.
  assert(
    !src.includes('"partner_stripe.detach_completed"'),
    "stale type partner_stripe.detach_completed must not remain",
  );
  assert(
    !src.includes("mingla-business://account/partner-earnings"),
    "stale deepLink account/partner-earnings must not remain",
  );
});

// ── VC: load-bearing delivery-target attack ─────────────────────────────────
Deno.test("VC: an organiser-targeted app:business push hits the BUSINESS app_id, never consumer", async () => {
  setAllCreds();
  const captured: CapturedRequest[] = [];
  const restore = stubFetch(captured);
  try {
    const { sendPush } = await import("../../_shared/push-utils.ts");
    // Mirrors the venue_claim_review / venue_claim_feedback call shape.
    const ok = await sendPush({
      targetUserId: "organiser-account-id",
      title: "Venue claim approved",
      body: "Your venue is now live.",
      data: {
        type: "venue_claim_review",
        brand_id: "brand-1",
        deepLink: "mingla-business://brand/brand-1/listing",
      },
      androidChannelId: "system",
      app: "business",
    });
    assertEquals(ok, true);
    assertEquals(captured.length, 1);
    // Keystone: the captured request physically carries the BUSINESS app_id —
    // it cannot have leaked to the consumer app.
    assertEquals(captured[0].appId, BUSINESS_APP_ID);
    assert(
      captured[0].appId !== CONSUMER_APP_ID,
      "organiser push must NOT carry the consumer app_id",
    );
    assertStringIncludes(captured[0].auth, BUSINESS_KEY);
  } finally {
    restore();
  }
});

// ── VC: emit-shape source assertion ─────────────────────────────────────────
Deno.test("VC: both venue_claim sendPush calls carry app: business", async () => {
  const src = await Deno.readTextFile(VENUE);
  // Both organiser-targeted direct sendPush calls must opt into the business app.
  assertStringIncludes(src, "venue_claim_review");
  assertStringIncludes(src, "venue_claim_feedback");
  const appBusinessCount = (src.match(/app:\s*"business"/g) ?? []).length;
  assert(
    appBusinessCount >= 2,
    `expected >=2 app:"business" direct sendPush opt-ins, found ${appBusinessCount}`,
  );
});

// Reference the shared module path so a moved file fails loudly.
Deno.test("push-utils module is resolvable", async () => {
  const stat = await Deno.stat(SHARED);
  assert(stat.isFile);
});
