#!/usr/bin/env node
/**
 * ORCH-1244 [Apple Guideline 4.5.4] — push must be optional + consent-based.
 *
 * Harness note: app-mobile has no jest/RTL; the RN + extensionless-TS import
 * graph (oneSignalService → react-native-onesignal, ../utils/logger →
 * breadcrumbs, the `__DEV__` global) is not loadable under Node's native runner.
 * Per the repo convention (orch-0751, orch-1171, orch-1190) this is a
 * SOURCE-STRUCTURAL suite that asserts the exact behavioral contract in source.
 * The pure Apple-Pay builder (Fix 2) is separately tested as runnable logic in
 * orch_1244_applepay_cartitem.test.ts.
 *
 * Contract proven here:
 *   T1  requestPushPermission() calls OneSignal.Notifications.requestPermission
 *       with `false` (fallbackToSettings OFF) — NOT `true` (the Settings-nag).
 *   T2  oneSignalService exports `canRequestPushPermission` (the import-isolation
 *       wrapper so OneSignal stays imported ONLY in oneSignalService).
 *   T3  canRequestPushPermission wraps OneSignal.Notifications.canRequestPermission().
 *   T4  permissionOrchestrator imports canRequestPushPermission from
 *       oneSignalService (NOT OneSignal directly — import-isolation invariant).
 *   T5  permissionOrchestrator GATES the push prompt behind
 *       canRequestPushPermission() — requestPushPermission is only called inside
 *       an `if (await canRequestPushPermission())`.
 *   T6  permissionOrchestrator does NOT import react-native-onesignal directly.
 *   T7  oneSignalService is the ONLY src module that imports react-native-onesignal.
 *
 * Run: node --test src/services/__tests__/orch_1244_push_consent.test.mjs
 *
 * FAILS-ON-REVERT: flip `false`→`true` at the requestPermission call → T1 fails.
 * Delete the canRequestPushPermission helper → T2/T3 fail. Remove the orchestrator
 * gate → T5 fails. Import OneSignal into permissionOrchestrator → T4/T6 fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(MOBILE_ROOT, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const svc = read('src/services/oneSignalService.ts');
const orch = read('src/services/permissionOrchestrator.ts');
const svcCode = stripComments(svc);
const orchCode = stripComments(orch);

test('T1: requestPushPermission passes fallbackToSettings = false (not the Settings-nag `true`)', () => {
  assert.match(
    svcCode,
    /OneSignal\.Notifications\.requestPermission\(\s*false\s*\)/,
    'requestPermission(false) required by 4.5.4',
  );
  assert.doesNotMatch(
    svcCode,
    /OneSignal\.Notifications\.requestPermission\(\s*true\s*\)/,
    'requestPermission(true) re-introduces the Settings-nag — forbidden',
  );
});

test('T2: oneSignalService exports canRequestPushPermission', () => {
  assert.match(
    svcCode,
    /export\s+async\s+function\s+canRequestPushPermission\s*\(\s*\)\s*:\s*Promise<boolean>/,
    'the import-isolation wrapper must be exported',
  );
});

test('T3: canRequestPushPermission wraps OneSignal.Notifications.canRequestPermission()', () => {
  const idx = svcCode.indexOf('function canRequestPushPermission');
  assert.ok(idx !== -1);
  const body = svcCode.slice(idx, idx + 400);
  assert.match(
    body,
    /OneSignal\.Notifications\.canRequestPermission\(\s*\)/,
    'helper must delegate to the SDK canRequestPermission()',
  );
});

test('T4: orchestrator imports canRequestPushPermission from oneSignalService', () => {
  assert.match(
    orchCode,
    /import\s*\{[^}]*\bcanRequestPushPermission\b[^}]*\}\s*from\s*['"]\.\/oneSignalService['"]/,
    'gate helper must come from oneSignalService (import isolation)',
  );
});

test('T5: orchestrator gates requestPushPermission behind canRequestPushPermission()', () => {
  // The push prompt must be inside an `if (await canRequestPushPermission())`.
  assert.match(
    orchCode,
    /if\s*\(\s*await\s+canRequestPushPermission\(\s*\)\s*\)\s*\{[\s\S]*?await\s+requestPushPermission\(\s*\)/,
    'requestPushPermission must only be called when the OS can still be asked',
  );
});

test('T6: orchestrator does NOT import OneSignal directly (import isolation)', () => {
  assert.doesNotMatch(
    orch,
    /from\s*['"]react-native-onesignal['"]/,
    'permissionOrchestrator must never import react-native-onesignal',
  );
});

test('T7: oneSignalService is the ONLY src module importing react-native-onesignal', () => {
  const out = execSync(
    `grep -rl "react-native-onesignal" src --include="*.ts" --include="*.tsx" || true`,
    { cwd: MOBILE_ROOT, encoding: 'utf8' },
  );
  const files = out.split('\n').map((l) => l.trim()).filter(Boolean)
    // test files legitimately reference the module name in strings/mocks.
    .filter((f) => !f.includes('__tests__'));
  assert.deepEqual(
    files.sort(),
    ['src/services/oneSignalService.ts'],
    `only oneSignalService may import OneSignal; found: ${files.join(', ')}`,
  );
});
