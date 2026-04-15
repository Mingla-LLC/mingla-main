import { useState, useCallback, useMemo, useRef } from 'react'
import {
  OnboardingNavState,
  OnboardingStep,
  SubStep,
} from '../types/onboarding'
import { logger } from '../utils/logger'

// ─── Step Sub-Step Sequences ───

const STEP_SUBSTEPS: Record<OnboardingStep, SubStep[]> = {
  1: ['language', 'welcome', 'phone', 'otp', 'gender_identity', 'details'],
  2: ['value_prop', 'intents'],
  3: ['location'],
  4: ['celebration', 'categories', 'transport', 'travel_time'],
  5: ['friends_and_pairing'],   // single substep, no paths
  6: ['collaborations'],         // NEW
  7: ['consent', 'getting_experiences'],  // NEW: consent moved here
}

interface UseOnboardingStateMachineProps {
  initialStep?: OnboardingStep
  hasGpsPermission: boolean  // determines whether 'manual_location' sub-step appears in Step 4
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
  hasGpsPermission,
}: UseOnboardingStateMachineProps): UseOnboardingStateMachineReturn {
  const [state, setState] = useState<OnboardingNavState>({
    step: initialStep,
    subStep: STEP_SUBSTEPS[initialStep][0],
  })
  const [isLaunch, setIsLaunch] = useState(false)

  // Mirror state in a ref so goNext/goBack can read it synchronously
  // without relying on setState updater functions (which React 18 may
  // defer when there are pending updates, breaking the shouldLaunch pattern).
  const stateRef = useRef(state)
  stateRef.current = state

  // ─── Fix A: Sync state when initialStep changes after mount ───
  // React's useState only uses the initial value on the first render.
  // When the resume logic in OnboardingFlow calls setInitialStep(N),
  // the hook receives a new prop but useState ignores it.
  // This setState-during-render pattern is React's sanctioned approach
  // (equivalent to getDerivedStateFromProps) — React discards the current
  // render and immediately re-renders with the new state, so the user
  // never sees the stale step. No flash, no extra paint.
  const appliedInitialStep = useRef(initialStep)
  if (appliedInitialStep.current !== initialStep) {
    logger.onboarding(`initialStep changed: ${appliedInitialStep.current} → ${initialStep}`)
    appliedInitialStep.current = initialStep
    setState({ step: initialStep, subStep: STEP_SUBSTEPS[initialStep][0] })
  }

  // Build the effective sub-step sequence for Step 4 (conditionally includes manual_location)
  const getStep4Sequence = useCallback((): SubStep[] => {
    // GPS is mandatory (Step 3) — no manual_location fallback. 'when' removed — defaults to this_weekend.
    return ['celebration', 'categories', 'transport', 'travel_time']
  }, [hasGpsPermission])

  // Get full sequence for a given step
  const getSequence = useCallback((step: OnboardingStep): SubStep[] => {
    if (step === 4) return getStep4Sequence()
    return STEP_SUBSTEPS[step]
  }, [getStep4Sequence])

  const goNext = useCallback(() => {
    const prev = stateRef.current
    const seq = getSequence(prev.step)
    const idx = seq.indexOf(prev.subStep)

    // Guard: if subStep is not in the sequence, stay put (fixes indexOf -1 bug)
    if (idx === -1) {
      logger.onboarding(`ERROR: subStep '${prev.subStep}' not found in sequence [${seq.join(', ')}]. Staying put.`)
      return
    }

    // If not at end of current step's sub-steps, advance within step
    if (idx < seq.length - 1) {
      const next = { step: prev.step, subStep: seq[idx + 1] }
      logger.onboarding(`goNext: Step ${prev.step}/${prev.subStep} → Step ${next.step}/${next.subStep}`)
      setState(next)
      return
    }

    // At end of step — advance to next step
    if (prev.step < 7) {
      const nextStep = (prev.step + 1) as OnboardingStep
      const nextSeq = getSequence(nextStep)
      const next = { step: nextStep, subStep: nextSeq[0] }
      logger.onboarding(`goNext: Step ${prev.step}/${prev.subStep} → Step ${next.step}/${next.subStep}`)
      setState(next)
      return
    }

    // At end of Step 7 — trigger launch
    logger.onboarding('LAUNCH triggered from end of Step 7')
    setIsLaunch(true)
  }, [getSequence])

  // ─── Fix C: goBack floor is always Step 1 ───
  const goBack = useCallback(() => {
    const prev = stateRef.current
    const seq = getSequence(prev.step)
    const idx = seq.indexOf(prev.subStep)

    // Guard: if subStep is not in the sequence, stay put (fixes indexOf -1 bug)
    if (idx === -1) {
      logger.onboarding(`ERROR: subStep '${prev.subStep}' not found in sequence [${seq.join(', ')}]. Staying put.`)
      return
    }

    // If not at start of current step, go back within step
    if (idx > 0) {
      const next = { step: prev.step, subStep: seq[idx - 1] }
      logger.onboarding(`goBack: Step ${prev.step}/${prev.subStep} → Step ${next.step}/${next.subStep}`)
      setState(next)
      return
    }

    // At start of step — go to previous step's last sub-step
    if (prev.step > 1) {
      const prevStep = (prev.step - 1) as OnboardingStep
      const prevSeq = getSequence(prevStep)
      const next = { step: prevStep, subStep: prevSeq[prevSeq.length - 1] }
      logger.onboarding(`goBack: Step ${prev.step}/${prev.subStep} → Step ${next.step}/${next.subStep}`)
      setState(next)
      return
    }

    // At Step 1 language — can't go back further
    logger.onboarding(`goBack: already at Step 1/language — no-op`)
  }, [getSequence])

  const goToSubStep = useCallback((subStep: SubStep) => {
    setState((prev) => ({ ...prev, subStep }))
  }, [])

  const progress = useMemo(() => {
    const seq = getSequence(state.step)
    const idx = seq.indexOf(state.subStep)
    const segmentFill = seq.length > 1 ? (idx + 1) / seq.length : 1
    return { step: state.step, segmentFill }
  }, [state, getSequence])

  return {
    state,
    goNext,
    goBack,
    goToSubStep,
    progress,
    isLaunch,
  }
}
