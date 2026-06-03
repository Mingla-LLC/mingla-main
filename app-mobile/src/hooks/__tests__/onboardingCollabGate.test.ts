/**
 * ORCH-1039 §8 — implementor happy-path regression test (collab-step hide gate).
 *
 * Runs under Node's built-in test runner with type-stripping (no jest in this app):
 *   node --experimental-strip-types --test src/hooks/__tests__/onboardingCollabGate.test.ts
 * (wrapper: `npm run test:orch-1039` → scripts/ci/orch-1039-collab-gate-check.mjs)
 *
 * Targets the dependency-free sequencing core `onboardingSequenceLogic.ts` (the
 * React hook `useOnboardingStateMachine` is a thin adapter over it). Asserts:
 *  - buildSequence omits Step 6 when hasCollabContext is false; includes it when true
 *  - advance (goNext core) skips the empty Step 6 (5 → 7) with no context,
 *    and does NOT skip (5 → 6) with context
 *  - retreat (goBack core) skips the empty Step 6 (7 → 5) with no context
 *  - resolveEntry (resume normalizer) lands on Step 7 for a Step-6 resume with no
 *    context, and on Step 6 with context
 *  - computeSegmentFill is a finite number in (0,1] at every reachable state across
 *    a full walk, and Step 6 never becomes the current step with no context
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// The explicit .ts extension is REQUIRED by Node's strip-types runtime (this app
// has no jest); tsc's allowImportingTsExtensions is off repo-wide, so this one
// runtime-only test import is suppressed. The module under test is fully typed.
// prettier-ignore
// @ts-expect-error -- runtime .ts import for `node --experimental-strip-types`
import { buildSequence, advance, retreat, resolveEntry, computeSegmentFill } from '../onboardingSequenceLogic.ts'

// ── T-04: getSequence omits Step 6 when no context; includes it with context ──
test('T-04: buildSequence(6) is [] without context, [collaborations] with context', () => {
  assert.deepEqual(buildSequence(6, false), [])
  assert.deepEqual(buildSequence(6, true), ['collaborations'])
  // every other step is unconditional
  assert.deepEqual(buildSequence(5, false), ['friends_and_pairing'])
  assert.deepEqual(buildSequence(5, true), ['friends_and_pairing'])
  assert.deepEqual(buildSequence(7, false), ['consent', 'getting_experiences'])
})

// ── T-05: advance skips empty Step 6 (5 → 7) with no context ──
test('T-05: advance from Step5/friends_and_pairing skips hidden Step 6 → Step7/consent', () => {
  const r = advance({ step: 5, subStep: 'friends_and_pairing' }, false)
  assert.equal(r.kind, 'move')
  if (r.kind !== 'move') return
  assert.deepEqual(r.next, { step: 7, subStep: 'consent' })
})

// ── T-05b: advance does NOT skip when context exists (5 → 6) ──
test('T-05b: advance from Step5 lands on Step6/collaborations when context exists', () => {
  const r = advance({ step: 5, subStep: 'friends_and_pairing' }, true)
  assert.equal(r.kind, 'move')
  if (r.kind !== 'move') return
  assert.deepEqual(r.next, { step: 6, subStep: 'collaborations' })
})

// ── T-06: retreat skips empty Step 6 (7 → 5) with no context ──
test('T-06: retreat from Step7/consent skips hidden Step 6 → Step5/friends_and_pairing', () => {
  const r = retreat({ step: 7, subStep: 'consent' }, false)
  assert.equal(r.kind, 'move')
  if (r.kind !== 'move') return
  assert.deepEqual(r.next, { step: 5, subStep: 'friends_and_pairing' })
})

test('T-06b: retreat from Step7/consent lands on Step6/collaborations when context exists', () => {
  const r = retreat({ step: 7, subStep: 'consent' }, true)
  assert.equal(r.kind, 'move')
  if (r.kind !== 'move') return
  assert.deepEqual(r.next, { step: 6, subStep: 'collaborations' })
})

// ── T-07: progress never NaN across the full skip walk; Step 6 never current ──
test('T-07: computeSegmentFill is finite (0,1] across a full no-context walk; Step 6 never current', () => {
  // Walk from Step1/language to launch via advance, no collab context.
  let state: { step: number; subStep: string } = { step: 1, subStep: 'language' }
  const visitedSteps = new Set<number>()
  for (let i = 0; i < 100; i++) {
    visitedSteps.add(state.step)
    const fill = computeSegmentFill(state as any, false)
    assert.ok(Number.isFinite(fill), `segmentFill must be finite, got ${fill} at ${state.step}/${state.subStep}`)
    assert.ok(fill > 0 && fill <= 1, `segmentFill must be in (0,1], got ${fill} at ${state.step}/${state.subStep}`)
    const r = advance(state as any, false)
    if (r.kind === 'launch') break
    if (r.kind === 'stay') throw new Error(`unexpected stay at ${state.step}/${state.subStep}`)
    state = r.next as any
  }
  assert.ok(!visitedSteps.has(6), 'Step 6 must never be the current step without collab context')
  // sanity: we actually reached step 7
  assert.ok(visitedSteps.has(7), 'walk should have reached Step 7')
})

// ── T-08: resolveEntry resume normalizer skips hidden Step 6 ──
test('T-08: resolveEntry(6) → Step7/consent without context, Step6/collaborations with context', () => {
  assert.deepEqual(resolveEntry(6, false), { step: 7, subStep: 'consent' })
  assert.deepEqual(resolveEntry(6, true), { step: 6, subStep: 'collaborations' })
  // an entry at a normal step is unchanged regardless of context
  assert.deepEqual(resolveEntry(5, false), { step: 5, subStep: 'friends_and_pairing' })
  assert.deepEqual(resolveEntry(1, false), { step: 1, subStep: 'language' })
})
