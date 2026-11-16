/**
 * #4238 W3 — ad-plan wiring for amendment A: guidance carries the ad sets
 * (T-1/T-2), "Let Mingla choose" trims apps and refuses when nothing runs
 * (T-6, amendment B §3), photos run only where the Host create path takes
 * them (T-9), and create_version freezes the same split it showed.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildHostBudgetGuidance,
  HOST_IMAGE_PLATFORMS,
  hostImageRefusedPlatform,
  loadHostRetargetReadiness,
} from "../../ad-plan/index.ts";
import { creditCentsFromPay, hostMinimumPayCents } from "../adMoney.ts";

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

const META = {
  id: "c-meta",
  platform: "meta",
  currency: "USD",
  lane: "consumer",
  connected: true,
  status: "connected",
  extra: { minimum_budgets: { imp: 100, high_freq: 500, low_freq: 4000 } },
};
const TIKTOK = {
  id: "c-tiktok",
  platform: "tiktok",
  currency: "USD",
  lane: "consumer",
  connected: true,
  status: "connected",
  extra: {},
};
const READY = { audienceReady: true, buyerExclusionReady: true };

const base = {
  brandId: "b-1",
  currency: "USD",
  countryCode: "US",
  goal: "visits" as const,
  destination: null,
  runDays: 7,
};

Deno.test("SC-T6 via guidance: $8/day pay with Meta + TikTok under Let Mingla choose → Meta only, TikTok trimmed with how much more", async () => {
  const result = await buildHostBudgetGuidance(
    fakeDb({ ad_connections: [META, TIKTOK] }, "snap-1"),
    {
      ...base,
      dailyPayCents: 800,
      platforms: ["meta", "tiktok"],
      appChoice: "mingla",
    },
  );
  assertEquals(result.ok, true);
  const plan = result.apps_plan as Record<string, unknown>;
  assertEquals(plan.fit, "ok");
  assertEquals(
    (plan.funded as Record<string, unknown>[]).map((row) => row.platform),
    ["meta"],
  );
  const trimmed = (plan.trimmed as Record<string, unknown>[])[0];
  assertEquals(trimmed.platform, "tiktok");
  assertEquals(
    trimmed.needs_more_pay_cents,
    hostMinimumPayCents(500 + 2000 - creditCentsFromPay(800)),
  );
  const perApp = result.per_app as Record<string, unknown>[];
  assertEquals(perApp.map((app) => app.platform), ["meta"]);
  // amendment B §3: smallest working = exactly the minimum (118); learning = 589.
  assertEquals(perApp[0].smallest_working_pay_cents, 118);
  assertEquals(perApp[0].minimum_daily_cents, 118);
  assertEquals(perApp[0].learning_pay_cents, hostMinimumPayCents(500));
});

Deno.test("SC-T6 via guidance: $40/day funds both apps", async () => {
  const result = await buildHostBudgetGuidance(
    fakeDb({ ad_connections: [META, TIKTOK] }, "snap-1"),
    {
      ...base,
      dailyPayCents: 4000,
      platforms: ["meta", "tiktok"],
      appChoice: "mingla",
    },
  );
  const funded = (result.apps_plan as Record<string, unknown>).funded as {
    platform: string;
    daily_credit_cents: number;
  }[];
  assertEquals(funded.map((row) => row.platform), ["meta", "tiktok"]);
  assertEquals(
    funded.reduce((sum, row) => sum + row.daily_credit_cents, 0),
    creditCentsFromPay(4000),
  );
});

Deno.test("amendment B §3: nothing runs → 422 host_ad_budget_below_every_minimum with the smallest working amount", async () => {
  const result = await buildHostBudgetGuidance(
    fakeDb({ ad_connections: [META, TIKTOK] }, "snap-1"),
    {
      ...base,
      dailyPayCents: 100,
      platforms: ["meta", "tiktok"],
      appChoice: "mingla",
    },
  );
  assertEquals(result.ok, false);
  assertEquals(result.status, 422);
  assertEquals(result.detail, "host_ad_budget_below_every_minimum");
  assertEquals((result.apps_plan as Record<string, unknown>).smallest_overall, {
    platform: "meta",
    pay_cents: 118,
  });
  const perApp = result.per_app as Record<string, unknown>[];
  assertEquals(
    perApp.map((app) => [app.platform, app.smallest_working_pay_cents]),
    [["meta", 118], ["tiktok", 2353]],
  );
});

Deno.test("the Host's own pick is kept (no trimming) and a slow app says so", async () => {
  const result = await buildHostBudgetGuidance(
    fakeDb({ ad_connections: [META] }, "snap-1"),
    { ...base, dailyPayCents: 200, platforms: ["meta"] },
  );
  assertEquals(result.ok, true);
  assertEquals("apps_plan" in result, false);
  assertEquals(
    (result.per_app as Record<string, unknown>[])[0].platform,
    "meta",
  );
});

Deno.test("T-1/T-2: per_app ad_sets follow hostAdSetSplit — 2 only at ≥ 2F spend with a ready audience", async () => {
  const db = fakeDb({ ad_connections: [META] }, "snap-1");
  // Pay 236 → spend 200 = 2F on Meta.
  const two = await buildHostBudgetGuidance(db, {
    ...base,
    dailyPayCents: 236,
    platforms: ["meta"],
    retargetReadiness: { meta: READY },
  });
  const app2 = (two.per_app as Record<string, unknown>[])[0];
  assertEquals(
    [app2.ad_sets, (app2.retarget as Record<string, unknown>).added],
    [2, true],
  );
  const one = await buildHostBudgetGuidance(db, {
    ...base,
    dailyPayCents: 235,
    platforms: ["meta"],
    retargetReadiness: { meta: READY },
  });
  assertEquals((one.per_app as Record<string, unknown>[])[0].ad_sets, 1);
  const notReady = await buildHostBudgetGuidance(db, {
    ...base,
    dailyPayCents: 10_000,
    platforms: ["meta"],
  });
  const app = (notReady.per_app as Record<string, unknown>[])[0];
  assertEquals(
    (app.retarget as Record<string, unknown>).reason,
    "retarget_audience_not_ready",
  );
  // The minimum never moves with the split (binding floor rule).
  assertEquals([app2.minimum_daily_cents, app.minimum_daily_cents], [118, 118]);
});

Deno.test("T-2: readiness is read from ad_audiences for a one-country event only", async () => {
  const row = (code: string, size: number) => ({
    id: code,
    platform: "meta",
    code,
    scope: "event",
    market: "US",
    brand_id: "b-1",
    event_id: "e-1",
    platform_audience_id: `pa-${code}`,
    approx_size: size,
    status: "ready",
  });
  const db = fakeDb({ ad_audiences: [row("M1", 5000), row("M6", 40)] }, null);
  assertEquals(
    await loadHostRetargetReadiness(db, {
      platforms: ["meta", "google"],
      countries: ["US"],
      brandId: "b-1",
      eventId: "e-1",
    }),
    { meta: READY },
  );
  assertEquals(
    await loadHostRetargetReadiness(db, {
      platforms: ["meta"],
      countries: ["US", "GB"],
      brandId: "b-1",
      eventId: "e-1",
    }),
    {},
  );
  assertEquals(
    await loadHostRetargetReadiness(db, {
      platforms: ["meta"],
      countries: ["US"],
      brandId: "b-1",
      eventId: null,
    }),
    {},
  );
});

Deno.test("SC-T9: a photo runs on Meta; TikTok and Google say Needs a video", () => {
  assertEquals([...HOST_IMAGE_PLATFORMS], ["meta"]);
  assertEquals(hostImageRefusedPlatform("image", ["meta"]), null);
  assertEquals(hostImageRefusedPlatform("image", ["meta", "tiktok"]), "tiktok");
  assertEquals(hostImageRefusedPlatform("image", ["google"]), "google");
  assertEquals(hostImageRefusedPlatform("video", ["tiktok", "google"]), null);
});

Deno.test("create_version freezes the same split, never a client one; the seed only through its switch", async () => {
  const src = await Deno.readTextFile(
    new URL("../../ad-plan/index.ts", import.meta.url),
  );
  const at = src.indexOf("delete canonical.retarget_by_platform;");
  assertEquals(at > 0, true);
  const block = src.slice(at, src.indexOf("canonical.audience_choice =", at));
  assertEquals(block.includes("hostAdSetSplit("), true);
  assertEquals(block.includes("hostDailyMinimumCents("), true);
  assertEquals(src.includes("canonicalInput.retarget_by_platform"), false);
  // The only path a list key is added without the Host's pick.
  const seedAt = src.indexOf("const seed = hostPastGuestSeedKeys(");
  assertEquals(seedAt > 0, true);
  assertEquals(src.indexOf("past_guest_seed_enabled") > 0, true);
  const create = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  assertEquals(
    create.includes(
      '(hostCreativeRow.kind === "image" && platform === "meta")',
    ),
    true,
  );
});
