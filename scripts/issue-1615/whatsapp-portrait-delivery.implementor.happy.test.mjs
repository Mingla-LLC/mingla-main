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
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
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
  assert.match(preview, /buildSharePortraitUrl\(code, Number\(contentShare\.version\)\)/);
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

test('W3 Business rejects malformed or over-budget portrait bytes with no-store', async () => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = 'variant-a-secret';
  const { createContentShareImageHandler } = require(path.join(ROOT, 'mingla-business/api/content-share-image.js'));
  for (const bytes of [Buffer.from('not-jpeg'), Buffer.alloc(200_001, 0xff)]) {
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
