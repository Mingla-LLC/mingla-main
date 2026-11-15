// MINGLA-INVARIANT: I-4238-NATIVE-CHECKOUT-START-NOT-WEB | issue #4238 | a checkout started in the Explorer or Host app (checkout_surface native) never sends InitiateCheckout / START_CHECKOUT to an ad network as a website event; every channel is terminally skipped/native_surface and the session is closed.
/**
 * #4238 apps-wave finding (W4-1 open question 2): native checkout START still
 * went to the web lanes. Same rule as W4-1 for the purchase. Hermetic.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ConversionSendInput,
  fireAdCheckoutStart,
  type SenderResult,
} from "../adConversionFire.ts";
import { hostFakeDb } from "./hostFunnelFakeDb.issue4238.ts";

function setup(surface: string | null) {
  const db = hostFakeDb({
    ticket_checkout_sessions: [{
      id: "cs-native",
      event_id: "ev-1",
      brand_id: "b-1",
      total_cents: 2500,
      currency: "GBP",
      buyer_user_id: "u-1",
      attribution_click_id: null,
      ad_tracking_opt_out: false,
      ad_checkout_start_sent_at: null,
      ad_checkout_start_provider_response: null,
      checkout_surface: surface,
      created_at: "2026-11-14T09:00:00.000Z",
    }],
    events: [{ id: "ev-1", event_type: "event" }],
    ad_attribution_touches: [],
    ad_connections: [{ platform: "meta", lane: "consumer", extra: { dataset_id: "ds" } }],
  });
  const sent: ConversionSendInput[] = [];
  const sender = (channel: SenderResult["channel"]) =>
  (input: ConversionSendInput): Promise<SenderResult> => {
    sent.push(input);
    return Promise.resolve({ channel, status: "sent" });
  };
  const deps = {
    senders: { meta: sender("meta"), tiktok: sender("tiktok"), snap: sender("snap") },
  };
  return { db, sent, deps };
}

Deno.test("#4238 a native checkout start sends nothing and closes the session", async () => {
  const { db, sent, deps } = setup("native");
  const res = await fireAdCheckoutStart(db.client, "cs-native", deps);
  assertEquals(sent.length, 0);
  assertEquals(res.results?.map((r) => `${r.channel}:${r.status}:${r.reason}`), [
    "meta:skipped:native_surface",
    "tiktok:skipped:native_surface",
    "snap:skipped:native_surface",
  ]);
  const row = db.row("ticket_checkout_sessions", (r) => r.id === "cs-native");
  assertEquals(typeof row?.ad_checkout_start_sent_at, "string");
  // A later retry sends nothing either.
  await fireAdCheckoutStart(db.client, "cs-native", deps);
  assertEquals(sent.length, 0);
});

Deno.test("#4238 a web (or pre-M-3, null) checkout start is unchanged", async () => {
  for (const surface of ["web", "mobile-web", null]) {
    const { db, sent, deps } = setup(surface);
    await fireAdCheckoutStart(db.client, "cs-native", deps);
    assertEquals(sent.map((s) => s.eventName).sort(), ["InitiateCheckout", "InitiateCheckout", "START_CHECKOUT"]);
  }
});
