// MINGLA-INVARIANT: I-4238-GUIDANCE-ONE-SOURCE | issue #4238 | Host and Ari budget numbers come only from hostBudgetGuidance via ad-plan host_budget_guidance (Ari's get_ad_budget_guidance calls the same action); the old 1.6 x minimum rule is not used.
// Issue #4238 W1 item 2 — Host budget guidance: the minimum, the "enough to
// learn" budget and the expected results per week, in what the Host pays.
//
// @invariant I-4238-GUIDANCE-ONE-SOURCE
//   owner: supabase/functions/_shared/adResultEstimate.ts hostBudgetGuidance
//   rule: Host and Ari budget numbers come only from hostBudgetGuidance via
//         ad-plan host_budget_guidance (Ari's get_ad_budget_guidance calls the
//         same action); the old 1.6 x minimum rule is not used.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  benchmarkCostPerResultCents,
  blendedCostPerResultCents,
  hostBudgetGuidance,
  typicalPaidPriceCents,
} from "../adResultEstimate.ts";
import {
  BAND_HIGH,
  BAND_LOW,
  FALLBACK_CPC,
  LANDING_TO_RSVP,
  landingToTicket,
} from "../adResultBenchmarks.ts";
import { creditCentsFromPay, hostMinimumPayCents } from "../adMoney.ts";
import { buildHostBudgetGuidance } from "../../ad-plan/index.ts";

/** What the Host pays for $10/day of ad spend. */
const PAY_FOR_10_USD = 1177;

Deno.test("SC-2.1 USD, Meta sales, $10/day spend, $20 ticket, no own data", () => {
  assertEquals(creditCentsFromPay(PAY_FOR_10_USD), 1000);
  const result = hostBudgetGuidance({
    currency: "USD",
    goal: "sales",
    dailyPayCents: PAY_FOR_10_USD,
    priceUsd: 20,
    apps: [{ platform: "meta", minimumCreditCents: 100 }],
    own: null,
    stock: null,
  });
  assert(result.ok);
  assertEquals(result.source, "benchmark");
  // 0.50 / 0.06 = $8.33 a ticket.
  assertEquals(result.cost_per_result_cents, 833);
  const meta = result.per_app[0];
  assertEquals(meta.expected_week, { low: 6, high: 10, result: "tickets" });
  // ceil(50/7 x 10.42) -> $75/day of spend; the Host pays ceil(7500 / 0.85).
  assertEquals(meta.recommended_daily_credit_cents, 7500);
  assertEquals(meta.recommended_daily_cents, hostMinimumPayCents(7500));
  assertEquals(meta.recommended_daily_cents, 8824);
  // Never the old 1.6 x minimum (160) rule.
  assert(meta.recommended_daily_credit_cents !== Math.ceil(100 * 1.6));
  assertEquals(meta.learning_ok, false);
  assertEquals(meta.run_goal, "purchase");
  // The floor lock: the minimum here is the one-ad-set pay price.
  assertEquals(meta.minimum_daily_cents, 118);
  assertEquals(result.total.minimum_daily_cents, 118);
  assertEquals(result.total.recommended_daily_cents, 8824);
});

Deno.test("SC-2.3 own data blends toward Mingla's results at 5 or more", () => {
  const bench = benchmarkCostPerResultCents("USD", "sales", 20);
  const blended = blendedCostPerResultCents(bench, {
    results: 12,
    costPerResultCents: 500,
  });
  assertEquals(blended.source, "blended");
  assertEquals(blended.cost, (12 * 500 + 20 * bench) / 32);
  const four = blendedCostPerResultCents(bench, {
    results: 4,
    costPerResultCents: 500,
  });
  assertEquals(
    four,
    { cost: bench, source: "benchmark" },
    "4 results stay on benchmark",
  );
});

Deno.test("SC-2.4 30 tickets left over a 7-day run: stock limited, high never above 30", () => {
  const result = hostBudgetGuidance({
    currency: "USD",
    goal: "sales",
    dailyPayCents: 1_000_000,
    priceUsd: 20,
    apps: [
      { platform: "meta", minimumCreditCents: 100 },
      { platform: "snapchat", minimumCreditCents: 500 },
    ],
    own: null,
    stock: { remaining: 30, runDays: 7 },
  });
  assert(result.ok);
  assertEquals(result.stock_limited, true);
  assert(result.total.expected_week.high <= 30);
  for (const app of result.per_app) assert(app.expected_week.high <= 30);
  // The recommendation sells the remaining stock, not 50 a week per app.
  for (const app of result.per_app) {
    assert(app.recommended_daily_credit_cents < 7500);
  }
});

Deno.test("sign-ups and visits costs; NGN tickets band on the USD price (X-6)", () => {
  assertEquals(
    benchmarkCostPerResultCents("USD", "signups", null),
    50 / LANDING_TO_RSVP,
  );
  assertEquals(benchmarkCostPerResultCents("USD", "visits", null), 50);
  // A N5,000 ticket is about $3.40: the cheap band (8%), not the $5,000 one.
  assertEquals(
    benchmarkCostPerResultCents("NGN", "sales", 3.4),
    5500 / landingToTicket(3.4),
  );
  assertEquals(landingToTicket(3.4), 0.08);
});

Deno.test("adversarial: zero or negative budget, no apps, unknown currency", () => {
  const base = {
    currency: "USD",
    goal: "sales" as const,
    priceUsd: 20,
    apps: [{ platform: "meta", minimumCreditCents: 100 }],
    own: null,
    stock: null,
  };
  assertEquals(hostBudgetGuidance({ ...base, dailyPayCents: 0 }), {
    ok: false,
    detail: "budget_invalid",
  });
  assertEquals(hostBudgetGuidance({ ...base, dailyPayCents: -5 }).ok, false);
  assertEquals(hostBudgetGuidance({ ...base, dailyPayCents: 1.5 }).ok, false);
  assertEquals(hostBudgetGuidance({ ...base, dailyPayCents: 500, apps: [] }), {
    ok: false,
    detail: "apps_required",
  });
  const unknown = hostBudgetGuidance({
    ...base,
    currency: "XOF",
    dailyPayCents: 5000,
  });
  assert(
    unknown.ok && unknown.cpc_assumed === true,
    "USD typical CPC, flagged",
  );
  const noPrice = hostBudgetGuidance({
    ...base,
    priceUsd: null,
    dailyPayCents: 5000,
  });
  assert(noPrice.ok && noPrice.price_assumed === true);
});

Deno.test("typical paid price is the median paid tier; free tiers ignored", () => {
  assertEquals(
    typicalPaidPriceCents([
      { is_free: true, price_cents: 0 },
      { is_free: false, price_cents: 3000 },
      { is_free: false, price_cents: 1000 },
      { is_free: false, price_cents: 2000 },
    ]),
    2000,
  );
  assertEquals(
    typicalPaidPriceCents([{ is_free: true, price_cents: 0 }]),
    null,
  );
});

Deno.test("Growth Tools benchmark values are unchanged after the move", async () => {
  assertEquals([BAND_LOW, BAND_HIGH, LANDING_TO_RSVP], [0.75, 1.25, 0.20]);
  assertEquals(
    [
      landingToTicket(19),
      landingToTicket(49),
      landingToTicket(99),
      landingToTicket(100),
    ],
    [0.08, 0.06, 0.045, 0.03],
  );
  assertEquals(FALLBACK_CPC, {
    USD: 0.50,
    GBP: 0.42,
    EUR: 0.48,
    CAD: 0.65,
    AUD: 0.70,
    NGN: 55,
    INR: 11,
    ZAR: 3.8,
    AED: 1.9,
    NZD: 0.75,
  });
  const source = await Deno.readTextFile(
    new URL("../../growth-tools-events/index.ts", import.meta.url),
  );
  assert(source.includes('from "../_shared/adResultBenchmarks.ts";'));
  assert(!source.includes("const FALLBACK_CPC"), "one copy only");
  assert(!source.includes("function landingToTicket"));
});

// ── ad-plan host_budget_guidance (fake db) ────────────────────────────────────

type Rows = Record<string, Record<string, unknown>[]>;
function fakeDb(rows: Rows, snapshot: string | null, rate = 1600): never {
  const query = (table: string) => {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    const chain: Record<string, unknown> = {};
    const run = () => {
      if (table === "fx_rate_snapshots") {
        return { data: snapshot ? { id: snapshot } : null, error: null };
      }
      return {
        data: (rows[table] ?? []).filter((row) => filters.every((f) => f(row))),
        error: null,
        count: (rows[table] ?? []).filter((row) => filters.every((f) => f(row)))
          .length,
      };
    };
    Object.assign(chain, {
      select: () => chain,
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === undefined || row[key] === value);
        return chain;
      },
      in: (key: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[key]));
        return chain;
      },
      is: () => chain,
      gte: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => Promise.resolve(run()),
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    });
    return chain;
  };
  return {
    from: query,
    rpc: (_name: string, args: Record<string, unknown>) =>
      Promise.resolve({
        data: args.p_target === "USD"
          ? Math.round(Number(args.p_amount) / rate)
          : Math.round(Number(args.p_amount) * rate),
        error: null,
      }),
  } as never;
}

const META_CONNECTION = {
  id: "c-meta",
  platform: "meta",
  currency: "USD",
  lane: "consumer",
  connected: true,
  status: "connected",
  extra: { minimum_budgets: { imp: 100, high_freq: 500, low_freq: 4000 } },
};

Deno.test("SC-2.2 an NGN brand: every amount is NGN via the FX snapshot; the minimum equals setup", async () => {
  const result = await buildHostBudgetGuidance(
    fakeDb({ ad_connections: [META_CONNECTION] }, "snap-1"),
    {
      brandId: "b-1",
      currency: "NGN",
      countryCode: "NG",
      goal: "signups",
      dailyPayCents: 2_000_000,
      platforms: ["meta"],
      destination: null,
      runDays: 7,
    },
  );
  assertEquals(result.ok, true);
  assertEquals(result.currency, "NGN");
  const app = (result.per_app as Record<string, unknown>[])[0];
  // 100 USD cents x 1600 x 1.02 margin = 163,200 kobo credit; pay = /0.85.
  assertEquals(app.minimum_daily_credit_cents, 163_200);
  assertEquals(app.minimum_daily_cents, hostMinimumPayCents(163_200));
  assertEquals(result.stock_known, false);
});

Deno.test("adversarial: a missing FX snapshot gives currency_unavailable, never USD labelled NGN", async () => {
  const result = await buildHostBudgetGuidance(
    fakeDb({ ad_connections: [META_CONNECTION] }, null),
    {
      brandId: "b-1",
      currency: "NGN",
      countryCode: "NG",
      goal: "visits",
      dailyPayCents: 2_000_000,
      platforms: ["meta"],
      destination: null,
      runDays: null,
    },
  );
  assertEquals(result, {
    ok: false,
    status: 409,
    detail: "currency_unavailable",
  });
});

Deno.test("SC-2.5 Host and Ari read the same numbers (one action, one model)", async () => {
  const input = {
    brandId: "b-1",
    currency: "USD",
    countryCode: "US",
    goal: "visits" as const,
    dailyPayCents: 5000,
    platforms: ["meta" as const],
    destination: null,
    runDays: 7,
  };
  const db = fakeDb({ ad_connections: [META_CONNECTION] }, "snap-1");
  assertEquals(
    await buildHostBudgetGuidance(db, input),
    await buildHostBudgetGuidance(db, input),
  );
  // Ari's read tool (get_ad_budget_guidance) lands in W5 (item 8) and calls
  // this same action; there is no second guidance path to drift.
  const plan = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  assert(plan.includes('if (action === "host_budget_guidance") {'));
  assert(plan.includes("const result = await buildHostBudgetGuidance(db, {"));
});

Deno.test("own results at brand scope blend the guidance", async () => {
  const db = fakeDb({
    ad_connections: [META_CONNECTION],
    ad_campaigns: [{ id: "camp-1", owner_kind: "host", brand_id: "b-1" }],
    ad_spend_daily: [{
      campaign_id: "camp-1",
      spend_cents: 6000,
      clicks: 300,
      currency: "USD",
    }],
    ad_conversions: Array.from({ length: 12 }, (_, i) => ({
      id: `conv-${i}`,
      campaign_id: "camp-1",
      event_type: "purchase",
    })),
    ticket_types: [{
      event_id: "11111111-1111-4111-8111-111111111111",
      is_free: false,
      price_cents: 2000,
      currency: "USD",
    }],
  }, "snap-1");
  const result = await buildHostBudgetGuidance(db, {
    brandId: "b-1",
    currency: "USD",
    countryCode: null,
    goal: "sales",
    dailyPayCents: PAY_FOR_10_USD,
    platforms: ["meta"],
    destination: { event_id: "11111111-1111-4111-8111-111111111111" },
    runDays: 7,
  });
  assertEquals(result.source, "blended");
  const bench = benchmarkCostPerResultCents("USD", "sales", 20);
  assertEquals(
    result.cost_per_result_cents,
    Math.round((12 * 500 + 20 * bench) / 32),
  );
});
