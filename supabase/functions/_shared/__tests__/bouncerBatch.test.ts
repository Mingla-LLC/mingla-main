// ORCH-1012 — happy-path regression test for the cursor-paged batch runner.
//
// Proves the core property the fix exists to guarantee: a multi-page city is
// processed in full via cursor paging (one page in memory at a time), every row
// is written exactly once, and the run reports done with zero remaining.
//
// Fails-on-revert: if runBouncerBatch reverts to the pre-ORCH-1012 "load the
// whole city + abort on first write error" shape, the multi-page / cursor /
// remaining assertions below break.

import { assertEquals } from 'https://deno.land/std@0.208.0/testing/asserts.ts';
import { runBouncerBatch } from '../bouncerBatch.ts';
import { type PlaceRow, type BouncerVerdict } from '../bouncer.ts';

function makePlace(i: number): PlaceRow {
  // Zero-padded id so lexical order === numeric order (matches .order('id')).
  return {
    id: `p${String(i).padStart(4, '0')}`,
    name: `Place ${i}`,
    lat: 38.9 + i / 1000,
    lng: -77.0 + i / 1000,
    types: ['restaurant'],
    business_status: 'OPERATIONAL',
    website: 'https://example.com',
    opening_hours: { weekday_text: ['Mon: 9-5'] },
    photos: [{ name: 'x' }],
    stored_photo_urls: ['https://cdn/x.jpg'],
    review_count: 100,
    rating: 4.5,
  } as unknown as PlaceRow;
}

// In-memory fake of the place_pool slice for one city, id-ordered.
function makeFakeStore(total: number) {
  const all = Array.from({ length: total }, (_, i) => makePlace(i + 1));
  const judged = new Set<string>();
  return {
    all,
    judged,
    deps: {
      loadPage: (cursor: string | null, pageSize: number): Promise<PlaceRow[]> => {
        const start = cursor ? all.findIndex((p) => p.id > cursor) : 0;
        const slice = start < 0 ? [] : all.slice(start, start + pageSize);
        return Promise.resolve(slice);
      },
      writeRow: (place: PlaceRow, _verdict: BouncerVerdict): Promise<{ error?: string | null }> => {
        judged.add(place.id);
        return Promise.resolve({ error: null });
      },
      countRemaining: (): Promise<number | null> => Promise.resolve(total - judged.size),
    },
  };
}

Deno.test('runBouncerBatch: processes an entire multi-page city via cursor paging', async () => {
  const total = 23; // > pageSize, deliberately not a page multiple
  const store = makeFakeStore(total);

  const result = await runBouncerBatch(store.deps, {
    maxRows: 1000,
    pageSize: 10,
    writeConcurrency: 4,
    dryRun: false,
    afterId: null,
  });

  assertEquals(result.processed, total, 'every row is evaluated');
  assertEquals(result.written, total, 'every row is written exactly once');
  assertEquals(store.judged.size, total, 'all distinct rows persisted');
  assertEquals(result.write_errors, 0, 'no write errors on the happy path');
  assertEquals(result.done, true, 'run reports done when rows are exhausted');
  assertEquals(result.next_cursor, null, 'no cursor returned once done');
  assertEquals(result.remaining, 0, 'zero rows left unjudged');
  // pass + reject must account for every processed row.
  assertEquals(result.summary.pass_count + result.summary.reject_count, total);
});

Deno.test('runBouncerBatch: dry_run evaluates without writing', async () => {
  const store = makeFakeStore(12);

  const result = await runBouncerBatch(store.deps, {
    maxRows: 1000,
    pageSize: 5,
    writeConcurrency: 4,
    dryRun: true,
    afterId: null,
  });

  assertEquals(result.processed, 12, 'dry run still evaluates every row');
  assertEquals(result.written, 0, 'dry run writes nothing');
  assertEquals(store.judged.size, 0, 'no rows persisted on dry run');
  assertEquals(result.done, true);
});
