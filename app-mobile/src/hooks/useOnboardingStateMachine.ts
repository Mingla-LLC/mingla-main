import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  OnboardingNavState,
  OnboardingStep,
  SubStep,
} from '../types/onboarding'
import { logger } from '../utils/logger'
import {
  buildSequence,
  advance,
  retreat,
  resolveEntry,
  computeSegmentFill,
} from './onboardingSequenceLogic'

// ─── Step Sub-Step Sequences ───
// The authoritative sequencing tables + decision functions live in the
// dependency-free core `onboardingSequenceLogic.ts` (so they can be unit-tested
// under Node's built-in test runner — this app has no jest). This hook is a thin
// React adapter over that core: it owns the nav state + setState + launch flag.

interface UseOnboardingStateMachineProps {
  initialStep?: OnboardingStep
  hasGpsPermission: boolean  // determines whether 'manual_location' sub-step appears in Step 4
  hasCollabContext: boolean  // false ⇒ Step 6 (collaborations) is hidden/skipped (ORCH-1039)
}

interface UseOnboardingStateMachineReturn {
  state: OnboardingNavState
  goNext: () => void
  goBack: () => void
  goToSubStep: (subStep: SubStep) => void
  progress: { step: OnboardingStep; segmentFill: number }  // segmentFill: 0-1 within current step
  isLaunch: boolean
}

export function useOnboardingStateMachine({
  initialStep = 1,
  // hasGpsPermission is part of the public prop contract (reserved for the
  // Step-4 manual_location branch) but currently unused by the sequencing core.
  hasGpsPermission: _hasGpsPermission,
  hasCollabContext,
}: UseOnboardingStateMachineProps): UseOnboardingStateMachineReturn {
  // Lazy initializer resolves the entry through the skip-empty normalizer so a
  // resume at a hidden step (e.g. Step 6 with no collab context) never paints
  // the hidden step — not even for one frame (ORCH-1039 §3.6).
  const [state, setState] = useState<OnboardingNavState>(() =>
    resolveEntry(initialStep, hasCollabContext)
  )
  const [isLaunch, setIsLaunch] = useState(false)

  // Mirror state in a ref so goNext/goBack can read it synchronously
  // without relying on setState updater functions (which React 18 may
  // defer when there are pending updates, breaking the shouldLaunch pattern).
  const stateRef = useRef(state)
  stateRef.current = state

  // Keep the latest hasCollabContext readable synchronously inside callbacks
  // without re-creating them on every flag flip.
  const hasCollabContextRef = useRef(hasCollabContext)
  hasCollabContextRef.current = hasCollabContext

  // ─── Fix A: Sync state when initialStep changes after mount ───
  // React's useState only uses the initial value on the first render.
  // When the resume logic in OnboardingFlow calls setInitialStep(N),
  // the hook receives a new prop but useState ignores it.
  // This setState-during-render pattern is React's sanctioned approach
  // (equivalent to getDerivedStateFromProps) — React discards the current
  // render and immediately re-renders with the new state, so the user
  // never sees the stale step. No flash, no extra paint.
  // resolveEntry skips any hidden step so a resumed user never lands on one.
  const appliedInitialStep = useRef(initialStep)
  if (appliedInitialStep.current !== initialStep) {
    logger.onboarding(`initialStep changed: ${appliedInitialStep.current} → ${initialStep}`)
    appliedInitialStep.current = initialStep
    setState(resolveEntry(initialStep, hasCollabContext))
  }

  // ─── Fix B (ORCH-1039 rework): re-resolve off a now-hidden current step ───
  // The lazy initializer + `appliedInitialStep` guard resolve the entry only
  // when `initialStep` changes — NOT when `hasCollabContext` flips. On a
  // resume-at-Step-6 with no context, `hasCollabContext` starts on the SAFE
  // (true) default while the lifted async server reads load, so the entry
  // resolves to Step 6; when those reads settle to no-context the flag flips
  // false and Step 6 becomes hidden (`buildSequence(6,false) === []`) — but
  // nothing moved the user off it, stranding them on the hollow "Who's in?"
  // placeholder (the exact screen this ORCH eliminates), only in the resume
  // path (T-12 / adversarial T-A1).
  //
  // This effect fires ONLY when the CURRENT step's sequence has become empty
  // (the false-flip), and advances to the next non-empty step via the same
  // skip-empty normalizer as `resolveEntry`/`advance`. It is a no-op whenever
  // the current step is non-empty, so it NEVER yanks a user off a step they are
  // legitimately on (with context) and never fights goNext/goBack (those skip
  // empty steps and so can never land on an empty one). Keeps the non-blocking
  // safe-default (show-while-checking) intact — it only acts once the context
  // has actually resolved to empty.
  useEffect(() => {
    const current = stateRef.current
    if (buildSequence(current.step, hasCollabContext).length !== 0) return
    const resolved = resolveEntry(current.step, hasCollabContext)
    if (resolved.step === current.step && resolved.subStep === current.subStep) return
    logger.onboarding(
      `resolve-empty: Step ${current.step}/${current.subStep} became hidden (hasCollabContext=${hasCollabContext}) → Step ${resolved.step}/${resolved.subStep}`
    )
    setState(resolved)
  }, [hasCollabContext])

  const goNext = useCallback(() => {
    const prev = stateRef.current
    const result = advance(prev, hasCollabContextRef.current)
    if (result.kind === 'stay') {
      logger.onboarding(`goNext: subStep '${prev.subStep}' not in sequence — staying put.`)
      return
    }
    if (result.kind === 'launch') {
      logger.onboarding('LAUNCH triggered (no further non-empty step)')
      setIsLaunch(true)
      return
    }
    logger.onboarding(`goNext: Step ${prev.step}/${prev.subStep} → Step ${result.next.step}/${result.next.subStep}`)
    setState(result.next)
  }, [])

  const goBack = useCallback(() => {
    const prev = stateRef.current
    const result = retreat(prev, hasCollabContextRef.current)
    if (result.kind === 'stay') {
      logger.onboarding(`goBack: at earliest step or corrupt state — no-op.`)
      return
    }
    logger.onboarding(`goBack: Step ${prev.step}/${prev.subStep} → Step ${result.next.step}/${result.next.subStep}`)
    setState(result.next)
  }, [])

  const goToSubStep = useCallback((subStep: SubStep) => {
    setState((prev) => ({ ...prev, subStep }))
  }, [])

  const progress = useMemo(() => {
    // Guard: an empty/single-substep sequence (never the CURRENT step — advance/
    // retreat/resolveEntry all skip empty steps) yields a full segment (1)
    // rather than NaN. Do NOT "simplify" the skip-empty logic away upstream.
    const segmentFill = computeSegmentFill(state, hasCollabContext)
    return { step: state.step, segmentFill }
  }, [state, hasCollabContext])

  return {
    state,
    goNext,
    goBack,
    goToSubStep,
    progress,
    isLaunch,
  }
}

// Re-export buildSequence for any consumer that needs to know whether a step is
// present (kept for parity with the prior hook surface; the core is the authority).
export { buildSequence }
