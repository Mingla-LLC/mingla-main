// Issue #4347 — brand experiences carry their price in the VIEWER's currency.
//
// A Lagos experience is priced in naira (events.currency = NGN). The deck card
// carried only `totalPriceMin/Max` + `currency`, and the app formatted the
// naira amount as dollars. Both deck functions now attach
// displayPriceMin/Max, displayCurrency and priceIsApprox from the daily FX
// snapshot (fx_latest_servable_snapshot → fx_convert_minor).
//
// FAILS-ON-REVERT: dropping the conversion (or the attach call in either
// function), converting with a guessed rate when the snapshot is missing, or
// marking a same-currency price approximate fails here.
//
// Run: deno test --allow-read --no-check supabase/functions/discover-cards/__tests__/issue_4347_experience_display_price.implementor.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  attachExperienceDisplayPrices,
  dbMinorConverter,
  experienceDisplayPrice,
  latestServableSnapshotId,
  normalizeViewerCurrency,
} from '../../_shared/experienceDisplayPrice.ts';

// The live snapshot on 2026-11-08: 1 USD = ₦1,347.74.
const NGN_PER_USD = 1347.74;

/** A fake service-role client that answers the two FX RPCs like Postgres does. */
function fakeClient(opts: { snapshot: string | null; failConvert?: boolean }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === 'fx_latest_servable_snapshot') {
        return Promise.resolve({
          data: opts.snapshot === null ? [] : [{ snapshot_id: opts.snapshot }],
          error: null,
        });
      }
      if (fn === 'fx_convert_minor') {
        if (opts.failConvert) return Promise.resolve({ data: null, error: { message: 'fx_unavailable' } });
        const amount = Number(args.p_amount);
        const rate = args.p_source === 'NGN' && args.p_target === 'USD'
          ? 1 / NGN_PER_USD
          : args.p_source === 'USD' && args.p_target === 'NGN'
          ? NGN_PER_USD
          : 1;
        // bigint comes back as a string over PostgREST.
        return Promise.resolve({ data: String(Math.round(amount * rate)), error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
}

const LAGOS = { totalPriceMin: 100_000, totalPriceMax: 100_000, currency: 'NGN' };

Deno.test('#4347 ₦100,000 to a dollar viewer carries ≈ $74.20 from the snapshot', async () => {
  const client = fakeClient({ snapshot: 'snap-1' });
  const price = await experienceDisplayPrice(LAGOS, 'USD', dbMinorConverter(client, 'snap-1'));
  assertEquals(price, {
    displayPriceMin: 74.2,
    displayPriceMax: 74.2,
    displayCurrency: 'USD',
    priceIsApprox: true,
  });
  const convert = client.calls.filter((c) => c.fn === 'fx_convert_minor');
  assertEquals(convert.length, 1, 'a single price converts once');
  assertEquals(convert[0].args, { p_amount: 10_000_000, p_source: 'NGN', p_target: 'USD', p_snapshot: 'snap-1' });
});

Deno.test('#4347 same currency is the exact amount, not approximate, with no FX call', async () => {
  const client = fakeClient({ snapshot: 'snap-1' });
  const price = await experienceDisplayPrice(LAGOS, 'NGN', dbMinorConverter(client, 'snap-1'));
  assertEquals(price, { displayPriceMin: 100_000, displayPriceMax: 100_000, displayCurrency: 'NGN', priceIsApprox: false });
  assertEquals(client.calls.length, 0);
});

Deno.test('#4347 no snapshot or a failed conversion leaves the fields empty — never a guessed rate', async () => {
  const none = { displayPriceMin: null, displayPriceMax: null, displayCurrency: null, priceIsApprox: false };
  assertEquals(await experienceDisplayPrice(LAGOS, 'USD', null), none);
  const failing = fakeClient({ snapshot: 'snap-1', failConvert: true });
  assertEquals(await experienceDisplayPrice(LAGOS, 'USD', dbMinorConverter(failing, 'snap-1')), none);
  assertEquals(await experienceDisplayPrice(LAGOS, null, null), none, 'no viewer currency');
  assertEquals(await latestServableSnapshotId(fakeClient({ snapshot: null }), new Date()), null);
});

Deno.test('#4347 a range converts both ends; repeated prices share one round trip', async () => {
  const client = fakeClient({ snapshot: 'snap-1' });
  const convert = dbMinorConverter(client, 'snap-1');
  const cards = await attachExperienceDisplayPrices(
    [
      { id: 'a', totalPriceMin: 50_000, totalPriceMax: 150_000, currency: 'NGN' },
      { id: 'b', totalPriceMin: 50_000, totalPriceMax: 150_000, currency: 'NGN' },
    ],
    'USD',
    convert,
  );
  assertEquals(cards[0].displayPriceMin, 37.1);
  assertEquals(cards[0].displayPriceMax, 111.3);
  assertEquals(cards[1].displayPriceMax, 111.3);
  assertEquals(client.calls.length, 2, 'memoised per amount + currency pair');
  assertEquals(normalizeViewerCurrency(' usd '), 'USD');
  assertEquals(normalizeViewerCurrency('dollars'), null);
});

Deno.test('#4347 both deck functions attach the converted price to experience cards', async () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const discover = strip(await Deno.readTextFile(new URL('../index.ts', import.meta.url)));
  assert(discover.includes('experienceCards = await attachExperienceDisplayPrices('), 'discover-cards no longer converts experience prices');
  assert(discover.includes('dbMinorConverter(supabaseAdmin, fxSnapshotId)'), 'discover-cards must use the request\'s pinned FX snapshot');
  const curated = strip(await Deno.readTextFile(new URL('../../generate-curated-experiences/index.ts', import.meta.url)));
  assert(curated.includes('experienceCards = await attachExperienceDisplayPrices('), 'generate-curated-experiences no longer converts experience prices');
  assert(curated.includes('latestServableSnapshotId(supabaseAdmin'), 'the curated path must use the servable snapshot');
  assert(curated.includes('normalizeViewerCurrency(rawDisplayCurrency)'), 'the curated path must read the viewer currency');
});
