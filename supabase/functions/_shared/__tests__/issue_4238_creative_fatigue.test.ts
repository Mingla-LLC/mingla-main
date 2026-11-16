/**
 * #4238 W3 T-4 — the "your ad is getting tired" signal.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { creativeFatigueDue, type FatigueDay } from "../adCreativeFatigue.ts";

const LIVE = Date.parse("2026-11-01T09:00:00Z");
const day = (n: number) =>
  new Date(LIVE + (n - 1) * 86_400_000).toISOString().slice(0, 10);
const at = (n: number) => Date.parse(`${day(n)}T12:00:00Z`);

/** Baseline CTR on days 2–4, recent CTR on days 5–7 (seen on day 8). */
function days(
  baselineCtr: number,
  recentCtr: number,
  recentImpressions = 1200,
): FatigueDay[] {
  const out: FatigueDay[] = [];
  for (let n = 1; n <= 10; n++) {
    const impressions = n >= 5 ? recentImpressions : 1000;
    const rate = n >= 5 ? recentCtr : baselineCtr;
    out.push({
      metric_date: day(n),
      impressions,
      link_clicks: Math.round(impressions * rate),
    });
  }
  return out;
}

const base = {
  platform: "meta",
  stage: "prospecting" as const,
  liveSinceMs: LIVE,
  frequency7d: 3.2,
  lastFiredMs: null,
};

Deno.test("SC-T4: CTR 1.0% → 0.65% with frequency 3.2 fires on day 8", () => {
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(8), days: days(0.01, 0.0065) }),
    true,
  );
});

Deno.test("SC-T4: CTR 0.75% does not fire; day 6 does not fire", () => {
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(8), days: days(0.01, 0.0075) }),
    false,
  );
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(6), days: days(0.01, 0.005) }),
    false,
  );
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(7), days: days(0.01, 0.005) }),
    false,
  );
});

Deno.test("T-4: exactly 70% fires; frequency 2.9 does not; retarget needs 6", () => {
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(8), days: days(0.01, 0.007) }),
    true,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      frequency7d: 2.9,
      nowMs: at(8),
      days: days(0.01, 0.005),
    }),
    false,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      stage: "retarget",
      frequency7d: 5.9,
      nowMs: at(8),
      days: days(0.01, 0.005),
    }),
    false,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      stage: "retarget",
      frequency7d: 6,
      nowMs: at(8),
      days: days(0.01, 0.005),
    }),
    true,
  );
});

Deno.test("T-4: under 3,000 impressions in the last 3 days does not fire", () => {
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(8), days: days(0.01, 0.005, 999) }),
    false,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      nowMs: at(8),
      days: days(0.01, 0.005, 1000),
    }),
    true,
  );
});

Deno.test("T-4 adversarial: zero baseline impressions, a repeat inside 7 days, Google/Reddit", () => {
  const noBaseline = days(0.01, 0.005).map((row, index) =>
    index >= 1 && index <= 3 ? { ...row, impressions: 0, link_clicks: 0 } : row
  );
  assertEquals(
    creativeFatigueDue({ ...base, nowMs: at(8), days: noBaseline }),
    false,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      nowMs: at(8),
      lastFiredMs: at(2),
      days: days(0.01, 0.005),
    }),
    false,
  );
  assertEquals(
    creativeFatigueDue({
      ...base,
      nowMs: at(9),
      lastFiredMs: at(2),
      days: days(0.01, 0.005),
    }),
    true,
  );
  for (const platform of ["google", "reddit"]) {
    assertEquals(
      creativeFatigueDue({
        ...base,
        platform,
        nowMs: at(8),
        days: days(0.01, 0.005),
      }),
      false,
    );
  }
  assertEquals(
    creativeFatigueDue({
      ...base,
      liveSinceMs: null,
      nowMs: at(8),
      days: days(0.01, 0.005),
    }),
    false,
  );
});
