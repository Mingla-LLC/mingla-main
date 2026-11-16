// Issue #4238 — independent tester, final gate (branch 4238-host-ads-excellent).
//
// Different angles from the implementor suites (which pin single example
// values): exhaustive and property checks over whole ranges, exact time
// boundaries, hostile request bodies, and money that must add up across many
// operations.
//
//  1. Pay ↔ credit: across every credit amount up to 2,000,000 cents, paying
//     the shown minimum always buys at least that credit, and one cent less
//     never does (the Host never sees a figure that is too low or padded).
//  2. Floor lock across every app × goal × Meta billing floor table: only the
//     one-ad-set price ever comes back; never the old/staged figures.
//  3. Multi-app: paying the SUM of the per-app pay minimums always clears
//     every app's own credit minimum after the split (fee rounding across a
//     sum never leaves one app short).
//  4. Retarget split: one cent under 2F never adds the second ad set; at 2F
//     and above every ad set >= F and the parts add up exactly.
//  5. Goal ladder exact boundaries (3 days live, 5 days left, 24h retry,
//     pending/applied never switch twice).
//  6. Withdraw: many partial withdraws then the rest return EXACTLY what was
//     paid, fee included, with no rounding drift.
//  7. Ari: raise/lower suggestions stay inside floor(pay x 0.8..1.2) for
//     every amount; a request that carries suggestion_id can never smuggle
//     its own amount or a learning-reset acknowledgement.
//  8. Live edit: hostile keys (including "__proto__" from JSON) are refused by
//     name; exactly 20% passes during learning, 20% + 1 cent does not; an end
//     date change during learning always needs the confirm.
//  9. True stop reasons: sold out and a passed end date never share a class.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  allocateWithdrawFromLots,
  type AdCreditLotRemaining,
  creditCentsFromPay,
  feeCentsFromPay,
  hostMinimumPayCents,
} from "../adMoney.ts";
import {
  hostAdSetSplit,
  hostDailyMinimumCents,
  splitDailyWithMinimums,
} from "../adHostPlanRules.ts";
import {
  decideGoalPromotion,
  LADDER_RETRY_MS,
  type PromotionFacts,
} from "../adGoalLadder.ts";
import {
  hostLoweredTotalCents,
  hostRaisedTotalCents,
  hostSuggestionWithinCap,
  resolveSuggestedEdit,
  type HostAdSuggestion,
} from "../adSuggestion.ts";
import {
  hostLiveEditUnknownField,
  planHostLiveEdit,
  type HostLiveCampaign,
} from "../adHostLiveEdit.ts";
import { hostAdPauseClass } from "../hostAdNotices.ts";

const DAY = 86_400_000;

// Deterministic PRNG so a failure is reproducible.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

Deno.test("T1 pay<->credit: the shown pay minimum buys >= the credit, one cent less never does (1..2,000,000)", () => {
  for (let credit = 1; credit <= 2_000_000; credit++) {
    const pay = hostMinimumPayCents(credit);
    if (creditCentsFromPay(pay) < credit) {
      throw new Error(`pay ${pay} buys only ${creditCentsFromPay(pay)} < ${credit}`);
    }
    if (creditCentsFromPay(pay - 1) >= credit) {
      throw new Error(`pay ${pay} is padded: ${pay - 1} already buys ${credit}`);
    }
    // The fee is exactly what is left over, never negative.
    assert(feeCentsFromPay(pay) === pay - creditCentsFromPay(pay));
  }
});

Deno.test("T2 floor lock: every app x goal x Meta floor table gives only the one-ad-set price", () => {
  const meta = (floors: Record<string, number>) => ({
    currency: "USD",
    extra: { minimum_budgets: floors },
  });
  const tables = [
    { imp: 100, video_views: 100, high_freq: 500, low_freq: 4000 },
    { imp: 104, video_views: 100, high_freq: 520, low_freq: 4100 },
  ];
  for (const table of tables) {
    for (const goal of ["visits", "sales", "signups"] as const) {
      // Meta Host goals bill on impressions: never low_freq, never a stage sum.
      assertEquals(hostDailyMinimumCents("meta", meta(table), goal), table.imp);
    }
  }
  const usd = { currency: "USD", extra: {} };
  for (const goal of ["visits", "sales", "signups"] as const) {
    assertEquals(hostDailyMinimumCents("snapchat", usd, goal), 500);
    assertEquals(hostDailyMinimumCents("tiktok", usd, goal), 2000);
    assertEquals(hostDailyMinimumCents("reddit", usd, goal), 500);
    assertEquals(hostDailyMinimumCents("google", usd, goal), 0);
    // The old v1.3 and staged figures can never come back on any path.
    for (const platform of ["snapchat", "tiktok", "reddit", "meta"]) {
      const value = hostDailyMinimumCents(platform, platform === "meta" ? meta(tables[0]) : usd, goal);
      for (const banned of [4000, 5000, 991, 4991, 19991]) {
        assert(value !== banned, `${platform} ${goal} returned a banned figure ${banned}`);
      }
    }
  }
  // A non-USD account has no table figure: null (the caller says "unknown"),
  // never a USD number read as another currency.
  assertEquals(hostDailyMinimumCents("tiktok", { currency: "NGN", extra: {} }, "sales"), null);
});

Deno.test("T3 multi-app: paying the sum of pay minimums clears every app's credit minimum after the split", () => {
  const next = rng(4238);
  const apps = ["meta", "snapchat", "tiktok", "reddit"];
  for (let i = 0; i < 20_000; i++) {
    const chosen = apps.filter(() => next() < 0.6);
    if (chosen.length === 0) continue;
    // Random credit minimums (as after FX), in the brand's money.
    const mins: Record<string, number> = {};
    for (const p of chosen) mins[p] = 1 + Math.floor(next() * 500_000);
    const payTotal = chosen.reduce((sum, p) => sum + hostMinimumPayCents(mins[p]), 0);
    const creditTotal = creditCentsFromPay(payTotal);
    const parts = splitDailyWithMinimums(creditTotal, chosen, mins);
    assertEquals(parts.reduce((a, b) => a + b, 0), creditTotal, "parts add up");
    chosen.forEach((p, index) => {
      if (parts[index] < mins[p]) {
        throw new Error(`${p} got ${parts[index]} < minimum ${mins[p]} (pay ${payTotal})`);
      }
    });
  }
});

Deno.test("T4 retarget split: 2F-1 is one ad set; at >= 2F every ad set >= F and the parts add up", () => {
  const ready = { audienceReady: true, buyerExclusionReady: true };
  for (const floor of [100, 500, 2000, 1883]) {
    const below = hostAdSetSplit("meta", 2 * floor - 1, floor, ready);
    assertEquals(below.ad_sets, 1);
    assertEquals(below.prospecting_cents, 2 * floor - 1);
    for (let spend = 2 * floor; spend <= 12 * floor; spend += Math.max(1, Math.floor(floor / 7))) {
      for (const platform of ["meta", "snapchat", "tiktok"]) {
        const split = hostAdSetSplit(platform, spend, floor, ready);
        assertEquals(split.ad_sets, 2);
        assertEquals(split.prospecting_cents + split.retarget_cents, spend);
        assert(split.prospecting_cents >= floor, `prospecting ${split.prospecting_cents} < F ${floor}`);
        assert(split.retarget_cents >= floor, `retarget ${split.retarget_cents} < F ${floor}`);
      }
    }
    // Never without the buyer exclusion, never on a run total, never Reddit/Google.
    assertEquals(hostAdSetSplit("meta", 10 * floor, floor, { audienceReady: true, buyerExclusionReady: false }).ad_sets, 1);
    assertEquals(hostAdSetSplit("meta", 10 * floor, floor, ready, "lifetime").ad_sets, 1);
    assertEquals(hostAdSetSplit("reddit", 10 * floor, floor, ready).ad_sets, 1);
    assertEquals(hostAdSetSplit("google", 10 * floor, floor, ready).ad_sets, 1);
  }
});

Deno.test("T5 goal ladder: exact boundaries; pending/applied never switch twice", () => {
  const live = Date.UTC(2026, 10, 1);
  const base: PromotionFacts = {
    platform: "meta",
    stage: "checkout_first",
    purchases7d: 25,
    liveSinceMs: live,
    endsAtMs: live + 30 * DAY,
    nowMs: live + 3 * DAY,
    existing: null,
  };
  assertEquals(decideGoalPromotion(base), { promote: true });
  assertEquals(decideGoalPromotion({ ...base, nowMs: live + 3 * DAY - 1 }).promote, false);
  assertEquals(decideGoalPromotion({ ...base, purchases7d: 24.999 }).promote, false);
  assertEquals(decideGoalPromotion({ ...base, purchases7d: Number.NaN }).promote, false);
  assertEquals(decideGoalPromotion({ ...base, purchases7d: Number.POSITIVE_INFINITY }).promote, false);
  // Exactly 5 days left still switches; 1 ms less does not.
  assertEquals(decideGoalPromotion({ ...base, endsAtMs: base.nowMs + 5 * DAY }).promote, true);
  assertEquals(decideGoalPromotion({ ...base, endsAtMs: base.nowMs + 5 * DAY - 1 }).promote, false);
  // Never twice: a pending or applied row blocks forever, whatever the clock.
  for (const status of ["pending", "applied"] as const) {
    for (const ago of [0, DAY, 365 * DAY]) {
      const decision = decideGoalPromotion({ ...base, existing: { status, atMs: base.nowMs - ago } });
      assertEquals(decision, { promote: false, reason: "already_switched" });
    }
  }
  // A failed row retries only after a full day.
  assertEquals(
    decideGoalPromotion({ ...base, existing: { status: "failed", atMs: base.nowMs - LADDER_RETRY_MS + 1 } }),
    { promote: false, reason: "retry_tomorrow" },
  );
  assertEquals(
    decideGoalPromotion({ ...base, existing: { status: "failed", atMs: base.nowMs - LADDER_RETRY_MS } }),
    { promote: true },
  );
  // Already on Purchase, or a non-ladder app: never.
  assertEquals(decideGoalPromotion({ ...base, stage: "purchase" }).promote, false);
  for (const platform of ["tiktok", "snapchat", "reddit", "google"] as const) {
    assertEquals(decideGoalPromotion({ ...base, platform }).promote, false);
  }
});

Deno.test("T6 withdraw: random partial withdraws then the rest return exactly what was paid, fee included", () => {
  const next = rng(9);
  for (let round = 0; round < 500; round++) {
    const lots: AdCreditLotRemaining[] = [];
    let paid = 0;
    let fee = 0;
    const count = 1 + Math.floor(next() * 5);
    for (let i = 0; i < count; i++) {
      const pay = 500 + Math.floor(next() * 5_000_000);
      const credit = creditCentsFromPay(pay);
      lots.push({
        id: `lot-${i}`,
        credit_remaining_cents: credit,
        pay_remaining_cents: pay,
        fee_remaining_cents: pay - credit,
      });
      paid += pay;
      fee += pay - credit;
    }
    let refunded = 0;
    let feeBack = 0;
    for (let step = 0; step < 6; step++) {
      const left = lots.reduce((sum, lot) => sum + lot.credit_remaining_cents, 0);
      if (left <= 0) break;
      const take = step === 5 ? left : Math.max(1, Math.floor(next() * left));
      const result = allocateWithdrawFromLots(lots, take);
      assert(result.ok, "withdraw allocates");
      if (!result.ok) return;
      for (const a of result.allocations) {
        const lot = lots.find((item) => item.id === a.lot_id)!;
        assertEquals(a.pay_cents, a.credit_cents + a.fee_cents, "pay = credit + fee per slice");
        assert(a.fee_cents >= 0 && a.fee_cents <= lot.fee_remaining_cents, "fee within the lot");
        lot.credit_remaining_cents -= a.credit_cents;
        lot.pay_remaining_cents -= a.pay_cents;
        lot.fee_remaining_cents -= a.fee_cents;
        assert(lot.pay_remaining_cents >= lot.credit_remaining_cents, "lot never owes more than paid");
      }
      refunded += result.refund_cents;
      feeBack += result.fee_returned_cents;
    }
    assertEquals(refunded, paid, `round ${round}: everything paid comes back`);
    assertEquals(feeBack, fee, `round ${round}: the whole fee share comes back`);
  }
});

Deno.test("T7 Ari: raise/lower stay inside floor(pay x 0.8..1.2) for every amount, and move the right way", () => {
  for (let current = 100; current <= 400_000; current += 37) {
    const up = hostRaisedTotalCents(current);
    const down = hostLoweredTotalCents(current);
    assert(hostSuggestionWithinCap(current, up), `raise ${up} outside cap for ${current}`);
    assert(hostSuggestionWithinCap(current, down), `lower ${down} outside cap for ${current}`);
    assert(up >= current && down <= current, `direction for ${current}`);
    // The pay change shown never exceeds 20% of what the Host pays now.
    const pay = hostMinimumPayCents(current);
    assert(hostMinimumPayCents(up) <= Math.floor((pay * 12) / 10));
  }
  // Garbage never passes the cap.
  for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assertEquals(hostSuggestionWithinCap(10_000, bad), false);
    assertEquals(hostSuggestionWithinCap(bad, 10_000), false);
  }
});

Deno.test("T7b Ari: a suggestion_id body can never carry its own amount, end date or learning acknowledgement", () => {
  const now = Date.UTC(2026, 10, 16);
  const suggestion: HostAdSuggestion = {
    suggestion_id: "s-1",
    kind: "raise_budget",
    apply_action: "change_live",
    host_budget_cents: 11_900,
    days_live: 10,
    basis: {
      results: 5,
      cost_per_result_cents: 100,
      guidance_mid_cents: 120,
      guidance_high_cents: 200,
      stock_left: null,
    },
  };
  const ctx = { currentTotalCents: 10_000, liveSinceMs: now - 10 * DAY, nowMs: now };
  const hostile = {
    suggestion_id: "s-1",
    new_budget_cents: 9_999_999,
    new_ends_at: "2027-12-31T00:00:00Z",
    acknowledge_learning_reset: true,
  };
  const ok = resolveSuggestedEdit(hostile, suggestion, ctx);
  assert(ok.ok);
  if (ok.ok) {
    assertEquals(ok.change.newHostBudgetCents, 11_900);
    assertEquals(ok.change.newEndsAt, null);
    assertEquals(ok.change.acknowledgeLearningReset, false);
  }
  // A stored suggestion outside the cap (stale maths) is refused, not applied.
  const over = resolveSuggestedEdit(hostile, { ...suggestion, host_budget_cents: 50_000 }, ctx);
  assertEquals(over, { ok: false, status: 422, error: "ad_suggestion_over_cap" });
  // A different / missing / non-string id is stale.
  for (const id of ["s-2", "", 1, null]) {
    const stale = resolveSuggestedEdit({ ...hostile, suggestion_id: id }, suggestion, ctx);
    assertEquals(stale.ok, false);
  }
  // Inside the 7-day learning window (1 ms short) Ari never moves the budget.
  const learning = resolveSuggestedEdit(hostile, suggestion, { ...ctx, liveSinceMs: now - 7 * DAY + 1 });
  assertEquals(learning, { ok: false, status: 409, error: "ad_suggestion_learning" });
  assertEquals(
    resolveSuggestedEdit(hostile, suggestion, { ...ctx, liveSinceMs: null }).ok,
    false,
  );
});

function liveCampaign(over: Partial<HostLiveCampaign> = {}): HostLiveCampaign {
  return {
    id: "c1",
    platform: "meta",
    host_budget_cents: 100_000,
    host_delivery_budget_cents: 10_000,
    provider_budget_cents: 100_000,
    provider_delivery_budget_cents: 10_000,
    current_cap_cents: 100_000,
    current_daily_cents: 10_000,
    provider_spend_cents: 20_000,
    provider_daily_minimum_cents: 100,
    ...over,
  };
}

Deno.test("T8 live edit: hostile keys refused by name, including __proto__ from JSON", () => {
  const base = { action: "change_live", brand_id: "b", plan_id: "p", new_budget_cents: 1 };
  for (const key of ["targeting", "goal", "creative_library_id", "platforms", "countries", "age_min", "copy", "new_daily_cents", "budget_mode"]) {
    assertEquals(hostLiveEditUnknownField({ ...base, [key]: 1 }), key);
  }
  const parsed = JSON.parse('{"action":"change_live","__proto__":{"x":1},"plan_id":"p"}');
  assertEquals(hostLiveEditUnknownField(parsed), "__proto__");
  assertEquals(hostLiveEditUnknownField({ ...base, suggestion_id: "s", acknowledge_learning_reset: true, idempotency_key: "k", new_ends_at: null }), null);
});

Deno.test("T8b live edit learning: exactly 20% passes, 20% + 1 cent refuses, an end move always needs the confirm", () => {
  const now = Date.UTC(2026, 10, 16);
  const common = {
    planState: "live",
    lastEditAt: null,
    nowMs: now,
    newEndsAt: null,
    currentHostBudgetCents: 100_000,
    currentEndsAt: new Date(now + 10 * DAY).toISOString(),
    lastBookableAt: new Date(now + 20 * DAY).toISOString(),
    hostSpendCents: 20_000,
    campaigns: [liveCampaign()],
    liveSinceMs: now - 2 * DAY,
  };
  const exact = planHostLiveEdit({ ...common, newHostBudgetCents: 120_000 });
  assert(exact.ok, "exactly 20% passes without the confirm");
  const over = planHostLiveEdit({ ...common, newHostBudgetCents: 120_001 });
  assertEquals(over.ok, false);
  if (!over.ok) assertEquals(over.error, "host_ad_live_edit_learning_reset");
  const down = planHostLiveEdit({ ...common, newHostBudgetCents: 79_999 });
  assertEquals(down.ok, false);
  const moveEnd = planHostLiveEdit({
    ...common,
    newHostBudgetCents: null,
    newEndsAt: new Date(now + 11 * DAY).toISOString(),
  });
  assertEquals(moveEnd.ok, false);
  if (!moveEnd.ok) assertEquals(moveEnd.error, "host_ad_live_edit_learning_reset");
  // With the confirm it goes through; after day 7 no confirm is needed.
  assert(planHostLiveEdit({ ...common, newHostBudgetCents: 150_000, acknowledgeLearningReset: true }).ok);
  assert(planHostLiveEdit({ ...common, newHostBudgetCents: 150_000, liveSinceMs: now - 7 * DAY }).ok);
  // Once a day: 1 ms short of 24h refuses.
  const twice = planHostLiveEdit({ ...common, newHostBudgetCents: 110_000, lastEditAt: new Date(now - DAY + 1).toISOString() });
  assertEquals(twice.ok, false);
  // Never at or under spend; never past the last bookable day.
  assertEquals(planHostLiveEdit({ ...common, newHostBudgetCents: 20_000, liveSinceMs: null }).ok, false);
  assertEquals(
    planHostLiveEdit({ ...common, newHostBudgetCents: null, liveSinceMs: null, newEndsAt: new Date(now + 21 * DAY).toISOString() }).ok,
    false,
  );
});

Deno.test("T8c live edit: the caps never add up to more than the new total; a pushed daily never goes under the app minimum", () => {
  const now = Date.UTC(2026, 10, 16);
  const next = rng(77);
  for (let i = 0; i < 2_000; i++) {
    const spendA = Math.floor(next() * 30_000);
    const spendB = Math.floor(next() * 30_000);
    const newTotal = spendA + spendB + 1 + Math.floor(next() * 400_000);
    const plan = planHostLiveEdit({
      planState: "live",
      lastEditAt: null,
      nowMs: now,
      newHostBudgetCents: newTotal,
      newEndsAt: null,
      currentHostBudgetCents: 100_000,
      currentEndsAt: new Date(now + 10 * DAY).toISOString(),
      lastBookableAt: null,
      hostSpendCents: spendA + spendB,
      liveSinceMs: null,
      campaigns: [
        liveCampaign({ id: "a", provider_spend_cents: spendA, provider_daily_minimum_cents: null }),
        liveCampaign({ id: "b", platform: "tiktok", provider_spend_cents: spendB, provider_daily_minimum_cents: null, host_budget_cents: 50_000, provider_budget_cents: 50_000 }),
      ],
    });
    if (!plan.ok) continue;
    const caps = plan.lines.reduce((sum, line) => sum + line.new_provider_budget_cents, 0);
    assert(caps <= newTotal, `caps ${caps} > new total ${newTotal}`);
    for (const line of plan.lines) {
      assert(line.new_provider_delivery_budget_cents <= line.new_provider_budget_cents, "daily never above its cap");
    }
  }
  const low = planHostLiveEdit({
    planState: "live",
    lastEditAt: null,
    nowMs: now,
    newHostBudgetCents: 20_500,
    newEndsAt: null,
    currentHostBudgetCents: 100_000,
    currentEndsAt: new Date(now + 10 * DAY).toISOString(),
    lastBookableAt: null,
    hostSpendCents: 20_000,
    liveSinceMs: null,
    campaigns: [liveCampaign({ platform: "tiktok", provider_daily_minimum_cents: 2_000 })],
  });
  assertEquals(low.ok, false);
  if (!low.ok) assertEquals(low.error, "host_ad_live_edit_below_app_minimum");
});

Deno.test("T9 true stop reasons: sold out, a passed end and running out of credit never share a class", () => {
  assertEquals(hostAdPauseClass("sold_out"), "sold_out");
  assertEquals(hostAdPauseClass("end_date_passed"), "event_ended");
  assertEquals(hostAdPauseClass("event_ended"), "event_ended");
  assertEquals(hostAdPauseClass("cap_98_percent"), "credit_out");
  assertEquals(hostAdPauseClass(" sold_out "), "sold_out");
  for (const junk of [null, undefined, 1, "", "SOLD_OUT", "sold out", {}]) {
    assertEquals(hostAdPauseClass(junk), "unknown");
  }
});
