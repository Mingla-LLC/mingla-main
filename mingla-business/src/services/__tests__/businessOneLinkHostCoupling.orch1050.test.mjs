#!/usr/bin/env node
/**
 * #1050 [business-onelink-host-swap] — TESTER-authored adversarial regression gate.
 *
 * ANGLE (net-new — different from the two existing gates, closes CLOSE Step 0.5):
 *   - i-aasa-claims-match-native-routes.test.mjs proves mingla-business/app.json DECLARES
 *     biz. and not go. (the manifest side, in isolation).
 *   - businessOneLinkWiring.orch1318.test.mjs (A3) proves appsFlyerService.ts IMPORTS the
 *     storeLinks SSOT const and registers it via setOneLinkCustomDomains (the SDK side,
 *     in isolation).
 *   NEITHER proves the SSOT *value* actually EQUALS the branded host the native manifest
 *   declares. That gap IS #1050's dead-end trap: if
 *   storeLinks.BUSINESS_ONELINK_BRANDED_DOMAIN (what the AppsFlyer SDK registers via
 *   setOneLinkCustomDomains) and the mingla-business/app.json branded autoVerify host
 *   (Android intentFilter) / associatedDomains applinks host (iOS) ever DRIFT APART, the
 *   SDK registers a domain the manifest does not declare — a verified biz. link opens the
 *   app and then DEAD-ENDS (deepLinkStatus: NOT_FOUND) — and BOTH existing gates stay
 *   green. This gate welds the three declarations (SSOT + Android manifest + iOS manifest)
 *   into one value so they can never silently diverge, and so `go.usemingla.com` can never
 *   creep back onto the Business package (a 3rd branded host would break the exactly-one
 *   contract too).
 *
 * SOURCE-STRUCTURAL suite (the SSOT is a .ts Node cannot import; app.json is pure JSON):
 *   reads storeLinks.ts as text (comments stripped so a doc mention of go. never leaks in)
 *   and JSON.parses app.json, then asserts the coupling. Every assertion FAILS on a true
 *   divergence (fails-on-revert), never on a comment.
 *
 * Run:  node --test mingla-business/src/services/__tests__/businessOneLinkHostCoupling.orch1050.test.mjs
 * CI:   registered in .github/scripts/strict-grep/MANIFEST.json as enforcement batch:A
 *       (jobKey orch-1050-onelink-host-coupling) → executed by run-batch.mjs in the
 *       "Strict grep — static gates (class A)" job of strict-grep-mingla-business.yml,
 *       the SAME workflow that runs the sibling businessOneLinkWiring.orch1318 gate.
 *
 * FAILS-ON-REVERT map:
 *   - Change the app.json Android/iOS branded host away from biz. (SSOT left at biz.) → C1/C2 fail.
 *   - Change BUSINESS_ONELINK_BRANDED_DOMAIN away from the manifest host → C1/C2 fail.
 *   - Reintroduce a go.usemingla.com code literal in the SSOT, or declare go. in app.json → C3 fails.
 *   - Add a 3rd branded (non-business) autoVerify host (e.g. re-add go.) → C1/C2 exactly-one fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve relative to THIS file (not cwd): run-batch.mjs invokes from repo root, the
// worktree root, or mingla-business/ — the mirror of the sibling suite's BIZ_ROOT.
const BIZ_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(BIZ_ROOT, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const WORKING_HOST = 'business.usemingla.com'; // the always-declared, always-vouching host
const CONSUMER_HOST = 'go.usemingla.com'; // Explorer-only; must never touch the Business package

// ── SSOT value (comments stripped: storeLinks.ts mentions go. in JSDoc; only a real code
//    literal must ever count) ──────────────────────────────────────────────────────────
const ssotSrc = stripComments(read('src/constants/storeLinks.ts'));
const ssotMatch = ssotSrc.match(
  /export\s+const\s+BUSINESS_ONELINK_BRANDED_DOMAIN\s*=\s*["']([^"']+)["']/,
);

// ── native manifest (pure JSON, no comments) ────────────────────────────────────────────
const appJson = JSON.parse(read('app.json'));
const expo = appJson.expo ?? {};

// iOS branded applinks host(s) = associatedDomains applinks entries that are NOT the working host.
const iosApplinks = (expo.ios?.associatedDomains ?? [])
  .filter((d) => typeof d === 'string' && d.startsWith('applinks:'))
  .map((d) => d.slice('applinks:'.length));
const iosBranded = iosApplinks.filter((h) => h !== WORKING_HOST);

// Android branded autoVerify host(s) = https hosts inside an autoVerify:true intentFilter
// that are NOT the working host.
const autoVerifyHttpsHosts = [];
for (const f of expo.android?.intentFilters ?? []) {
  if (f?.autoVerify !== true) continue;
  for (const d of f.data ?? []) {
    if (d?.scheme === 'https' && typeof d.host === 'string') autoVerifyHttpsHosts.push(d.host);
  }
}
const androidBranded = autoVerifyHttpsHosts.filter((h) => h !== WORKING_HOST);

test('precondition: SSOT export exists and the working host is still declared on both platforms', () => {
  assert.ok(
    ssotMatch,
    'storeLinks.ts must export BUSINESS_ONELINK_BRANDED_DOMAIN = "<host>" (the SDK SSOT)',
  );
  assert.ok(
    iosApplinks.includes(WORKING_HOST),
    `iOS associatedDomains must still declare applinks:${WORKING_HOST} (the working host)`,
  );
  assert.ok(
    autoVerifyHttpsHosts.includes(WORKING_HOST),
    `Android must still declare an autoVerify intentFilter for ${WORKING_HOST} (the working host)`,
  );
});

test('C1: SSOT BUSINESS_ONELINK_BRANDED_DOMAIN === the Android autoVerify branded host (exactly one)', () => {
  assert.equal(
    androidBranded.length,
    1,
    `expected exactly ONE branded (non-${WORKING_HOST}) autoVerify host, got [${androidBranded.join(', ')}] — a 2nd branded host (e.g. go. creeping back) breaks the contract`,
  );
  assert.equal(
    ssotMatch[1],
    androidBranded[0],
    `SSOT host "${ssotMatch[1]}" must EQUAL the Android manifest branded host "${androidBranded[0]}" — if they drift, the AppsFlyer SDK registers a domain the manifest never declares and a verified link DEAD-ENDS (NOT_FOUND)`,
  );
});

test('C2: SSOT BUSINESS_ONELINK_BRANDED_DOMAIN === the iOS associatedDomains branded host (exactly one)', () => {
  assert.equal(
    iosBranded.length,
    1,
    `expected exactly ONE branded (non-${WORKING_HOST}) applinks host, got [${iosBranded.join(', ')}]`,
  );
  assert.equal(
    ssotMatch[1],
    iosBranded[0],
    `SSOT host "${ssotMatch[1]}" must EQUAL the iOS associatedDomains branded host "${iosBranded[0]}"`,
  );
});

test('C3: go.usemingla.com never touches the Business package (SSOT value nor native manifest)', () => {
  assert.notEqual(
    ssotMatch[1],
    CONSUMER_HOST,
    'BUSINESS_ONELINK_BRANDED_DOMAIN must never be the consumer host go.usemingla.com',
  );
  assert.doesNotMatch(
    ssotSrc,
    /go\.usemingla\.com/,
    'no go.usemingla.com code literal may live in storeLinks.ts (comments are stripped first)',
  );
  assert.ok(
    !JSON.stringify(appJson).includes(CONSUMER_HOST),
    'mingla-business/app.json must not declare go.usemingla.com anywhere (associatedDomains or intentFilters)',
  );
});
