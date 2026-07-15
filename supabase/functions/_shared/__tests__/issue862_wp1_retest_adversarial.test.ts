/**
 * ISSUE-862 WP1 RETEST — tester adversarial additions (mingla-tester, 2026-07-15).
 *
 * Append-only NEW file. Two angles the rework suite (R-1…R-6) does not cover:
 *
 *   RT-A  bid_strategy PRESENCE under a hostile input grid — R-1 checks the
 *         happy-path bodies; this asserts the campaign body can never silently
 *         drop bid_strategy again via a DIFFERENT construction path (injected
 *         keys, validate-only, special-ad-category branches). Guards the exact
 *         P1-1 regression class (subcode 1815857, proven live both directions).
 *   RT-B  DOUBLE rollback failure honesty — when BOTH the creative delete and
 *         the campaign delete fail, the atomic engine must report both as
 *         false (create_failed path) and carry ALL partial ids for the audit
 *         row; the creative attempt must still happen FIRST.
 *
 * Run: deno test --allow-env \
 *   supabase/functions/_shared/__tests__/issue862_wp1_retest_adversarial.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  type AdConnectionRow,
  AtomicCreateError,
  type ChannelAdapter,
  createFullCampaignAtomic,
} from "../adChannel.ts";
import { buildMetaCampaignBody, META_DEFAULT_BID_STRATEGY } from "../meta.ts";

// ── RT-A: bid_strategy presence under hostile inputs ──────────────────────────

Deno.test("RT-A: every campaign body carries a non-empty bid_strategy across the hostile grid", () => {
  const grid = [
    { name: "a", objective: "OUTCOME_TRAFFIC" },
    { name: "b", objective: "OUTCOME_TRAFFIC", dailyBudgetCents: 500 },
    { name: "c", objective: "OUTCOME_SALES", specialAdCategories: ["HOUSING"] },
    { name: "d", objective: "OUTCOME_TRAFFIC", validateOnly: true },
    // hostile injected keys must not displace the explicit field
    // deno-lint-ignore no-explicit-any
    { name: "e", objective: "OUTCOME_TRAFFIC", bid_strategy: "LOWEST_COST_WITH_BID_CAP" } as any,
    // deno-lint-ignore no-explicit-any
    { name: "f", objective: "OUTCOME_TRAFFIC", status: "ACTIVE", execution_options: [] } as any,
  ];
  for (const input of grid) {
    const body = buildMetaCampaignBody(input);
    assertEquals(
      body.bid_strategy,
      META_DEFAULT_BID_STRATEGY,
      `campaign body for "${input.name}" must carry the explicit §4.4b bid strategy — ` +
        `omitting it kills every real ad-set create (subcode 1815857, QA P1-1)`,
    );
    assert(typeof body.bid_strategy === "string" && body.bid_strategy.length > 0);
    assertEquals(body.status, "PAUSED"); // the T-3 invariant must survive the P1-1 fix
  }
});

// ── RT-B: double rollback failure honesty ─────────────────────────────────────

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-0000000000rt",
  platform: "meta",
  lane: "consumer",
  display_name: "retest",
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

Deno.test("RT-B: creative AND campaign rollback both failing — both reported false, all ids carried, creative attempted first", async () => {
  const calls: string[] = [];
  const adapter: ChannelAdapter = {
    platform: "meta",
    // deno-lint-ignore require-await
    connect: async () => ({ platform: "meta" }),
    // deno-lint-ignore require-await
    createCampaign: async () => ({ externalId: "camp_rt", status: "PAUSED" }),
    // deno-lint-ignore require-await
    createAdSet: async () => ({ externalId: "adset_rt" }),
    // deno-lint-ignore require-await
    createCreative: async () => ({ externalCreativeId: "cr_rt" }),
    // deno-lint-ignore require-await
    createAd: async () => {
      throw new Error("ad create failed");
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
      throw new Error("campaign delete failed too");
    },
    // deno-lint-ignore require-await
    rollbackCreative: async () => {
      calls.push("rollbackCreative");
      throw new Error("creative delete failed (e.g. Meta 1487235)");
    },
  };
  const err = await assertRejects(
    () => createFullCampaignAtomic(adapter, CONN, {
      campaign: { name: "c", objective: "OUTCOME_TRAFFIC", dailyBudgetCents: 500 },
      adSet: { name: "s", optimizationGoal: "LINK_CLICKS", billingEvent: "IMPRESSIONS", targeting: {} },
      creative: { destUrl: "https://business.usemingla.com/e/b/e", message: "m" },
      ad: { name: "a" },
    }),
    AtomicCreateError,
  );
  assertEquals(err.failure.step, "ad");
  assertEquals(err.failure.rollbackSucceeded, false, "campaign residue must be reported");
  assertEquals(err.failure.creativeRollbackSucceeded, false, "creative residue must be reported");
  assertEquals(err.failure.partialExternalIds.external_campaign_id, "camp_rt");
  assertEquals(err.failure.partialExternalIds.external_adset_id, "adset_rt");
  assertEquals(err.failure.partialExternalIds.external_creative_id, "cr_rt");
  assertEquals(calls, ["rollbackCreative", "rollbackCampaign"], "creative attempt must come first");
});
