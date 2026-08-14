/**
 * ISSUE-862 WP1 — TESTER ADVERSARIAL SUITE (mingla-tester, 2026-07-15).
 *
 * Append-only: this file is NEW; no implementor test was modified. It attacks
 * angles the implementor's happy-path suites (adChannel.test.ts / meta.test.ts)
 * do NOT cover:
 *
 *   T-1  money boundary attacks — NaN / Infinity / string-typed cents /
 *        float-precision exactness at the large-but-safe boundary / odd cents.
 *   T-2  Reddit CTA map — exact Title-Case pin (fails if anyone "normalizes"
 *        the map) + unexpected-offering access is undefined, never a throw.
 *   T-3  PAUSED-invariant fuzz — every builder output is PAUSED across a grid
 *        of inputs, AND hostile injected `status`/`execution_options` keys on
 *        the input object cannot flip a create body to ACTIVE.
 *        fails-on-revert: deleting the `status: "PAUSED"` line in
 *        buildMetaCampaignBody (meta.ts — a DIFFERENT file/commit-surface than
 *        the implementor's money-conversion proof in adChannel.ts) fails T-3.
 *   T-4  pixel-gate boundary — the 2001-01-01 cutoff both sides, numeric
 *        timestamps, "0".
 *   T-5  floor-category conservatism — unknown/garbage goals must land on the
 *        MOST expensive floor (low_freq $40), never a cheaper one.
 *   T-6  special_ad_categories adversarial shapes — CREDIT hidden in a mixed
 *        array, lowercase, non-string members, nested arrays.
 *   T-7  destination-policy source trap (A4.f / PROOF D-P1) — structural scan
 *        of admin-ad-create-campaign/index.ts: the OneLink (destSmartLink)
 *        may ONLY flow into the DB insert, never into the creative input or
 *        any adapter call; _shared/meta.ts must not reference the OneLink host.
 *   T-8  atomic-create step-4 (ad) failure — a angle the implementor did not
 *        test: rollback runs exactly once, partial IDs carry campaign+adset+
 *        creative; and an adapter WITHOUT a rollbackCampaign hook reports
 *        rollbackSucceeded=false (manual reconciliation), never true.
 *   T-9  CBO safety — ad-set builder never emits a budget under CBO; campaign
 *        builder treats dailyBudgetCents=0 as non-CBO (M-13 flag present).
 *
 * Run: deno test --allow-env --allow-read \
 *   supabase/functions/_shared/__tests__/issue862_wp1_tester_adversarial.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdConnectionRow,
  AtomicCreateError,
  type ChannelAdapter,
  centsToPlatformBudget,
  createFullCampaignAtomic,
  metaBudgetCategoryForGoal,
  type MinglaOffering,
  REDDIT_CTA_MAP,
} from "../adChannel.ts";
import {
  buildMetaAdBody,
  buildMetaAdSetBody,
  buildMetaCampaignBody,
  buildMetaCreativeBody,
  metaPixelHasSignal,
  validateSpecialAdCategories,
} from "../meta.ts";

// ── T-1: money boundary attacks ───────────────────────────────────────────────

Deno.test("T-1: NaN / Infinity / -Infinity cents throw (never silently convert)", () => {
  for (const platform of ["meta", "tiktok", "snapchat", "google", "reddit"] as const) {
    assertThrows(() => centsToPlatformBudget(platform, NaN));
    assertThrows(() => centsToPlatformBudget(platform, Infinity));
    assertThrows(() => centsToPlatformBudget(platform, -Infinity));
  }
});

Deno.test("T-1: string-typed cents (runtime JS caller) throws, never coerces", () => {
  // TS types don't protect a JSON-sourced runtime caller.
  // deno-lint-ignore no-explicit-any
  assertThrows(() => centsToPlatformBudget("google", "500" as any));
  // deno-lint-ignore no-explicit-any
  assertThrows(() => centsToPlatformBudget("meta", null as any));
  // deno-lint-ignore no-explicit-any
  assertThrows(() => centsToPlatformBudget("reddit", undefined as any));
});

Deno.test("T-1: micro conversion is EXACT at a large-but-safe boundary (~$9B)", () => {
  // 900_719_925_474 ¢ × 10_000 = 9_007_199_254_740_000 < Number.MAX_SAFE_INTEGER
  const cents = 900_719_925_474;
  const micro = centsToPlatformBudget("google", cents);
  assertEquals(micro, 9_007_199_254_740_000);
  assert(Number.isSafeInteger(micro), "micro conversion must stay a safe integer in range");
});

Deno.test("T-1: odd cents round-trip — TikTok dollars re-multiply back exactly", () => {
  for (const cents of [1, 99, 501, 2_001, 123_457]) {
    const dollars = centsToPlatformBudget("tiktok", cents);
    assertEquals(Math.round(dollars * 100), cents, `TikTok ÷100 must be lossless for ${cents}¢`);
  }
  // 1¢ on a micro platform = 10,000 micro — never 0, never rounded away.
  assertEquals(centsToPlatformBudget("snapchat", 1), 10_000);
});

// ── T-2: Reddit CTA map pins ──────────────────────────────────────────────────

Deno.test("T-2: REDDIT_CTA_MAP is EXACTLY the Title-Case display-string set (GR-29 pin)", () => {
  // Deep-equal pin: fails if anyone routes the map through a normalizer,
  // renames a value to SCREAMING_CASE, or "fixes" the display strings.
  assertEquals(REDDIT_CTA_MAP, {
    ticketed_event: "Buy Tickets",
    bookable: "Book Now",
    restaurant: "See Menu",
    venue: "Get Directions",
    upcoming_event: "Remind Me",
    default: "Learn More",
  });
});

Deno.test("T-2: unexpected offering key yields undefined — no throw, no fallback fabrication", () => {
  // deno-lint-ignore no-explicit-any
  const got = REDDIT_CTA_MAP["nightclub_rave" as any as MinglaOffering];
  assertEquals(got, undefined);
});

// ── T-3: PAUSED-invariant fuzz (fails-on-revert: PAUSED line in meta.ts) ──────

Deno.test("T-3: no builder output is ever ACTIVE across an input grid", () => {
  const campaignGrid = [
    { name: "a", objective: "OUTCOME_TRAFFIC" },
    { name: "b", objective: "OUTCOME_TRAFFIC", dailyBudgetCents: 500 },
    { name: "c", objective: "OUTCOME_SALES", specialAdCategories: ["HOUSING"] },
    { name: "d", objective: "OUTCOME_TRAFFIC", validateOnly: true },
    { name: "e", objective: "OUTCOME_TRAFFIC", dailyBudgetCents: 4_000, validateOnly: true },
  ];
  for (const input of campaignGrid) {
    const body = buildMetaCampaignBody(input);
    assertEquals(body.status, "PAUSED", `campaign body for ${input.name} must be PAUSED`);
    assert(JSON.stringify(body).includes('"PAUSED"'));
    assert(!JSON.stringify(body).includes('"ACTIVE"'), "no create body may carry ACTIVE");
  }
  const adSetBody = buildMetaAdSetBody("camp_1", {
    name: "s",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
    targeting: { geo_locations: { countries: ["US"] } },
  });
  assertEquals(adSetBody.status, "PAUSED");
  const adBody = buildMetaAdBody("adset_1", { name: "a", externalCreativeId: "cr_1" });
  assertEquals(adBody.status, "PAUSED");
});

Deno.test("T-3: hostile injected status/execution_options keys cannot flip a body ACTIVE", () => {
  // A JSON-sourced caller may smuggle extra keys onto the input object; the
  // builders construct bodies explicitly and must not spread input through.
  const hostileCampaign = {
    name: "h",
    objective: "OUTCOME_TRAFFIC",
    status: "ACTIVE",
    execution_options: [],
    // deno-lint-ignore no-explicit-any
  } as any;
  const body = buildMetaCampaignBody(hostileCampaign);
  assertEquals(body.status, "PAUSED", "injected status must be ignored — PAUSED wins");
  assertEquals(body.execution_options, undefined);

  const hostileAd = {
    name: "h",
    externalCreativeId: "cr_1",
    status: "ACTIVE",
    // deno-lint-ignore no-explicit-any
  } as any;
  assertEquals(buildMetaAdBody("adset_1", hostileAd).status, "PAUSED");
});

// ── T-4: pixel-gate boundary (A4.e.5) ─────────────────────────────────────────

Deno.test("T-4: 2001-01-01 cutoff — just-before is no-signal, clearly-after is signal", () => {
  assertEquals(metaPixelHasSignal("2000-12-31T23:59:59+0000"), false);
  assertEquals(metaPixelHasSignal("2001-01-02T00:00:01+0000"), true);
  // Numeric unix timestamp (not a string) must be no-signal, not a crash.
  // deno-lint-ignore no-explicit-any
  assertEquals(metaPixelHasSignal(1752610000 as any), false);
  assertEquals(metaPixelHasSignal("0"), false);
  // deno-lint-ignore no-explicit-any
  assertEquals(metaPixelHasSignal({} as any), false);
});

// ── T-5: floor-category conservatism ──────────────────────────────────────────

Deno.test("T-5: unknown/garbage goals land on low_freq (the $40 floor) — never cheaper", () => {
  for (const goal of ["", "NOT_A_GOAL", "link_clicks", "REACH ", "💥"]) {
    assertEquals(
      metaBudgetCategoryForGoal(goal),
      "low_freq",
      `garbage goal "${goal}" must map to the MOST conservative floor`,
    );
  }
});

// ── T-6: special_ad_categories adversarial shapes ─────────────────────────────

Deno.test("T-6: CREDIT hidden in a mixed array is still rejected", () => {
  const r = validateSpecialAdCategories(["NONE", "HOUSING", "CREDIT"]);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.detail, "special_ad_category_credit_retired");
});

Deno.test("T-6: lowercase 'credit' and other unknowns are rejected (no case folding)", () => {
  const r = validateSpecialAdCategories(["credit"]);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.detail, "special_ad_categories_unknown");
});

Deno.test("T-6: non-string members / nested arrays / objects are rejected", () => {
  assertEquals(validateSpecialAdCategories([123]).ok, false);
  assertEquals(validateSpecialAdCategories([["CREDIT"]]).ok, false);
  assertEquals(validateSpecialAdCategories({ 0: "HOUSING" }).ok, false);
  assertEquals(validateSpecialAdCategories("HOUSING").ok, false);
});

// ── T-7: destination-policy source trap (A4.f / PROOF D-P1) ───────────────────

const CREATE_FN_PATH = new URL(
  "../../admin-ad-create-campaign/index.ts",
  import.meta.url,
);

Deno.test("T-7: destSmartLink flows ONLY to the DB insert — never into creative/adapter input", async () => {
  const src = await Deno.readTextFile(CREATE_FN_PATH);
  // Every non-declaration use of the smart link must be the dest_smart_link
  // DB column assignment. If someone re-promotes the OneLink to the creative
  // link (reverting A4.f to A1), a new usage appears and this fails.
  const uses = src.match(/destSmartLink/g) ?? [];
  const declaration = src.match(/const destSmartLink\s*=/g) ?? [];
  const dbInsert = src.match(/dest_smart_link:\s*destSmartLink/g) ?? [];
  assertEquals(declaration.length, 1, "exactly one destSmartLink declaration");
  assertEquals(dbInsert.length, 1, "exactly one DB-insert use");
  assertEquals(
    uses.length,
    declaration.length + dbInsert.length,
    "destSmartLink has a usage beyond declaration + dest_smart_link insert — " +
      "the OneLink may NEVER reach the platform (A4.f, PROOF D-P1: AppsFlyer " +
      "serves crawlers an app-install interstitial = cloaking pattern).",
  );
  // The creative input must be wired to destUrl.
  assert(
    /creativeInput\s*=\s*{\s*\n?\s*destUrl/m.test(src) || /destUrl,\s*\/\/ A4\.f/.test(src),
    "creativeInput must carry destUrl as the ad-visible destination",
  );
});

Deno.test("T-7: _shared/meta.ts never references the OneLink host or onelink.me", async () => {
  const src = await Deno.readTextFile(new URL("../meta.ts", import.meta.url));
  assert(!src.includes("go.usemingla.com"), "meta adapter must not carry the smart-link host");
  assert(!src.includes("onelink"), "meta adapter must not reference OneLink at all");
  assert(!src.includes("minglabiz"), "the dead business OneLink must never appear (COMMS-0100/0101)");
});

// ── T-8: atomic-create step-4 failure + missing-rollback-hook honesty ─────────

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-00000000t862",
  platform: "meta",
  lane: "consumer",
  display_name: "tester",
  external_account_id: "acct",
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

const INPUT = {
  campaign: { name: "c", objective: "OUTCOME_TRAFFIC", dailyBudgetCents: 500 },
  adSet: {
    name: "s",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
    targeting: {},
  },
  creative: { destUrl: "https://host.usemingla.com/e/b/e", message: "m" },
  ad: { name: "a" },
};

function adapterWith(overrides: Partial<ChannelAdapter>, calls: string[]): ChannelAdapter {
  return {
    platform: "meta",
    // deno-lint-ignore require-await
    connect: async () => ({ platform: "meta" }),
    // deno-lint-ignore require-await
    createCampaign: async () => {
      calls.push("campaign");
      return { externalId: "camp_t8", status: "PAUSED" };
    },
    // deno-lint-ignore require-await
    createAdSet: async () => {
      calls.push("adset");
      return { externalId: "adset_t8" };
    },
    // deno-lint-ignore require-await
    createCreative: async () => {
      calls.push("creative");
      return { externalCreativeId: "cr_t8" };
    },
    // deno-lint-ignore require-await
    createAd: async () => {
      calls.push("ad");
      return { externalId: "ad_t8", reviewStatus: null };
    },
    // deno-lint-ignore require-await
    setStatus: async () => {},
    // deno-lint-ignore require-await
    getStatus: async () => ({ status: "PAUSED", effectiveStatus: "PAUSED" }),
    // deno-lint-ignore require-await
    setBudget: async () => {},
    // deno-lint-ignore require-await
    rollbackCampaign: async () => {
      calls.push("rollback");
    },
    ...overrides,
  };
}

Deno.test("T-8: step-4 (ad) failure — rollback runs EXACTLY once, partial IDs carry all three earlier IDs", async () => {
  const calls: string[] = [];
  const adapter = adapterWith({
    // deno-lint-ignore require-await
    createAd: async () => {
      calls.push("ad");
      throw new Error("ad create failed at the platform");
    },
  }, calls);
  const err = await assertRejects(
    () => createFullCampaignAtomic(adapter, CONN, INPUT),
    AtomicCreateError,
  );
  assertEquals(err.failure.step, "ad");
  assertEquals(err.failure.rollbackSucceeded, true);
  assertEquals(err.failure.partialExternalIds.external_campaign_id, "camp_t8");
  assertEquals(err.failure.partialExternalIds.external_adset_id, "adset_t8");
  assertEquals(err.failure.partialExternalIds.external_creative_id, "cr_t8");
  assertEquals(
    calls.filter((c) => c === "rollback").length,
    1,
    "compensating rollback must run exactly once — a double-delete would 400 and mask state",
  );
});

Deno.test("T-8: adapter WITHOUT rollbackCampaign — failure reports rollbackSucceeded=false, never true", async () => {
  const calls: string[] = [];
  const base = adapterWith({
    // deno-lint-ignore require-await
    createAdSet: async () => {
      calls.push("adset");
      throw new Error("adset failed");
    },
  }, calls);
  // Strip the rollback hook (google-style adapter).
  const { rollbackCampaign: _drop, ...noRollback } = base;
  const err = await assertRejects(
    () => createFullCampaignAtomic(noRollback as ChannelAdapter, CONN, INPUT),
    AtomicCreateError,
  );
  assertEquals(err.failure.step, "ad_set");
  assertEquals(
    err.failure.rollbackSucceeded,
    false,
    "a created campaign with no rollback hook is an ORPHAN — must surface false for manual reconciliation",
  );
  assertEquals(err.failure.partialExternalIds.external_campaign_id, "camp_t8");
});

// ── T-9: CBO safety pins ──────────────────────────────────────────────────────

Deno.test("T-9: ad-set builder emits NO budget field when budgetCents is absent (CBO)", () => {
  const body = buildMetaAdSetBody("camp_1", {
    name: "s",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
    targeting: {},
  });
  assertEquals("daily_budget" in body, false, "CBO ad set must not carry a budget");
  assertEquals("lifetime_budget" in body, false);
});

Deno.test("T-9: dailyBudgetCents=0 is non-CBO — M-13 flag present, no zero budget sent", () => {
  const body = buildMetaCampaignBody({ name: "c", objective: "OUTCOME_TRAFFIC", dailyBudgetCents: 0 });
  assertEquals(body.daily_budget, undefined, "a zero budget must never be sent to Meta");
  assertEquals(body.is_adset_budget_sharing_enabled, false, "non-CBO requires the M-13 flag");
});

Deno.test("T-9: creative builder — image_hash wins over image_url when both are supplied", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://host.usemingla.com/e/b/e",
    message: "m",
    imageHash: "hash_1",
    imageUrl: "https://img.example/x.jpg",
  });
  const spec = body.object_story_spec as Record<string, Record<string, unknown>>;
  assertEquals(spec.link_data.image_hash, "hash_1");
  assertEquals("picture" in spec.link_data, false, "hash and URL must never both be sent");
});
