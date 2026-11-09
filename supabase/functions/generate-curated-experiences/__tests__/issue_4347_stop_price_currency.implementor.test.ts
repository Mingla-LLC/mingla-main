// #4347 round 2 — a plan stop's price carries its currency and Google level.
//
// Stop prices are Google's per-person range in the PLACE's currency (₦100,000
// at a Lagos restaurant). Without the code, the app read that as US dollars and
// every paid Lagos stop came out "Upscale". The builder now stamps
// priceCurrency + priceLevel on every stop (plan builder and Replace-a-stop).
//
// Run: deno test --allow-read --no-check supabase/functions/generate-curated-experiences/__tests__/issue_4347_stop_price_currency.implementor.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { rangeCurrency, stopPriceIdentity } from '../../_shared/curatedPrice.ts';

const read = (rel: string): string => Deno.readTextFileSync(new URL(rel, import.meta.url));
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

Deno.test('#4347 r2 a Lagos restaurant keeps its naira code and Google level', () => {
  assertEquals(stopPriceIdentity({ price_currency: 'NGN', price_level: 'PRICE_LEVEL_VERY_EXPENSIVE' }), {
    priceCurrency: 'NGN',
    priceLevel: 'PRICE_LEVEL_VERY_EXPENSIVE',
  });
  assertEquals(stopPriceIdentity({ price_currency: null, price_level: 'PRICE_LEVEL_FREE' }), {
    priceCurrency: null,
    priceLevel: 'PRICE_LEVEL_FREE',
  });
});

Deno.test('#4347 r2 unknown or malformed values are null, never a default', () => {
  assertEquals(stopPriceIdentity({}), { priceCurrency: null, priceLevel: null });
  assertEquals(stopPriceIdentity({ price_currency: 'naira', price_level: 3 }), { priceCurrency: null, priceLevel: null });
  assertEquals(rangeCurrency('usd'), null);
  assertEquals(rangeCurrency(''), null);
  assertEquals(rangeCurrency('GBP'), 'GBP');
});

Deno.test('#4347 r2 the place fetch selects the range currency and shapes it', () => {
  const src = stripComments(read('../../_shared/signalRankFetch.ts'));
  assert(/price_range_end_cents, price_range_currency/.test(src), 'hydrate columns must select price_range_currency');
  assert(/price_currency: rangeCurrency\(pp\.price_range_currency\)/.test(src), 'the row mapper must carry the currency');
});

Deno.test('#4347 r2 both stop builders stamp the identity', () => {
  const plan = stripComments(read('../index.ts'));
  assert(/\.\.\.buildStopPrice\(card\.price_min, card\.price_max\),\s*\.\.\.stopPriceIdentity\(card\)/.test(plan), 'plan builder');
  const swap = stripComments(read('../../_shared/stopAlternatives.ts'));
  assert(/\.\.\.buildStopPrice\(c\.price_min, c\.price_max\),\s*\.\.\.stopPriceIdentity\(c\)/.test(swap), 'Replace-a-stop');
});

import { buildNativeContentCardSnapshot } from '../../_shared/contentShare.ts';

function sharedPlan(stop: Record<string, unknown>) {
  return {
    card_data: {
      id: 'plan-abuja',
      cardType: 'curated',
      title: 'Gallery to dinner',
      totalPriceMin: 100000,
      totalPriceMax: 100000,
      stops: [
        { stopNumber: 1, placeId: 'p1', placeName: 'Nike Art Gallery', priceMin: 0, priceMax: 0, priceCurrency: null, priceLevel: null },
        { stopNumber: 2, placeId: 'p2', placeName: 'The Burgundy', priceMin: 100000, priceMax: 100000, ...stop },
      ],
    },
  };
}

Deno.test('#4347 r2 a plan whose stops carry the new price fields still shares to chat, fields intact', () => {
  // The share allowlist refuses unknown stop keys, so without the round-2 keys every new plan failed to share.
  const snapshot = buildNativeContentCardSnapshot('curated', sharedPlan({ priceCurrency: 'NGN', priceLevel: 'PRICE_LEVEL_VERY_EXPENSIVE' }));
  const stops = snapshot.stops as Array<Record<string, unknown>>;
  assertEquals(stops[1].priceCurrency, 'NGN');
  assertEquals(stops[1].priceLevel, 'PRICE_LEVEL_VERY_EXPENSIVE');
  // Junk is dropped to null, never passed through.
  const junk = buildNativeContentCardSnapshot('curated', sharedPlan({ priceCurrency: 'naira', priceLevel: '<script>' }));
  const junkStops = junk.stops as Array<Record<string, unknown>>;
  assertEquals(junkStops[1].priceCurrency ?? null, null);
  assertEquals(junkStops[1].priceLevel ?? null, null);
});
