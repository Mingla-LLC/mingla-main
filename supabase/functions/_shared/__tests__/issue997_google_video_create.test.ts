/**
 * ISSUE-997 scope D2 — Google Demand Gen VIDEO create (implementor happy-path).
 *
 * The finale that makes Google video CREATABLE. D1 shipped the prepare adapter +
 * migration (a Google video walks to a READY google ref carrying
 * external_ref_extra.youtube_video_id); D2 adds the Demand Gen builder + the create
 * sub-branch + the frontend gate flip. This suite proves the NEW seams and is
 * fails-on-revert on each:
 *
 *   1. buildGoogleDemandGenMutateOperations — the LIVE-VALIDATED Demand Gen wire
 *      shape (#1303 — validateOnly:true HTTP 200 on v24 AND v25):
 *      advertisingChannelType "DEMAND_GEN" (no subtype), targetSpend {} (the honest
 *      zero-conversion strategy — NO conversion-tracking dependency),
 *      containsEuPoliticalAdvertising (G-14, v24-required), PRESENCE geo, NO
 *      networkSettings; a separate assetOperation carrying youtubeVideoAsset AND a
 *      logo imageAsset; the adGroup with NO `type`; geo criteria at the AD-GROUP
 *      level (#1303 RC-1); a demandGenVideoResponsiveAd with a REQUIRED ad.name
 *      (#1303 RC-2) and REQUIRED logoImages (#1303 RC-3) plus
 *      businessName/headlines/longHeadlines/descriptions/videos. PAUSED at every
 *      level (ad group ENABLED under the PAUSED parent).
 *   2. validateGoogleDemandGenAd — businessName ≤25, ≥1 headline ≤40, ≥1 long
 *      headline ≤90, ≥1 description ≤90 (no keyword validation — Demand Gen is
 *      audience-based).
 *   3. buildGoogleDemandGenMutateRequest — partialFailure:false + validateOnly
 *      passthrough; googleCreateDemandGenVideoCampaign validateOnly:true → zero
 *      objects (native Google validate).
 *   4. The admin-ad-create-campaign Google video sub-branch (SOURCE assertions):
 *      READY-ref-required (google/video/content_hash/status=ready + youtube_video_id),
 *      validate_only zero-object, objective "DEMAND_GEN" persisted PAUSED. (Reddit
 *      video create was the last fail-closed platform; #1185 wired it, so
 *      video_create_not_available_phase_a no longer appears anywhere — see the
 *      TEST-MOD-APPROVED ORCH-1185 guardrail below.)
 *
 * The DEMAND_GEN wire shape is LIVE-VALIDATED (#1303 pinned three root causes in
 * the original doc-sourced #997-D2 shape — geo level, ad.name, logoImages — and
 * proved the corrected body validates HTTP 200 on v24 AND v25 via validateOnly:true
 * mutates, zero objects). The tester's post-deploy live validate_only ACCEPT
 * re-confirmation is a SEPARATE orchestrator/tester step, not this gate.
 *
 * Run: deno test --allow-env --allow-read \
 *   supabase/functions/_shared/__tests__/issue997_google_video_create.test.ts
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  AdApiError,
  type AdConnectionRow,
  centsToPlatformBudget,
} from "../adChannel.ts";
import {
  buildGoogleDemandGenMutateOperations,
  buildGoogleDemandGenMutateRequest,
  GOOGLE_DEMAND_GEN_BUSINESS_NAME_MAX,
  GOOGLE_DEMAND_GEN_DESCRIPTION_MAX_CHARS,
  GOOGLE_DEMAND_GEN_HEADLINE_MAX_CHARS,
  GOOGLE_DEMAND_GEN_LONG_HEADLINE_MAX_CHARS,
  GOOGLE_EU_POLITICAL_ADVERTISING_VALUE,
  googleCreateDemandGenVideoCampaign,
  type GoogleDemandGenVideoInput,
  resetGoogleTokenCacheForTests,
  validateGoogleDemandGenAd,
} from "../google.ts";
import { MINGLA_SQUARE_LOGO_PNG_BASE64 } from "../adDemandGenLogo.ts";

const CUSTOMER_ID = "3623860476";

const DG_INPUT: GoogleDemandGenVideoInput = {
  name: "Test Event — Demand Gen Video",
  dailyBudgetCents: 2000, // $20.00
  finalUrl: "https://usemingla.com/e/test-brand/test-event",
  trackingUrlTemplate:
    "https://go.usemingla.com/w36m?pid=google_ads&af_c_id={campaignid}&af_ad={creative}&deep_link_value=event&deep_link_sub1=test-brand&af_r={lpurl}",
  businessName: "Test Brand",
  headlines: ["Book Test Event", "Live in London"],
  longHeadlines: [
    "Book the Test Event you will actually remember, live in London",
  ],
  descriptions: [
    "A real Mingla event you can book today.",
    "Tickets are limited.",
  ],
  youtubeVideoId: "dQw4w9WgXcQ",
  // #1303 RC-3: the REQUIRED square logo image (base64 PNG bytes).
  logoImageData: MINGLA_SQUARE_LOGO_PNG_BASE64,
  geoTargetCriterionIds: ["1006886"], // London (UK) — PROOF G-P2
};

function opOfType(
  ops: Record<string, unknown>[],
  key: string,
): Record<string, unknown> | undefined {
  const wrapper = ops.find((o) => key in o);
  if (!wrapper) return undefined;
  return (wrapper[key] as Record<string, unknown>).create as Record<
    string,
    unknown
  >;
}

// ── 1. The Demand Gen wire shape ─────────────────────────────────────────────

Deno.test("D2 builder: campaign is DEMAND_GEN (no subtype), NOT SEARCH", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const campaign = opOfType(ops, "campaignOperation")!;
  // Deleting `advertisingChannelType: "DEMAND_GEN"` in the builder fails this.
  assertEquals(campaign.advertisingChannelType, "DEMAND_GEN");
  assertEquals(campaign.advertisingChannelSubType, undefined); // DOC: no subtype
  assert(
    campaign.advertisingChannelType !== "SEARCH",
    "must not be a Search campaign",
  );
});

Deno.test("D2 builder: targetSpend {} — the honest zero-conversion strategy (no conversion goal)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const campaign = opOfType(ops, "campaignOperation")!;
  assertEquals(campaign.targetSpend, {});
  // No conversion-tracking dependency — maximizeConversions is NOT used.
  assertEquals(campaign.maximizeConversions, undefined);
});

Deno.test("G-14: Demand Gen campaign carries containsEuPoliticalAdvertising (fails-on-revert target)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const campaign = opOfType(ops, "campaignOperation")!;
  // Deleting the containsEuPoliticalAdvertising line makes this fail.
  assertEquals(
    campaign.containsEuPoliticalAdvertising,
    GOOGLE_EU_POLITICAL_ADVERTISING_VALUE,
  );
});

Deno.test("D2 builder: PRESENCE geo type + NO networkSettings (does not apply to Demand Gen)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const campaign = opOfType(ops, "campaignOperation")!;
  assertEquals(campaign.geoTargetTypeSetting, {
    positiveGeoTargetType: "PRESENCE",
  });
  // A Search-style networkSettings would be REJECTED by Demand Gen — it must be absent.
  assertEquals(campaign.networkSettings, undefined);
});

Deno.test("D2 builder: PAUSED at every level — campaign + adGroupAd PAUSED, adGroup ENABLED (fails-on-revert target)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  assertEquals(opOfType(ops, "campaignOperation")!.status, "PAUSED");
  assertEquals(opOfType(ops, "adGroupAdOperation")!.status, "PAUSED");
  // ENABLED ad group under a PAUSED campaign = nothing serves (the proven shape).
  assertEquals(opOfType(ops, "adGroupOperation")!.status, "ENABLED");
});

Deno.test("D2 builder: adGroup takes NO `type` (SEARCH_STANDARD would be REJECTED by Demand Gen)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const adGroup = opOfType(ops, "adGroupOperation")!;
  assertEquals(adGroup.type, undefined);
});

Deno.test("D2 builder: the YouTube video rides as its OWN assetOperation (youtubeVideoAsset)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const asset = opOfType(ops, "assetOperation")!;
  assertEquals(asset.youtubeVideoAsset, { youtubeVideoId: "dQw4w9WgXcQ" });
  // The asset temp resource is referenced by the ad's videos[] (define-before-reference).
  const assetResource = asset.resourceName as string;
  const ad = opOfType(ops, "adGroupAdOperation")!.ad as Record<string, unknown>;
  const dg = ad.demandGenVideoResponsiveAd as Record<string, unknown>;
  assertEquals(dg.videos, [{ asset: assetResource }]);
});

Deno.test("D2 builder: demandGenVideoResponsiveAd carries name/businessName/headlines/longHeadlines/descriptions + REQUIRED logoImages, no cover", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const ad = opOfType(ops, "adGroupAdOperation")!.ad as Record<string, unknown>;
  assertEquals(ad.finalUrls, ["https://usemingla.com/e/test-brand/test-event"]);
  // #1303 RC-2: ad.name is REQUIRED (unlike Search RSA). Deleting it fails this
  // (live control: fieldError.REQUIRED @ ad.name, reqId 5tenxPytc_FZ2IqU5jQ7Sw).
  assert(
    typeof ad.name === "string" && (ad.name as string).trim().length > 0,
    "ad.name must be a non-empty string",
  );
  const dg = ad.demandGenVideoResponsiveAd as Record<string, unknown>;
  assertEquals(dg.businessName, { text: "Test Brand" });
  assertEquals(dg.headlines, [{ text: "Book Test Event" }, {
    text: "Live in London",
  }]);
  assertEquals(dg.longHeadlines, [
    { text: "Book the Test Event you will actually remember, live in London" },
  ]);
  assertEquals(dg.descriptions, [
    { text: "A real Mingla event you can book today." },
    { text: "Tickets are limited." },
  ]);
  // #1303 RC-3: logoImages is REQUIRED (>=1) — it references the logo asset op.
  // Deleting it fails this (live control: collectionSizeError: TOO_FEW @
  // demand_gen_video_responsive_ad.logo_images, reqId BUKsXAWQRVlGHBMSIafe4g).
  const logoAsset = ops
    .filter((o) => "assetOperation" in o)
    .map((o) =>
      (o.assetOperation as Record<string, unknown>).create as Record<
        string,
        unknown
      >
    )
    .find((a) => "imageAsset" in a)!;
  assertEquals(dg.logoImages, [{ asset: logoAsset.resourceName }]);
  // Still NO thumbnails / imageAsset on the ad itself (YouTube auto-thumbnail).
  assertEquals(dg.thumbnails, undefined);
  assertEquals((ad as Record<string, unknown>).imageAsset, undefined);
});

Deno.test("D2 builder: budget micros = cents × 10,000 at THE one google boundary", () => {
  assertEquals(centsToPlatformBudget("google", 2000), 20_000_000);
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const budget = opOfType(ops, "campaignBudgetOperation")!;
  assertEquals(budget.amountMicros, "20000000"); // int64 as string
  assertEquals(budget.deliveryMethod, "STANDARD");
});

Deno.test("D2 builder: temp ids negative + define-before-reference, live-validated op order (#1303)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  // Live-validated op ORDER (#1303): budget, campaign, video-asset, logo-asset,
  // adGroup, adGroupCriterion(location)×1, adGroupAd. Geo is at the AD-GROUP level
  // (#1303 RC-1) — NOT campaign level (moving it back reproduces the live reject
  // requestError.UNKNOWN @ campaign_criterion.location, reqId H_Y54IpbvVu1FzqE3ojmnw).
  const keys = ops.map((o) => Object.keys(o)[0]);
  assertEquals(keys, [
    "campaignBudgetOperation",
    "campaignOperation",
    "assetOperation",
    "assetOperation",
    "adGroupOperation",
    "adGroupCriterionOperation",
    "adGroupAdOperation",
  ]);
  // NO campaign-level geo criterion is emitted (the #1303 root-cause reversal).
  assertEquals(ops.filter((o) => "campaignCriterionOperation" in o).length, 0);
  const budgetRes = opOfType(ops, "campaignBudgetOperation")!
    .resourceName as string;
  const campaignRes = opOfType(ops, "campaignOperation")!
    .resourceName as string;
  const assetOps = ops
    .filter((o) => "assetOperation" in o)
    .map((o) =>
      (o.assetOperation as Record<string, unknown>).create as Record<
        string,
        unknown
      >
    );
  const videoAsset = assetOps.find((a) => "youtubeVideoAsset" in a)!;
  const logoAsset = assetOps.find((a) => "imageAsset" in a)!;
  const adGroupRes = opOfType(ops, "adGroupOperation")!.resourceName as string;
  assertStringIncludes(budgetRes, "/campaignBudgets/-1");
  assertStringIncludes(campaignRes, "/campaigns/-2");
  assertStringIncludes(videoAsset.resourceName as string, "/assets/-3");
  assertStringIncludes(adGroupRes, "/adGroups/-4");
  assertStringIncludes(logoAsset.resourceName as string, "/assets/-5");
  // Budget referenced by campaign; campaign by adGroup; assets by the ad.
  assertEquals(opOfType(ops, "campaignOperation")!.campaignBudget, budgetRes);
  assertEquals(opOfType(ops, "adGroupOperation")!.campaign, campaignRes);
  // #1303 RC-1: the geo criterion references the AD GROUP, not the campaign.
  const geoCreate = (ops.find((o) => "adGroupCriterionOperation" in o)!
    .adGroupCriterionOperation as Record<string, unknown>).create as Record<
      string,
      unknown
    >;
  assertEquals(geoCreate.adGroup, adGroupRes);
  assertEquals(geoCreate.location, {
    geoTargetConstant: "geoTargetConstants/1006886",
  });
});

Deno.test("D2 builder: the OneLink rides ONLY in trackingUrlTemplate, never in finalUrls", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const campaign = opOfType(ops, "campaignOperation")!;
  assertStringIncludes(
    campaign.trackingUrlTemplate as string,
    "go.usemingla.com",
  );
  const ad = opOfType(ops, "adGroupAdOperation")!.ad as Record<string, unknown>;
  assertEquals(ad.finalUrls, ["https://usemingla.com/e/test-brand/test-event"]);
});

// ── 1b. #1303 fix: logo asset, fail-closed guard, revert-trap, validate fixture ─

Deno.test("D2 #1303: the logo rides as its OWN imageAsset assetOperation (the exact bytes forensics validated to 200)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const logoAsset = ops
    .filter((o) => "assetOperation" in o)
    .map((o) =>
      (o.assetOperation as Record<string, unknown>).create as Record<
        string,
        unknown
      >
    )
    .find((a) => "imageAsset" in a)!;
  assert(logoAsset !== undefined, "a logo assetOperation must be emitted");
  assertStringIncludes(logoAsset.resourceName as string, "/assets/-5");
  assertEquals(logoAsset.imageAsset, { data: MINGLA_SQUARE_LOGO_PNG_BASE64 });
  // The ad's logoImages points at THIS logo asset (define-before-reference).
  const ad = opOfType(ops, "adGroupAdOperation")!.ad as Record<string, unknown>;
  const dg = ad.demandGenVideoResponsiveAd as Record<string, unknown>;
  assertEquals(dg.logoImages, [{ asset: logoAsset.resourceName }]);
});

Deno.test("D2 #1303 RC-3 fail-closed: an empty logoImageData throws (never emits a body Google rejects for TOO_FEW logos)", () => {
  const err = assertThrows(
    () =>
      buildGoogleDemandGenMutateOperations(CUSTOMER_ID, {
        ...DG_INPUT,
        logoImageData: "   ",
      }),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "demand_gen_logo_missing");
  assertEquals((err as AdApiError).platform, "google");
});

// The REVERT-TRAP: each corrected-shape invariant mirrors a LIVE negative control
// (#1303 investigation, validateOnly:true mutates on the live account). Reverting
// any single fix flips its assertion RED — the exact Google rejection the live
// probe recorded is named beside it.
Deno.test("D2 #1303 REVERT-TRAP: geo at ad-group level (RC-1), ad.name present (RC-2), logoImages present (RC-3)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  // RC-1 — geo MUST be ad-group level. Reverting to campaignCriterionOperation →
  // live requestError.UNKNOWN @ campaign_criterion.location (reqId H_Y54IpbvVu1FzqE3ojmnw).
  assertEquals(ops.filter((o) => "campaignCriterionOperation" in o).length, 0);
  assertEquals(ops.filter((o) => "adGroupCriterionOperation" in o).length, 1);
  const ad = opOfType(ops, "adGroupAdOperation")!.ad as Record<string, unknown>;
  // RC-2 — ad.name REQUIRED. Reverting (dropping name) → live fieldError.REQUIRED @
  // ad.name (reqId 5tenxPytc_FZ2IqU5jQ7Sw).
  assert(
    typeof ad.name === "string" && (ad.name as string).length > 0,
    "ad.name must be present (RC-2)",
  );
  // RC-3 — logoImages REQUIRED (>=1). Reverting (dropping logoImages) → live
  // collectionSizeError: TOO_FEW @ ...logo_images (reqId BUKsXAWQRVlGHBMSIafe4g).
  const dg = ad.demandGenVideoResponsiveAd as Record<string, unknown>;
  assert(
    Array.isArray(dg.logoImages) && (dg.logoImages as unknown[]).length >= 1,
    "logoImages must have >=1 asset (RC-3)",
  );
  // And upgradedTargeting is NEVER set (not a settable v24/v25 field).
  const campaign = opOfType(ops, "campaignOperation")!;
  assertEquals("upgradedTargeting" in campaign, false);
});

Deno.test("D2 #1303 validate fixture: the corrected body validates to a real HTTP 200 accept (empty mutateOperationResponses, zero objects)", async () => {
  // A real Google validateOnly:true accept returns HTTP 200 with NO
  // mutateOperationResponses (captured shape — v24 + v25 both returned this for the
  // corrected body). This asserts the create fn treats that real 200 as validated,
  // and that the body actually sent carries the corrected geo/name/logo shape.
  const CONN: AdConnectionRow = {
    id: "00000000-0000-0000-0000-000000000002",
    platform: "google",
    lane: "consumer",
    display_name: "Google Ads · Consumer",
    external_account_id: "3623860476",
    external_org_id: "8280000000",
    auth_kind: "dev_token_oauth",
    token_env_var: "GOOGLE_ADS_REFRESH_TOKEN",
    extra: {},
    status: "connected",
    currency: "USD",
    timezone: "America/New_York",
    min_daily_budget_cents: null,
    account_status: "ENABLED",
    token_last_verified_at: null,
    connected: true,
  };
  const envNames = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_OAUTH_CLIENT_ID",
    "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    "GOOGLE_ADS_CUSTOMER_ID",
  ];
  const prior = new Map<string, string | undefined>();
  for (const n of envNames) {
    prior.set(n, Deno.env.get(n));
    Deno.env.set(
      n,
      n === "GOOGLE_ADS_CUSTOMER_ID" ? "3623860476" : `test-${n}`,
    );
  }
  resetGoogleTokenCacheForTests();
  const originalFetch = globalThis.fetch;
  let mutateBody: Record<string, unknown> | null = null;
  globalThis.fetch =
    ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }),
            { status: 200 },
          ),
        );
      }
      if (url.includes("googleAds:mutate")) {
        mutateBody = JSON.parse(String(init?.body ?? "{}"));
        // Real validateOnly:true ACCEPT — HTTP 200, no mutateOperationResponses.
        return Promise.resolve(
          new Response(JSON.stringify({}), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
  try {
    const result = await googleCreateDemandGenVideoCampaign(CONN, {
      ...DG_INPUT,
      validateOnly: true,
    });
    assertEquals(result.validated, true);
    // The corrected shape actually crossed the wire.
    const body = mutateBody as unknown as Record<string, unknown>;
    const ops = body?.mutateOperations as Record<string, unknown>[];
    assertEquals(
      ops.filter((o) => "campaignCriterionOperation" in o).length,
      0,
    );
    assertEquals(ops.filter((o) => "adGroupCriterionOperation" in o).length, 1);
    const adOp = ops.find((o) => "adGroupAdOperation" in o)!;
    const ad = ((adOp.adGroupAdOperation as Record<string, unknown>)
      .create as Record<string, unknown>).ad as Record<string, unknown>;
    assert(typeof ad.name === "string" && (ad.name as string).length > 0);
    const dg = ad.demandGenVideoResponsiveAd as Record<string, unknown>;
    assert(
      Array.isArray(dg.logoImages) && (dg.logoImages as unknown[]).length >= 1,
    );
    assertEquals(body?.validateOnly, true);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [n, v] of prior) {
      if (v !== undefined) Deno.env.set(n, v);
      else Deno.env.delete(n);
    }
    resetGoogleTokenCacheForTests();
  }
});

// ── 2. Copy validation (char caps) ───────────────────────────────────────────

Deno.test("D2 validator: caps — businessName 25 / headline 40 / longHeadline 90 / description 90", () => {
  assertEquals(GOOGLE_DEMAND_GEN_BUSINESS_NAME_MAX, 25);
  assertEquals(GOOGLE_DEMAND_GEN_HEADLINE_MAX_CHARS, 40);
  assertEquals(GOOGLE_DEMAND_GEN_LONG_HEADLINE_MAX_CHARS, 90);
  assertEquals(GOOGLE_DEMAND_GEN_DESCRIPTION_MAX_CHARS, 90);
});

Deno.test("D2 validator: a well-formed Demand Gen ad passes", () => {
  const ok = validateGoogleDemandGenAd({
    businessName: DG_INPUT.businessName,
    headlines: DG_INPUT.headlines,
    longHeadlines: DG_INPUT.longHeadlines,
    descriptions: DG_INPUT.descriptions,
  });
  assertEquals(ok.ok, true);
});

Deno.test("D2 validator: missing businessName / empty headlines / long / descriptions each fail closed", () => {
  const base = {
    businessName: "Brand",
    headlines: ["H"],
    longHeadlines: ["LH"],
    descriptions: ["D"],
  };
  assertEquals(
    validateGoogleDemandGenAd({ ...base, businessName: "" }).ok,
    false,
  );
  assertEquals(validateGoogleDemandGenAd({ ...base, headlines: [] }).ok, false);
  assertEquals(
    validateGoogleDemandGenAd({ ...base, longHeadlines: [] }).ok,
    false,
  );
  assertEquals(
    validateGoogleDemandGenAd({ ...base, descriptions: [] }).ok,
    false,
  );
});

Deno.test("D2 validator: char-cap overflows are rejected (business 25 / headline 40 / long 90 / desc 90)", () => {
  const base = {
    businessName: "Brand",
    headlines: ["H"],
    longHeadlines: ["LH"],
    descriptions: ["D"],
  };
  assertEquals(
    validateGoogleDemandGenAd({ ...base, businessName: "x".repeat(26) }).ok,
    false,
  );
  assertEquals(
    validateGoogleDemandGenAd({ ...base, headlines: ["x".repeat(41)] }).ok,
    false,
  );
  assertEquals(
    validateGoogleDemandGenAd({ ...base, longHeadlines: ["x".repeat(91)] }).ok,
    false,
  );
  assertEquals(
    validateGoogleDemandGenAd({ ...base, descriptions: ["x".repeat(91)] }).ok,
    false,
  );
  // Exactly-at-cap is allowed.
  assertEquals(
    validateGoogleDemandGenAd({ ...base, businessName: "x".repeat(25) }).ok,
    true,
  );
  assertEquals(
    validateGoogleDemandGenAd({ ...base, headlines: ["x".repeat(40)] }).ok,
    true,
  );
});

// ── 3. Request envelope + validateOnly zero-object ───────────────────────────

Deno.test("D2 envelope: partialFailure:false (native atomicity) + validateOnly passthrough", () => {
  const request = buildGoogleDemandGenMutateRequest(CUSTOMER_ID, DG_INPUT);
  assertEquals(request.partialFailure, false);
  assertEquals(request.validateOnly, false);
  const validateRequest = buildGoogleDemandGenMutateRequest(CUSTOMER_ID, {
    ...DG_INPUT,
    validateOnly: true,
  });
  assertEquals(validateRequest.validateOnly, true);
});

Deno.test("D2 create fn: validateOnly:true returns validated:true with ZERO object ids (native Google validate)", async () => {
  const CONN: AdConnectionRow = {
    id: "00000000-0000-0000-0000-000000000002",
    platform: "google",
    lane: "consumer",
    display_name: "Google Ads · Consumer",
    external_account_id: "3623860476",
    external_org_id: "8280000000",
    auth_kind: "dev_token_oauth",
    token_env_var: "GOOGLE_ADS_REFRESH_TOKEN",
    extra: {},
    status: "connected",
    currency: "USD",
    timezone: "America/New_York",
    min_daily_budget_cents: null,
    account_status: "ENABLED",
    token_last_verified_at: null,
    connected: true,
  };
  const envNames = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_OAUTH_CLIENT_ID",
    "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    "GOOGLE_ADS_CUSTOMER_ID",
  ];
  const prior = new Map<string, string | undefined>();
  for (const n of envNames) {
    prior.set(n, Deno.env.get(n));
    Deno.env.set(
      n,
      n === "GOOGLE_ADS_CUSTOMER_ID" ? "3623860476" : `test-${n}`,
    );
  }
  resetGoogleTokenCacheForTests();
  const originalFetch = globalThis.fetch;
  let mutateBody: Record<string, unknown> | null = null;
  globalThis.fetch =
    ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }),
            {
              status: 200,
            },
          ),
        );
      }
      if (url.includes("googleAds:mutate")) {
        mutateBody = JSON.parse(String(init?.body ?? "{}"));
        // A validate-only mutate returns no mutateOperationResponses.
        return Promise.resolve(
          new Response(JSON.stringify({}), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
  try {
    const result = await googleCreateDemandGenVideoCampaign(CONN, {
      ...DG_INPUT,
      validateOnly: true,
    });
    assertEquals(result.validated, true);
    assertEquals(result.externalCampaignId, "");
    assertEquals(result.externalAdSetId, "");
    assertEquals(result.externalAdId, "");
    // The mutate was sent with validateOnly:true — zero objects created.
    assertEquals(
      (mutateBody as unknown as Record<string, unknown>)?.validateOnly,
      true,
    );
    assertEquals(
      (mutateBody as unknown as Record<string, unknown>)?.partialFailure,
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [n, v] of prior) {
      if (v !== undefined) Deno.env.set(n, v);
      else Deno.env.delete(n);
    }
    resetGoogleTokenCacheForTests();
  }
});

// ── 4. The create sub-branch (SOURCE assertions) + Reddit still fail-closed ──

async function createSource(): Promise<string> {
  return await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
}

Deno.test("D2 create branch: Google video is now WIRED (Demand Gen) — not the phase-A 422", async () => {
  const src = await createSource();
  // The create module now knows the Demand Gen create fn + the youtube_video_id.
  assertStringIncludes(src, "googleCreateDemandGenVideoCampaign");
  assertStringIncludes(src, "youtube_video_id");
  // The video sub-branch persists objective DEMAND_GEN, PAUSED.
  assertStringIncludes(src, 'objective: "DEMAND_GEN"');
  // The google video branch NO LONGER returns the phase-A 422 seam.
  const gStart = src.indexOf('if (platform === "google")');
  const gEnd = src.indexOf('if (platform === "snapchat")');
  assert(gStart >= 0 && gEnd > gStart, "could not bound the google branch");
  const googleBranch = src.slice(gStart, gEnd);
  assert(
    !googleBranch.includes("video_create_not_available_phase_a"),
    "the google branch must no longer fail-close video create",
  );
});

Deno.test("D2 create branch: Google video is a READY-ref CONSUMER (advertiser + content-hash scoped, youtube_video_id required)", async () => {
  const src = await createSource();
  const gStart = src.indexOf('if (platform === "google")');
  const gEnd = src.indexOf('if (platform === "snapchat")');
  const googleBranch = src.slice(gStart, gEnd);
  // Require the prepared library ref (create never uploads inline).
  assertStringIncludes(googleBranch, "video_preparation_required");
  // The READY ref is scoped to google / this advertiser / video / current hash / ready.
  assertStringIncludes(googleBranch, '.eq("platform", "google")');
  assertStringIncludes(
    googleBranch,
    '.eq("external_account_id", gconnGV.external_account_id)',
  );
  assertStringIncludes(googleBranch, '.eq("external_kind", "video")');
  assertStringIncludes(
    googleBranch,
    '.eq("content_hash", libCreativeGV.content_hash)',
  );
  assertStringIncludes(googleBranch, '.eq("status", "ready")');
  // The prepared youtube_video_id is REQUIRED — an incomplete ref fails closed.
  assertStringIncludes(googleBranch, "creative_ref_incomplete");
  assertStringIncludes(googleBranch, "creative_not_uploaded");
  assertStringIncludes(googleBranch, "creative_ref_stale");
});

Deno.test("D2 create branch: validate_only creates + persists nothing", async () => {
  const src = await createSource();
  const gStart = src.indexOf('if (platform === "google")');
  const gEnd = src.indexOf('if (platform === "snapchat")');
  const googleBranch = src.slice(gStart, gEnd);
  // Inside the video sub-branch, validate_only returns validated:true, zero objects.
  assertStringIncludes(googleBranch, "validated: true");
  assertStringIncludes(
    googleBranch,
    "validate_only — nothing created on the platform, nothing persisted.",
  );
});

Deno.test("D2/#1185 guardrail: Reddit video create is now WIRED — video_create_not_available_phase_a appears ZERO times (no platform fails closed)", async () => {
  const src = await createSource();
  // [TEST-MOD-APPROVED ORCH-1185] D1/C asserted TWO (Google + Reddit). D2 wired
  // Google → ONE; #1185 wired Reddit → ZERO. The Reddit branch now resolves the
  // #866-hosted clip into a type:"VIDEO" structured-post ad instead of a 422.
  assert(
    !src.includes("video_create_not_available_phase_a"),
    "no video-create phase-A 422 may remain — every platform is wired",
  );
  // The Reddit video seam is the #866-library resolve (mp4_master_url + poster) →
  // a type:"VIDEO" structured-post build.
  assertStringIncludes(src, "reddit_video_library_required");
  assertStringIncludes(src, '.select("id, kind, mp4_master_url, poster_url")');
  assertStringIncludes(src, 'type: "VIDEO"');
});
