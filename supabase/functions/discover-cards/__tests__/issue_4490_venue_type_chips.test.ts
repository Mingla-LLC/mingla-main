// #4490 Explorer W6b: venue-type chips on the deck ("Places on Mingla").
//
// FAILS-ON-REVERT: drop the split before resolveCategories (solo, collab rotation or
// collab position) and B-2 / B-5 fail; drop the switch gate and B-1 fails; drop the
// venue_types switch check and B-7 fails.
//
// Run: deno test --allow-read --allow-env --no-check supabase/functions/discover-cards/__tests__/issue_4490_venue_type_chips.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleDiscoverCards } from '../index.ts';
import { resetVenueDeckFlagCacheForTests } from '../hostedLead.ts';
import { VENUE_TYPE_CHIPS, deckRadiusMeters, splitVenueTypeChips } from '../venueTypeChips.ts';
import { radiusKmForConstraint } from '../../_shared/distanceMath.ts';

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

function fakeDb(opts: {
  flags: Record<string, boolean>;
  base: Record<string, Array<Record<string, unknown>>>;
  venues?: Record<string, Array<Record<string, unknown>> | 'error'>;
  types?: Array<{ venue_type: string; venue_count: number }> | 'error';
  collab?: Collab;
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
        case 'issue_1384_query_servable_places_by_signal':
        case 'query_servable_places_by_signal_intersection': {
          const ex = new Set((args.p_exclude_place_ids as string[]) ?? []);
          return ok((opts.base[String(args.p_signal_id)] ?? []).filter((r) => !ex.has(String(r.place_id))).map((r) => ({ ...r })));
        }
        case 'issue_4490_hosted_places_by_venue_type':
        case 'issue_4490_hosted_places_by_venue_type_intersection': {
          const a = opts.venues?.[String(args.p_venue_type)];
          if (a === 'error') return Promise.resolve({ data: null, error: { message: 'venue boom' } });
          const ex = new Set((args.p_exclude_place_ids as string[]) ?? []);
          return ok((a ?? []).filter((r) => !ex.has(String(r.place_id))).map((r) => ({ ...r })));
        }
        case 'issue_4490_hosted_venue_types_near':
          if (opts.types === 'error') return Promise.resolve({ data: null, error: { message: 'types boom' } });
          return ok(opts.types ?? []);
        case 'pg_aggregate_collab_prefs': return ok(opts.collab?.agg);
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
        if (table === 'session_participants') return { data: { user_id: filters.user_id, current_position: c?.positions.get(String(filters.user_id)) ?? 0 }, error: null };
        if (table === 'session_deck_cards') return { data: c?.store.get(Number(filters.position)) ?? null, error: null };
        if (table === 'session_deck_versions') return { data: { aggregated_params: { exclude_place_ids: [] } }, error: null };
        if (table === 'place_pool') return { data: c?.places.get(String(filters.id)) ?? null, error: null };
        return { data: null, error: null };
      };
      const many = () => {
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
          return { data: [...c.store.values()].filter((r) => !filters.card_type || r.card_type === filters.card_type), error: null };
        }
        return { data: [], error: null };
      };
      const q: any = {
        select: () => q, eq: (k: string, v: unknown) => { filters[k] = v; return q; }, in: () => q, lt: () => q,
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
async function post(db: ReturnType<typeof fakeDb>, body: Record<string, unknown>, user = 'u-solo') {
  resetVenueDeckFlagCacheForTests();
  const res = await handleDiscoverCards(new Request('https://example.test/functions/v1/discover-cards', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt(user)}` },
    body: JSON.stringify(body),
  }), { adminClient: db, hostedGraceMs: 100 });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}
const solo = (categories: string[]) => ({ categories, location: USER, travelMode: 'driving', travelConstraintValue: 60, dateOption: 'today' });
const ids = (cards: any[]) => cards.map((c) => c.id);

const DRINKS = [row('o1', 300), row('o2', 290)];
const BARS = [row('b1', 0, { venue_id: 'vb1', signal_score: 0, ai_reasoning: null }), row('b2', 0, { venue_id: 'vb2', signal_score: 0, ai_reasoning: null })];

Deno.test('B-1 switch off: a saved venue chip is dropped like any unknown chip (today\'s response for the rest)', async () => {
  const withChip = await post(fakeDb({ flags: {}, base: { drinks: DRINKS }, venues: { bar_lounge: BARS } }), solo(['drinks_and_music', 'venue_type:bar_lounge']));
  const today = await post(fakeDb({ flags: {}, base: { drinks: DRINKS } }), solo(['drinks_and_music']));
  assertEquals(ids(withChip.body.cards), ids(today.body.cards));
  assertEquals(withChip.body.cards, today.body.cards);
  const only = await post(fakeDb({ flags: {}, base: {} }), solo(['venue_type:bar_lounge']));
  assertEquals(only.status, 400, 'no chip left: today\'s empty path');
});

Deno.test('B-1b a request without venue chips never reads the switch (byte-identical path)', async () => {
  const db = fakeDb({ flags: { VENUE_DISCOVER: true }, base: { drinks: DRINKS } });
  await post(db, solo(['drinks_and_music']));
  assertEquals(db.calls.filter((c) => c.fn === 'issue_4490_flag_on' && c.args.p_flag === 'VENUE_DISCOVER').length, 0);
});

Deno.test('B-2 switch on (solo): the chip is split before resolveCategories and serves hosted bars', async () => {
  const db = fakeDb({ flags: { VENUE_DISCOVER: true }, base: { drinks: DRINKS }, venues: { bar_lounge: BARS } });
  const { status, body } = await post(db, solo(['drinks_and_music', 'venue_type:bar_lounge']));
  assertEquals(status, 200);
  const bars = body.cards.filter((c: any) => c.category === 'Bar and lounge');
  assertEquals(ids(bars), ['b1', 'b2']);
  assert(bars.every((c: any) => c.deckLead === 'hosted_venue'), 'venue-type cards are hosted venues');
  assertEquals(ids(body.cards).slice(0, 2).sort(), ['b1', 'o1'], 'one card per chip per round');
  const call = db.calls.find((c) => c.fn === 'issue_4490_hosted_places_by_venue_type')!;
  assertEquals(call.args.p_venue_type, 'bar_lounge');
  assertEquals(call.args.p_radius_m, deckRadiusMeters(radiusKmForConstraint(60, 'driving', 1.5)));
});

Deno.test('B-3 only a venue chip: no signal chips, no cohort needed; filters still apply', async () => {
  const closed = row('b3', 0, { opening_hours: null });
  const db = fakeDb({ flags: { VENUE_DISCOVER: true }, base: {}, venues: { bar_lounge: [...BARS, closed] } });
  const { status, body } = await post(db, solo(['venue_type:bar_lounge']));
  assertEquals(status, 200);
  assertEquals(ids(body.cards), ['b1', 'b2'], 'a bar with no opening hours is filtered like any card');
  assert(body.cards.every((c: any) => c.aiReasoningBySignal === undefined || c.aiReasoningBySignal === null), 'no "why we picked"');
});

Deno.test('B-4 a failed venue call alone is a pipeline error; beside a signal chip it is a partial failure', async () => {
  const alone = await post(fakeDb({ flags: { VENUE_DISCOVER: true }, base: {}, venues: { bar_lounge: 'error' } }), solo(['venue_type:bar_lounge']));
  assertEquals(alone.status, 500);
  const mixed = await post(fakeDb({ flags: { VENUE_DISCOVER: true }, base: { drinks: DRINKS }, venues: { bar_lounge: 'error' } }), solo(['drinks_and_music', 'venue_type:bar_lounge']));
  assertEquals(mixed.status, 200);
  assertEquals(ids(mixed.body.cards), ['o1', 'o2']);
});

function collab(categories: string[]): Collab {
  const places = new Map<string, Record<string, unknown>>();
  for (const r of [...DRINKS, ...BARS]) places.set(String(r.place_id), { id: r.place_id, ...r });
  return {
    agg: { acceptedCount: 2, categories, intents: [], circles: [{ lat: USER.lat, lng: USER.lng, radius_m: 20000, travel_mode: 'driving' }], intersection_empty: false, pending_gps_user_ids: [] },
    store: new Map(), positions: new Map(), places,
  };
}
async function next(db: ReturnType<typeof fakeDb>, user: string, pos: number) {
  return (await post(db, { session_id: 's1', current_position: pos }, user)).body;
}

Deno.test('B-5 collab: venue pills get positions in the rotation, identical for both participants', async () => {
  const fx = collab(['drinks_and_music', 'venue_type:bar_lounge']);
  const db = fakeDb({ flags: { VENUE_DISCOVER: true }, base: { drinks: DRINKS }, venues: { bar_lounge: BARS }, collab: fx });
  const a: Array<[string, string, string | undefined]> = [];
  for (let p = 0; p < 3; p++) {
    const r = await next(db, 'u-a', p);
    a.push([r.card?.id, r.pill_label, r.card?.category]);
  }
  // Today's positional rotation (decideTypeAndPill: odd positions by index, even
  // positions by served count when there are no intents) now includes the venue pill.
  assertEquals(a.map((x) => x[0]), ['o1', 'b1', 'b2']);
  assertEquals(a[1][1], 'venue_type:bar_lounge');
  assertEquals(a[1][2], 'Bar and lounge');
  const b: string[] = [];
  for (let p = 0; p < 3; p++) b.push((await next(db, 'u-b', p)).card?.id);
  assertEquals(b, a.map((x) => x[0]));
  const venueCall = db.calls.find((c) => c.fn === 'issue_4490_hosted_places_by_venue_type_intersection')!;
  assertEquals(venueCall.args.p_venue_type, 'bar_lounge');
});

Deno.test('B-6 collab with the switch off: the venue pill is dropped; today\'s rotation', async () => {
  const off = fakeDb({ flags: {}, base: { drinks: DRINKS }, venues: { bar_lounge: BARS }, collab: collab(['drinks_and_music', 'venue_type:bar_lounge']) });
  const got: string[] = [];
  for (let p = 0; p < 2; p++) got.push((await next(off, 'u-a', p)).card?.id);
  assertEquals(got, ['o1', 'o2']);
  assertEquals(off.calls.some((c) => c.fn.startsWith('issue_4490_hosted_places_by_venue_type')), false);
});

Deno.test('B-7 venue_types: the deck radius, chip types only, empty with the switch off, 500 on failure', async () => {
  const on = fakeDb({ flags: { VENUE_DISCOVER: true }, base: {}, types: [{ venue_type: 'bar_lounge', venue_count: 2 }, { venue_type: 'stay', venue_count: 1 }, { venue_type: 'cafe', venue_count: 0 }] });
  const r = await post(on, { action: 'venue_types', location: USER, travelMode: 'walking', travelConstraintValue: 30 });
  assertEquals(r.status, 200);
  assertEquals(r.body, { types: [{ key: 'bar_lounge', count: 2 }] });
  assertEquals(on.calls.find((c) => c.fn === 'issue_4490_hosted_venue_types_near')!.args,
    { p_lat: USER.lat, p_lng: USER.lng, p_radius_m: deckRadiusMeters(radiusKmForConstraint(30, 'walking', 1.5)) });
  const off = fakeDb({ flags: {}, base: {}, types: [{ venue_type: 'bar_lounge', venue_count: 2 }] });
  assertEquals((await post(off, { action: 'venue_types', location: USER })).body, { types: [] });
  assertEquals(off.calls.some((c) => c.fn === 'issue_4490_hosted_venue_types_near'), false);
  const bad = await post(fakeDb({ flags: { VENUE_DISCOVER: true }, base: {}, types: 'error' }), { action: 'venue_types', location: USER });
  assertEquals(bad.status, 500);
  assertEquals(bad.body.types, []);
  assertEquals((await post(on, { action: 'venue_types', location: { lat: 'x' } })).status, 400);
});

Deno.test('B-8 split helper: known chips only, deduped, order kept; disabled returns the list untouched', () => {
  assertEquals(splitVenueTypeChips(['play', 'venue_type:club', 'venue_type:nope', 'venue_type:club', 'venue_type:cafe'], true),
    { venueChips: ['venue_type:club', 'venue_type:cafe'], rest: ['play', 'venue_type:nope'] });
  const raw = ['play', 'venue_type:club'];
  assertEquals(splitVenueTypeChips(raw, false), { venueChips: [], rest: raw });
  assertEquals(Object.keys(VENUE_TYPE_CHIPS).length, 8);
});
