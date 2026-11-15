// MINGLA-INVARIANT: I-4238-SNAP-SCCID-CAPTURED | issue #4238 | Snap appends ScCid to landing URLs itself (Step 0 Z4, no macro); the captured snapchat touch's raw click id reaches the Snap Conversions API as sc_click_id, unhashed, and no other network's sender gets it.
/**
 * #4238 W5-3 (D12). Z4 confirmed: no click-id macro exists and none is needed;
 * the fix is that capture keeps ScCid and the server sends it. Hermetic.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ConversionSendInput,
  fireAdConversion,
  type SenderResult,
} from "../adConversionFire.ts";
import { sendSnapConversion } from "../snapCapi.ts";
import { hostFakeDb } from "./hostFunnelFakeDb.issue4238.ts";

Deno.test("#4238 W5-3 the Snap touch's ScCid rides as sc_click_id, raw; Meta gets no click id", async () => {
  const db = hostFakeDb({
    event_rsvps: [{ id: "rsvp-snap", event_id: "ev-1", user_id: null, guest_email: null, guest_phone: null, rsvp_status: "going" }],
    events: [{ id: "ev-1", brand_id: "b-1", slug: "s", event_type: "event" }],
    brands: [{ id: "b-1", slug: "lagos" }],
    ad_attribution_touches: [{
      id: "t-snap",
      click_id: "click-snap",
      network: "snapchat",
      external_click_id: "SNAPCLICK1",
      external_click_id_type: "sccid",
      consent_state: "granted",
      created_at: new Date().toISOString(),
    }],
    ad_connections: [{ platform: "snapchat", lane: "consumer", extra: { pixel_id: "snap-px" } }],
  });
  const bodies: Record<string, unknown>[] = [];
  const meta: ConversionSendInput[] = [];
  const ok = (channel: SenderResult["channel"]) => (): Promise<SenderResult> =>
    Promise.resolve({ channel, status: "sent" });
  await fireAdConversion(db.client, { rsvpId: "rsvp-snap", clickId: "click-snap" }, {
    senders: {
      meta: (input) => {
        meta.push(input);
        return Promise.resolve({ channel: "meta", status: "sent" });
      },
      tiktok: ok("tiktok"),
      reddit: ok("reddit"),
      google: ok("google"),
      snap: (input, conn) =>
        sendSnapConversion(input, conn, {
          getToken: () => "test-token",
          fetchImpl: (_url, init) => {
            bodies.push(JSON.parse(String((init as RequestInit).body)));
            return Promise.resolve(new Response(JSON.stringify({ status: "VALID" }), { status: 200 }));
          },
        }),
    },
  });
  const event = (bodies[0]?.data as Record<string, unknown>[])[0];
  const user = event.user_data as Record<string, unknown>;
  assertEquals(user.sc_click_id, "SNAPCLICK1");
  assertEquals(meta[0].externalClickId, null);
});
