import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AdConversionRetryRow,
  conversionRetryInput,
  failedStatusesToPending,
  retryGraceCutoff,
  retryWindowCutoff,
} from "../adConversionRetry.ts";

const baseRow = (): AdConversionRetryRow => ({
  event_id: "reservation-1",
  order_id: null,
  stay_group_id: null,
  event_type: "reservation",
  surface: "web",
  lane: "consumer",
  updated_at: "2026-10-22T10:00:00.000Z",
  meta_capi_status: "sent",
  tiktok_events_status: "failed",
  snap_capi_status: "pending",
  reddit_capi_status: "skipped",
  google_ads_status: "sent",
});

Deno.test("#3697 retry resets only failed provider lanes", () => {
  assertEquals(failedStatusesToPending(baseRow()), {
    tiktok_events_status: "pending",
  });
});

Deno.test("#3697 retry preserves conversion identity and source kind", () => {
  assertEquals(conversionRetryInput(baseRow()), {
    reservationId: "reservation-1",
    eventType: "reservation",
    surface: "web",
    lane: "consumer",
  });
  assertEquals(
    conversionRetryInput({
      ...baseRow(),
      order_id: "order-1",
    }).orderId,
    "order-1",
  );
  assertEquals(
    conversionRetryInput({
      ...baseRow(),
      stay_group_id: "stay-1",
    }).stayGroupId,
    "stay-1",
  );
});

Deno.test("#3697 retry window is bounded to 24 hours with a five-minute grace", () => {
  const now = Date.parse("2026-10-22T12:00:00.000Z");
  assertEquals(retryWindowCutoff(now), "2026-10-21T12:00:00.000Z");
  assertEquals(retryGraceCutoff(now), "2026-10-22T11:55:00.000Z");
});

Deno.test("#3697 retry edge re-evaluates consent through the shared fire helpers", async () => {
  const source = await Deno.readTextFile(
    new URL("../../ad-conversion-retry/index.ts", import.meta.url),
  );
  const fireSource = await Deno.readTextFile(
    new URL("../adConversionFire.ts", import.meta.url),
  );
  assertEquals(
    source.includes("fireAdConversion(db, conversionRetryInput(row))"),
    true,
  );
  assertEquals(source.includes("fireAdCheckoutStart(db, id)"), true);
  assertEquals(source.includes('.gte("created_at", windowStart)'), true);
  assertEquals(source.includes('.lte("updated_at", graceCutoff)'), true);
  assertEquals(source.includes("SUPABASE_SERVICE_ROLE_KEY"), true);
  assertEquals(
    /ad_checkout_start_sent_at:\s*retryableFailure\s*\?\s*null\s*:\s*new Date/
      .test(
        fireSource,
      ),
    true,
  );
});
