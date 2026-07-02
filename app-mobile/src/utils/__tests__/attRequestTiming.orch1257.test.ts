/**
 * ORCH-1257 [Apple Guideline 2.1] — HAPPY-PATH: ATT request-timing gate
 * (consumer app-mobile).
 *
 * iOS silently DROPS an App Tracking Transparency request issued while the app is
 * not foreground-`active`. Build 35 was rejected because the reviewer "was unable
 * to locate the ATT permission request" on iPad — the request fired off-`active`
 * and never appeared. `shouldRequestAttNow` is the pure predicate the
 * permissionOrchestrator uses to decide request-NOW (active) vs defer-to-first-
 * active (any other state). Mirrors mingla-business (ORCH-1246).
 *
 * Run:
 *   node --experimental-strip-types --test \
 *     src/utils/__tests__/attRequestTiming.orch1257.test.ts
 *
 * FAILS-ON-REVERT: if the gate is weakened to `return true` (fire regardless of
 * AppState) the "inactive/background → DEFER" assertions fail; if it is inverted
 * the "active → request NOW" assertion fails. Either revert re-opens the exact
 * silent-drop bug Apple flagged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AppStateStatus } from 'react-native';

import { shouldRequestAttNow } from '../attRequestTiming.ts';

test('active → request the ATT prompt NOW', () => {
  assert.equal(shouldRequestAttNow('active'), true);
});

test('inactive → DEFER (wait for the first active transition)', () => {
  assert.equal(shouldRequestAttNow('inactive'), false);
});

test('background → DEFER (iOS would silently drop the prompt)', () => {
  assert.equal(shouldRequestAttNow('background'), false);
});

test('ONLY the literal "active" fires now — every other AppState defers', () => {
  const nonActive: AppStateStatus[] = [
    'inactive',
    'background',
    'unknown' as AppStateStatus,
    'extension' as AppStateStatus,
  ];
  for (const s of nonActive) {
    assert.equal(shouldRequestAttNow(s), false, `${s} must defer, not fire`);
  }
});
