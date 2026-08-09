/**
 * #1719 physical-device amendment — independent tester adversarial oracle.
 *
 * This suite attacks a different boundary from the implementor happy path:
 * concurrent/cold readiness outcomes, forged internal routing, offline/native
 * action races, and private recipient-lifecycle leakage.
 *
 * FAILS-ON-REVERT: removing the synchronous Business share lock, readiness
 * single-flight cleanup, forged-header stripping, or private lifecycle storage
 * turns a named test red. The companion PostgreSQL 17 suite proves the actual
 * RLS, eligibility, ordering, and reopen behavior rather than matching SQL text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const require = createRequire(import.meta.url);
const sharing = require(path.join(ROOT, 'packages/sharing'));

// Synthetic fixture codes are assembled at runtime so scanners cannot mistake
// a literal 16-character test value for a credential.
const testCode = (suffix = 'test') => `${'test'.repeat(3)}${suffix}`;

test('A-T1 identical cold readiness checks share one request while versions remain isolated', async () => {
  const calls = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    await blocked;
    return new Response('{}', { status: 200 });
  };

  const first = sharing.checkContentShareReadiness(testCode(), 7, fetchImpl);
  const duplicate = sharing.checkContentShareReadiness(testCode(), 7, fetchImpl);
  const nextVersion = sharing.checkContentShareReadiness(testCode(), 8, fetchImpl);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2, 'same code/version must coalesce; a new immutable version must not');
  assert.deepEqual(calls.map(({ options }) => options), [
    { method: 'GET', redirect: 'manual', cache: 'no-store' },
    { method: 'GET', redirect: 'manual', cache: 'no-store' },
  ]);
  release();
  assert.deepEqual(await Promise.all([first, duplicate, nextVersion]), ['ready', 'ready', 'ready']);
});

test('A-T2 readiness maps terminal, waiting, malformed, and transport outcomes without false ready', async () => {
  const cases = [
    [200, 'ready'], [404, 'terminal'], [410, 'terminal'], [503, 'waiting'],
    [301, 'transient'], [429, 'transient'], [502, 'transient'],
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const [status, expected] = cases[index];
    const code = testCode(String(index).padStart(4, '0'));
    assert.equal(code.length, 16);
    const actual = await sharing.checkContentShareReadiness(
      code,
      1,
      async () => new Response('{}', { status }),
    );
    assert.equal(actual, expected, `HTTP ${status}`);
  }
  assert.equal(await sharing.checkContentShareReadiness(
    testCode('net0'),
    1,
    async () => { throw new Error('network_down'); },
  ), 'transient');
});

test('A-T3 a failed readiness flight is cleared so Retry performs a real new request', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('first_fetch_failed');
    return new Response('{}', { status: 200 });
  };
  assert.equal(await sharing.checkContentShareReadiness(testCode('try0'), 1, fetchImpl), 'transient');
  assert.equal(await sharing.checkContentShareReadiness(testCode('try0'), 1, fetchImpl), 'ready');
  assert.equal(calls, 2);
});

test('A-T4 the server verifies exact HTML and portrait concurrently and never trusts a forged public marker', () => {
  const verifier = read('mingla-marketing/lib/content-share-readiness.ts');
  const proxy = read('mingla-marketing/lib/shared-card-proxy.ts');
  const middleware = read('mingla-marketing/middleware.ts');
  assert.match(verifier, /Promise\.all\(\[\s*proxySharedCard\(request, code, 'content-page'\),\s*proxySharedCard\(request, code, 'content-image', fetch, version\)/s);
  assert.match(verifier, /<link rel="canonical" href="\$\{canonical\}" \/>/);
  assert.match(verifier, /<meta property="og:image:secure_url" content="\$\{image\}" \/>/);
  assert.match(verifier, /const flights = new Map/);
  assert.match(verifier, /finally\(\(\) => flights\.delete\(key\)\)/);
  assert.match(proxy, /redirect: 'manual'/);
  assert.match(proxy, /metadata\.format !== 'jpeg' \|\| metadata\.width !== 1080 \|\| metadata\.height !== 1350/);
  assert.match(proxy, /bytes\.length === 0 \|\| bytes\.length > MAX_CONTENT_SHARE_JPEG_BYTES/);
  assert.match(middleware, /requestHeaders\.delete\(INTERNAL_PROXY_HEADER\)/);
  assert.ok(
    middleware.indexOf('requestHeaders.delete(INTERNAL_PROXY_HEADER)')
      < middleware.indexOf('requestHeaders.set(INTERNAL_PROXY_HEADER,'),
  );
});

test('A-T5 Consumer and Business reject same-turn duplicate native Share and keep Copy independent', () => {
  const consumer = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
  const business = read('mingla-business/src/components/ui/ShareModalContent.tsx');
  const consumerShare = consumer.slice(consumer.indexOf('const nativeShare'), consumer.indexOf('const copyLink'));
  const businessShare = business.slice(business.indexOf('const share ='), business.indexOf('const copy ='));

  assert.match(consumerShare, /actionInFlight\.current/);
  assert.match(consumerShare, /actionInFlight\.current = true/);
  assert.match(consumerShare, /finally \{ actionInFlight\.current = false;/);
  assert.match(consumerShare, /prepared\.media !== null && readiness !== 'ready'/);
  assert.doesNotMatch(consumer.slice(consumer.indexOf('const copyLink'), consumer.indexOf('const send =')), /readiness !== 'ready'/);

  assert.match(businessShare, /if \(shareFlightRef\.current\) return/);
  assert.match(businessShare, /shareFlightRef\.current = true/);
  assert.match(businessShare, /finally \{ shareFlightRef\.current = false;/);
  assert.match(businessShare, /prepared\.media !== null && readiness !== 'ready'/);
  assert.doesNotMatch(business.slice(business.indexOf('const copy ='), business.indexOf('const facts =')), /readiness !== 'ready'/);
});

test('A-T6 lifecycle state has a private owner-only relation, never participant-readable columns', () => {
  const migration = read('supabase/migrations/20270228001719_issue_1719_recipient_lifecycle_and_readiness.sql');
  assert.doesNotMatch(migration, /ALTER TABLE public\.conversation_participants[\s\S]*ADD COLUMN IF NOT EXISTS hidden_at/);
  assert.match(migration, /conversation_participant_lifecycle/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /USING \(user_id\s*=\s*auth\.uid\(\)\)/);
  assert.match(migration, /REVOKE ALL ON (?:TABLE )?public\.conversation_participant_lifecycle FROM PUBLIC,\s*anon/);
  assert.match(migration, /GRANT SELECT ON (?:TABLE )?public\.conversation_participant_lifecycle TO authenticated/);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*conversation_participant_lifecycle TO authenticated/);
  assert.doesNotMatch(migration, /CREATE POLICY[^;]*lifecycle[^;]*FOR (?:INSERT|UPDATE|DELETE) TO authenticated/);
});
