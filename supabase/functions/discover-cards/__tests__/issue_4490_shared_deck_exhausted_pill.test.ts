// #4490 Explorer W6 fix round 1 (W6-N2): a shared deck ends at an exhausted pill, venue-type
// pills included, exactly as it does for any category that runs out.
//
// MINGLA-INVARIANT: I-4490-SHARED-DECK-EXHAUSTED-PILL-ENDS-AS-TODAY | issue #4490 | in a shared deck, a venue-type pill that has nothing left to serve ends the deck at its turn exactly as an exhausted ordinary category does (curated fallback, then the dead end), with VENUE_DISCOVER on or off; the rule is kept by the product owner's decision of 22 Nov ("End as today"), and this suite pins it so it cannot change by accident.
//
// Adapted from the independent tester's repro: drinks with 30 places + "Bar and lounge" with
// one venue gives o0 b1 END END ... (the same shape as drinks + a one-place "Play").
//
// FAILS-ON-CHANGE: any skip-and-continue for an exhausted pill (venue-type or ordinary) makes
// X-1 / X-3 fail; dropping the venue split makes X-1 fail (b1 never served).
//
// Run: deno test --allow-read --allow-env --no-check supabase/functions/discover-cards/__tests__/issue_4490_shared_deck_exhausted_pill.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleDiscoverCards } from '../index.ts';
import { resetVenueDeckFlagCacheForTests } from '../hostedLead.ts';

const ALL_DAY = {
  periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 0, minute: 0 }, close: { day, hour: 23, minute: 59 } })),
};
const USER = { lat: 6.45, lng: 3.4 };

function row(id: string, score: number, extra: Record<string, unknown> = {}) {
  return {
    place_id: id, google_place_id: `g-${id}`, name: `Place ${id}`, address: 'Lagos', lat: USER.lat + 0.001, lng: USER.lng,
    rating: 4.5, review_count: 100, price_level: null, price_range_start_cents: null, price_range_end_cents: null,
    opening_hours: ALL_DAY, website: null, photos: [], stored_photo_urls: ['https://example.test/p.jpg'], types: ['bar'],
    primary_type: 'bar', generative_summary: null, signal_score: score, signal_contributions: {},
    ai_reasoning: { reasoning: 'Great drinks' }, ai_score_raw: null, ...extra,
  };
}

type Collab = {
  agg: Record<string, unknown>;
  store: Map<number, Record<string, unknown>>;
  positions: Map<string, number>;
  places: Map<string, Record<string, unknown>>;
};

/** A fake service-role client answering the shared deck's reads like PostgREST. */
function fakeDb(opts: {
  flags: Record<string, boolean>;
  base: Record<string, Array<Record<string, unknown>>>;
  venues?: Record<string, Array<Record<string, unknown>>>;
  collab: Collab;
}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    calls,
    rpc(fn: string, args: Record<string, unknown> = {}) {
      calls.push({ fn, args });
      const ok = (data: unknown) => Promise.resolve({ data, error: null });
      switch (fn) {
        case 'issue_1384_supported_currencies': return ok([{ code: 'NGN', minor_unit_exponent: 2 }]);
        case 'get_effective_tier': return ok('free');
        case 'issue_4490_flag_on': return ok(opts.flags[String(args.p_flag)] === true);
        case 'query_servable_places_by_signal_intersection': {
          const ex = new Set((args.p_exclude_place_ids as string[]) ?? []);
          return ok((opts.base[String(args.p_signal_id)] ?? []).filter((r) => !ex.has(String(r.place_id))).map((r) => ({ ...r })));
        }
        case 'issue_4490_hosted_places_by_venue_type_intersection': {
          const ex = new Set((args.p_exclude_place_ids as string[]) ?? []);
          return ok((opts.venues?.[String(args.p_venue_type)] ?? []).filter((r) => !ex.has(String(r.place_id))).map((r) => ({ ...r })));
        }
        case 'pg_aggregate_collab_prefs': return ok(opts.collab.agg);
        default: return ok([]);
      }
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let insertRow: Record<string, unknown> | null = null;
      let updateRow: Record<string, unknown> | null = null;
      const c = opts.collab;
      const one = () => {
        if (table === 'admin_config') return { data: { value: 100 }, error: null };
        if (table === 'collaboration_sessions') return { data: { id: 's1', deck_version: 1, deck_params_hash: 'h' }, error: null };
        if (table === 'session_participants') return { data: { user_id: filters.user_id, current_position: c.positions.get(String(filters.user_id)) ?? 0 }, error: null };
        if (table === 'session_deck_cards') return { data: c.store.get(Number(filters.position)) ?? null, error: null };
        if (table === 'session_deck_versions') return { data: { aggregated_params: { exclude_place_ids: [] } }, error: null };
        if (table === 'place_pool') return { data: c.places.get(String(filters.id)) ?? null, error: null };
        return { data: null, error: null };
      };
      const many = () => {
        if (table === 'session_deck_cards' && insertRow) {
          const pos = Number(insertRow.position);
          if (!c.store.has(pos)) c.store.set(pos, { ...insertRow, curated_payload: null });
          return { data: null, error: null };
        }
        if (table === 'session_participants' && updateRow) {
          c.positions.set(String(filters.user_id), Number(updateRow.current_position));
          return { data: null, error: null };
        }
        if (table === 'session_deck_cards') {
          return { data: [...c.store.values()].filter((r) => !filters.card_type || r.card_type === filters.card_type), error: null };
        }
        return { data: [], error: null };
      };
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        in: () => q,
        lt: () => q,
        insert: (r: Record<string, unknown>) => { insertRow = r; return q; },
        update: (r: Record<string, unknown>) => { updateRow = r; return q; },
        maybeSingle: () => Promise.resolve(one()),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(many()).then(ok, bad),
      };
      return q;
    },
  };
  return client;
}

function jwt(sub: string): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64({ sub })}.sig`;
}

const DRINKS = Array.from({ length: 30 }, (_, i) => row(`o${i}`, 300 - i));
const PLAY_ONE = [row('p0', 250)];
const ONE_BAR = [row('b1', 0, { venue_id: 'vb1', signal_score: 0, ai_reasoning: null })];

function session(categories: string[]): Collab {
  const places = new Map<string, Record<string, unknown>>();
  for (const r of [...DRINKS, ...PLAY_ONE, ...ONE_BAR]) places.set(String(r.place_id), { id: r.place_id, ...r });
  return {
    agg: {
      acceptedCount: 2, categories, intents: [],
      circles: [{ lat: USER.lat, lng: USER.lng, radius_m: 20000, travel_mode: 'driving' }],
      intersection_empty: false, pending_gps_user_ids: [],
    },
    store: new Map(), positions: new Map(), places,
  };
}

/** Walks `n` positions as one participant; a dead end is shown as END:<reason>. */
async function walk(db: ReturnType<typeof fakeDb>, n: number, user = 'u-a'): Promise<string[]> {
  const out: string[] = [];
  for (let p = 0; p < n; p++) {
    resetVenueDeckFlagCacheForTests();
    const res = await handleDiscoverCards(new Request('https://example.test/functions/v1/discover-cards', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt(user)}` },
      body: JSON.stringify({ session_id: 's1', current_position: p }),
    }), { adminClient: db, hostedGraceMs: 100 });
    const b = await res.json();
    out.push(b.card ? `${b.card.id}(${b.pill_label})` : `END:${b.reason}`);
  }
  return out;
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

Deno.test('X-1 switch on: an exhausted venue-type pill ends the shared deck at its turn (today\'s rule), same for both participants', async () => {
  const collab = session(['drinks_and_music', 'venue_type:bar_lounge']);
  const db = fakeDb({ flags: { VENUE_DISCOVER: true }, base: { drinks: DRINKS }, venues: { bar_lounge: ONE_BAR }, collab });
  const a = await quiet(() => walk(db, 6, 'u-a'));
  assertEquals(a.slice(0, 2), ['o0(Drinks & Music)', 'b1(venue_type:bar_lounge)']);
  assert(a.slice(2).every((x) => x.startsWith('END')), `the deck ends at the exhausted venue pill: ${a.join(' ')}`);
  const b = await quiet(() => walk(db, 6, 'u-b'));
  assertEquals(b, a, 'the second participant sees the same deck');
});

Deno.test('X-2 switch off: today\'s deck (the venue chip is dropped like any unknown chip; 10 drinks cards)', async () => {
  const db = fakeDb({ flags: {}, base: { drinks: DRINKS }, venues: { bar_lounge: ONE_BAR },
    collab: session(['drinks_and_music', 'venue_type:bar_lounge']) });
  const off = await quiet(() => walk(db, 10));
  assertEquals(off, DRINKS.slice(0, 10).map((r) => `${r.place_id}(Drinks & Music)`));
  assertEquals(db.calls.some((c) => c.fn === 'issue_4490_hosted_places_by_venue_type_intersection'), false);
});

Deno.test('X-3 the same rule as an ordinary category that runs out (a one-place Play), switch on or off', async () => {
  const venue = await quiet(() => walk(fakeDb({ flags: { VENUE_DISCOVER: true }, base: { drinks: DRINKS }, venues: { bar_lounge: ONE_BAR },
    collab: session(['drinks_and_music', 'venue_type:bar_lounge']) }), 5));
  for (const flags of [{}, { VENUE_DISCOVER: true }] as Record<string, boolean>[]) {
    const ordinary = await quiet(() => walk(fakeDb({ flags, base: { drinks: DRINKS, play: PLAY_ONE }, collab: session(['drinks_and_music', 'play']) }), 5));
    assertEquals(ordinary.slice(0, 2), ['o0(Drinks & Music)', 'p0(Play)']);
    assertEquals(ordinary.slice(2), venue.slice(2), 'the venue pill ends the deck exactly as the ordinary one');
  }
});

Deno.test('X-4 a mixed session: an exhausted ordinary pill also ends the deck with the switch on', async () => {
  const db = fakeDb({ flags: { VENUE_DISCOVER: true }, base: { drinks: DRINKS, play: PLAY_ONE }, venues: { bar_lounge: ONE_BAR },
    collab: session(['drinks_and_music', 'play', 'venue_type:bar_lounge']) });
  const got = await quiet(() => walk(db, 6));
  // Rotation: Drinks, Play, Bar and lounge. Play's one place is used at position 2, so its
  // next turn (position 3) ends the deck, as today.
  assertEquals(got.slice(0, 2), ['o0(Drinks & Music)', 'p0(Play)']);
  assert(got.slice(2).every((x) => x.startsWith('END')), got.join(' '));
});
