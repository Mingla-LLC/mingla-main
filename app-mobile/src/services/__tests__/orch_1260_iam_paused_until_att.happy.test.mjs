#!/usr/bin/env node
/**
 * ORCH-1260 [Apple Guideline 2.1 / launch UX] — HAPPY-PATH: the iOS App Tracking
 * Transparency (ATT) prompt is the SOLE first prompt at launch in the CONSUMER app
 * (app-mobile). A dashboard-configured OneSignal In-App Message (IAM) was
 * auto-rendering on app-open and CLUSTERING with the ATT prompt. This app holds ALL
 * IAMs at OneSignal init and resumes them only AFTER the ATT decision resolves, so
 * ATT is unmistakably first — then IAMs flow normally a few seconds later.
 *
 * The de-cluster is code-side and has two halves:
 *   (1) initializeOneSignal() pauses IAMs the instant the SDK is up
 *       (OneSignal.InAppMessages.setPaused(true), immediately after
 *       OneSignal.initialize(...)), so no IAM can auto-render during boot / while
 *       ATT is pending; and
 *   (2) the home-screen ATT effect (app/index.tsx) resumes IAMs
 *       (resumeInAppMessages() → setPaused(false)) once whenAttResolved() settles —
 *       iOS: after the ATT prompt is answered; non-iOS: immediately (ATT is a no-op).
 *
 * Harness note: app-mobile has NO jest/RTL runner and the oneSignalService /
 * permissionOrchestrator / app-index import graphs (react-native-onesignal,
 * react-native AppState, expo-tracking-transparency, RN components) are not loadable
 * under Node's native runner. Per the repo convention (orch_1257_att_appstate_early,
 * orch_1258_att_first_permission, orch_1243_os_permission_tag) this is a
 * SOURCE-STRUCTURAL suite that asserts the exact behavioral contract in source.
 * Comments are stripped before matching, so every assertion FAILS on a TRUE
 * line-deletion of the policy it protects (fails-on-revert), not on a comment-out.
 *
 * Run: node --test src/services/__tests__/orch_1260_iam_paused_until_att.happy.test.mjs
 *
 * FAILS-ON-REVERT map:
 *   - Delete `OneSignal.InAppMessages.setPaused(true)` from initializeOneSignal()
 *     (IAMs no longer paused at boot) → T1 fails.
 *   - Delete the `export function resumeInAppMessages()` helper or its
 *     `OneSignal.InAppMessages.setPaused(false)` call → T2 fails.
 *   - Delete `whenAttResolved().then(() => resumeInAppMessages())` from the ATT
 *     effect in app/index.tsx (IAMs never resume → permanently paused) → T3 fails.
 *   - Remove the resumeInAppMessages / whenAttResolved imports from app/index.tsx → T3 fails.
 *   - Move setPaused(true) BEFORE OneSignal.initialize(...) (paused before SDK up) → T4 fails.
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

const oneSignal = stripComments(read('src/services/oneSignalService.ts'));
const indexTsx = stripComments(read('app/index.tsx'));

// Isolate initializeOneSignal() so pause assertions target the init path only.
function initFnSlice() {
  const start = oneSignal.indexOf('export function initializeOneSignal');
  assert.ok(start !== -1, 'initializeOneSignal() must exist in oneSignalService.ts');
  const end = oneSignal.indexOf('export function isOneSignalReady');
  assert.ok(end !== -1, 'isOneSignalReady() must follow initializeOneSignal()');
  return oneSignal.slice(start, end);
}

// Isolate the home-screen ATT effect body (attFiredRef declaration → dep array).
function attEffectSlice() {
  const start = indexTsx.indexOf('const attFiredRef = useRef(false)');
  assert.ok(start !== -1, 'the ATT effect (attFiredRef) must exist in app/index.tsx');
  const depIdx = indexTsx.indexOf('[isAuthenticated, isLoadingAuth, user?.id]', start);
  assert.ok(depIdx !== -1, 'the ATT effect must have an [isAuthenticated, isLoadingAuth, user?.id] dep array');
  const end = indexTsx.indexOf(']', depIdx) + 1;
  return indexTsx.slice(start, end);
}

// ── T1: IAMs are PAUSED at OneSignal init (before ATT / any IAM can render) ──────
test('T1: initializeOneSignal() pauses In-App Messages (setPaused(true))', () => {
  const fn = initFnSlice();
  assert.match(
    fn,
    /OneSignal\.InAppMessages\.setPaused\(\s*true\s*\)/,
    'initializeOneSignal() must call OneSignal.InAppMessages.setPaused(true) so no IAM renders during boot',
  );
});

// ── T2: resumeInAppMessages() is exported and un-pauses IAMs, self-guarded ───────
test('T2: resumeInAppMessages() is exported and calls setPaused(false), guarded on _initialized', () => {
  assert.match(
    oneSignal,
    /export\s+function\s+resumeInAppMessages\s*\(\s*\)\s*:\s*void/,
    'oneSignalService must export resumeInAppMessages(): void',
  );
  const start = oneSignal.indexOf('export function resumeInAppMessages');
  const body = oneSignal.slice(start, oneSignal.indexOf('\n}', start) + 2);
  assert.match(
    body,
    /if\s*\(\s*!_initialized\s*\)\s*return/,
    'resumeInAppMessages() must self-guard on _initialized (never resume before init)',
  );
  assert.match(
    body,
    /OneSignal\.InAppMessages\.setPaused\(\s*false\s*\)/,
    'resumeInAppMessages() must call OneSignal.InAppMessages.setPaused(false) to resume IAMs',
  );
});

// ── T3: the ATT effect resumes IAMs after whenAttResolved() (never permanently paused)
test('T3: app/index.tsx resumes IAMs via whenAttResolved().then(resumeInAppMessages)', () => {
  // Imports are present (the wiring must be reachable).
  assert.match(
    indexTsx,
    /import\s*\{[^}]*\bresumeInAppMessages\b[^}]*\}\s*from\s*['"][^'"]*oneSignalService['"]/,
    'app/index.tsx must import resumeInAppMessages from oneSignalService',
  );
  assert.match(
    indexTsx,
    /import\s*\{[^}]*\bwhenAttResolved\b[^}]*\}\s*from\s*['"][^'"]*permissionOrchestrator['"]/,
    'app/index.tsx must import whenAttResolved from permissionOrchestrator',
  );
  // The resume is wired inside the ATT effect, chained on the ATT gate.
  const eff = attEffectSlice();
  assert.match(
    eff,
    /whenAttResolved\(\)\s*\.then\(\s*\(\)\s*=>\s*resumeInAppMessages\(\)\s*\)/,
    'the ATT effect must resume IAMs via whenAttResolved().then(() => resumeInAppMessages()) — so IAMs are never left permanently paused',
  );
});

// ── T4: ORDER — pause is at init BEFORE the SDK reports ready & before ATT resolves
test('T4: setPaused(true) is issued AFTER OneSignal.initialize() and BEFORE the ATT gate', () => {
  const fn = initFnSlice();
  const initIdx = fn.indexOf('OneSignal.initialize(ONESIGNAL_APP_ID)');
  const pauseIdx = fn.search(/OneSignal\.InAppMessages\.setPaused\(\s*true\s*\)/);
  assert.ok(initIdx !== -1, 'initializeOneSignal() must call OneSignal.initialize(ONESIGNAL_APP_ID)');
  assert.ok(pauseIdx !== -1, 'initializeOneSignal() must pause IAMs');
  assert.ok(
    initIdx < pauseIdx,
    'IAMs must be paused only AFTER OneSignal.initialize() — pausing before the SDK is up would no-op',
  );

  // The pause happens at INIT (boot), which is strictly before the ATT effect ever
  // resumes them: the resume lives behind whenAttResolved() in the auth-gated ATT
  // effect, which only runs after sign-in — long after init. Proven structurally:
  // pause is in initializeOneSignal(), resume is behind whenAttResolved() in index.
  assert.match(
    fn,
    /OneSignal\.InAppMessages\.setPaused\(\s*true\s*\)/,
    'pause must live in the init path (fires at boot, before ATT)',
  );
  const eff = attEffectSlice();
  assert.doesNotMatch(
    eff,
    /setPaused\(\s*true\s*\)/,
    'the ATT effect must NOT re-pause IAMs — it only resumes them after ATT',
  );
});
