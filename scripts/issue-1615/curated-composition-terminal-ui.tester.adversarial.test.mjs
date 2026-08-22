/**
 * #1615 curated-composition independent tester suite.
 *
 * Different angle from the implementor happy path: hostile identity shapes,
 * hostile database cardinality/state, forged display payloads, refresh leakage,
 * forbidden persistence, concurrent failures/retries, and terminal-state
 * exclusivity. No assertion depends on the implementor test file.
 *
 * FAILS-ON-REVERT: weakening the production served-row gate from
 * `row?.is_servable !== true` to `row?.is_servable === false` makes the null and
 * missing is_servable cases public and fails TA2.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createContentShareSingleFlight } from '../../packages/sharing/index.js';
import {
  curatedCompositionIdentity,
  sharePreviewTerminalState,
} from '../../app-mobile/src/services/contentShareIdentity.ts';
import {
  loadAuthoritativeContentShare,
  PLACE_POOL_SHARE_SELECT,
} from '../../supabase/functions/_shared/contentShare.ts';
import {
  createContentShareV1,
  refreshContentShareV1,
} from '../../supabase/functions/_shared/contentShareService.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const IDS = ['google-private-a', 'google-private-b', 'google-private-c'];
const PHOTO_A = 'https://images.pexels.com/photos/1615/a.jpg';
const PHOTO_B = 'https://images.pexels.com/photos/1615/b.jpg';

const served = (googlePlaceId, overrides = {}) => ({
  id: `pool-${googlePlaceId}`,
  google_place_id: googlePlaceId,
  name: `Served ${googlePlaceId.slice(-1).toUpperCase()}`,
  address: `${googlePlaceId.slice(-1).toUpperCase()} Main St`,
  city: 'Durham',
  primary_type_display_name: 'Served category',
  editorial_summary: `Served summary ${googlePlaceId.slice(-1).toUpperCase()}`,
  stored_photo_urls: [],
  is_active: true,
  is_servable: true,
  ...overrides,
});

function createDb(result) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({ operation: 'from', table });
      if (table !== 'place_pool') throw new Error(`forbidden table ${table}`);
      return {
        select(projection) {
          calls.push({ operation: 'select', table, projection });
          return {
            async in(column, values) {
              calls.push({ operation: 'in', table, column, values: [...values] });
              return typeof result === 'function' ? result(values) : result;
            },
          };
        },
      };
    },
    async rpc(name, args) {
      calls.push({ operation: 'rpc', name, args });
      // [TEST-MOD-APPROVED #1719] The immutable server message is now a second
      // authoritative RPC read after minting; model it without weakening the
      // hostile identity/database assertions in this independent suite.
      if (name === 'resolve_content_share_message') {
        return { data: `Curated plan\n\nhttps://usemingla.com/s/${args.p_code}`, error: null };
      }
      // [TEST-MOD-APPROVED #1719] Curated shares use the additive native
      // snapshot RPC. Keep every other persistence path forbidden.
      if (name !== 'upsert_content_share_version_with_native_snapshot') throw new Error(`forbidden rpc ${name}`);
      return { data: { shortCode: 'Aa0Bb1Cc2Dd3Ee4F', version: 4, versionCreated: true }, error: null };
    },
  };
}

function refreshDb(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({ operation: 'from', table });
      if (table === 'content_share_links') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return {
              data: {
                id: 'private-link-id',
                short_code: 'Aa0Bb1Cc2Dd3Ee4F',
                entity_kind: 'curated',
                creator_principal: 'private-profile-id',
                source_key: 'curated-composition:private-prior-hash',
                source_reference: { stopPlaceIds: IDS.slice(0, 2) },
                attribution: { channel: 'whatsapp' },
                state: 'active',
                expires_at: null,
                revoked_at: null,
                deleted_at: null,
              },
              error: null,
            };
          },
        };
      }
      if (table === 'place_pool') {
        return {
          select(projection) {
            calls.push({ operation: 'select', table, projection });
            return {
              async in(column, values) {
                calls.push({ operation: 'in', table, column, values: [...values] });
                return { data: rows, error: null };
              },
            };
          },
        };
      }
      if (table === 'profiles') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: { referral_code: null }, error: null }; },
        };
      }
      throw new Error(`forbidden table ${table}`);
    },
    async rpc(name, args) {
      calls.push({ operation: 'rpc', name, args });
      if (name !== 'upsert_content_share_version_with_native_snapshot') throw new Error(`forbidden rpc ${name}`);
      return { data: { shortCode: 'Aa0Bb1Cc2Dd3Ee4F', version: 9, versionCreated: true }, error: null };
    },
  };
}

test('TA1 mixed, extra, malformed, duplicate, and oversized identities fail before any database read', async (t) => {
  const invalid = [
    ['missing', {}],
    ['null', { stopPlaceIds: null }],
    ['object instead of array', { stopPlaceIds: { 0: IDS[0], 1: IDS[1] } }],
    ['one stop', { stopPlaceIds: [IDS[0]] }],
    ['more than 24', { stopPlaceIds: Array.from({ length: 25 }, (_, index) => `id-${index}`) }],
    ['duplicate', { stopPlaceIds: [IDS[0], IDS[0]] }],
    ['leading whitespace', { stopPlaceIds: [` ${IDS[0]}`, IDS[1]] }],
    ['empty', { stopPlaceIds: ['', IDS[1]] }],
    ['array member', { stopPlaceIds: [[IDS[0]], IDS[1]] }],
    ['object member', { stopPlaceIds: [{ id: IDS[0] }, IDS[1]] }],
    ['257 characters', { stopPlaceIds: ['x'.repeat(257), IDS[1]] }],
    ['mixed legacy and composition', { stopPlaceIds: IDS.slice(0, 2), savedCardId: 'saved-private' }],
    ['extra display key', { stopPlaceIds: IDS.slice(0, 2), title: 'Forged title' }],
  ];
  for (const [label, identity] of invalid) {
    await t.test(label, async () => {
      const db = createDb(() => { throw new Error('database must not be reached'); });
      const result = await createContentShareV1(db, 'private-profile-id', { kind: 'curated', identity });
      assert.deepEqual(result, { status: 400, body: { error: 'validation' } });
      assert.deepEqual(db.calls, []);
    });
  }
});

test('TA2 missing, duplicate, inactive, and every is_servable !== true database shape fails closed', async (t) => {
  const base = IDS.slice(0, 2).map((id) => served(id));
  const cases = [
    ['missing/partial', [base[0]], 'gone'],
    ['duplicate database match', [base[0], { ...base[0] }, base[1]], 'gone'],
    ['inactive', [{ ...base[0], is_active: false }, base[1]], 'not_public'],
    ['unservable false', [{ ...base[0], is_servable: false }, base[1]], 'not_public'],
    ['unservable null', [{ ...base[0], is_servable: null }, base[1]], 'not_public'],
    ['unservable missing', [Object.fromEntries(Object.entries(base[0]).filter(([key]) => key !== 'is_servable')), base[1]], 'not_public'],
  ];
  for (const [label, rows, reason] of cases) {
    await t.test(label, async () => {
      const db = createDb({ data: rows, error: null });
      await assert.rejects(
        loadAuthoritativeContentShare(db, 'private-profile-id', 'curated', { stopPlaceIds: IDS.slice(0, 2) }),
        new RegExp(reason),
      );
      assert.equal(db.calls.some((call) => call.operation === 'rpc'), false);
    });
  }
});

test('TA3 shuffled rows restore caller order while database errors and malformed served truth stay private', async () => {
  const rows = [
    served(IDS[0], { stored_photo_urls: [] }),
    served(IDS[1], { stored_photo_urls: [PHOTO_A] }),
    served(IDS[2], { stored_photo_urls: [PHOTO_B] }),
  ];
  const shuffledDb = createDb({ data: [rows[2], rows[0], rows[1]], error: null });
  const mapped = await loadAuthoritativeContentShare(shuffledDb, 'private-profile-id', 'curated', { stopPlaceIds: IDS });
  assert.equal(mapped.facts.title, 'Served A → Served B → Served C');
  assert.deepEqual(mapped.publicDetails.stops.map((stop) => stop.title), ['Served A', 'Served B', 'Served C']);
  assert.equal(mapped.mediaIdentity.posterUrl, PHOTO_A, 'first eligible poster must follow requested composition order');
  assert.deepEqual(shuffledDb.calls.find((call) => call.operation === 'in').values, IDS);
  assert.equal(shuffledDb.calls.find((call) => call.operation === 'select').projection, PLACE_POOL_SHARE_SELECT);

  const dbError = createDb({ data: null, error: { message: 'provider internals must not leak' } });
  await assert.rejects(
    loadAuthoritativeContentShare(dbError, 'private-profile-id', 'curated', { stopPlaceIds: IDS }),
    /db_error/,
  );

  const nameless = createDb({ data: [served(IDS[0], { name: null }), served(IDS[1])], error: null });
  await assert.rejects(
    loadAuthoritativeContentShare(nameless, 'private-profile-id', 'curated', { stopPlaceIds: IDS.slice(0, 2) }),
    /not_public/,
  );
});

test('TA3b historical null optionals remain shareable while malformed non-null fidelity fails closed', async () => {
  const historical = IDS.slice(0, 2).map((id) => served(id, {
    rating: null, review_count: null, price_min: null, price_max: null,
    opening_hours: null, utc_offset_minutes: null, national_phone_number: null,
    website: null, country_code: null, lat: null, lng: null,
  }));
  const mapped = await loadAuthoritativeContentShare(
    createDb({ data: historical, error: null }),
    'private-profile-id',
    'curated',
    { stopPlaceIds: IDS.slice(0, 2) },
  );
  assert.equal(mapped.nativeSnapshot.id, mapped.sourceKey);
  for (const stop of mapped.nativeSnapshot.stops) {
    for (const key of ['rating', 'reviewCount', 'priceMin', 'priceMax', 'utcOffsetMinutes', 'phone', 'countryCode', 'lat', 'lng']) {
      assert.equal(key in stop, false, key);
    }
  }

  const malformed = [served(IDS[0], { rating: '4.9' }), served(IDS[1])];
  await assert.rejects(
    loadAuthoritativeContentShare(createDb({ data: malformed, error: null }), 'private-profile-id', 'curated', { stopPlaceIds: IDS.slice(0, 2) }),
    /invalid_native_snapshot/,
  );
});

test('TA4 forged client facts/media are ignored, order owns the source hash, and unsupported area is omitted', async () => {
  const rows = [
    served(IDS[0], { city: 'Durham', stored_photo_urls: [] }),
    served(IDS[1], { city: 'Raleigh', stored_photo_urls: [PHOTO_A] }),
  ];
  const db = createDb({ data: [...rows].reverse(), error: null });
  const raw = {
    kind: 'curated',
    identity: { stopPlaceIds: IDS.slice(0, 2) },
    title: 'Forged client title',
    facts: { title: 'Forged facts', stopCount: 999, estimate: '$0' },
    media: { kind: 'photo', url: 'https://attacker.invalid/forged.jpg' },
    publicDetails: { stops: [{ title: 'Forged stop' }] },
  };
  const created = await createContentShareV1(db, 'private-profile-id', raw);
  assert.equal(created.status, 201);
  assert.equal(created.body.facts.title, 'Served A → Served B');
  assert.equal(created.body.facts.stopCount, 2);
  assert.equal('area' in created.body.facts, false);
  assert.equal('duration' in created.body.facts, false);
  assert.equal('estimate' in created.body.facts, false);
  assert.equal(created.body.media.posterUrl, PHOTO_A);
  assert.deepEqual(created.body.publicDetails.stops.map((stop) => stop.title), ['Served A', 'Served B']);
  assert.doesNotMatch(JSON.stringify(created.body), /Forged|attacker\.invalid|\$0|google-private|pool-google/);

  const forward = await loadAuthoritativeContentShare(createDb({ data: rows, error: null }), 'private-profile-id', 'curated', { stopPlaceIds: IDS.slice(0, 2) });
  const reverse = await loadAuthoritativeContentShare(createDb({ data: rows, error: null }), 'private-profile-id', 'curated', { stopPlaceIds: IDS.slice(0, 2).reverse() });
  assert.notEqual(forward.sourceKey, reverse.sourceKey);
  assert.equal(reverse.facts.title, 'Served B → Served A');
});

test('TA5 refresh rehydrates current served truth without leaking private identities or mutating saved/board/calendar/Likes', async () => {
  const currentRows = [
    served(IDS[1], { name: 'Current second', stored_photo_urls: [PHOTO_B] }),
    served(IDS[0], { name: 'Current first', stored_photo_urls: [] }),
  ];
  const db = refreshDb(currentRows);
  const result = await refreshContentShareV1(db, 'Aa0Bb1Cc2Dd3Ee4F');
  assert.equal(result.status, 200);
  assert.equal(result.body.contentShare.facts.title, 'Current first → Current second');
  assert.equal(result.body.contentShare.media.posterUrl, PHOTO_B);
  const publicJson = JSON.stringify(result.body);
  for (const privateValue of [...IDS, 'private-link-id', 'private-profile-id', 'private-prior-hash', 'stopPlaceIds', 'source_reference', 'source_key']) {
    assert.equal(publicJson.includes(privateValue), false, privateValue);
  }
  const tables = db.calls.filter((call) => call.operation === 'from').map((call) => call.table);
  assert.deepEqual([...new Set(tables)].sort(), ['content_share_links', 'place_pool', 'profiles']);
  for (const forbidden of ['saved_card', 'board_saved_cards', 'calendar', 'chat', 'likes', 'user_likes']) {
    assert.equal(tables.includes(forbidden), false, forbidden);
  }
  const upsert = db.calls.find((call) => call.operation === 'rpc');
  // [TEST-MOD-APPROVED #1719] Refresh must carry the same immutable native
  // snapshot as creation, through the additive snapshot RPC.
  assert.equal(upsert.name, 'upsert_content_share_version_with_native_snapshot');
  assert.equal(upsert.args.p_native_snapshot.id, upsert.args.p_source_key);
  assert.deepEqual(upsert.args.p_source_reference, { stopPlaceIds: IDS.slice(0, 2) });
});

test('TA6 duplicate work coalesces, a failed flight is retryable, and Consumer extraction never carries display facts', async () => {
  const singleFlight = createContentShareSingleFlight();
  let attempts = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const load = async () => { attempts += 1; await pending; return 'created'; };
  const first = singleFlight('curated-composition', load);
  const duplicate = singleFlight('curated-composition', load);
  release();
  assert.deepEqual(await Promise.all([first, duplicate]), ['created', 'created']);
  assert.equal(attempts, 1);

  let retryAttempts = 0;
  await assert.rejects(singleFlight('retryable-composition', async () => { retryAttempts += 1; throw new Error('failed'); }), /failed/);
  assert.equal(await singleFlight('retryable-composition', async () => { retryAttempts += 1; return 'retried'; }), 'retried');
  assert.equal(retryAttempts, 2);

  const forgedStops = IDS.slice(0, 2).map((placeId) => ({
    placeId,
    title: 'Forged title',
    address: 'Forged address',
    media: 'https://attacker.invalid/forged.jpg',
  }));
  assert.deepEqual(curatedCompositionIdentity({
    savedCardId: 'ignored-private-row',
    boardSavedCardId: 'ignored-board-row',
    calendarEntryId: 'ignored-calendar-row',
    title: 'Ignored',
    stops: forgedStops,
  }), { stopPlaceIds: IDS.slice(0, 2) });
});

test('TA7 loading, covered, coverless, and error are exclusive; retry clears only failed work and preserves selection', () => {
  const card = { s4Url: 'https://usemingla.com/og/s/Aa0Bb1Cc2Dd3Ee4F/v1-r2.jpg' };
  for (const state of ['idle', 'validating', 'creating', 'reusing', 'ready', 'opening', 'returned']) {
    assert.equal(sharePreviewTerminalState(null, state), 'loading', state);
    assert.equal(sharePreviewTerminalState(card, state), 'covered', state);
    assert.equal(sharePreviewTerminalState({ s4Url: null }, state), 'coverless', state);
  }
  assert.equal(sharePreviewTerminalState(null, 'error'), 'error');
  assert.equal(sharePreviewTerminalState(card, 'error'), 'covered', 'destination error must not erase a valid portrait');
  assert.equal(sharePreviewTerminalState({ s4Url: null }, 'error'), 'coverless');

  // [TEST-MOD-APPROVED #1719] The unified sheet removed its mounted S4
  // portrait. Attack the new retry owner: it may restart link preparation but
  // must not clear recipients, note, selection, or any content persistence.
  const modal = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
  const retry = /const loadShare = useCallback\(\(nextInput[\s\S]*?\n  \}, \[\]\);/.exec(modal)?.[0] || '';
  assert.match(retry, /setPrepError\(false\)/);
  assert.match(retry, /prepareContentShare\(/);
  assert.doesNotMatch(retry, /setSelected|setNote|setRecipients|onClose|saveCard|saved_card|board|calendar|like/i);
  assert.equal((modal.match(/Retry share/g) || []).length, 1);
  assert.match(modal, /prepError \? [\s\S]*Retry share/);
  assert.doesNotMatch(modal, /prepError[\s\S]{0,180}<ActivityIndicator/);

  const identitySource = read('app-mobile/src/services/contentShareIdentity.ts');
  for (const forbidden of ['title', 'category', 'address', 'description', 'rating', 'price', 'hours', 'media', 'duration', 'estimate', 'savedCardId']) {
    assert.doesNotMatch(identitySource, new RegExp(`stop\\.${forbidden}\\b`), forbidden);
  }
});

test('TA8 production scope contains no hidden persistence route or private-ID public mapping', () => {
  const modal = read('app-mobile/src/components/ShareModal.tsx');
  const adapter = read('app-mobile/src/services/contentShareAdapter.ts');
  const mapping = read('supabase/functions/_shared/contentShare.ts');
  for (const source of [modal, adapter, mapping]) {
    assert.doesNotMatch(source, /from\(["'](?:saved_card|board_saved_cards|calendar|chat|likes|user_likes)["']\).*?(?:insert|upsert|update)/s);
  }
  assert.match(mapping, /sourceReference: \{ stopPlaceIds \}/);
  // [TEST-MOD-APPROVED #1719] Calculate the fingerprint once and reuse it as
  // both the required native snapshot id and the private source key.
  assert.match(mapping, /const compositionId = `curated-composition:\$\{await sha256Hex\(canonicalIds\)\}`/);
  assert.match(mapping, /id: compositionId[\s\S]*sourceKey: compositionId/);
  assert.doesNotMatch(mapping, /facts:\s*\{[^}]*stopPlaceIds|publicDetails:\s*\{[^}]*stopPlaceIds/s);
  const batchProvider = read('.github/ci-batch/MANIFEST.json');
  assert.match(batchProvider, /curated-composition-terminal-ui\.tester\.adversarial\.test\.mjs/);
});
