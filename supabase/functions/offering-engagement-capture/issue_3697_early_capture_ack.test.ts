import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOfferingEngagementCapture } from "./index.ts";

const body = {
  eventId: "36970000-0000-4000-8000-000000000001",
  brandId: "36970000-0000-4000-8000-000000000002",
  entityType: "event",
  entityId: "36970000-0000-4000-8000-000000000003",
  eventType: "page_view",
  ctaType: null,
  checkoutSessionId: null,
  surface: "buyer_web",
  pageUrl: "https://host.usemingla.com/e/brand/event",
  referrer: null,
};

function request(): Request {
  return new Request("https://edge.test/offering-engagement-capture", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.7",
      "user-agent": "Mozilla/5.0 MinglaContractBrowser",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("#3697 early capture receives a retryable HTTP failure when storage fails", async () => {
  const client = {
    rpc: (name: string) =>
      Promise.resolve(
        name === "claim_offering_engagement_salt"
          ? { data: "a".repeat(64), error: null }
          : { data: null, error: { message: "storage unavailable" } },
      ),
  } as unknown as SupabaseClient;
  const response = await handleOfferingEngagementCapture(request(), {
    client,
    now: () => new Date("2026-10-22T12:00:00Z"),
    randomSalt: () => "b".repeat(64),
  });
  assertEquals(response.status, 503);
});
