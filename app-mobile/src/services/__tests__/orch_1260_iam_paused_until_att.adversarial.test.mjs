#!/usr/bin/env node
/**
 * ORCH-1260 [Apple Guideline 2.1 / launch UX] — ADVERSARIAL: attacks the exact
 * risks of pausing OneSignal In-App Messages (IAMs) at launch to de-cluster them
 * from the iOS ATT prompt in the CONSUMER app (app-mobile).
 *
 *   RISK A — IAMs are left PERMANENTLY paused (a legitimate-message regression).
 *            The resume must be reachable on BOTH platforms: it is chained on
 *            whenAttResolved(), and the ATT gate (_attResolved) resolves on BOTH
 *            the non-iOS path (immediately at module init — ATT is a no-op) AND the
 *            iOS path (after ensureAttRequested opens the gate whether the prompt
 *            succeeded OR threw — fail-open). So resume ALWAYS runs.
 *   RISK B — IAMs are paused BEFORE the SDK is up (setPaused before initialize),
 *            which no-ops and leaves the IAM free to render. The pause must be
 *            issued strictly AFTER OneSignal.initialize(...).
 *   RISK C — pause/resume throws and breaks init or the ATT effect. Both the pause
 *            (at init) and resumeInAppMessages() must be wrapped in try/catch and
 *            self-guarded (resume on _initialized) so they NEVER throw.
 *   RISK D — IAMs are paused/resumed more than needed (churn / double-toggle).
 *            Exactly ONE setPaused(true) and ONE setPaused(false) in the service,
 *            and the resume is wired exactly once behind the ATT effect's
 *            single-flight attFiredRef guard.
 *
 * Harness note (same as the happy suite): app-mobile has no jest/RTL runner and the
 * import graph is not loadable under Node's native runner; this is a SOURCE-STRUCTURAL
 * suite. Comments are stripped before matching, so every assertion FAILS on a true
 * line-deletion / re-ordering of the policy it protects (fails-on-revert).
 *
 * Run: node --test src/services/__tests__/orch_1260_iam_paused_until_att.adversarial.test.mjs
 *
 * FAILS-ON-REVERT map:
 *   - Remove the non-iOS immediate `_attResolve()` OR the iOS gate-open in
 *     ensureAttRequested from permissionOrchestrator (resume could never run) → T1 fails.
 *   - Remove `whenAttResolved().then(() => resumeInAppMessages())` from the ATT effect → T1 fails.
 *   - Move setPaused(true) before OneSignal.initialize(...) → T2 fails.
 *   - Drop the try/catch around the init pause, or the `if (!_initialized) return` /
 *     try/catch in resumeInAppMessages → T3 fails.
 *   - Add a second setPaused(true)/setPaused(false), or wire a second resume → T4 fails.
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
const orch = stripComments(read('src/services/permissionOrchestrator.ts'));
const indexTsx = stripComments(read('app/index.tsx'));

function initFnSlice() {
  const start = oneSignal.indexOf('export function initializeOneSignal');
  const end = oneSignal.indexOf('export function isOneSignalReady');
  assert.ok(start !== -1 && end !== -1, 'initializeOneSignal()/isOneSignalReady() must exist');
  return oneSignal.slice(start, end);
}
function resumeFnSlice() {
  const start = oneSignal.indexOf('export function resumeInAppMessages');
  assert.ok(start !== -1, 'resumeInAppMessages() must exist');
  return oneSignal.slice(start, oneSignal.indexOf('\n}', start) + 2);
}
function attEffectSlice() {
  const start = indexTsx.indexOf('const attFiredRef = useRef(false)');
  const depIdx = indexTsx.indexOf('[isAuthenticated, isLoadingAuth, user?.id]', start);
  assert.ok(start !== -1 && depIdx !== -1, 'the ATT effect must exist with its dep array');
  return indexTsx.slice(start, indexTsx.indexOf(']', depIdx) + 1);
}

// ── T1 (RISK A): IAMs are NEVER left permanently paused — resume runs on BOTH paths
test('T1: resume is reachable on iOS (after ATT) AND non-iOS (immediate) — never permanently paused', () => {
  // Resume is chained on the ATT gate.
  assert.match(
    attEffectSlice(),
    /whenAttResolved\(\)\s*\.then\(\s*\(\)\s*=>\s*resumeInAppMessages\(\)\s*\)/,
    'resume must be chained on whenAttResolved() so it runs once the ATT decision resolves',
  );

  // Non-iOS: the ATT gate opens IMMEDIATELY at module init (ATT is a no-op), so
  // whenAttResolved() is already resolved → resume runs right away, no delay.
  assert.match(
    orch,
    /if\s*\(\s*Platform\.OS\s*!==\s*'ios'\s*\)\s*\{[\s\S]*?_attResolve\(\)/,
    'non-iOS must resolve the ATT gate immediately at init (so IAMs resume right away on Android/web)',
  );

  // iOS: ensureAttRequested() OPENS the gate whether the prompt succeeded or threw
  // (fail-open) — so on iOS the gate always resolves and resume always runs.
  const ensureFn = orch.slice(
    orch.indexOf('export function ensureAttRequested'),
    orch.indexOf('export function whenAttResolved'),
  );
  assert.match(
    ensureFn,
    /if\s*\(\s*_attResolve\s*\)\s*\{\s*_attResolve\(\)/,
    'ensureAttRequested must open the ATT gate on iOS (fail-open) so resume can never be blocked forever',
  );

  // whenAttResolved() returns that same gate.
  assert.match(
    orch,
    /export\s+function\s+whenAttResolved\(\)\s*:\s*Promise<void>\s*\{\s*return\s+_attResolved/,
    'whenAttResolved() must return the ATT gate that resume awaits',
  );
});

// ── T2 (RISK B): the pause is issued AFTER the SDK is up (never before initialize) ─
test('T2: setPaused(true) is issued strictly AFTER OneSignal.initialize()', () => {
  const fn = initFnSlice();
  const initIdx = fn.indexOf('OneSignal.initialize(ONESIGNAL_APP_ID)');
  const pauseIdx = fn.search(/OneSignal\.InAppMessages\.setPaused\(\s*true\s*\)/);
  assert.ok(initIdx !== -1 && pauseIdx !== -1, 'init + pause must both be present');
  assert.ok(
    initIdx < pauseIdx,
    'pausing IAMs before OneSignal.initialize() would no-op — pause MUST come after init',
  );
});

// ── T3 (RISK C): pause + resume never throw (try/catch + self-guard) ─────────────
test('T3: pause (init) and resumeInAppMessages() are try/catch-wrapped and self-guarded', () => {
  // The init pause is wrapped in its own try so a pause failure never breaks init.
  assert.match(
    initFnSlice(),
    /try\s*\{\s*OneSignal\.InAppMessages\.setPaused\(\s*true\s*\)/,
    'the init pause must be wrapped in try/catch so an IAM-pause failure never disrupts initialization',
  );
  // resumeInAppMessages self-guards on _initialized and wraps setPaused in try/catch.
  const resume = resumeFnSlice();
  assert.match(
    resume,
    /if\s*\(\s*!_initialized\s*\)\s*return/,
    'resumeInAppMessages() must no-op if OneSignal was never initialized (self-guard)',
  );
  assert.match(
    resume,
    /try\s*\{\s*OneSignal\.InAppMessages\.setPaused\(\s*false\s*\)[\s\S]*?\}\s*catch/,
    'resumeInAppMessages() must wrap setPaused(false) in try/catch (never throw)',
  );
});

// ── T4 (RISK D): IAMs are toggled exactly once each — no churn / double-toggle ───
test('T4: exactly one setPaused(true) + one setPaused(false); resume wired once (single-flight)', () => {
  const pauses = oneSignal.match(/OneSignal\.InAppMessages\.setPaused\(\s*true\s*\)/g) || [];
  const resumes = oneSignal.match(/OneSignal\.InAppMessages\.setPaused\(\s*false\s*\)/g) || [];
  assert.equal(pauses.length, 1, 'IAMs must be paused exactly once (at init) — no extra pause churn');
  assert.equal(resumes.length, 1, 'IAMs must be resumed exactly once (in resumeInAppMessages) — no extra toggling');

  // The resume is wired exactly once, and behind the effect's single-flight guard so
  // it can only run one time per process.
  const eff = attEffectSlice();
  const resumeWires = eff.match(/resumeInAppMessages\(\)/g) || [];
  assert.equal(resumeWires.length, 1, 'resume must be wired exactly once in the ATT effect');
  assert.match(
    eff,
    /if\s*\(\s*attFiredRef\.current\s*\)\s*return[\s\S]*?attFiredRef\.current\s*=\s*true/,
    'the ATT effect must be single-flight (attFiredRef) so resume is scheduled at most once',
  );
});
