/**
 * #1615 Variant A implementor happy path.
 * FAILS-ON-REVERT: restoring the former PNG/private-no-store transport breaks
 * W1-W5 while the pre-existing portrait geometry tests can remain green.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { proxySharedCard, INTERNAL_PROXY_HEADER } from '../../mingla-marketing/lib/shared-card-proxy.ts';
import { SHARE_PORTRAIT_REVISION, buildSharePortraitUrl } from '../../packages/sharing/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const CODE = 'Aa0Bb1Cc2Dd3Ee4F';
const VERSION = 7;
const ETAG = `"content-share-${CODE}-v${VERSION}-r2-jpeg"`;
const IMMUTABLE = 'public, max-age=31536000, immutable';
// [TEST-MOD-APPROVED #1615] Tester proved marker-only bytes could be cached as
// JPEG. Happy paths now use a decoder-valid 1080x1350 portrait and reserve
// marker-only/wrong-dimension bytes for the fail-closed assertions.
const sharp = require(path.join(ROOT, 'mingla-business/node_modules/sharp'));
const JPEG = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#0C0E12' } }).jpeg({ quality: 66, progressive: true }).toBuffer();
const WRONG_DIMENSION_JPEG = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#0C0E12' } }).jpeg().toBuffer();
const MARKER_ONLY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const share = {
  shortCode: CODE,
  version: VERSION,
  facts: { schemaVersion: 1, kind: 'place', title: 'Yonder Coffee', category: 'Coffee shop', area: 'Durham' },
  media: { kind: 'photo', url: 'https://images.pexels.com/yonder.jpg', posterUrl: 'https://images.pexels.com/yonder.jpg' },
  destination: { kind: 'place', placeId: 'yonder' },
  publicDetails: { kind: 'place', address: '108 E Main St, Durham' },
};
const response = () => ({
  statusCode: 0,
  headers: {},
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
  end(body) { this.body = body; },
});

test('W1 one shared owner emits the exact revisioned JPEG portrait URL', () => {
  assert.equal(SHARE_PORTRAIT_REVISION, 2);
  assert.equal(buildSharePortraitUrl(CODE, VERSION), `https://usemingla.com/og/s/${CODE}/v${VERSION}-r2.jpg`);
  const preview = read('mingla-business/server/socialPreview.js');
  // [TEST-MOD-APPROVED #2589] Punctuation-only narrowing: `\.` -> `\??\.`.
  // Byte-identical to the amendment already applied to R6 in
  // scripts/issue-1615/content-share-receiver.happy.test.mjs. W1 pins that the
  // public portrait URL is VERSION-ADDRESSED through the one shared owner. It
  // never meant to pin the property access as non-optional. #2589 emits
  // og:image for EVERY share, so the poster ternary that used to short-circuit
  // this expression is gone and the line is now reachable with a
  // null/undefined contentShare — the same nullability
  // `renderContentShareHtml` already assumes three lines up
  // (`contentShare?.facts`, `contentShare?.shortCode`). The owner therefore
  // reads `Number(contentShare?.version)`. Same function, same two arguments,
  // same version-addressing; only the `?` is new. Everything W1 guards still
  // bites: drop the call, drop `Number(...)`, swap the version for a constant,
  // or call a different builder and this assertion goes red.
  assert.match(preview, /buildSharePortraitUrl\(code, Number\(contentShare\??\.version\)\)/);
  assert.doesNotMatch(preview, /\/og\/s\/\$\{encodeURIComponent\(code\)\}\/v\$\{Number\(contentShare\.version\)\}\.png/);
});

test('W2 Business serves exact bounded JPEG bytes with immutable 200 and 304 headers', async () => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = 'variant-a-secret';
  const { createContentShareImageHandler } = require(path.join(ROOT, 'mingla-business/api/content-share-image.js'));
  const handler = createContentShareImageHandler(async () => ({ status: 200, contentShare: share }), async () => JPEG);
  const request = (headers = {}) => ({ query: { code: CODE, version: String(VERSION) }, headers: { 'x-mingla-shared-card-proxy': 'variant-a-secret', ...headers } });
  const ok = response(); await handler(request(), ok);
  assert.equal(ok.statusCode, 200); assert.ok(ok.body.equals(JPEG));
  for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) assert.equal(ok.headers[key], IMMUTABLE);
  assert.equal(ok.headers['content-type'], 'image/jpeg'); assert.equal(ok.headers.etag, ETAG);
  for (const key of ['pragma', 'expires']) assert.equal(ok.headers[key], undefined);
  const unchanged = response(); await handler(request({ 'if-none-match': ETAG }), unchanged);
  assert.equal(unchanged.statusCode, 304); assert.equal(unchanged.headers['content-type'], 'image/jpeg');
  for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) assert.equal(unchanged.headers[key], IMMUTABLE);
  if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET; else process.env.SHARED_CARD_PROXY_SECRET = previous;
});

test('W3 Business decodes output and rejects malformed, wrong-dimension or over-budget bytes with no-store', async () => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = 'variant-a-secret';
  const { createContentShareImageHandler } = require(path.join(ROOT, 'mingla-business/api/content-share-image.js'));
  for (const bytes of [Buffer.from('not-jpeg'), MARKER_ONLY_JPEG, WRONG_DIMENSION_JPEG, Buffer.alloc(200_001, 0xff)]) {
    const handler = createContentShareImageHandler(async () => ({ status: 200, contentShare: share }), async () => bytes);
    const rejected = response(); await handler({ query: { code: CODE, version: String(VERSION) }, headers: { 'x-mingla-shared-card-proxy': 'variant-a-secret' } }, rejected);
    assert.equal(rejected.statusCode, 502);
    for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) assert.match(rejected.headers[key], /no-store/);
  }
  if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET; else process.env.SHARED_CARD_PROXY_SECRET = previous;
});

test('W4 Marketing preserves only the exact immutable JPEG contract and fails closed otherwise', async () => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = 'variant-a-secret';
  const request = new Request(`https://usemingla.com/og/s/${CODE}/v${VERSION}-r2.jpg`, { headers: { [INTERNAL_PROXY_HEADER]: 'variant-a-secret' } });
  const ok = await proxySharedCard(request, CODE, 'content-image', async (_url, init) => {
    assert.equal(init.redirect, 'manual'); assert.equal(init.cache, undefined);
    return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(JPEG.length), etag: ETAG, 'x-upstream-secret': 'blocked' } });
  }, String(VERSION));
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/jpeg'); assert.equal(ok.headers.get('x-upstream-secret'), null);
  for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) assert.equal(ok.headers.get(key), IMMUTABLE);
  const wrongType = await proxySharedCard(request, CODE, 'content-image', async () => new Response(JPEG, { status: 200, headers: { 'content-type': 'image/png', etag: ETAG } }), String(VERSION));
  assert.equal(wrongType.status, 502); assert.match(wrongType.headers.get('cache-control'), /no-store/);
  const wrongEtag = await proxySharedCard(request, CODE, 'content-image', async () => new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg', etag: '"wrong"' } }), String(VERSION));
  assert.equal(wrongEtag.status, 502); assert.match(wrongEtag.headers.get('cache-control'), /no-store/);
  for (const bytes of [MARKER_ONLY_JPEG, WRONG_DIMENSION_JPEG]) {
    const invalidJpeg = await proxySharedCard(request, CODE, 'content-image', async () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg', etag: ETAG } }), String(VERSION));
    assert.equal(invalidJpeg.status, 502); assert.match(invalidJpeg.headers.get('cache-control'), /no-store/);
  }
  const unsolicited304 = await proxySharedCard(request, CODE, 'content-image', async () => new Response(null, { status: 304, headers: { etag: ETAG } }), String(VERSION));
  assert.equal(unsolicited304.status, 502); assert.match(unsolicited304.headers.get('cache-control'), /no-store/);
  const conditionalRequest = new Request(request.url, { headers: { [INTERNAL_PROXY_HEADER]: 'variant-a-secret', 'if-none-match': ETAG } });
  const exact304 = await proxySharedCard(conditionalRequest, CODE, 'content-image', async (_url, init) => {
    assert.equal(new Headers(init.headers).get('if-none-match'), ETAG);
    return new Response(null, { status: 304, headers: { etag: ETAG } });
  }, String(VERSION));
  assert.equal(exact304.status, 304); assert.equal(exact304.headers.get('cache-control'), IMMUTABLE);
  if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET; else process.env.SHARED_CARD_PROXY_SECRET = previous;
});

test('W5 semantic delivery inventory has no current stable PNG route and keeps legacy PNG surfaces typed', () => {
  const businessManifest = read('mingla-business/vercel.json');
  const marketingManifest = read('mingla-marketing/vercel.json');
  const middleware = read('mingla-marketing/middleware.ts');
  for (const source of [businessManifest, marketingManifest, middleware]) {
    assert.match(source, /v(?::version|\[1-9\]\[0-9\]\*)-r2(?:\\)?\.jpg/);
    assert.doesNotMatch(source, /\/og\/s\/(?:\:code|\[0-9A-Za-z\])[^\n]*\.png/);
  }
  assert.match(businessManifest, /\/og\/share\/:shareId\.png/);
  assert.match(marketingManifest, /\/og\/share\/:shareId\.png/);
  assert.match(read('mingla-business/server/socialPreview.js'), /imageType:"image\/jpeg"/);
  assert.match(read('mingla-business/server/socialPreview.js'), /showHeader:false/);
});
