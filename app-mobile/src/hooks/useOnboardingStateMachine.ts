import { useState, useCallback, useMemo, useRef } from 'react'
import {
  OnboardingNavState,
  OnboardingStep,
  SubStep,
} from '../types/onboarding'
import { logger } from '../utils/logger'

// ─── Step Sub-Step Sequences ───

const STEP_SUBSTEPS: Record<OnboardingStep, SubStep[]> = {
  1: ['welcome', 'phone', 'otp', 'gender_identity', 'details'],
  2: ['value_prop', 'intents'],
  3: ['location'],
  4: ['celebration', 'categories', 'budget', 'transport', 'travel_time'],
  5: ['friends'],  // Step 5 sub-steps are dynamic (depends on chosen path)
}

// Step 5 path sub-steps (appended after 'pitch' when path is chosen)
const STEP5_PATH_A: SubStep[] = ['pathA_birthday', 'pathA_gender', 'pathA_audio', 'pathA_contact']
const STEP5_PATH_B: SubStep[] = ['pathB_name', 'pathB_birthday', 'pathB_gender', 'pathB_audio']

interface UseOnboardingStateMachineProps {
  initialStep?: OnboardingStep
  hasGpsPermission: boolean  // determines whether 'manual_location' sub-step appears in Step 4
}

interface UseOnboardingStateMachineReturn {
  state: OnboardingNavState
  goNext: () => void
  goBack: () => void
  goToSubStep: (subStep: SubStep) => void
  choosePath: (path: 'invite' | 'add' | 'skip') => void
  setSkippedFriends: (skipped: boolean) => void
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
  const [chosenPath, setChosenPath] = useState<'invite' | 'add' | 'skip' | null>(null)
  const [skippedFriends, setSkippedFriends] = useState(false)
  const [isLaunch, setIsLaunch] = useState(false)

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
    if (hasGpsPermission) {
      return ['celebration', 'categories', 'budget', 'transport', 'travel_time']
    }
    return ['celebration', 'manual_location', 'categories', 'budget', 'transport', 'travel_time']
  }, [hasGpsPermission])

  // Build the effective sub-step sequence for Step 5 (depends on chosen path)
  const getStep5Sequence = useCallback((): SubStep[] => {
    const base: SubStep[] = ['friends']

    if (!skippedFriends) {
      base.push('collaboration')
    }

    base.push('pitch')
    if (chosenPath === 'invite') base.push(...STEP5_PATH_A)
    if (chosenPath === 'add') base.push(...STEP5_PATH_B)
    if (chosenPath === 'skip') base.push('skip')

    return base
  }, [chosenPath, skippedFriends])

  // Get full sequence for a given step
  const getSequence = useCallback((step: OnboardingStep): SubStep[] => {
    if (step === 4) return getStep4Sequence()
    if (step === 5) return getStep5Sequence()
    return STEP_SUBSTEPS[step]
  }, [getStep4Sequence, getStep5Sequence])

  const goNext = useCallback(() => {
    let shouldLaunch = false
    setState((prev) => {
      const seq = getSequence(prev.step)
      const idx = seq.indexOf(prev.subStep)

      // If not at end of current step's sub-steps, advance within step
      if (idx < seq.length - 1) {
        const next = { step: prev.step, subStep: seq[idx + 1] }
        logger.onboarding(`goNext: Step ${prev.step}/${prev.subStep} → Step ${next.step}/${next.subStep}`)
        return next
      }

      // At end of step — advance to next step
      if (prev.step < 5) {
        const nextStep = (prev.step + 1) as OnboardingStep
        const nextSeq = getSequence(nextStep)
        const next = { step: nextStep, subStep: nextSeq[0] }
        logger.onboarding(`goNext: Step ${prev.step}/${prev.subStep} → Step ${next.step}/${next.subStep}`)
        return next
      }

      // At end of Step 5 — flag for launch (side effect handled outside setState)
      logger.onboarding('LAUNCH triggered from end of Step 5')
      shouldLaunch = true
      return prev
    })
    // Set launch state outside the updater — setState updaters must be pure functions
    if (shouldLaunch) {
      setIsLaunch(true)
    }
  }, [getSequence])

  // ─── Fix C: goBack floor is always Step 1 ───
  // The back button visibility is controlled by isFirstScreen + OnboardingShell,
  // so goBack itself never needs a dynamic floor. This is simple and bulletproof:
  // even if the component remounts and resume re-runs, goBack always allows
  // navigating all the way back to Step 1.
  const goBack = useCallback(() => {
    setState((prev) => {
      const seq = getSequence(prev.step)
      const idx = seq.indexOf(prev.subStep)

      // If not at start of current step, go back within step
      if (idx > 0) {
        const next = { step: prev.step, subStep: seq[idx - 1] }
        logger.onboarding(`goBack: Step ${prev.step}/${prev.subStep} → Step ${next.step}/${next.subStep}`)
        return next
      }

      // At start of step — go to previous step's last sub-step
      if (prev.step > 1) {
        const prevStep = (prev.step - 1) as OnboardingStep
        const prevSeq = getSequence(prevStep)
        const next = { step: prevStep, subStep: prevSeq[prevSeq.length - 1] }
        logger.onboarding(`goBack: Step ${prev.step}/${prev.subStep} → Step ${next.step}/${next.subStep}`)
        return next
      }

      // At Step 1 welcome — can't go back further
      logger.onboarding(`goBack: already at Step 1/welcome — no-op`)
      return prev
    })
  }, [getSequence])

  const goToSubStep = useCallback((subStep: SubStep) => {
    setState((prev) => ({ ...prev, subStep }))
  }, [])

  const choosePath = useCallback((path: 'invite' | 'add' | 'skip') => {
    logger.onboarding(`choosePath: ${path}`)
    setChosenPath(path)
    if (path === 'skip') {
      // Skip path: show skip transition screen, then launch
      setState({ step: 5, subStep: 'skip' })
    } else if (path === 'invite') {
      setState({ step: 5, subStep: 'pathA_birthday' })
    } else if (path === 'add') {
      setState({ step: 5, subStep: 'pathB_name' })
    }
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
    choosePath,
    setSkippedFriends,
    progress,
    isLaunch,
  }
}
