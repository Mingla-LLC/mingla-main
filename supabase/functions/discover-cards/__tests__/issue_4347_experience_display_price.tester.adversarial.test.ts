// Issue #4347 — TESTER ADVERSARIAL for _shared/experienceDisplayPrice.ts.
//
// The implementor's suite drives a well-behaved fake Postgres. This one attacks
// the failure seams the deck depends on never leaking into a price:
//
//   - a range where only ONE end converts must not ship a half-converted range
//     (min in dollars, max missing → the app would print "≈ $37" for
//     ₦50,000–₦150,000);
//   - one experience whose conversion THROWS must not take the other cards'
//     prices (or the deck) down with it;
//   - PostgREST answers that are not a whole non-negative minor amount
//     (decimal strings, negatives, NaN, nulls, errors, a rejected promise)
//     become "no conversion", never a printed number;
//   - hostile envelopes (NaN, negative, Infinity) and a lowercase host
//     currency never reach the FX RPC;
//   - concurrent requests for the same amount share ONE round trip.
//
// FAILS-ON-REVERT (verified by the tester, see #4347):
//   - relaxing `if (lo === null || (max !== min && hi === null)) return NONE`
//     to `if (lo === null)` fails "a half-converted range is never shipped";
//   - removing the per-card try/catch in attachExperienceDisplayPrices fails
//     "one card's conversion failure is isolated".
//
// Run: deno test --allow-read --no-check supabase/functions/discover-cards/__tests__/issue_4347_experience_display_price.tester.adversarial.test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  attachExperienceDisplayPrices,
  dbMinorConverter,
  experienceDisplayPrice,
  type MinorConverter,
} from '../../_shared/experienceDisplayPrice.ts';

const NONE = { displayPriceMin: null, displayPriceMax: null, displayCurrency: null, priceIsApprox: false };

/** A converter that answers ₦→$ at 1,347.74 except for the amounts it is told to fail. */
function converter(opts: { failMinor?: number[]; throwMinor?: number[] } = {}) {
  const calls: number[] = [];
  const convert: MinorConverter = (amountMinor) => {
    calls.push(amountMinor);
    if (opts.throwMinor?.includes(amountMinor)) throw new Error('rpc exploded');
    if (opts.failMinor?.includes(amountMinor)) return Promise.resolve(null);
    return Promise.resolve(Math.round(amountMinor / 1347.74));
  };
  return { convert, calls };
}

Deno.test('#4347 adv: a half-converted range is never shipped', async () => {
  // ₦50,000 converts, ₦150,000 does not.
  const { convert } = converter({ failMinor: [15_000_000] });
  const price = await experienceDisplayPrice(
    { totalPriceMin: 50_000, totalPriceMax: 150_000, currency: 'NGN' },
    'USD',
    convert,
  );
  assertEquals(price, NONE, 'a range with one unconverted end must fall back to the host currency');
  // And the other way round.
  const lowFails = converter({ failMinor: [5_000_000] });
  assertEquals(
    await experienceDisplayPrice({ totalPriceMin: 50_000, totalPriceMax: 150_000, currency: 'NGN' }, 'USD', lowFails.convert),
    NONE,
  );
});

Deno.test('#4347 adv: one card\'s conversion failure is isolated', async () => {
  const { convert } = converter({ throwMinor: [9_900_000] });
  const cards = await attachExperienceDisplayPrices(
    [
      { id: 'boom', totalPriceMin: 99_000, totalPriceMax: 99_000, currency: 'NGN' },
      { id: 'ok', totalPriceMin: 100_000, totalPriceMax: 100_000, currency: 'NGN' },
    ],
    'USD',
    convert,
  );
  assertEquals(cards.length, 2, 'a throwing conversion dropped cards');
  assertEquals(cards[0].id, 'boom', 'the card itself survives');
  assertEquals(
    { min: cards[0].displayPriceMin, cur: cards[0].displayCurrency, approx: cards[0].priceIsApprox },
    { min: null, cur: null, approx: false },
  );
  assertEquals(cards[1].displayPriceMin, 74.2, 'the healthy card lost its price');
  assertEquals(cards[1].priceIsApprox, true);
});

Deno.test('#4347 adv: PostgREST answers that are not whole non-negative minor units are no conversion', async () => {
  const answers: Array<{ data?: unknown; error?: unknown; reject?: boolean }> = [
    { data: '7420.5' },
    { data: -7420 },
    { data: '-7420' },
    { data: 'NaN' },
    { data: null },
    { data: {} },
    { data: '9007199254740993' }, // above Number.MAX_SAFE_INTEGER
    { data: 7420, error: { message: 'fx_unavailable' } },
    { reject: true },
  ];
  for (const answer of answers) {
    const client = {
      rpc: () =>
        answer.reject
          ? Promise.reject(new Error('socket hang up'))
          : Promise.resolve({ data: answer.data, error: answer.error ?? null }),
    };
    const price = await experienceDisplayPrice(
      { totalPriceMin: 100_000, totalPriceMax: 100_000, currency: 'NGN' },
      'USD',
      dbMinorConverter(client, 'snap-1'),
    );
    assertEquals(price, NONE, `answer ${JSON.stringify(answer)} was printed as a price`);
  }
  // The happy string form still works (bigint over PostgREST).
  const good = { rpc: () => Promise.resolve({ data: '7420', error: null }) };
  assertEquals(
    (await experienceDisplayPrice({ totalPriceMin: 100_000, totalPriceMax: 100_000, currency: 'NGN' }, 'USD', dbMinorConverter(good, 's')))
      .displayPriceMin,
    74.2,
  );
});

Deno.test('#4347 adv: hostile envelopes never reach the FX RPC', async () => {
  const { convert, calls } = converter();
  for (const card of [
    { totalPriceMin: Number.NaN, totalPriceMax: 100, currency: 'NGN' },
    { totalPriceMin: 100, totalPriceMax: Number.POSITIVE_INFINITY, currency: 'NGN' },
    { totalPriceMin: -1, totalPriceMax: 100, currency: 'NGN' },
    { totalPriceMin: 100, totalPriceMax: -1, currency: 'NGN' },
    { totalPriceMin: 100, totalPriceMax: 100, currency: '' },
    { totalPriceMin: 100, totalPriceMax: 100, currency: 'naira' },
    { totalPriceMin: 100, totalPriceMax: 100, currency: undefined as unknown as string },
  ]) {
    assertEquals(await experienceDisplayPrice(card, 'USD', convert), NONE, JSON.stringify(card));
  }
  assertEquals(calls.length, 0, 'a hostile envelope was sent to fx_convert_minor');
  // Lowercase host currency equal to the viewer: exact, not approximate, no RPC.
  const same = await experienceDisplayPrice({ totalPriceMin: 5_000, totalPriceMax: 7_500, currency: ' ngn ' }, 'NGN', convert);
  assertEquals(same, { displayPriceMin: 5_000, displayPriceMax: 7_500, displayCurrency: 'NGN', priceIsApprox: false });
  assertEquals(calls.length, 0);
  // Free stays free and exact for a same-currency viewer; converted 0 is still 0.
  assertEquals((await experienceDisplayPrice({ totalPriceMin: 0, totalPriceMax: 0, currency: 'NGN' }, 'USD', convert)).displayPriceMin, 0);
});

Deno.test('#4347 adv: fractional naira and concurrent duplicates send whole minor units once', async () => {
  const seen: Array<Record<string, unknown>> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const client = {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      seen.push(args);
      await gate;
      return { data: String(Math.round(Number(args.p_amount) / 1347.74)), error: null };
    },
  };
  const convert = dbMinorConverter(client, 'snap-1');
  const card = { totalPriceMin: 100_000.004, totalPriceMax: 100_000.004, currency: 'NGN' };
  const pending = Promise.all([
    experienceDisplayPrice(card, 'USD', convert),
    experienceDisplayPrice(card, 'USD', convert),
    experienceDisplayPrice(card, 'USD', convert),
  ]);
  release();
  const results = await pending;
  assertEquals(seen.length, 1, 'concurrent identical prices each made a round trip');
  assertEquals(seen[0].p_amount, 10_000_000, 'the RPC must receive whole minor units');
  assertEquals(Number.isInteger(seen[0].p_amount), true);
  for (const r of results) assertEquals(r.displayPriceMin, 74.2);
});
