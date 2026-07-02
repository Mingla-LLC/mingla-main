#!/usr/bin/env node
/**
 * ORCH-1258 [Apple Guideline 2.1] — HAPPY-PATH: ATT is the FIRST permission prompt
 * in the CONSUMER app (app-mobile). ATT fires right after sign-in (NOT gated behind
 * onboarding completion), and the onboarding LOCATION request awaits the ATT
 * decision, so the resulting order is ATT → location → notifications.
 *
 * Background: ORCH-1257 (build 36) made the ATT prompt fire reliably (AppState-gated,
 * single-flight) — but it was CLUSTERED with location + notifications, and location
 * came BEFORE ATT (location fired during onboarding; ATT only fired after onboarding
 * finished). ORCH-1258 makes ATT the clean, standalone FIRST prompt for the reviewer
 * and UX:
 *   (1) the home-screen ATT effect (app/index.tsx) fires ensureAttRequested() as soon
 *       as the user is authenticated — WITHOUT waiting for onboarding to complete
 *       (the `showOnboardingFlow || needsOnboarding` guard on that effect is gone), and
 *   (2) the onboarding location request (OnboardingFlow.tsx) awaits whenAttResolved()
 *       before calling Location.requestForegroundPermissionsAsync(), so location can
 *       NEVER precede the ATT decision.
 *
 * Harness note: app-mobile has NO jest/RTL runner and the permissionOrchestrator /
 * OnboardingFlow import graphs (react-native AppState, expo-tracking-transparency,
 * expo-location, oneSignal, AppsFlyer, RN components) are not loadable under Node's
 * native runner. Per the repo convention (orch_1257_att_appstate_early,
 * orch_1244_push_consent, orch_1187_posthog_native) this is a SOURCE-STRUCTURAL suite
 * that asserts the exact behavioral contract in source. Every assertion FAILS on a
 * TRUE LINE-DELETION / re-introduction of the policy it protects (fails-on-revert),
 * not merely on a comment-out (comments are stripped before matching).
 *
 * Run: node --test src/services/__tests__/orch_1258_att_first_permission.happy.test.mjs
 *
 * FAILS-ON-REVERT map:
 *   - Re-add the `if (showOnboardingFlow || needsOnboarding) return;` guard to the ATT
 *     effect in app/index.tsx (the old "wait for onboarding to finish" behavior that
 *     let location precede ATT) → T1 fails.
 *   - Re-add showOnboardingFlow / needsOnboarding to that effect's dependency array
 *     (proxy for the same regression) → T1 fails.
 *   - Drop `await whenAttResolved()` before Location.requestForegroundPermissionsAsync()
 *     in OnboardingFlow.tsx (location no longer waits for ATT) → T2/T3 fail.
 *   - Remove the whenAttResolved import from OnboardingFlow → T2 fails.
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

const indexTsx = stripComments(read('app/index.tsx'));
const onboarding = stripComments(read('src/components/OnboardingFlow.tsx'));

// Isolate the home-screen ATT effect body (from the attFiredRef declaration through
// its dependency array) so assertions target the ATT trigger, not other effects.
function attEffectSlice() {
  const start = indexTsx.indexOf('const attFiredRef = useRef(false)');
  assert.ok(start !== -1, 'the ATT effect (attFiredRef) must exist in app/index.tsx');
  // End at the dependency array that closes the effect: `}, [ ... user?.id ... ]);`
  const depIdx = indexTsx.indexOf('[isAuthenticated, isLoadingAuth, user?.id]', start);
  assert.ok(depIdx !== -1, 'the ATT effect must have an [isAuthenticated, isLoadingAuth, user?.id] dep array');
  const end = indexTsx.indexOf(']', depIdx) + 1;
  return indexTsx.slice(start, end);
}

// ── T1: ATT fires EARLY — the effect is NOT gated behind onboarding completion ──
test('T1: ATT effect fires on auth WITHOUT waiting for onboarding to finish', () => {
  const eff = attEffectSlice();

  // It still fires ensureAttRequested() (the trigger is intact).
  assert.match(
    eff,
    /ensureAttRequested\(\)/,
    'the ATT effect must call ensureAttRequested()',
  );

  // It gates on auth (single-flight ref + authenticated user), which is correct.
  assert.match(eff, /if\s*\(\s*attFiredRef\.current\s*\)\s*return/, 'ATT effect must be single-flight via attFiredRef');
  assert.match(eff, /!isAuthenticated\s*\|\|\s*!user\?\.id/, 'ATT effect must require an authenticated user');

  // CRITICAL (the ORCH-1258 fix): it must NOT bail out while onboarding is showing.
  // The old code had `if (showOnboardingFlow || needsOnboarding) return;` which made
  // ATT wait until AFTER onboarding, letting the onboarding location prompt precede it.
  assert.doesNotMatch(
    eff,
    /if\s*\(\s*showOnboardingFlow\s*\|\|\s*needsOnboarding\s*\)\s*return/,
    'ATT effect must NOT bail while onboarding is showing — it must fire ATT FIRST, before onboarding location',
  );
  // The effect must also not re-depend on onboarding state (proxy for the same regression).
  assert.doesNotMatch(
    eff,
    /showOnboardingFlow\s*,\s*needsOnboarding/,
    'ATT effect dep array must not include onboarding state (would re-gate it behind onboarding)',
  );
});

// ── T2: onboarding location request awaits whenAttResolved() (ATT precedes location)
test('T2: OnboardingFlow awaits whenAttResolved() before the OS location prompt', () => {
  assert.match(
    onboarding,
    /import\s*\{[^}]*\bwhenAttResolved\b[^}]*\}\s*from\s*['"][^'"]*permissionOrchestrator['"]/,
    'OnboardingFlow must import whenAttResolved from permissionOrchestrator',
  );
  assert.match(
    onboarding,
    /await\s+whenAttResolved\(\)/,
    'OnboardingFlow must await whenAttResolved() (block the location prompt on the ATT decision)',
  );
});

// ── T3: the await is ORDERED strictly BEFORE the OS location dialog ─────────────
test('T3: whenAttResolved() is awaited BEFORE Location.requestForegroundPermissionsAsync()', () => {
  const attIdx = onboarding.indexOf('await whenAttResolved()');
  const locIdx = onboarding.indexOf('await Location.requestForegroundPermissionsAsync()');
  assert.ok(attIdx !== -1, 'whenAttResolved() must be awaited in OnboardingFlow');
  assert.ok(locIdx !== -1, 'Location.requestForegroundPermissionsAsync() must exist in OnboardingFlow');
  assert.ok(
    attIdx < locIdx,
    'the ATT decision (whenAttResolved) MUST be awaited BEFORE the OS location dialog is shown',
  );

  // There must be exactly ONE OS location-prompt site in onboarding, and it is the
  // gated one — no un-gated location prompt can slip in ahead of ATT.
  const promptSites = onboarding.match(/Location\.requestForegroundPermissionsAsync\(\)/g) || [];
  assert.equal(
    promptSites.length,
    1,
    'OnboardingFlow must have exactly one OS location prompt site (the ATT-gated one)',
  );
});
