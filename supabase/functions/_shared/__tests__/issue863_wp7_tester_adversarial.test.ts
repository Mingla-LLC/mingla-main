/**
 * ISSUE-863 WP7 — TESTER adversarial suite (mingla-tester, 2026-07-15).
 *
 * Attacks angles the implementor's 38 tests (tiktok.test.ts) do NOT cover:
 *
 *   T-1  tool/region parser vs hostile payload shapes: null/non-array
 *        containers, alternate keys (regions/list, region_id/id,
 *        country_code), number-typed ids, entries with missing fields,
 *        empty region_info, a 3,500-entry list. Grounded in T-P2 (the live
 *        payload is 2,831 regions / 33 codes / GB absent).
 *   T-2  country→location_id picker: country-level preference when province
 *        rows precede the country row; whitespace/lowercase request codes;
 *        duplicate request codes never produce overlapping location_ids;
 *        ALL missing countries are named (not just the first); empty region
 *        list fails loud.
 *   T-3  emoji validator vs exotic sequences: ZWJ family, skin-tone
 *        modifier pairs, flag digraphs, keycap sequences (with AND without
 *        VS16), tag-sequence flags, © + VS16 (emoji presentation) rejected
 *        while bare ©®™ pass; astral non-emoji (math script) passes;
 *        CJK ×2 boundary at EXACTLY 100 (and 512 for names).
 *        KNOWN GAPS (report findings, deliberately NOT enshrined here so an
 *        append-only fix is not blocked): a LONE skin-tone modifier
 *        (U+1F3FB–FF) and bare TAG chars (U+E0020–E007F) pass containsEmoji
 *        and survive stripEmoji — see QA_ISSUE-863_WP7.md F-1/F-2.
 *   T-4  the V8 date-rolling class (the implementor's own discovery,
 *        attacked wider): 2027-02-30 / 2026-13-01 / 2026-06-31 /
 *        2027-02-29 (non-leap) / 24:00:00 / :60 minutes+seconds all reject;
 *        2028-02-29 (leap) parses; exact bound values (2028-01-01 start,
 *        2038-01-01 end) pass and +1s fails. fails-on-revert target: the
 *        round-trip guard line in parseTikTokScheduleTime (tiktok.ts —
 *        `if (formatTikTokScheduleTime(new Date(ms)) !== value) return null;`)
 *        — a DIFFERENT line from both implementor targets.
 *   T-5  DISABLE invariant via a different vector: hostile properties on the
 *        SPEC objects (not payload-key injection — that is the implementor's
 *        angle): injected operation_status on the spec, a hostile
 *        budget_mode ("BUDGET_MODE_INFINITE") that must NOT produce an
 *        infinite ad-group budget, and a utm_params entry named
 *        "operation_status" that must stay inside utm_params.
 *   T-6  launch-warning mapping vs hostile statuses: per-level prefixes,
 *        case sensitivity, double prefixes, Meta vocabulary
 *        (PENDING_BILLING_INFO) never warping into the TikTok mapping,
 *        funding vs review message flavors, and never-throws fuzz.
 *   T-7  CBO first-ad-group consistency: undefined≡null optimization_event,
 *        both mismatch arms, empty-string is NOT absence.
 *   T-8  money boundaries THROUGH the builders: 1999¢/2000¢ ad-group floor
 *        edge, 4999¢/5000¢ CBO edge, lifetime $20×days edge on a real
 *        3-day schedule, non-integer/NaN/Infinity/0/negative cents, the
 *        MAX_BUDGET_CENTS integer-precision bound.
 *   T-9  landing-page host gate evasion: case tricks, subdomain-suffix
 *        tricks, bare onelink.me apex, userinfo@ tricks, http downgrade.
 *   T-10 upload file-name uniqueness under hostile URLs (no path, long
 *        basename, query strings, non-URL input).
 *   T-11 utm_params boundary (14 exact / 15 reject) + malformed entries.
 *   T-12 lane-correct env resolution + advertiser-mismatch guard: business
 *        lane name is TIKTOK_MINGLABIZ_*; whitespace token_env_var falls
 *        back; env/persisted advertiser-id mismatch throws advertiser_mismatch
 *        (never silently picks one).
 *   T-13 status writer/reader vocabulary: hostile writer input throws;
 *        reader maps only exact ENABLE/DISABLE/DELETE.
 *   T-14 ad-body creative shape: imageIds cardinality, empty identity_id,
 *        SINGLE_VIDEO refused in v1, error normalizer hostile envelopes.
 *
 * fails-on-revert (proven by TRUE LINE DELETION, not comment-out):
 *   - deleting the round-trip guard in parseTikTokScheduleTime makes the
 *     T-4 rolled-date tests fail (V8 rolls 2027-02-30 → 2027-03-02).
 *   - (re-derived, implementor targets) deleting the campaign-body
 *     `operation_status: "DISABLE"` line fails the DISABLE fuzz; deleting
 *     the CBO bid_type default fails the bidding tests — and ALSO fails
 *     T-5 here (independent second net over the same invariants).
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/issue863_wp7_tester_adversarial.test.ts
 */

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdConnectionRow,
  AdApiError,
  AdNotConnectedError,
  centsToPlatformBudget,
  MAX_BUDGET_CENTS,
} from "../adChannel.ts";
import {
  buildTikTokAdBody,
  buildTikTokAdGroupBody,
  buildTikTokCampaignBody,
  containsEmoji,
  engineStatusFromTikTok,
  normalizeTikTokError,
  parseTikTokRegions,
  parseTikTokScheduleTime,
  pickTikTokLocationIdsForCountries,
  resolveTikTokClient,
  resolveTikTokToken,
  stripEmoji,
  tiktokDefaultTokenEnvVar,
  tiktokLaunchWarning,
  tiktokStatusForAdvertiserStatus,
  tiktokUniqueFileName,
  tiktokWeightedLength,
  validateTikTokAdText,
  validateTikTokCboAdGroupConsistency,
  validateTikTokLandingPageUrl,
  validateTikTokLocationIds,
  validateTikTokName,
  validateTikTokSchedule,
  validateTikTokUtmParams,
} from "../tiktok.ts";

const ADVERTISER = "7627974536397766673";
const IDENTITY = "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5";
const US_LOCATION = "6252001";

/** Fixed in-bounds clock: 2026-07-15 12:00:00 UTC (matches the implementor suite). */
const NOW_MS = Date.parse("2026-07-15T12:00:00Z");

function adGroupSpec(overrides: Record<string, unknown> = {}) {
  return {
    name: "qa adversarial ad group",
    optimizationGoal: "TRAFFIC_LANDING_PAGE_VIEW",
    billingEvent: "CPC",
    budgetCents: 2_500,
    locationIds: [US_LOCATION],
    scheduleStartTime: "2026-07-15 12:00:00",
    nowMs: NOW_MS,
    ...overrides,
    // deno-lint-ignore no-explicit-any
  } as any;
}

function adSpec(overrides: Record<string, unknown> = {}) {
  return {
    adName: "qa adversarial ad",
    identityType: "TT_USER",
    identityId: IDENTITY,
    imageIds: ["img_1"],
    adText: "Find your next experience on Mingla",
    landingPageUrl: "https://usemingla.com/e/brand/event",
    ...overrides,
    // deno-lint-ignore no-explicit-any
  } as any;
}

// ── T-1 — tool/region parser vs hostile payload shapes ───────────────────────

Deno.test("T-1 parser: null / non-array / empty containers all yield [] (never throw)", () => {
  assertEquals(parseTikTokRegions(null), []);
  assertEquals(parseTikTokRegions(undefined), []);
  assertEquals(parseTikTokRegions({}), []);
  assertEquals(parseTikTokRegions({ region_info: "not-an-array" }), []);
  assertEquals(parseTikTokRegions({ region_info: null }), []);
  assertEquals(parseTikTokRegions({ region_info: [] }), []);
  assertEquals(parseTikTokRegions("garbage"), []);
  assertEquals(parseTikTokRegions(42), []);
});

Deno.test("T-1 parser: alternate container keys (regions / list) and id keys (region_id / id) are accepted", () => {
  const viaRegions = parseTikTokRegions({
    regions: [{ region_id: "6252001", region_code: "US", name: "United States", level: "COUNTRY" }],
  });
  assertEquals(viaRegions.length, 1);
  assertEquals(viaRegions[0].locationId, "6252001");

  const viaList = parseTikTokRegions({
    list: [{ id: "2328926", country_code: "ng", name: "Nigeria" }],
  });
  assertEquals(viaList.length, 1);
  assertEquals(viaList[0].locationId, "2328926");
  // region codes are normalized to uppercase at parse time.
  assertEquals(viaList[0].regionCode, "NG");
  assertEquals(viaList[0].level, null);
});

Deno.test("T-1 parser: number-typed location ids are coerced to strings; junk entries are skipped", () => {
  const parsed = parseTikTokRegions({
    region_info: [
      { location_id: 6252001, region_code: "US", level: "COUNTRY" }, // number id → "6252001"
      { location_id: "abc123", region_code: "XX" }, // non-numeric id → skipped
      { location_id: "", region_code: "YY" }, // empty id → skipped
      { location_id: "111", region_code: "" }, // empty code → skipped
      { location_id: "222" }, // missing code → skipped
      { region_code: "ZZ" }, // missing id → skipped
      { location_id: true, region_code: "WW" }, // boolean id → skipped
      // NOTE: a literal `null` ELEMENT in the array crashes the parser with a
      // raw TypeError (QA finding F-3, P2 — see QA_ISSUE-863_WP7.md). It is
      // deliberately NOT asserted here so this append-only suite does not
      // block the fix; the rework adds the guard + its own regression test.
      { location_id: "333", region_code: "vn", name: 42, level: 7 }, // non-string name/level → null
    ],
  });
  assertEquals(parsed.length, 2);
  assertEquals(parsed[0], {
    locationId: "6252001",
    regionCode: "US",
    name: null,
    level: "COUNTRY",
  });
  assertEquals(parsed[1].regionCode, "VN");
  assertEquals(parsed[1].name, null);
  assertEquals(parsed[1].level, null);
});

Deno.test("T-1 parser: a 3,500-entry list parses fully and the picker still resolves (live-scale)", () => {
  // Live-scale shape (T-P2: 2,831 regions / 33 codes). 100 codes × 35 rows,
  // one COUNTRY row per code buried mid-list among provinces.
  const entries: Record<string, unknown>[] = [];
  for (let c = 0; c < 100; c++) {
    const code = `${String.fromCharCode(65 + Math.floor(c / 26))}${String.fromCharCode(65 + (c % 26))}`;
    for (let p = 0; p < 35; p++) {
      entries.push(
        p === 17
          ? { location_id: String(1_000_000 + c), region_code: code, level: "COUNTRY" }
          : { location_id: String(2_000_000 + c * 100 + p), region_code: code, level: "PROVINCE" },
      );
    }
  }
  const parsed = parseTikTokRegions({ region_info: entries });
  assertEquals(parsed.length, 3_500);
  const picked = pickTikTokLocationIdsForCountries(parsed, ["AA", "DV"]);
  assert(picked.ok);
  assertEquals(picked.locationIds, ["1000000", String(1_000_000 + 99)]);
});

// ── T-2 — picker adversarial ─────────────────────────────────────────────────

Deno.test("T-2 picker: the COUNTRY-level row wins even when 34 province rows precede it", () => {
  const regions = parseTikTokRegions({
    region_info: [
      ...Array.from({ length: 34 }, (_, i) => ({
        location_id: String(4_000_000 + i),
        region_code: "US",
        level: "PROVINCE",
      })),
      { location_id: US_LOCATION, region_code: "US", level: "COUNTRY" },
    ],
  });
  const picked = pickTikTokLocationIdsForCountries(regions, ["US"]);
  assert(picked.ok);
  assertEquals(picked.locationIds, [US_LOCATION]);
});

Deno.test("T-2 picker: request codes are trimmed + uppercased; ALL missing countries are named", () => {
  const regions = parseTikTokRegions({
    region_info: [{ location_id: US_LOCATION, region_code: "US", level: "COUNTRY" }],
  });
  const picked = pickTikTokLocationIdsForCountries(regions, [" us ", "gb", "fr"], {
    objective: "TRAFFIC",
  });
  assert(!picked.ok);
  assertEquals(picked.missing, ["GB", "FR"]); // both named, not just the first
  assert(picked.message.includes("GB, FR"));
  assert(picked.message.includes("TRAFFIC"));
  assert(picked.message.includes("NEVER silently dropped"));
});

Deno.test("T-2 picker: duplicate request codes cannot smuggle overlapping location_ids downstream", () => {
  const regions = parseTikTokRegions({
    region_info: [{ location_id: US_LOCATION, region_code: "US", level: "COUNTRY" }],
  });
  const picked = pickTikTokLocationIdsForCountries(regions, ["US", "us", " US "]);
  assert(picked.ok);
  // One resolved entry — the no-overlap invariant survives a hostile request.
  assertEquals(picked.locationIds, [US_LOCATION]);
  const check = validateTikTokLocationIds(picked.locationIds);
  assert(check.ok);
});

Deno.test("T-2 picker: an empty region list fails LOUD for every requested country", () => {
  const picked = pickTikTokLocationIdsForCountries([], ["US", "NG"]);
  assert(!picked.ok);
  assertEquals(picked.missing, ["US", "NG"]);
});

// ── T-3 — emoji validator vs exotic sequences ────────────────────────────────

Deno.test("T-3 emoji: ZWJ family / skin-tone pair / flag digraph / keycap (±VS16) / tag flag are ALL rejected in ad_text", () => {
  const family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}"; // 👨‍👩‍👧‍👦
  const thumbsMedium = "\u{1F44D}\u{1F3FD}"; // 👍🏽 (base + modifier)
  const gbFlag = "\u{1F1EC}\u{1F1E7}"; // 🇬🇧
  const keycapVS16 = "1\u{FE0F}\u{20E3}"; // 1️⃣
  const keycapBare = "#\u{20E3}"; // #⃣ (no VS16 — still a keycap)
  const englandTagFlag = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"; // 🏴󠁧󠁢󠁥󠁮󠁧󠁿
  for (const sample of [family, thumbsMedium, gbFlag, keycapVS16, keycapBare, englandTagFlag]) {
    assert(containsEmoji(sample), `containsEmoji missed: ${JSON.stringify(sample)}`);
    const verdict = validateTikTokAdText(`Party time ${sample}`);
    assert(!verdict.ok, `ad_text accepted emoji: ${JSON.stringify(sample)}`);
    assertEquals(verdict.ok ? "" : verdict.detail, "ad_text_emoji");
  }
});

Deno.test("T-3 emoji: © + VS16 (emoji presentation) is rejected while bare ©®™ pass the allowlist", () => {
  assert(containsEmoji("\u{A9}\u{FE0F}")); // ©️ — VS16 plumbing forces emoji presentation
  assert(!containsEmoji("©®™"));
  assert(validateTikTokAdText("Mingla ©®™ 2026").ok);
  assert(!validateTikTokAdText("Mingla \u{A9}\u{FE0F} 2026").ok);
});

Deno.test("T-3 emoji: stripEmoji fully removes ZWJ families and flag digraphs; the result re-validates clean", () => {
  const dirty = "Big \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466} night \u{1F1EC}\u{1F1E7} out \u{1F389}";
  const clean = stripEmoji(dirty);
  assertEquals(clean, "Big night out");
  assert(!containsEmoji(clean));
  assert(validateTikTokAdText(clean).ok);
});

Deno.test("T-3 emoji: astral NON-emoji (math script 𝒜) passes and weighs 1 (code-point iteration, not UTF-16 units)", () => {
  const mathA = "\u{1D49C}";
  assert(!containsEmoji(mathA));
  assertEquals(tiktokWeightedLength(mathA), 1); // .length would say 2 — surrogate pair
  assert(validateTikTokAdText(`Set ${mathA} on Mingla`).ok);
});

Deno.test("T-3 weight: the CJK ×2 cap boundary at EXACTLY 100 — mixed compositions", () => {
  const cjk = (n: number) => "夜".repeat(n);
  // 50 CJK = weight 100 → exactly at the cap: PASS.
  assert(validateTikTokAdText(cjk(50)).ok);
  // 49 CJK + 2 Latin = 100 → PASS.
  assert(validateTikTokAdText(`${cjk(49)}ab`).ok);
  // 50 CJK + 1 Latin = 101 → FAIL.
  const over = validateTikTokAdText(`${cjk(50)}a`);
  assert(!over.ok);
  assertEquals(over.ok ? "" : over.detail, "ad_text_too_long");
  // 100 Latin passes; 99 Latin + 1 CJK = 101 fails.
  assert(validateTikTokAdText("a".repeat(100)).ok);
  assert(!validateTikTokAdText(`${"a".repeat(99)}夜`).ok);
});

Deno.test("T-3 weight: the 512 name cap boundary with CJK ×2 (256 CJK exactly at the cap)", () => {
  const cjk = (n: number) => "業".repeat(n);
  assert(validateTikTokName(cjk(256), "campaign_name").ok);
  const over = validateTikTokName(`${cjk(256)}x`, "campaign_name");
  assert(!over.ok);
  assertEquals(over.ok ? "" : over.detail, "name_too_long");
});

Deno.test("T-3 weight: full-width Latin and half-width katakana count ×2 (documented current rule)", () => {
  // The full-width block 0xFF00–0xFFEF is weighted ×2 wholesale — including
  // half-width katakana (ｶ, U+FF76). Documented so a future fidelity change
  // is a conscious decision, not drift.
  assertEquals(tiktokWeightedLength("Ａ"), 2);
  assertEquals(tiktokWeightedLength("ｶ"), 2);
});

// ── T-4 — the V8 date-rolling class (dispatch-mandated trio + wider) ─────────

Deno.test("T-4 dates: impossible calendar dates NEVER parse (V8 rolls them; the round-trip guard must catch it)", () => {
  const rejects = [
    "2027-02-30 00:00:00", // V8 rolls → 2027-03-02 (the implementor's own discovery)
    "2026-13-01 00:00:00", // month 13 → NaN in ISO parsing
    "2026-06-31 00:00:00", // June 31 rolls → July 1
    "2027-02-29 00:00:00", // non-leap Feb 29 rolls → Mar 1
    "2026-04-31 00:00:00", // April 31
    "2026-00-10 00:00:00", // month 00
    "2026-06-00 00:00:00", // day 00
    "2026-06-15 24:00:00", // ISO hour-24 rolls to next-day 00:00
    "2026-06-15 12:60:00", // minute 60 → NaN
    "2026-06-15 10:00:60", // leap second → NaN
  ];
  for (const value of rejects) {
    assertEquals(parseTikTokScheduleTime(value), null, `parsed impossible date: ${value}`);
  }
  // Leap-day on a REAL leap year parses.
  assert(parseTikTokScheduleTime("2028-02-29 00:00:00") !== null);
});

Deno.test("T-4 dates: rolled dates reject through validateTikTokSchedule with schedule_start_invalid", () => {
  for (const bad of ["2027-02-30 00:00:00", "2026-13-01 00:00:00", "2026-06-31 00:00:00"]) {
    const verdict = validateTikTokSchedule({
      scheduleType: "SCHEDULE_FROM_NOW",
      scheduleStartTime: bad,
      nowMs: NOW_MS,
    });
    assert(!verdict.ok, `schedule accepted rolled date: ${bad}`);
    assertEquals(verdict.ok ? "" : verdict.detail, "schedule_start_invalid");
  }
});

Deno.test("T-4 dates: a rolled date cannot reach an ad-group BODY (builder integration)", () => {
  assertThrows(
    () =>
      buildTikTokAdGroupBody(
        ADVERTISER,
        "1111111111",
        adGroupSpec({ scheduleStartTime: "2027-02-30 00:00:00" }),
      ),
    AdApiError,
    "schedule_start_time",
  );
});

Deno.test("T-4 dates: exact bound values pass; one second past each bound fails", () => {
  // Start exactly AT the 2028-01-01 bound → allowed.
  assert(
    validateTikTokSchedule({
      scheduleType: "SCHEDULE_FROM_NOW",
      scheduleStartTime: "2028-01-01 00:00:00",
      nowMs: NOW_MS,
    }).ok,
  );
  const startPast = validateTikTokSchedule({
    scheduleType: "SCHEDULE_FROM_NOW",
    scheduleStartTime: "2028-01-01 00:00:01",
    nowMs: NOW_MS,
  });
  assert(!startPast.ok);
  assertEquals(startPast.ok ? "" : startPast.detail, "schedule_start_out_of_bounds");
  // End exactly AT the 2038-01-01 bound → allowed; +1s → rejected.
  assert(
    validateTikTokSchedule({
      scheduleType: "SCHEDULE_START_END",
      scheduleStartTime: "2026-07-15 12:00:00",
      scheduleEndTime: "2038-01-01 00:00:00",
      nowMs: NOW_MS,
    }).ok,
  );
  const endPast = validateTikTokSchedule({
    scheduleType: "SCHEDULE_START_END",
    scheduleStartTime: "2026-07-15 12:00:00",
    scheduleEndTime: "2038-01-01 00:00:01",
    nowMs: NOW_MS,
  });
  assert(!endPast.ok);
  assertEquals(endPast.ok ? "" : endPast.detail, "schedule_end_out_of_bounds");
});

// ── T-5 — DISABLE invariant via hostile SPEC properties (different vector) ───

Deno.test("T-5 DISABLE: hostile spec-level operation_status/status properties never flip any builder output", () => {
  const campaign = buildTikTokCampaignBody(ADVERTISER, {
    name: "qa hostile campaign",
    objective: "TRAFFIC",
    // deno-lint-ignore no-explicit-any
    ...( { operation_status: "ENABLE", operationStatus: "ENABLE", status: "ACTIVE" } as any ),
  });
  assertEquals(campaign.operation_status, "DISABLE");

  const adGroup = buildTikTokAdGroupBody(
    ADVERTISER,
    "1111111111",
    adGroupSpec({ operation_status: "ENABLE", operationStatus: "ENABLE", status: "ACTIVE" }),
  );
  assertEquals(adGroup.operation_status, "DISABLE");

  const ad = buildTikTokAdBody(
    ADVERTISER,
    "2222222222",
    adSpec({ operation_status: "ENABLE", operationStatus: "ENABLE", status: "ACTIVE" }),
  );
  const creative = (ad.creatives as Record<string, unknown>[])[0];
  assertEquals(creative.operation_status, "DISABLE");
  // The hostile property must not appear at the top level of the ad body either.
  assert(!("operation_status" in ad));
});

Deno.test("T-5 DISABLE: a utm_params entry NAMED operation_status stays inside utm_params — it cannot flip the creative", () => {
  const ad = buildTikTokAdBody(
    ADVERTISER,
    "2222222222",
    adSpec({ utmParams: [{ key: "operation_status", value: "ENABLE" }] }),
  );
  const creative = (ad.creatives as Record<string, unknown>[])[0];
  assertEquals(creative.operation_status, "DISABLE");
  assertEquals(creative.utm_params, [{ key: "operation_status", value: "ENABLE" }]);
});

Deno.test("T-5 budget: a hostile budget_mode ('BUDGET_MODE_INFINITE') cannot produce an infinite ad-group budget", () => {
  const body = buildTikTokAdGroupBody(
    ADVERTISER,
    "1111111111",
    adGroupSpec({ budgetMode: "BUDGET_MODE_INFINITE" }),
  );
  // Degrades to the daily lane: a positive dollar budget + BUDGET_MODE_DAY.
  assertEquals(body.budget_mode, "BUDGET_MODE_DAY");
  assertEquals(body.budget, 25);
});

// ── T-6 — launch-warning mapping vs hostile statuses ─────────────────────────

Deno.test("T-6 warnings: every per-level prefix maps; funding vs review flavors are distinct", () => {
  const campaignBalance = tiktokLaunchWarning("CAMPAIGN_STATUS_BALANCE_EXCEED");
  const adgroupBalance = tiktokLaunchWarning("ADGROUP_STATUS_NO_BUDGET");
  const adAudit = tiktokLaunchWarning("AD_STATUS_AUDIT");
  const denied = tiktokLaunchWarning("AD_STATUS_AUDIT_DENY");
  assert(campaignBalance !== null && campaignBalance.includes("Advanced Payment Portfolio"));
  assert(adgroupBalance !== null && adgroupBalance.includes("Advanced Payment Portfolio"));
  assert(adAudit !== null && adAudit.includes("reviewing"));
  assert(denied !== null && denied.includes("failed TikTok review"));
  // The raw (prefixed) status is quoted verbatim in the warning for the admin.
  assert(campaignBalance!.includes("CAMPAIGN_STATUS_BALANCE_EXCEED"));
});

Deno.test("T-6 warnings: healthy, unknown, hostile, and WRONG-vocabulary statuses map to null and never throw", () => {
  const silent = [
    "DELIVERY_OK",
    "CAMPAIGN_STATUS_DELIVERY_OK",
    "NOT_START",
    "CAMPAIGN_STATUS_ENABLE",
    "balance_exceed", // case-sensitive contract — lowercase is not the enum
    "CAMPAIGN_STATUS_", // bare prefix
    "", // handled by the null-guard path
    "CAMPAIGN_STATUS_CAMPAIGN_STATUS_BALANCE_EXCEED", // double prefix strips ONCE → no match
    "PENDING_BILLING_INFO", // Meta's vocabulary must NOT warp into the TikTok mapping
    "WITH_ISSUES", // Meta again
    "\u{1F4A3}", // hostile emoji status
    "A".repeat(10_000), // hostile length
  ];
  for (const status of silent) {
    assertEquals(tiktokLaunchWarning(status), null, `unexpected warning for ${JSON.stringify(status.slice(0, 60))}`);
  }
  assertEquals(tiktokLaunchWarning(null), null);
});

// ── T-7 — CBO first-ad-group consistency ─────────────────────────────────────

Deno.test("T-7 CBO consistency: undefined and null optimization_event are the SAME absence; both mismatch arms fire; empty string is not absence", () => {
  const ok = validateTikTokCboAdGroupConsistency(
    { bidType: "BID_TYPE_NO_BID", optimizationEvent: undefined },
    { bidType: "BID_TYPE_NO_BID", optimizationEvent: null },
  );
  assert(ok.ok);

  const bidMismatch = validateTikTokCboAdGroupConsistency(
    { bidType: "BID_TYPE_NO_BID" },
    { bidType: "BID_TYPE_CUSTOM" },
  );
  assert(!bidMismatch.ok);
  assertEquals(bidMismatch.ok ? "" : bidMismatch.detail, "cbo_bid_type_mismatch");

  const eventMismatch = validateTikTokCboAdGroupConsistency(
    { bidType: "BID_TYPE_NO_BID", optimizationEvent: "ON_WEB_ORDER" },
    { bidType: "BID_TYPE_NO_BID", optimizationEvent: null },
  );
  assert(!eventMismatch.ok);
  assertEquals(eventMismatch.ok ? "" : eventMismatch.detail, "cbo_optimization_event_mismatch");

  // "" is a VALUE, not absence — conservative mismatch (documented).
  const emptyString = validateTikTokCboAdGroupConsistency(
    { bidType: "BID_TYPE_NO_BID", optimizationEvent: "" },
    { bidType: "BID_TYPE_NO_BID", optimizationEvent: undefined },
  );
  assert(!emptyString.ok);
});

// ── T-8 — money boundaries THROUGH the builders ──────────────────────────────

Deno.test("T-8 money: 1999¢ ($19.99) ad-group daily is refused; 2000¢ ($20.00) exact-floor builds", () => {
  assertThrows(
    () => buildTikTokAdGroupBody(ADVERTISER, "1111111111", adGroupSpec({ budgetCents: 1_999 })),
    AdApiError,
    "below TikTok's $20/day ad-group floor",
  );
  const body = buildTikTokAdGroupBody(ADVERTISER, "1111111111", adGroupSpec({ budgetCents: 2_000 }));
  assertEquals(body.budget, 20);
});

Deno.test("T-8 money: 4999¢ CBO campaign is refused; 5000¢ exact-floor builds with the dollar value", () => {
  assertThrows(
    () =>
      buildTikTokCampaignBody(ADVERTISER, {
        name: "qa cbo",
        objective: "TRAFFIC",
        dailyBudgetCents: 4_999,
      }),
    AdApiError,
    "below TikTok's $50/day campaign floor",
  );
  const body = buildTikTokCampaignBody(ADVERTISER, {
    name: "qa cbo",
    objective: "TRAFFIC",
    dailyBudgetCents: 5_000,
  });
  assertEquals(body.budget, 50);
  assertEquals(body.budget_optimize_on, true);
});

Deno.test("T-8 money: the lifetime floor uses the REAL scheduled days (3-day window ⇒ $60 floor)", () => {
  const threeDays = {
    budgetMode: "lifetime",
    scheduleType: "SCHEDULE_START_END",
    scheduleStartTime: "2026-07-15 12:00:00",
    scheduleEndTime: "2026-07-18 12:00:00", // exactly 3 × 24h
  };
  assertThrows(
    () =>
      buildTikTokAdGroupBody(
        ADVERTISER,
        "1111111111",
        adGroupSpec({ ...threeDays, budgetCents: 5_999 }), // $59.99 < $60
      ),
    AdApiError,
    "below TikTok's floor of $60 ($20 × 3 scheduled day(s))",
  );
  const body = buildTikTokAdGroupBody(
    ADVERTISER,
    "1111111111",
    adGroupSpec({ ...threeDays, budgetCents: 6_000 }),
  );
  assertEquals(body.budget, 60);
  assertEquals(body.budget_mode, "BUDGET_MODE_TOTAL");
});

Deno.test("T-8 money: NaN / Infinity / 0 / negative / fractional cents and the integer-precision bound all throw", () => {
  for (const cents of [Number.NaN, Number.POSITIVE_INFINITY, 0, -2000, 2000.5]) {
    assertThrows(
      () => centsToPlatformBudget("tiktok", cents),
      Error,
      "cents must be a positive integer",
    );
  }
  assertThrows(() => centsToPlatformBudget("tiktok", MAX_BUDGET_CENTS + 1), Error, "MAX_BUDGET_CENTS");
  // The boundary value itself converts exactly.
  assertEquals(centsToPlatformBudget("tiktok", MAX_BUDGET_CENTS), MAX_BUDGET_CENTS / 100);
});

// ── T-9 — landing-page host gate evasion ─────────────────────────────────────

Deno.test("T-9 landing gate: case tricks, apex onelink.me, deep subdomains, and http downgrade are ALL refused", () => {
  const blocked = [
    "https://go.usemingla.com/w36m",
    "https://GO.USEMINGLA.COM/w36m", // case evasion
    "https://minglabiz.onelink.me/ZSCW", // the DEAD Android link (COMMS-0100/0101)
    "https://deep.sub.onelink.me/x",
    "https://onelink.me/x", // apex — candidate.slice(1) arm
  ];
  for (const url of blocked) {
    const verdict = validateTikTokLandingPageUrl(url);
    assert(!verdict.ok, `gate passed a smart link: ${url}`);
    assertEquals(verdict.ok ? "" : verdict.detail, "landing_page_smart_link_blocked");
  }
  // http (not https) is refused before host inspection.
  const http = validateTikTokLandingPageUrl("http://usemingla.com/e/b/e");
  assert(!http.ok);
  assertEquals(http.ok ? "" : http.detail, "landing_page_url_invalid");
});

Deno.test("T-9 landing gate: lookalike hosts that are NOT smart links pass (the gate reads the REAL hostname)", () => {
  // userinfo@ trick: the real host is evil.example — not a smart-link host;
  // the gate must judge the actual hostname, not the string prefix.
  assert(validateTikTokLandingPageUrl("https://go.usemingla.com@evil.example/x").ok);
  assert(validateTikTokLandingPageUrl("https://usemingla.com/e/brand/event").ok);
  assert(validateTikTokLandingPageUrl("https://usemingla.com:443/e/brand/event").ok);
  // and the builder integration still hard-rejects the OneLink end-to-end:
  assertThrows(
    () =>
      buildTikTokAdBody(
        ADVERTISER,
        "2222222222",
        adSpec({ landingPageUrl: "https://minglabiz.onelink.me/ZSCW" }),
      ),
    AdApiError,
    "NEVER the OneLink",
  );
});

// ── T-10 — upload file-name uniqueness under hostile URLs ────────────────────

Deno.test("T-10 upload names: hostile URLs still yield unique, bounded file names", () => {
  const t1 = 1_752_600_000_000;
  const t2 = t1 + 1;
  // Same URL, different instants → different names (the uniqueness contract).
  assert(tiktokUniqueFileName("https://cdn.x/img.png", t1) !== tiktokUniqueFileName("https://cdn.x/img.png", t2));
  // Query strings are not part of the basename.
  assertEquals(tiktokUniqueFileName("https://cdn.x/hero.png?v=9&sig=abc", t1), `hero-${t1}`);
  // Extension stripped once; long basenames bounded at 80 chars + suffix.
  const long = tiktokUniqueFileName(`https://cdn.x/${"a".repeat(200)}.jpeg`, t1);
  assertEquals(long, `${"a".repeat(80)}-${t1}`);
  // Pathless / trailing-slash / non-URL inputs fall back to the default base.
  assertEquals(tiktokUniqueFileName("https://cdn.x/", t1), `mingla-ad-image-${t1}`);
  assertEquals(tiktokUniqueFileName("not a url at all", t1), `mingla-ad-image-${t1}`);
});

// ── T-11 — utm_params boundary + malformed entries ───────────────────────────

Deno.test("T-11 utm: 14 entries exactly pass; 15 reject; malformed entries reject", () => {
  const fourteen = Array.from({ length: 14 }, (_, i) => ({ key: `k${i}`, value: `v${i}` }));
  assert(validateTikTokUtmParams(fourteen).ok);
  const fifteen = [...fourteen, { key: "k14", value: "v14" }];
  const over = validateTikTokUtmParams(fifteen);
  assert(!over.ok);
  assertEquals(over.ok ? "" : over.detail, "utm_params_too_many");

  for (
    const bad of [
      [{ key: "", value: "x" }],
      [{ key: "  ", value: "x" }],
      [{ key: "k", value: 42 }],
      [{ value: "orphan" }],
      [null],
      ["k=v"],
      "utm_source=tiktok", // not an array
    ]
  ) {
    // deno-lint-ignore no-explicit-any
    assert(!validateTikTokUtmParams(bad as any).ok, `accepted: ${JSON.stringify(bad)}`);
  }

  // Custom key boundary: 100 chars pass, 101 reject; value 600 pass, 601 reject.
  assert(validateTikTokUtmParams([{ key: "k".repeat(100), value: "v" }]).ok);
  assert(!validateTikTokUtmParams([{ key: "k".repeat(101), value: "v" }]).ok);
  assert(validateTikTokUtmParams([{ key: "utm_source", value: "v".repeat(600) }]).ok);
  assert(!validateTikTokUtmParams([{ key: "utm_source", value: "v".repeat(601) }]).ok);
});

// ── T-12 — lane-correct env resolution + advertiser-mismatch guard ───────────

const ENV_KEYS = [
  "TIKTOK_ACCESS_TOKEN",
  "TIKTOK_MINGLABIZ_ACCESS_TOKEN",
  "TIKTOK_ADVERTISER_ID",
  "TIKTOK_MINGLABIZ_ADVERTISER_ID",
] as const;

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    saved.set(key, Deno.env.get(key));
    Deno.env.delete(key);
  }
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) Deno.env.set(key, value);
    }
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const prior = saved.get(key);
      if (prior === undefined) Deno.env.delete(key);
      else Deno.env.set(key, prior);
    }
  }
}

Deno.test("T-12 lanes: the business default env NAME is TIKTOK_MINGLABIZ_ACCESS_TOKEN; consumer is TIKTOK_ACCESS_TOKEN", () => {
  assertEquals(tiktokDefaultTokenEnvVar("consumer"), "TIKTOK_ACCESS_TOKEN");
  assertEquals(tiktokDefaultTokenEnvVar("business"), "TIKTOK_MINGLABIZ_ACCESS_TOKEN");
});

Deno.test("T-12 lanes: the business lane NEVER falls back to the consumer credential", () => {
  withEnv({ TIKTOK_ACCESS_TOKEN: "consumer-secret-value" }, () => {
    // Consumer resolves; business fail-closes even though a consumer token exists.
    assertEquals(resolveTikTokToken(null, "consumer"), "consumer-secret-value");
    assertThrows(() => resolveTikTokToken(null, "business"), AdNotConnectedError);
  });
});

Deno.test("T-12 lanes: a whitespace-only token_env_var falls back to the lane default (never Deno.env.get(''))", () => {
  withEnv({ TIKTOK_ACCESS_TOKEN: "tok-x" }, () => {
    const conn = { token_env_var: "   " } as Pick<AdConnectionRow, "token_env_var">;
    assertEquals(resolveTikTokToken(conn, "consumer"), "tok-x");
  });
});

Deno.test("T-12 lanes: a set-but-empty token env still fail-closes (empty string is not a credential)", () => {
  withEnv({ TIKTOK_ACCESS_TOKEN: "   " }, () => {
    assertThrows(() => resolveTikTokToken(null, "consumer"), AdNotConnectedError);
  });
});

Deno.test("T-12 mismatch: env advertiser id vs persisted connection id mismatch throws advertiser_mismatch — never a silent pick", () => {
  withEnv({ TIKTOK_ACCESS_TOKEN: "tok-x", TIKTOK_ADVERTISER_ID: "1111" }, () => {
    const conn = {
      platform: "tiktok",
      lane: "consumer",
      token_env_var: "TIKTOK_ACCESS_TOKEN",
      external_account_id: "2222",
      // deno-lint-ignore no-explicit-any
    } as any as AdConnectionRow;
    let thrown: unknown;
    try {
      resolveTikTokClient(conn);
    } catch (err) {
      thrown = err;
    }
    assert(thrown instanceof AdApiError);
    assert(String((thrown as AdApiError).message).includes("1111"));
    assert(String((thrown as AdApiError).message).includes("2222"));
  });
});

Deno.test("T-12 mismatch: token set but NO advertiser id anywhere fail-closes (not provisioned ≠ half provisioned)", () => {
  withEnv({ TIKTOK_ACCESS_TOKEN: "tok-x" }, () => {
    assertThrows(() => resolveTikTokClient(null, "consumer"), AdNotConnectedError);
  });
});

// ── T-13 — status vocabulary, both directions ────────────────────────────────

Deno.test("T-13 status: hostile writer inputs throw; the writer can only emit ENABLE|DISABLE", () => {
  assertEquals(tiktokStatusForAdvertiserStatus("ACTIVE"), "ENABLE");
  assertEquals(tiktokStatusForAdvertiserStatus("PAUSED"), "DISABLE");
  for (const hostile of ["DELETE", "ENABLE", "DISABLE", "ARCHIVED", "active", ""]) {
    assertThrows(
      // deno-lint-ignore no-explicit-any
      () => tiktokStatusForAdvertiserStatus(hostile as any),
      AdApiError,
      "ENABLE|DISABLE",
    );
  }
});

Deno.test("T-13 status: the reader maps only EXACT platform vocabulary; everything else is null", () => {
  assertEquals(engineStatusFromTikTok("ENABLE"), "ACTIVE");
  assertEquals(engineStatusFromTikTok("DISABLE"), "PAUSED");
  assertEquals(engineStatusFromTikTok("DELETE"), "DELETED");
  for (const junk of ["enable", "Enable", " ENABLE", "ACTIVE", "PAUSED", null, undefined, 1, {}]) {
    assertEquals(engineStatusFromTikTok(junk), null);
  }
});

// ── T-14 — creative shape + error normalizer ─────────────────────────────────

Deno.test("T-14 creative: imageIds cardinality is EXACTLY one; empty identity_id refused; SINGLE_VIDEO now needs a prepared video_id (#997 C)", () => {
  assertThrows(
    () => buildTikTokAdBody(ADVERTISER, "2222222222", adSpec({ imageIds: [] })),
    AdApiError,
    "exactly one Asset-Library image_id",
  );
  assertThrows(
    () => buildTikTokAdBody(ADVERTISER, "2222222222", adSpec({ imageIds: ["a", "b"] })),
    AdApiError,
    "exactly one Asset-Library image_id",
  );
  assertThrows(
    () => buildTikTokAdBody(ADVERTISER, "2222222222", adSpec({ imageIds: [""] })),
    AdApiError,
    "exactly one Asset-Library image_id",
  );
  assertThrows(
    () => buildTikTokAdBody(ADVERTISER, "2222222222", adSpec({ identityId: "  " })),
    AdApiError,
    "identity_id is required",
  );
  // [TEST-MOD-APPROVED ORCH-0997] #997 C wires SINGLE_VIDEO — it is no longer
  // refused outright. Without a prepared video_id it now fails with video_id_required
  // (a genuinely unsupported ad_format still throws ad_format_unsupported_v1 — proven
  // in the #997 suite). The cardinality + identity guards above are UNCHANGED.
  assertThrows(
    () => buildTikTokAdBody(ADVERTISER, "2222222222", adSpec({ adFormat: "SINGLE_VIDEO" })),
    AdApiError,
    "SINGLE_VIDEO requires a prepared video_id",
  );
});

Deno.test("T-14 normalizer: hostile error envelopes normalize without throwing and never fabricate fields", () => {
  assertEquals(normalizeTikTokError(null), {
    code: null,
    message: "TikTok API error",
    request_id: null,
  });
  assertEquals(normalizeTikTokError({ code: "40002", message: "", request_id: 99 }), {
    code: "40002",
    message: "TikTok API error", // empty message never passes through as ""
    request_id: null, // non-string request_id is discarded, not coerced
  });
  assertEquals(normalizeTikTokError({ code: 0, message: "OK", request_id: "rid" }), {
    code: 0,
    message: "OK",
    request_id: "rid",
  });
  assertEquals(normalizeTikTokError("garbage").message, "TikTok API error");
});
