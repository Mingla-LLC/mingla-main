/**
 * Issue #4265 — open-ended curated prices ("$100+") survive sharing and stop
 * replacement. Implementor happy-path regression suite.
 *
 *   deno test --no-check \
 *     supabase/functions/_shared/__tests__/issue_4265_share_open_ended_price.implementor.test.ts
 *
 * 1. The native chat-share snapshot allowlists `priceOpenEnded` (stops) and
 *    `totalPriceOpenEnded` (plan). Before, a plan carrying either flag failed
 *    the exact-keys allowlist and could not be shared at all.
 * 2. Replace-stop alternatives build a "$100+" place as max = min + the flag,
 *    the same rule as the plan builder, never `priceMax: 0`.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildNativeContentCardSnapshot } from "../contentShare.ts";
import { fetchStopAlternatives } from "../stopAlternatives.ts";
import { COMBO_SLUG_TO_FILTER_SIGNAL } from "../signalRankFetch.ts";

function curatedRow(stopOverrides: Record<string, unknown>, cardOverrides: Record<string, unknown>) {
  return {
    card_data: {
      id: "plan-1",
      cardType: "curated",
      title: "Jazz then dinner",
      totalPriceMin: 150,
      totalPriceMax: 150,
      ...cardOverrides,
      stops: [
        { stopNumber: 1, placeId: "p1", placeName: "Blue Note", priceMin: 50, priceMax: 50 },
        { stopNumber: 2, placeId: "p2", placeName: "Steakhouse", priceMin: 100, priceMax: 100, ...stopOverrides },
      ],
    },
  };
}

Deno.test("#4265 a shared curated plan keeps its open-ended stop and total price", () => {
  const snapshot = buildNativeContentCardSnapshot(
    "curated",
    curatedRow({ priceOpenEnded: true }, { totalPriceOpenEnded: true }),
  );
  assertEquals(snapshot.totalPriceOpenEnded, true, "plan total stays 'from' ($150+)");
  const stops = snapshot.stops as Array<Record<string, unknown>>;
  assertEquals(stops[1].priceOpenEnded, true, "the $100+ stop stays open-ended");
  assertEquals(stops[1].priceMax, 100);
  assertEquals(stops[0].priceOpenEnded, undefined, "a bounded stop carries no flag");
});

Deno.test("#4265 a plan without open-ended prices shares exactly as before", () => {
  const snapshot = buildNativeContentCardSnapshot("curated", curatedRow({}, {}));
  assertEquals(snapshot.totalPriceOpenEnded, undefined);
  assert(!("priceOpenEnded" in (snapshot.stops as Array<Record<string, unknown>>)[1]));
  // false is never emitted (only true travels).
  const explicitFalse = buildNativeContentCardSnapshot(
    "curated",
    curatedRow({ priceOpenEnded: false }, { totalPriceOpenEnded: false }),
  );
  assertEquals(explicitFalse.totalPriceOpenEnded, undefined);
});

Deno.test("#4265 a non-boolean open-ended flag is rejected like any other bad field", () => {
  let threw = false;
  try {
    buildNativeContentCardSnapshot("curated", curatedRow({ priceOpenEnded: "yes" }, {}));
  } catch (error) {
    threw = (error as Error).message === "invalid_native_snapshot";
  }
  assert(threw, "junk in the flag is refused, not coerced");
});

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

Deno.test("#4265 replace-stop alternatives never turn a $100+ place into max 0", async () => {
  const categoryId = Object.keys(COMBO_SLUG_TO_FILTER_SIGNAL)[0];
  const base = { lat: 35.78, lng: -78.64, stored_photo_urls: ["https://x/y.jpg"], name: "P" };
  const admin = fakeAdmin([
    { ...base, id: "open", google_place_id: "g-open", price_range_start_cents: 10000, price_range_end_cents: null },
    { ...base, id: "bounded", google_place_id: "g-bounded", price_range_start_cents: 2000, price_range_end_cents: 4000 },
  ]);
  const { alternatives } = await fetchStopAlternatives(
    admin as never,
    { categoryId, refLat: 35.78, refLng: -78.64, travelMode: "driving", excludePlaceIds: [], limit: 10 },
  );
  const open = alternatives.find((a) => a.placePoolId === "open")!;
  assertEquals(open.priceMin, 100);
  assertEquals(open.priceMax, 100, "unknown max falls back to the min, never 0");
  assertEquals(open.priceOpenEnded, true);
  const bounded = alternatives.find((a) => a.placePoolId === "bounded")!;
  assertEquals([bounded.priceMin, bounded.priceMax, bounded.priceOpenEnded], [20, 40, undefined]);
});
