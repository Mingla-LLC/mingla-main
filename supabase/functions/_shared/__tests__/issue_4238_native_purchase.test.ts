// MINGLA-INVARIANT: I-4238-NATIVE-PURCHASE-VIA-APPSFLYER | issue #4238 | an order whose checkout surface is native is never sent to an ad network as a website event (Meta, TikTok, Snap, Reddit and Google are skipped/native_surface) and is posted to AppsFlyer as af_purchase once, to the Explorer app id, with the order id.
/**
 * #4238 W4-1 (D20). Explorer native ticket purchases went to the ad networks
 * as website events and never reached AppsFlyer. Hermetic: a stateful fake
 * ad_conversions row, captured sender calls and a captured AppsFlyer post.
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
import {
  EXPLORER_APPSFLYER_APP_IDS,
  postAppsFlyerS2SEvent,
} from "../appsFlyerS2S.ts";

const ORDER_ID = "order-4238-w41";
const EVENT_UUID = "7b2e3d4c-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const BUYER = "buyer-4238-w41";

function fakeDb(opts: {
  surface: string | null;
  device?: { appsflyer_uid: string; platform: "ios" | "android" } | null;
  totalCents?: number;
  currency?: string;
  optOut?: boolean;
}) {
  const state: { conv: Record<string, unknown> | null } = { conv: null };
  const canned: Record<string, unknown> = {
    orders: {
      id: ORDER_ID,
      event_id: EVENT_UUID,
      total_cents: opts.totalCents ?? 2500,
      currency: opts.currency ?? "GBP",
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
      ad_tracking_opt_out: opts.optOut === true,
      checkout_surface: opts.surface,
    },
    ad_attribution_touches: null,
    ad_connections: { extra: { dataset_id: "px-meta" } },
    appsflyer_devices: opts.device === undefined
      ? { appsflyer_uid: "af-uid-1", platform: "android" }
      : opts.device,
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
            created_at: new Date().toISOString(),
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
            // A conditional claim only wins while appsflyer_status matches.
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

function capture() {
  const sent: ConversionSendInput[] = [];
  const sender =
    (channel: SenderResult["channel"]) =>
    (input: ConversionSendInput): Promise<SenderResult> => {
      sent.push(input);
      return Promise.resolve({ channel, status: "sent" });
    };
  const posts: Parameters<AppsFlyerPostFn>[0][] = [];
  const postAppsFlyer: AppsFlyerPostFn = (input) => {
    posts.push(input);
    return Promise.resolve(true);
  };
  return {
    sent,
    posts,
    deps: {
      senders: {
        meta: sender("meta"),
        tiktok: sender("tiktok"),
        snap: sender("snap"),
        reddit: sender("reddit"),
        google: sender("google"),
      },
      postAppsFlyer,
    },
  };
}

Deno.test("#4238 W4-1 a native purchase skips every ad network and posts af_purchase once", async () => {
  const { client, state } = fakeDb({ surface: "native" });
  const { sent, posts, deps } = capture();

  const first = await fireAdConversion(client, {
    orderId: ORDER_ID,
    surface: "web",
  }, deps);
  assertEquals(first.ok, true);
  assertEquals(
    sent.length,
    0,
    "no ad network sender may run for a native order",
  );
  const conv = state.conv as Record<string, unknown>;
  for (
    const col of [
      "meta_capi_status",
      "tiktok_events_status",
      "snap_capi_status",
      "reddit_capi_status",
      "google_ads_status",
    ]
  ) {
    assertEquals(conv[col], "skipped", col);
  }
  const response = conv.provider_response as Record<string, { reason: string }>;
  assertEquals(response.meta.reason, "native_surface");
  assertEquals(conv.shared_with_platforms, false);
  assertEquals(
    conv.surface,
    "android",
    "surface comes from the Explorer device",
  );
  assertEquals(conv.appsflyer_status, "sent");

  assertEquals(posts.length, 1);
  assertEquals(posts[0].app, "consumer");
  assertEquals(posts[0].eventName, "af_purchase");
  assertEquals(posts[0].userId, BUYER);
  assertEquals(posts[0].eventValues?.af_order_id, ORDER_ID);
  assertEquals(posts[0].eventValues?.af_content_id, EVENT_UUID);
  assertEquals(posts[0].eventValues?.af_revenue, 25);
  assertEquals(posts[0].eventValues?.af_currency, "GBP");

  // A re-delivered webhook or the confirm path fires again: no second post.
  const second = await fireAdConversion(client, {
    orderId: ORDER_ID,
    surface: "web",
  }, deps);
  assertEquals(second.deduped, true);
  assertEquals(posts.length, 1);
  assertEquals(sent.length, 0);
});

Deno.test("#4238 W4-1 a zero-decimal native purchase keeps its amount", async () => {
  const { client } = fakeDb({
    surface: "native",
    totalCents: 1500,
    currency: "JPY",
  });
  const { posts, deps } = capture();
  await fireAdConversion(client, { orderId: ORDER_ID }, deps);
  assertEquals(posts[0].eventValues?.af_revenue, 1500);
});

Deno.test("#4238 W4-1 an opted-out or device-less native purchase posts nothing", async () => {
  const optOut = fakeDb({ surface: "native", optOut: true });
  const a = capture();
  await fireAdConversion(optOut.client, { orderId: ORDER_ID }, a.deps);
  assertEquals(a.posts.length, 0);
  assertEquals(a.sent.length, 0);
  assertEquals(
    (optOut.state.conv as Record<string, unknown>).appsflyer_status,
    "skipped",
  );

  const noDevice = fakeDb({ surface: "native", device: null });
  const b = capture();
  await fireAdConversion(noDevice.client, { orderId: ORDER_ID }, b.deps);
  assertEquals(b.posts.length, 0);
  const conv = noDevice.state.conv as Record<string, unknown>;
  assertEquals(conv.appsflyer_status, "skipped");
  assertEquals(conv.surface, "ios", "unknown device platform defaults to ios");
});

Deno.test("#4238 W4-1 a web purchase is unchanged: ad networks fire, AppsFlyer does not", async () => {
  for (const surface of ["web", null]) {
    const { client, state } = fakeDb({ surface });
    const { sent, posts, deps } = capture();
    await fireAdConversion(client, { orderId: ORDER_ID, surface: "web" }, deps);
    assertEquals(sent.length, 5, `surface ${surface}: all five channels fire`);
    assertEquals(posts.length, 0);
    assertEquals((state.conv as Record<string, unknown>).surface, "web");
  }
});

Deno.test("#4238 W4-1 the Explorer post goes to the Explorer app id, not the Host app", async () => {
  const urls: string[] = [];
  const origFetch = globalThis.fetch;
  const origGet = Deno.env.get;
  globalThis.fetch = ((url: string | URL) => {
    urls.push(String(url));
    return Promise.resolve(new Response("ok", { status: 200 }));
  }) as typeof fetch;
  // Only the S2S token is set: Explorer ids are constants, Host env is absent.
  Deno.env.get =
    ((name: string) =>
      name === "APPSFLYER_S2S_TOKEN"
        ? "test-token"
        : undefined) as typeof Deno.env.get;
  try {
    for (const platform of ["ios", "android"] as const) {
      const ok = await postAppsFlyerS2SEvent({
        supabase: {} as never,
        userId: BUYER,
        app: "consumer",
        device: { appsflyer_uid: "af-uid-1", platform },
        eventName: "af_purchase",
        eventValues: {
          af_revenue: 25,
          af_currency: "GBP",
          af_order_id: ORDER_ID,
        },
      });
      assert(ok);
    }
  } finally {
    globalThis.fetch = origFetch;
    Deno.env.get = origGet;
  }
  assertEquals(urls, [
    `https://api3.appsflyer.com/inappevent/${EXPLORER_APPSFLYER_APP_IDS.ios}`,
    `https://api3.appsflyer.com/inappevent/${EXPLORER_APPSFLYER_APP_IDS.android}`,
  ]);
});

Deno.test("#4238 W4-1 a caller without the AppsFlyer poster leaves it for the retry, which posts once", async () => {
  const { client, state } = fakeDb({ surface: "native" });
  const { sent, posts, deps } = capture();
  // ticket-checkout-confirm / Paystack: no poster injected.
  await fireAdConversion(client, { orderId: ORDER_ID }, {
    senders: deps.senders,
  });
  const conv = state.conv as Record<string, unknown>;
  assertEquals(conv.meta_capi_status, "skipped");
  assertEquals(
    conv.appsflyer_status,
    "pending",
    "left for ad-conversion-retry",
  );
  assertEquals(sent.length, 0);
  // ad-conversion-retry: same order, poster injected → exactly one post.
  const retried = await fireAdConversion(client, {
    orderId: ORDER_ID,
    eventType: "purchase",
    surface: "android",
  }, deps);
  assertEquals(retried.deduped, false);
  assertEquals(posts.length, 1);
  assertEquals(conv.appsflyer_status, "sent");
  // A third fire is settled.
  const third = await fireAdConversion(client, { orderId: ORDER_ID }, deps);
  assertEquals(third.deduped, true);
  assertEquals(posts.length, 1);
});

Deno.test("#4238 W4-1 wiring: Stripe and the retry inject the poster; the hook never imports the secret reader", async () => {
  const read = (rel: string) =>
    Deno.readTextFile(new URL(rel, import.meta.url));
  const fire = await read("../adConversionFire.ts");
  assert(
    !/from "\.\/appsFlyerS2S\.ts"/.test(fire),
    "adConversionFire must not import appsFlyerS2S.ts",
  );
  const stripe = await read("../stripeWebhookRouter.ts");
  assert(
    stripe.includes("{ postAppsFlyer: postAppsFlyerS2SEvent }"),
    "stripe webhook injects the poster",
  );
  const retry = await read("../../ad-conversion-retry/index.ts");
  assert(
    retry.includes('.eq("appsflyer_status", "pending")'),
    "retry sweeps pending native AppsFlyer rows",
  );
  assert(
    retry.includes("postAppsFlyer: postAppsFlyerS2SEvent"),
    "retry injects the poster",
  );
  const create = await read("../../ticket-checkout-create/index.ts");
  assert(
    create.includes(
      "persistCheckoutSurface(supabase as never, checkoutSessionId, surface)",
    ),
    "create persists the surface",
  );
});
