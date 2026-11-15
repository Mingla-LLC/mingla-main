// MINGLA-INVARIANT: I-4238-AF-SERVER-RESPECTS-OPT-OUT | issue #4238 | an install whose app analytics switch is off (appsflyer_devices.tracking_opt_out, written by the Explorer and Host apps) never receives a server-to-server AppsFlyer post: the native af_purchase and the host first sale record skipped/tracking_opt_out, and postAppsFlyerS2SEvent refuses before any network call.
/**
 * #4238 P1-4 / P2-4. The Explorer "share usage data" switch and the Host app
 * Analytics switch only anonymized the SDK; the server still posted af_purchase,
 * mingla_host_first_sale and the payout events with the person's AppsFlyer id.
 * Hermetic: the native purchase fake from issue_4238_native_purchase, the
 * generic host fake, and a stubbed fetch for the S2S poster.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AppsFlyerPostFn,
  type ConversionSendInput,
  fireAdConversion,
  type SenderResult,
} from "../adConversionFire.ts";
import {
  type AdConversionRetryRow,
  conversionRetryInput,
} from "../adConversionRetry.ts";
import { postAppsFlyerS2SEvent } from "../appsFlyerS2S.ts";
import { fireHostFirstTicketSold } from "../hostFirstSale.ts";
import { hostFakeDb } from "./hostFunnelFakeDb.issue4238.ts";

const ORDER_ID = "order-4238-p14";
const BUYER = "buyer-4238-p14";

function nativeDb(device: Record<string, unknown> | null) {
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
    const builder: Record<string, unknown> = {
      select: () => builder,
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
  };
}

function senders(sent: ConversionSendInput[]) {
  const sender = (channel: SenderResult["channel"]) =>
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

Deno.test("#4238 P1-4 an Explorer install with analytics off gets no af_purchase", async () => {
  const db = nativeDb({ appsflyer_uid: "af-uid-1", platform: "ios", tracking_opt_out: true });
  const posts: Parameters<AppsFlyerPostFn>[0][] = [];
  const sent: ConversionSendInput[] = [];
  await fireAdConversion(db.client, { orderId: ORDER_ID }, {
    senders: senders(sent),
    postAppsFlyer: (input) => {
      posts.push(input);
      return Promise.resolve(true);
    },
  });
  assertEquals(posts.length, 0, "af_purchase was posted for an opted-out install");
  assertEquals(sent.length, 0);
  const conv = db.state.conv as Record<string, unknown>;
  assertEquals(conv.appsflyer_status, "skipped");
  const af = (conv.provider_response as Record<string, Record<string, unknown>>).appsflyer;
  assertEquals(af.reason, "tracking_opt_out");
});

Deno.test("#4238 P1-4 the same install with analytics on still posts af_purchase once", async () => {
  const db = nativeDb({ appsflyer_uid: "af-uid-1", platform: "ios", tracking_opt_out: false });
  const posts: Parameters<AppsFlyerPostFn>[0][] = [];
  await fireAdConversion(db.client, { orderId: ORDER_ID }, {
    senders: senders([]),
    postAppsFlyer: (input) => {
      posts.push(input);
      return Promise.resolve(true);
    },
  });
  assertEquals(posts.length, 1);
  assertEquals(posts[0].eventName, "af_purchase");
});

const OWNER = "6e7f8091-4238-4f00-8a00-000000000077";
const BRAND = "brand-4238-p24";

function hostSetup(optOut: boolean) {
  const db = hostFakeDb({
    brands: [{ id: BRAND, account_id: OWNER }],
    events: [{ id: "ev-1", brand_id: BRAND }],
    orders: [{ id: "order-now", event_id: "ev-1", payment_status: "paid", source: "online_checkout" }],
    creator_accounts: [{ id: OWNER, email: "host@example.com" }],
    ad_match_contexts: [],
    ad_attribution_touches: [],
    ad_connections: [],
    brand_appsflyer_milestones: [],
    appsflyer_devices: [{
      user_id: OWNER,
      app: "business",
      appsflyer_uid: "af-host-1",
      platform: "android",
      tracking_opt_out: optOut,
    }],
  });
  return db;
}

Deno.test("#4238 P2-4 a Host app install with analytics off gets no mingla_host_first_sale", async () => {
  const db = hostSetup(true);
  const posts: Parameters<AppsFlyerPostFn>[0][] = [];
  const postAppsFlyer: AppsFlyerPostFn = (input) => {
    posts.push(input);
    return Promise.resolve(true);
  };
  const sale = {
    brandId: BRAND,
    orderId: "order-now",
    amountCents: 450000,
    currency: "ngn",
    provider: "stripe" as const,
    eventTimeMs: 1_763_000_000_000,
  };
  await fireHostFirstTicketSold(db.client, sale, { senders: senders([]), postAppsFlyer });
  const row = db.row("ad_conversions", (r) => r.event_id === `host_sale:${OWNER}`);
  assert(row, "the host_sale row exists");
  assertEquals(posts.length, 0, "mingla_host_first_sale was posted for an opted-out host");
  assertEquals(row.appsflyer_status, "skipped");
  // The hourly retry does not post it either.
  await fireAdConversion(db.client, conversionRetryInput({ ...row } as unknown as AdConversionRetryRow), {
    senders: senders([]),
    postAppsFlyer,
  });
  assertEquals(posts.length, 0);
});

Deno.test("#4238 P2-4 a Host app install with analytics on still gets the first sale", async () => {
  const db = hostSetup(false);
  const posts: Parameters<AppsFlyerPostFn>[0][] = [];
  await fireHostFirstTicketSold(db.client, {
    brandId: BRAND,
    orderId: "order-now",
    amountCents: 450000,
    currency: "ngn",
    provider: "stripe",
    eventTimeMs: 1_763_000_000_000,
  }, {
    senders: senders([]),
    postAppsFlyer: (input) => {
      posts.push(input);
      return Promise.resolve(true);
    },
  });
  assertEquals(posts.length, 1);
  assertEquals(posts[0].eventName, "mingla_host_first_sale");
});

Deno.test("#4238 P1-4 / P2-4 postAppsFlyerS2SEvent refuses an opted-out install before any network call (payouts, disputes, referrals)", async () => {
  const names = ["APPSFLYER_S2S_TOKEN", "APPSFLYER_BUSINESS_IOS_APP_ID", "APPSFLYER_BUSINESS_ANDROID_APP_ID"];
  const prior = names.map((n) => Deno.env.get(n));
  names.forEach((n) => Deno.env.set(n, `test-${n.toLowerCase()}`));
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => {
    fetched += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    for (const app of ["business", "consumer"] as const) {
      const ok = await postAppsFlyerS2SEvent({
        supabase: {} as never,
        userId: "user-1",
        eventName: "mingla_first_payout",
        app,
        device: { appsflyer_uid: "af-1", platform: "ios", tracking_opt_out: true },
      });
      assertEquals(ok, false);
    }
    assertEquals(fetched, 0, "an opted-out install reached AppsFlyer");
    const ok = await postAppsFlyerS2SEvent({
      supabase: {} as never,
      userId: "user-1",
      eventName: "mingla_first_payout",
      device: { appsflyer_uid: "af-1", platform: "ios", tracking_opt_out: false },
    });
    assertEquals(ok, true);
    assertEquals(fetched, 1);
  } finally {
    globalThis.fetch = realFetch;
    names.forEach((n, i) => prior[i] === undefined ? Deno.env.delete(n) : Deno.env.set(n, prior[i] as string));
  }
});
