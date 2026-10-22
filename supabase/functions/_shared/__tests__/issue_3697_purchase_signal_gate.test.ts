import {
  assert,
  assertEquals,
  assertMatch,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseSnapchatPurchaseEvents,
  type SnapchatClient,
  snapchatFetchPurchaseSignal28d,
} from "../snapchat.ts";
import {
  buildTikTokAdGroupBody,
  parseTikTokPurchaseEvents,
  type TikTokClient,
  tiktokFetchPurchaseSignal28d,
} from "../tiktok.ts";

const successJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

Deno.test("#3697 Snap purchase parser sums daily PURCHASE rows only", () => {
  assertEquals(
    parseSnapchatPurchaseEvents({
      timeseries_stats: [{
        sub_request_status: "SUCCESS",
        timeseries_stat: {
          timeseries: [
            { event_type_breakdown: { PAGE_VIEW: 200, PURCHASE: 12 } },
            { event_type_breakdown: { PAGE_VIEW: 300, PURCHASE: 9 } },
          ],
        },
      }],
    }),
    21,
  );
});

Deno.test("#3697 Snap reads every discovered domain over an exact 28-day window", async () => {
  const urls: URL[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname.endsWith("/domains/stats")) {
      return Promise.resolve(successJson({
        request_status: "SUCCESS",
        timeseries_stats: [{
          sub_request_status: "SUCCESS",
          timeseries_stat: {
            domains: [
              { domain_name: "usemingla.com", total_events: 10 },
              { domain_name: "www.usemingla.com", total_events: 11 },
            ],
          },
        }],
      }));
    }
    const purchase = url.searchParams.get("domain") === "usemingla.com"
      ? 12
      : 9;
    return Promise.resolve(successJson({
      request_status: "SUCCESS",
      timeseries_stats: [{
        sub_request_status: "SUCCESS",
        timeseries_stat: {
          timeseries: [{ event_type_breakdown: { PURCHASE: purchase } }],
        },
      }],
    }));
  };
  const client = {
    platform: "snapchat",
    accessToken: "secret",
    adAccountId: "account",
    organizationId: null,
    profileId: null,
    pixelId: "pixel",
    apiBase: "https://adsapi.snapchat.com/v1",
  } as SnapchatClient;

  const signal = await snapchatFetchPurchaseSignal28d(
    client,
    "pixel",
    Date.parse("2026-10-22T12:00:00.000Z"),
    fetchImpl,
  );

  assertEquals(signal.purchaseEvents28d, 21);
  assertEquals(signal.domainsChecked, ["usemingla.com", "www.usemingla.com"]);
  assertEquals(urls.length, 3);
  assertEquals(
    urls[1].searchParams.get("start_time"),
    "2026-09-24T12:00:00.000Z",
  );
  assertEquals(
    urls[1].searchParams.get("end_time"),
    "2026-10-22T12:00:00.000Z",
  );
  assertEquals(urls[1].searchParams.get("fields"), "event_type");
});

Deno.test("#3697 TikTok parser sums rows but does not double count sibling aggregates", () => {
  assertEquals(
    parseTikTokPurchaseEvents({
      list: [
        { event: "CompletePayment", event_count: 12 },
        { event_name: "Complete_Payment", count: 9 },
      ],
      summary: { CompletePayment: 21 },
      noise: { event: "ViewContent", event_count: 999 },
    }),
    21,
  );
});

Deno.test("#3697 TikTok calls the official pixel event stats contract for 28 days", async () => {
  let requested: URL | null = null;
  let accessToken = "";
  const fetchImpl: typeof fetch = (input, init) => {
    requested = new URL(String(input));
    accessToken = new Headers(init?.headers).get("Access-Token") ?? "";
    return Promise.resolve(successJson({
      code: 0,
      message: "OK",
      request_id: "req",
      data: {
        list: [{ event_type: "CompletePayment", events_count: 20 }],
      },
    }));
  };
  const client = {
    platform: "tiktok",
    token: "secret-token",
    advertiserId: "123",
    apiVersion: "v1.3",
    apiBase: "https://business-api.tiktok.com",
  } as TikTokClient;

  const signal = await tiktokFetchPurchaseSignal28d(
    client,
    "456",
    Date.parse("2026-10-22T12:00:00.000Z"),
    fetchImpl,
  );

  assertEquals(signal.purchaseEvents28d, 20);
  assertEquals(signal.startDate, "2026-09-25");
  assertEquals(signal.endDate, "2026-10-22");
  assertEquals(accessToken, "secret-token");
  assert(requested);
  const requestUrl = requested as URL;
  assertMatch(requestUrl.pathname, /\/open_api\/v1\.3\/pixel\/event\/stats\/$/);
  assertEquals(requestUrl.searchParams.get("advertiser_id"), "123");
  assertEquals(requestUrl.searchParams.get("pixel_ids"), '["456"]');
  assertEquals(
    requestUrl.searchParams.get("date_range"),
    '{"start_date":"2026-09-25","end_date":"2026-10-22"}',
  );
});

Deno.test("#3697 TikTok WEB_CONVERSIONS carries pixel and CompletePayment optimization", () => {
  const body = buildTikTokAdGroupBody("123", "456", {
    name: "Mingla Sales",
    optimizationGoal: "CONVERT",
    billingEvent: "OCPM",
    budgetCents: 2_000,
    locationIds: ["6252001"],
    pixelId: "789",
    optimizationEvent: "SHOPPING",
    promotionType: "WEBSITE",
    nowMs: Date.parse("2026-10-22T12:00:00.000Z"),
  });
  assertEquals(body.optimization_goal, "CONVERT");
  assertEquals(body.optimization_event, "SHOPPING");
  assertEquals(body.pixel_id, "789");
  assertEquals(body.promotion_type, "WEBSITE");
  assertEquals(body.operation_status, "DISABLE");

  assertThrows(
    () =>
      buildTikTokAdGroupBody("123", "456", {
        name: "Broken Sales",
        optimizationGoal: "CONVERT",
        billingEvent: "OCPM",
        budgetCents: 2_000,
        locationIds: ["6252001"],
        promotionType: "WEBSITE",
        nowMs: Date.parse("2026-10-22T12:00:00.000Z"),
      }),
    Error,
    "website conversions require",
  );
});

Deno.test("#3697 create re-reads live purchase counts before any Sales provider write", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assertMatch(
    source,
    /optimizationGoalS === "PIXEL_PURCHASE"[\s\S]*?snapchatFetchPurchaseSignal28d[\s\S]*?purchaseEvents28d < PURCHASE_SIGNAL_MIN_28D/,
  );
  assertMatch(
    source,
    /TIKTOK_PIXEL_GATED_OBJECTIVES\.includes\(objectiveT\)[\s\S]*?tiktokFetchPurchaseSignal28d[\s\S]*?purchaseEvents28d < PURCHASE_SIGNAL_MIN_28D/,
  );
  assertMatch(source, /promotion_type: "WEBSITE"/);
  assertMatch(source, /optimization_event: "SHOPPING"/);
});
