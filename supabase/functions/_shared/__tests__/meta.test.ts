/**
 * ISSUE-862 WP1 — meta.ts adapter unit tests (implementor happy-path suite).
 *
 * Regression contract coverage:
 *   RT-1 (fail-close): token-absent → AdNotConnectedError with ZERO Graph
 *   calls. Reverting the resolveMetaToken() throw makes these tests fail.
 *   M-13 (PROOF M-P5): campaign create sends is_adset_budget_sharing_enabled
 *   explicit false when not CBO.
 *   GR-11: PAUSED explicitly at every level.
 *   A4.f (PROOF D-P1): the creative link is the canonical dest_url.
 *   M-4/GR-56: CREDIT special-ad-category rejected with migration message.
 *   GR-18: review_detail never contains `recommendations`.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/meta.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { type AdConnectionRow, AdNotConnectedError } from "../adChannel.ts";
import {
  applySpecialAdCategoryRestrictions,
  buildMetaAdBody,
  buildMetaAdSetBody,
  buildMetaCampaignBody,
  buildMetaCreativeBody,
  buildMetaReviewDetail,
  META_URL_TAGS,
  metaAdapter,
  metaPixelHasSignal,
  normalizeMetaError,
  resolveMetaToken,
  validateSpecialAdCategories,
} from "../meta.ts";

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-000000000001",
  platform: "meta",
  lane: "consumer",
  display_name: "Meta · Consumer",
  external_account_id: "test-account",
  external_org_id: null,
  auth_kind: "system_user_token",
  token_env_var: "META_SYSTEM_USER_TOKEN",
  extra: {},
  status: "connected",
  currency: "USD",
  timezone: null,
  min_daily_budget_cents: 100,
  account_status: "ACTIVE",
  token_last_verified_at: null,
  connected: true,
};

function withTokenUnset(fn: () => void | Promise<void>): () => Promise<void> {
  return async () => {
    const prior = Deno.env.get("META_SYSTEM_USER_TOKEN");
    Deno.env.delete("META_SYSTEM_USER_TOKEN");
    try {
      await fn();
    } finally {
      if (prior !== undefined) Deno.env.set("META_SYSTEM_USER_TOKEN", prior);
    }
  };
}

// ── RT-1: fail-close, zero Graph calls ────────────────────────────────────────

Deno.test(
  "RT-1: resolveMetaToken throws AdNotConnectedError when the secret is unset",
  withTokenUnset(() => {
    // Reverting the fail-close throw in resolveMetaToken (returning "" instead)
    // makes this fail — no silent spend on a broken connection.
    assertThrows(() => resolveMetaToken(CONN), AdNotConnectedError);
  }),
);

Deno.test(
  "RT-1: adapter.createCampaign with no token makes ZERO Graph calls",
  withTokenUnset(async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      await assertRejects(
        () => metaAdapter.createCampaign(CONN, { name: "x", objective: "OUTCOME_TRAFFIC" }),
        AdNotConnectedError,
      );
      assertEquals(fetchCalls, 0, "token-absent must fail BEFORE any network call");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }),
);

Deno.test(
  "RT-1: connect / setStatus / getStatus also fail-close without the token",
  withTokenUnset(async () => {
    await assertRejects(() => metaAdapter.connect(CONN), AdNotConnectedError);
    await assertRejects(
      () => metaAdapter.setStatus(CONN, "campaign", "123", "ACTIVE"),
      AdNotConnectedError,
    );
    await assertRejects(
      () => metaAdapter.getStatus(CONN, "campaign", "123"),
      AdNotConnectedError,
    );
  }),
);

// ── M-13 + CBO branch (PROOF M-P5) ────────────────────────────────────────────

Deno.test("M-13: non-CBO campaign body sends explicit is_adset_budget_sharing_enabled=false", () => {
  const body = buildMetaCampaignBody({ name: "c", objective: "OUTCOME_TRAFFIC" });
  assertEquals(body.is_adset_budget_sharing_enabled, false);
  assertEquals(body.daily_budget, undefined);
});

Deno.test("M-13/CBO: CBO campaign body carries daily_budget in cents and omits the flag", () => {
  const body = buildMetaCampaignBody({
    name: "c",
    objective: "OUTCOME_TRAFFIC",
    dailyBudgetCents: 500,
  });
  assertEquals(body.daily_budget, 500); // Meta identity — cents stay cents
  assertEquals("is_adset_budget_sharing_enabled" in body, false);
});

// ── GR-11: PAUSED explicitly at every level ───────────────────────────────────

Deno.test("GR-11: campaign, ad set, and ad bodies are all explicitly PAUSED", () => {
  assertEquals(
    buildMetaCampaignBody({ name: "c", objective: "OUTCOME_TRAFFIC" }).status,
    "PAUSED",
  );
  assertEquals(
    buildMetaAdSetBody("camp_1", {
      name: "s",
      optimizationGoal: "LINK_CLICKS",
      billingEvent: "IMPRESSIONS",
      targeting: {},
    }).status,
    "PAUSED",
  );
  assertEquals(
    buildMetaAdBody("adset_1", { name: "a", externalCreativeId: "cr_1" }).status,
    "PAUSED",
  );
});

// ── A4.f destination policy v1 (PROOF D-P1) ───────────────────────────────────

Deno.test("A4.f: the creative link IS the canonical dest_url (link_data + CTA value)", () => {
  const destUrl = "https://business.usemingla.com/e/lorne/tuesday-live";
  const body = buildMetaCreativeBody("page_1", {
    destUrl,
    message: "m",
    headline: "h",
    imageUrl: "https://img.example/x.jpg",
    callToActionType: "BUY_TICKETS",
  });
  const spec = body.object_story_spec as Record<string, Record<string, unknown>>;
  assertEquals(spec.link_data.link, destUrl);
  const cta = spec.link_data.call_to_action as Record<string, Record<string, unknown>>;
  assertEquals(cta.value.link, destUrl);
  // The OneLink never enters the creative body (D-P1: crawlers get an
  // app-install interstitial — cloaking pattern).
  assert(!JSON.stringify(body).includes("onelink"), "no OneLink in the creative body");
  assert(!JSON.stringify(body).includes("go.usemingla.com"), "no smart-link host in the creative body");
});

Deno.test("A4.g: url_tags UTM template is always attached", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://business.usemingla.com/e/b/e",
    message: "m",
  });
  assertEquals(body.url_tags, META_URL_TAGS);
  assert(String(body.url_tags).includes("utm_source=facebook"));
  assert(String(body.url_tags).includes("{{campaign.name}}"));
});

Deno.test("A4.g: video_data branch — video_id present ⇒ video creative, no link_data", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://business.usemingla.com/e/b/e",
    message: "m",
    headline: "t",
    videoId: "vid_123",
    videoThumbnailImageHash: "hash_1",
  });
  const spec = body.object_story_spec as Record<string, Record<string, unknown>>;
  assertEquals(spec.video_data.video_id, "vid_123");
  assertEquals(spec.video_data.image_hash, "hash_1");
  assertEquals(spec.link_data, undefined);
});

Deno.test("GR-61: ai_generated creative discloses self_ai_disclosure OPT_IN", () => {
  const withAi = buildMetaCreativeBody("page_1", {
    destUrl: "https://x.com",
    message: "m",
    aiGenerated: true,
  });
  assertEquals(withAi.self_ai_disclosure, "OPT_IN");
  const without = buildMetaCreativeBody("page_1", { destUrl: "https://x.com", message: "m" });
  assertEquals("self_ai_disclosure" in without, false);
});

Deno.test("A4.g: conversion_domain rides on the ad body (Meta AEM)", () => {
  const body = buildMetaAdBody("adset_1", {
    name: "a",
    externalCreativeId: "cr_1",
    conversionDomain: "usemingla.com",
  });
  assertEquals(body.conversion_domain, "usemingla.com");
});

Deno.test("validate-only passthrough sets execution_options on every builder", () => {
  assertEquals(
    buildMetaCampaignBody({ name: "c", objective: "OUTCOME_TRAFFIC", validateOnly: true })
      .execution_options,
    ["validate_only"],
  );
  assertEquals(
    buildMetaCreativeBody("p", { destUrl: "https://x.com", message: "m", validateOnly: true })
      .execution_options,
    ["validate_only"],
  );
});

// ── M-4/GR-56: special_ad_categories ──────────────────────────────────────────

Deno.test("M-4: CREDIT is rejected with the FINANCIAL_PRODUCTS_SERVICES migration message", () => {
  const result = validateSpecialAdCategories(["CREDIT"]);
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.detail, "special_ad_category_credit_retired");
    assert(result.message.includes("FINANCIAL_PRODUCTS_SERVICES"));
  }
});

Deno.test("M-4: unknown categories (incl. the nonexistent gambling value) are rejected", () => {
  const result = validateSpecialAdCategories(["ONLINE_GAMBLING_AND_GAMING"]);
  assertEquals(result.ok, false);
  const valid = validateSpecialAdCategories(["HOUSING", "NONE"]);
  assertEquals(valid.ok, true);
  if (valid.ok) assertEquals(valid.categories, ["HOUSING"]); // NONE filtered out
});

Deno.test("A4.g: the restriction cascade forces 18-65 and strips genders/zips/flexible_spec", () => {
  const restricted = applySpecialAdCategoryRestrictions({
    age_min: 25,
    age_max: 40,
    genders: [1],
    zips: ["10001"],
    excluded_geo_locations: { countries: ["CA"] },
    flexible_spec: [{ interests: [] }],
    geo_locations: { countries: ["US"], zips: ["10001"] },
  });
  assertEquals(restricted.age_min, 18);
  assertEquals(restricted.age_max, 65);
  assertEquals("genders" in restricted, false);
  assertEquals("zips" in restricted, false);
  assertEquals("excluded_geo_locations" in restricted, false);
  assertEquals("flexible_spec" in restricted, false);
  assertEquals(
    (restricted.geo_locations as Record<string, unknown>).zips,
    undefined,
  );
});

// ── Error normalization (AC-9: no token echo) ─────────────────────────────────

Deno.test("normalizeMetaError extracts code/subcode/fbtrace_id and prefers error_user_msg", () => {
  const normalized = normalizeMetaError({
    error: {
      message: "Invalid parameter",
      error_user_msg: "Your budget is too low.",
      code: 100,
      error_subcode: 4834011,
      fbtrace_id: "AbCdEf",
    },
  });
  assertEquals(normalized.code, 100);
  assertEquals(normalized.subcode, 4834011);
  assertEquals(normalized.message, "Your budget is too low.");
  assertEquals(normalized.fbtrace_id, "AbCdEf");
});

Deno.test("normalizeMetaError never contains a token-shaped field", () => {
  const normalized = normalizeMetaError({ error: { message: "x", code: 1 } });
  const serialized = JSON.stringify(normalized);
  assert(!serialized.includes("access_token"));
  assert(!serialized.toLowerCase().includes("bearer"));
});

// ── Pixel gate (A4.e.5 / PROOF M-P7) ──────────────────────────────────────────

Deno.test("pixel: epoch-0 / null / garbage last_fired_time ⇒ no signal", () => {
  assertEquals(metaPixelHasSignal(null), false);
  assertEquals(metaPixelHasSignal(""), false);
  assertEquals(metaPixelHasSignal("1969-12-31T16:00:00-0800"), false);
  assertEquals(metaPixelHasSignal("1970-01-01T00:00:00+0000"), false);
  assertEquals(metaPixelHasSignal("not-a-date"), false);
});

Deno.test("pixel: a real recent fire ⇒ signal", () => {
  assertEquals(metaPixelHasSignal("2026-07-01T00:00:00+0000"), true);
});

// ── GR-18: review_detail never stores `recommendations` ───────────────────────

Deno.test("GR-18: buildMetaReviewDetail keeps issues_info + feedback, strips recommendations", () => {
  const detail = buildMetaReviewDetail({
    issuesInfo: [
      {
        error_code: 1815869,
        error_summary: "Ad post not available",
        error_type: "HARD_ERROR",
        recommendations: [{ code: 1, title: "tip", message: "optimization tip" }],
      },
    ],
    adReviewFeedback: {
      global: { UNSUPPORTED_CONTENT: "Your ad ..." },
      placement_specific: { facebook: { X: "y" } },
      recommendations: [{ code: 2 }],
    },
  });
  assert(detail !== null);
  const serialized = JSON.stringify(detail);
  assert(!serialized.includes("recommendations"), "recommendations must NEVER be stored (GR-18)");
  assert(serialized.includes("issues_info"));
  assert(serialized.includes("ad_review_feedback_global"));
  assert(serialized.includes("ad_review_feedback_placement_specific"));
});

Deno.test("GR-18: empty inputs produce null review_detail (never a fabricated {})", () => {
  assertEquals(buildMetaReviewDetail({ issuesInfo: null, adReviewFeedback: null }), null);
  assertEquals(buildMetaReviewDetail({ issuesInfo: [], adReviewFeedback: null }), null);
});
