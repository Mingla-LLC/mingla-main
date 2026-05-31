// ORCH-1012 — adversarial regression test for the cursor-paged batch runner.
//
// Attacks the TWO failure modes that made the old bouncer stall at ~38% on
// London — a DIFFERENT angle than the happy-path test:
//
//   1. Per-row write errors must NOT abort the run. The pre-ORCH-1012 code did
//      `if (firstWriteError) return 500` after the first failing chunk, so a
//      single bad row stranded the rest of the city. This asserts the run
//      processes EVERY row, counts the failures, and keeps the good writes.
//
//   2. The per-invocation budget must be resumable. A run capped at max_rows
//      must report done=false + a next_cursor, and resuming from that cursor
//      must finish the remainder with no row processed twice or skipped.
//
// Fails-on-revert: reinstating abort-on-first-error makes test (1) see far
// fewer than `total` processed; dropping the cursor/budget makes test (2)
// either loop forever or never advance.

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/testing/asserts.ts';
import { runBouncerBatch } from '../bouncerBatch.ts';
import { type PlaceRow, type BouncerVerdict } from '../bouncer.ts';

function makePlace(i: number): PlaceRow {
  return {
    id: `p${String(i).padStart(4, '0')}`,
    name: `Place ${i}`,
    lat: 38.9,
    lng: -77.0,
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

Deno.test('runBouncerBatch: a per-row write error does NOT abort the run', async () => {
  const total = 20;
  const all = Array.from({ length: total }, (_, i) => makePlace(i + 1));
  const seen = new Set<string>(); // every row reaches writeRow
  const written = new Set<string>(); // only the successful ones "persist"

  const result = await runBouncerBatch(
    {
      loadPage: (cursor, pageSize) => {
        const start = cursor ? all.findIndex((p) => p.id > cursor) : 0;
        return Promise.resolve(start < 0 ? [] : all.slice(start, start + pageSize));
      },
      writeRow: (place: PlaceRow, _v: BouncerVerdict) => {
        seen.add(place.id);
        // Every 4th row fails — spread across multiple pages/chunks.
        const idx = Number(place.id.slice(1));
        if (idx % 4 === 0) return Promise.resolve({ error: 'simulated row write failure' });
        written.add(place.id);
        return Promise.resolve({ error: null });
      },
      countRemaining: () => Promise.resolve(total - written.size),
    },
    { maxRows: 1000, pageSize: 6, writeConcurrency: 3, dryRun: false, afterId: null },
  );

  assertEquals(result.processed, total, 'run kept going through every row despite errors');
  assertEquals(seen.size, total, 'every row was attempted');
  assertEquals(result.write_errors, 5, 'exactly the failing rows are counted (20/4)');
  assertEquals(result.written, 15, 'the good rows still persisted');
  assert(result.first_write_error !== null, 'first error message is surfaced');
  assertEquals(result.done, true, 'run completes even with errors present');
});

Deno.test('runBouncerBatch: max_rows budget is resumable via next_cursor', async () => {
  const total = 25;
  const all = Array.from({ length: total }, (_, i) => makePlace(i + 1));
  const written = new Set<string>();

  const deps = {
    loadPage: (cursor: string | null, pageSize: number) => {
      const start = cursor ? all.findIndex((p) => p.id > cursor) : 0;
      return Promise.resolve(start < 0 ? [] : all.slice(start, start + pageSize));
    },
    writeRow: (place: PlaceRow, _v: BouncerVerdict) => {
      written.add(place.id);
      return Promise.resolve({ error: null as string | null });
    },
    countRemaining: () => Promise.resolve(total - written.size),
  };
  const opts = { maxRows: 10, pageSize: 10, writeConcurrency: 5, dryRun: false };

  // First invocation — bounded to 10 rows.
  const r1 = await runBouncerBatch(deps, { ...opts, afterId: null });
  assertEquals(r1.processed, 10);
  assertEquals(r1.done, false, 'not done — more rows remain');
  assert(r1.next_cursor !== null, 'returns a cursor to resume from');
  assertEquals(r1.remaining, 15);

  // Second invocation — resume from the cursor.
  const r2 = await runBouncerBatch(deps, { ...opts, afterId: r1.next_cursor });
  assertEquals(r2.processed, 10);
  assertEquals(r2.done, false);

  // Third invocation — finishes the remaining 5.
  const r3 = await runBouncerBatch(deps, { ...opts, afterId: r2.next_cursor });
  assertEquals(r3.processed, 5);
  assertEquals(r3.done, true, 'short final page ⇒ done');
  assertEquals(r3.next_cursor, null);

  // No row processed twice or skipped across the three resumable invocations.
  assertEquals(written.size, total, 'every distinct row persisted exactly once');
  assertEquals(r3.remaining, 0);
});
