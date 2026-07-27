/**
 * ISSUE-997 scope D2 — Google Demand Gen VIDEO create (implementor happy-path).
 *
 * The finale that makes Google video CREATABLE. D1 shipped the prepare adapter +
 * migration (a Google video walks to a READY google ref carrying
 * external_ref_extra.youtube_video_id); D2 adds the Demand Gen builder + the create
 * sub-branch + the frontend gate flip. This suite proves the NEW seams and is
 * fails-on-revert on each:
 *
 *   1. buildGoogleDemandGenMutateOperations — the exact Demand Gen wire shape:
 *      advertisingChannelType "DEMAND_GEN" (no subtype), targetSpend {} (the honest
 *      zero-conversion strategy — NO conversion-tracking dependency),
 *      containsEuPoliticalAdvertising (G-14, v24-required), PRESENCE geo, NO
 *      networkSettings; a separate assetOperation carrying youtubeVideoAsset; the
 *      adGroup with NO `type`; a demandGenVideoResponsiveAd
 *      (businessName/headlines/longHeadlines/descriptions/videos — NO logoImages,
 *      NO cover). PAUSED at every level (ad group ENABLED under the PAUSED parent).
 *   2. validateGoogleDemandGenAd — businessName ≤25, ≥1 headline ≤40, ≥1 long
 *      headline ≤90, ≥1 description ≤90 (no keyword validation — Demand Gen is
 *      audience-based).
 *   3. buildGoogleDemandGenMutateRequest — partialFailure:false + validateOnly
 *      passthrough; googleCreateDemandGenVideoCampaign validateOnly:true → zero
 *      objects (native Google validate).
 *   4. The admin-ad-create-campaign Google video sub-branch (SOURCE assertions):
 *      READY-ref-required (google/video/content_hash/status=ready + youtube_video_id),
 *      validate_only zero-object, objective "DEMAND_GEN" persisted PAUSED — and
 *      Reddit video create still fail-closed (video_create_not_available_phase_a
 *      now appears exactly ONCE, bound to the Reddit guard).
 *
 * The DEMAND_GEN wire shape is the documented Google Ads API v24 contract; the
 * exact required-field set is pinned by a native validateOnly:true probe BEFORE any
 * object exists (a SEPARATE orchestrator acceptance step, not this gate).
 *
 * Run: deno test --allow-env --allow-read \
 *   supabase/functions/_shared/__tests__/issue997_google_video_create.test.ts
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { type AdConnectionRow, centsToPlatformBudget } from "../adChannel.ts";
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

Deno.test("D2 builder: demandGenVideoResponsiveAd carries businessName/headlines/longHeadlines/descriptions — and NO logo/cover", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  const ad = opOfType(ops, "adGroupAdOperation")!.ad as Record<string, unknown>;
  assertEquals(ad.finalUrls, ["https://usemingla.com/e/test-brand/test-event"]);
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
  // NO logo (logoImages OPTIONAL — omitted) and NO cover/thumbnail (YouTube auto).
  assertEquals(dg.logoImages, undefined);
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

Deno.test("D2 builder: temp ids are negative + defined-before-referenced (budget→campaign→asset→adGroup→ad)", () => {
  const ops = buildGoogleDemandGenMutateOperations(CUSTOMER_ID, DG_INPUT);
  // Op ORDER: budget, campaign, geo-criteria×1, asset, adGroup, adGroupAd.
  const keys = ops.map((o) => Object.keys(o)[0]);
  assertEquals(keys, [
    "campaignBudgetOperation",
    "campaignOperation",
    "campaignCriterionOperation",
    "assetOperation",
    "adGroupOperation",
    "adGroupAdOperation",
  ]);
  const budgetRes = opOfType(ops, "campaignBudgetOperation")!
    .resourceName as string;
  const campaignRes = opOfType(ops, "campaignOperation")!
    .resourceName as string;
  const assetRes = opOfType(ops, "assetOperation")!.resourceName as string;
  const adGroupRes = opOfType(ops, "adGroupOperation")!.resourceName as string;
  assertStringIncludes(budgetRes, "/campaignBudgets/-1");
  assertStringIncludes(campaignRes, "/campaigns/-2");
  assertStringIncludes(assetRes, "/assets/-3");
  assertStringIncludes(adGroupRes, "/adGroups/-4");
  // Budget referenced by campaign; campaign by adGroup; asset by the ad.
  assertEquals(opOfType(ops, "campaignOperation")!.campaignBudget, budgetRes);
  assertEquals(opOfType(ops, "adGroupOperation")!.campaign, campaignRes);
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

Deno.test("D2 guardrail: Reddit video create STILL fail-closed — video_create_not_available_phase_a now appears exactly ONCE (Reddit only)", async () => {
  const src = await createSource();
  // D1/C asserted TWO (Google + Reddit). D2 wires Google, so exactly ONE remains.
  assertEquals(src.match(/video_create_not_available_phase_a/g)?.length, 1);
  // And it is bound to the Reddit video guard.
  assert(
    /creativeR\.kind === "video"[\s\S]{0,160}video_create_not_available_phase_a/
      .test(src),
    "the Reddit video-create branch must still fail closed (422)",
  );
});
