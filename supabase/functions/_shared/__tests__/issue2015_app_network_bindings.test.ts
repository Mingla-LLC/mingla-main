import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  createAppsFlyerMeasurementReader,
  verifyAppsflyer,
} from "../adAppReadinessProviders/appsflyer.ts";
import {
  GOOGLE_APP_BINDING_GAQL,
  parseGoogleAppBindings,
} from "../adAppReadinessProviders/google.ts";
import {
  metaMobileAppMatches,
  parseMetaMobileApp,
} from "../adAppReadinessProviders/meta.ts";
import { parseRedditApps } from "../adAppReadinessProviders/reddit.ts";
import {
  findVerifiedMobileApp,
  parseMobileApps,
} from "../adAppReadinessProviders/snapchat.ts";
import {
  findExactTikTokApp,
  parseTikTokApps,
} from "../adAppReadinessProviders/tiktok.ts";
import { runAllowedProviderOperation } from "../adAppReadinessProviders/common.ts";

const BUSINESS_ANDROID = {
  app_key: "business",
  os: "android",
  display_name: "Mingla Host",
  store_identifier: "com.sethogieva.minglabusiness",
  appsflyer_app_id: "com.sethogieva.minglabusiness",
  onelink_url: "https://biz.usemingla.com/ZSCW",
  active: true,
} as const;

Deno.test("#2015 provider parsers require the exact app, OS, store, and measurement identity", () => {
  const meta = parseMetaMobileApp({
    id: "123456789",
    platforms: ["ANDROID"],
    android_package_name: BUSINESS_ANDROID.store_identifier,
  });
  assertEquals(
    metaMobileAppMatches(
      meta,
      "123456789",
      "android",
      BUSINESS_ANDROID.store_identifier,
    ),
    true,
  );
  assertEquals(
    metaMobileAppMatches(meta, "123456789", "ios", "6768737367"),
    false,
  );

  const tiktok = parseTikTokApps({
    list: [{
      app_id: "7659053200868786183",
      tiktok_app_id: "7659053200868769799",
      platform: "ANDROID",
      package_name: BUSINESS_ANDROID.store_identifier,
      measurement_partner: "AppsFlyer",
    }],
  });
  assertEquals(
    findExactTikTokApp(
      tiktok,
      "7659053200868786183",
      "7659053200868769799",
      "android",
      BUSINESS_ANDROID.store_identifier,
    )?.appId,
    "7659053200868786183",
  );
  assertEquals(
    findExactTikTokApp(
      tiktok,
      "7659053200868786183",
      "wrong",
      "android",
      BUSINESS_ANDROID.store_identifier,
    ),
    undefined,
  );
  assertEquals(
    parseTikTokApps({
      app_id: "7659053200868786183",
      tiktok_app_id: "7659053200868769799",
      app_type: "ANDROID",
      store_id: BUSINESS_ANDROID.store_identifier,
      mmp: "AppsFlyer",
    }).length,
    1,
  );

  const snap = parseMobileApps({
    mobile_apps: [{
      sub_request_status: "SUCCESS",
      mobile_app: {
        id: "snap-business",
        android_app_url: BUSINESS_ANDROID.store_identifier,
        android_app_url_verified: true,
        mobile_measurement_partners: ["APPSFLYER"],
      },
    }],
  });
  assertEquals(
    findVerifiedMobileApp(
      snap,
      "snap-business",
      "android",
      BUSINESS_ANDROID.store_identifier,
    )?.id,
    "snap-business",
  );

  assertEquals(
    parseGoogleAppBindings({
      results: [{
        campaign: {
          id: "google-campaign",
          appCampaignSetting: {
            appId: BUSINESS_ANDROID.store_identifier,
            appStore: "GOOGLE_APP_STORE",
          },
        },
      }],
    }),
    [{
      appId: BUSINESS_ANDROID.store_identifier,
      appStore: "GOOGLE_APP_STORE",
      campaignId: "google-campaign",
    }],
  );

  assertEquals(parseRedditApps({ data: [] }), []);
  assertEquals(
    parseRedditApps({
      data: [{
        app_id: BUSINESS_ANDROID.store_identifier,
        platform: "ANDROID",
      }],
    }),
    [{ appId: BUSINESS_ANDROID.store_identifier, platform: "android" }],
  );
});

Deno.test("#2015 Google permits only the server-owned read query and exact search route", async () => {
  let calls = 0;
  await runAllowedProviderOperation(
    "google",
    "app_bindings",
    "POST",
    "customers/{id}/googleAds:search",
    () => {
      calls += 1;
      return Promise.resolve({ query: GOOGLE_APP_BINDING_GAQL });
    },
  );
  assertEquals(calls, 1);
  assertEquals(GOOGLE_APP_BINDING_GAQL.includes("SELECT campaign.id"), true);
  assertEquals(GOOGLE_APP_BINDING_GAQL.includes("MULTI_CHANNEL"), true);
  await assertRejects(
    () =>
      runAllowedProviderOperation(
        "google",
        "app_bindings",
        "POST",
        "customers/{id}/googleAds:mutate",
        () => Promise.resolve({}),
      ),
    Error,
    "provider_operation_forbidden",
  );
  assertEquals(calls, 1);
});

Deno.test("#2015 parsed AppsFlyer proof fails closed on missing privacy, events, or exact link ID", async () => {
  const readerFor = (integration: Record<string, unknown>) =>
    createAppsFlyerMeasurementReader(
      () => "read-token",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              integrations: [integration],
            }),
            { status: 200 },
          ),
        ),
    );
  const binding = [{
    app_key: "business",
    os: "android",
    provider: "google",
    payer_connection_id: "payer",
    public_identity_required: false,
    provider_app_id: BUSINESS_ANDROID.store_identifier,
    provider_measurement_id: "3623860476",
    active: true,
  }] as const;
  const check = (integration: Record<string, unknown>) =>
    verifyAppsflyer(
      BUSINESS_ANDROID,
      new AbortController().signal,
      "2026-08-13T12:00:00.000Z",
      readerFor(integration),
      [...binding],
    );
  const mappedWithoutPrivacy = await check({
    pid: "googleadwords_int",
    link_id: "3623860476",
    in_app_postbacks_params: [{
      event_name: "af_install",
      enabled: true,
    }],
  });
  assertEquals(mappedWithoutPrivacy.google.status, "action_required");

  const wrongLink = await check({
    pid: "googleadwords_int",
    link_id: "9999999999",
    privacy_status: "active",
    in_app_postbacks_params: [{
      event_name: "af_install",
      enabled: true,
    }],
  });
  assertEquals(wrongLink.google.status, "action_required");

  const exact = await check({
    pid: "googleadwords_int",
    link_id: "3623860476",
    privacy_status: "active",
    in_app_postbacks_params: [{
      event_name: "af_install",
      enabled: true,
    }],
  });
  assertEquals(exact.google.status, "proven");

  const zeroEvents = await check({
    pid: "googleadwords_int",
    link_id: "3623860476",
    privacy_status: "active",
    general_params: { event_name: "af_install", enabled: true },
  });
  assertEquals(zeroEvents.google.status, "action_required");
});
