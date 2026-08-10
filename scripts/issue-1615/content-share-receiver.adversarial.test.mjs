/** #1615 stage-4 tester angle. FAILS-ON-REVERT: bypassing proxy validation,
 * claiming mismatched routes, or exposing unversioned images fails this suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('RA1 every anonymous content handler fails closed on the shared proxy secret', () => {
  for (const file of ['mingla-business/api/content-share.js', 'mingla-business/api/content-share-data.js', 'mingla-business/api/content-share-image.js']) {
    const source = read(file);
    assert.match(source, /hasValidSharedCardProxySecret/);
    assert.match(source, /404/);
  }
  assert.match(read('mingla-marketing/middleware.ts'), /requestHeaders\.delete\(INTERNAL_PROXY_HEADER\)/);
});

test('RA2 malformed code/version cannot spend an upstream read', () => {
  const proxy = read('mingla-marketing/lib/shared-card-proxy.ts');
  const validation = proxy.indexOf('if (!internalMarker');
  const fetch = proxy.indexOf('fetchImpl(');
  assert.ok(validation >= 0 && fetch > validation);
  assert.match(proxy, /validIdentifier.*SHARE_CODE\.test/s);
  assert.match(proxy, /validVersion.*SHARE_VERSION\.test/s);
});

test('RA3 business app does not claim recipient-facing /s links', () => {
  const config = read('mingla-business/app.json');
  assert.doesNotMatch(config, /"pathPrefix": "\/s"/);
});

test('RA4 no unversioned new OG grammar exists', () => {
  const corpus = [read('mingla-marketing/middleware.ts'), read('mingla-marketing/vercel.json'), read('mingla-business/vercel.json')].join('\n');
  assert.match(corpus, /\/og\/s\//);
  assert.doesNotMatch(corpus, /\/og\/s\/:code\.png/);
});

test('RA5 content creation remains fail-closed through the shared runtime resolver', () => {
  const edge = read('supabase/functions/shared-card/index.ts');
  assert.match(edge, /resolveRuntimeBoolean\(/);
  assert.match(edge, /"content_share_v1_create_enabled"/);
  assert.doesNotMatch(edge, /Deno\.env\.get\("CONTENT_SHARE_V1_CREATE_ENABLED"\)/);
});
