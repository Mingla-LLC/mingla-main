/** #1615 stage-4 implementor happy path. FAILS-ON-REVERT: reverting `/s`
 * receiver wiring makes H1–H7 fail while legacy `/p` remains independently. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('R1 Edge resolves strict Base62 codes through the service-only resolver', () => {
  const edge = read('supabase/functions/shared-card/index.ts');
  assert.match(edge, /CONTENT_SHARE_RE = \/\^\[0-9A-Za-z\]\{16\}\$\//);
  assert.match(edge, /rpc\("resolve_content_share_code", \{ p_code: shortCode \}\)/);
  assert.match(edge, /data\.gone === true.*"gone".*410/s);
  assert.match(edge, /return json\(\{ contentShare: data \}\)/);
});

test('R2 buyer web page, data and immutable image routes traverse the protected chain', () => {
  const middleware = read('mingla-marketing/middleware.ts');
  const proxy = read('mingla-marketing/lib/shared-card-proxy.ts');
  const marketing = read('mingla-marketing/vercel.json');
  const business = read('mingla-business/vercel.json');
  for (const token of ['/s/', '/og/s/', '/api/content-share/']) assert.ok(middleware.includes(token), token);
  for (const surface of ['content-page', 'content-data', 'content-image']) assert.ok(proxy.includes(surface), surface);
  assert.match(proxy, /SHARE_CODE = \/\^\[0-9A-Za-z\]\{16\}\$\//);
  assert.match(proxy, /SHARE_VERSION = \/\^\[1-9\]\[0-9\]\*\$\//);
  assert.match(marketing, /\/og\/s\/:code\/v:version\.png/);
  assert.match(business, /\/og\/s\/:code\/v:version\.png/);
});

test('R3 native route resolves exact typed destinations and keeps place/curated local', () => {
  const route = read('app-mobile/app/s/[code].tsx');
  for (const path of ['/e/', '/t/', '/exp/', '/b/']) assert.ok(route.includes(path), path);
  assert.match(route, /share\.facts\.kind === 'event' \|\| share\.facts\.kind === 'rsvp_event'/);
  assert.match(route, /return brand && entity \? `\/e\/\$\{brand\}\/\$\{entity\}` : null/);
  assert.match(route, /share\.facts\.kind === 'trip'.*return brand && entity \? `\/t\//s);
  assert.match(route, /share\.facts\.kind === 'experience'.*return brand && entity \? `\/exp\//s);
  assert.match(route, /return null;\s*\};/);
  assert.match(route, /selectPreviewFacts\(share\.facts, 4\)/);
  assert.doesNotMatch(route, /AppsFlyer|go\.usemingla/);
});

test('R4 OneLink resolver accepts only exact short codes and dispatches one /s path', async () => {
  const resolver = await import(pathToFileURL(path.join(ROOT, 'app-mobile/src/services/oneLinkResolver.ts')));
  const code = 'Aa0Bb1Cc2Dd3Ee4F';
  assert.deepEqual(resolver.resolveOneLinkDestination({ deep_link_value: 'content_share', deep_link_sub1: code }), { kind: 'content_share', code });
  assert.equal(resolver.resolveOneLinkDestination({ deep_link_value: 'content_share', deep_link_sub1: 'too-short' }), null);
  const index = read('app-mobile/app/index.tsx');
  assert.match(index, /case 'content_share':[\s\S]*`\/s\/\$\{encodeURIComponent\(dest\.code\)\}`/);
});

test('R5 AASA, Android app config and physical native route claims are atomic', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'app-mobile/app/s/[code].tsx')));
  assert.match(read('mingla-marketing/public/.well-known/apple-app-site-association'), /"\/s\/\*"/);
  assert.match(read('app-mobile/app.json'), /"pathPrefix": "\/s"/);
  const assets = JSON.parse(read('mingla-marketing/public/.well-known/assetlinks.json'));
  assert.equal(assets[0].target.package_name, 'com.mingla.app.v2');
  assert.ok(assets[0].target.sha256_cert_fingerprints.length >= 1);
});

test('R6 public metadata is version-addressed and the deferred-install CTA is not canonical', () => {
  const preview = read('mingla-business/server/socialPreview.js');
  const service = read('mingla-business/server/contentShareService.js');
  assert.match(preview, /\/og\/s\/\$\{encodeURIComponent\(code\)\}\/v\$\{Number\(contentShare\.version\)\}\.png/);
  assert.match(preview, /canonicalUrl = `\$\{EXPLORER_PUBLIC_ORIGIN\}\/s\//);
  assert.match(service, /pid=content_share&deep_link_value=content_share/);
});

test('R7 legacy /p and old 36-hex native handling remain intact', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'app-mobile/app/p/[shareId].tsx')));
  // [TEST-MOD-APPROVED #1615] Written reason: the first assertion escaped the
  // regex source one level incorrectly; assert the preserved public matcher.
  assert.match(read('mingla-marketing/middleware.ts'), /'\/p\/:path\*'/);
  assert.match(read('mingla-business/vercel.json'), /"source": "\/p\/:shareId"/);
  assert.match(read('app-mobile/app.json'), /"pathPrefix": "\/p"/);
});
