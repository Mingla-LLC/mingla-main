/**
 * #4347 round 3 — Replace a stop keeps priced places in non-dollar cities.
 *
 *   deno test --no-check \
 *     supabase/functions/_shared/__tests__/issue_4347_replace_stop_local_price.implementor.test.ts
 *
 * `price_min` on a candidate is Google's per-person range in the PLACE's own
 * currency. The old `price_min > budgetMax` (default 1000, never sent by the
 * app) compared ₦100,000 with 1000 and dropped every priced Lagos/Abuja
 * restaurant from the alternatives. Budget filtering was retired in ORCH-0434;
 * no price cap may drop a candidate here, and the edge function must not
 * re-introduce a hidden default.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchStopAlternatives } from "../stopAlternatives.ts";
import { COMBO_SLUG_TO_FILTER_SIGNAL } from "../signalRankFetch.ts";

function fakeAdmin(places: Array<Record<string, unknown>>) {
  return {
    rpc: () => Promise.resolve({
      data: places.map((p, i) => ({ place_id: p.id, rank_score: 200 - i })),
      error: null,
    }),
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: places, error: null }),
      }),
    }),
  };
}

const base = { lat: 9.07, lng: 7.48, stored_photo_urls: ["https://x/y.jpg"], name: "P" };

Deno.test("#4347 R3-1 a ₦100,000-per-person Abuja restaurant is offered as a replacement", async () => {
  const categoryId = Object.keys(COMBO_SLUG_TO_FILTER_SIGNAL)[0];
  const admin = fakeAdmin([
    { ...base, id: "burgundy", google_place_id: "g-burgundy", price_range_start_cents: 10_000_000, price_range_end_cents: null, price_range_currency: "NGN" },
    { ...base, id: "suya", google_place_id: "g-suya", price_range_start_cents: 500_000, price_range_end_cents: 1_000_000, price_range_currency: "NGN" },
    { ...base, id: "unpriced", google_place_id: "g-unpriced", price_range_start_cents: null, price_range_end_cents: null },
  ]);
  const { alternatives, totalAvailable } = await fetchStopAlternatives(
    admin as never,
    // The edge function used to default `budgetMax` to 1000 and forward it; a
    // caller that still sends it must not get priced local places dropped.
    { categoryId, refLat: 9.07, refLng: 7.48, travelMode: "driving", excludePlaceIds: [], limit: 10, budgetMax: 1000 } as never,
  );
  const ids = alternatives.map((a) => a.placePoolId).sort();
  assertEquals(ids, ["burgundy", "suya", "unpriced"], "no candidate is dropped for its local-currency price");
  assertEquals(totalAvailable, 3);
  const burgundy = alternatives.find((a) => a.placePoolId === "burgundy")!;
  assertEquals(burgundy.priceMin, 100_000);
});

Deno.test("#4347 R3-2 the excluded place is still removed (only the price cap went)", async () => {
  const categoryId = Object.keys(COMBO_SLUG_TO_FILTER_SIGNAL)[0];
  const admin = fakeAdmin([
    { ...base, id: "a", google_place_id: "g-a", price_range_start_cents: 10_000_000, price_range_end_cents: null },
    { ...base, id: "b", google_place_id: "g-b", price_range_start_cents: 10_000_000, price_range_end_cents: null },
  ]);
  const { alternatives } = await fetchStopAlternatives(
    admin as never,
    { categoryId, refLat: 9.07, refLng: 7.48, travelMode: "driving", excludePlaceIds: ["g-a"], limit: 10 },
  );
  assertEquals(alternatives.map((a) => a.placePoolId), ["b"]);
});

Deno.test("#4347 R3-3 no price cap survives in Replace a stop or the plan builder", async () => {
  const here = new URL(".", import.meta.url);
  const alt = await Deno.readTextFile(new URL("../stopAlternatives.ts", here));
  const edge = await Deno.readTextFile(new URL("../../replace-curated-stop/index.ts", here));
  const gen = await Deno.readTextFile(new URL("../../generate-curated-experiences/index.ts", here));
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert(!/price_min[^;\n]*>\s*budgetMax/.test(code(alt)), "stopAlternatives compares price_min with a budget");
  assert(!/budgetMax/.test(code(edge)), "replace-curated-stop forwards or defaults a budget again");
  assert(!/perStopBudget/.test(code(gen)), "the dead per-stop budget is back in the plan builder");
});
