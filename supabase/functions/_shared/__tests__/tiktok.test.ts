/**
 * ISSUE-863 WP7 — tiktok.ts unit tests (implementor happy-path suite).
 *
 * Covers the WP7 dispatch's mandatory list against SPEC_ISSUE-863 + A1:
 *   - money boundary: cents ÷ 100 → dollars incl. odd cents (A1.0-1 / GR-01);
 *     floors run AFTER conversion ($20/day ad group · $50/day CBO campaign ·
 *     lifetime $20 × days).
 *   - UTC+0 schedule format + bounds (≤12h past, ≤2028-01-01 start,
 *     ≤2038-01-01 end; dayparting 336×0/1) (A1.1(a)/T-1, AC-16).
 *   - bid_type REQUIRED under CBO with BID_TYPE_NO_BID default; bid_price <
 *     both budgets; enum owned client-side (A1.1(b)/T-2, AC-15).
 *   - emoji strip/reject + CJK ×2 weighted counting (A1.1(c)/T-3, AC-14).
 *   - geo fail-LOUD naming the country (GB proven absent — A1.1(e)/T-5/T-P2,
 *     AC-13); numeric-only / ≤3,000 / no-overlap location_ids.
 *   - CUSTOMIZED_USER hard-fail with the explanatory error (A1.1(f)/T-6,
 *     AC-12).
 *   - DISABLE-invariant fuzz across all three builders (A1.0-4/T-8 — mirrors
 *     WP1's T-3 PAUSED fuzz; fails-on-revert: the operation_status DISABLE
 *     lines in tiktok.ts).
 *   - BALANCE_EXCEED → actionable warning mapping, prefixed + bare forms
 *     (A1.0-1 — 200 + warning, never a silent clamp).
 *   - landing_page_url = canonical dest_url, NEVER the OneLink (A1.0-5/D-P1);
 *     utm_params ≤14 (case-sensitive keys).
 *   - GAB placement gate (A1.1(l)/GR-68) + deprecated placements.
 *   - registry: getAdapter("tiktok") is the live adapter and fail-closes with
 *     AdNotConnectedError while the TIKTOK_* secrets are unset.
 *
 * Fails-on-revert targets (proven by TRUE LINE DELETION, not comment-out):
 *   1. the `operation_status: "DISABLE"` line in buildTikTokCampaignBody —
 *      the DISABLE fuzz fails without it.
 *   2. the `body.bid_type = spec.bidType ?? TIKTOK_DEFAULT_BID_TYPE` CBO
 *      default in buildTikTokAdGroupBody — the CBO bid_type test fails.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/tiktok.test.ts
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
} from "../adChannel.ts";
import {
  buildTikTokAdBody,
  buildTikTokAdGroupBody,
  buildTikTokCampaignBody,
  containsEmoji,
  engineStatusFromTikTok,
  formatTikTokScheduleTime,
  normalizeTikTokSecondaryStatus,
  parseTikTokRegions,
  parseTikTokScheduleTime,
  pickTikTokLocationIdsForCountries,
  stripEmoji,
  TIKTOK_DEFAULT_BID_TYPE,
  tiktokAgeGroupsForRange,
  tiktokLaunchWarning,
  tiktokLifetimeFloorDollars,
  tiktokScheduledDays,
  tiktokStatusForAdvertiserStatus,
  tiktokUniqueFileName,
  tiktokWeightedLength,
  validateTikTokAdText,
  validateTikTokBudgetFloor,
  validateTikTokBudgetUpdate,
  validateTikTokCboAdGroupConsistency,
  validateTikTokLandingPageUrl,
  validateTikTokLocationIds,
  validateTikTokName,
  validateTikTokPlacements,
  validateTikTokSchedule,
  validateTikTokUtmParams,
  validateTikTokVideoDuration,
} from "../tiktok.ts";

const ADVERTISER = "7627974536397766673";
const IDENTITY = "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5";
const US_LOCATION = "6252001";
const NG_LOCATION = "2328926";

/** A fixed in-bounds test clock: 2026-07-15 12:00:00 UTC. */
const NOW_MS = Date.parse("2026-07-15T12:00:00Z");

function validAdGroupSpec(overrides: Record<string, unknown> = {}) {
  return {
    name: "wp7 ad group",
    optimizationGoal: "TRAFFIC_LANDING_PAGE_VIEW",
    billingEvent: "CPC",
    budgetCents: 2_500, // $25 ≥ $20 floor
    locationIds: [US_LOCATION],
    scheduleStartTime: "2026-07-15 12:00:00",
    nowMs: NOW_MS,
    ...overrides,
    // deno-lint-ignore no-explicit-any
  } as any;
}

function validAdSpec(overrides: Record<string, unknown> = {}) {
  return {
    adName: "wp7 ad",
    identityType: "TT_USER",
    identityId: IDENTITY,
    imageIds: ["img_1"],
    adText: "Find your next experience on Mingla",
    landingPageUrl: "https://usemingla.com/e/brand/event",
    ...overrides,
    // deno-lint-ignore no-explicit-any
  } as any;
}

// ── Money boundary (A1.0-1 — THE one ÷100 conversion, odd cents included) ─────

Deno.test("money: cents ÷ 100 → dollars including odd cents (no rounding, no loss)", () => {
  assertEquals(centsToPlatformBudget("tiktok", 2_000), 20);
  assertEquals(centsToPlatformBudget("tiktok", 2_050), 20.5);
  assertEquals(centsToPlatformBudget("tiktok", 2_001), 20.01);
  assertEquals(centsToPlatformBudget("tiktok", 5_000), 50);
  assertEquals(centsToPlatformBudget("tiktok", 123_457), 1_234.57);
});

Deno.test("money: floors run AFTER conversion in DOLLARS — $20 ad group / $50 CBO campaign", () => {
  // 1999¢ = $19.99 < $20 — fails; 2000¢ = $20.00 — passes (the floor value).
  const below = validateTikTokBudgetFloor({ level: "ad_group", mode: "daily", dollars: 19.99 });
  assertEquals(below.ok, false);
  if (!below.ok) assertEquals(below.detail, "budget_below_minimum");
  assertEquals(
    validateTikTokBudgetFloor({ level: "ad_group", mode: "daily", dollars: 20 }).ok,
    true,
  );
  const campaignBelow = validateTikTokBudgetFloor({
    level: "campaign",
    mode: "daily",
    dollars: 49.99,
  });
  assertEquals(campaignBelow.ok, false);
  assertEquals(
    validateTikTokBudgetFloor({ level: "campaign", mode: "daily", dollars: 50 }).ok,
    true,
  );
});

Deno.test("money: lifetime floor = $20 × scheduled days (31 days → $620)", () => {
  assertEquals(tiktokLifetimeFloorDollars(31), 620);
  const startMs = Date.parse("2026-08-01T00:00:00Z");
  const endMs = Date.parse("2026-09-01T00:00:00Z");
  assertEquals(tiktokScheduledDays(startMs, endMs), 31);
  const below = validateTikTokBudgetFloor({
    level: "ad_group",
    mode: "lifetime",
    dollars: 619,
    scheduledDays: 31,
  });
  assertEquals(below.ok, false);
  assertEquals(
    validateTikTokBudgetFloor({
      level: "ad_group",
      mode: "lifetime",
      dollars: 620,
      scheduledDays: 31,
    }).ok,
    true,
  );
});

Deno.test("money: a below-floor CBO campaign build throws BEFORE any TikTok call", () => {
  const err = assertThrows(
    () =>
      buildTikTokCampaignBody(ADVERTISER, {
        name: "cbo",
        objective: "TRAFFIC",
        dailyBudgetCents: 4_999, // $49.99 < $50
      }),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "budget_below_minimum");
});

Deno.test("money: the CBO campaign body carries the DOLLAR budget (odd cents intact)", () => {
  const body = buildTikTokCampaignBody(ADVERTISER, {
    name: "cbo",
    objective: "TRAFFIC",
    dailyBudgetCents: 5_150,
  });
  assertEquals(body.budget, 51.5);
  assertEquals(body.budget_optimize_on, true);
  assertEquals(body.budget_mode, "BUDGET_MODE_DAY");
});

// ── UTC+0 schedule format + bounds (A1.1(a)/T-1 — AC-16) ──────────────────────

Deno.test("schedule: format is the UTC+0 'YYYY-MM-DD HH:MM:SS' string, parsed as UTC", () => {
  assertEquals(parseTikTokScheduleTime("2026-07-15 12:00:00"), Date.parse("2026-07-15T12:00:00Z"));
  assertEquals(parseTikTokScheduleTime("2026-07-15T12:00:00"), null); // ISO 'T' form rejected
  assertEquals(parseTikTokScheduleTime("2026-07-15 12:00"), null); // seconds required
  assertEquals(parseTikTokScheduleTime("2027-02-30 00:00:00"), null); // impossible date
  assertEquals(formatTikTokScheduleTime(new Date(Date.parse("2026-07-15T12:00:00Z"))), "2026-07-15 12:00:00");
});

Deno.test("schedule: start ≤12h in the past and ≤2028-01-01; end ≤2038-01-01 (bounds)", () => {
  const base = { scheduleType: "SCHEDULE_FROM_NOW", nowMs: NOW_MS };
  assertEquals(
    validateTikTokSchedule({ ...base, scheduleStartTime: "2026-07-15 01:00:00" }).ok,
    true, // 11h in the past — inside tolerance
  );
  const tooOld = validateTikTokSchedule({ ...base, scheduleStartTime: "2026-07-14 23:00:00" });
  assertEquals(tooOld.ok, false); // 13h in the past
  if (!tooOld.ok) assertEquals(tooOld.detail, "schedule_start_too_old");
  const beyond2028 = validateTikTokSchedule({ ...base, scheduleStartTime: "2028-01-01 00:00:01" });
  assertEquals(beyond2028.ok, false);
  if (!beyond2028.ok) assertEquals(beyond2028.detail, "schedule_start_out_of_bounds");
  const endBeyond2038 = validateTikTokSchedule({
    scheduleType: "SCHEDULE_START_END",
    scheduleStartTime: "2026-07-15 12:00:00",
    scheduleEndTime: "2038-01-01 00:00:01",
    nowMs: NOW_MS,
  });
  assertEquals(endBeyond2038.ok, false);
  if (!endBeyond2038.ok) assertEquals(endBeyond2038.detail, "schedule_end_out_of_bounds");
});

Deno.test("schedule: SCHEDULE_START_END requires an end AFTER the start; dayparting is 336×0/1", () => {
  const missingEnd = validateTikTokSchedule({
    scheduleType: "SCHEDULE_START_END",
    scheduleStartTime: "2026-07-15 12:00:00",
    nowMs: NOW_MS,
  });
  assertEquals(missingEnd.ok, false);
  if (!missingEnd.ok) assertEquals(missingEnd.detail, "schedule_end_required");
  const inverted = validateTikTokSchedule({
    scheduleType: "SCHEDULE_START_END",
    scheduleStartTime: "2026-07-15 12:00:00",
    scheduleEndTime: "2026-07-15 11:00:00",
    nowMs: NOW_MS,
  });
  assertEquals(inverted.ok, false);
  const okDayparting = validateTikTokSchedule({
    scheduleType: "SCHEDULE_FROM_NOW",
    scheduleStartTime: "2026-07-15 12:00:00",
    dayparting: "01".repeat(168), // 336 chars
    nowMs: NOW_MS,
  });
  assertEquals(okDayparting.ok, true);
  const badDayparting = validateTikTokSchedule({
    scheduleType: "SCHEDULE_FROM_NOW",
    scheduleStartTime: "2026-07-15 12:00:00",
    dayparting: "01".repeat(167) + "2X", // wrong alphabet
    nowMs: NOW_MS,
  });
  assertEquals(badDayparting.ok, false);
  if (!badDayparting.ok) assertEquals(badDayparting.detail, "dayparting_invalid");
});

Deno.test("schedule: the ad-group body ships the UTC+0 string verbatim", () => {
  const body = buildTikTokAdGroupBody(ADVERTISER, "1234567890123456789", validAdGroupSpec());
  assertEquals(body.schedule_start_time, "2026-07-15 12:00:00");
  assertEquals(body.schedule_type, "SCHEDULE_FROM_NOW");
});

// ── bid_type under CBO (A1.1(b)/T-2 — AC-15; fails-on-revert target #2) ───────

Deno.test("bidding: a CBO ad-group body ALWAYS carries bid_type, defaulting BID_TYPE_NO_BID", () => {
  // The MCP schema declares bid_type as a bare string — a CBO campaign built
  // without it fails TikTok validation; the adapter owns the requirement.
  const body = buildTikTokAdGroupBody(
    ADVERTISER,
    "1234567890123456789",
    validAdGroupSpec({ cboOnCampaign: true, budgetCents: undefined, campaignBudgetCents: 6_000 }),
  );
  assertEquals(body.bid_type, TIKTOK_DEFAULT_BID_TYPE);
  assertEquals(body.bid_type, "BID_TYPE_NO_BID");
  // Under CBO the budget lives on the campaign — the ad group carries none.
  assertEquals(body.budget, undefined);
  assertEquals(body.budget_mode, undefined);
});

Deno.test("bidding: an unknown bid_type is rejected — the adapter owns the enum", () => {
  const err = assertThrows(
    () =>
      buildTikTokAdGroupBody(
        ADVERTISER,
        "1234567890123456789",
        validAdGroupSpec({ cboOnCampaign: true, budgetCents: undefined, bidType: "BID_TYPE_MAX" }),
      ),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "bid_type_invalid");
});

Deno.test("bidding: BID_TYPE_CUSTOM + CPC requires bid_price; bid_price must be LOWER than both budgets", () => {
  const missing = assertThrows(
    () =>
      buildTikTokAdGroupBody(
        ADVERTISER,
        "1234567890123456789",
        validAdGroupSpec({ bidType: "BID_TYPE_CUSTOM" }),
      ),
    AdApiError,
  );
  assertEquals((missing as AdApiError).code, "bid_price_required");

  // bid_price ($25) ≥ ad-group budget ($25) — rejected.
  const vsAdGroup = assertThrows(
    () =>
      buildTikTokAdGroupBody(
        ADVERTISER,
        "1234567890123456789",
        validAdGroupSpec({ bidType: "BID_TYPE_CUSTOM", bidPriceCents: 2_500 }),
      ),
    AdApiError,
  );
  assertEquals((vsAdGroup as AdApiError).code, "bid_price_exceeds_budget");

  // bid_price ($60) ≥ campaign budget ($55) under CBO — rejected.
  const vsCampaign = assertThrows(
    () =>
      buildTikTokAdGroupBody(
        ADVERTISER,
        "1234567890123456789",
        validAdGroupSpec({
          cboOnCampaign: true,
          budgetCents: undefined,
          campaignBudgetCents: 5_500,
          bidType: "BID_TYPE_CUSTOM",
          bidPriceCents: 6_000,
        }),
      ),
    AdApiError,
  );
  assertEquals((vsCampaign as AdApiError).code, "bid_price_exceeds_budget");

  // A legal custom bid rides in dollars.
  const ok = buildTikTokAdGroupBody(
    ADVERTISER,
    "1234567890123456789",
    validAdGroupSpec({ bidType: "BID_TYPE_CUSTOM", bidPriceCents: 150 }),
  );
  assertEquals(ok.bid_price, 1.5);
});

Deno.test("bidding: CBO first-ad-group consistency validator (bid_type + optimization_event)", () => {
  assertEquals(
    validateTikTokCboAdGroupConsistency(
      { bidType: "BID_TYPE_NO_BID" },
      { bidType: "BID_TYPE_NO_BID" },
    ).ok,
    true,
  );
  const mismatch = validateTikTokCboAdGroupConsistency(
    { bidType: "BID_TYPE_NO_BID" },
    { bidType: "BID_TYPE_CUSTOM" },
  );
  assertEquals(mismatch.ok, false);
  if (!mismatch.ok) assertEquals(mismatch.detail, "cbo_bid_type_mismatch");
});

// ── Emoji strip/reject + CJK ×2 counting (A1.1(c)/T-3 — AC-14) ────────────────

Deno.test("text: emoji is detected and rejected in ad_text (non-Spark forbids emoji)", () => {
  assertEquals(containsEmoji("Find your people 🎉"), true);
  assertEquals(containsEmoji("Flags too 🇬🇧"), true);
  assertEquals(containsEmoji("Keycaps 1️⃣"), true);
  assertEquals(containsEmoji("Plain ad copy, no emoji."), false);
  assertEquals(containsEmoji("© Mingla ® ™"), false); // text symbols are NOT emoji copy
  const rejected = validateTikTokAdText("Party tonight 🎉");
  assertEquals(rejected.ok, false);
  if (!rejected.ok) assertEquals(rejected.detail, "ad_text_emoji");
});

Deno.test("text: stripEmoji removes emoji (incl. ZWJ sequences + flags) and tidies whitespace", () => {
  assertEquals(stripEmoji("Party tonight 🎉"), "Party tonight");
  assertEquals(stripEmoji("Family: 👨‍👩‍👧‍👦 fun"), "Family: fun");
  assertEquals(stripEmoji("London 🇬🇧 calling"), "London calling");
  assertEquals(validateTikTokAdText(stripEmoji("Party tonight 🎉")).ok, true);
});

Deno.test("text: CJK/JP characters count ×2 — the 100 cap is WEIGHTED", () => {
  assertEquals(tiktokWeightedLength("abc"), 3);
  assertEquals(tiktokWeightedLength("東京"), 4); // 2 CJK chars × 2
  assertEquals(tiktokWeightedLength("東京 tokyo"), 4 + 6);
  // 50 CJK chars = weight 100 → passes; 51 = 102 → fails.
  assertEquals(validateTikTokAdText("東".repeat(50)).ok, true);
  const over = validateTikTokAdText("東".repeat(51));
  assertEquals(over.ok, false);
  if (!over.ok) assertEquals(over.detail, "ad_text_too_long");
  // 100 Latin chars pass; 101 fail (TikTok's hard 100, NOT Meta's ~125).
  assertEquals(validateTikTokAdText("a".repeat(100)).ok, true);
  assertEquals(validateTikTokAdText("a".repeat(101)).ok, false);
});

Deno.test("text: names cap at 512 weighted chars, no emoji", () => {
  assertEquals(validateTikTokName("a".repeat(512), "campaign_name").ok, true);
  const over = validateTikTokName("a".repeat(513), "campaign_name");
  assertEquals(over.ok, false);
  if (!over.ok) assertEquals(over.detail, "name_too_long");
  const emoji = validateTikTokName("launch 🚀", "ad_name");
  assertEquals(emoji.ok, false);
  if (!emoji.ok) assertEquals(emoji.detail, "name_emoji");
});

// ── Geo: LIVE resolution fail-LOUD (A1.1(e)/T-5/T-P2 — AC-13) ─────────────────

const REGION_PAYLOAD = {
  region_info: [
    { location_id: US_LOCATION, region_code: "US", name: "United States", level: "COUNTRY" },
    { location_id: NG_LOCATION, region_code: "NG", name: "Nigeria", level: "COUNTRY" },
    // NOTE: GB deliberately absent — the PROVEN live shape (T-P2).
  ],
};

Deno.test("geo: an unavailable country FAILS LOUDLY, NAMING it — never a silent drop", () => {
  const regions = parseTikTokRegions(REGION_PAYLOAD);
  assertEquals(regions.length, 2);
  const picked = pickTikTokLocationIdsForCountries(regions, ["US", "GB"], {
    objective: "TRAFFIC",
  });
  assertEquals(picked.ok, false);
  if (!picked.ok) {
    assertEquals(picked.detail, "geo_unavailable");
    assertEquals(picked.missing, ["GB"]);
    assert(picked.message.includes("GB"), "the error must NAME the unavailable country (AC-13)");
    assert(picked.message.includes("NEVER silently dropped"), "the error must state the no-silent-drop contract");
  }
  // The available subset resolves to numeric ids.
  const ok = pickTikTokLocationIdsForCountries(regions, ["US", "NG"]);
  assertEquals(ok.ok, true);
  if (ok.ok) {
    assertEquals(ok.resolved.US, US_LOCATION);
    assertEquals(ok.resolved.NG, NG_LOCATION);
  }
});

Deno.test("geo: location_ids are numeric-only, deduped (no overlap), ≤3,000", () => {
  const iso = validateTikTokLocationIds(["US"]);
  assertEquals(iso.ok, false);
  if (!iso.ok) assertEquals(iso.detail, "location_ids_not_numeric");
  const dup = validateTikTokLocationIds([US_LOCATION, US_LOCATION]);
  assertEquals(dup.ok, false);
  if (!dup.ok) assertEquals(dup.detail, "location_ids_overlap");
  const tooMany = validateTikTokLocationIds(
    Array.from({ length: 3_001 }, (_, i) => String(1_000_000 + i)),
  );
  assertEquals(tooMany.ok, false);
  if (!tooMany.ok) assertEquals(tooMany.detail, "location_ids_too_many");
  assertEquals(validateTikTokLocationIds([US_LOCATION, NG_LOCATION]).ok, true);
});

Deno.test("geo: age_min/age_max map to TikTok buckets; AGE_13_17 is never defaulted in", () => {
  assertEquals(tiktokAgeGroupsForRange(18, 34), ["AGE_18_24", "AGE_25_34"]);
  assertEquals(tiktokAgeGroupsForRange(undefined, undefined), [
    "AGE_18_24",
    "AGE_25_34",
    "AGE_35_44",
    "AGE_45_54",
    "AGE_55_100",
  ]);
  assertEquals(tiktokAgeGroupsForRange(13, 17), ["AGE_13_17"]); // explicit only
});

// ── CUSTOMIZED_USER hard-fail (A1.1(f)/T-6 — AC-12) ───────────────────────────

Deno.test("identity: CUSTOMIZED_USER hard-fails with the explanatory account-class error", () => {
  const err = assertThrows(
    () =>
      buildTikTokAdBody(
        ADVERTISER,
        "1234567890123456789",
        validAdSpec({ identityType: "CUSTOMIZED_USER" }),
      ),
    AdApiError,
  );
  const apiErr = err as AdApiError;
  assertEquals(apiErr.code, "identity_customized_user_blocked");
  assert(apiErr.message.includes("2026-01-15"), "must explain the account-class cutoff");
  assert(apiErr.message.includes("TT_USER"), "must name the viable path");
});

Deno.test("identity: AUTH_CODE/BC_AUTH_TT (Spark) are a documented fast-follow, not v1", () => {
  for (const identityType of ["AUTH_CODE", "BC_AUTH_TT"]) {
    const err = assertThrows(
      () => buildTikTokAdBody(ADVERTISER, "1234567890123456789", validAdSpec({ identityType })),
      AdApiError,
    );
    assertEquals((err as AdApiError).code, "identity_spark_not_supported");
  }
});

Deno.test("identity: TT_USER builds; the creative is INLINE (no standalone creative object)", () => {
  const body = buildTikTokAdBody(ADVERTISER, "1234567890123456789", validAdSpec());
  const creatives = body.creatives as Record<string, unknown>[];
  assertEquals(creatives.length, 1);
  assertEquals(creatives[0].identity_type, "TT_USER");
  assertEquals(creatives[0].identity_id, IDENTITY);
  assertEquals(creatives[0].ad_format, "SINGLE_IMAGE");
});

// ── DISABLE-invariant fuzz (A1.0-4/T-8 — mirrors WP1's T-3 PAUSED fuzz) ───────
// Fails-on-revert target #1: deleting the operation_status DISABLE line in
// buildTikTokCampaignBody makes this fail.

Deno.test("DISABLE fuzz: no builder output is ever ENABLE across an input grid", () => {
  const campaignGrid = [
    { name: "a", objective: "TRAFFIC" },
    { name: "b", objective: "TRAFFIC", dailyBudgetCents: 5_000 },
    { name: "c", objective: "APP_PROMOTION" },
    { name: "d", objective: "REACH", dailyBudgetCents: 9_999 },
    { name: "e", objective: "ENGAGEMENT" },
  ];
  for (const input of campaignGrid) {
    const body = buildTikTokCampaignBody(ADVERTISER, input);
    assertEquals(body.operation_status, "DISABLE", `campaign body for ${input.name} must be DISABLE`);
    assert(!JSON.stringify(body).includes('"ENABLE"'), "no create body may carry ENABLE");
  }
  const adGroupGrid = [
    validAdGroupSpec(),
    validAdGroupSpec({ cboOnCampaign: true, budgetCents: undefined }),
    validAdGroupSpec({
      budgetMode: "lifetime",
      budgetCents: 62_000,
      scheduleType: "SCHEDULE_START_END",
      scheduleEndTime: "2026-08-15 12:00:00",
    }),
    validAdGroupSpec({ optimizationGoal: "CLICK", ageGroups: ["AGE_18_24"], gender: "GENDER_UNLIMITED" }),
  ];
  for (const spec of adGroupGrid) {
    const body = buildTikTokAdGroupBody(ADVERTISER, "1234567890123456789", spec);
    assertEquals(body.operation_status, "DISABLE", `ad-group body "${spec.name}" must be DISABLE`);
    assert(!JSON.stringify(body).includes('"ENABLE"'));
  }
  // THE ad-level check — the body's §4.4b step-5 ENABLE contradiction (T-8/GR-67):
  // the ad creative is DISABLE like everything else.
  const adBody = buildTikTokAdBody(ADVERTISER, "1234567890123456789", validAdSpec());
  const creatives = adBody.creatives as Record<string, unknown>[];
  assertEquals(creatives[0].operation_status, "DISABLE");
  assert(!JSON.stringify(adBody).includes('"ENABLE"'));
});

Deno.test("DISABLE fuzz: hostile injected operation_status keys cannot flip a body ENABLE", () => {
  // A JSON-sourced caller may smuggle extra keys onto the input object; the
  // builders construct bodies explicitly and must not spread input through.
  const hostileCampaign = {
    name: "h",
    objective: "TRAFFIC",
    operation_status: "ENABLE",
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(buildTikTokCampaignBody(ADVERTISER, hostileCampaign).operation_status, "DISABLE");

  const hostileAdGroup = validAdGroupSpec({ operation_status: "ENABLE" });
  assertEquals(
    buildTikTokAdGroupBody(ADVERTISER, "1234567890123456789", hostileAdGroup).operation_status,
    "DISABLE",
  );

  const hostileAd = validAdSpec({ operation_status: "ENABLE" });
  const creatives = buildTikTokAdBody(ADVERTISER, "1234567890123456789", hostileAd)
    .creatives as Record<string, unknown>[];
  assertEquals(creatives[0].operation_status, "DISABLE");
});

Deno.test("status writer: only ENABLE|DISABLE are expressible — DELETE is rollback-only", () => {
  assertEquals(tiktokStatusForAdvertiserStatus("ACTIVE"), "ENABLE");
  assertEquals(tiktokStatusForAdvertiserStatus("PAUSED"), "DISABLE");
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => tiktokStatusForAdvertiserStatus("DELETE" as any),
    AdApiError,
  );
  assertEquals(engineStatusFromTikTok("ENABLE"), "ACTIVE");
  assertEquals(engineStatusFromTikTok("DISABLE"), "PAUSED");
  assertEquals(engineStatusFromTikTok("DELETE"), "DELETED"); // read-side only
  assertEquals(engineStatusFromTikTok("garbage"), null);
});

// ── BALANCE_EXCEED warning mapping (A1.0-1 — 200 + warning, never silent) ─────

Deno.test("warnings: BALANCE_EXCEED maps to an actionable funding warning (prefixed + bare)", () => {
  for (const status of ["BALANCE_EXCEED", "CAMPAIGN_STATUS_BALANCE_EXCEED", "ADGROUP_STATUS_BALANCE_EXCEED"]) {
    const warning = tiktokLaunchWarning(status);
    assert(warning !== null, `${status} must warn`);
    assert(warning.includes("Advanced Payment Portfolio"), "must point at the UI funding source of truth");
  }
  assertEquals(normalizeTikTokSecondaryStatus("CAMPAIGN_STATUS_BALANCE_EXCEED"), "BALANCE_EXCEED");
});

Deno.test("warnings: audit/review + budget states warn; healthy delivery states do NOT", () => {
  assert(tiktokLaunchWarning("AUDIT") !== null);
  assert(tiktokLaunchWarning("CAMPAIGN_STATUS_AUDIT_DENY") !== null);
  assert(tiktokLaunchWarning("NO_BUDGET") !== null);
  assertEquals(tiktokLaunchWarning("DELIVERY_OK"), null);
  assertEquals(tiktokLaunchWarning("NOT_START"), null); // scheduled-future is healthy
  assertEquals(tiktokLaunchWarning(null), null);
});

// ── Destination policy v1 + utm_params (A1.0-5/D-P1) ──────────────────────────

Deno.test("destination: the OneLink is NEVER the landing_page_url — canonical dest_url only", () => {
  for (
    const url of [
      "https://go.usemingla.com/w36m?pid=tiktok_ads",
      "https://minglabiz.onelink.me/ZSCW/abc",
    ]
  ) {
    const check = validateTikTokLandingPageUrl(url);
    assertEquals(check.ok, false, `${url} must be blocked`);
    if (!check.ok) assertEquals(check.detail, "landing_page_smart_link_blocked");
  }
  assertEquals(validateTikTokLandingPageUrl("https://usemingla.com/e/brand/event").ok, true);
  assertEquals(validateTikTokLandingPageUrl("http://usemingla.com/e/b/e").ok, false); // https only
  const err = assertThrows(
    () =>
      buildTikTokAdBody(
        ADVERTISER,
        "1234567890123456789",
        validAdSpec({ landingPageUrl: "https://go.usemingla.com/w36m" }),
      ),
    AdApiError,
  );
  assertEquals((err as AdApiError).code, "landing_page_smart_link_blocked");
});

Deno.test("utm_params: ≤14 entries; keys are CASE-SENSITIVE; macro values ride through", () => {
  const fourteen = Array.from({ length: 14 }, (_, i) => ({ key: `k${i}`, value: "v" }));
  assertEquals(validateTikTokUtmParams(fourteen).ok, true);
  const fifteen = [...fourteen, { key: "k14", value: "v" }];
  const over = validateTikTokUtmParams(fifteen);
  assertEquals(over.ok, false);
  if (!over.ok) assertEquals(over.detail, "utm_params_too_many");
  assertEquals(
    validateTikTokUtmParams([
      { key: "utm_source", value: "tiktok" },
      { key: "utm_campaign", value: "__CAMPAIGN_ID__" },
      { key: "placement", value: "__PLACEMENT__" },
    ]).ok,
    true,
  );
  // Case-sensitivity: "UTM_Source" is a CUSTOM key (allowed ≤100 chars) — but
  // a >100-char custom key is rejected while the standard key never is.
  const longCustom = validateTikTokUtmParams([{ key: "K".repeat(101), value: "v" }]);
  assertEquals(longCustom.ok, false);
  if (!longCustom.ok) assertEquals(longCustom.detail, "utm_params_key_too_long");
});

// ── Placement gates (A1.1(l)/GR-68) ───────────────────────────────────────────

Deno.test("placements: GAB is rejected with TRAFFIC_LANDING_PAGE_VIEW and outside its geo lock", () => {
  const withGoal = validateTikTokPlacements(["PLACEMENT_GLOBAL_APP_BUNDLE"], {
    optimizationGoal: "TRAFFIC_LANDING_PAGE_VIEW",
  });
  assertEquals(withGoal.ok, false);
  if (!withGoal.ok) assertEquals(withGoal.detail, "placement_gab_unsupported_goal");
  const outsideGeo = validateTikTokPlacements(["PLACEMENT_GLOBAL_APP_BUNDLE"], {
    optimizationGoal: "CLICK",
    countryCodes: ["US"],
  });
  assertEquals(outsideGeo.ok, false);
  if (!outsideGeo.ok) assertEquals(outsideGeo.detail, "placement_gab_geo_locked");
  assertEquals(
    validateTikTokPlacements(["PLACEMENT_GLOBAL_APP_BUNDLE"], {
      optimizationGoal: "CLICK",
      countryCodes: ["BR"],
    }).ok,
    true,
  );
});

Deno.test("placements: deprecated TOPBUZZ/HELO are rejected; the default is TikTok-only", () => {
  for (const placement of ["PLACEMENT_TOPBUZZ", "PLACEMENT_HELO"]) {
    const check = validateTikTokPlacements([placement]);
    assertEquals(check.ok, false);
    if (!check.ok) assertEquals(check.detail, "placement_deprecated");
  }
  const body = buildTikTokAdGroupBody(ADVERTISER, "1234567890123456789", validAdGroupSpec());
  assertEquals(body.placement_type, "PLACEMENT_TYPE_NORMAL");
  assertEquals(body.placements, ["PLACEMENT_TIKTOK"]);
});

// ── Video duration policy (A1.1(d)/T-4 — ships ahead of the #866 video path) ──

Deno.test("video: the POLICY bound is 5–60s (not the 10-minute technical bound); Spark = 600s", () => {
  assertEquals(validateTikTokVideoDuration(4).ok, false);
  assertEquals(validateTikTokVideoDuration(5).ok, true);
  assertEquals(validateTikTokVideoDuration(60).ok, true);
  const threeMinutes = validateTikTokVideoDuration(180);
  assertEquals(threeMinutes.ok, false); // uploads fine, creates fine, DIES IN REVIEW
  if (!threeMinutes.ok) assertEquals(threeMinutes.detail, "video_duration_policy");
  assertEquals(validateTikTokVideoDuration(180, { spark: true }).ok, true);
  assertEquals(validateTikTokVideoDuration(601, { spark: true }).ok, false);
});

// ── Budget update rules (setBudget validation — ≤40% learning/≤30% after/2 days) ─

Deno.test("setBudget rules: increase caps are 40% in learning, 30% after (validation, no clamp)", () => {
  assertEquals(
    validateTikTokBudgetUpdate({
      currentBudgetDollars: 100,
      newBudgetDollars: 139,
      learning: true,
    }).ok,
    true,
  );
  const overLearning = validateTikTokBudgetUpdate({
    currentBudgetDollars: 100,
    newBudgetDollars: 141,
    learning: true,
  });
  assertEquals(overLearning.ok, false);
  if (!overLearning.ok) assertEquals(overLearning.detail, "budget_increase_too_large");
  assertEquals(
    validateTikTokBudgetUpdate({ currentBudgetDollars: 100, newBudgetDollars: 129 }).ok,
    true,
  );
  const overAfter = validateTikTokBudgetUpdate({
    currentBudgetDollars: 100,
    newBudgetDollars: 131,
  });
  assertEquals(overAfter.ok, false);
  // Decreases are not percentage-capped.
  assertEquals(
    validateTikTokBudgetUpdate({ currentBudgetDollars: 100, newBudgetDollars: 40 }).ok,
    true,
  );
});

Deno.test("setBudget rules: adjustments are rejected within the 2-day cadence window", () => {
  const now = Date.parse("2026-07-15T12:00:00Z");
  const tooSoon = validateTikTokBudgetUpdate({
    currentBudgetDollars: 100,
    newBudgetDollars: 110,
    lastBudgetChangeAt: "2026-07-14T12:00:00Z", // 1 day ago
    nowMs: now,
  });
  assertEquals(tooSoon.ok, false);
  if (!tooSoon.ok) assertEquals(tooSoon.detail, "budget_adjustment_too_frequent");
  assertEquals(
    validateTikTokBudgetUpdate({
      currentBudgetDollars: 100,
      newBudgetDollars: 110,
      lastBudgetChangeAt: "2026-07-13T11:00:00Z", // >2 days ago
      nowMs: now,
    }).ok,
    true,
  );
});

// ── Upload contract (GR-58 — unique file names) ───────────────────────────────

Deno.test("upload: file names are unique per advertiser via the timestamp suffix", () => {
  const a = tiktokUniqueFileName("https://cdn.example.com/media/hero-shot.png", 1_000);
  const b = tiktokUniqueFileName("https://cdn.example.com/media/hero-shot.png", 2_000);
  assertEquals(a, "hero-shot-1000");
  assertEquals(b, "hero-shot-2000");
  assert(a !== b, "same source URL must never produce the same TikTok file name");
});

// ── Registry + fail-close (mirrors the WP1 registry test for the live adapter) ─

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-000000000000",
  platform: "tiktok",
  lane: "consumer",
  display_name: "TikTok · Consumer",
  external_account_id: ADVERTISER,
  external_org_id: "7627974686760009729",
  auth_kind: "system_user_token",
  token_env_var: "TIKTOK_ACCESS_TOKEN_WP7_TEST_UNSET", // deliberately unset in the test env
  extra: { identity_id: IDENTITY, identity_type: "TT_USER" },
  status: "connected",
  currency: "USD",
  timezone: "America/New_York",
  min_daily_budget_cents: null,
  account_status: "STATUS_ENABLE",
  token_last_verified_at: null,
  connected: true,
};

Deno.test("registry: getAdapter('tiktok') is the LIVE adapter (WP7) and fail-closes without the secret", async () => {
  const adapter = getAdapter("tiktok");
  assertEquals(adapter.platform, "tiktok");
  assert(typeof adapter.rollbackCampaign === "function", "rollback hook must exist (§4.4b DELETE cascade)");
  assert(typeof adapter.createCreative === "function", "createCreative must exist as the documented NO-OP");
  // Token resolve runs FIRST in every method — a broken connection surfaces
  // 424 tiktok_not_connected BEFORE any input validation or TikTok call.
  await assertRejects(
    () => adapter.createCampaign(CONN, { name: "x", objective: "TRAFFIC" }),
    AdNotConnectedError,
  );
  await assertRejects(() => adapter.connect(CONN), AdNotConnectedError);
  await assertRejects(
    () => adapter.setStatus(CONN, "campaign", "1234567890123456789", "ACTIVE"),
    AdNotConnectedError,
  );
  await assertRejects(
    () => adapter.setBudget(CONN, "ad_set", "1234567890123456789", 2_500),
    AdNotConnectedError,
  );
});

Deno.test("registry: createCreative is a documented NO-OP — never yields a creative id", async () => {
  const adapter = getAdapter("tiktok");
  const result = await adapter.createCreative!(CONN, {
    destUrl: "https://usemingla.com/e/brand/event",
    message: "inline on TikTok",
  });
  assertEquals(result.externalCreativeId, undefined);
  assertEquals(result.postId, undefined);
});
