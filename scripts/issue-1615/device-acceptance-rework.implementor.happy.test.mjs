/**
 * #1615 physical-device acceptance rework — implementor happy path.
 *
 * FAILS-ON-REVERT: restoring `place_pool.neighborhood`, the automatic `/p`
 * producer downgrade, the literal wordmark text, raw-hours `<pre>`, or the
 * old OG dimensions makes this suite fail against production-shaped inputs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const require = createRequire(import.meta.url);

const productionPlacePoolColumns = new Set([
  'id', 'google_place_id', 'name', 'address', 'city',
  'primary_type_display_name', 'primary_type', 'rating', 'price_level',
  'utc_offset_minutes', 'editorial_summary', 'generative_summary',
  'opening_hours', 'stored_photo_urls', 'google_maps_uri',
  'national_phone_number', 'website', 'is_active', 'is_servable',
]);

test('D1 authoritative place select executes against the production-shaped schema and uses city', async () => {
  const mapper = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/contentShare.ts')));
  const selected = mapper.PLACE_POOL_SHARE_SELECT.split(',');
  assert.deepEqual(new Set(selected), productionPlacePoolColumns);
  assert.equal(selected.includes('neighborhood'), false);

  let observedSelect = '';
  const row = {
    id: 'pool-1', google_place_id: 'google-1', name: 'Yonder Coffee',
    address: '108 E Main St Suite 101, Durham, NC 27701, USA', city: 'Durham',
    primary_type_display_name: 'Coffee shop', is_active: true, is_servable: true,
    neighborhood: 'this fixture trap is not a deployed column',
  };
  const query = {
    select(columns) {
      observedSelect = columns;
      for (const column of columns.split(',')) {
        if (!productionPlacePoolColumns.has(column)) throw new Error(`production_schema_missing:${column}`);
      }
      return this;
    },
    limit() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: row, error: null }; },
  };
  const db = { from(table) { assert.equal(table, 'place_pool'); return query; }, rpc() { throw new Error('unexpected_rpc'); } };
  const mapped = await mapper.loadAuthoritativeContentShare(db, 'profile-1', 'place', { placePoolId: 'pool-1' });
  assert.equal(observedSelect, mapper.PLACE_POOL_SHARE_SELECT);
  assert.equal(mapped.facts.area, 'Durham');
});

test('D2 a V1 failure has one honest exit and cannot call the legacy producer', () => {
  const adapter = read('app-mobile/src/services/contentShareAdapter.ts');
  const modal = read('app-mobile/src/components/ShareModal.tsx');
  assert.match(adapter, /if \(!error && data\?\.shortCode && data\?\.facts\)[\s\S]*throw new Error\(error\?\.message \|\| 'share_create_failed'\)/);
  assert.doesNotMatch(adapter, /createSharedCard|legacy_shared_card|isLegacyRollbackEligible|usemingla\.com\/p\//);
  assert.match(modal, /setShareState\('error'\)/);
  assert.match(modal, /Check your connection and retry/);
});

const walk = (node, visit) => {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  visit(node);
  if (typeof node === 'object') {
    const children = node.props?.children;
    for (const child of Array.isArray(children) ? children : [children]) walk(child, visit);
  }
};

test('D3 legacy S4 and S5 use the real asset pill, facts-only plate, and exact bounded portrait bytes', async () => {
  const renderer = require(path.join(ROOT, 'mingla-business/server/cardIdentityRenderer.js'));
  const cover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const snapshot = { kind: 'place', title: 'Yonder Coffee', cover_url: cover, metadata: { category: 'Coffee shop', location: 'Durham' } };
  const element = renderer.cardIdentityElement(snapshot, 's5Og', 3);
  const textNodes = [];
  const imageSources = [];
  walk(element, (node) => {
    if (typeof node === 'string') textNodes.push(node);
    if (node?.type === 'img') imageSources.push(node.props.src);
  });
  assert.equal(textNodes.some((value) => value.trim().toLowerCase() === 'mingla'), false);
  assert.ok(imageSources.includes(renderer.wordmarkSource()));
  const source = read('mingla-business/server/cardIdentityRenderer.js');
  for (const token of ['width:px(124)', 'height:px(44)', 'borderRadius:px(18)', 'width:px(96)', 'height:px(34)', 'background:"#FFF7EF"']) assert.ok(source.includes(token), token);

  for (const surface of ['s4Snippet', 's5Og']) {
    const png = await renderer.renderCardIdentityPng(snapshot, surface);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1080, 1350]);
    assert.ok(png.length > 0 && png.length <= renderer.MAX_RENDERED_PNG_BYTES, `${surface}:${png.length}`);
  }
});

test('D4 legacy S6 metadata is truthful and raw provider hours become seven human rows', () => {
  const preview = require(path.join(ROOT, 'mingla-business/server/socialPreview.js'));
  const periods = [
    { open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 21, minute: 0 } },
    { open: { day: 2, hour: 8, minute: 0 }, close: { day: 2, hour: 21, minute: 0 } },
    { open: { day: 3, hour: 8, minute: 0 }, close: { day: 3, hour: 21, minute: 0 } },
    { open: { day: 4, hour: 8, minute: 0 }, close: { day: 4, hour: 21, minute: 0 } },
    { open: { day: 5, hour: 8, minute: 0 }, close: { day: 5, hour: 21, minute: 0 } },
    { open: { day: 6, hour: 9, minute: 0 }, close: { day: 6, hour: 18, minute: 0 } },
  ];
  const shareId = 'a'.repeat(36);
  const html = preview.renderSharedCardHtml({
    share_id: shareId, kind: 'place', title: 'Yonder Coffee',
    cover_url: 'https://images.pexels.com/photos/302899/pexels-photo-302899.jpeg',
    metadata: { category: 'Coffee shop', location: 'Durham', hours: { periods } }, stops: [],
  }, 'https://go.usemingla.com/w36m');
  for (const token of ['og:image:width" content="1080', 'og:image:height" content="1350', 'og:image:alt', 'twitter:image:alt', 'Monday', 'Sunday', '8 AM–9 PM', 'Closed', 'share-identity-pill']) assert.ok(html.includes(token), token);
  assert.ok(html.includes(preview.normalizeLegacyHours({ periods })[0].day));
  assert.doesNotMatch(html, /<pre>|&quot;open&quot;|&quot;hour&quot;|mingla-business-logo|>Mingla Business<|>mingla</i);
  assert.match(html, /<span class="share-plate-kind">Place<\/span><span class="share-plate-facts">Coffee shop · Durham<\/span>/);

  const coverless = preview.renderSharedCardHtml({ share_id: 'b'.repeat(36), kind: 'place', title: 'Plain', cover_url: null, metadata: {}, stops: [] }, 'https://go.usemingla.com/w36m');
  assert.doesNotMatch(coverless, /og:image|twitter:image|summary_large_image|class="share-cover/);
  assert.match(coverless, /content="summary"|coverless-information/);
});

test('D5 all eight stable-share kinds retain one actual-wordmark portrait composition', () => {
  const renderer = require(path.join(ROOT, 'mingla-business/server/cardIdentityRenderer.js'));
  for (const kind of ['place', 'curated', 'event', 'rsvp_event', 'trip', 'experience', 'venue', 'brand']) {
    const element = renderer.contentSharePortraitElement({ facts: { schemaVersion: 1, kind, title: `Real ${kind}` }, media: null });
    const textNodes = [];
    const sources = [];
    walk(element, (node) => {
      if (typeof node === 'string') textNodes.push(node);
      if (node?.type === 'img') sources.push(node.props.src);
    });
    assert.equal(textNodes.some((value) => value.trim().toLowerCase() === 'mingla'), false, kind);
    assert.ok(sources.includes(renderer.wordmarkSource()), kind);
  }
});
