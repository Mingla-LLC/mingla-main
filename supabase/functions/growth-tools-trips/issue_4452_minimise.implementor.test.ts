// #4452 §6.4–6.5 (SC-137, SC-138, SC-139): the anonymous web lane of the four
// tools returns the preview allowlist only, and a trip whose live prices did
// not come back is "unpriced" (no price, never "$0").
// The handler-level halves (web body has no `report`; the app lane still gets
// the full report) are pinned in each tool's issue_1734_dual_lane_* suite.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { previewOfTrips4452, tripPricingStatus4452 } from "./index.ts";
import { previewOfVenues4452 } from "../growth-tools-run/index.ts";
import { previewOfEvents4452 } from "../growth-tools-events/index.ts";
import { previewOfPricing4452 } from "../growth-tools-pricing/index.ts";

const SECRET = "SECRET-DETAIL-4452";
const fixes = [{ title: "Add photos", body: SECRET, steps: [SECRET] }, { title: "Reply faster", body: SECRET }];

function keysDeep(o: unknown, prefix = ""): string[] {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keysDeep(v, prefix ? `${prefix}.${k}` : k));
}

Deno.test("SC-137 each tool's preview is exactly its allowlist; no other report field leaks", () => {
  const cases: Array<[string, Record<string, unknown>, string[]]> = [
    ["venues", previewOfVenues4452({ venue: { name: "Bar", address: "1 St", phone: SECRET }, scores: { overall: 71, grade: "B", detail: SECRET }, fixes, competitors: [SECRET] }),
      ["venue.name", "venue.address", "scores.overall", "scores.grade", "first_fix.title", "fix_count"]],
    ["events", previewOfEvents4452({ event: { title: "Gig", notes: SECRET }, forecast: { total_low: 40, total_high: 90, capacity: 120, channels: [SECRET] }, fixes }),
      ["event.title", "forecast.low", "forecast.high", "forecast.capacity", "first_fix.title", "fix_count"]],
    ["pricing", previewOfPricing4452({ experience: { description: "Wine night", cost_notes: SECRET }, audit: { current_price: 20, recommended_price: 28, currency: "USD", monthly_upside: 640, comps: [SECRET] }, fixes }),
      ["experience.description", "current_price", "recommended_price", "currency", "monthly_upside", "first_fix.title"]],
    ["trips", previewOfTrips4452({ trip: { title: "Lagos weekend", destination: "Lagos", itinerary: [SECRET] }, plan: { recommended_price_per_person: 450, currency: "USD", cost_lines: [{ per_person: 200, vendor: SECRET }] }, pricing_status: "priced", fixes }),
      ["trip.title", "trip.destination", "plan.recommended_price_per_person", "plan.currency", "pricing_status", "first_fix.title"]],
  ];
  for (const [tool, preview, allow] of cases) {
    assertEquals(keysDeep(preview).sort(), [...allow].sort(), `${tool}: the preview keys`);
    assert(!JSON.stringify(preview).includes(SECRET), `${tool}: nothing outside the allowlist`);
    assertEquals((preview.first_fix as Record<string, unknown>).title, "Add photos", `${tool}: only the first fix's title`);
  }
});

Deno.test("SC-138 a missing or odd report never throws and yields nulls, not report data", () => {
  for (const f of [previewOfVenues4452, previewOfEvents4452, previewOfPricing4452, previewOfTrips4452]) {
    for (const r of [null, undefined, "x", 3, [], { fixes: "nope" }]) {
      const p = f(r);
      assert(!JSON.stringify(p).includes(SECRET));
    }
  }
  assertEquals(previewOfVenues4452(null).fix_count, 0);
});

Deno.test("SC-139 trips: all-zero, a zero price, or fewer than 2 priced lines are 'unpriced'; the preview drops the price", () => {
  assertEquals(tripPricingStatus4452({ cost_lines: [{ per_person: 0 }, { per_person: 0 }], recommended_price_per_person: 0 }), "unpriced");
  assertEquals(tripPricingStatus4452({ cost_lines: [{ per_person: 120 }, { per_person: 80 }], recommended_price_per_person: 0 }), "unpriced");
  assertEquals(tripPricingStatus4452({ cost_lines: [{ per_person: 120 }, { per_person: 0 }], recommended_price_per_person: 300 }), "unpriced");
  assertEquals(tripPricingStatus4452({ cost_lines: [], recommended_price_per_person: 300 }), "unpriced");
  assertEquals(tripPricingStatus4452({ cost_lines: [{ per_person: 120 }, { per_person: 80 }], recommended_price_per_person: 300 }), "priced");
  const p = previewOfTrips4452({ trip: { title: "T" }, plan: { recommended_price_per_person: 0, currency: "USD" }, pricing_status: "unpriced" });
  assertEquals(p.pricing_status, "unpriced");
  assertEquals((p.plan as Record<string, unknown>).recommended_price_per_person, null, "no $0 on the page");
});
