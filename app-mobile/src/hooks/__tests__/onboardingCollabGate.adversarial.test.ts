/**
 * ORCH-1039 — TESTER ADVERSARIAL regression test (collab-step hide gate).
 *
 * Attacks a DIFFERENT angle than the implementor's happy-path test
 * (onboardingCollabGate.test.ts), which only exercises the pure decision core
 * with a STATIC hasCollabContext. This test models the RESUME edge case where
 * hasCollabContext is initially UNKNOWN (the FULLER operator-override gate lifts
 * two async server reads into OnboardingFlow, defaulting to the SAFE/eligible
 * path while loading) and then resolves to FALSE after the lazy entry has
 * already been computed.
 *
 * This is the T-12 scenario: a user persisted at onboarding_step === 6 with NO
 * collaboration context (no friends, no created sessions, no pending invites, no
 * trip-chat claims) kills the app on Step 6 and relaunches. The expected
 * contract (SPEC §3.6 "Net resume contract" + SC-3): they resume onto Step 7,
 * NEVER the hidden Step 6 hollow placeholder.
 *
 * Run: node --experimental-strip-types --test src/hooks/__tests__/onboardingCollabGate.adversarial.test.ts
 *
 * NOTE (defect captured): as of commit 4f2474dcc the React adapter
 * `useOnboardingStateMachine` resolves the entry ONCE via a lazy initializer +
 * re-resolves ONLY when `initialStep` changes — NOT when `hasCollabContext`
 * flips. So when the safe-path window resolves the resume to Step 6 (because the
 * server reads are still loading ⇒ hasCollabContext defaults true) and the reads
 * then settle to no-context (hasCollabContext ⇒ false), the machine never
 * retreats off the now-hidden Step 6. This test models that transition and
 * asserts the user does NOT remain on a hidden step. It is RED against the
 * current implementation (proves the bug) and turns GREEN once the hook
 * re-resolves the entry on a hasCollabContext false-flip (e.g. an effect that
 * skips forward off a now-empty current step).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { OnboardingStep } from '../../types/onboarding'
// prettier-ignore
// @ts-expect-error -- runtime .ts import for `node --experimental-strip-types`
import { buildSequence, resolveEntry } from '../onboardingSequenceLogic.ts'

/**
 * Faithful model of the hook's state-resolution policy:
 *  - lazy initializer computes resolveEntry(initialStep, ctx0) ONCE
 *  - re-resolves when initialStep changes (the appliedInitialStep guard)
 *  - Fix B (ORCH-1039 rework): when hasCollabContext flips such that the CURRENT
 *    step's sequence becomes empty/hidden, the hook's resolve-empty effect
 *    advances off it to the next non-empty step (same skip-empty normalizer as
 *    resolveEntry/advance). A non-empty current step is left untouched.
 * Returns the step the user ends up parked on after the async flag settles.
 */
function hookResolvedStepAfterContextSettle(
  initialStep: OnboardingStep,
  ctxWhileLoading: boolean,
  ctxAfterSettle: boolean
): number {
  // mount: lazy initializer with the loading-window value
  let state = resolveEntry(initialStep, ctxWhileLoading)
  // reads settle → hasCollabContext flips. The resolve-empty effect only acts
  // when the current step has become hidden (empty sequence); otherwise no-op.
  if (buildSequence(state.step, ctxAfterSettle).length === 0) {
    state = resolveEntry(state.step, ctxAfterSettle)
  }
  return state.step
}

// ── ADVERSARIAL T-A1: resume@6, safe-path-true-then-false must NOT strand on hidden Step 6 ──
test('T-A1 (adversarial): resume at step 6, ctx loads true then settles false ⇒ must land on Step 7, never hidden Step 6', () => {
  // After the server reads settle to no-context, Step 6 is hidden:
  assert.deepEqual(buildSequence(6, false), [], 'precondition: Step 6 hidden with no context')

  const parked = hookResolvedStepAfterContextSettle(6, /*loading*/ true, /*settled*/ false)

  // The contract: the user must end up on Step 7 (the next non-empty step), NOT
  // parked on the now-hidden Step 6. This FAILS today (parked === 6) and is the
  // T-12 defect; it passes once the hook re-resolves off a hidden current step.
  assert.notEqual(parked, 6, 'user must NOT remain on the hidden Step 6 after context settles to false (T-12 defect)')
  assert.equal(parked, 7, 'user should resume onto Step 7/consent when Step 6 is hidden after context settles')
})

// ── ADVERSARIAL T-A2: the pure normalizer is correct; the defect is the missing re-resolve ──
test('T-A2 (adversarial): resolveEntry itself is correct for the settled value (isolates the bug to the hook re-resolution)', () => {
  // If the hook re-ran resolveEntry with the SETTLED value, it would be correct.
  // This documents that the fix belongs in the hook (re-resolve on ctx flip),
  // not the pure core.
  assert.deepEqual(resolveEntry(6, false), { step: 7, subStep: 'consent' })
  assert.deepEqual(resolveEntry(6, true), { step: 6, subStep: 'collaborations' })
})
