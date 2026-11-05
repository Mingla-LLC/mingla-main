// #4265 — curated plan price range built honestly at the source.
//
// An open-ended place price ("$100+", stored as price_max = null) used to be
// written as priceMax 0 and summed into totalPriceMax, so plans read
// "$150–$100". The builder now falls an unknown max back to the min and flags
// the stop and the plan total open-ended.
//
// Run: deno test --allow-read --no-check supabase/functions/generate-curated-experiences/__tests__/issue_4265_curated_price.implementor.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildStopPrice, sumStopPrices } from '../../_shared/curatedPrice.ts';

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

Deno.test('#4265 open-ended stop: max is the min, never 0, and flagged', () => {
  assertEquals(buildStopPrice(100, null), { priceMin: 100, priceMax: 100, priceOpenEnded: true });
  assertEquals(buildStopPrice(100, undefined), { priceMin: 100, priceMax: 100, priceOpenEnded: true });
  // A stored max below the min is just as unknown.
  assertEquals(buildStopPrice(100, 0), { priceMin: 100, priceMax: 100, priceOpenEnded: true });
});

Deno.test('#4265 normal stop keeps its range and carries no flag', () => {
  assertEquals(buildStopPrice(20, 40), { priceMin: 20, priceMax: 40 });
  assertEquals(buildStopPrice(25, 25), { priceMin: 25, priceMax: 25 });
  // Price unknown altogether stays 0/0 — not invented, not "open-ended".
  assertEquals(buildStopPrice(null, null), { priceMin: 0, priceMax: 0 });
  assertEquals(buildStopPrice(0, 15), { priceMin: 0, priceMax: 15 });
});

Deno.test('#4265 plan total: mixed stops never have max below min and are open-ended', () => {
  const stops = [buildStopPrice(50, null), buildStopPrice(20, 40), buildStopPrice(30, 60)];
  const total = sumStopPrices(stops);
  assertEquals(total, { totalPriceMin: 100, totalPriceMax: 150, totalPriceOpenEnded: true });
  assert(total.totalPriceMax >= total.totalPriceMin);

  // All normal stops: plain sums, no flag (backward-compatible shape).
  assertEquals(sumStopPrices([buildStopPrice(20, 40), buildStopPrice(10, 30)]), { totalPriceMin: 30, totalPriceMax: 70 });

  // Defensive: stops built before the fix (max 0 under a real min) still sum honestly.
  assertEquals(
    sumStopPrices([{ priceMin: 100, priceMax: 0 }, { priceMin: 50, priceMax: 0 }]),
    { totalPriceMin: 150, totalPriceMax: 150, totalPriceOpenEnded: true },
  );
});

Deno.test('#4265 the builder uses the honest price helpers', async () => {
  const src = stripComments(await Deno.readTextFile(new URL('../index.ts', import.meta.url)));
  assert(!/priceMax:\s*card\.price_max\s*\?\?\s*0/.test(src), 'open-ended max is written as 0 again');
  assert(/\.\.\.buildStopPrice\(card\.price_min, card\.price_max\)/.test(src), 'stop price must come from buildStopPrice');
  assert(/const priceTotal = sumStopPrices\(mainStops\);/.test(src), 'plan total must come from sumStopPrices');
  assert(/\.\.\.priceTotal,/.test(src), 'card must carry the honest total');
  assert(!/reduce\(\(sum, s\) => sum \+ s\.priceMax, 0\)/.test(src), 'raw priceMax sum is back');
});
