/**
 * ISSUE-862 WP1 — adChannel.ts unit tests (implementor happy-path suite).
 *
 * Covers the A4.a mandatory tests:
 *   - money: $5.00 → 5,000,000 micro and $20.00 → 20,000,000 micro (GR-01,
 *     the 10,000x bug); TikTok cents→dollars; Meta identity.
 *   - CTA maps: the Reddit CTA is NEVER uppercased (Title-Case display
 *     strings — GR-29); Meta uses BUY_TICKETS (GET_TICKETS is not a real
 *     enum value — M-11); Google has NO CTA map (RSA has no CTA field).
 *   - objective→optimization_goal matrix validation (M-2/M-3).
 *   - per-category budget-floor category mapping (A4.g — LINK_CLICKS is
 *     high-frequency ⇒ the $5 floor, not $1).
 *   - fail-close stubs: the four unbuilt adapters throw AdNotConnectedError.
 *   - createFullCampaignAtomic: §4.4b no-orphan contract (RT-2) — a step-2
 *     failure rolls the campaign back and persists NOTHING.
 *
 * Run: deno test --allow-env supabase/functions/_shared/__tests__/adChannel.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdConnectionRow,
  AdNotConnectedError,
  AtomicCreateError,
  centsToPlatformBudget,
  type ChannelAdapter,
  createFullCampaignAtomic,
  getAdapter,
  isMetaGoalValidForObjective,
  META_CTA_MAP,
  META_OBJECTIVE_GOAL_MATRIX,
  metaBudgetCategoryForGoal,
  PLATFORM_CTA_MAPS,
  REDDIT_CTA_MAP,
  SNAPCHAT_CTA_MAP,
} from "../adChannel.ts";

// ── Money (A4.a mandatory) ────────────────────────────────────────────────────

Deno.test("money: $5.00 (500¢) → 5,000,000 micro on snapchat/google/reddit", () => {
  assertEquals(centsToPlatformBudget("snapchat", 500), 5_000_000);
  assertEquals(centsToPlatformBudget("google", 500), 5_000_000);
  assertEquals(centsToPlatformBudget("reddit", 500), 5_000_000);
});

Deno.test("money: $20.00 (2,000¢) → 20,000,000 micro", () => {
  assertEquals(centsToPlatformBudget("google", 2_000), 20_000_000);
  assertEquals(centsToPlatformBudget("snapchat", 2_000), 20_000_000);
});

Deno.test("money: TikTok converts cents → dollars (÷100)", () => {
  assertEquals(centsToPlatformBudget("tiktok", 2_000), 20);
  assertEquals(centsToPlatformBudget("tiktok", 500), 5);
});

Deno.test("money: Meta is the identity conversion (cents stay cents)", () => {
  assertEquals(centsToPlatformBudget("meta", 500), 500);
  assertEquals(centsToPlatformBudget("meta", 4_000), 4_000);
});

Deno.test("money: rejects non-integer / zero / negative cents", () => {
  assertThrows(() => centsToPlatformBudget("meta", 5.5));
  assertThrows(() => centsToPlatformBudget("google", 0));
  assertThrows(() => centsToPlatformBudget("reddit", -100));
});

// ── CTA maps (GR-29) ──────────────────────────────────────────────────────────

Deno.test("CTA: the Reddit CTA is NEVER uppercased (Title-Case display strings)", () => {
  for (const [offering, cta] of Object.entries(REDDIT_CTA_MAP)) {
    assert(
      cta !== cta.toUpperCase(),
      `REDDIT_CTA_MAP.${offering} = "${cta}" must be Title-Case, never SCREAMING_CASE — a shared toUpperCase() normalizer 400s on Reddit (GR-29).`,
    );
    assert(
      !cta.includes("_"),
      `REDDIT_CTA_MAP.${offering} = "${cta}" must be a display string with spaces, not a snake_case enum.`,
    );
  }
  assertEquals(REDDIT_CTA_MAP.ticketed_event, "Buy Tickets");
  assertEquals(REDDIT_CTA_MAP.restaurant, "See Menu");
});

Deno.test("CTA: Meta ticketed events use BUY_TICKETS (GET_TICKETS is not a real enum — M-11)", () => {
  assertEquals(META_CTA_MAP.ticketed_event, "BUY_TICKETS");
  for (const cta of Object.values(META_CTA_MAP)) {
    assert(cta !== "GET_TICKETS", "GET_TICKETS is not a real Meta enum value");
  }
});

Deno.test("CTA: Google has NO CTA map (RSA has no CTA field)", () => {
  assertEquals(PLATFORM_CTA_MAPS.google, undefined);
  assert(PLATFORM_CTA_MAPS.meta !== undefined);
  assert(PLATFORM_CTA_MAPS.reddit !== undefined);
});

Deno.test("CTA: Snapchat never uses VIEW_MORE (invalid on every Snap type)", () => {
  for (const cta of Object.values(SNAPCHAT_CTA_MAP)) {
    assert(cta !== "VIEW_MORE", "VIEW_MORE is not a valid Snapchat CTA — creative create would reject");
  }
});

// ── Objective → goal matrix (M-2/M-3) ─────────────────────────────────────────

Deno.test("matrix: OUTCOME_TRAFFIC accepts LINK_CLICKS (default) and LANDING_PAGE_VIEWS", () => {
  assert(isMetaGoalValidForObjective("OUTCOME_TRAFFIC", "LINK_CLICKS"));
  assert(isMetaGoalValidForObjective("OUTCOME_TRAFFIC", "LANDING_PAGE_VIEWS"));
  assertEquals(META_OBJECTIVE_GOAL_MATRIX.OUTCOME_TRAFFIC[0], "LINK_CLICKS");
});

Deno.test("matrix: incompatible goals are rejected client-side (Meta silently auto-corrects — M-3)", () => {
  assertEquals(isMetaGoalValidForObjective("OUTCOME_TRAFFIC", "APP_INSTALLS"), false);
  assertEquals(isMetaGoalValidForObjective("OUTCOME_AWARENESS", "LINK_CLICKS"), false);
  assertEquals(isMetaGoalValidForObjective("NOT_AN_OBJECTIVE", "LINK_CLICKS"), false);
});

Deno.test("matrix: all six ODAX objectives are present", () => {
  assertEquals(Object.keys(META_OBJECTIVE_GOAL_MATRIX).length, 6);
});

// ── Budget-floor categories (A4.g / PROOF M-P8) ───────────────────────────────

Deno.test("floors: LINK_CLICKS is high-frequency (the $5 floor, not $1)", () => {
  assertEquals(metaBudgetCategoryForGoal("LINK_CLICKS"), "high_freq");
});

Deno.test("floors: category mapping per goal class", () => {
  assertEquals(metaBudgetCategoryForGoal("IMPRESSIONS"), "imp");
  assertEquals(metaBudgetCategoryForGoal("REACH"), "imp");
  assertEquals(metaBudgetCategoryForGoal("THRUPLAY"), "video_views");
  assertEquals(metaBudgetCategoryForGoal("OFFSITE_CONVERSIONS"), "low_freq");
  assertEquals(metaBudgetCategoryForGoal("VALUE"), "low_freq");
});

// ── Fail-close stubs ──────────────────────────────────────────────────────────

const CONN_STUB: AdConnectionRow = {
  id: "00000000-0000-0000-0000-000000000000",
  platform: "reddit",
  lane: "consumer",
  display_name: "stub",
  external_account_id: "stub",
  external_org_id: null,
  auth_kind: "refresh_token",
  token_env_var: "REDDIT_ADS_REFRESH_TOKEN",
  extra: {},
  status: "unknown",
  currency: null,
  timezone: null,
  min_daily_budget_cents: null,
  account_status: null,
  token_last_verified_at: null,
  connected: false,
};

Deno.test("registry: the four unbuilt adapters fail-close with AdNotConnectedError", async () => {
  for (const platform of ["tiktok", "snapchat", "google", "reddit"] as const) {
    const adapter = getAdapter(platform);
    assertEquals(adapter.platform, platform);
    await assertRejects(
      () => adapter.createCampaign({ ...CONN_STUB, platform }, { name: "x", objective: "y" }),
      AdNotConnectedError,
    );
    await assertRejects(
      () => adapter.connect({ ...CONN_STUB, platform }),
      AdNotConnectedError,
    );
  }
});

Deno.test("registry: meta resolves to the real adapter", () => {
  assertEquals(getAdapter("meta").platform, "meta");
  assert(typeof getAdapter("meta").createCreative === "function");
  assert(typeof getAdapter("meta").rollbackCampaign === "function");
});

// ── Atomic create (§4.4b no-orphan — RT-2) ────────────────────────────────────

function mockAdapter(overrides: Partial<ChannelAdapter> & { calls: string[] }): ChannelAdapter {
  const calls = overrides.calls;
  return {
    platform: "meta",
    // deno-lint-ignore require-await
    connect: async () => ({ platform: "meta" }),
    // deno-lint-ignore require-await
    createCampaign: async () => {
      calls.push("createCampaign");
      return { externalId: "camp_1", status: "PAUSED" };
    },
    // deno-lint-ignore require-await
    createAdSet: async () => {
      calls.push("createAdSet");
      return { externalId: "adset_1" };
    },
    // deno-lint-ignore require-await
    createCreative: async () => {
      calls.push("createCreative");
      return { externalCreativeId: "creative_1" };
    },
    // deno-lint-ignore require-await
    createAd: async () => {
      calls.push("createAd");
      return { externalId: "ad_1", reviewStatus: null };
    },
    // deno-lint-ignore require-await
    setStatus: async () => {},
    // deno-lint-ignore require-await
    getStatus: async () => ({ status: "PAUSED", effectiveStatus: "PAUSED" }),
    // deno-lint-ignore require-await
    setBudget: async () => {},
    // deno-lint-ignore require-await
    rollbackCampaign: async () => {
      calls.push("rollbackCampaign");
    },
    ...overrides,
  };
}

const ATOMIC_INPUT = {
  campaign: { name: "c", objective: "OUTCOME_TRAFFIC", dailyBudgetCents: 500 },
  adSet: {
    name: "s",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
    targeting: {},
  },
  creative: { destUrl: "https://business.usemingla.com/e/b/e", message: "m" },
  ad: { name: "a" },
};

Deno.test("atomic: happy path returns all four external IDs in create order", async () => {
  const calls: string[] = [];
  const adapter = mockAdapter({ calls });
  const result = await createFullCampaignAtomic(adapter, CONN_STUB, ATOMIC_INPUT);
  assertEquals(result.externalCampaignId, "camp_1");
  assertEquals(result.externalAdSetId, "adset_1");
  assertEquals(result.externalCreativeId, "creative_1");
  assertEquals(result.externalAdId, "ad_1");
  assertEquals(calls, ["createCampaign", "createAdSet", "createCreative", "createAd"]);
});

Deno.test("atomic (RT-2): step-2 ad-set failure rolls the campaign back — no orphans", async () => {
  const calls: string[] = [];
  const adapter = mockAdapter({
    calls,
    // deno-lint-ignore require-await
    createAdSet: async () => {
      calls.push("createAdSet");
      throw new Error("adset create failed");
    },
  });
  const err = await assertRejects(
    () => createFullCampaignAtomic(adapter, CONN_STUB, ATOMIC_INPUT),
    AtomicCreateError,
  );
  assertEquals(err.failure.step, "ad_set");
  assertEquals(err.failure.partialExternalIds.external_campaign_id, "camp_1");
  assertEquals(err.failure.rollbackSucceeded, true);
  assert(calls.includes("rollbackCampaign"), "compensating rollback must run");
  assert(!calls.includes("createAd"), "no later step may run after a failure");
});

Deno.test("atomic: rollback failure is reported for manual reconciliation (create_failed)", async () => {
  const calls: string[] = [];
  const adapter = mockAdapter({
    calls,
    // deno-lint-ignore require-await
    createCreative: async () => {
      calls.push("createCreative");
      throw new Error("creative create failed");
    },
    // deno-lint-ignore require-await
    rollbackCampaign: async () => {
      calls.push("rollbackCampaign");
      throw new Error("delete also failed");
    },
  });
  const err = await assertRejects(
    () => createFullCampaignAtomic(adapter, CONN_STUB, ATOMIC_INPUT),
    AtomicCreateError,
  );
  assertEquals(err.failure.step, "creative");
  assertEquals(err.failure.rollbackSucceeded, false);
  assertEquals(err.failure.partialExternalIds.external_adset_id, "adset_1");
});

Deno.test("atomic: campaign-step failure needs no rollback (nothing created)", async () => {
  const calls: string[] = [];
  const adapter = mockAdapter({
    calls,
    // deno-lint-ignore require-await
    createCampaign: async () => {
      calls.push("createCampaign");
      throw new Error("campaign create failed");
    },
  });
  const err = await assertRejects(
    () => createFullCampaignAtomic(adapter, CONN_STUB, ATOMIC_INPUT),
    AtomicCreateError,
  );
  assertEquals(err.failure.step, "campaign");
  assertEquals(err.failure.rollbackSucceeded, null);
  assert(!calls.includes("rollbackCampaign"));
});
