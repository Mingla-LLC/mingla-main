/**
 * ISSUE-862 WP1 REWORK — regression tests for the QA FAIL findings
 * (QA_ISSUE-862_WP1.md, tester verdict FAIL 1xP1).
 *
 * Append-only: NEW file; no implementor or tester test was modified.
 *
 *   R-1  P1-1  campaign body carries bid_strategy explicitly on BOTH the CBO
 *        and non-CBO branches (subcode 1815857 — proven live both directions).
 *        fails-on-revert: deleting the bid_strategy line in
 *        buildMetaCampaignBody fails R-1 (both tests).
 *   R-2  P1-1  bid_strategy input override passes through the builder.
 *   R-3  P2-3  lane-correct token resolution — a business-lane resolve with
 *        only the consumer secret set fail-closes (never a consumer fallback).
 *   R-4  P2-5  atomic rollback deletes the account-level creative via the new
 *        rollbackCreative hook (creative FIRST, then campaign); a missing/
 *        failing hook reports creativeRollbackSucceeded=false so the residue
 *        id lands in the audit row. Tester T-8 pins remain green (their mock
 *        has no rollbackCreative → residue honesty path).
 *   R-5  P3-8  normalizeMetaError scrubs EAA…-shaped token strings.
 *   R-6  P3-9  centsToPlatformBudget rejects cents above MAX_BUDGET_CENTS and
 *        stays exact AT the bound (tester T-1 boundary preserved).
 *
 * Run: deno test --allow-env \
 *   supabase/functions/_shared/__tests__/issue862_wp1_rework.test.ts
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
  MAX_BUDGET_CENTS,
} from "../adChannel.ts";
import {
  buildMetaCampaignBody,
  META_DEFAULT_BID_STRATEGY,
  metaDefaultTokenEnvVar,
  normalizeMetaError,
  resolveMetaToken,
  scrubMetaTokens,
} from "../meta.ts";

// ── R-1 (P1-1): bid_strategy explicit on BOTH branches ───────────────────────

Deno.test("R-1: CBO campaign body sends bid_strategy=LOWEST_COST_WITHOUT_CAP explicitly", () => {
  const body = buildMetaCampaignBody({
    name: "c",
    objective: "OUTCOME_TRAFFIC",
    dailyBudgetCents: 500,
  });
  assertEquals(
    body.bid_strategy,
    "LOWEST_COST_WITHOUT_CAP",
    "P1-1 (subcode 1815857): without an explicit campaign bid_strategy every real ad-set create dies with 'Bid amount required' — proven live both directions",
  );
  assertEquals(body.daily_budget, 500);
});

Deno.test("R-1: non-CBO campaign body ALSO sends bid_strategy explicitly (with the M-13 flag)", () => {
  const body = buildMetaCampaignBody({ name: "c", objective: "OUTCOME_TRAFFIC" });
  assertEquals(body.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
  assertEquals(body.is_adset_budget_sharing_enabled, false); // M-13 still holds
});

Deno.test("R-1: the default constant IS the §4.4b value", () => {
  assertEquals(META_DEFAULT_BID_STRATEGY, "LOWEST_COST_WITHOUT_CAP");
});

// ── R-2 (P1-1): input override passthrough ────────────────────────────────────

Deno.test("R-2: an explicit bidStrategy input passes through the builder", () => {
  const body = buildMetaCampaignBody({
    name: "c",
    objective: "OUTCOME_TRAFFIC",
    bidStrategy: "LOWEST_COST_WITHOUT_CAP",
  });
  assertEquals(body.bid_strategy, "LOWEST_COST_WITHOUT_CAP");
});

// ── R-3 (P2-3): lane-correct token resolution ─────────────────────────────────

Deno.test("R-3: business-lane default env-var NAME is the MINGLABIZ credential", () => {
  assertEquals(metaDefaultTokenEnvVar("consumer"), "META_SYSTEM_USER_TOKEN");
  assertEquals(metaDefaultTokenEnvVar("business"), "META_MINGLABIZ_SYSTEM_USER_TOKEN");
});

Deno.test("R-3: business-lane resolve with ONLY the consumer secret set fail-closes", () => {
  const priorConsumer = Deno.env.get("META_SYSTEM_USER_TOKEN");
  const priorBiz = Deno.env.get("META_MINGLABIZ_SYSTEM_USER_TOKEN");
  Deno.env.set("META_SYSTEM_USER_TOKEN", "consumer-token-present-but-wrong-lane");
  Deno.env.delete("META_MINGLABIZ_SYSTEM_USER_TOKEN");
  try {
    // No persisted row (first connect): the business lane must claim — and
    // verify — its OWN credential, never silently validate the consumer's.
    assertThrows(() => resolveMetaToken(null, "business"), AdNotConnectedError);
    // The consumer lane still resolves its own.
    assertEquals(
      resolveMetaToken(null, "consumer"),
      "consumer-token-present-but-wrong-lane",
    );
  } finally {
    if (priorConsumer !== undefined) Deno.env.set("META_SYSTEM_USER_TOKEN", priorConsumer);
    else Deno.env.delete("META_SYSTEM_USER_TOKEN");
    if (priorBiz !== undefined) Deno.env.set("META_MINGLABIZ_SYSTEM_USER_TOKEN", priorBiz);
  }
});

// ── R-4 (P2-5): creative rollback in the atomic engine ────────────────────────

const CONN: AdConnectionRow = {
  id: "00000000-0000-0000-0000-0000000000r2",
  platform: "meta",
  lane: "consumer",
  display_name: "rework",
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
  creative: { destUrl: "https://business.usemingla.com/e/b/e", message: "m" },
  ad: { name: "a" },
};

function reworkAdapter(overrides: Partial<ChannelAdapter>, calls: string[]): ChannelAdapter {
  return {
    platform: "meta",
    // deno-lint-ignore require-await
    connect: async () => ({ platform: "meta" }),
    // deno-lint-ignore require-await
    createCampaign: async () => {
      calls.push("campaign");
      return { externalId: "camp_r", status: "PAUSED" };
    },
    // deno-lint-ignore require-await
    createAdSet: async () => {
      calls.push("adset");
      return { externalId: "adset_r" };
    },
    // deno-lint-ignore require-await
    createCreative: async () => {
      calls.push("creative");
      return { externalCreativeId: "cr_r" };
    },
    // deno-lint-ignore require-await
    createAd: async () => {
      calls.push("ad");
      return { externalId: "ad_r", reviewStatus: null };
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
    // deno-lint-ignore require-await
    rollbackCreative: async () => {
      calls.push("rollbackCreative");
    },
    ...overrides,
  };
}

Deno.test("R-4: step-4 failure — creative rollback runs ONCE, BEFORE the campaign rollback", async () => {
  const calls: string[] = [];
  const adapter = reworkAdapter({
    // deno-lint-ignore require-await
    createAd: async () => {
      calls.push("ad");
      throw new Error("ad create failed");
    },
  }, calls);
  const err = await assertRejects(
    () => createFullCampaignAtomic(adapter, CONN, INPUT),
    AtomicCreateError,
  );
  assertEquals(err.failure.step, "ad");
  assertEquals(err.failure.rollbackSucceeded, true);
  assertEquals(
    err.failure.creativeRollbackSucceeded,
    true,
    "P2-5: the account-level creative must be deleted — campaign delete does NOT cascade it (proven live)",
  );
  assertEquals(calls.filter((c) => c === "rollbackCreative").length, 1);
  assert(
    calls.indexOf("rollbackCreative") < calls.indexOf("rollbackCampaign"),
    "creative cleanup must run while it is provably unreferenced (before campaign delete)",
  );
});

Deno.test("R-4: adapter WITHOUT rollbackCreative reports creative residue (false), never true", async () => {
  const calls: string[] = [];
  const base = reworkAdapter({
    // deno-lint-ignore require-await
    createAd: async () => {
      calls.push("ad");
      throw new Error("ad create failed");
    },
  }, calls);
  const { rollbackCreative: _drop, ...noCreativeRollback } = base;
  const err = await assertRejects(
    () => createFullCampaignAtomic(noCreativeRollback as ChannelAdapter, CONN, INPUT),
    AtomicCreateError,
  );
  assertEquals(err.failure.creativeRollbackSucceeded, false);
  assertEquals(
    err.failure.partialExternalIds.external_creative_id,
    "cr_r",
    "the residue id must be available for the audit row",
  );
});

Deno.test("R-4: pre-creative failure (step-2) — creativeRollbackSucceeded is null (nothing to clean)", async () => {
  const calls: string[] = [];
  const adapter = reworkAdapter({
    // deno-lint-ignore require-await
    createAdSet: async () => {
      calls.push("adset");
      throw new Error("adset failed");
    },
  }, calls);
  const err = await assertRejects(
    () => createFullCampaignAtomic(adapter, CONN, INPUT),
    AtomicCreateError,
  );
  assertEquals(err.failure.creativeRollbackSucceeded, null);
  assertEquals(calls.includes("rollbackCreative"), false);
});

// ── R-5 (P3-8): EAA token scrub ───────────────────────────────────────────────

Deno.test("R-5: normalizeMetaError scrubs EAA…-shaped tokens from provider messages", () => {
  const fakeToken = "EAA" + "Bws".repeat(20); // EAA + 60 chars — token-shaped, not a real credential
  const normalized = normalizeMetaError({
    error: { message: `Invalid OAuth access token ${fakeToken} provided`, code: 190 },
  });
  assert(!normalized.message.includes("EAA"), "no EAA-prefixed run may survive the scrub");
  assert(normalized.message.includes("[redacted]"));
  assertEquals(scrubMetaTokens("no tokens here"), "no tokens here");
});

// ── R-6 (P3-9): budget upper bound ────────────────────────────────────────────

Deno.test("R-6: cents above MAX_BUDGET_CENTS throw (micro precision guard)", () => {
  assertThrows(() => centsToPlatformBudget("google", MAX_BUDGET_CENTS + 1));
  assertThrows(() => centsToPlatformBudget("meta", MAX_BUDGET_CENTS + 1));
});

Deno.test("R-6: the tester's T-1 exactness boundary sits exactly AT the bound and passes", () => {
  assertEquals(MAX_BUDGET_CENTS, 900_719_925_474);
  assertEquals(centsToPlatformBudget("google", MAX_BUDGET_CENTS), 9_007_199_254_740_000);
});
