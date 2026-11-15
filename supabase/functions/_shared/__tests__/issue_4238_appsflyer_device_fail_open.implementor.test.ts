// MINGLA-INVARIANT: I-4238-AF-DEVICE-FAILS-OPEN-BEFORE-M2 | issue #4238 | until M-2 adds appsflyer_devices.tracking_opt_out, the server reads the AppsFlyer device without the column and treats the install as not opted out (no opt-out can exist yet), so every server AppsFlyer post keeps working whatever the merge / migration order; a failed device read leaves a native af_purchase pending for the hourly retry instead of terminally no_appsflyer_device.
/**
 * #4238 P2-R1. Merging auto-deploys supabase/functions/**; if that happens
 * before M-2 is applied, PostgREST rejects the select (42703). Before this
 * fix fetchAppsFlyerDevice returned null: every server AppsFlyer post stopped
 * and native af_purchase rows were written terminally as no_appsflyer_device.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AppsFlyerPostFn,
  type ConversionSendInput,
  fireAdConversion,
  type SenderResult,
} from "../adConversionFire.ts";
import { lookupAppsFlyerDevice } from "../appsFlyerDevice.ts";
import { postAppsFlyerS2SEvent } from "../appsFlyerS2S.ts";

const ORDER_ID = "order-4238-p2r1";
const BUYER = "buyer-4238-p2r1";
const DEVICE = { appsflyer_uid: "af-uid-1", platform: "ios" as const };

type DeviceMode = "pre_m2" | "read_error";

/** The native fake; appsflyer_devices answers like PostgREST before M-2. */
function nativeDb(device: Record<string, unknown> | null, mode: DeviceMode) {
  const selects: string[] = [];
  const state: { conv: Record<string, unknown> | null } = { conv: null };
  const canned: Record<string, unknown> = {
    orders: {
      id: ORDER_ID,
      event_id: "7b2e3d4c-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
      total_cents: 2500,
      currency: "GBP",
      buyer_email: "buyer@example.com",
      buyer_phone: null,
      payment_status: "paid",
      source: "online_checkout",
    },
    events: { brand_id: "brand-1", slug: "summer", event_type: "event" },
    brands: { slug: "lagos" },
    ticket_checkout_sessions: {
      attribution_click_id: null,
      buyer_user_id: BUYER,
      ad_tracking_opt_out: false,
      checkout_surface: "native",
    },
    ad_attribution_touches: null,
    ad_connections: { extra: { dataset_id: "px-meta" } },
    appsflyer_devices: device,
  };
  const from = (table: string) => {
    let pending: Record<string, unknown> | null = null;
    const filters: Record<string, unknown> = {};
    let columns = "";
    const builder: Record<string, unknown> = {
      select: (cols?: string) => {
        columns = typeof cols === "string" ? cols : "";
        if (table === "appsflyer_devices") selects.push(columns);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      is: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      upsert: (row: Record<string, unknown>) => {
        if (table === "ad_conversions" && !state.conv) {
          state.conv = {
            meta_capi_status: "pending",
            tiktok_events_status: "pending",
            snap_capi_status: "pending",
            reddit_capi_status: "pending",
            google_ads_status: "pending",
            appsflyer_status: "pending",
            ...row,
          };
        }
        return Promise.resolve({ data: null, error: null });
      },
      update: (values: Record<string, unknown>) => {
        pending = values;
        return builder;
      },
      maybeSingle: () => {
        if (table === "ad_conversions") {
          if (pending) {
            const guard = filters.appsflyer_status;
            const matches = state.conv &&
              (guard === undefined || state.conv.appsflyer_status === guard);
            if (matches) Object.assign(state.conv as object, pending);
            pending = null;
            return Promise.resolve({
              data: matches ? { event_id: ORDER_ID } : null,
              error: null,
            });
          }
          return Promise.resolve({
            data: state.conv ? { ...state.conv } : null,
            error: null,
          });
        }
        if (table === "appsflyer_devices") {
          if (mode === "read_error") {
            return Promise.resolve({
              data: null,
              error: {
                code: "57014",
                message: "canceling statement due to statement timeout",
              },
            });
          }
          if (columns.includes("tracking_opt_out")) {
            return Promise.resolve({
              data: null,
              error: {
                code: "42703",
                message:
                  "column appsflyer_devices.tracking_opt_out does not exist",
              },
            });
          }
        }
        return Promise.resolve({ data: canned[table] ?? null, error: null });
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
        if (table === "ad_conversions" && pending && state.conv) {
          Object.assign(state.conv, pending);
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
    selects,
  };
}

function senders(sent: ConversionSendInput[]) {
  const sender =
    (channel: SenderResult["channel"]) =>
    (input: ConversionSendInput): Promise<SenderResult> => {
      sent.push(input);
      return Promise.resolve({ channel, status: "sent" });
    };
  return {
    meta: sender("meta"),
    tiktok: sender("tiktok"),
    snap: sender("snap"),
    reddit: sender("reddit"),
    google: sender("google"),
  };
}

Deno.test("#4238 P2-R1 before M-2 the device is read without tracking_opt_out and counts as not opted out", async () => {
  const db = nativeDb(DEVICE, "pre_m2");
  const lookup = await lookupAppsFlyerDevice(db.client, BUYER, "consumer");
  assertEquals(lookup.lookupFailed, false);
  assertEquals(lookup.device, { ...DEVICE, tracking_opt_out: false });
  assertEquals(db.selects, [
    "appsflyer_uid, platform, tracking_opt_out",
    "appsflyer_uid, platform",
  ]);
});

Deno.test("#4238 P2-R1 before M-2 a native purchase still posts af_purchase once", async () => {
  const db = nativeDb(DEVICE, "pre_m2");
  const posts: Parameters<AppsFlyerPostFn>[0][] = [];
  await fireAdConversion(db.client, { orderId: ORDER_ID }, {
    senders: senders([]),
    postAppsFlyer: (input) => {
      posts.push(input);
      return Promise.resolve(true);
    },
  });
  assertEquals(
    posts.length,
    1,
    "af_purchase was dropped on the missing column",
  );
  assertEquals(posts[0].eventName, "af_purchase");
  const conv = db.state.conv as Record<string, unknown>;
  assertEquals(conv.appsflyer_status, "sent");
});

Deno.test("#4238 P2-R1 a failed device read leaves af_purchase pending (retryable), never no_appsflyer_device", async () => {
  const db = nativeDb(DEVICE, "read_error");
  const posts: Parameters<AppsFlyerPostFn>[0][] = [];
  await fireAdConversion(db.client, { orderId: ORDER_ID }, {
    senders: senders([]),
    postAppsFlyer: (input) => {
      posts.push(input);
      return Promise.resolve(true);
    },
  });
  assertEquals(posts.length, 0);
  const conv = db.state.conv as Record<string, unknown>;
  assertEquals(conv.appsflyer_status, "pending");
  const af = (conv.provider_response as Record<string, unknown> | undefined)
    ?.appsflyer;
  assert(
    af === undefined,
    "a retryable read failure wrote a terminal AppsFlyer verdict",
  );
});

Deno.test("#4238 P2-R1 before M-2 the existing server posts (payout) still reach AppsFlyer", async () => {
  const names = [
    "APPSFLYER_S2S_TOKEN",
    "APPSFLYER_BUSINESS_IOS_APP_ID",
    "APPSFLYER_BUSINESS_ANDROID_APP_ID",
  ];
  const prior = names.map((n) => Deno.env.get(n));
  names.forEach((n) => Deno.env.set(n, `test-${n.toLowerCase()}`));
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => {
    fetched += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    const db = nativeDb(DEVICE, "pre_m2");
    const ok = await postAppsFlyerS2SEvent({
      supabase: db.client as never,
      userId: "host-1",
      eventName: "mingla_first_payout",
    });
    assertEquals(ok, true);
    assertEquals(fetched, 1);
  } finally {
    globalThis.fetch = realFetch;
    names.forEach((n, i) =>
      prior[i] === undefined
        ? Deno.env.delete(n)
        : Deno.env.set(n, prior[i] as string)
    );
  }
});
