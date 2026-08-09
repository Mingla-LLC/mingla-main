#!/usr/bin/env node
/**
 * ORCH-1318 [appsflyer-onelink-deferred-deeplinking] — SOURCE-STRUCTURAL guard
 * for the listener flip + onDeepLink subscription + ATT-safe ordering (SPEC §A)
 * and the tracked-link wiring (SPEC §B/§E).
 *
 * Harness note: app-mobile has NO jest/RTL runner, and appsFlyerService.ts /
 * app/index.tsx / ShareModal.tsx import react-native + expo-constants + the
 * native AppsFlyer module — not loadable under Node's native runner. Per the
 * repo convention (orch_1258_att_first_permission, oneSignalService.orch1264,
 * orch_1187_posthog_native) this is a SOURCE-STRUCTURAL suite: it reads the
 * source, strips comments, and asserts the exact behavioral contract in code.
 * Every assertion FAILS on a TRUE LINE-DELETION / re-introduction of the policy
 * it protects (fails-on-revert), not merely on a comment-out (comments are
 * stripped before matching). The payload→destination mapping + the outbound
 * link builder are additionally RUNTIME-tested headless under Deno
 * (oneLinkResolver.orch1318.test.ts, oneLinkShare.orch1318.test.ts).
 *
 * Run: node --test src/services/__tests__/oneLinkWiring.orch1318.test.mjs
 *
 * FAILS-ON-REVERT map:
 *   - Flip onDeepLinkListener / onInstallConversionDataListener back to false → A1/A2 fail.
 *   - Remove the appsFlyer.onDeepLink subscription or its FOUND guard / dedup → A3/A4 fail.
 *   - Add a startSdk before ATT / more than one startSdk → A6 fails.
 *   - Drop subscribeOneLinkDeepLink wiring or triggerAndroidDeferredResolution → B1/A5 fail.
 *   - Revert ShareModal copy-link to the plain "Check out …" text → E1 fails.
 *   - Drop the deferred entity-route replay marker → B3 fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(MOBILE_ROOT, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const service = stripComments(read('src/services/appsFlyerService.ts'));
const indexTsx = stripComments(read('app/index.tsx'));
const shareModal = stripComments(read('src/components/ShareModal.tsx'));
const unifiedShare = stripComments(read('src/components/share/UnifiedShareProvider.tsx'));
const resolver = stripComments(read('src/services/oneLinkResolver.ts'));

// ── A1: both deep-link listeners ENABLED in initSdk (SPEC §A.1.1) ─────────────
test('A1: onDeepLinkListener + onInstallConversionDataListener are true (listener flip)', () => {
  assert.match(service, /onDeepLinkListener:\s*true/, 'onDeepLinkListener must be true');
  assert.match(
    service,
    /onInstallConversionDataListener:\s*true/,
    'onInstallConversionDataListener must be true',
  );
  assert.doesNotMatch(service, /onDeepLinkListener:\s*false/, 'listener must NOT be false');
});

// ── A2: onDeepLink registered BEFORE initSdk (SPEC §A.1.2) ────────────────────
test('A2: onDeepLink subscription is registered before initSdk fires', () => {
  assert.match(service, /appsFlyer\.onDeepLink\(/, 'must register appsFlyer.onDeepLink');
  const regIdx = service.indexOf('registerOneLinkDeepLink()');
  const initIdx = service.indexOf('appsFlyer.initSdk(');
  assert.ok(regIdx !== -1, 'registerOneLinkDeepLink() must be called');
  assert.ok(initIdx !== -1, 'appsFlyer.initSdk( must exist');
  assert.ok(regIdx < initIdx, 'onDeepLink must be registered before initSdk');
});

// ── A3: FOUND guard + never-navigate + delegate to the ONE resolver ───────────
test('A3: callback guards non-FOUND and delegates to resolveOneLinkDestination', () => {
  assert.match(service, /deepLinkStatus\s*!==\s*'FOUND'/, 'must ignore non-FOUND status');
  assert.match(
    service,
    /resolveOneLinkDestination\(/,
    'must resolve via the ONE resolver (I-ONELINK-SINGLE-RESOLVER)',
  );
  // The service forwards to a sink and buffers — it never navigates.
  assert.match(service, /_oneLinkSink/, 'must forward to the UI sink');
  assert.match(service, /_bufferedDestination/, 'must buffer for pre-sink flush (SPEC §A.4.3)');
});

// ── A4: double-fire dedup (SPEC §A.4.1) ───────────────────────────────────────
test('A4: dedups a double-fire by link within a window', () => {
  assert.match(service, /_lastHandledLink/, 'must track last-handled link');
  assert.match(service, /DEEPLINK_DEDUP_WINDOW_MS/, 'must apply a dedup window');
});

// ── A5: buffered flush + Android deferred trigger + branded domain ────────────
test('A5: subscribeOneLinkDeepLink flushes buffer; Android trigger; branded domain', () => {
  assert.match(
    service,
    /export function subscribeOneLinkDeepLink/,
    'must export subscribeOneLinkDeepLink',
  );
  // flush-once-then-clear
  assert.match(service, /_bufferedDestination\s*=\s*null/, 'must clear buffer after flush');
  // Android-only deferred resolution (SPEC §A.1.3)
  assert.match(
    service,
    /export function triggerAndroidDeferredResolution/,
    'must export triggerAndroidDeferredResolution',
  );
  assert.match(service, /Platform\.OS\s*!==\s*'android'/, 'trigger must be Android-guarded');
  assert.match(service, /performOnDeepLinking\(\)/, 'must call performOnDeepLinking on Android');
  // Branded OneLink domain registered at runtime (SPEC §C.1)
  assert.match(service, /setOneLinkCustomDomains\(/, 'must call setOneLinkCustomDomains');
  assert.match(service, /'go\.usemingla\.com'/, "must register 'go.usemingla.com'");
});

// ── A6: I-ONELINK-NO-TRANSMIT-BEFORE-ATT — exactly one startSdk, in startAppsFlyer
test('A6: enabling the listener introduced NO extra startSdk (only startAppsFlyer transmits)', () => {
  const startSdkCount = (service.match(/appsFlyer\.startSdk\(\)/g) || []).length;
  assert.equal(startSdkCount, 1, 'there must be exactly ONE appsFlyer.startSdk() call');
  // and it lives inside startAppsFlyer
  const startFnIdx = service.indexOf('export function startAppsFlyer');
  const startSdkIdx = service.indexOf('appsFlyer.startSdk()');
  assert.ok(startFnIdx !== -1 && startSdkIdx > startFnIdx, 'startSdk must be inside startAppsFlyer');
});

// ── B1: consumer app wires the sink in the init effect + Android trigger post-ATT
test('B1: index.tsx registers the sink with initializeAppsFlyer and triggers Android post-ATT', () => {
  assert.match(
    indexTsx,
    /subscribeOneLinkDeepLink\(dispatchOneLinkDestination\)/,
    'must register the OneLink sink',
  );
  // sink registered in the SAME effect as initializeAppsFlyer
  const initIdx = indexTsx.indexOf('initializeAppsFlyer();');
  const sinkIdx = indexTsx.indexOf('subscribeOneLinkDeepLink(dispatchOneLinkDestination)');
  assert.ok(initIdx !== -1 && sinkIdx > initIdx && sinkIdx - initIdx < 600,
    'sink must be wired in the same effect as initializeAppsFlyer');
  assert.match(indexTsx, /triggerAndroidDeferredResolution\(\)/, 'must trigger Android deferred resolution');
  assert.match(indexTsx, /import \{ router \} from "expo-router"/, 'must import the router singleton');
});

// ── B2: ATT ordering preserved — ensureAttRequested precedes startAppsFlyer ───
test('B2: startAppsFlyer stays behind the ATT gate (transmit after ATT resolves)', () => {
  const attIdx = indexTsx.indexOf('ensureAttRequested()');
  const startIdx = indexTsx.indexOf('startAppsFlyer();');
  assert.ok(attIdx !== -1 && startIdx !== -1, 'both ensureAttRequested + startAppsFlyer must exist');
  assert.ok(attIdx < startIdx, 'ensureAttRequested must precede startAppsFlyer (ATT-before-transmit)');
});

// ── B3: dispatcher routes each kind + deferred entity-route replay (SPEC §B.3/§B.4)
test('B3: dispatcher routes entity/internal/referral and the deferred replay honors the router marker', () => {
  assert.match(indexTsx, /function dispatchOneLinkDestination/, 'must define the ONE dispatcher');
  assert.match(indexTsx, /router\.push\(path as never\)/, 'entity → router.push');
  assert.match(indexTsx, /handleDeepLinkRef\.current\(dest\.url\)/, 'internal → handleDeepLink');
  assert.match(indexTsx, /@mingla_referral_code/, 'referral → capture @mingla_referral_code');
  // deferred entity-route replay marker (SPEC §B.4)
  assert.match(indexTsx, /router:\s*true/, 'deferred entity link persists a router marker');
  assert.match(indexTsx, /parsed\.router\s*===\s*true/, 'replay recognizes the router marker');
  assert.match(indexTsx, /router\.push\(url as never\)/, 'replay router.push-es the deferred entity route');
});

// ── B4: single resolver — exactly one definition, imported by the service ─────
test('B4: resolveOneLinkDestination has exactly one definition (I-ONELINK-SINGLE-RESOLVER)', () => {
  const defs = (resolver.match(/export function resolveOneLinkDestination/g) || []).length;
  assert.equal(defs, 1, 'exactly one resolver definition');
  assert.match(service, /from '\.\/oneLinkResolver'/, 'service imports the ONE resolver');
});

// [TEST-MOD-APPROVED #1719] ShareModal is now only the compatibility bridge into
// the one app-wide provider. The provider owns link preparation, copy and native
// share, so this assertion follows that ownership move while preserving #1318's
// short-link and no-hardcoded-message laws.
// ── E1: unified provider emits the prepared stable link, not plain marketing text ──
test('E1: ShareModal copy-link + social share emit the prepared stable share', () => {
  assert.match(shareModal, /useUnifiedShare/, 'legacy modal must delegate to the unified provider');
  assert.match(unifiedShare, /prepareContentShare\(/, 'provider must prepare the stable short link');
  // the plain-text copy string must be GONE
  assert.doesNotMatch(
    shareModal + unifiedShare,
    /Clipboard\.setString\(`Check out \$\{title\} on Mingla!`\)/,
    'the plain "Check out … on Mingla!" copy string must be replaced',
  );
  // Social sharing must consume the one server-prepared message/link envelope.
  assert.match(unifiedShare, /sharePreparedContent\(prepared\)/, 'native sharing must receive the prepared canonical URL');
  assert.match(unifiedShare, /Clipboard\.setString\(prepared\.canonicalUrl\)/, 'copy must receive the prepared canonical URL');
});
