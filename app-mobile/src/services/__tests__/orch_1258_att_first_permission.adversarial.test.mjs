#!/usr/bin/env node
/**
 * ORCH-1258 [Apple Guideline 2.1] — ADVERSARIAL: nothing may precede ATT, and ATT
 * must never double-prompt. Attacks the exact risks introduced by making ATT the
 * FIRST permission prompt in the CONSUMER app (app-mobile):
 *
 *   RISK A — push (notifications) sneaks in before ATT. requestPostTourPermissions()
 *            must still `await ensureAttRequested()` BEFORE requestPushPermission(),
 *            so notifications come AFTER ATT (not before).
 *   RISK B — location sneaks in before ATT. The onboarding location prompt must be
 *            downstream of `await whenAttResolved()` (asserted here + in the happy
 *            suite), and there must be exactly one OS location-prompt site.
 *   RISK C — ATT double-prompts. Three call sites now route through the ATT gate:
 *            the EARLY home-screen effect (now fires during onboarding), the
 *            onboarding onComplete (requestPostTourPermissions), and the returning
 *            user's home effect. All must funnel through the single-flight
 *            `_attRequestInFlight` guard so the OS dialog is issued at most once.
 *   RISK D — tracking starts before ATT. AppsFlyer (startAppsFlyer) must start only
 *            AFTER `await ensureAttRequested()`, and PostHog must await whenAttResolved
 *            — the ATT-before-tracking ordering Apple requires must be preserved.
 *
 * Harness note (same as the happy suite): app-mobile has no jest/RTL runner and the
 * import graph is not loadable under Node's native runner; this is a SOURCE-STRUCTURAL
 * suite. Comments are stripped before matching, so every assertion FAILS on a true
 * line-deletion / re-ordering of the policy it protects (fails-on-revert).
 *
 * Run: node --test src/services/__tests__/orch_1258_att_first_permission.adversarial.test.mjs
 *
 * FAILS-ON-REVERT map:
 *   - Move requestPushPermission() BEFORE `await ensureAttRequested()` in
 *     requestPostTourPermissions() → T1 fails (push before ATT).
 *   - Drop `await whenAttResolved()` before the OS location dialog in OnboardingFlow →
 *     T2 fails (location before ATT).
 *   - Add a second Location.requestForegroundPermissionsAsync() to OnboardingFlow that
 *     is not ATT-gated → T2 fails.
 *   - Drop the single-flight `_attRequestInFlight` short-circuit in ensureAttRequested
 *     → T3 fails (ATT can double-prompt across the 3 call sites).
 *   - Remove the attFiredRef single-flight guard from the home-screen ATT effect
 *     → T3 fails.
 *   - Move startAppsFlyer() before `await ensureAttRequested()` (post-tour path) or
 *     start AppsFlyer outside ensureAttRequested().then in the home effect → T4 fails.
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
const onboarding = stripComments(read('src/components/OnboardingFlow.tsx'));

// ── T1 (RISK A): push (notifications) runs strictly AFTER ATT ───────────────────
test('T1: requestPushPermission() runs AFTER `await ensureAttRequested()` (push after ATT)', () => {
  const fn = orch.slice(orch.indexOf('export async function requestPostTourPermissions'));
  const attIdx = fn.indexOf('await ensureAttRequested()');
  const pushIdx = fn.indexOf('requestPushPermission()');
  assert.ok(attIdx !== -1, 'requestPostTourPermissions must await ensureAttRequested()');
  assert.ok(pushIdx !== -1, 'requestPostTourPermissions must call requestPushPermission()');
  assert.ok(
    attIdx < pushIdx,
    'push (notifications) MUST be requested only AFTER the ATT decision resolves — never before',
  );
  // Push must also be behind the never-asked gate (unchanged by ORCH-1258).
  assert.match(
    fn,
    /if\s*\(\s*await\s+canRequestPushPermission\(\)\s*\)\s*\{\s*await\s+requestPushPermission\(\)/,
    'push must stay gated behind canRequestPushPermission() (consent-based, never re-prompt)',
  );
});

// ── T2 (RISK B): location cannot precede ATT — single ATT-gated prompt site ─────
test('T2: onboarding location prompt is ATT-gated and is the only OS location prompt', () => {
  const attIdx = onboarding.indexOf('await whenAttResolved()');
  const locIdx = onboarding.indexOf('await Location.requestForegroundPermissionsAsync()');
  assert.ok(attIdx !== -1, 'OnboardingFlow must await whenAttResolved() before the location dialog');
  assert.ok(locIdx !== -1, 'OnboardingFlow must call Location.requestForegroundPermissionsAsync()');
  assert.ok(attIdx < locIdx, 'ATT decision must be awaited BEFORE the OS location dialog');

  const sites = onboarding.match(/Location\.requestForegroundPermissionsAsync\(\)/g) || [];
  assert.equal(
    sites.length,
    1,
    'exactly one OS location-prompt site in onboarding — a second un-gated one could precede ATT',
  );
});

// ── T3 (RISK C): ATT is single-flight across ALL 3 call sites (never double-prompt)
test('T3: ATT is single-flight — early effect + onComplete + home effect never double-prompt', () => {
  // The orchestrator-level single-flight guard: the OS dialog fires at most once.
  assert.match(
    orch,
    /if\s*\(\s*_attRequestInFlight\s*\)\s*return\s+_attRequestInFlight/,
    'ensureAttRequested must short-circuit on the in-flight promise (single OS prompt)',
  );
  assert.match(
    orch,
    /_attRequestInFlight\s*=\s*\(async\s*\(\)\s*=>/,
    'the single-flight promise must be assigned exactly once',
  );

  // The home-screen effect keeps its own once-guard so the EARLY trigger fires once.
  const eff = indexTsx.slice(indexTsx.indexOf('const attFiredRef = useRef(false)'));
  assert.match(
    eff,
    /if\s*\(\s*attFiredRef\.current\s*\)\s*return[\s\S]*?attFiredRef\.current\s*=\s*true/,
    'the home-screen ATT effect must set attFiredRef=true so it fires at most once',
  );

  // Both other call sites route through the SAME gate (ensureAttRequested), so they
  // resolve immediately once the early effect has fired.
  assert.match(
    indexTsx,
    /requestPostTourPermissions\(\)/,
    'the onboarding onComplete must route permissions through requestPostTourPermissions()',
  );
  assert.match(
    orch,
    /export\s+async\s+function\s+requestPostTourPermissions[\s\S]*?await\s+ensureAttRequested\(\)/,
    'requestPostTourPermissions must funnel ATT through the same ensureAttRequested() gate',
  );
});

// ── T4 (RISK D): tracking (AppsFlyer + PostHog) starts only AFTER ATT ───────────
test('T4: AppsFlyer + PostHog start only AFTER ATT (ATT-before-tracking preserved)', () => {
  // Post-tour path: AppsFlyer after the awaited ATT.
  const fn = orch.slice(orch.indexOf('export async function requestPostTourPermissions'));
  const attIdx = fn.indexOf('await ensureAttRequested()');
  const afIdx = fn.indexOf('startAppsFlyer()');
  assert.ok(attIdx !== -1 && afIdx !== -1, 'post-tour path must await ATT then start AppsFlyer');
  assert.ok(attIdx < afIdx, 'AppsFlyer (IDFA transmission) must start only after ATT resolves');

  // Home-screen (early) path: AppsFlyer starts INSIDE ensureAttRequested().then(...).
  assert.match(
    indexTsx,
    /ensureAttRequested\(\)\s*\.then\(\s*\(\)\s*=>\s*\{[\s\S]*?startAppsFlyer\(\)/,
    'the early home-screen ATT effect must start AppsFlyer inside ensureAttRequested().then(...)',
  );

  // PostHog must gate on the same whenAttResolved() gate before it transmits.
  // (Guard: the gate export must exist and be the tracking-before-ATT barrier.)
  assert.match(
    orch,
    /export\s+function\s+whenAttResolved\(\)\s*:\s*Promise<void>\s*\{\s*return\s+_attResolved/,
    'whenAttResolved() must expose the ATT gate that tracking SDKs (PostHog) await',
  );
});
