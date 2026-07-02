#!/usr/bin/env node
/**
 * ORCH-1257 [Apple Guideline 2.1] — ADVERSARIAL: ATT fires EARLY (post-onboarding,
 * pre-coach-tour) + is AppState-`active` gated + AppsFlyer still starts only AFTER
 * ATT + the whole sequence is idempotent (single-flight).
 *
 * Apple rejected the CONSUMER app (build 35, iPadOS 26.4.2) — the reviewer "was
 * unable to locate the ATT permission request". Two proven root causes:
 *   (1) the prompt fired only AFTER the 11-step coach-mark tour (1–5 min in), and
 *   (2) it was NOT gated on AppState === 'active', so iOS silently DROPPED it when
 *       the iPad was briefly backgrounded during onboarding.
 *
 * Harness note: app-mobile has NO jest/RTL runner and the permissionOrchestrator
 * import graph (react-native AppState, expo-tracking-transparency, oneSignal,
 * AppsFlyer) is not loadable under Node's native runner. Per the repo convention
 * (orch_1244_push_consent, orch_1187_posthog_native) this is a SOURCE-STRUCTURAL
 * suite that asserts the exact behavioral contract in source. Every assertion
 * FAILS on a TRUE LINE-DELETION of the policy it protects (fails-on-revert), not
 * merely on a comment-out. The pure predicate is separately tested as runnable
 * logic in src/utils/__tests__/attRequestTiming.orch1257.test.ts.
 *
 * Run: node --test src/services/__tests__/orch_1257_att_appstate_early.adversarial.test.mjs
 *
 * FAILS-ON-REVERT map:
 *   - Remove the AppState/shouldRequestAttNow gate in permissionOrchestrator → T1/T2 fail.
 *   - Move startAppsFlyer() BEFORE `await ensureAttRequested()` → T3 fails.
 *   - Drop the single-flight `_attRequestInFlight` guard → T4 fails.
 *   - Remove the requestPostTourPermissions() call from the onboarding onComplete
 *     callback in app/index.tsx (the "fires early" guarantee) → T5 fails.
 *   - Re-add requestPostTourPermissions() to the coach-mark completion/skip paths
 *     (the "1–5 min late" bug) → T6 fails.
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

const orch = stripComments(read('src/services/permissionOrchestrator.ts'));
const indexTsx = stripComments(read('app/index.tsx'));
const coach = stripComments(read('src/contexts/CoachMarkContext.tsx'));

// ── T1: AppState-active gate is wired into the ATT request path ────────────────
test('T1: permissionOrchestrator gates ATT on AppState via shouldRequestAttNow', () => {
  assert.match(
    orch,
    /import\s*\{\s*AppState\s*\}\s*from\s*['"]react-native['"]/,
    'AppState must be imported from react-native (the active-state source)',
  );
  assert.match(
    orch,
    /import\s*\{\s*shouldRequestAttNow\s*\}\s*from\s*['"][^'"]*attRequestTiming['"]/,
    'shouldRequestAttNow (the active-state predicate) must be imported',
  );
  assert.match(
    orch,
    /shouldRequestAttNow\(\s*AppState\.currentState\s*\)/,
    'ATT must branch on shouldRequestAttNow(AppState.currentState) — request now only if active',
  );
});

// ── T2: when NOT active, it defers to the first `active` transition ────────────
test('T2: non-active defers to first active AppState transition (one-shot listener)', () => {
  assert.match(
    orch,
    /AppState\.addEventListener\(\s*['"]change['"]/,
    'must register an AppState change listener to wait for active',
  );
  // The listener must be a one-shot: it removes itself once active.
  assert.match(
    orch,
    /sub\.remove\(\)/,
    'the deferred listener must remove itself (one-shot) once active',
  );
  assert.match(
    orch,
    /addEventListener\(\s*['"]change['"]\s*,\s*\(next\)\s*=>\s*\{[\s\S]*?shouldRequestAttNow\(\s*next\s*\)/,
    'the deferred listener must re-check shouldRequestAttNow(next) before firing',
  );
});

// ── T3: ATT is AWAITED before AppsFlyer starts (ordering) ──────────────────────
test('T3: startAppsFlyer() runs AFTER `await ensureAttRequested()` (never before)', () => {
  const fn = orch.slice(
    orch.indexOf('export async function requestPostTourPermissions'),
  );
  const attIdx = fn.indexOf('await ensureAttRequested()');
  const afIdx = fn.indexOf('startAppsFlyer()');
  assert.ok(attIdx !== -1, 'requestPostTourPermissions must await ensureAttRequested()');
  assert.ok(afIdx !== -1, 'requestPostTourPermissions must call startAppsFlyer()');
  assert.ok(
    attIdx < afIdx,
    'AppsFlyer (IDFA transmission) MUST start only after the ATT decision resolves',
  );

  // The home-screen effect must also order AppsFlyer strictly after ATT resolves.
  assert.match(
    indexTsx,
    /ensureAttRequested\(\)\s*\.then\(\s*\(\)\s*=>\s*\{[\s\S]*?startAppsFlyer\(\)/,
    'the home-screen ATT effect must start AppsFlyer inside ensureAttRequested().then(...)',
  );
});

// ── T4: idempotency — ATT is single-flight (fires at most once per process) ────
test('T4: ensureAttRequested is single-flight (idempotent) via _attRequestInFlight', () => {
  assert.match(
    orch,
    /if\s*\(\s*_attRequestInFlight\s*\)\s*return\s+_attRequestInFlight/,
    'ensureAttRequested must short-circuit on the in-flight promise — never re-run ATT',
  );
  assert.match(
    orch,
    /_attRequestInFlight\s*=\s*\(async\s*\(\)\s*=>/,
    'the single-flight promise must be assigned exactly once',
  );
});

// ── T5: ATT/permissions fire EARLY — in the onboarding onComplete callback ─────
test('T5: onboarding onComplete fires requestPostTourPermissions (before the coach tour)', () => {
  const ocStart = indexTsx.indexOf('onComplete={() =>');
  assert.ok(ocStart !== -1, 'the OnboardingLoader onComplete callback must exist');
  // Scope to the callback body: from onComplete to the first refreshAllSessions
  // AFTER it (the last statement in that callback).
  const ocEnd =
    indexTsx.indexOf('refreshAllSessions({ showLoading: true });', ocStart) + 60;
  const onComplete = indexTsx.slice(ocStart, ocEnd);
  assert.match(
    onComplete,
    /requestPostTourPermissions\(\)/,
    'onboarding onComplete MUST fire requestPostTourPermissions() so ATT appears within seconds',
  );
  assert.match(
    indexTsx,
    /import\s*\{[^}]*requestPostTourPermissions[^}]*\}\s*from\s*['"][^'"]*permissionOrchestrator['"]/,
    'app/index.tsx must import requestPostTourPermissions',
  );
});

// ── T6: coach-mark completion/skip no longer fires permissions (the late bug) ──
test('T6: CoachMarkContext no longer calls requestPostTourPermissions (removed late trigger)', () => {
  assert.doesNotMatch(
    coach,
    /requestPostTourPermissions/,
    'the coach-mark tour must NOT fire permissions — that put the prompt 1–5 min late',
  );
  assert.doesNotMatch(
    read('src/contexts/CoachMarkContext.tsx'),
    /import\s*\{\s*requestPostTourPermissions\s*\}/,
    'the now-unused permissionOrchestrator import must be removed from CoachMarkContext',
  );
});
