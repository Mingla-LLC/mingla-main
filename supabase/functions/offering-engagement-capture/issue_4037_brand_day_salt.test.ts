// #4037 — Seth's decisions 2 and 5 at the capture edge:
//  - the salt is claimed for the BRAND (the database resolves the brand's own
//    local day), never for a UTC day computed at the edge;
//  - view_brand / view_venue / view_offering taps are accepted as engagement.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  handleOfferingEngagementCapture,
  validateCaptureBody,
} from "./index.ts";

const BRAND_ID = "00000000-4037-4000-8000-0000000000b1";
const ENTITY_ID = "00000000-4037-4000-8000-0000000000e1";
const SALT = "c".repeat(64);

const body = (overrides: Record<string, unknown> = {}) => ({
  eventId: crypto.randomUUID(),
  brandId: BRAND_ID,
  entityType: "event",
  entityId: ENTITY_ID,
  eventType: "page_view",
  ctaType: null,
  checkoutSessionId: null,
  surface: "buyer_web",
  pageUrl: "https://host.usemingla.com/e/brand/event",
  referrer: null,
  ...overrides,
});

async function capture(
  requestBody: Record<string, unknown>,
  now: Date,
): Promise<Array<{ name: string; args: Record<string, unknown> }>> {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: name === "claim_offering_engagement_salt" ? SALT : "counted",
        error: null,
      });
    },
  } as unknown as SupabaseClient;
  const response = await handleOfferingEngagementCapture(
    new Request("https://edge.test/offering-engagement-capture", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "198.51.100.4",
        "user-agent": "Mozilla/5.0 Issue4037Browser",
      },
      body: JSON.stringify(requestBody),
    }),
    { client, now: () => now, randomSalt: () => "d".repeat(64) },
  );
  assertEquals(response.status, 204);
  return calls;
}

Deno.test("#4037 decision 2: the salt is claimed for the brand, not a UTC day", async () => {
  // 23:30 UTC is already the next day in Lagos and still the same day in New
  // York; the edge must not decide either, so it sends no day at all.
  const calls = await capture(body(), new Date("2027-01-14T23:30:00Z"));
  assertEquals(calls[0]?.name, "claim_offering_engagement_salt");
  assertEquals(calls[0]?.args, {
    p_brand_id: BRAND_ID,
    p_candidate: "d".repeat(64),
  });
  assertEquals("p_day" in (calls[0]?.args ?? {}), false);
  assertEquals(calls[1]?.args.p_brand_id, BRAND_ID);
});

Deno.test("#4037 decision 5: view taps are accepted as engagement", async () => {
  for (const ctaType of ["view_brand", "view_venue", "view_offering"]) {
    const requestBody = body({ eventType: "cta_click", ctaType });
    assertEquals(validateCaptureBody(requestBody)?.ctaType, ctaType);
    const calls = await capture(requestBody, new Date("2027-01-14T12:00:00Z"));
    assertEquals(calls[1]?.name, "capture_offering_engagement_event");
    assertEquals(calls[1]?.args.p_event_type, "cta_click");
    assertEquals(calls[1]?.args.p_cta_type, ctaType);
  }
  // Still strict: an unknown tap type is refused before any database call.
  const unknown = body({ eventType: "cta_click", ctaType: "view_everything" });
  assertEquals(validateCaptureBody(unknown), null);
  const calls = await capture(unknown, new Date("2027-01-14T12:00:00Z"));
  assert(calls.length === 0);
});
