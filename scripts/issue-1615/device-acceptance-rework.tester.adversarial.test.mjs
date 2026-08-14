/**
 * #1615 physical-device acceptance rework — independent tester adversarial.
 *
 * Different angle from the implementor suite: this executes a PostgREST-style
 * 42703 denial boundary and the actual protected legacy HTTP page/image
 * handlers, rather than accepting source membership or direct renderer output.
 *
 * FAILS-ON-REVERT: adding the removed `neighborhood` projection back to the
 * production query makes TA1 throw `db_error`; restoring the query passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
// [TEST-MOD-APPROVED #1719] Written reason: TA1's deployed-schema fixture
// predated the already-live #1704 country code and the authoritative #1719
// recipient-fidelity projection. Add only those real place_pool columns to the
// closed allowlist; the PostgREST mock must continue rejecting neighborhood and
// every other unknown projection with 42703.
const deployedColumns = new Set([
  'id', 'google_place_id', 'name', 'address', 'city',
  'country_code', 'primary_type_display_name', 'primary_type', 'rating',
  'review_count', 'price_level', 'price_min', 'price_max',
  'utc_offset_minutes', 'editorial_summary', 'generative_summary',
  'opening_hours', 'stored_photo_urls', 'google_maps_uri',
  'national_phone_number', 'website', 'lat', 'lng', 'is_active', 'is_servable',
]);

const makePostgrestClient = (row) => {
  let projection = '';
  const query = {
    select(value) { projection = value; return this; },
    limit() { return this; },
    eq() { return this; },
    async maybeSingle() {
      const unknown = projection.split(',').find((column) => !deployedColumns.has(column));
      return unknown
        ? { data: null, error: { code: '42703', message: `column p.${unknown} does not exist` } }
        : { data: row, error: null };
    },
  };
  return {
    db: {
      from(table) { assert.equal(table, 'place_pool'); return query; },
      rpc() { throw new Error('unexpected_rpc'); },
    },
    denyUnknownProjection: async (value) => {
      query.select(value);
      return query.maybeSingle();
    },
    observedProjection: () => projection,
  };
};

const createResponse = () => ({
  statusCode: 0,
  headers: {},
  body: Buffer.alloc(0),
  setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
  end(value = '') { this.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); },
});

const withProxySecret = async (work) => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = 'tester-proxy-secret';
  try { return await work(); }
  finally {
    if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET;
    else process.env.SHARED_CARD_PROXY_SECRET = previous;
  }
};

test('TA1 a real PostgREST 42703-shaped denial rejects unknown columns while the production mapper succeeds', async () => {
  const mapper = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/contentShare.ts')));
  assert.equal(deployedColumns.has('neighborhood'), false, 'the closed production fixture must never admit the removed column');
  const row = {
    id: 'pool-1', google_place_id: 'google-1', name: 'Yonder Coffee',
    address: '108 E Main St Suite 101, Durham, NC 27701, USA', city: 'Durham',
    primary_type_display_name: 'Coffee shop', rating: 4.6,
    is_active: true, is_servable: true,
  };
  const postgrest = makePostgrestClient(row);
  const denied = await postgrest.denyUnknownProjection('id,name,neighborhood');
  assert.equal(denied.error.code, '42703');
  assert.match(denied.error.message, /neighborhood does not exist/);
  const arbitraryDenied = await postgrest.denyUnknownProjection('id,name,imaginary_share_field');
  assert.equal(arbitraryDenied.error.code, '42703');
  assert.match(arbitraryDenied.error.message, /imaginary_share_field does not exist/);

  const mapped = await mapper.loadAuthoritativeContentShare(
    postgrest.db,
    'profile-1',
    'place',
    { placePoolId: 'pool-1' },
  );
  assert.equal(postgrest.observedProjection(), mapper.PLACE_POOL_SHARE_SELECT);
  assert.equal(mapped.facts.area, 'Durham');
  assert.equal(mapped.facts.title, 'Yonder Coffee');
});

test('TA2 the protected historical /p handler emits crawler-truthful portrait HTML and human hours', async () => {
  const { createSharedCardHandler } = require(path.join(ROOT, 'mingla-business/api/shared-card.js'));
  const shareId = 'a'.repeat(36);
  const snapshot = {
    share_id: shareId,
    kind: 'place',
    title: 'Yonder <Coffee>',
    cover_url: 'https://images.pexels.com/photos/302899/pexels-photo-302899.jpeg',
    metadata: {
      category: 'Coffee shop', location: 'Durham',
      hours: { periods: [{ open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 21, minute: 0 } }] },
    },
    stops: [],
  };
  await withProxySecret(async () => {
    const handler = createSharedCardHandler(async () => ({
      status: 200,
      snapshot,
      appUrl: 'https://go.usemingla.com/w36m',
      canonicalUrl: `https://usemingla.com/p/${shareId}`,
    }));
    const response = createResponse();
    await handler({ headers: { 'x-mingla-shared-card-proxy': 'tester-proxy-secret' }, query: { shareId } }, response);
    const html = response.body.toString('utf8');
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'private, no-store, max-age=0, must-revalidate');
    for (const token of [
      `rel="canonical" href="https://usemingla.com/p/${shareId}"`,
      'property="og:image:width" content="1080"',
      'property="og:image:height" content="1350"',
      'property="og:image:alt" content="Place: Yonder &lt;Coffee&gt;.',
      'name="twitter:image:alt"',
      'class="share-identity-pill"',
      '>Monday<',
      '>8 AM–9 PM<',
    ]) assert.ok(html.includes(token), token);
    assert.doesNotMatch(html, /<pre>|&quot;(?:open|close|hour|minute)&quot;|<strong>mingla<|Mingla Host/);
    assert.doesNotMatch(html, /Yonder <Coffee>/);
  });
});

test('TA3 the protected historical /p image handler returns bounded 1080x1350 PNG bytes and hides direct bypasses', async () => {
  const imageApi = require(path.join(ROOT, 'mingla-business/api/shared-card-image.js'));
  const shareId = 'b'.repeat(36);
  const cover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const snapshot = { share_id: shareId, kind: 'place', title: 'Yonder Coffee', cover_url: cover, metadata: { category: 'Coffee shop', location: 'Durham' }, stops: [] };
  const inner = imageApi.createSharedCardImageHandler(async () => ({ status: 200, snapshot }));
  const protectedHandler = imageApi.createProtectedSharedCardImageHandler(inner);

  await withProxySecret(async () => {
    const response = createResponse();
    await protectedHandler({ headers: { 'x-mingla-shared-card-proxy': 'tester-proxy-secret' }, query: { shareId, surface: 's5' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/png');
    assert.equal(response.headers['cache-control'], 'private, no-store, max-age=0, must-revalidate');
    assert.deepEqual([response.body.readUInt32BE(16), response.body.readUInt32BE(20)], [1080, 1350]);
    assert.ok(response.body.length > 0 && response.body.length <= 5 * 1024 * 1024, response.body.length);

    const bypass = createResponse();
    await protectedHandler({ headers: {}, query: { shareId, surface: 's5' } }, bypass);
    assert.equal(bypass.statusCode, 404);
    assert.equal(bypass.body.length, 0);
  });
});

test('TA4 covered /s HTML stays portrait for all eight kinds and coverless /p emits no image contract', () => {
  const preview = require(path.join(ROOT, 'mingla-business/server/socialPreview.js'));
  const poster = 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/poster.jpg';
  const code = 'Aa0Bb1Cc2Dd3Ee4F';
  const kinds = ['place', 'curated', 'event', 'rsvp_event', 'trip', 'experience', 'venue', 'brand'];
  for (const kind of kinds) {
    const html = preview.renderContentShareHtml({
      shortCode: code,
      version: 2,
      facts: { schemaVersion: 1, kind, title: `Real ${kind}` },
      media: { kind: 'photo', url: poster, posterUrl: poster },
      destination: { kind },
      publicDetails: kind === 'place' ? { kind }
        : kind === 'curated' ? { kind, stops: [] }
          : ['event', 'rsvp_event', 'trip', 'experience'].includes(kind) ? { kind, actionEligible: false, occurrences: [] }
            : { kind, offerings: [] },
    });
    assert.match(html, /property="og:image:width" content="1080"/);
    assert.match(html, /property="og:image:height" content="1350"/);
    assert.match(html, /property="og:image:alt"/);
    assert.match(html, /name="twitter:image:alt"/);
    assert.doesNotMatch(html, /Mingla Host|<strong>mingla<|>mingla</i);
  }

  const shareId = 'c'.repeat(36);
  const coverless = preview.renderSharedCardHtml(
    { share_id: shareId, kind: 'place', title: 'No cover', cover_url: null, metadata: {}, stops: [] },
    'https://go.usemingla.com/w36m',
  );
  assert.doesNotMatch(coverless, /property="og:image"|name="twitter:image"|summary_large_image|class="share-cover/);
  assert.match(coverless, /name="twitter:card" content="summary"/);
  assert.match(coverless, /class="coverless-information"/);
});
