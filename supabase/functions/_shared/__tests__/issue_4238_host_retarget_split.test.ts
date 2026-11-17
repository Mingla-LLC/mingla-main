// MINGLA-INVARIANT: I-4238-RETARGET-NEVER-RAISES-MINIMUM | issue #4238 | hostAdSetSplit adds the retarget ad set only at S >= 2F with a ready >=1,000 audience and a ready buyer exclusion, keeps every ad set >= F, and the Host minimum is never derived from it (hostDailyMinimumCents is the one-ad-set floor).
/**
 * #4238 W3 T-2 — remind people who looked or started checkout, only when the
 * budget is big enough, and never at the cost of the minimum.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  hostAdSetSplit,
  hostDailyMinimumCents,
  hostRetargetReadiness,
} from "../adHostPlanRules.ts";
import { buildAdStagePlan } from "../adAudienceStages.ts";

const READY = { audienceReady: true, buyerExclusionReady: true };
const FLOORS: Record<string, number> = {
  meta: 100,
  snapchat: 500,
  tiktok: 2000,
};

Deno.test("SC-T2.1: Meta 199 → 1 ad set; 200 → 100/100; 1,000 → 200/800", () => {
  assertEquals(hostAdSetSplit("meta", 199, 100, READY).ad_sets, 1);
  assertEquals(
    hostAdSetSplit("meta", 199, 100, READY).retarget.reason,
    "budget_below_retarget_threshold",
  );
  const at200 = hostAdSetSplit("meta", 200, 100, READY);
  assertEquals([at200.ad_sets, at200.retarget_cents, at200.prospecting_cents], [
    2,
    100,
    100,
  ]);
  const at1000 = hostAdSetSplit("meta", 1000, 100, READY);
  assertEquals([at1000.retarget_cents, at1000.prospecting_cents], [200, 800]);
});

Deno.test("SC-T2.2: audience under 1,000 or no buyer exclusion → 1 ad set", () => {
  for (
    const readiness of [
      { audienceReady: false, buyerExclusionReady: true },
      { audienceReady: true, buyerExclusionReady: false },
      null,
    ]
  ) {
    const split = hostAdSetSplit("meta", 100_000, 100, readiness);
    assertEquals(split.ad_sets, 1);
    assertEquals(split.retarget.reason, "retarget_audience_not_ready");
    assertEquals(split.prospecting_cents, 100_000);
  }
});

Deno.test("T-2 brute force: S from F to 6F on all three apps — every ad set ≥ F, 2 only from 2F", () => {
  for (const [platform, floor] of Object.entries(FLOORS)) {
    for (let spend = floor; spend <= 6 * floor; spend++) {
      const split = hostAdSetSplit(platform, spend, floor, READY);
      assertEquals(split.prospecting_cents + split.retarget_cents, spend);
      assertEquals(
        split.ad_sets === 2,
        spend >= 2 * floor,
        `${platform} ${spend}`,
      );
      assertEquals(split.prospecting_cents >= floor, true);
      if (split.ad_sets === 2) {
        assertEquals(split.retarget_cents >= floor, true);
        assertEquals(
          split.retarget_cents,
          Math.max(floor, Math.floor(0.2 * spend)),
        );
      }
    }
  }
});

Deno.test("T-2: Google and Reddit never get a retarget ad set", () => {
  assertEquals(
    hostAdSetSplit("google", 1_000_000, 0, READY).retarget.reason,
    "retarget_not_supported",
  );
  assertEquals(hostAdSetSplit("reddit", 1_000_000, 500, READY).ad_sets, 1);
});

Deno.test("T-2 adversarial: retargeting never changes the Host minimum (one-ad-set floor)", () => {
  const usd = {
    currency: "USD",
    extra: { minimum_budgets: { impressions: 100 } },
  };
  // The minimum is the one-ad-set price whatever the split would do.
  assertEquals(hostDailyMinimumCents("snapchat", usd, "sales"), 500);
  assertEquals(hostDailyMinimumCents("tiktok", usd, "visits"), 2000);
  // At exactly the minimum, never two ad sets (so never a second floor).
  for (const [platform, floor] of Object.entries(FLOORS)) {
    assertEquals(hostAdSetSplit(platform, floor, floor, READY).ad_sets, 1);
  }
  const rules = Deno.readTextFileSync(
    new URL("../adHostPlanRules.ts", import.meta.url),
  );
  const body = rules.slice(
    rules.indexOf("export function hostDailyMinimumCents("),
  );
  assertEquals(
    body.slice(0, body.indexOf("\n}\n")).includes("hostAdSetSplit"),
    false,
  );
});

Deno.test("T-2 adversarial: lifetime ÷ days and a cut across 2F", () => {
  // A lifetime 7-day total of 1,393 is 199/day → one ad set.
  assertEquals(
    hostAdSetSplit("meta", Math.floor(1393 / 7), 100, READY).ad_sets,
    1,
  );
  assertEquals(
    hostAdSetSplit("meta", Math.floor(1400 / 7), 100, READY).ad_sets,
    2,
  );
  // A live cut from 300 to 150 drops the retarget ad set.
  assertEquals(hostAdSetSplit("meta", 300, 100, READY).ad_sets, 2);
  assertEquals(hostAdSetSplit("meta", 150, 100, READY).ad_sets, 1);
});

Deno.test("T-2: readiness comes from the stage resolver (buyer exclusion + ≥1,000 audience)", () => {
  const base = {
    platform: "meta" as const,
    market: "US",
    brandId: "b",
    eventId: "e",
    totalBudgetCents: 1000,
  };
  const row = (code: string, size: number) => ({
    id: code,
    platform: "meta" as const,
    code,
    scope: "event" as const,
    market: "US",
    brand_id: "b",
    event_id: "e",
    platform_audience_id: `pa-${code}`,
    approx_size: size,
    status: "ready" as const,
  });
  assertEquals(
    hostRetargetReadiness(
      buildAdStagePlan({ ...base, rows: [row("M1", 5000)] }),
    ).audienceReady,
    false,
  );
  assertEquals(
    hostRetargetReadiness(
      buildAdStagePlan({ ...base, rows: [row("M1", 5000), row("M6", 50)] }),
    ),
    READY,
  );
  assertEquals(
    hostRetargetReadiness(
      buildAdStagePlan({ ...base, rows: [row("M1", 999), row("M6", 50)] }),
    ).audienceReady,
    false,
  );
  assertEquals(hostRetargetReadiness(null), {
    audienceReady: false,
    buyerExclusionReady: false,
  });
});
