/**
 * Issue #3697 — v1.4 provider-native app-acquisition wire contracts.
 *
 * These are pure builder tests: no provider network request and no live object.
 * They pin exact app identity, install objective, single-OS targeting,
 * measurement binding, and paused-by-default delivery semantics.
 */

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  assertNativeAppRequestDestination,
  nativeAppCopyFromCanonicalPlan,
  NativeAppPlanError,
  parseFrozenNativeAppDestination,
} from "../adNativeAppCampaign.ts";
import {
  buildGoogleAppMutateOperations,
  buildGoogleAppMutateRequest,
} from "../google.ts";
import { buildMetaAdSetBody, buildMetaCampaignBody } from "../meta.ts";
import { buildRedditAdGroupBody, buildRedditCampaignBody } from "../reddit.ts";
import {
  buildSnapchatAdBody,
  buildSnapchatAdSquadBody,
  buildSnapchatCampaignBody,
  buildSnapchatCreativeBody,
} from "../snapchat.ts";
import { buildTikTokAdGroupBody, buildTikTokCampaignBody } from "../tiktok.ts";

const NOW_MS = Date.parse("2026-10-17T12:00:00Z");

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

Deno.test("#3697 frozen native destination is the sole app/OS/provider authority", () => {
  const destination = parseFrozenNativeAppDestination({
    snapshot: {
      ok: true,
      ready: true,
      destination_family: "explorer_app",
      destination_key: "ios",
      title: "Mingla Explorer for iPhone",
      app_key: "explorer",
      os: "ios",
      objective: "app_install",
      measurement_event: "install",
      store_identifier: "6760440898",
      appsflyer_app_id: "id6760440898",
      canonical_url: "https://apps.apple.com/us/app/mingla/id6760440898",
      onelink_url: "https://go.usemingla.com/w36m",
      provider_readiness: [{ platform: "meta", ready: true }],
    },
    expectedFamily: "explorer_app",
    expectedKey: "ios",
    platform: "meta",
  });
  assertEquals(destination.appKey, "explorer");
  assertEquals(destination.storeIdentifier, "6760440898");
  assertNativeAppRequestDestination({
    page_type: "explorer_app",
    brand_slug: "mingla",
    entity_slug: "ios",
  }, destination);
  assertThrows(
    () =>
      assertNativeAppRequestDestination({
        page_type: "explorer_app",
        brand_slug: "mingla",
        entity_slug: "android",
      }, destination),
    NativeAppPlanError,
    "native_destination_request_mismatch",
  );
  assertThrows(
    () =>
      parseFrozenNativeAppDestination({
        snapshot: {
          ok: true,
          ready: true,
          destination_family: "explorer_app",
          destination_key: "ios",
          app_key: "explorer",
          os: "ios",
          objective: "app_install",
          measurement_event: "install",
          store_identifier: "6760440898",
          appsflyer_app_id: "id6760440898",
          canonical_url: "https://apps.apple.com/us/app/mingla/id6760440898",
          onelink_url: "https://go.usemingla.com/w36m",
          title: "Mingla Explorer",
          provider_readiness: [{ platform: "meta", ready: false }],
        },
        expectedFamily: "explorer_app",
        expectedKey: "ios",
        platform: "meta",
      }),
    NativeAppPlanError,
    "native_provider_not_ready",
  );
});

Deno.test("#3697 native copy is derived from the immutable canonical plan", () => {
  assertEquals(
    nativeAppCopyFromCanonicalPlan({
      copy: {
        primary: "Your next great day starts here.",
        headline: "Get Mingla Explorer",
        description: "Find and book experiences.",
        googleHeadlines: ["Get Mingla Explorer", "Find things to do"],
        googleDescriptions: ["Discover and book experiences near you."],
      },
    }),
    {
      primary: "Your next great day starts here.",
      headline: "Get Mingla Explorer",
      description: "Find and book experiences.",
      googleHeadlines: ["Get Mingla Explorer", "Find things to do"],
      googleDescriptions: ["Discover and book experiences near you."],
    },
  );
  assertThrows(
    () => nativeAppCopyFromCanonicalPlan({ copy: { headline: "Get Mingla" } }),
    NativeAppPlanError,
    "native_copy_incomplete",
  );
});

Deno.test("#3697 Meta app campaign pins app objective, promoted object, and PAUSED state", () => {
  const campaign = buildMetaCampaignBody({
    name: "Mingla Explorer installs",
    objective: "OUTCOME_APP_PROMOTION",
    validateOnly: true,
  });
  const promotedObject = {
    application_id: "123456789012345",
    object_store_url: "https://apps.apple.com/app/id6746938812",
  };
  const adSet = buildMetaAdSetBody("meta-campaign", {
    name: "Explorer iOS installs",
    optimizationGoal: "APP_INSTALLS",
    billingEvent: "IMPRESSIONS",
    budgetCents: 3_000,
    targeting: { geo_locations: { countries: ["NG"] } },
    promotedObject,
    validateOnly: true,
  });

  assertEquals(campaign.objective, "OUTCOME_APP_PROMOTION");
  assertEquals(campaign.status, "PAUSED");
  assertEquals(campaign.execution_options, ["validate_only"]);
  assertEquals(adSet.optimization_goal, "APP_INSTALLS");
  assertEquals(adSet.promoted_object, promotedObject);
  assertEquals(adSet.status, "PAUSED");
  assertEquals(adSet.execution_options, ["validate_only"]);
});

Deno.test("#3697 TikTok app campaign pins APP_PROMOTION, store identity, OS, and DISABLE", () => {
  const campaign = buildTikTokCampaignBody("advertiser-1", {
    name: "Mingla Explorer installs",
    objective: "APP_PROMOTION",
  });
  const adGroup = buildTikTokAdGroupBody("advertiser-1", "campaign-1", {
    name: "Explorer Android installs",
    optimizationGoal: "INSTALL",
    billingEvent: "OCPM",
    budgetCents: 3_000,
    locationIds: ["2328926"],
    countryCodes: ["NG"],
    scheduleStartTime: "2026-10-17 12:00:00",
    nowMs: NOW_MS,
    promotionType: "APP_ANDROID",
    appId: "1234567890123456789",
  });

  assertEquals(campaign.objective_type, "APP_PROMOTION");
  assertEquals(campaign.operation_status, "DISABLE");
  assertEquals(adGroup.optimization_goal, "INSTALL");
  assertEquals(adGroup.promotion_type, "APP_ANDROID");
  assertEquals(adGroup.app_id, "1234567890123456789");
  assertEquals(adGroup.operation_status, "DISABLE");

  assertThrows(() =>
    buildTikTokAdGroupBody("advertiser-1", "campaign-1", {
      name: "Invalid app group",
      optimizationGoal: "TRAFFIC_LANDING_PAGE_VIEW",
      billingEvent: "CPC",
      budgetCents: 3_000,
      locationIds: ["2328926"],
      scheduleStartTime: "2026-10-17 12:00:00",
      nowMs: NOW_MS,
      promotionType: "APP_IOS",
      appId: "6746938812",
    })
  );
});

Deno.test("#3697 Snap app chain pins objective, app measurement, one OS, creative, and PAUSED", () => {
  const accountId = "6421cc96-dcaf-4a09-a7fa-b24199dcb391";
  const appId = "a1111111-2222-4333-8444-555555555555";
  const topSnapId = "b1111111-2222-4333-8444-555555555555";
  const iconId = "c1111111-2222-4333-8444-555555555555";
  const profileId = "d1111111-2222-4333-8444-555555555555";
  const creativeId = "e1111111-2222-4333-8444-555555555555";
  const campaign = buildSnapchatCampaignBody(accountId, {
    name: "Mingla Explorer installs",
    objective: "APP_PROMOTION",
    promotionType: "APP_INSTALL",
    dailyBudgetCents: 3_000,
    nowMs: NOW_MS,
    measurementSpec: { ios_app_id: "6746938812" },
    mobileAppId: appId,
  });
  const squad = buildSnapchatAdSquadBody(
    "f1111111-2222-4333-8444-555555555555",
    {
      name: "Explorer iOS installs",
      optimizationGoal: "APP_INSTALLS",
      countries: ["NG"],
      deviceOs: "ios",
      mobileAppId: appId,
      nowMs: NOW_MS,
    },
  );
  const creative = buildSnapchatCreativeBody(accountId, {
    name: "Explorer app install creative",
    creativeType: "APP_INSTALL",
    topSnapMediaId: topSnapId,
    headline: "Find your next experience",
    brandName: "Mingla",
    profileId,
    appName: "Mingla Explorer",
    iosAppId: "6746938812",
    iconMediaId: iconId,
  });
  const ad = buildSnapchatAdBody(
    "01111111-2222-4333-8444-555555555555",
    {
      name: "Explorer app install ad",
      creativeExternalId: creativeId,
      creativeType: "APP_INSTALL",
    },
  );

  assertEquals(campaign.status, "PAUSED");
  assertEquals(campaign.objective_v2_properties, {
    objective_v2_type: "APP_PROMOTION",
    promotion_type: "APP_INSTALL",
  });
  assertEquals(campaign.measurement_spec, { ios_app_id: "6746938812" });
  assertEquals(campaign.mobile_app_properties, {
    skad_network_status: "NOT_ENROLLED",
    mobile_app_id: appId,
  });
  assertEquals(squad.status, "PAUSED");
  assertEquals(record(squad.targeting).devices, [{ os_type: "iOS" }]);
  assertEquals(squad.event_sources, { MOBILE_APP: [appId] });
  assertEquals(creative.type, "APP_INSTALL");
  assertEquals(creative.call_to_action, "INSTALL_NOW");
  assertEquals(creative.web_view_properties, undefined);
  assertEquals(creative.app_install_properties, {
    app_name: "Mingla Explorer",
    ios_app_id: "6746938812",
    icon_media_id: iconId,
  });
  assertEquals(ad.type, "APP_INSTALL");
  assertEquals(ad.status, "PAUSED");

  assertThrows(() =>
    buildSnapchatCampaignBody(accountId, {
      name: "Invalid dual-store campaign",
      objective: "APP_PROMOTION",
      promotionType: "APP_INSTALL",
      measurementSpec: {
        ios_app_id: "6746938812",
        android_app_url: "com.mingla.explorer",
      },
      mobileAppId: appId,
    })
  );
});

Deno.test("#3697 Reddit app chain pins same app, mobile-native one-OS targeting, and PAUSED", () => {
  const campaign = buildRedditCampaignBody({
    name: "Mingla Explorer installs",
    objective: "APP_INSTALLS",
    fundingInstrumentId: "funding-1",
    isCbo: false,
    conversionPixelId: "a2_mingla",
    appId: "com.mingla.explorer",
  });
  const adGroup = buildRedditAdGroupBody({
    campaignExternalId: "123456",
    name: "Explorer Android installs",
    budgetCents: 3_000,
    conversionPixelId: "a2_mingla",
    optimizationGoal: "MOBILE_CONVERSION_INSTALL",
    startTime: "2026-10-17T12:00:00Z",
    targeting: { geolocations: ["NG"] },
    appId: "com.mingla.explorer",
    deviceOs: "android",
  });

  assertEquals(campaign.objective, "APP_INSTALLS");
  assertEquals(campaign.app_id, "com.mingla.explorer");
  assertEquals(campaign.configured_status, "PAUSED");
  assertEquals(adGroup.app_id, "com.mingla.explorer");
  assertEquals(adGroup.optimization_goal, "MOBILE_CONVERSION_INSTALL");
  assertEquals(adGroup.bid_strategy, "BIDLESS");
  assertEquals(adGroup.bid_type, "CPM");
  assertEquals(adGroup.configured_status, "PAUSED");
  assertEquals(record(adGroup.targeting).platforms, ["MOBILE_NATIVE"]);
  assertEquals(record(adGroup.targeting).devices, [{
    type: "MOBILE",
    os: "ANDROID",
  }]);

  assertThrows(() =>
    buildRedditCampaignBody({
      name: "Missing app identity",
      objective: "APP_INSTALLS",
      fundingInstrumentId: "funding-1",
      isCbo: false,
      conversionPixelId: "a2_mingla",
    })
  );
});

Deno.test("#3697 Google App campaign uses official install-volume mutate contract", () => {
  const input = {
    name: "Mingla Explorer installs",
    dailyBudgetCents: 3_000,
    appId: "com.mingla.explorer",
    os: "android" as const,
    geoTargetCriterionIds: ["2560"],
    headlines: ["Find things to do", "Book with Mingla"],
    descriptions: ["Discover and book experiences near you."],
    validateOnly: true,
  };
  const operations = buildGoogleAppMutateOperations("1234567890", input);
  const request = buildGoogleAppMutateRequest("1234567890", input);
  const budget = record(record(operations[0].campaignBudgetOperation).create);
  const campaign = record(record(operations[1].campaignOperation).create);
  const criterion = record(
    record(operations[2].campaignCriterionOperation).create,
  );
  const adGroup = record(record(operations[3].adGroupOperation).create);
  const adGroupAd = record(record(operations[4].adGroupAdOperation).create);
  const appSetting = record(campaign.appCampaignSetting);
  const appAd = record(record(adGroupAd.ad).appAd);

  assertEquals(budget.amountMicros, "30000000");
  assertEquals(budget.explicitlyShared, false);
  assertEquals(campaign.status, "PAUSED");
  assertEquals(campaign.advertisingChannelType, "MULTI_CHANNEL");
  assertEquals(campaign.advertisingChannelSubType, "APP_CAMPAIGN");
  assertEquals(campaign.maximizeConversions, {});
  assertEquals(appSetting, {
    appStore: "GOOGLE_APP_STORE",
    appId: "com.mingla.explorer",
    biddingStrategyGoalType: "OPTIMIZE_INSTALLS_WITHOUT_TARGET_INSTALL_COST",
  });
  assertEquals(criterion.location, {
    geoTargetConstant: "geoTargetConstants/2560",
  });
  assertEquals("type" in adGroup, false);
  assertEquals(adGroup.status, "ENABLED");
  assertEquals(adGroupAd.status, "PAUSED");
  assertEquals(appAd.headlines, [{ text: "Find things to do" }, {
    text: "Book with Mingla",
  }]);
  assertEquals(appAd.descriptions, [{
    text: "Discover and book experiences near you.",
  }]);
  assertEquals(request.partialFailure, false);
  assertEquals(request.validateOnly, true);

  assertThrows(() =>
    buildGoogleAppMutateOperations("1234567890", {
      ...input,
      os: "ios",
      appId: "com.mingla.explorer",
    })
  );
});
