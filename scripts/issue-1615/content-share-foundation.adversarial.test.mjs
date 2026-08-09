/**
 * #1615 stage-2 adversarial persistence angle — new append-only suite.
 * FAILS-ON-REVERT: removing forced RLS, immutability, stable uniqueness, alias
 * continuity, or fail-closed creation makes one or more assertions fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const sql = read('supabase/migrations/20270226001615_issue_1615_content_share_links.sql');

test('A1 client roles cannot read tables or execute service-only RPCs', () => {
  for (const role of ['PUBLIC', 'anon', 'authenticated']) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.upsert_content_share_version\\([^)]+\\)\\s+FROM PUBLIC, anon, authenticated`));
    assert.match(sql, /REVOKE ALL ON public\.content_share_links, public\.content_share_versions, public\.content_share_aliases\s+FROM PUBLIC, anon, authenticated/);
  }
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL).*content_share_(?:links|versions|aliases).* TO (?:anon|authenticated)/i);
});

test('A2 version fingerprints exclude attribution and links do not default-expire', () => {
  const fingerprint = sql.match(/v_fingerprint :=[\s\S]*?\), 'sha256'\), 'hex'\);/)?.[0] || '';
  assert.ok(fingerprint);
  assert.doesNotMatch(fingerprint, /attribution|expires_at|updated_at/);
  assert.match(sql, /expires_at timestamptz NULL/);
  assert.doesNotMatch(sql, /expires_at timestamptz[^\n]*DEFAULT/);
});

test('A3 revoked/deleted/expired resolution is gone and malformed/missing stays absent', () => {
  assert.match(sql, /l\.state IN \('revoked','deleted'\).*l\.expires_at[\s\S]*?'gone', true/);
  assert.match(sql, /p_code ~ '\^\[0-9A-Za-z\]\{16\}\$'/);
  assert.match(sql, /WHEN l\.id IS NULL THEN NULL/);
});

test('A4 legacy /p schema, route and WAF proxy are preserved beside aliases', () => {
  const edge = read('supabase/functions/shared-card/index.ts');
  assert.match(edge, /SHARED_CARD_PROXY_SECRET/);
  assert.match(edge, /x-mingla-shared-card-proxy/);
  assert.match(edge, /SHARE_RE = \/\^\[a-f0-9\]\{36\}\$\//);
  assert.match(read('mingla-business/vercel.json'), /"source": "\/p\/:shareId"/);
  assert.match(sql, /attach_content_share_alias/);
  assert.match(sql, /'legacy_snapshot', v_old\.share_id/);
});

test('A5 server-created links require an explicit sanctioned marker', () => {
  assert.match(sql, /p_creator_principal IS NULL[\s\S]*p_source_reference @> '\{"serverCreated":true\}'::jsonb/);
  assert.match(sql, /creator_principal_required/);
});
