/**
 * ORCH-1039 — Onboarding sequencing decision core (dependency-free).
 *
 * Pure functions that drive `useOnboardingStateMachine`. Extracted so the
 * conditional-hide logic (Step 6 collaborations skipped when there is no
 * collaboration context) can be unit-tested under Node's built-in test runner
 * (this app has no jest / renderHook). Mirrors the `launchCityGateLogic.ts`
 * decision-core pattern (ORCH-1028).
 *
 * No React, no I/O, no imports beyond the onboarding step/substep types.
 */
import type { OnboardingStep, SubStep, OnboardingNavState } from '../types/onboarding'

// ─── Step Sub-Step Sequences ───
// The static per-step substep arrays. The Step-6 (collaborations) sequence is
// conditional: it is only present when `hasCollabContext` is true (see
// `buildSequence`). Step 4's `manual_location` branch was removed (GPS is now
// mandatory at Step 3) so getStep4Sequence is fixed — kept as a separate
// constant only for clarity.
export const STEP_SUBSTEPS: Record<OnboardingStep, SubStep[]> = {
  1: ['language', 'welcome', 'phone', 'otp', 'gender_identity', 'details'],
  2: ['value_prop', 'intents'],
  3: ['location'],
  4: ['celebration', 'categories', 'transport', 'travel_time'],
  5: ['friends_and_pairing'],
  6: ['collaborations'],
  7: ['consent', 'getting_experiences'],
}

export const FIRST_STEP: OnboardingStep = 1
export const LAST_STEP: OnboardingStep = 7

/**
 * The effective substep sequence for a given step.
 *
 * Step 6 (collaborations) returns `[]` when there is no collaboration context
 * — the step is hidden. Every other step is its static sequence. An empty
 * sequence means "this step is skipped"; callers (advance/retreat/resolveEntry)
 * skip over empty-sequence steps so the current `state.step` is NEVER an empty
 * one.
 */
export function buildSequence(
  step: OnboardingStep,
  hasCollabContext: boolean
): SubStep[] {
  if (step === 6 && !hasCollabContext) return []
  return STEP_SUBSTEPS[step]
}

export type AdvanceResult =
  | { kind: 'move'; next: OnboardingNavState }
  | { kind: 'launch' }
  | { kind: 'stay' }

/**
 * Compute the next nav state from the current one (the `goNext` core).
 * - Within a step: advance to the next substep.
 * - At the end of a step: advance to the next step that HAS a non-empty
 *   sequence, skipping any empty-sequence (hidden) step. If none remain →
 *   launch.
 * - If the current substep is not in its sequence (corrupt state): stay.
 */
export function advance(
  prev: OnboardingNavState,
  hasCollabContext: boolean
): AdvanceResult {
  const seq = buildSequence(prev.step, hasCollabContext)
  const idx = seq.indexOf(prev.subStep)

  if (idx === -1) {
    return { kind: 'stay' }
  }

  // Not at end of current step — advance within step.
  if (idx < seq.length - 1) {
    return { kind: 'move', next: { step: prev.step, subStep: seq[idx + 1] } }
  }

  // At end of step — advance to the next step that has a sequence.
  let nextStep = (prev.step + 1) as OnboardingStep
  while (nextStep <= LAST_STEP && buildSequence(nextStep, hasCollabContext).length === 0) {
    nextStep = (nextStep + 1) as OnboardingStep
  }
  if (nextStep <= LAST_STEP) {
    const nextSeq = buildSequence(nextStep, hasCollabContext)
    return { kind: 'move', next: { step: nextStep, subStep: nextSeq[0] } }
  }

  // No remaining non-empty step — launch.
  return { kind: 'launch' }
}

export type RetreatResult =
  | { kind: 'move'; next: OnboardingNavState }
  | { kind: 'stay' }

/**
 * Compute the previous nav state from the current one (the `goBack` core).
 * - Within a step: go back to the previous substep.
 * - At the start of a step: go back to the previous step that HAS a non-empty
 *   sequence, landing on its LAST substep, skipping any empty-sequence step.
 *   If none remain (already at the earliest non-empty step): stay (no-op).
 */
export function retreat(
  prev: OnboardingNavState,
  hasCollabContext: boolean
): RetreatResult {
  const seq = buildSequence(prev.step, hasCollabContext)
  const idx = seq.indexOf(prev.subStep)

  if (idx === -1) {
    return { kind: 'stay' }
  }

  // Not at start of current step — go back within step.
  if (idx > 0) {
    return { kind: 'move', next: { step: prev.step, subStep: seq[idx - 1] } }
  }

  // At start of step — go to the previous step that has a sequence.
  let prevStep = (prev.step - 1) as OnboardingStep
  while (prevStep >= FIRST_STEP && buildSequence(prevStep, hasCollabContext).length === 0) {
    prevStep = (prevStep - 1) as OnboardingStep
  }
  if (prevStep >= FIRST_STEP) {
    const prevSeq = buildSequence(prevStep, hasCollabContext)
    return { kind: 'move', next: { step: prevStep, subStep: prevSeq[prevSeq.length - 1] } }
  }

  // Already at the earliest non-empty step — no-op.
  return { kind: 'stay' }
}

/**
 * Resolve the entry step+subStep for a resumed/initial step, skipping any step
 * whose conditional sequence is empty (e.g. Step 6 collaborations when
 * hasCollabContext is false). Mirrors `advance`'s skip-empty logic so a resumed
 * user NEVER lands on a hidden step — not even for one frame.
 */
export function resolveEntry(
  step: OnboardingStep,
  hasCollabContext: boolean
): OnboardingNavState {
  let s = step
  while (s <= LAST_STEP && buildSequence(s, hasCollabContext).length === 0) {
    s = (s + 1) as OnboardingStep
  }
  if (s > LAST_STEP) s = LAST_STEP // defensive: never past the last step
  const seq = buildSequence(s, hasCollabContext)
  // If even the last step is somehow empty (cannot happen — Step 7 is
  // unconditional), fall back to its static first substep.
  const subStep = seq.length > 0 ? seq[0] : STEP_SUBSTEPS[s][0]
  return { step: s, subStep }
}

/**
 * Segment-fill (0–1) within the current step. Guard: an empty/single-substep
 * sequence yields a full segment (1) rather than NaN. The current `state.step`
 * should never have an empty sequence (advance/retreat/resolveEntry all skip
 * empty steps), but this guard prevents a future regression from dividing by an
 * empty sequence.
 */
export function computeSegmentFill(
  state: OnboardingNavState,
  hasCollabContext: boolean
): number {
  const seq = buildSequence(state.step, hasCollabContext)
  const idx = seq.indexOf(state.subStep)
  if (seq.length <= 1 || idx === -1) return 1
  return (idx + 1) / seq.length
}
