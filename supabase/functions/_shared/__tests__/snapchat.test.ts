/**
 * ISSUE-867 WP5 — snapchat.ts unit tests (implementor happy-path suite).
 *
 * Covers the WP5 dispatch's mandatory list against SPEC_ISSUE-867 + A1.2:
 *   - money boundary: cents × 10,000 → micro EXACT ($5.00/500¢ → 5,000,000 ·
 *     $20.00/2,000¢ → 20,000,000 — RT-5); floors run in MICRO, AFTER
 *     conversion (squad ≥5,000,000 · campaign ≥20,000,000 · spend cap
 *     ≥20,000,000 — AC-S-3/GR-64).
 *   - S-1: objective_v2_properties.objective_v2_type — NEVER objective_v2.
 *   - S-2: ad type derived from the creative-type→ad-type MAP (WEB_VIEW →
 *     REMOTE_WEBPAGE; SNAP_AD is the attachment-less trap) — never hardcoded.
 *   - S-3: per-creative-type CTA allowlist (exactly 23 WEB_VIEW values);
 *     VIEW_MORE does not exist on any type → invalid_cta.
 *   - S-4: delivery_constraint REQUIRED, derived from the budget field used.
 *   - S-6: the legacy `objective` key is NEVER present in a campaign body.
 *   - S-7: bid-strategy allowlist (MIN_ROAS deprecated 10 Feb 2025 →
 *     rejected); bid_micro required for cap strategies, min 10,000.
 *   - S-9: envelope double-assert — request_status AND every (nested)
 *     sub_request_status (RT-3; probe-proven S-P5).
 *   - GR-39: demographics default [{min_age:"18"}]; min_age/max_age STRINGS.
 *   - GR-54: server-side length validators (headline 34 / brand 32 / name 375
 *     / url https+2048).
 *   - GR-64(b): paging.next_link is followed — list reads never silently
 *     truncate at page 1.
 *   - A1.2-14: Top Snap duration 3–180 s → invalid_duration.
 *   - QA WP7 F-1 sentinel class: a persisted external_account_id failing the
 *     UUID-v4-lowercase shape is ABSENCE, never a pin.
 *   - PAUSED fuzz across all three builders (mirrors WP1 T-3 / WP7 DISABLE).
 *   - mint cache (one HTTP mint per window; re-mint after reset); mint 4xx
 *     fails CLOSE (AC-S-8); registry: getAdapter("snapchat") is the live
 *     adapter and fail-closes while the SNAPCHAT_* secrets are unset (RT-1).
 *   - GR-38: both review vocabularies + reasons + delivery_status in
 *     buildSnapchatReviewDetail; launch warning keys off BOTH vocabularies.
 *   - Snap has NO validate-only: createX with validateOnly:true refuses
 *     loudly (snapchat_no_validate_only — the WP2 §10 discovery).
 *
 * Fails-on-revert targets (proven by TRUE LINE DELETION, not comment-out):
 *   1. the `WEB_VIEW: "REMOTE_WEBPAGE",` entry of SNAPCHAT_CREATIVE_TO_AD_TYPE
 *      — the S-2 map + ad-body tests fail without it.
 *   2. the `status: "PAUSED",` line in buildSnapchatCampaignBody — the PAUSED
 *      fuzz fails without it.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/snapchat.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdConnectionRow,
  AdApiError,
  AdNotConnectedError,
  centsToPlatformBudget,
  getAdapter,
  SNAPCHAT_CTA_MAP,
} from "../adChannel.ts";
import {
  assertSnapchatEnvelope,
  buildSnapchatAdBody,
  buildSnapchatAdSquadBody,
  buildSnapchatCampaignBody,
  buildSnapchatCreativeBody,
  buildSnapchatReviewDetail,
  engineStatusFromSnapchat,
  mintSnapchatAccessToken,
  resetSnapchatTokenCacheForTests,
  resolveSnapchatClient,
  resolveSnapchatEnvConfig,
  scrubSnapchatSecrets,
  SNAPCHAT_AD_ACCOUNT_ID_REGEX,
  SNAPCHAT_BID_STRATEGIES,
  SNAPCHAT_CREATIVE_TO_AD_TYPE,
  SNAPCHAT_MIN_ADSQUAD_BUDGET_MICRO,
  SNAPCHAT_MIN_CAMPAIGN_BUDGET_MICRO,
  SNAPCHAT_MIN_SPEND_CAP_MICRO,
  SNAPCHAT_PIXEL_GATED_GOALS,
  SNAPCHAT_WEB_VIEW_CTA_ALLOWLIST,
  snapchatAdTypeForCreativeType,
  snapchatCollectPages,
  snapchatDeliveryStatusText,
  snapchatDemographicsWithDefault,
  snapchatLaunchWarning,
  snapchatStatusForAdvertiserStatus,
  snapchatStripReadOnlyFields,
  type SnapchatClient,
  validateSnapchatBrandName,
  validateSnapchatBudgetFloorMicro,
  validateSnapchatCta,
  validateSnapchatDemographics,
  validateSnapchatHeadline,
  validateSnapchatName,
  validateSnapchatSpendCapReduction,
  validateSnapchatVideoDuration,
  validateSnapchatWebViewUrl,
} from "../snapchat.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ACCOUNT_ID = "6421cc96-dcaf-4a09-a7fa-b24199dcb391"; // S-P2 (real shape)
const ORG_ID = "9389df65-3fa2-4a79-9593-479eee8d67bb";
const PROFILE_ID = "2cfbdc85-890c-43af-b393-10c0adbbad67"; // A1.2-8 trusted config
const MEDIA_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CAMPAIGN_ID = "11111111-2222-4333-8444-555555555555";
const CREATIVE_ID = "99999999-8888-4777-8666-555555555555";

const SNAP_ENV_NAMES = [
  "SNAPCHAT_REFRESH_TOKEN",
  "SNAPCHAT_CLIENT_ID",
  "SNAPCHAT_CLIENT_SECRET",
  "SNAPCHAT_AD_ACCOUNT_ID",
  "SNAPCHAT_ORG_ID",
  "SNAPCHAT_PROFILE_ID",
  "SNAPCHAT_PIXEL_ID",
] as const;

function withSnapEnvCleared(fn: () => void | Promise<void>): () => Promise<void> {
  return async () => {
    const saved = new Map<string, string | undefined>();
    for (const name of SNAP_ENV_NAMES) {
      saved.set(name, Deno.env.get(name));
      Deno.env.delete(name);
    }
    resetSnapchatTokenCacheForTests();
    try {
      await fn();
    } finally {
      for (const [name, value] of saved) {
        if (value !== undefined) Deno.env.set(name, value);
        else Deno.env.delete(name);
      }
      resetSnapchatTokenCacheForTests();
    }
  };
}

function withSnapEnvSet(fn: () => void | Promise<void>): () => Promise<void> {
  return withSnapEnvCleared(async () => {
    Deno.env.set("SNAPCHAT_REFRESH_TOKEN", "test-refresh-token");
    Deno.env.set("SNAPCHAT_CLIENT_ID", "test-client-id");
    Deno.env.set("SNAPCHAT_CLIENT_SECRET", "test-client-secret");
    Deno.env.set("SNAPCHAT_AD_ACCOUNT_ID", ACCOUNT_ID);
    Deno.env.set("SNAPCHAT_PROFILE_ID", PROFILE_ID);
    await fn();
  });
}

function makeConn(overrides: Partial<AdConnectionRow> = {}): AdConnectionRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    platform: "snapchat",
    lane: "consumer",
    display_name: "Snapchat · Consumer (Mingla Ads)",
    external_account_id: ACCOUNT_ID,
    external_org_id: ORG_ID,
    auth_kind: "refresh_token",
    token_env_var: "SNAPCHAT_REFRESH_TOKEN",
    extra: { profile_id: PROFILE_ID },
    status: "connected",
    currency: "USD",
    timezone: "America/New_York",
    min_daily_budget_cents: 500,
    account_status: "ACTIVE",
    token_last_verified_at: null,
    connected: true,
    ...overrides,
  };
}

function fakeClient(overrides: Partial<SnapchatClient> = {}): SnapchatClient {
  return {
    platform: "snapchat",
    accessToken: "test-access-token",
    adAccountId: ACCOUNT_ID,
    organizationId: ORG_ID,
    profileId: PROFILE_ID,
    pixelId: null,
    apiBase: "https://adsapi.snapchat.com/v1",
    ...overrides,
  };
}

function mintResponse(): Response {
  return new Response(
    JSON.stringify({ access_token: "test-access-token", expires_in: 3600, token_type: "Bearer" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ── RT-5 money boundary — cents × 10,000 → micro EXACT ────────────────────────

Deno.test("RT-5: $5.00 (500¢) → 5,000,000 micro EXACT and $20.00 (2,000¢) → 20,000,000 micro EXACT", () => {
  assertEquals(centsToPlatformBudget("snapchat", 500), 5_000_000);
  assertEquals(centsToPlatformBudget("snapchat", 2_000), 20_000_000);
  // Odd cents stay exact integers — no float drift at the boundary.
  assertEquals(centsToPlatformBudget("snapchat", 501), 5_010_000);
  assertEquals(centsToPlatformBudget("snapchat", 1), 10_000);
});

Deno.test("AC-S-3: floors run in MICRO after conversion — 499¢ squad fails, 500¢ passes; 1,999¢ campaign fails, 2,000¢ passes", () => {
  const below = validateSnapchatBudgetFloorMicro({
    level: "ad_squad",
    micro: centsToPlatformBudget("snapchat", 499),
  });
  assert(!below.ok && below.detail === "budget_below_minimum");
  assert(validateSnapchatBudgetFloorMicro({ level: "ad_squad", micro: 5_000_000 }).ok);
  const campaignBelow = validateSnapchatBudgetFloorMicro({
    level: "campaign",
    micro: centsToPlatformBudget("snapchat", 1_999),
  });
  assert(!campaignBelow.ok && campaignBelow.detail === "budget_below_minimum");
  assert(validateSnapchatBudgetFloorMicro({ level: "campaign", micro: 20_000_000 }).ok);
  assertEquals(SNAPCHAT_MIN_ADSQUAD_BUDGET_MICRO, 5_000_000);
  assertEquals(SNAPCHAT_MIN_CAMPAIGN_BUDGET_MICRO, 20_000_000);
});

Deno.test("money at the wire: a 500¢ ABO squad carries daily_budget_micro === 5,000,000 exactly", () => {
  const body = buildSnapchatAdSquadBody(CAMPAIGN_ID, {
    name: "squad",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 500,
  });
  assertEquals(body.daily_budget_micro, 5_000_000);
});

// ── S-1 + S-6: objective_v2_type key; legacy `objective` never sent ───────────

Deno.test("S-1: the campaign body carries objective_v2_properties.objective_v2_type — NEVER objective_v2", () => {
  const body = buildSnapchatCampaignBody(ACCOUNT_ID, { name: "camp", objective: "TRAFFIC" });
  const props = body.objective_v2_properties as Record<string, unknown>;
  assertEquals(props.objective_v2_type, "TRAFFIC");
  assert(!("objective_v2" in props), "the objective_v2 KEY 400s — S-1");
});

Deno.test("S-6: the legacy top-level `objective` key is NEVER present (deprecated 21 Mar 2025)", () => {
  const body = buildSnapchatCampaignBody(ACCOUNT_ID, {
    name: "camp",
    objective: "TRAFFIC",
    dailyBudgetCents: 2_000,
    spendCapCents: 5_000,
  });
  assert(!("objective" in body), "sending `objective` invites the translator's default — S-6");
});

Deno.test("S-1: an invalid objective_v2_type is rejected before any call", () => {
  const err = assertThrows(
    () => buildSnapchatCampaignBody(ACCOUNT_ID, { name: "camp", objective: "CLICKS" }),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "invalid_objective");
});

// ── S-2: creative-type → ad-type MAP (fails-on-revert target #1) ──────────────

Deno.test("S-2: the map derives WEB_VIEW → REMOTE_WEBPAGE (and every pinned pair)", () => {
  // Deleting the WEB_VIEW line of SNAPCHAT_CREATIVE_TO_AD_TYPE fails this test.
  assertEquals(SNAPCHAT_CREATIVE_TO_AD_TYPE.WEB_VIEW, "REMOTE_WEBPAGE");
  assertEquals(SNAPCHAT_CREATIVE_TO_AD_TYPE.APP_INSTALL, "APP_INSTALL");
  assertEquals(SNAPCHAT_CREATIVE_TO_AD_TYPE.DEEP_LINK, "DEEP_LINK");
  assertEquals(SNAPCHAT_CREATIVE_TO_AD_TYPE.COLLECTION, "COLLECTION");
  assertEquals(SNAPCHAT_CREATIVE_TO_AD_TYPE.LEAD_GENERATION, "LEAD_GENERATION");
  assertEquals(snapchatAdTypeForCreativeType("WEB_VIEW"), "REMOTE_WEBPAGE");
});

Deno.test("S-2: the ad body for a WEB_VIEW creative is REMOTE_WEBPAGE — NOT the attachment-less SNAP_AD trap", () => {
  const body = buildSnapchatAdBody("22222222-3333-4444-8555-666666666666", {
    name: "ad",
    creativeExternalId: CREATIVE_ID,
    creativeType: "WEB_VIEW",
  });
  assertEquals(body.type, "REMOTE_WEBPAGE");
  assert(body.type !== "SNAP_AD", "SNAP_AD can succeed and pay for impressions that never reach the destination — S-2");
});

Deno.test("S-2: an unmapped creative type throws (derivation, never a hardcoded fallback)", () => {
  const err = assertThrows(() => snapchatAdTypeForCreativeType("STORY_AD"), AdApiError);
  assertEquals((err as AdApiError).code, "creative_type_unmapped");
});

// ── S-3: CTA allowlist — VIEW_MORE does not exist ─────────────────────────────

Deno.test("S-3: VIEW_MORE is rejected (invalid_cta) — it does not exist on any creative type", () => {
  const check = validateSnapchatCta("WEB_VIEW", "VIEW_MORE");
  assert(!check.ok && check.detail === "invalid_cta");
});

Deno.test("S-3: the WEB_VIEW allowlist is exactly the 23 documented values and each passes", () => {
  assertEquals(SNAPCHAT_WEB_VIEW_CTA_ALLOWLIST.length, 23);
  for (const cta of SNAPCHAT_WEB_VIEW_CTA_ALLOWLIST) {
    assert(validateSnapchatCta("WEB_VIEW", cta).ok, `${cta} must be allowed`);
  }
  // The reservation-traffic defaults are on the list.
  assert(SNAPCHAT_WEB_VIEW_CTA_ALLOWLIST.includes("BOOK_NOW"));
  assert(SNAPCHAT_WEB_VIEW_CTA_ALLOWLIST.includes("BUY_TICKETS"));
  // The house SNAPCHAT_CTA_MAP only emits allowlisted values.
  for (const cta of Object.values(SNAPCHAT_CTA_MAP)) {
    assert(SNAPCHAT_WEB_VIEW_CTA_ALLOWLIST.includes(cta), `${cta} from SNAPCHAT_CTA_MAP must be valid`);
  }
});

Deno.test("S-3: an unpinned creative type has NO allowlist and fails closed", () => {
  const check = validateSnapchatCta("COLLECTION", "BOOK_NOW");
  assert(!check.ok && check.detail === "invalid_cta");
});

Deno.test("S-3: buildSnapchatCreativeBody refuses VIEW_MORE before any provider call", () => {
  const err = assertThrows(
    () =>
      buildSnapchatCreativeBody(ACCOUNT_ID, {
        name: "creative",
        topSnapMediaId: MEDIA_ID,
        headline: "Book tonight",
        profileId: PROFILE_ID,
        webViewUrl: "https://mingla.app/e/brand/event",
        callToAction: "VIEW_MORE",
      }),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "invalid_cta");
});

// ── S-4: delivery_constraint REQUIRED, derived from the budget field ──────────

Deno.test("S-4: daily squad budget ⇒ delivery_constraint DAILY_BUDGET", () => {
  const body = buildSnapchatAdSquadBody(CAMPAIGN_ID, {
    name: "squad",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 500,
  });
  assertEquals(body.delivery_constraint, "DAILY_BUDGET");
  assertEquals(body.daily_budget_micro, 5_000_000);
  assert(!("lifetime_budget_micro" in body));
});

Deno.test("S-4: lifetime squad budget ⇒ delivery_constraint LIFETIME_BUDGET (+ end_time required)", () => {
  const body = buildSnapchatAdSquadBody(CAMPAIGN_ID, {
    name: "squad",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 2_000,
    budgetMode: "lifetime",
    endTime: "2026-08-01T00:00:00.000Z",
  });
  assertEquals(body.delivery_constraint, "LIFETIME_BUDGET");
  assertEquals(body.lifetime_budget_micro, 20_000_000);
  const missingEnd = assertThrows(
    () =>
      buildSnapchatAdSquadBody(CAMPAIGN_ID, {
        name: "squad",
        optimizationGoal: "SWIPES",
        countries: ["US"],
        budgetCents: 2_000,
        budgetMode: "lifetime",
      }),
    AdApiError,
  );
  assertEquals((missingEnd as AdApiError).code, "end_time_required");
});

Deno.test("S-4: CBO (no squad budget) still carries a delivery_constraint — the field is REQUIRED", () => {
  const body = buildSnapchatAdSquadBody(CAMPAIGN_ID, {
    name: "squad",
    optimizationGoal: "SWIPES",
    countries: ["US"],
  });
  assertEquals(body.delivery_constraint, "DAILY_BUDGET");
  assert(!("daily_budget_micro" in body) && !("lifetime_budget_micro" in body));
});

// ── S-7: bid strategies — MIN_ROAS locked out ─────────────────────────────────

Deno.test("S-7: MIN_ROAS is rejected (deprecated 10 Feb 2025); the allowlist is exactly three values", () => {
  assertEquals([...SNAPCHAT_BID_STRATEGIES], ["AUTO_BID", "LOWEST_COST_WITH_MAX_BID", "TARGET_COST"]);
  const err = assertThrows(
    () =>
      buildSnapchatAdSquadBody(CAMPAIGN_ID, {
        name: "squad",
        optimizationGoal: "SWIPES",
        countries: ["US"],
        budgetCents: 500,
        bidStrategy: "MIN_ROAS",
      }),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "bid_strategy_invalid");
});

Deno.test("S-7: cap strategies require bid_cents (→ bid_micro ≥ 10,000); AUTO_BID omits bid_micro", () => {
  const missing = assertThrows(
    () =>
      buildSnapchatAdSquadBody(CAMPAIGN_ID, {
        name: "squad",
        optimizationGoal: "SWIPES",
        countries: ["US"],
        budgetCents: 500,
        bidStrategy: "LOWEST_COST_WITH_MAX_BID",
      }),
    AdApiError,
  );
  assertEquals((missing as AdApiError).code, "bid_micro_required");
  const withBid = buildSnapchatAdSquadBody(CAMPAIGN_ID, {
    name: "squad",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 500,
    bidStrategy: "TARGET_COST",
    bidCents: 50,
  });
  assertEquals(withBid.bid_micro, 500_000);
  const auto = buildSnapchatAdSquadBody(CAMPAIGN_ID, {
    name: "squad",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 500,
  });
  assertEquals(auto.bid_strategy, "AUTO_BID");
  assert(!("bid_micro" in auto), "bid_micro is omitted for AUTO_BID — S-7");
});

// ── S-9: envelope double-assert (RT-3) ────────────────────────────────────────

Deno.test("S-9: request_status FAILURE throws even on an HTTP 200 payload", () => {
  const err = assertThrows(
    () => assertSnapchatEnvelope({ request_status: "ERROR", request_id: "r1" }, "test"),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "snapchat_request_failed");
});

Deno.test("S-9 (RT-3): request_status SUCCESS carrying a nested sub_request_status FAILURE is a FAILURE, not a success", () => {
  const err = assertThrows(
    () =>
      assertSnapchatEnvelope({
        request_status: "SUCCESS",
        request_id: "r2",
        campaigns: [
          { sub_request_status: "SUCCESS", campaign: { id: CAMPAIGN_ID } },
          {
            sub_request_status: "FAILURE",
            campaign: { id: null },
            debug_message: "budget too low",
          },
        ],
      }, "campaign create"),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "snapchat_sub_request_failed");
  // Deeper nesting cannot smuggle a failure past the walk either.
  const nested = assertThrows(
    () =>
      assertSnapchatEnvelope({
        request_status: "SUCCESS",
        outer: { inner: [{ deep: { sub_request_status: "FAILURE" } }] },
      }, "nested"),
    AdApiError,
  );
  assertEquals((nested as AdApiError).code, "snapchat_sub_request_failed");
});

Deno.test("S-9: an all-SUCCESS envelope passes", () => {
  assertSnapchatEnvelope({
    request_status: "SUCCESS",
    campaigns: [{ sub_request_status: "SUCCESS", campaign: { id: CAMPAIGN_ID } }],
  }, "ok");
});

// ── GR-39: demographics — strings, min_age 18 default ─────────────────────────

Deno.test("GR-39: demographics default to [{min_age:'18'}] when the admin sets none", () => {
  assertEquals(snapchatDemographicsWithDefault(null), [{ min_age: "18" }]);
  assertEquals(snapchatDemographicsWithDefault([]), [{ min_age: "18" }]);
  const body = buildSnapchatAdSquadBody(CAMPAIGN_ID, {
    name: "squad",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 500,
  });
  const targeting = body.targeting as Record<string, unknown>;
  assertEquals(targeting.demographics, [{ min_age: "18" }]);
});

Deno.test("GR-39: min_age must be a STRING — the number 18 is rejected; genders enum enforced", () => {
  const numeric = validateSnapchatDemographics([{ min_age: 18 }]);
  assert(!numeric.ok && numeric.detail === "demographics_invalid");
  const missing = validateSnapchatDemographics([{ genders: ["MALE"] }]);
  assert(!missing.ok, "an entry without min_age serves minors — rejected");
  const badGender = validateSnapchatDemographics([{ min_age: "18", genders: ["NON_BINARY"] }]);
  assert(!badGender.ok, "no non-binary gender value exists on Snap — GR-39");
  assert(validateSnapchatDemographics([{ min_age: "18", max_age: "34", genders: ["FEMALE"] }]).ok);
});

// ── GR-54: length validators ──────────────────────────────────────────────────

Deno.test("GR-54: headline ≤34 / brand_name ≤32 / name ≤375 / url https+≤2048", () => {
  const h = validateSnapchatHeadline("x".repeat(35));
  assert(!h.ok && h.detail === "headline_too_long");
  assert(validateSnapchatHeadline("x".repeat(34)).ok);
  const b = validateSnapchatBrandName("x".repeat(33));
  assert(!b.ok && b.detail === "brand_name_too_long");
  assert(validateSnapchatBrandName(undefined).ok, "brand_name is optional — Public Profile fallback is often safer");
  const n = validateSnapchatName("x".repeat(376), "campaign name");
  assert(!n.ok && n.detail === "name_too_long");
  const http = validateSnapchatWebViewUrl("http://usemingla.com/e/a/b");
  assert(!http.ok && http.detail === "invalid_destination_url");
  const long = validateSnapchatWebViewUrl(`https://usemingla.com/${"x".repeat(2048)}`);
  assert(!long.ok && long.detail === "invalid_destination_url");
  assert(validateSnapchatWebViewUrl("https://usemingla.com/e/brand/event").ok);
});

// ── A1.2-14: Top Snap duration 3–180 s ────────────────────────────────────────

Deno.test("A1.2-14: video duration outside 3–180 s → invalid_duration; bounds pass", () => {
  const short = validateSnapchatVideoDuration(2);
  assert(!short.ok && short.detail === "invalid_duration");
  const long = validateSnapchatVideoDuration(181);
  assert(!long.ok && long.detail === "invalid_duration");
  assert(validateSnapchatVideoDuration(3).ok);
  assert(validateSnapchatVideoDuration(180).ok);
});

// ── GR-64: spend cap rail + paging ────────────────────────────────────────────

Deno.test("GR-64(a): spend cap below $20.00 (20,000,000 micro) is rejected at build; 2,000¢ passes exactly", () => {
  const err = assertThrows(
    () =>
      buildSnapchatCampaignBody(ACCOUNT_ID, {
        name: "camp",
        objective: "TRAFFIC",
        spendCapCents: 1_999,
      }),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "spend_cap_below_minimum");
  const body = buildSnapchatCampaignBody(ACCOUNT_ID, {
    name: "camp",
    objective: "TRAFFIC",
    spendCapCents: 2_000,
  });
  assertEquals(body.lifetime_spend_cap_micro, SNAPCHAT_MIN_SPEND_CAP_MICRO);
});

Deno.test("GR-64(a): a spend-cap REDUCTION must exceed 1.1× the already-spent amount; unknown spend blocks fail-close", () => {
  assert(validateSnapchatSpendCapReduction({ currentCapMicro: 50_000_000, newCapMicro: 60_000_000, spentMicro: null }).ok, "an increase never needs the spend read");
  const blind = validateSnapchatSpendCapReduction({
    currentCapMicro: 50_000_000,
    newCapMicro: 30_000_000,
    spentMicro: null,
  });
  assert(!blind.ok && blind.detail === "spend_cap_reduction_blocked");
  const tooClose = validateSnapchatSpendCapReduction({
    currentCapMicro: 50_000_000,
    newCapMicro: 22_000_000,
    spentMicro: 20_000_000,
  });
  assert(!tooClose.ok, "22,000,000 is exactly 1.1× 20,000,000 — must be GREATER");
  assert(
    validateSnapchatSpendCapReduction({
      currentCapMicro: 50_000_000,
      newCapMicro: 22_000_001,
      spentMicro: 20_000_000,
    }).ok,
  );
});

Deno.test("GR-64(b): snapchatCollectPages follows paging.next_link — list reads never silently truncate at page 1", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (url.includes("page=2")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            request_status: "SUCCESS",
            pixels: [{ sub_request_status: "SUCCESS", pixel: { id: "p2" } }],
            paging: {},
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          request_status: "SUCCESS",
          pixels: [{ sub_request_status: "SUCCESS", pixel: { id: "p1" } }],
          paging: { next_link: `https://adsapi.snapchat.com/v1/adaccounts/${ACCOUNT_ID}/pixels?page=2` },
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  try {
    const rows = await snapchatCollectPages(fakeClient(), `adaccounts/${ACCOUNT_ID}/pixels`, "pixels");
    assertEquals(rows.length, 2, "both pages must be collected — GR-64(b)");
    assertEquals(urls.length, 2);
    assert(urls[1].includes("page=2"), "the absolute next_link must be followed verbatim");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── QA WP7 F-1 sentinel class — persisted junk is ABSENCE, never a pin ────────

Deno.test(
  "sentinel guard: a persisted 'unconfigured' external_account_id is ABSENCE — the env id wins and no mismatch fires",
  withSnapEnvSet(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(mintResponse())) as typeof fetch;
    try {
      const client = await resolveSnapchatClient(makeConn({ external_account_id: "unconfigured" }));
      assertEquals(client.adAccountId, ACCOUNT_ID, "the sentinel must never pin the lane (F-1 class)");
      // Uppercase (wrong shape) is also absence — Snap ids are lowercase UUID v4.
      const upper = await resolveSnapchatClient(
        makeConn({ external_account_id: ACCOUNT_ID.toUpperCase() }),
      );
      assertEquals(upper.adAccountId, ACCOUNT_ID);
    } finally {
      globalThis.fetch = originalFetch;
      resetSnapchatTokenCacheForTests();
    }
  }),
);

Deno.test(
  "sentinel guard: a REAL persisted id that mismatches the env id refuses loudly (ambiguous account)",
  withSnapEnvSet(async () => {
    const otherReal = "7531cc96-dcaf-4a09-a7fa-b24199dcb392";
    assert(SNAPCHAT_AD_ACCOUNT_ID_REGEX.test(otherReal));
    const err = await assertRejects(
      () => resolveSnapchatClient(makeConn({ external_account_id: otherReal })),
      AdApiError,
    );
    assertEquals((err as AdApiError).code, "account_mismatch");
  }),
);

Deno.test(
  "sentinel guard: no account id anywhere (junk row + no env) → AdNotConnectedError, zero calls",
  withSnapEnvSet(async () => {
    Deno.env.delete("SNAPCHAT_AD_ACCOUNT_ID");
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(mintResponse());
    }) as typeof fetch;
    try {
      await assertRejects(
        () => resolveSnapchatClient(makeConn({ external_account_id: "unconfigured" })),
        AdNotConnectedError,
      );
      assertEquals(calls, 0, "absence must fail-close BEFORE the mint — no network");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }),
);

// ── PAUSED fuzz (fails-on-revert target #2) ───────────────────────────────────

Deno.test("PAUSED fuzz: every campaign/squad/ad body is created status=PAUSED across spec variations (GR-11)", () => {
  const campaignSpecs = [
    { name: "a", objective: "TRAFFIC" },
    { name: "b", objective: "TRAFFIC", dailyBudgetCents: 2_000 },
    { name: "c", objective: "LEADS", spendCapCents: 9_999 },
    { name: "d", objective: "SALES", promotionType: "PROMOTE_PLACES" },
  ] as const;
  for (const spec of campaignSpecs) {
    // Deleting the status:"PAUSED" line in buildSnapchatCampaignBody fails here.
    assertEquals(buildSnapchatCampaignBody(ACCOUNT_ID, { ...spec }).status, "PAUSED");
  }
  const squadSpecs = [
    { name: "s1", optimizationGoal: "SWIPES", countries: ["US"], budgetCents: 500 },
    { name: "s2", optimizationGoal: "IMPRESSIONS", countries: ["GB", "NG"] },
    {
      name: "s3",
      optimizationGoal: "SWIPES",
      countries: ["US"],
      budgetCents: 10_000,
      budgetMode: "lifetime" as const,
      endTime: "2026-09-01T00:00:00.000Z",
    },
  ];
  for (const spec of squadSpecs) {
    assertEquals(buildSnapchatAdSquadBody(CAMPAIGN_ID, spec).status, "PAUSED");
  }
  for (const creativeType of ["WEB_VIEW", "APP_INSTALL", "DEEP_LINK"]) {
    assertEquals(
      buildSnapchatAdBody("22222222-3333-4444-8555-666666666666", {
        name: "ad",
        creativeExternalId: CREATIVE_ID,
        creativeType,
      }).status,
      "PAUSED",
    );
  }
});

// ── Status writer + engine mapping ────────────────────────────────────────────

Deno.test("status writer emits ONLY ACTIVE|PAUSED; a hostile cast throws (DELETE is rollback-only)", () => {
  assertEquals(snapchatStatusForAdvertiserStatus("ACTIVE"), "ACTIVE");
  assertEquals(snapchatStatusForAdvertiserStatus("PAUSED"), "PAUSED");
  assertThrows(() =>
    snapchatStatusForAdvertiserStatus("DELETED" as unknown as Parameters<
      typeof snapchatStatusForAdvertiserStatus
    >[0])
  );
});

Deno.test("engine status mapping: ACTIVE/PAUSED map; unknown → null; delivery arrays serialize", () => {
  assertEquals(engineStatusFromSnapchat("ACTIVE"), "ACTIVE");
  assertEquals(engineStatusFromSnapchat("PAUSED"), "PAUSED");
  assertEquals(engineStatusFromSnapchat("ARCHIVED"), null);
  assertEquals(snapchatDeliveryStatusText(["VALID", "PAUSED_BY_USER"]), "VALID,PAUSED_BY_USER");
  assertEquals(snapchatDeliveryStatusText([]), null);
  assertEquals(snapchatDeliveryStatusText(undefined), null);
});

Deno.test("read-modify-write PUT strips server-owned fields (review/delivery/packaging/timestamps)", () => {
  const stripped = snapchatStripReadOnlyFields({
    id: CAMPAIGN_ID,
    name: "camp",
    status: "PAUSED",
    created_at: "2026-07-15T00:00:00Z",
    updated_at: "2026-07-15T00:00:00Z",
    review_status: "PENDING",
    review_status_reasons: ["x"],
    delivery_status: ["VALID"],
    packaging_status: "SUCCESS",
    daily_budget_micro: 5_000_000,
  });
  assertEquals(Object.keys(stripped).sort(), ["daily_budget_micro", "id", "name", "status"]);
});

// ── GR-38: review vocabularies + launch warning ───────────────────────────────

Deno.test("GR-38: buildSnapchatReviewDetail persists BOTH vocabularies + reasons + delivery_status", () => {
  const detail = buildSnapchatReviewDetail({
    issuesInfo: ["DISALLOWED_CONTENT"],
    adReviewFeedback: {
      review_status: "REJECTED",
      creative_review_status: "PENDING_REVIEW",
      delivery_status: ["INVALID"],
    },
  });
  assertEquals(detail, {
    review_status: "REJECTED",
    creative_review_status: "PENDING_REVIEW",
    delivery_status: ["INVALID"],
    review_status_reasons: ["DISALLOWED_CONTENT"],
  });
  assertEquals(buildSnapchatReviewDetail({ issuesInfo: null, adReviewFeedback: null }), null);
});

Deno.test("AC-S-5: the launch warning keys off BOTH vocabularies — ad PENDING, creative PENDING_REVIEW, and REJECTED all warn; approved is silent", () => {
  assert(snapchatLaunchWarning("PENDING", null) !== null);
  assert(snapchatLaunchWarning(null, "PENDING_REVIEW") !== null, "the CREATIVE vocabulary alone must trigger the warning");
  assert(snapchatLaunchWarning("REJECTED", "APPROVED")?.includes("REJECTED"));
  assertEquals(snapchatLaunchWarning("APPROVED", "APPROVED"), null);
});

// ── Pixel gating (A1.1(6)/AC-S-13 wire-shape half) ────────────────────────────

Deno.test("A1.1(6): a pixel-gated goal without pixel_id throws pixel_goal_unavailable; with it, pixel_id rides the squad", () => {
  assert(SNAPCHAT_PIXEL_GATED_GOALS.includes("LANDING_PAGE_VIEW"));
  const err = assertThrows(
    () =>
      buildSnapchatAdSquadBody(CAMPAIGN_ID, {
        name: "squad",
        optimizationGoal: "LANDING_PAGE_VIEW",
        countries: ["US"],
        budgetCents: 500,
      }),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "pixel_goal_unavailable");
  const withPixel = buildSnapchatAdSquadBody(CAMPAIGN_ID, {
    name: "squad",
    optimizationGoal: "LANDING_PAGE_VIEW",
    countries: ["US"],
    budgetCents: 500,
    pixelId: "af5f8fc4-1ef6-41e7-81c5-042b7be7df38",
  });
  assertEquals(withPixel.pixel_id, "af5f8fc4-1ef6-41e7-81c5-042b7be7df38");
  const swipes = buildSnapchatAdSquadBody(CAMPAIGN_ID, {
    name: "squad",
    optimizationGoal: "SWIPES",
    countries: ["US"],
    budgetCents: 500,
    pixelId: "af5f8fc4-1ef6-41e7-81c5-042b7be7df38",
  });
  assert(!("pixel_id" in swipes), "SWIPES never carries pixel_id");
});

// ── Mint cache + fail-close (AC-S-8 / RT-1) ───────────────────────────────────

Deno.test(
  "AC-S-8: mint cache — two resolves within the window → ONE token HTTP call; reset → re-mint",
  withSnapEnvSet(async () => {
    const originalFetch = globalThis.fetch;
    let mintCalls = 0;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("accounts.snapchat.com")) {
        mintCalls += 1;
        return Promise.resolve(mintResponse());
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as typeof fetch;
    try {
      const env = resolveSnapchatEnvConfig(makeConn());
      const first = await mintSnapchatAccessToken(env);
      const second = await mintSnapchatAccessToken(env);
      assertEquals(first, second);
      assertEquals(mintCalls, 1, "the cached token must be reused within its ~60-min window");
      resetSnapchatTokenCacheForTests();
      await mintSnapchatAccessToken(env);
      assertEquals(mintCalls, 2, "a cleared cache must re-mint");
    } finally {
      globalThis.fetch = originalFetch;
      resetSnapchatTokenCacheForTests();
    }
  }),
);

Deno.test(
  "AC-S-8: a mint 4xx (revoked refresh token) fails CLOSE — never a stale/empty token",
  withSnapEnvSet(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      )) as typeof fetch;
    try {
      const env = resolveSnapchatEnvConfig(makeConn());
      await assertRejects(() => mintSnapchatAccessToken(env), AdNotConnectedError);
    } finally {
      globalThis.fetch = originalFetch;
      resetSnapchatTokenCacheForTests();
    }
  }),
);

Deno.test(
  "RT-1/AC-S-7: with the SNAPCHAT_* secrets unset every adapter surface fail-closes with AdNotConnectedError and ZERO network calls",
  withSnapEnvCleared(async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.reject(new Error("no network allowed"));
    }) as typeof fetch;
    try {
      const adapter = getAdapter("snapchat");
      assertEquals(adapter.platform, "snapchat");
      const conn = makeConn();
      await assertRejects(() => adapter.connect(conn), AdNotConnectedError);
      await assertRejects(
        () => adapter.createCampaign(conn, { name: "c", objective: "TRAFFIC" }),
        AdNotConnectedError,
      );
      await assertRejects(
        () =>
          adapter.createAdSet(conn, CAMPAIGN_ID, {
            name: "s",
            optimizationGoal: "SWIPES",
            billingEvent: "IMPRESSION",
            targeting: { countries: ["US"] },
          }),
        AdNotConnectedError,
      );
      await assertRejects(
        () =>
          adapter.createAd(conn, CAMPAIGN_ID, { name: "a", externalCreativeId: CREATIVE_ID }),
        AdNotConnectedError,
      );
      await assertRejects(
        () => adapter.setStatus(conn, "campaign", CAMPAIGN_ID, "ACTIVE"),
        AdNotConnectedError,
      );
      await assertRejects(
        () => adapter.getStatus(conn, "campaign", CAMPAIGN_ID),
        AdNotConnectedError,
      );
      await assertRejects(
        () => adapter.setBudget(conn, "campaign", CAMPAIGN_ID, 2_000),
        AdNotConnectedError,
      );
      assertEquals(calls, 0, "fail-close means ZERO Marketing-API calls (AC-S-7)");
    } finally {
      globalThis.fetch = originalFetch;
    }
  }),
);

// ── Snap has NO validate-only (WP2 §10) ───────────────────────────────────────

Deno.test(
  "snapchat_no_validate_only: createX with validateOnly:true refuses loudly — a 'validation' can never create a real object",
  withSnapEnvSet(async () => {
    const originalFetch = globalThis.fetch;
    let apiCalls = 0;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("accounts.snapchat.com")) return Promise.resolve(mintResponse());
      apiCalls += 1;
      return Promise.reject(new Error(`unexpected API call: ${url}`));
    }) as typeof fetch;
    try {
      const adapter = getAdapter("snapchat");
      const conn = makeConn();
      const campaignErr = await assertRejects(
        () =>
          adapter.createCampaign(conn, { name: "c", objective: "TRAFFIC", validateOnly: true }),
        AdApiError,
      );
      assertEquals((campaignErr as AdApiError).code, "snapchat_no_validate_only");
      assert(adapter.createCreative, "the snapchat adapter must expose createCreative");
      const creativeErr = await assertRejects(
        () =>
          adapter.createCreative!(conn, {
            destUrl: "https://usemingla.com/e/a/b",
            message: "m",
            validateOnly: true,
          }),
        AdApiError,
      );
      assertEquals((creativeErr as AdApiError).code, "snapchat_no_validate_only");
      assertEquals(apiCalls, 0, "zero Marketing-API calls during a validate pass — WP2 §10");
    } finally {
      globalThis.fetch = originalFetch;
      resetSnapchatTokenCacheForTests();
    }
  }),
);

// ── Registry + misc ───────────────────────────────────────────────────────────

Deno.test("registry: getAdapter('snapchat') is the LIVE adapter with rollback hooks (the last stub is gone)", () => {
  const adapter = getAdapter("snapchat");
  assertEquals(adapter.platform, "snapchat");
  assert(typeof adapter.createCreative === "function", "media-backed creative step must exist");
  assert(typeof adapter.rollbackCampaign === "function", "compensating campaign delete (§4.4b)");
  assert(
    typeof adapter.rollbackCreative === "function",
    "GR-48: campaign delete does NOT cascade the ad-account-scoped creative",
  );
});

Deno.test("scrubbing: the minted token never survives into provider text", () => {
  const scrubbed = scrubSnapchatSecrets(
    "failed with Authorization: Bearer abc.def-ghi and token xyz-token-123",
    "xyz-token-123",
  );
  assert(!scrubbed.includes("xyz-token-123"));
  assert(!scrubbed.includes("abc.def-ghi"));
});
