// MINGLA-INVARIANT: I-4238-EVENT-TIME-IS-ACTION-TIME | issue #4238 | a retried conversion carries the same event_time as its first send (the caller's action time, else the first fire's ad_conversions.created_at), and a website server event always carries event_source_url (the buyer's public page, or the checkout surface for checkout start).
/**
 * #4238 W1-5 (D16). Server events used send time as event_time and carried no
 * page URL, so a retry two hours later looked like a new, page-less event.
 * Hermetic: a stateful fake ad_conversions row, captured sender inputs.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ConversionSendInput,
  fireAdCheckoutStart,
  fireAdConversion,
  type SenderResult,
} from "../adConversionFire.ts";
import {
  brandPageUrl,
  checkoutStartUrl,
  eventPageUrl,
} from "../adEventSourceUrl.ts";

const T = Date.parse("2026-11-14T09:00:00.000Z");
const ORDER_ID = "order-4238-w15";
const EVENT_UUID = "6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** Stateful fake: ad_conversions and ticket_checkout_sessions keep writes. */
function statefulDb(nowRef: { ms: number }, eventType = "event") {
  const state: Record<string, Record<string, unknown> | null> = {
    ad_conversions: null,
    ticket_checkout_sessions: {
      id: "checkout-4238-w15",
      event_id: EVENT_UUID,
      brand_id: "brand-1",
      total_cents: 1500,
      buyer_total_cents: 1650,
      currency: "GBP",
      buyer_user_id: null,
      attribution_click_id: null,
      ad_tracking_opt_out: false,
      ad_checkout_start_sent_at: null,
      ad_checkout_start_provider_response: null,
      created_at: new Date(T - 10 * 60_000).toISOString(),
    },
  };
  const canned: Record<string, unknown> = {
    orders: {
      id: ORDER_ID,
      event_id: EVENT_UUID,
      total_cents: 1500,
      currency: "GBP",
      buyer_email: null,
      buyer_phone: null,
      payment_status: "paid",
      source: "online_checkout",
    },
    events: { brand_id: "brand-1", slug: "summer-party", event_type: eventType },
    brands: { slug: "lagos-nights" },
    ad_attribution_touches: null,
    ad_connections: { extra: { dataset_id: "px-meta" } },
  };
  const from = (table: string) => {
    let pending: Record<string, unknown> | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      upsert: (row: Record<string, unknown>) => {
        if (table === "ad_conversions" && !state.ad_conversions) {
          state.ad_conversions = {
            meta_capi_status: "pending",
            tiktok_events_status: "pending",
            snap_capi_status: "pending",
            reddit_capi_status: "pending",
            google_ads_status: "pending",
            ...row,
            created_at: new Date(nowRef.ms).toISOString(),
          };
        }
        return Promise.resolve({ data: null, error: null });
      },
      update: (values: Record<string, unknown>) => {
        pending = values;
        return builder;
      },
      maybeSingle: () => {
        if (table in state) {
          if (pending && state[table]) Object.assign(state[table] as object, pending);
          const result = pending ? { id: "claimed" } : state[table] ? { ...state[table] } : null;
          pending = null;
          return Promise.resolve({ data: result, error: null });
        }
        return Promise.resolve({ data: canned[table] ?? null, error: null });
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
        if (pending && table in state && state[table]) {
          Object.assign(state[table] as object, pending);
        }
        pending = null;
        return resolve({ data: null, error: null });
      },
    };
    return builder;
  };
  return {
    client: { from } as unknown as Parameters<typeof fireAdConversion>[0],
    state,
  };
}

function metaOnly(outcomes: SenderResult["status"][]) {
  const inputs: ConversionSendInput[] = [];
  const skip = (channel: "tiktok" | "snap" | "reddit" | "google") => () =>
    Promise.resolve({ channel, status: "skipped" as const, reason: "no_google_click" });
  return {
    inputs,
    senders: {
      meta: (input: ConversionSendInput) => {
        const status = outcomes[inputs.length] ?? "sent";
        inputs.push(input);
        return Promise.resolve(
          status === "sent"
            ? { channel: "meta" as const, status }
            : { channel: "meta" as const, status, reason: "http_500", httpStatus: 500 },
        );
      },
      tiktok: skip("tiktok"),
      snap: skip("snap"),
      reddit: skip("reddit"),
      google: skip("google"),
    },
  };
}

Deno.test("#4238 W1-5 a retry two hours later carries the first send's event_time and the event page URL", async () => {
  const nowRef = { ms: T };
  const { client, state } = statefulDb(nowRef);
  const { inputs, senders } = metaOnly(["failed", "sent"]);

  await fireAdConversion(client, { orderId: ORDER_ID }, { senders, now: () => nowRef.ms });
  // The retry lane flips the failed channel back to pending, then re-fires.
  (state.ad_conversions as Record<string, unknown>).meta_capi_status = "pending";
  nowRef.ms = T + 2 * 60 * 60 * 1000;
  await fireAdConversion(client, { orderId: ORDER_ID }, { senders, now: () => nowRef.ms });

  assertEquals(inputs.length, 2);
  assertEquals(inputs.map((input) => input.eventTimeMs), [T, T]);
  assertEquals(
    inputs.map((input) => input.eventSourceUrl),
    [
      "https://host.usemingla.com/e/lagos-nights/summer-party",
      "https://host.usemingla.com/e/lagos-nights/summer-party",
    ],
  );
  assertEquals(
    (state.ad_conversions as Record<string, unknown>).event_source_url,
    "https://host.usemingla.com/e/lagos-nights/summer-party",
  );
});

Deno.test("#4238 W1-5 the caller's action time wins over send time", async () => {
  const nowRef = { ms: T + 90_000 };
  const { client } = statefulDb(nowRef, "trip");
  const { inputs, senders } = metaOnly(["sent"]);
  const paidAt = T - 30_000;
  await fireAdConversion(client, { orderId: ORDER_ID, eventTimeMs: paidAt }, {
    senders,
    now: () => nowRef.ms,
  });
  assertEquals(inputs[0].eventTimeMs, paidAt);
  assertEquals(inputs[0].eventSourceUrl, "https://host.usemingla.com/t/lagos-nights/summer-party");
});

Deno.test("#4238 W1-5 checkout start uses the session's created time and its checkout surface URL", async () => {
  const nowRef = { ms: T };
  const { client } = statefulDb(nowRef, "experience");
  const seen: ConversionSendInput[] = [];
  const ok = (channel: "meta" | "tiktok" | "snap") => (input: ConversionSendInput) => {
    seen.push(input);
    return Promise.resolve({ channel, status: "sent" as const });
  };
  await fireAdCheckoutStart(client, "checkout-4238-w15", {
    senders: { meta: ok("meta"), tiktok: ok("tiktok"), snap: ok("snap") },
    now: () => nowRef.ms,
  });
  assertEquals(seen.length, 3);
  assertEquals(seen.every((input) => input.eventTimeMs === T - 10 * 60_000), true);
  assertEquals(
    seen[0].eventSourceUrl,
    `https://host.usemingla.com/checkout-experience/${EVENT_UUID}`,
  );
});

Deno.test("#4238 W1-5 URL helpers: path per event type, brand page, nothing guessed from bad slugs", () => {
  assertEquals(
    eventPageUrl({ brandSlug: "b", eventSlug: "x", eventType: "rsvp" }),
    "https://host.usemingla.com/e/b/x",
  );
  assertEquals(
    eventPageUrl({ brandSlug: "b", eventSlug: "x", eventType: "experience" }),
    "https://host.usemingla.com/exp/b/x",
  );
  assertEquals(eventPageUrl({ brandSlug: null, eventSlug: "x", eventType: "event" }), null);
  assertEquals(eventPageUrl({ brandSlug: "b/../x", eventSlug: "x", eventType: "event" }), null);
  assertEquals(brandPageUrl("lagos-nights"), "https://host.usemingla.com/b/lagos-nights");
  assertEquals(checkoutStartUrl(EVENT_UUID, "trip"), `https://host.usemingla.com/checkout-trip/${EVENT_UUID}`);
  assertEquals(checkoutStartUrl("not an id", "event"), null);
});
