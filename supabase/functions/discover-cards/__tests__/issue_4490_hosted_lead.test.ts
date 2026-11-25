// #4490 Explorer W5: hosted venues lead each deck category (server only).
//
// MINGLA-INVARIANT: I-DECK-HOSTED-VENUES-LEAD-EACH-CATEGORY | issue #4490 | with VENUE_DECK_HOSTED_FIRST on, inside every solo deck category the hosted venues (at most 6, score DESC, review_count DESC NULLS LAST, place id ASC) come before that category's organic places and organic places keep today's relative order; with the switch off the response is byte-identical to today's.
// MINGLA-INVARIANT: I-DECK-HOSTED-VENUES-LEAD-EACH-CATEGORY-COLLAB | issue #4490 | with VENUE_DECK_HOSTED_FIRST on, at a shared (collab) deck position the position's category is filled from that category's hosted venues first (hosted head, then organic, deduped by place), stored positions never move, and both participants get the same card.
// MINGLA-INVARIANT: I-DECK-HOSTED-NO-FILTER-EXEMPTION | issue #4490 | a hosted venue is served only if it passes every filter the organic deck applies (travel time, date and open-at-time, exclusions, dedupe); a failed, thrown or late hosted call serves today's organic deck.
//
// FAILS-ON-REVERT: removing the partition (index.ts Step 7), the tie-safe merge, the
// safety pass, the hosted settle or the collab candidate order fails the named tests below.
// Fix round 1: W5-S8 fails with the old 1500 ms grace (W5-N1); W5-S9 fails without the
// array / place-id guard (W5-N3); W5-S2 / W5-U7 fail with one hosted call per chip x signal
// (W5-N2); W5-U8 fails if a failed flag read is not cached (W5-N7).
// TEST-MOD-APPROVED #4490 (06-W5 fix 1): the fake answers the request-wide hosted call
// (p_signals) and W5-S2 checks one hosted call with the base call's arguments.
//
// Run: deno test --allow-read --allow-env --no-check supabase/functions/discover-cards/__tests__/issue_4490_hosted_lead.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleDiscoverCards } from '../index.ts';
import {
  HOSTED_GRACE_MS,
  collabCandidates,
  compareHostedRows,
  hostedSignalPairs,
  splitHostedRows,
  venueDeckFlagOn,
  dedupeByPlace,
  leadHostedWithinCategories,
  mergeIntoBucket,
  partitionHostedFirst,
  resetVenueDeckFlagCacheForTests,
  settleHosted,
} from '../hostedLead.ts';

const ALL_DAY = {
  periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    open: { day, hour: 0, minute: 0 },
    close: { day, hour: 23, minute: 59 },
  })),
};
const USER = { lat: 6.45, lng: 3.4 };

/** A place row in the servable RPC shape. */
function row(id: string, score: number, opts: { reviews?: number | null; hours?: unknown; lat?: number } = {}) {
  return {
    place_id: id,
    google_place_id: `g-${id}`,
    name: `Place ${id}`,
    address: 'Lagos',
    lat: opts.lat ?? USER.lat + 0.001,
    lng: USER.lng,
    rating: 4.5,
    review_count: opts.reviews === undefined ? 100 : opts.reviews,
    price_level: null,
    price_range_start_cents: null,
    price_range_end_cents: null,
    opening_hours: opts.hours === undefined ? ALL_DAY : opts.hours,
    website: null,
    photos: [],
    stored_photo_urls: ['https://example.test/p.jpg'],
    types: ['bar'],
    primary_type: 'bar',
    generative_summary: null,
    signal_score: score,
    signal_contributions: {},
    ai_reasoning: null,
    ai_score_raw: null,
  };
}
const hosted = (r: ReturnType<typeof row>) => ({ ...r, venue_id: `v-${r.place_id}` });

type HostedAnswer = Array<Record<string, unknown>> | 'error' | 'throw' | 'object' | { delayMs: number; rows: Array<Record<string, unknown>> };

/** A fake service-role client answering the deck's reads like PostgREST. */
function fakeDb(opts: {
  flag: boolean;
  base: Record<string, Array<Record<string, unknown>>>;
  hosted?: Record<string, HostedAnswer>;
  experiences?: Array<Record<string, unknown>>;
  collab?: {
    agg: Record<string, unknown>;
    store: Map<number, Record<string, unknown>>;
    positions: Map<string, number>;
    places: Map<string, Record<string, unknown>>;
  };
}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const answer = (a: HostedAnswer | undefined): Promise<{ data: unknown; error: unknown }> => {
    if (a === undefined) return Promise.resolve({ data: [], error: null });
    if (a === 'error') return Promise.resolve({ data: null, error: { message: 'hosted boom' } });
    if (a === 'throw') return Promise.reject(new Error('hosted threw'));
    if (a === 'object') return Promise.resolve({ data: { not: 'an array' }, error: null });
    if (Array.isArray(a)) return Promise.resolve({ data: a.map((r) => ({ ...r })), error: null });
    return new Promise((resolve) => setTimeout(() => resolve({ data: a.rows, error: null }), a.delayMs));
  };
  const client = {
    calls,
    rpc(fn: string, args: Record<string, unknown> = {}) {
      calls.push({ fn, args });
      switch (fn) {
        case 'issue_1384_supported_currencies':
          return Promise.resolve({ data: [{ code: 'NGN', minor_unit_exponent: 2 }, { code: 'USD', minor_unit_exponent: 2 }], error: null });
        case 'get_effective_tier':
          return Promise.resolve({ data: 'free', error: null });
        case 'issue_4490_flag_on':
          return Promise.resolve({ data: opts.flag && args.p_flag === 'VENUE_DECK_HOSTED_FIRST', error: null });
        case 'issue_1384_query_servable_places_by_signal':
        case 'query_servable_places_by_signal_intersection': {
          const ex = new Set((args.p_exclude_place_ids as string[]) ?? []);
          const rows = (opts.base[String(args.p_signal_id)] ?? []).filter((r) => !ex.has(String(r.place_id)));
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
        }
        case 'issue_4490_hosted_servable_places':
        case 'issue_4490_hosted_servable_places_intersection': {
          // One call for every (signal, floor) pair of the request (fix round 1).
          const pairs = (args.p_signals as Array<{ signal_id: string; filter_min: number }>) ?? [];
          const ex = new Set((args.p_exclude_place_ids as string[]) ?? []);
          const special = pairs.map((p) => opts.hosted?.[p.signal_id]).find((a) => a !== undefined && !Array.isArray(a));
          if (special !== undefined) {
            if (typeof special === 'object' && 'delayMs' in special) {
              const rows = pairs.flatMap((p) => special.rows.map((r) => ({ ...r, signal_id: p.signal_id, filter_min: p.filter_min })));
              return answer({ delayMs: special.delayMs, rows });
            }
            return answer(special);
          }
          return answer(pairs.flatMap((p) => {
            const a = opts.hosted?.[p.signal_id];
            return (Array.isArray(a) ? a : [])
              .filter((r) => !ex.has(String(r.place_id)))
              .map((r) => ({ ...r, signal_id: p.signal_id, filter_min: p.filter_min }));
          }));
        }
        case 'pg_eligible_experiences_for_deck':
          return Promise.resolve({ data: opts.experiences ?? [], error: null });
        case 'pg_aggregate_collab_prefs':
          return Promise.resolve({ data: opts.collab?.agg, error: null });
        default:
          return Promise.resolve({ data: [], error: null });
      }
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let insertRow: Record<string, unknown> | null = null;
      let updateRow: Record<string, unknown> | null = null;
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters[c] = v; return q; },
        in: () => q,
        lt: () => q,
        insert: (r: Record<string, unknown>) => { insertRow = r; return q; },
        update: (r: Record<string, unknown>) => { updateRow = r; return q; },
        maybeSingle: () => Promise.resolve(resolveOne()),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(resolveMany()).then(ok, bad),
      };
      const c = opts.collab;
      function resolveOne(): { data: unknown; error: unknown } {
        if (table === 'admin_config') return { data: { value: 100 }, error: null };
        if (table === 'collaboration_sessions') return { data: { id: 's1', deck_version: 1, deck_params_hash: 'h' }, error: null };
        if (table === 'session_participants') {
          return { data: { user_id: filters.user_id, current_position: c?.positions.get(String(filters.user_id)) ?? 0 }, error: null };
        }
        if (table === 'session_deck_cards') return { data: c?.store.get(Number(filters.position)) ?? null, error: null };
        if (table === 'session_deck_versions') return { data: { aggregated_params: { exclude_place_ids: [] } }, error: null };
        if (table === 'place_pool') return { data: c?.places.get(String(filters.id)) ?? null, error: null };
        return { data: null, error: null };
      }
      function resolveMany(): { data: unknown; error: unknown } {
        if (table === 'session_deck_cards' && insertRow && c) {
          const pos = Number(insertRow.position);
          if (!c.store.has(pos)) c.store.set(pos, { ...insertRow, curated_payload: null });
          return { data: null, error: null };
        }
        if (table === 'session_participants' && updateRow && c) {
          c.positions.set(String(filters.user_id), Number(updateRow.current_position));
          return { data: null, error: null };
        }
        if (table === 'session_deck_cards' && c) {
          const rows = [...c.store.values()].filter((r) => !filters.card_type || r.card_type === filters.card_type);
          return { data: rows, error: null };
        }
        return { data: [], error: null };
      }
      return q;
    },
  };
  return client;
}

function jwt(sub: string): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64({ sub })}.sig`;
}

function soloRequest(categories: string[], extra: Record<string, unknown> = {}): Request {
  return new Request('https://example.test/functions/v1/discover-cards', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt('u-solo')}` },
    body: JSON.stringify({ categories, location: USER, travelMode: 'driving', travelConstraintValue: 60, dateOption: 'today', ...extra }),
  });
}

async function solo(db: ReturnType<typeof fakeDb>, categories: string[], graceMs = 200) {
  resetVenueDeckFlagCacheForTests();
  const res = await handleDiscoverCards(soloRequest(categories), { adminClient: db, hostedGraceMs: graceMs });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

const ids = (cards: any[]) => cards.map((c) => c.id);

// Drinks: organic o1..o5 ranked by score; h1, h2 are hosted venues that are ALSO in
// the organic list (low scores), h3 is hosted but below the base row cap (absent
// from the base answer), hz has no opening hours (must never be served).
const DRINKS_BASE = [row('o1', 300), row('o2', 290), row('h2', 150), row('o3', 280), row('o4', 270), row('h1', 150), row('o5', 260)];
const DRINKS_HOSTED = [hosted(row('h1', 150)), hosted(row('h2', 150)), hosted(row('h3', 120)), hosted(row('hz', 400, { hours: null }))];
const PLAY_BASE = [row('p1', 300), row('p2', 250), row('hp', 140)];
const PLAY_HOSTED = [hosted(row('hp', 140))];

Deno.test('W5-S1 flag off: byte-identical response, no hosted call', async () => {
  const off = fakeDb({ flag: false, base: { drinks: DRINKS_BASE, play: PLAY_BASE }, hosted: { drinks: DRINKS_HOSTED, play: PLAY_HOSTED } });
  const a = await solo(off, ['drinks_and_music', 'play']);
  assertEquals(off.calls.some((c) => c.fn.startsWith('issue_4490_hosted')), false);
  // Today's code path: the same fixture with no hosted answers configured at all.
  const today = fakeDb({ flag: false, base: { drinks: DRINKS_BASE, play: PLAY_BASE } });
  const b = await solo(today, ['drinks_and_music', 'play']);
  assertEquals(a.text, b.text, 'flag off must not change a single byte');
  assertEquals(a.body.cards.some((c: any) => 'deckLead' in c), false);
});

Deno.test('W5-S2 flag on: hosted lead inside each category, organic keep today\'s order', async () => {
  const db = fakeDb({ flag: true, base: { drinks: DRINKS_BASE, play: PLAY_BASE }, hosted: { drinks: DRINKS_HOSTED, play: PLAY_HOSTED } });
  const { body } = await solo(db, ['drinks_and_music', 'play']);
  const drinks = body.cards.filter((c: any) => c.category === 'Drinks & Music');
  const play = body.cards.filter((c: any) => c.category === 'Play');
  // h1/h2 tie on score and reviews: place id breaks the tie; h3 (not in the base
  // answer) still leads; hz has no hours and is filtered like any card.
  assertEquals(ids(drinks), ['h1', 'h2', 'h3', 'o1', 'o2', 'o3', 'o4', 'o5']);
  assertEquals(ids(play), ['hp', 'p1', 'p2']);
  assertEquals(drinks.slice(0, 3).map((c: any) => c.deckLead), ['hosted_venue', 'hosted_venue', 'hosted_venue']);
  assertEquals(drinks.slice(3).some((c: any) => c.deckLead), false);
  assertEquals(ids(body.cards).includes('hz'), false, 'I-DECK-HOSTED-NO-FILTER-EXEMPTION: closed hosted venue not served');
  assertEquals(new Set(ids(body.cards)).size, body.cards.length, 'no venue twice');
  // Round robin is unchanged: one card per category per round (chip order is
  // resolveCategories' canonical order, as today).
  assertEquals(ids(body.cards).slice(0, 4), ['hp', 'h1', 'p1', 'h2']);
  // ONE hosted call for the request (fix round 1, W5-N2) with the base call's
  // radius, exclusions and price filter, and every (signal, floor) pair.
  const hostedCalls = db.calls.filter((c) => c.fn === 'issue_4490_hosted_servable_places');
  assertEquals(hostedCalls.length, 1, 'one hosted call per request, not one per chip x signal');
  const base = db.calls.find((c) => c.fn === 'issue_1384_query_servable_places_by_signal')!.args;
  const { p_limit: _ignored, p_signal_id: _s, p_filter_min: _f, ...baseShared } = base;
  const { p_signals, ...hostedShared } = hostedCalls[0].args;
  assertEquals(hostedShared, baseShared);
  const baseCalls = db.calls.filter((c) => c.fn === 'issue_1384_query_servable_places_by_signal');
  assertEquals(
    (p_signals as Array<{ signal_id: string; filter_min: number }>).map((p) => `${p.signal_id}:${p.filter_min}`).sort(),
    [...new Set(baseCalls.map((c) => `${c.args.p_signal_id}:${c.args.p_filter_min}`))].sort(),
  );
});

Deno.test('W5-S3 at most 6 hosted per category; the rest stay in the organic part', async () => {
  const many = Array.from({ length: 8 }, (_, i) => hosted(row(`hh${i}`, 200 - i)));
  const base = [row('o1', 300), ...many.map((h) => row(h.place_id as string, h.signal_score as number))];
  const db = fakeDb({ flag: true, base: { drinks: base }, hosted: { drinks: many } });
  const { body } = await solo(db, ['drinks_and_music']);
  assertEquals(ids(body.cards), ['hh0', 'hh1', 'hh2', 'hh3', 'hh4', 'hh5', 'o1', 'hh6', 'hh7']);
  assertEquals(body.cards.filter((c: any) => c.deckLead === 'hosted_venue').length, 6);
});

Deno.test('W5-S4 a failed, thrown or late hosted call serves today\'s deck', async () => {
  const today = await solo(fakeDb({ flag: false, base: { drinks: DRINKS_BASE } }), ['drinks_and_music']);
  for (const bad of ['error', 'throw', { delayMs: 400, rows: DRINKS_HOSTED }] as HostedAnswer[]) {
    const db = fakeDb({ flag: true, base: { drinks: DRINKS_BASE }, hosted: { drinks: bad } });
    const t = Date.now();
    const { status, body } = await solo(db, ['drinks_and_music'], 100);
    assertEquals(status, 200);
    assertEquals(ids(body.cards), ids(today.body.cards), `hosted ${JSON.stringify(bad).slice(0, 20)} must leave today's order`);
    assert(Date.now() - t < 390, 'a late hosted call never holds the deck past the grace');
  }
  await new Promise((r) => setTimeout(r, 450)); // let the late fake answer land
});

Deno.test('W5-S5 a hosted call never counts toward the all-failed guard', async () => {
  const db = fakeDb({ flag: true, base: { drinks: DRINKS_BASE }, hosted: { drinks: 'error' } });
  const { status, body } = await solo(db, ['drinks_and_music']);
  assertEquals(status, 200);
  assertEquals(body.sourceBreakdown.reason, 'Signal-served v2 multi-chip: 1 chips, 1 RPCs (0 failed)');
});

Deno.test('W5-S6 experiences unchanged (index 0..n-1) and tagged only with the switch on', async () => {
  const exp = [{ id: 'e1', event_id: 'e1', title: 'Exp', slug: 'exp', brand_id: 'b', experience_intents: ['romantic'], next_start_at: '2030-01-01T10:00:00Z' }];
  const on = await solo(fakeDb({ flag: true, base: { drinks: DRINKS_BASE }, hosted: { drinks: DRINKS_HOSTED }, experiences: exp }), ['drinks_and_music']);
  const off = await solo(fakeDb({ flag: false, base: { drinks: DRINKS_BASE }, experiences: exp }), ['drinks_and_music']);
  assertEquals(off.body.cards[0].id, 'e1', 'today: the experience leads');
  assertEquals(on.body.cards[0].id, 'e1', 'switch on: the experience still leads');
  assertEquals(on.body.cards[0].deckLead, 'experience');
  assertEquals('deckLead' in off.body.cards[0], false);
  assertEquals(on.body.cards[1].id, 'h1', 'then the hosted head of the category');
});

Deno.test('W5-S7 deterministic: three identical requests give identical bytes', async () => {
  const outs: string[] = [];
  for (let i = 0; i < 3; i++) {
    const db = fakeDb({ flag: true, base: { drinks: DRINKS_BASE, play: PLAY_BASE }, hosted: { drinks: DRINKS_HOSTED, play: PLAY_HOSTED } });
    outs.push((await solo(db, ['drinks_and_music', 'play'])).text);
  }
  assertEquals(outs[0], outs[1]);
  assertEquals(outs[1], outs[2]);
});

Deno.test('W5-S8 the default grace: a slow hosted call adds at most ~150 ms, logs hosted=late, and leaves no trace', async () => {
  const today = await solo(fakeDb({ flag: false, base: { drinks: DRINKS_BASE } }), ['drinks_and_music']);
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(' ')); };
  let elapsed = 0;
  let body: any;
  try {
    resetVenueDeckFlagCacheForTests();
    const db = fakeDb({ flag: true, base: { drinks: DRINKS_BASE }, hosted: { drinks: { delayMs: 1200, rows: DRINKS_HOSTED } } });
    const t = Date.now();
    // No hostedGraceMs override: the shipped HOSTED_GRACE_MS applies.
    const res = await handleDiscoverCards(soloRequest(['drinks_and_music']), { adminClient: db });
    elapsed = Date.now() - t;
    body = await res.json();
  } finally {
    console.warn = realWarn;
  }
  assertEquals(HOSTED_GRACE_MS, 150);
  assert(elapsed < 450, `the organic deck waited ${elapsed} ms for a 1200 ms hosted answer (was 1500 ms)`);
  assertEquals(ids(body.cards), ids(today.body.cards), 'a late hosted answer leaves today\'s order');
  assert(warnings.some((w) => w.includes('hosted=late')), 'hosted=late is logged');
  await new Promise((r) => setTimeout(r, 1300)); // the late answer lands and is dropped
  const after = await solo(fakeDb({ flag: false, base: { drinks: DRINKS_BASE } }), ['drinks_and_music']);
  assertEquals(after.text, today.text, 'a late hosted answer has no effect on a later page');
});

Deno.test('W5-S9 a malformed hosted answer (not an array, or a row without a place id) serves today\'s deck', async () => {
  const today = await solo(fakeDb({ flag: false, base: { drinks: DRINKS_BASE } }), ['drinks_and_music']);
  const notArray = await solo(fakeDb({ flag: true, base: { drinks: DRINKS_BASE }, hosted: { drinks: 'object' } }), ['drinks_and_music']);
  assertEquals(notArray.status, 200);
  assertEquals(ids(notArray.body.cards), ids(today.body.cards));
  const nullId = await solo(fakeDb({ flag: true, base: { drinks: DRINKS_BASE }, hosted: { drinks: [{ ...hosted(row('x', 500)), place_id: null }] } }), ['drinks_and_music']);
  assertEquals(nullId.status, 200);
  assertEquals(ids(nullId.body.cards), ids(today.body.cards));
  assertEquals(nullId.body.cards.some((c: any) => c.deckLead === 'hosted_venue'), false, 'no null-id lead');
});

// ── pure helpers ──────────────────────────────────────────────────────────────

Deno.test('W5-U7 one request-wide hosted call: pairs deduped, rows split back per task in order', () => {
  const tasks = [
    { chip: 'a', signalId: 's1', filterMin: 120, displayCategory: 'A' },
    { chip: 'b', signalId: 's1', filterMin: 120, displayCategory: 'B' },
    { chip: 'b', signalId: 's2', filterMin: 80, displayCategory: 'B' },
  ];
  assertEquals(hostedSignalPairs(tasks), [{ signal_id: 's1', filter_min: 120 }, { signal_id: 's2', filter_min: 80 }]);
  const data = [
    { place_id: 'p2', signal_id: 's2', filter_min: '80', venue_id: 'v2' },
    { place_id: 'p1', signal_id: 's1', filter_min: 120, venue_id: 'v1' },
    { place_id: 'p3', signal_id: 's1', filter_min: 120, venue_id: 'v3' },
    { place_id: null, signal_id: 's1', filter_min: 120 },
    { place_id: 'p9', signal_id: 's1', filter_min: 121 },
  ];
  const split = splitHostedRows(tasks, data);
  assertEquals(split.map((s) => s.res.data.map((r: any) => r.place_id)), [['p1', 'p3'], ['p1', 'p3'], ['p2']]);
  assertEquals('signal_id' in split[0].res.data[0], false, 'routing columns removed: base row shape');
  assertEquals(splitHostedRows(tasks, { x: 1 }).map((s) => s.res.data.length), [0, 0, 0]);
  assertEquals(splitHostedRows(tasks, null).map((s) => s.res.data.length), [0, 0, 0]);
});

Deno.test('W5-U8 a failed switch read is cached as off (no repeated failing read)', async () => {
  resetVenueDeckFlagCacheForTests();
  let reads = 0;
  const failing = { rpc: () => { reads++; return Promise.resolve({ data: null, error: { message: 'PGRST202' } }); } };
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    assertEquals(await venueDeckFlagOn(failing, 'VENUE_DECK_HOSTED_FIRST', () => 1000), false);
    assertEquals(await venueDeckFlagOn(failing, 'VENUE_DECK_HOSTED_FIRST', () => 2000), false);
    assertEquals(reads, 1, 'second read within 60 s served from the cache');
    assertEquals(await venueDeckFlagOn(failing, 'VENUE_DECK_HOSTED_FIRST', () => 70_000), false);
    assertEquals(reads, 2, 'read again after 60 s');
  } finally {
    console.warn = realWarn;
    resetVenueDeckFlagCacheForTests();
  }
});


Deno.test('W5-U1 the hosted tag survives a tied-score merge (first row stays)', () => {
  const bucket = new Map<string, any>();
  mergeIntoBucket(bucket, row('a', 100), { __displayCategory: 'X' }, false);
  mergeIntoBucket(bucket, hosted(row('a', 100)), { __displayCategory: 'X' }, true);
  assertEquals(bucket.get('a').__hosted, true);
  assertEquals(bucket.get('a').venue_id, undefined, 'the first (base) row stays on a tie');
  mergeIntoBucket(bucket, row('a', 100), { __displayCategory: 'X' }, false);
  assertEquals(bucket.get('a').__hosted, true, 'a later organic copy never clears the tag');
  mergeIntoBucket(bucket, row('a', 120), { __displayCategory: 'X' }, false);
  assertEquals(bucket.get('a').__hosted, true, 'a higher-score organic copy keeps the tag');
});

Deno.test('W5-U2 hosted order: score, reviews (nulls last), then place id', () => {
  const rows = [
    { place_id: 'c', signal_score: 10, review_count: null },
    { place_id: 'b', signal_score: 10, review_count: 5 },
    { place_id: 'a', signal_score: 10, review_count: null },
    { place_id: 'd', signal_score: 11, review_count: 1 },
  ];
  assertEquals(rows.slice().sort(compareHostedRows).map((r) => r.place_id), ['d', 'b', 'a', 'c']);
});

Deno.test('W5-U3 partition keeps the organic order exactly', () => {
  const arr = [
    { place_id: 'o1', signal_score: 9 }, { place_id: 'h1', signal_score: 8, __hosted: true },
    { place_id: 'o2', signal_score: 7 }, { place_id: 'o3', signal_score: 7 },
  ];
  assertEquals(partitionHostedFirst(arr).map((r) => r.place_id), ['h1', 'o1', 'o2', 'o3']);
  const none = [{ place_id: 'o1' }, { place_id: 'o2' }];
  assertEquals(partitionHostedFirst(none), none, 'no hosted rows: the very same array');
});

Deno.test('W5-U4 safety pass: two chips sharing one display category', () => {
  const cards = [
    { id: 'b1', category: 'Brunch' }, { id: 'x1', category: 'Play' },
    { id: 'b2', category: 'Brunch', deckLead: 'hosted_venue' }, { id: 'x2', category: 'Play' },
    { id: 'b3', category: 'Brunch' },
  ];
  assertEquals(leadHostedWithinCategories(cards).map((c) => c.id), ['b2', 'x1', 'b1', 'x2', 'b3']);
  const seven = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, category: 'C', deckLead: i === 0 ? undefined : 'hosted_venue' }));
  const out = leadHostedWithinCategories(seven);
  assertEquals(out.map((c) => c.id), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c0', 'c7']);
  assertEquals(out.filter((c) => c.deckLead === 'hosted_venue').length, 6, 'cap 6 per display category');
});

Deno.test('W5-U5 dedupe and collab candidates: hosted copy wins, first place stays', () => {
  assertEquals(dedupeByPlace([{ place_id: 'a' }, { place_id: 'b' }, { place_id: 'a' }]).map((r) => r.place_id), ['a', 'b']);
  const c = collabCandidates([{ place_id: 'h1', h: 1 } as any], [{ place_id: 'o1' }, { place_id: 'h1' }]);
  assertEquals(c.map((r) => r.place_id), ['h1', 'o1']);
  assertEquals((c[0] as any).h, 1);
});

Deno.test('W5-U6 settleHosted: on time, late, rejected', async () => {
  const base = Promise.resolve([]);
  assertEquals(await settleHosted(Promise.resolve([1]), base, 50), [1]);
  assertEquals(await settleHosted(new Promise((r) => setTimeout(() => r([2]), 120)), base, 30), null);
  assertEquals(await settleHosted(Promise.reject(new Error('x')), base, 30), null);
  await new Promise((r) => setTimeout(r, 120)); // let the late promise land
});

// ── collab ────────────────────────────────────────────────────────────────────

function collabFixture(flag: boolean) {
  const places = new Map<string, Record<string, unknown>>();
  for (const r of [...DRINKS_BASE, ...DRINKS_HOSTED]) {
    places.set(String(r.place_id), { id: r.place_id, ...r });
  }
  return {
    flag,
    base: { drinks: DRINKS_BASE },
    hosted: { drinks: DRINKS_HOSTED },
    collab: {
      agg: {
        acceptedCount: 2,
        categories: ['drinks_and_music'],
        intents: [],
        circles: [{ lat: USER.lat, lng: USER.lng, radius_m: 20000, travel_mode: 'driving' }],
        intersection_empty: false,
        pending_gps_user_ids: [],
      },
      store: new Map<number, Record<string, unknown>>(),
      positions: new Map<string, number>(),
      places,
    },
  };
}

async function collabNext(db: ReturnType<typeof fakeDb>, user: string, pos: number) {
  resetVenueDeckFlagCacheForTests();
  const req = new Request('https://example.test/functions/v1/discover-cards', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt(user)}` },
    body: JSON.stringify({ session_id: 's1', current_position: pos }),
  });
  const res = await handleDiscoverCards(req, { adminClient: db, hostedGraceMs: 200 });
  return await res.json();
}

Deno.test('W5-C1 collab: the category\'s hosted venues fill its first positions, same for both participants', async () => {
  const fx = collabFixture(true);
  const db = fakeDb(fx);
  const seenA: string[] = [];
  for (let p = 0; p < 6; p++) seenA.push((await collabNext(db, 'u-a', p)).card?.id);
  assertEquals(seenA, ['h1', 'h2', 'h3', 'o1', 'o2', 'o3']);
  // The second participant reads the stored positions: identical, never moved.
  const seenB: string[] = [];
  for (let p = 0; p < 6; p++) seenB.push((await collabNext(db, 'u-b', p)).card?.id);
  assertEquals(seenB, seenA);
});

Deno.test('W5-C2 collab flag off: today\'s positions; hosted failure: today\'s positions', async () => {
  const off = fakeDb(collabFixture(false));
  const today: string[] = [];
  for (let p = 0; p < 4; p++) today.push((await collabNext(off, 'u-a', p)).card?.id);
  assertEquals(today, ['o1', 'o2', 'o3', 'o4']);
  assertEquals(off.calls.some((c) => c.fn.startsWith('issue_4490_hosted')), false);
  const fx = collabFixture(true);
  fx.hosted = { drinks: 'error' } as any;
  const failing = fakeDb(fx);
  const got: string[] = [];
  for (let p = 0; p < 4; p++) got.push((await collabNext(failing, 'u-a', p)).card?.id);
  assertEquals(got, today);
});
