import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  curatedCompositionIdentity,
  sharePreviewTerminalState,
} from '../../app-mobile/src/services/contentShareIdentity.ts';
import {
  loadAuthoritativeContentShare,
  PLACE_POOL_SHARE_SELECT,
} from '../../supabase/functions/_shared/contentShare.ts';
import { createContentShareV1, refreshContentShareV1 } from '../../supabase/functions/_shared/contentShareService.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const PHOTO = 'https://images.pexels.com/photos/123/served.jpg';
const IDS = ['google-first-private', 'google-second-private'];

const first = {
  id: 'pool-first', google_place_id: IDS[0], name: 'Williamson Preserve', address: '101 Green Way', city: 'Durham',
  primary_type_display_name: 'Nature preserve', editorial_summary: 'A served greenway.', stored_photo_urls: [],
  is_active: true, is_servable: true,
};
const second = {
  id: 'pool-second', google_place_id: IDS[1], name: 'Sopranos Grill', address: '202 Main St', city: 'Durham',
  primary_type_display_name: 'Restaurant', generative_summary: 'A served neighborhood grill.', stored_photo_urls: [PHOTO],
  is_active: true, is_servable: true,
};

function contentShareDb() {
  const calls = [];
  let upserts = 0;
  return {
    calls,
    from(table) {
      calls.push({ operation: 'from', table });
      assert.equal(table, 'place_pool', `composition share must not read or write ${table}`);
      return {
        select(projection) {
          calls.push({ operation: 'select', table, projection });
          return {
            async in(column, values) {
              calls.push({ operation: 'in', table, column, values: [...values] });
              return { data: [second, first], error: null };
            },
          };
        },
      };
    },
    async rpc(name, args) {
      calls.push({ operation: 'rpc', name, args });
      // [TEST-MOD-APPROVED #1719] Creation now reads the immutable message
      // saved with the version; the previous fake rejected every second RPC.
      if (name === 'resolve_content_share_message') {
        return { data: `Curated plan\n\nhttps://usemingla.com/s/${args.p_code}`, error: null };
      }
      assert.equal(name, 'upsert_content_share_version');
      upserts += 1;
      return {
        data: {
          shortCode: 'Aa0Bb1Cc2Dd3Ee4F',
          version: 1,
          versionCreated: upserts === 1,
        },
        error: null,
      };
    },
  };
}

function refreshDb() {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push({ operation: 'from', table });
      if (table === 'place_pool') {
        return {
          select(projection) {
            calls.push({ operation: 'select', table, projection });
            return {
              async in(column, values) {
                calls.push({ operation: 'in', table, column, values: [...values] });
                return { data: [second, first], error: null };
              },
            };
          },
        };
      }
      if (table === 'content_share_links') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return {
              data: {
                id: 'link-private', short_code: 'Aa0Bb1Cc2Dd3Ee4F', entity_kind: 'curated', creator_principal: 'profile-private',
                source_key: 'curated-composition:prior', source_reference: { stopPlaceIds: IDS }, attribution: { channel: 'whatsapp' },
                state: 'active', expires_at: null, revoked_at: null, deleted_at: null,
              },
              error: null,
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
      throw new Error(`unexpected table ${table}`);
    },
    async rpc(name, args) {
      calls.push({ operation: 'rpc', name, args });
      assert.equal(name, 'upsert_content_share_version');
      return { data: { shortCode: 'Aa0Bb1Cc2Dd3Ee4F', version: 2, versionCreated: true }, error: null };
    },
  };
}

test('C1 every Consumer curated representation emits only the same ordered stop composition', () => {
  const stops = IDS.map((placeId, index) => ({
    placeId,
    placeName: index === 0 ? 'Forged first' : 'Forged second',
    imageUrl: 'https://attacker.invalid/forged.jpg',
  }));
  const surfaces = [
    { cardType: 'curated', title: 'Explorer title', stops },
    { savedCardId: 'saved-row-private', title: 'Saved title', stops },
    { boardSavedCardId: 'board-row-private', description: 'Board copy', stops },
    { calendarEntryId: 'calendar-row-private', estimate: '$0', stops },
  ];
  for (const surface of surfaces) {
    assert.deepEqual(curatedCompositionIdentity(surface), { stopPlaceIds: IDS });
  }
  assert.equal(curatedCompositionIdentity({ cardType: 'curated', stops: [{ placeId: IDS[0] }, {}] }), null);
});

test('C2 never-saved composition batch-rehydrates exact served truth in requested order', async () => {
  const db = contentShareDb();
  const mapped = await loadAuthoritativeContentShare(db, 'profile-private', 'curated', { stopPlaceIds: IDS });

  assert.equal(mapped.facts.title, 'Williamson Preserve → Sopranos Grill');
  assert.equal(mapped.facts.stopCount, 2);
  assert.equal(mapped.facts.area, 'Durham');
  assert.equal('duration' in mapped.facts, false);
  assert.equal('estimate' in mapped.facts, false);
  assert.equal(mapped.mediaIdentity.posterUrl, PHOTO);
  assert.deepEqual(mapped.publicDetails.stops.map((stop) => stop.title), ['Williamson Preserve', 'Sopranos Grill']);
  assert.deepEqual(mapped.sourceReference, { stopPlaceIds: IDS });
  assert.match(mapped.sourceKey, /^curated-composition:[a-f0-9]{64}$/);

  const batch = db.calls.find((call) => call.operation === 'in');
  assert.deepEqual(batch, { operation: 'in', table: 'place_pool', column: 'google_place_id', values: IDS });
  assert.equal(db.calls.find((call) => call.operation === 'select').projection, PLACE_POOL_SHARE_SELECT);
});

test('C3 exact authenticated identity creates and reuses only content-share records', async () => {
  const db = contentShareDb();
  const request = { kind: 'curated', identity: { stopPlaceIds: IDS }, attribution: { channel: 'whatsapp' } };
  const created = await createContentShareV1(db, 'profile-private', request);
  const reused = await createContentShareV1(db, 'profile-private', request);

  assert.equal(created.status, 201);
  assert.equal(reused.status, 200);
  assert.equal(created.body.facts.title, 'Williamson Preserve → Sopranos Grill');
  assert.equal(created.body.publicDetails.stops.length, 2);
  assert.equal(JSON.stringify(created.body).includes(IDS[0]), false);
  assert.equal(JSON.stringify(created.body).includes(IDS[1]), false);

  // [TEST-MOD-APPROVED #1719] Count mint calls separately from the immutable
  // message reads added after each mint/reuse.
  const rpcCalls = db.calls.filter((call) => call.operation === 'rpc' && call.name === 'upsert_content_share_version');
  assert.equal(rpcCalls.length, 2);
  assert.equal(rpcCalls[0].args.p_source_key, rpcCalls[1].args.p_source_key);
  assert.deepEqual(rpcCalls[0].args.p_source_reference, { stopPlaceIds: IDS });
  assert.deepEqual(rpcCalls[1].args.p_source_reference, { stopPlaceIds: IDS });
  assert.deepEqual([...new Set(db.calls.filter((call) => call.operation === 'from').map((call) => call.table))], ['place_pool']);
});

test('C4 current refresh rehydrates the private ordered source reference through the same batch owner', async () => {
  const db = refreshDb();
  const refreshed = await refreshContentShareV1(db, 'Aa0Bb1Cc2Dd3Ee4F');

  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.contentShare.facts.title, 'Williamson Preserve → Sopranos Grill');
  assert.equal(refreshed.body.contentShare.version, 2);
  assert.equal(JSON.stringify(refreshed.body).includes(IDS[0]), false);
  assert.equal(JSON.stringify(refreshed.body).includes(IDS[1]), false);
  const batch = db.calls.find((call) => call.operation === 'in');
  assert.deepEqual(batch, { operation: 'in', table: 'place_pool', column: 'google_place_id', values: IDS });
  const upsert = db.calls.find((call) => call.operation === 'rpc');
  assert.match(upsert.args.p_source_key, /^curated-composition:[a-f0-9]{64}$/);
  assert.deepEqual(upsert.args.p_source_reference, { stopPlaceIds: IDS });
});

test('C5 mixed, extra, duplicate, and non-canonical composition identities fail before persistence', async () => {
  const invalid = [
    { stopPlaceIds: IDS, savedCardId: 'mixed-private' },
    { stopPlaceIds: IDS, title: 'forged' },
    { stopPlaceIds: [IDS[0], IDS[0]] },
    { stopPlaceIds: [` ${IDS[0]}`, IDS[1]] },
  ];
  for (const identity of invalid) {
    const db = contentShareDb();
    const result = await createContentShareV1(db, 'profile-private', { kind: 'curated', identity });
    assert.deepEqual(result, { status: 400, body: { error: 'validation' } });
    assert.equal(db.calls.length, 0);
  }
});

test('C6 preview terminal state is exclusive and the production UI has one creation-error retry owner', () => {
  assert.equal(sharePreviewTerminalState(null, 'creating'), 'loading');
  assert.equal(sharePreviewTerminalState({ s4Url: 'https://usemingla.com/portrait.jpg' }, 'ready'), 'covered');
  assert.equal(sharePreviewTerminalState({ s4Url: null }, 'ready'), 'coverless');
  assert.equal(sharePreviewTerminalState(null, 'error'), 'error');

  // [TEST-MOD-APPROVED #1719] The portrait preview was intentionally removed
  // from the app-wide sheet. The single preparation error/retry owner now
  // lives in UnifiedShareProvider while this bridge owns curated identity only.
  const provider = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
  const bridge = read('app-mobile/src/components/ShareModal.tsx');
  assert.match(provider, /prepError \? [\s\S]*Retry share/);
  assert.equal((provider.match(/Retry share/g) || []).length, 1);
  assert.doesNotMatch(provider, /catch\(\(\) => undefined\)/);
  assert.match(bridge, /kind === 'curated'[\s\S]*curated \?\? \{ stopPlaceIds: \[\] \}/);

  const workflow = read('.github/workflows/issue-1615-public-share-surfaces.yml');
  assert.match(workflow, /curated-composition-terminal-ui\.implementor\.happy\.test\.mjs/);
});
