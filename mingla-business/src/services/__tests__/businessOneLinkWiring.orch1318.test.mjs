#!/usr/bin/env node
/**
 * ORCH-1318 [appsflyer-onelink-deferred-deeplinking] — BUSINESS source-structural
 * guard for the listener flip + onDeepLink subscription + ATT-safe ordering
 * (SPEC §A.2/§A.3) and the branded-domain / referral-capture wiring.
 *
 * Harness note: mingla-business/src/services/appsFlyerService.ts + app/_layout.tsx
 * import react-native + expo + the native AppsFlyer module — not loadable under
 * Node's native runner. Per the repo convention (the consumer
 * oneLinkWiring.orch1318.test.mjs, oneSignalService.orch1264) this is a
 * SOURCE-STRUCTURAL suite: it reads the source, strips comments, and asserts the
 * exact behavioral contract in code. Every assertion FAILS on a true line-deletion
 * / re-introduction of the policy it protects (fails-on-revert), not on a
 * comment-out (comments are stripped before matching). Runtime behavior of the
 * business callback is additionally jest-tested in appsFlyerOneLink.orch1318.test.ts.
 *
 * Run: node --test src/services/__tests__/businessOneLinkWiring.orch1318.test.mjs
 *
 * FAILS-ON-REVERT map:
 *   - Flip onDeepLinkListener / onInstallConversionDataListener back to false → A1 fails.
 *   - Register onDeepLink after (or drop it before) initSdk → A2 fails.
 *   - Drop setOneLinkCustomDomains, drop the BUSINESS_ONELINK_BRANDED_DOMAIN
 *     SSOT import, or reintroduce a go.usemingla.com literal → A3 fails (#1050:
 *     the Business OneLink host is `biz.` — its own vouching domain; `go.` is
 *     consumer-only and re-adding it re-breaks Android <=11 verification).
 *   - Drop subscribeOneLinkDeepLink export or the _layout referral capture → B1 fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIZ_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(BIZ_ROOT, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const service = stripComments(read('src/services/appsFlyerService.ts'));
const layout = stripComments(read('app/_layout.tsx'));

// ── A1: both deep-link listeners ENABLED in initSdk (SPEC §A.2.1) ──────────────
test('A1: business onDeepLinkListener + onInstallConversionDataListener are true', () => {
  assert.match(service, /onDeepLinkListener:\s*true/, 'onDeepLinkListener must be true');
  assert.match(
    service,
    /onInstallConversionDataListener:\s*true/,
    'onInstallConversionDataListener must be true',
  );
  assert.doesNotMatch(service, /onDeepLinkListener:\s*false/, 'listener must NOT be false');
});

// ── A2: onDeepLink registered BEFORE initSdk (business init IS the start) ──────
test('A2: onDeepLink is registered before initSdk (business has no manualStart)', () => {
  assert.match(service, /\.onDeepLink\(/, 'must register onDeepLink');
  const regIdx = service.indexOf('registerOneLinkDeepLink(');
  const initIdx = service.indexOf('.initSdk(');
  assert.ok(regIdx !== -1, 'registerOneLinkDeepLink( must be called');
  assert.ok(initIdx !== -1, '.initSdk( must exist');
  assert.ok(regIdx < initIdx, 'onDeepLink must be registered before initSdk fires transmission');
});

// ── A3: branded OneLink domain registered at runtime (SPEC §C.1) ──────────────
// #1050 — the Business app's OneLink host is `biz.usemingla.com` (its OWN
// vouching branded domain), imported from the storeLinks SSOT as
// BUSINESS_ONELINK_BRANDED_DOMAIN. `go.usemingla.com` is CONSUMER-only:
// re-adding it here (or in the SDK registration, or in app.json) re-breaks
// business.usemingla.com App Link verification on Android <=11 (the
// all-or-nothing legacy verifier fails the whole autoVerify set on a host that
// publishes no Digital Asset Links statement for the Business package).
test('A3: business registers the biz. branded OneLink domain via the storeLinks SSOT (no go. literal)', () => {
  assert.match(service, /setOneLinkCustomDomains\(/, 'must call setOneLinkCustomDomains');
  // (a) the host comes from the SSOT import, never a hardcoded literal.
  assert.match(
    service,
    /import\s*\{[^}]*\bBUSINESS_ONELINK_BRANDED_DOMAIN\b[^}]*\}\s*from\s*['"]\.\.\/constants\/storeLinks['"]/,
    'must import BUSINESS_ONELINK_BRANDED_DOMAIN from ../constants/storeLinks (the SSOT)',
  );
  // (b) that imported identifier is what is registered with the SDK.
  assert.match(
    service,
    /setOneLinkCustomDomains\(\s*\[\s*BUSINESS_ONELINK_BRANDED_DOMAIN\s*\]/,
    'must pass BUSINESS_ONELINK_BRANDED_DOMAIN to setOneLinkCustomDomains',
  );
  // (c) the CONSUMER host must NOT appear anywhere in the service (comments are
  // stripped before matching — this is fails-on-revert on a real go. literal).
  assert.doesNotMatch(
    service,
    /go\.usemingla\.com/,
    'the service must carry NO go.usemingla.com literal (#1050 — go. is consumer-only)',
  );
  // never navigates from the service — forwards to a sink
  assert.match(service, /export function subscribeOneLinkDeepLink/, 'must export subscribeOneLinkDeepLink');
  assert.match(service, /_deepLinkSubscribed/, 'must guard idempotent onDeepLink registration');
});

// ── B1: _layout wires the sink post-ATT + persists the referral code ──────────
test('B1: _layout registers the sink after initializeAppsFlyer and captures the referral code', () => {
  assert.match(layout, /subscribeOneLinkDeepLink\(/, '_layout must register the OneLink sink');
  assert.match(layout, /@mingla_referral_code/, 'referral capture must persist @mingla_referral_code');
  const initIdx = layout.indexOf('initializeAppsFlyer()');
  const sinkIdx = layout.indexOf('subscribeOneLinkDeepLink(');
  assert.ok(initIdx !== -1 && sinkIdx !== -1, 'both initializeAppsFlyer + the sink must exist');
  assert.ok(sinkIdx > initIdx, 'the sink must be wired after (post-ATT) initializeAppsFlyer');
});
