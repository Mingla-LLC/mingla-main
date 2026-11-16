/**
 * #4238 W5 (item 8 + amendment B item 8) — Ari's one suggestion on a running
 * Host ad, the server recompute (stale id, +20% cap in pay terms, no learning
 * bypass) and results in tickets.
 *
 * MINGLA-INVARIANT: I-4238-ARI-RAISE-CAP | issue #4238 | change_live with a suggestion_id recomputes the suggestion, applies only the recomputed amount, refuses ad_suggestion_stale / ad_suggestion_over_cap / ad_suggestion_learning, and never carries a learning-reset acknowledgement.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  hostAdResultCounts,
  hostAdSuggestion,
  type HostAdSuggestionInput,
  hostRaisedTotalCents,
  hostSuggestionWithinCap,
  resolveSuggestedEdit,
} from "../adSuggestion.ts";
import { hostMinimumPayCents } from "../adMoney.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T12:00:00Z");

function input(
  over: Partial<HostAdSuggestionInput> = {},
): HostAdSuggestionInput {
  return {
    planId: "11111111-1111-4111-8111-111111111111",
    planState: "live",
    nowMs: NOW,
    liveSinceMs: NOW - 8 * DAY, // day 9
    lastEditAt: null,
    goal: "sales",
    currency: "NGN",
    currentTotalCents: 4250, // pays 5,000
    currentEndsAt: "2026-11-30T20:00:00Z",
    lastBookableAt: "2026-11-30T20:00:00Z",
    spendCents: 2000,
    results: 10, // 200 per ticket
    resultsLast3Days: 3,
    costPerResult: { midCents: 300, highCents: 375 },
    stock: { remaining: 60, total: 100, unlimited: false },
    walletCents: 10_000,
    lastTicketsOffered: false,
    ...over,
  };
}

Deno.test("SC-8.1: day 9, cheap tickets, 60% left → raise 20% (pay ₦5,000 → ₦6,000)", async () => {
  const s = await hostAdSuggestion(input());
  assert(s);
  assertEquals(s.kind, "raise_budget");
  assertEquals(s.apply_action, "change_live");
  assertEquals(hostMinimumPayCents(4250), 5000);
  assertEquals(s.host_budget_cents, 5100);
  assertEquals(s.money?.new_total_pay_cents, 6000);
  assertEquals(s.money?.current_total_pay_cents, 5000);
  assertEquals(s.money?.change_pay_cents, 1000);
  assertEquals(s.money?.change_cents, 850);
  assertEquals(s.money?.change_fee_cents, 150);
  assertEquals(s.money?.fee_ratio, 0.15);
  assertEquals(s.suggestion_id.length, 40);
});

Deno.test("adversarial: day 3 has no suggestion (learning)", async () => {
  assertEquals(
    await hostAdSuggestion(input({ liveSinceMs: NOW - 2 * DAY })),
    null,
  );
  assertEquals(await hostAdSuggestion(input({ liveSinceMs: null })), null);
});

Deno.test("adversarial: only one suggestion ever comes back, first that applies", async () => {
  // Raise and extend both apply: raise wins; the result is one object.
  const s = await hostAdSuggestion(
    input({ currentEndsAt: "2026-11-20T20:00:00Z" }),
  );
  assertEquals(s?.kind, "raise_budget");
  assert(!Array.isArray(s));
  // No raise (pricey) → extend.
  const e = await hostAdSuggestion(input({
    currentEndsAt: "2026-11-20T20:00:00Z",
    spendCents: 3300,
  }));
  assertEquals(e?.kind, "extend_end");
  assertEquals(e?.ends_at, "2026-11-30T20:00:00.000Z");
  assertEquals(e?.host_budget_cents, undefined);
});

Deno.test("raise needs stock above 30%, enough left to absorb it, and wallet credit", async () => {
  const lowStock = await hostAdSuggestion(
    input({ stock: { remaining: 30, total: 100, unlimited: false } }),
  );
  assert(lowStock?.kind !== "raise_budget");
  const noWallet = await hostAdSuggestion(input({ walletCents: 100 }));
  assert(noWallet?.kind !== "raise_budget");
  const unknownStock = await hostAdSuggestion(input({ stock: null }));
  assert(unknownStock?.kind !== "raise_budget");
  const unlimited = await hostAdSuggestion(
    input({ stock: { remaining: null, total: null, unlimited: true } }),
  );
  assertEquals(unlimited?.kind, "raise_budget");
  // Extra spend 850 at 200 a ticket = 4.25 tickets: 4 left can't absorb it.
  const tiny = await hostAdSuggestion(
    input({ stock: { remaining: 4, total: 5, unlimited: false } }),
  );
  assert(tiny?.kind !== "raise_budget");
});

Deno.test("lower 20% when tickets cost over 1.5 × the guidance high; never below spend", async () => {
  const s = await hostAdSuggestion(
    input({
      spendCents: 3000,
      results: 3,
      currentEndsAt: "2026-11-30T20:00:00Z",
    }),
  );
  // 1,000 a ticket > 1.5 × 375.
  assertEquals(s?.kind, "lower_budget");
  assert(hostSuggestionWithinCap(4250, s!.host_budget_cents!));
  assert(s!.host_budget_cents! < 4250 && s!.host_budget_cents! > 3000);
});

Deno.test("once a day: a budget suggestion waits; last tickets and new video are offered", async () => {
  const s = await hostAdSuggestion(
    input({
      lastEditAt: new Date(NOW - 3_600_000).toISOString(),
      lastTicketsOffered: true,
    }),
  );
  assertEquals(s?.kind, "accept_last_tickets");
  assertEquals(s?.apply_action, "accept_last_tickets");
  const v = await hostAdSuggestion(
    input({
      lastEditAt: new Date(NOW - 3_600_000).toISOString(),
      resultsLast3Days: 0,
    }),
  );
  assertEquals(v?.kind, "new_video");
  assertEquals(v?.apply_action, null);
});

Deno.test("SC-B8 cap: exactly +20% pay passes; +21% and −21% are refused", () => {
  assert(hostSuggestionWithinCap(4250, 5100)); // 5,000 → 6,000
  const plus21 = 5143; // pays 6,051
  assertEquals(hostMinimumPayCents(plus21), 6051);
  assert(!hostSuggestionWithinCap(4250, plus21));
  const minus21 = 3357; // pays 3,950
  assertEquals(hostMinimumPayCents(minus21), 3950);
  assert(!hostSuggestionWithinCap(4250, minus21));
  // The raise never rounds over the cap (fee gross-up included).
  for (const credit of [100, 117, 999, 4250, 123_457]) {
    assert(
      hostSuggestionWithinCap(credit, hostRaisedTotalCents(credit)),
      String(credit),
    );
  }
});

Deno.test("SC-B8 / SC-8.2: forged amount ignored, stale id refused, learning never bypassed", async () => {
  const s = await hostAdSuggestion(input());
  const ctx = {
    currentTotalCents: 4250,
    liveSinceMs: NOW - 8 * DAY,
    nowMs: NOW,
  };
  const forged = resolveSuggestedEdit(
    {
      suggestion_id: s!.suggestion_id,
      new_budget_cents: 6800,
      acknowledge_learning_reset: true,
    },
    s,
    ctx,
  );
  assert(forged.ok);
  assertEquals(forged.change.newHostBudgetCents, 5100);
  assertEquals(forged.change.acknowledgeLearningReset, false);
  // The budget changed in between: the recompute has a new id.
  const moved = await hostAdSuggestion(input({ currentTotalCents: 4300 }));
  assert(moved && moved.suggestion_id !== s!.suggestion_id);
  const stale = resolveSuggestedEdit(
    { suggestion_id: s!.suggestion_id },
    moved,
    { ...ctx, currentTotalCents: 4300 },
  );
  assertEquals(stale, { ok: false, status: 409, error: "ad_suggestion_stale" });
  const tampered = resolveSuggestedEdit(
    { suggestion_id: "0".repeat(40) },
    s,
    ctx,
  );
  assertEquals(tampered, {
    ok: false,
    status: 409,
    error: "ad_suggestion_stale",
  });
  const gone = resolveSuggestedEdit(
    { suggestion_id: s!.suggestion_id },
    null,
    ctx,
  );
  assertEquals(gone, { ok: false, status: 409, error: "ad_suggestion_stale" });
  const early = resolveSuggestedEdit({ suggestion_id: s!.suggestion_id }, s, {
    ...ctx,
    liveSinceMs: NOW - 2 * DAY,
  });
  assertEquals(early, {
    ok: false,
    status: 409,
    error: "ad_suggestion_learning",
  });
  // An over-cap recompute (defence in depth) is refused.
  const over = resolveSuggestedEdit({ suggestion_id: s!.suggestion_id }, {
    ...s!,
    host_budget_cents: 5143,
  }, ctx);
  assertEquals(over, {
    ok: false,
    status: 422,
    error: "ad_suggestion_over_cap",
  });
  // The Host's own edit (no id) is unchanged: its amount and acknowledgement.
  const manual = resolveSuggestedEdit(
    { new_budget_cents: 9000, acknowledge_learning_reset: true },
    null,
    ctx,
  );
  assert(manual.ok);
  assertEquals(manual.change.newHostBudgetCents, 9000);
  assertEquals(manual.change.acknowledgeLearningReset, true);
});

Deno.test("SC-8.5: results are tickets, not orders (3 orders of 2 = 6); RSVP heads", () => {
  const counts = hostAdResultCounts({
    conversions: [
      { event_type: "purchase", order_id: "a" },
      { event_type: "purchase", order_id: "b" },
      { event_type: "purchase", order_id: "c" },
      { event_type: "reservation", event_id: "r1" },
      { event_type: "reservation", event_id: "r2" },
    ],
    ticketsByOrder: new Map([["a", 2], ["b", 2], ["c", 2]]),
    rsvpHeads: new Map([["r1", 3]]),
  });
  assertEquals(counts, { orders: 3, tickets: 6, sign_ups: 4 });
});

Deno.test("host-ad-campaign wiring: get returns the suggestion; change_live recomputes it", async () => {
  const src = await Deno.readTextFile(
    new URL("../../host-ad-campaign/index.ts", import.meta.url),
  );
  assert(src.includes("suggestion: w5.suggestion ?? null"));
  assert(src.includes("resolveSuggestedEdit("));
  assert(src.includes('"suggestion_id" in body ? await loadPlanSuggestion('));
  assert(
    src.includes(
      "planHostLiveEdit(liveEditInput(plan, ctx, nowMs, suggested.change))",
    ),
  );
  assert(src.includes("clicks_7d"));
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assert(
    plan.includes(
      "cost_per_result_high_cents: Math.round(costPerResult * BAND_HIGH)",
    ),
  );
});
