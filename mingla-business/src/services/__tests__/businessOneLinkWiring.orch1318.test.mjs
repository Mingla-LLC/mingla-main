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
 *   - Drop setOneLinkCustomDomains / the go.usemingla.com domain → A3 fails.
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
test('A3: business registers the go.usemingla.com branded OneLink domain', () => {
  assert.match(service, /setOneLinkCustomDomains\(/, 'must call setOneLinkCustomDomains');
  assert.match(service, /"go\.usemingla\.com"|'go\.usemingla\.com'/, "must register 'go.usemingla.com'");
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
