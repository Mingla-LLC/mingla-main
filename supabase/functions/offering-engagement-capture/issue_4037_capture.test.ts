import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  handleOfferingEngagementCapture,
  sourceSignals,
  validateCaptureBody,
} from "./index.ts";

const EVENT_ID = "00000000-4037-4000-8000-000000000001";
const BRAND_ID = "00000000-4037-4000-8000-000000000002";
const ENTITY_ID = "00000000-4037-4000-8000-000000000003";
const SESSION_ID = "00000000-4037-4000-8000-000000000004";
const SALT = "a".repeat(64);

const validBody = {
  eventId: EVENT_ID,
  brandId: BRAND_ID,
  entityType: "event",
  entityId: ENTITY_ID,
  eventType: "page_view",
  ctaType: null,
  checkoutSessionId: null,
  surface: "buyer_web",
  pageUrl: "https://host.usemingla.com/e/brand/event?utm_source=instagram",
  referrer: "https://l.instagram.com/link",
};

Deno.test("#4037 strict capture body couples event-specific fields", () => {
  assert(validateCaptureBody(validBody) !== null);
  assertEquals(validateCaptureBody({ ...validBody, surprise: true }), null);
  assertEquals(
    validateCaptureBody({
      ...validBody,
      eventType: "cta_click",
      ctaType: null,
    }),
    null,
  );
  assertEquals(
    validateCaptureBody({
      ...validBody,
      eventType: "checkout_start",
      checkoutSessionId: SESSION_ID,
    })?.checkoutSessionId,
    SESSION_ID,
  );
  assertEquals(
    validateCaptureBody({
      ...validBody,
      entityType: "brand",
      entityId: ENTITY_ID,
    }),
    null,
  );
  assertEquals(
    validateCaptureBody({
      ...validBody,
      entityType: "brand",
      entityId: null,
    })?.entityId,
    null,
  );
});

Deno.test(
  "#4037 source signals retain only bounded classification inputs",
  () => {
    const body = validateCaptureBody({
      ...validBody,
      pageUrl:
        "https://host.usemingla.com/e/brand/event?mc_id=campaign-7&ms=share.v1&utm_source=instagram&utm_campaign=private",
      referrer: "https://www.instagram.com/stories/person/123?secret=value",
    });
    assert(body !== null);
    assertEquals(sourceSignals(body), {
      mcId: "campaign-7",
      referrerHost: "instagram.com",
      referrerPath: "/stories/person/123",
      hasMinglaShare: true,
      hasNonMinglaUtm: true,
    });
  },
);

Deno.test(
  "#4037 public capture hashes server request identity and emits no body",
  async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve({
          data: name === "claim_offering_engagement_salt" ? SALT : true,
          error: null,
        });
      },
    } as unknown as SupabaseClient;
    const response = await handleOfferingEngagementCapture(
      new Request("https://edge.test/offering-engagement-capture", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.7",
          "user-agent": "Mozilla/5.0 MinglaContractBrowser",
        },
        body: JSON.stringify(validBody),
      }),
      {
        client,
        now: () => new Date("2026-10-21T10:00:00Z"),
        randomSalt: () => "b".repeat(64),
      },
    );
    assertEquals(response.status, 204);
    assertEquals(await response.text(), "");
    assertEquals(
      calls.map((call) => call.name),
      ["claim_offering_engagement_salt", "capture_offering_engagement_event"],
    );
    const capture = calls[1]!.args;
    assertEquals(capture.p_referrer_host, "l.instagram.com");
    assertEquals(capture.p_has_non_mingla_utm, true);
    assert(
      typeof capture.p_visitor_key === "string" &&
        /^[0-9a-f]{64}$/.test(capture.p_visitor_key),
    );
    assertEquals(JSON.stringify(capture).includes("203.0.113.7"), false);
    assertEquals(JSON.stringify(capture).includes("Mozilla"), false);
  },
);

Deno.test("#4037 bot traffic drops before salt access", async () => {
  let calls = 0;
  const client = {
    rpc: () => {
      calls += 1;
      return Promise.resolve({ data: SALT, error: null });
    },
  } as unknown as SupabaseClient;
  const response = await handleOfferingEngagementCapture(
    new Request("https://edge.test/offering-engagement-capture", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.9",
        "user-agent": "Googlebot/2.1",
      },
      body: JSON.stringify(validBody),
    }),
    {
      client,
      now: () => new Date("2026-10-21T10:00:00Z"),
      randomSalt: () => SALT,
    },
  );
  assertEquals(response.status, 204);
  assertEquals(calls, 0);
});

Deno.test(
  "#4037 WhatsApp human browser counts while its bare preview bot drops",
  async () => {
    const userAgents = [
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 WhatsApp/2.26.20",
      "WhatsApp/2.26.20 A",
    ];
    const captured: number[] = [];
    for (const userAgent of userAgents) {
      let captureCalls = 0;
      const client = {
        rpc: (name: string) => {
          if (name === "capture_offering_engagement_event") captureCalls += 1;
          return Promise.resolve({
            data: name === "claim_offering_engagement_salt" ? SALT : true,
            error: null,
          });
        },
      } as unknown as SupabaseClient;
      await handleOfferingEngagementCapture(
        new Request("https://edge.test/offering-engagement-capture", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": "203.0.113.10",
            "user-agent": userAgent,
          },
          body: JSON.stringify(validBody),
        }),
        {
          client,
          now: () => new Date("2026-10-21T10:00:00Z"),
          randomSalt: () => SALT,
        },
      );
      captured.push(captureCalls);
    }
    assertEquals(captured, [1, 0]);
  },
);
