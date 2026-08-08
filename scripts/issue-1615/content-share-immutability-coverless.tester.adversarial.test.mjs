/**
 * #1615 independent tester guard — immutable historical portraits and truthful
 * coverless degradation. This deliberately attacks the inverse of the
 * implementor's stage-5 tests: a versioned cache key must remain resolvable,
 * while a share without eligible media must never mint S4/S5 artwork.
 *
 * Append-only tester file. Do not weaken these requirements; they are binding
 * in issue #1615's media clarification and portrait design amendment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { createContentShareImageHandler } = require(path.join(ROOT, 'mingla-business/api/content-share-image.js'));
const { renderContentShareHtml } = require(path.join(ROOT, 'mingla-business/server/socialPreview.js'));
const { isAllowedPublicPoster } = require(path.join(ROOT, 'mingla-business/server/cardIdentityRenderer.js'));
const { isPublicShareMediaUrl } = require(path.join(ROOT, 'packages/sharing'));

const responseRecorder = () => ({
  statusCode: 0,
  headers: {},
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
  end(body) { this.body = body; },
});

const request = (code, version) => ({
  query: { code, version: String(version) },
  headers: { 'x-mingla-shared-card-proxy': 'tester-secret' },
});

test('TA1 an immutable historical version remains renderable after the stable link advances', async () => {
  process.env.SHARED_CARD_PROXY_SECRET = 'tester-secret';
  const code = 'Aa0Bb1Cc2Dd3Ee4F';
  const current = {
    shortCode: code,
    version: 2,
    facts: { schemaVersion: 1, kind: 'brand', title: 'Current title' },
    media: { kind: 'photo', url: 'https://usemingla.com/current.jpg', posterUrl: 'https://usemingla.com/current.jpg' },
    destination: { kind: 'brand', brandSlug: 'current' },
  };
  const historical = {
    ...current,
    version: 1,
    facts: { ...current.facts, title: 'Historical title' },
    media: { kind: 'photo', url: 'https://usemingla.com/v1.jpg', posterUrl: 'https://usemingla.com/v1.jpg' },
  };
  const fetchVersion = async (_code, version) => ({
    status: 200,
    contentShare: Number(version) === 1 ? historical : current,
  });
  const rendered = [];
  const handler = createContentShareImageHandler(fetchVersion, async (share) => {
    rendered.push(share.version);
    return Buffer.from(`png-v${share.version}`);
  });
  const response = responseRecorder();
  await handler(request(code, 1), response);
  assert.equal(response.statusCode, 200, 'v1 must remain available after current_version advances to v2');
  assert.deepEqual(rendered, [1]);
  assert.equal(response.headers['cache-control'], 'public, max-age=31536000, immutable');
});

test('TA2 coverless share emits no OG/Twitter image and reserves no portrait artwork', () => {
  const html = renderContentShareHtml({
    shortCode: 'Aa0Bb1Cc2Dd3Ee4F',
    version: 1,
    facts: { schemaVersion: 1, kind: 'brand', title: 'Truthful coverless brand' },
    media: null,
    destination: { kind: 'brand', brandSlug: 'truthful' },
  });
  assert.doesNotMatch(html, /property="og:image"|name="twitter:image"/);
  assert.doesNotMatch(html, /class="portrait"|class="portrait-poster"/);
  assert.match(html, /Truthful coverless brand/);
});

test('TA3 image endpoint returns 404 when the immutable version has no eligible poster', async () => {
  process.env.SHARED_CARD_PROXY_SECRET = 'tester-secret';
  const code = 'Aa0Bb1Cc2Dd3Ee4F';
  const coverless = {
    shortCode: code,
    version: 1,
    facts: { schemaVersion: 1, kind: 'venue', title: 'No poster' },
    media: null,
    destination: { kind: 'venue', brandSlug: 'brand', venueSlug: 'venue' },
  };
  let renderCalls = 0;
  const handler = createContentShareImageHandler(
    async () => ({ status: 200, contentShare: coverless }),
    async () => { renderCalls += 1; return Buffer.from('synthetic-art'); },
  );
  const response = responseRecorder();
  await handler(request(code, 1), response);
  assert.equal(response.statusCode, 404);
  assert.equal(renderCalls, 0, 'coverless content must not synthesize a logo/title portrait');
});

test('TA4 exact media origins reject alternate ports at both contract and renderer boundaries', () => {
  const alternatePortUrls = [
    'https://vz-a16fce08-6c6.b-cdn.net:8443/poster.jpg',
    'https://gqnoajqerqhnvulmnyvv.supabase.co:8443/storage/v1/object/public/share/poster.jpg',
  ];
  for (const url of alternatePortUrls) {
    assert.equal(isPublicShareMediaUrl(url), false, `sharing contract accepted non-default origin ${url}`);
    assert.equal(isAllowedPublicPoster(url), false, `server renderer accepted non-default origin ${url}`);
  }
});

test('TA5 dark-rollout rollback is narrow and strips private legacy snapshot fields', async () => {
  const rollback = await import(pathToFileURL(path.join(ROOT, 'app-mobile/src/services/legacyContentShareRollback.ts')));
  assert.equal(rollback.isLegacyRollbackEligible({ context: { status: 503 } }), true);
  assert.equal(rollback.isLegacyRollbackEligible({ name: 'FunctionsFetchError' }), true);
  for (const status of [400, 401, 403, 404, 409, 422]) {
    assert.equal(rollback.isLegacyRollbackEligible({ context: { status } }), false, `${status} must not downgrade to legacy`);
  }
  const shareId = 'a'.repeat(36);
  const prepared = rollback.prepareLegacyPublicFields({
    kind: 'curated', title: 'Public plan', owner_profile_id: 'private-owner', source_ids: { savedCardId: 'private-card' },
    metadata: { price: '$20–$40' },
    stops: [{ title: 'Public stop', placeId: 'private-place', profileId: 'private-profile' }],
  }, `https://usemingla.com/p/${shareId}`, `https://usemingla.com/share/${shareId}.png`, 'curated');
  assert.equal(prepared.canonicalUrl, `https://usemingla.com/p/${shareId}`);
  assert.match(prepared.message, /Public plan is a 1-stop plan/);
  assert.doesNotMatch(JSON.stringify(prepared), /private-owner|private-card|private-place|private-profile|source_ids/);
  assert.throws(() => rollback.prepareLegacyPublicFields(
    { kind: 'place', title: 'Place', metadata: {}, stops: [] },
    `https://usemingla.com/p/${shareId}?leak=1`, null, 'place',
  ), /legacy_share_invalid/);
});

test('TA6 installed-direct attribution is exact, coalesced and consumed once', async () => {
  const attribution = await import(pathToFileURL(path.join(ROOT, 'app-mobile/src/services/contentShareAttribution.ts')));
  const values = new Map();
  const storage = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
  assert.equal(await attribution.persistContentShareAttribution(storage, { shortCode: 'Aa0Bb1Cc2Dd3Ee4F', version: 7 }), true);
  const captures = [];
  const capture = (event, properties) => captures.push({ event, properties });
  assert.deepEqual(await Promise.all([
    attribution.consumeContentShareAttributionAfterIdentity(storage, capture),
    attribution.consumeContentShareAttributionAfterIdentity(storage, capture),
  ]), ['consumed', 'consumed']);
  assert.equal(captures.length, 1);
  assert.deepEqual(captures[0], { event: 'share_native_opened', properties: {
    short_code: 'Aa0Bb1Cc2Dd3Ee4F', version: 7, recipient_app: 'consumer',
    recipient_surface: 'native_content_share', outcome: 'identified_activation',
  } });
  assert.equal(await storage.getItem(attribution.CONTENT_SHARE_ATTRIBUTION_KEY), null);
  assert.equal(await attribution.consumeContentShareAttributionAfterIdentity(storage, capture), 'empty');
  assert.equal(captures.length, 1);
});

test('TA7 moving S6 media reuses the immutable portrait and mounts no second identity system', () => {
  const code = 'Aa0Bb1Cc2Dd3Ee4F';
  const imageUrl = `https://usemingla.com/og/s/${code}/v4.png`;
  const html = renderContentShareHtml({
    shortCode: code, version: 4,
    facts: { schemaVersion: 1, kind: 'event', title: 'Moving event', route: { eventSlug: 'moving' } },
    media: { kind: 'video', url: 'https://vz-a16fce08-6c6.b-cdn.net/moving.mp4', posterUrl: 'https://vz-a16fce08-6c6.b-cdn.net/poster.jpg' },
    destination: { kind: 'event', brandSlug: 'brand', eventSlug: 'moving' },
    publicDetails: { kind: 'event', actionEligible: true, occurrences: [] },
  });
  assert.match(html, /class="portrait-identity-overlay identity-wordmark"/);
  assert.match(html, /class="portrait-identity-overlay identity-bottom"/);
  assert.equal(html.split(`src="${imageUrl}"`).length - 1, 3, 'poster and both clipped overlays must use one exact immutable portrait URL');
  assert.doesNotMatch(html, /motion-plate|motion-title|motion-wordmark|motion-composition/);
});
