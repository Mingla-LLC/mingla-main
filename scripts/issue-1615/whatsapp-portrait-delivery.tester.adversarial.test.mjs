/**
 * #1615 Variant A tester-owned adversarial suite.
 *
 * This suite attacks the untrusted HTTP boundary, not the renderer happy path:
 * cache/header poisoning, forged internal markers, JPEG marker smuggling,
 * oversized bodies, 304/ETag mismatches, redirects/errors, header leakage,
 * retired PNG emission, logo over-removal, and media/kind parity.
 *
 * FAILS-ON-REVERT: restoring the content-image proxy's exact upstream ETag
 * equality check makes T4 accept the attacker-controlled mismatch and fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { proxySharedCard, INTERNAL_PROXY_HEADER } from '../../mingla-marketing/lib/shared-card-proxy.ts';
import { SHARE_ENTITY_KINDS, buildSharePortraitUrl } from '../../packages/sharing/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const preview = require(path.join(ROOT, 'mingla-business/server/socialPreview.js'));
const renderer = require(path.join(ROOT, 'mingla-business/server/cardIdentityRenderer.js'));
const { createContentShareImageHandler } = require(path.join(ROOT, 'mingla-business/api/content-share-image.js'));
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const CODE = 'Aa0Bb1Cc2Dd3Ee4F';
const VERSION = 7;
const SECRET = 'tester-variant-a-secret';
const ETAG = `"content-share-${CODE}-v${VERSION}-r2-jpeg"`;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const WRONG_DIMENSION_JPEG = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AK4A5JL/2Q==', 'base64');
const SMUGGLED_JPEG = Buffer.from([0xff, 0xd8, ...Buffer.from('<script>not a jpeg</script>'), 0xff, 0xd9]);
const POSTER = 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/share/poster.jpg';
const MOVING = 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/share/cover.mp4';
const sharp = require(path.join(ROOT, 'mingla-business/node_modules/sharp'));
const portraitJpeg = () => sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#0C0E12' } })
  .jpeg({ quality: 66, progressive: true }).toBuffer();
const removeFirstJpegSegment = (jpeg, marker) => {
  for (let index = 2; index < jpeg.length - 3; index += 1) {
    if (jpeg[index] !== 0xff || jpeg[index + 1] !== marker) continue;
    const length = jpeg.readUInt16BE(index + 2);
    return Buffer.concat([jpeg.subarray(0, index), jpeg.subarray(index + 2 + length)]);
  }
  throw new Error(`jpeg segment 0x${marker.toString(16)} absent`);
};

const share = (kind = 'place', media = { kind: 'photo', url: POSTER, posterUrl: POSTER }) => ({
  shortCode: CODE,
  version: VERSION,
  facts: {
    schemaVersion: 1,
    kind,
    title: `Adversarial ${kind}`,
    ...({
      place: { category: 'Cafe', area: 'Durham' },
      curated: { stopCount: 3, area: 'Durham' },
      event: { localDate: 'Friday', venue: 'Mingla Hall' },
      rsvp_event: { localDate: 'Friday', venue: 'Mingla Hall' },
      trip: { destination: 'Durham', duration: '2 days' },
      experience: { area: 'Durham', duration: '2 hours' },
      venue: { category: 'Cafe', area: 'Durham' },
      brand: { category: 'Cafe', area: 'Durham' },
    })[kind],
  },
  media,
  destination: { kind },
  publicDetails: { kind },
});

const nodeResponse = () => ({
  statusCode: 0,
  headers: {},
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
  end(body) { this.body = body; },
});

const businessRequest = (headers = {}, version = String(VERSION)) => ({
  query: { code: CODE, version },
  headers: { 'x-mingla-shared-card-proxy': SECRET, ...headers },
});

const marketingRequest = (headers = {}) => new Request(buildSharePortraitUrl(CODE, VERSION), {
  headers: { [INTERNAL_PROXY_HEADER]: SECRET, ...headers },
});

const assertPrivateNoStore = (response) => {
  assert.match(response.headers.get('cache-control') || '', /private/);
  for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) {
    assert.match(response.headers.get(key) || '', /no-store/);
  }
  assert.notEqual(response.headers.get('pragma'), 'public');
};

const assertNodeNoStore = (response) => {
  for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) {
    assert.match(String(response.headers[key] || ''), /no-store/);
  }
};

test('T1 current producers and both manifests emit only the exact revisioned JPEG route', () => {
  assert.equal(buildSharePortraitUrl(CODE, VERSION), `https://usemingla.com/og/s/${CODE}/v${VERSION}-r2.jpg`);
  for (const file of [
    'packages/sharing/index.js',
    'mingla-business/server/socialPreview.js',
    'mingla-business/vercel.json',
    'mingla-marketing/vercel.json',
    'mingla-marketing/middleware.ts',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /\/og\/s\/(?:\$\{|:code|\[0-9A-Za-z\])[^\n'"`]*\.png/, file);
  }
  assert.match(read('mingla-business/vercel.json'), /\/og\/s\/:code\/v:version-r2\.jpg/);
  assert.match(read('mingla-marketing/middleware.ts'), /-r2\\\.jpg/);
});

test('T2 Business accepts a real JPEG but fails closed for PNG, marker-smuggled, oversized, drifted, and coverless output', async (t) => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = SECRET;
  try {
    const validJpeg = await portraitJpeg();
    const exactHandler = createContentShareImageHandler(async () => ({ status: 200, contentShare: share() }), async () => validJpeg);
    const exact = nodeResponse();
    await exactHandler(businessRequest(), exact);
    assert.equal(exact.statusCode, 200);
    assert.ok(exact.body.equals(validJpeg));
    assert.equal(exact.headers.etag, ETAG);
    assert.equal(exact.headers['content-type'], 'image/jpeg');
    for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) assert.equal(exact.headers[key], IMMUTABLE);

    const rejectedBodies = [
      ['PNG signature', Buffer.from('\x89PNG\r\n\x1a\n', 'binary')],
      ['wrong dimensions', WRONG_DIMENSION_JPEG],
      ['marker-smuggled junk', SMUGGLED_JPEG],
      ['metadata-valid but undecodable missing-Huffman JPEG', removeFirstJpegSegment(validJpeg, 0xc4)],
      ['oversized body', Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(199_997), Buffer.from([0xff, 0xd9])])],
    ];
    for (const [label, bytes] of rejectedBodies) {
      await t.test(label, async () => {
        const handler = createContentShareImageHandler(async () => ({ status: 200, contentShare: share() }), async () => bytes);
        const rejected = nodeResponse();
        await handler(businessRequest(), rejected);
        assert.equal(rejected.statusCode, 502, `accepted malformed body of ${bytes.length} bytes`);
        assertNodeNoStore(rejected);
      });
    }

    const stale = nodeResponse();
    await createContentShareImageHandler(async () => ({ status: 200, contentShare: share() }), async () => validJpeg)(businessRequest({}, '6'), stale);
    assert.equal(stale.statusCode, 404);
    assertNodeNoStore(stale);

    const coverless = nodeResponse();
    await createContentShareImageHandler(async () => ({ status: 200, contentShare: share('place', null) }), async () => { throw new Error('renderer must not run'); })(businessRequest(), coverless);
    assert.equal(coverless.statusCode, 404);
    assertNodeNoStore(coverless);
  } finally {
    if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET;
    else process.env.SHARED_CARD_PROXY_SECRET = previous;
  }
});

test('T3 forged markers never reach Business and caller headers cannot cross the Marketing boundary', async () => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = SECRET;
  try {
    const validJpeg = await portraitJpeg();
    let calls = 0;
    const forged = await proxySharedCard(new Request(buildSharePortraitUrl(CODE, VERSION), {
      headers: { [INTERNAL_PROXY_HEADER]: 'wrong', 'x-mingla-shared-card-proxy': 'attacker' },
    }), CODE, 'content-image', async () => { calls += 1; throw new Error('must not fetch'); }, String(VERSION));
    assert.equal(forged.status, 404);
    assert.equal(calls, 0);
    assertPrivateNoStore(forged);

    const ok = await proxySharedCard(marketingRequest({
      'x-mingla-shared-card-proxy': 'attacker',
      authorization: 'Bearer attacker',
      cookie: 'private=cookie',
    }), CODE, 'content-image', async (_url, init) => {
      const headers = new Headers(init.headers);
      assert.equal(headers.get('x-mingla-shared-card-proxy'), SECRET);
      assert.equal(headers.get('authorization'), null);
      assert.equal(headers.get('cookie'), null);
      return new Response(validJpeg, { status: 200, headers: { 'content-type': 'image/jpeg', etag: ETAG, 'set-cookie': 'leak=yes', 'x-private-upstream': 'leak' } });
    }, String(VERSION));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('set-cookie'), null);
    assert.equal(ok.headers.get('x-private-upstream'), null);
  } finally {
    if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET;
    else process.env.SHARED_CARD_PROXY_SECRET = previous;
  }
});

test('T4 Marketing rejects redirect/error poisoning, MIME tricks, extension drift, ETag mismatch, and oversized declarations without reading', async () => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = SECRET;
  try {
    const validJpeg = await portraitJpeg();
    const rows = [
      ['redirect', () => new Response(null, { status: 302, headers: { location: 'https://attacker.example/x.jpg' } }), 502],
      ['upstream error', () => new Response(null, { status: 500, headers: { 'cache-control': 'public, max-age=31536000', etag: ETAG } }), 500],
      ['png MIME', () => new Response(validJpeg, { status: 200, headers: { 'content-type': 'image/png', etag: ETAG } }), 502],
      ['MIME parameter', () => new Response(validJpeg, { status: 200, headers: { 'content-type': 'image/jpeg; charset=binary', etag: ETAG } }), 502],
      ['missing ETag', () => new Response(validJpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } }), 502],
      ['mismatched ETag', () => new Response(validJpeg, { status: 200, headers: { 'content-type': 'image/jpeg', etag: ETAG.replace('r2', 'r3') } }), 502],
    ];
    for (const [label, responseFactory, expectedStatus] of rows) {
      const response = await proxySharedCard(marketingRequest(), CODE, 'content-image', async (_url, init) => {
        assert.equal(init.redirect, 'manual');
        return responseFactory();
      }, String(VERSION));
      assert.equal(response.status, expectedStatus, label);
      assertPrivateNoStore(response);
    }

    let read = false;
    const oversized = await proxySharedCard(marketingRequest(), CODE, 'content-image', async () => ({
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': '200001', etag: ETAG }),
      async arrayBuffer() { read = true; return validJpeg; },
    }), String(VERSION));
    assert.equal(oversized.status, 502);
    assert.equal(read, false);
    assertPrivateNoStore(oversized);
  } finally {
    if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET;
    else process.env.SHARED_CARD_PROXY_SECRET = previous;
  }
});

test('T5 Marketing rejects marker-smuggled and undeclared oversized bodies instead of making corrupt bytes immutable', async (t) => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = SECRET;
  try {
    const validJpeg = await portraitJpeg();
    for (const [label, bytes] of [
      ['marker-smuggled junk', SMUGGLED_JPEG],
      ['metadata-valid but undecodable missing-Huffman JPEG', removeFirstJpegSegment(validJpeg, 0xc4)],
      ['oversized body', Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(199_997), Buffer.from([0xff, 0xd9])])],
    ]) {
      await t.test(label, async () => {
        const response = await proxySharedCard(marketingRequest(), CODE, 'content-image', async () => new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/jpeg', etag: ETAG },
        }), String(VERSION));
        assert.equal(response.status, 502, `accepted malformed body of ${bytes.length} bytes`);
        assertPrivateNoStore(response);
      });
    }
  } finally {
    if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET;
    else process.env.SHARED_CARD_PROXY_SECRET = previous;
  }
});

test('T6 a 304 is immutable only when both request and upstream carry the exact ETag', async (t) => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = SECRET;
  try {
    for (const [label, requestHeaders, upstreamEtag, expectedStatus] of [
      ['unsolicited', {}, ETAG, 502],
      ['wrong upstream', { 'if-none-match': ETAG }, '"attacker"', 502],
      ['exact', { 'if-none-match': ETAG }, ETAG, 304],
    ]) {
      await t.test(label, async () => {
        const response = await proxySharedCard(marketingRequest(requestHeaders), CODE, 'content-image', async (_url, init) => {
          const headers = new Headers(init.headers);
          assert.equal(headers.get('if-none-match'), label === 'unsolicited' ? null : ETAG);
          return new Response(null, { status: 304, headers: { etag: upstreamEtag, 'cache-control': 'public, max-age=1', 'x-poison': 'blocked' } });
        }, String(VERSION));
        assert.equal(response.status, expectedStatus, label);
        assert.equal(response.headers.get('x-poison'), null);
        if (expectedStatus === 304) {
          assert.equal(response.headers.get('etag'), ETAG);
          assert.equal(response.headers.get('content-type'), 'image/jpeg');
          for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) assert.equal(response.headers.get(key), IMMUTABLE);
        } else assertPrivateNoStore(response);
      });
    }
  } finally {
    if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET;
    else process.env.SHARED_CARD_PROXY_SECRET = previous;
  }
});

test('T7 all eight covered kinds advertise the same JPEG portrait; coverless and moving media stay truthful', () => {
  assert.deepEqual([...SHARE_ENTITY_KINDS], ['place', 'curated', 'event', 'rsvp_event', 'trip', 'experience', 'venue', 'brand']);
  for (const kind of SHARE_ENTITY_KINDS) {
    const html = preview.renderContentShareHtml(share(kind));
    assert.match(html, new RegExp(`/og/s/${CODE}/v${VERSION}-r2\\.jpg`), kind);
    assert.match(html, /og:image:type" content="image\/jpeg"/);
    assert.match(html, /og:image:width" content="1080"/);
    assert.match(html, /og:image:height" content="1350"/);
    assert.doesNotMatch(html, /class="brand(?:\s|")|>Mingla Business</);
  }

  const coverless = preview.renderContentShareHtml(share('place', null));
  assert.doesNotMatch(coverless, /og:image|twitter:image|class="portrait"/);

  for (const [kind, url] of [['video', MOVING], ['gif', MOVING.replace('.mp4', '.gif')]]) {
    const html = preview.renderContentShareHtml(share('place', { kind, url, posterUrl: POSTER }));
    assert.match(html, new RegExp(`/og/s/${CODE}/v${VERSION}-r2\\.jpg`));
    assert.doesNotMatch(html, new RegExp(`<meta[^>]+(?:og:image|twitter:image)[^>]+${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(html, new RegExp(`data-source="${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
});

test('T8 consumer share pages lose only the redundant outer logo; portraits and Business pages keep their intended brands', () => {
  const content = preview.renderContentShareHtml(share('brand'));
  const legacy = preview.renderSharedCardHtml({ share_id: 'a'.repeat(36), kind: 'place', title: 'Legacy', cover_url: POSTER, metadata: {}, stops: [] }, 'https://go.usemingla.com/w36m');
  for (const html of [content, legacy]) assert.doesNotMatch(html, /class="brand(?:\s|")|>Mingla Business</);

  const portrait = renderer.contentSharePortraitElement(share('place'));
  const walk = (node, out = []) => {
    if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
    if (!node || typeof node !== 'object') return out;
    out.push(node);
    walk(node.props?.children, out);
    return out;
  };
  const images = walk(portrait).filter((node) => node?.type === 'img');
  assert.ok(images.some((node) => String(node.props?.src || '').startsWith('data:image/svg+xml;base64,')), 'portrait wordmark removed');

  const business = preview.renderEventHtml({
    id: 'event-id', title: 'Business event', brand_name: 'Acme', brand_slug: 'acme', slug: 'event',
    starts_at: '2027-01-01T12:00:00Z', cover_media_url: null, location_text: 'Durham',
  });
  assert.match(business, /aria-label="Mingla Business"/);
  assert.match(business, />Mingla Business<\/span>/);
});
