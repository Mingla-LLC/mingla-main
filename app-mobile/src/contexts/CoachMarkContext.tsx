import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';
import { Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../store/appStore';
import { supabase } from '../services/supabase';
import { COACH_STEPS, COACH_STEP_COUNT, CoachStep } from '../constants/coachMarkSteps';
import { requestPostTourPermissions } from '../services/permissionOrchestrator';
import { mixpanelService } from '../services/mixpanelService';

// ── Types ───────────────────────────────────────────────────────────────────

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

interface ScrollTargetOffset {
  contentX: number;
  contentY: number;
  width: number;
  height: number;
}

/**
 * ORCH-1037 (SPEC §3.3): a per-scroll-step thunk that measures the actual row
 * leaf node via measureInWindow and invokes the callback with the raw window
 * rect (the context applies the ORCH-0688 Android Y-correction + the stable
 * loop). ProfilePage registers one per scroll step; the context calls it AFTER
 * the programmatic scroll settles, so the registered rect is a real post-scroll
 * window measurement — NOT a `contentY − scrollY` reconstruction.
 */
type ScrollTargetMeasurer = (cb: (rect: { x: number; y: number; width: number; height: number } | null) => void) => void;

interface CoachMarkContextType {
  currentStep: number;
  isCoachActive: boolean;
  isCoachPending: boolean;
  isCoachLoading: boolean;
  currentStepConfig: CoachStep | null;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  targetMeasurements: Map<number, TargetRect>;
  registerTarget: (stepId: number, rect: TargetRect) => void;
  registerScrollRef: (tabName: string, ref: React.RefObject<any>) => void;
  registerTargetScrollOffset: (stepId: number, contentX: number, contentY: number, width: number, height: number) => void;
  /** ORCH-1037 (SPEC §3.3): register the post-scroll direct-measure thunk for a
   *  scroll step's row node. The context calls it after the scroll settles and
   *  feeds the result through the two-consecutive-match stable loop. */
  registerTargetMeasurer: (stepId: number, measurer: ScrollTargetMeasurer) => void;
  overlayVisible: boolean;
  scrollLockActive: boolean;
  /** ORCH-1029 (F-1): bumps every time a target measurement registers. Consumers
   *  (SpotlightOverlay) read it so they re-render when a measurement arrives — the
   *  targetMeasurements Map is mutated in place and would not otherwise trigger a
   *  render. This is the deterministic measurement-consumption signal that releases
   *  step 1's deck-hold (NOT a timer). */
  targetVersion: number;
}

interface CoachMarkProviderProps {
  children: ReactNode;
  navigateToTab: (tab: string) => void;
}

const CoachMarkContext = createContext<CoachMarkContextType | undefined>(undefined);

// ── Constants ───────────────────────────────────────────────────────────────

const LOADING_SENTINEL = -2;
const TOUR_NOT_STARTED = 0;
// ORCH-1037/1035: tour is 11 steps. TOUR_COMPLETED is COACH_STEP_COUNT + 1 (now 12)
// and derives automatically — no edit needed here when the count changes.
const TOUR_COMPLETED = COACH_STEP_COUNT + 1;
const TOUR_SKIPPED = -1;
const START_DELAY_MS = 1500;
const TAB_NAVIGATE_DELAY_MS = 400;
const SCROLL_SETTLE_MS = 500;

// ORCH-1037 stable-measure (SPEC §3.2/§3.3): the post-scroll measure of a Profile
// row node is accepted only when two consecutive measureInWindow reads agree within
// STABLE_EPSILON_PX — the SAME mechanism useCoachMark uses for non-scroll steps —
// so a scroll step can never paint from a mid-scroll/stale rect.
const STABLE_EPSILON_PX = 1;
const STABLE_POLL_MS = 50;
const STABLE_TIMEOUT_MS = 1200;

// ORCH-1037/1035: scroll-offset steps on Profile — Interests (8) + Your Circle (9) +
// Account Settings row (10) + Beta Feedback (11). Renumbered from [6,7] when the four
// new steps were added. This is the ONE hard-coded step literal that does NOT
// self-adjust from COACH_STEP_COUNT — keep it in lockstep with coachMarkSteps.ts.
const SCROLL_STEPS = new Set([8, 9, 10, 11]);

// ── Provider ────────────────────────────────────────────────────────────────

export const CoachMarkProvider: React.FC<CoachMarkProviderProps> = ({ children, navigateToTab }) => {
  const { user } = useAppStore();
  const insets = useSafeAreaInsets();
  const [currentStep, setCurrentStep] = useState<number>(LOADING_SENTINEL);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [scrollLockActive, setScrollLockActive] = useState(false);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigateToTabRef = useRef(navigateToTab);
  navigateToTabRef.current = navigateToTab;

  // Target measurements map (stepId → rect) — used by SpotlightOverlay
  const [targetMeasurements] = useState(() => new Map<number, TargetRect>());
  // ORCH-1029 (F-1): bumps when a target registers so SpotlightOverlay re-renders
  // (the Map is mutated in place). This is what releases step 1's deck-hold the instant
  // the deck's callback-ref attach drives a plausible measurement.
  const [targetVersion, setTargetVersion] = useState(0);
  // Scroll refs per tab
  const scrollRefsRef = useRef<Map<string, React.RefObject<any>>>(new Map());
  // Scroll target offsets — contentY within ScrollView, captured via onLayout.
  // ORCH-1037: still used to compute HOW FAR to scroll; the registered cutout rect
  // now comes from a post-scroll measureInWindow, not from this offset arithmetic.
  const scrollTargetOffsetsRef = useRef<Map<number, ScrollTargetOffset>>(new Map());
  // ORCH-1037 (SPEC §3.3): per-scroll-step direct-measure thunks (row leaf node).
  const scrollTargetMeasurersRef = useRef<Map<number, ScrollTargetMeasurer>>(new Map());

  const screenWidth = Dimensions.get('window').width;
  const screenHeight = Dimensions.get('window').height;

  // ── Fetch step from DB on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function fetchStep(): Promise<void> {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('coach_mark_step')
          .eq('id', user!.id)
          .single();

        if (cancelled) return;
        if (error) {
          console.warn('[CoachMark] Failed to fetch step:', error.message);
          setCurrentStep(TOUR_COMPLETED);
          return;
        }
        const fetchedStep = data?.coach_mark_step ?? TOUR_NOT_STARTED;

        // ORCH-0635: normalize old-tour values (1..10, old sentinel 11) to new
        // TOUR_COMPLETED (= COACH_STEP_COUNT + 1 = 9). Users mid-old-tour do NOT
        // get re-run through the new tour — they already had their first-run moment.
        // Idempotent: after the first write, fetchedStep === TOUR_COMPLETED and no
        // further writes fire.
        let normalizedStep: number;
        if (
          fetchedStep !== TOUR_NOT_STARTED &&
          fetchedStep !== TOUR_SKIPPED &&
          fetchedStep !== TOUR_COMPLETED &&
          fetchedStep >= 1
        ) {
          normalizedStep = TOUR_COMPLETED;
          supabase
            .from('profiles')
            .update({ coach_mark_step: TOUR_COMPLETED })
            .eq('id', user!.id)
            .then(({ error: updateError }) => {
              if (updateError) {
                console.warn('[CoachMark] Failed to normalize legacy step:', updateError.message);
              }
            });
        } else {
          normalizedStep = fetchedStep;
        }

        setCurrentStep(normalizedStep);
      } catch (e) {
        console.warn('[CoachMark] Unexpected error fetching step:', e);
        if (!cancelled) setCurrentStep(TOUR_COMPLETED);
      }
    }

    fetchStep();
    return () => { cancelled = true; };
  }, [user?.id]);

  // ── Start tour after delay if step is 0 ─────────────────────────────────
  useEffect(() => {
    if (currentStep !== TOUR_NOT_STARTED) return;

    startTimerRef.current = setTimeout(() => {
      navigateToTabRef.current('home');
      setCurrentStep(1);
      persistStep(1);
      setOverlayVisible(true);
    }, START_DELAY_MS);

    return () => {
      if (startTimerRef.current) {
        clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
  }, [currentStep]);

  // ── Show overlay when step becomes active ───────────────────────────────
  useEffect(() => {
    if (currentStep >= 1 && currentStep <= COACH_STEP_COUNT) {
      // Navigate to the correct tab
      const config = COACH_STEPS.find((s) => s.id === currentStep);
      if (config) {
        navigateToTabRef.current(config.tab);
        mixpanelService.trackCoachMarkViewed({
          step_id: String(config.id),
          step_title: config.title,
          tab: config.tab,
        });
        // Start tour timer on first step
        if (config.id === 1) {
          mixpanelService.timeEvent('Coach Tour Completed');
        }
      }

      // ORCH-0635: scroll-offset step (Profile Account Settings row)
      if (SCROLL_STEPS.has(currentStep)) {
        scrollToKnownPosition(currentStep);
        return;
      }

      setScrollLockActive(false);
      setOverlayVisible(true);
    } else {
      setScrollLockActive(false);
      setOverlayVisible(false);
    }
  }, [currentStep]);

  // ── Register target measurement ─────────────────────────────────────────
  const registerTarget = useCallback((stepId: number, rect: TargetRect): void => {
    targetMeasurements.set(stepId, rect);
    // ORCH-1029 (F-1): notify consumers — the Map mutation alone doesn't re-render.
    setTargetVersion((v) => v + 1);
  }, [targetMeasurements]);

  // ── Known-position scroll for profile steps ─────────────────────────────
  // ORCH-1029 (F-3): the scroll path is GATED on the scroll offset being registered,
  // NOT on a fixed timer. We poll until the offset is present (it registers
  // deterministically via ProfilePage's onLayout → measureLayout), then scroll. The
  // scrollToEnd-to-footer fallback is removed: if the offset genuinely never registers
  // within the budget (true error, not a race), we leave the page at top with a centered
  // bubble — less wrong than dumping the user at the footer.
  //
  // ORCH-1037 (F / SPEC §3.3): the OFFSET is now used ONLY to compute HOW FAR to scroll.
  // The registered cutout rect is no longer reconstructed as `contentY − scrollY` (that
  // arithmetic was fragile — it depended on contentY being final, scrollY exact, and no
  // conditional rows shifting; live, steps 6 & 7 registered the IDENTICAL contentY and the
  // cutout landed one row low). Instead, after the scroll settles we perform a REAL
  // measureInWindow of the actual row leaf node (via the per-step measurer thunk that
  // ProfilePage registers) and feed it through the SAME two-consecutive-match stable loop
  // useCoachMark uses for non-scroll steps. The ORCH-0688 Android window-frame Y-correction
  // is applied to the measured window Y (mirrors useCoachMark.ts).
  // Spec: SPEC_ORCH-1037-1035_…§3.3 ; SPEC_ORCH-1029_COACH_MARK_FIXES.md §3.F-3 (lineage).
  const OFFSET_POLL_INTERVAL_MS = 60;
  const OFFSET_POLL_MAX_ATTEMPTS = 25; // ~1.5s total budget; correctness comes from the
  // offset being present, not from the interval length.

  // Two rects equal within STABLE_EPSILON_PX on every axis (ORCH-1037 §3.2/§3.3).
  const rectsStableEqual = (
    a: { x: number; y: number; width: number; height: number } | null,
    b: { x: number; y: number; width: number; height: number } | null,
  ): boolean => {
    if (!a || !b) return false;
    return (
      Math.abs(a.x - b.x) <= STABLE_EPSILON_PX &&
      Math.abs(a.y - b.y) <= STABLE_EPSILON_PX &&
      Math.abs(a.width - b.width) <= STABLE_EPSILON_PX &&
      Math.abs(a.height - b.height) <= STABLE_EPSILON_PX
    );
  };

  const scrollToKnownPosition = useCallback((step: number): void => {
    // Unlock scroll so programmatic scrollTo works (scrollEnabled must be true)
    setScrollLockActive(false);

    const stepConfig = COACH_STEPS.find((s) => s.id === step);
    if (!stepConfig) return;

    // ORCH-1037: register the post-scroll-measured row rect (with ORCH-0688 Android
    // correction) and surface the overlay. Single writer for the scroll-step rect.
    const commitMeasuredRect = (raw: { x: number; y: number; width: number; height: number }): void => {
      // ORCH-0688 / ORCH-1029 (F-4): POSITIVE Android-only window-frame Y-correction
      // sourced from the resolved safe-area top inset (NOT StatusBar.currentHeight —
      // that double-counts under Android 15 edge-to-edge). iOS branch is the identity.
      // Refs: https://developer.android.com/about/versions/15/behavior-changes-15#edge-to-edge
      //       https://github.com/th3rdwave/react-native-safe-area-context#usesafeareainsets
      const correctedY = Platform.OS === 'android' ? raw.y + insets.top : raw.y;
      registerTarget(step, {
        x: raw.x,
        y: correctedY,
        width: raw.width,
        height: raw.height,
        radius: 12,
      });
      setScrollLockActive(true);
      setOverlayVisible(true);
    };

    // ORCH-1037: poll the row's measureInWindow until two consecutive reads agree
    // within STABLE_EPSILON_PX (or best-effort on timeout). This runs the row node's
    // real post-scroll window measurement through the stable loop — NOT arithmetic.
    const measureRowUntilStable = (measurer: ScrollTargetMeasurer): void => {
      const startedAt = Date.now();
      let prevRect: { x: number; y: number; width: number; height: number } | null = null;
      let lastNonZeroRect: { x: number; y: number; width: number; height: number } | null = null;

      const tick = (): void => {
        measurer((rect) => {
          const elapsed = Date.now() - startedAt;
          if (!rect || (rect.width === 0 && rect.height === 0)) {
            if (elapsed < STABLE_TIMEOUT_MS) {
              setTimeout(tick, STABLE_POLL_MS);
            } else if (lastNonZeroRect) {
              commitMeasuredRect(lastNonZeroRect);
            } else {
              // Never measurable — leave at top with a centered fallback.
              setScrollLockActive(true);
              setOverlayVisible(true);
            }
            return;
          }
          lastNonZeroRect = rect;
          if (rectsStableEqual(prevRect, rect)) {
            commitMeasuredRect(rect);
            return;
          }
          prevRect = rect;
          if (elapsed < STABLE_TIMEOUT_MS) {
            setTimeout(tick, STABLE_POLL_MS);
          } else {
            commitMeasuredRect(rect);
          }
        });
      };
      tick();
    };

    // The inner routine runs ONLY once a real offset exists.
    const performScrollAndMeasure = (
      scrollRef: React.RefObject<any>,
      offset: ScrollTargetOffset,
    ): void => {
      // Place the target at 35% from the top of the screen. The OFFSET is used ONLY
      // here, to compute how far to scroll — never to reconstruct the cutout rect.
      const desiredScreenY = screenHeight * 0.35;
      const scrollY = Math.max(0, offset.contentY - desiredScreenY);

      scrollRef.current.scrollTo?.({ y: scrollY, animated: true });

      // After the scroll settles, do a REAL post-scroll measureInWindow of the row
      // leaf node (via the registered measurer) through the stable loop. Fall back to
      // the offset-reconstruction ONLY if no measurer was registered for this step
      // (keeps the overlay alive rather than hanging).
      setTimeout(() => {
        const measurer = scrollTargetMeasurersRef.current.get(step);
        if (measurer) {
          measureRowUntilStable(measurer);
          return;
        }
        // Legacy fallback (no measurer registered): reconstruct from the offset so the
        // step still shows a cutout. Should not happen once ProfilePage registers all
        // four scroll-step measurers; logged so a missing wiring is caught.
        console.warn(`[CoachMark] no direct measurer for scroll step ${step}; using offset fallback`);
        const exactScreenY = offset.contentY - scrollY;
        commitMeasuredRect({ x: offset.contentX, y: exactScreenY, width: offset.width, height: offset.height });
      }, SCROLL_SETTLE_MS);
    };

    // Poll for the registered offset. The scroll fires the instant the offset exists;
    // correctness is bound to registration, not to the poll interval.
    let attempts = 0;
    const tryScroll = (): void => {
      const scrollRef = scrollRefsRef.current.get(stepConfig.tab);
      const offset = scrollTargetOffsetsRef.current.get(step);

      if (scrollRef?.current && offset) {
        performScrollAndMeasure(scrollRef, offset);
        return;
      }

      attempts += 1;
      if (attempts < OFFSET_POLL_MAX_ATTEMPTS) {
        setTimeout(tryScroll, OFFSET_POLL_INTERVAL_MS);
        return;
      }

      // True failure (offset never registered within budget) — NOT a race. Do NOT
      // scrollToEnd to the footer; leave the page at top with a centered bubble.
      console.warn(`[CoachMark] scroll offset for step ${step} never registered — showing centered fallback`);
      setScrollLockActive(true);
      setOverlayVisible(true);
    };

    // One short beat to let the target tab mount before the first poll; subsequent
    // attempts are driven by the offset-presence check, not by this delay.
    setTimeout(tryScroll, TAB_NAVIGATE_DELAY_MS);
  }, [screenHeight, screenWidth, registerTarget, insets.top]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (startTimerRef.current) {
        clearTimeout(startTimerRef.current);
      }
    };
  }, []);

  // ── Persist step to DB (fire-and-forget) ────────────────────────────────
  const persistStep = useCallback((step: number): void => {
    if (!user?.id) return;
    supabase
      .from('profiles')
      .update({ coach_mark_step: step })
      .eq('id', user.id)
      .then(({ error }) => {
        if (error) console.warn('[CoachMark] Failed to persist step:', error.message);
      });
  }, [user?.id]);

  // ── Register scroll ref ─────────────────────────────────────────────────
  const registerScrollRef = useCallback((tabName: string, ref: React.RefObject<any>): void => {
    scrollRefsRef.current.set(tabName, ref);
  }, []);

  // ── Register scroll target offset (from onLayout in ProfilePage) ────────
  const registerTargetScrollOffset = useCallback((stepId: number, contentX: number, contentY: number, width: number, height: number): void => {
    scrollTargetOffsetsRef.current.set(stepId, { contentX, contentY, width, height });
  }, []);

  // ── ORCH-1037: register a scroll step's direct post-scroll measurer thunk ──
  const registerTargetMeasurer = useCallback((stepId: number, measurer: ScrollTargetMeasurer): void => {
    scrollTargetMeasurersRef.current.set(stepId, measurer);
  }, []);

  // ── Navigate and transition ─────────────────────────────────────────────
  const navigateAndTransition = useCallback((newStep: number, direction: 'forward' | 'back'): void => {
    const currentConfig = COACH_STEPS.find((s) => s.id === currentStep);
    const nextConfig = COACH_STEPS.find((s) => s.id === newStep);

    if (currentConfig && nextConfig && currentConfig.tab !== nextConfig.tab) {
      // Cross-tab: fade out, navigate, wait, fade in
      setOverlayVisible(false);
      navigateToTabRef.current(nextConfig.tab);
      setTimeout(() => {
        setCurrentStep(newStep);
        persistStep(newStep);
        // Profile scroll steps (6, 7) handled by useEffect → scrollToKnownPosition
        if (!SCROLL_STEPS.has(newStep)) {
          setOverlayVisible(true);
        }
      }, TAB_NAVIGATE_DELAY_MS);
    } else {
      // Same tab
      if (SCROLL_STEPS.has(newStep)) {
        // Same tab but needs scroll (e.g., Profile step 6 → 7)
        setOverlayVisible(false);
        setCurrentStep(newStep);
        persistStep(newStep);
        // useEffect will trigger scrollToKnownPosition
      } else {
        setCurrentStep(newStep);
        persistStep(newStep);
      }
    }
  }, [currentStep, persistStep]);

  // ── Next step ───────────────────────────────────────────────────────────
  const nextStep = useCallback((): void => {
    if (currentStep < 1 || currentStep > COACH_STEP_COUNT) return;

    // Track current step completion
    const stepConfig = COACH_STEPS[currentStep - 1];
    if (stepConfig) {
      mixpanelService.trackCoachMarkCompleted({
        step_id: String(stepConfig.id),
        step_title: stepConfig.title,
        tab: stepConfig.tab,
      });
    }

    const newStep = currentStep + 1;

    if (newStep > COACH_STEP_COUNT) {
      setOverlayVisible(false);
      setScrollLockActive(false);
      setCurrentStep(TOUR_COMPLETED);
      persistStep(TOUR_COMPLETED);
      mixpanelService.trackCoachTourCompleted();
      navigateToTabRef.current('home');
      requestPostTourPermissions().catch((e) =>
        console.warn('[CoachMark] Post-tour permissions failed:', e)
      );
      return;
    }

    navigateAndTransition(newStep, 'forward');
  }, [currentStep, persistStep, navigateAndTransition]);

  // ── Previous step ───────────────────────────────────────────────────────
  const prevStep = useCallback((): void => {
    if (currentStep <= 1) return;
    navigateAndTransition(currentStep - 1, 'back');
  }, [currentStep, navigateAndTransition]);

  // ── Skip tour ───────────────────────────────────────────────────────────
  const skipTour = useCallback((): void => {
    const stepConfig = currentStep >= 1 ? COACH_STEPS[currentStep - 1] : undefined;
    mixpanelService.trackCoachMarkSkipped({
      last_step_seen: stepConfig?.title ?? `Step ${currentStep}`,
      steps_completed: Math.max(0, currentStep - 1),
      steps_remaining: COACH_STEP_COUNT - currentStep,
    });
    setOverlayVisible(false);
    setScrollLockActive(false);
    setCurrentStep(TOUR_SKIPPED);
    persistStep(TOUR_SKIPPED);
    navigateToTabRef.current('home');
    requestPostTourPermissions().catch((e) =>
      console.warn('[CoachMark] Post-tour permissions failed:', e)
    );
  }, [currentStep, persistStep]);

  // ── Derived state ───────────────────────────────────────────────────────
  const isCoachActive = currentStep >= 1 && currentStep <= COACH_STEP_COUNT;
  const isCoachPending = currentStep === TOUR_NOT_STARTED;
  const isCoachLoading = currentStep === LOADING_SENTINEL;
  const currentStepConfig = isCoachActive
    ? COACH_STEPS.find((s) => s.id === currentStep) ?? null
    : null;

  // ORCH-0679 Wave 2A: useMemo on value (I-PROVIDER-VALUE-MEMOIZED) — context
  // value identity is stable across renders when no underlying state/refs change.
  const value = useMemo<CoachMarkContextType>(() => ({
    currentStep,
    isCoachActive,
    isCoachPending,
    isCoachLoading,
    currentStepConfig,
    nextStep,
    prevStep,
    skipTour,
    targetMeasurements,
    registerTarget,
    registerScrollRef,
    registerTargetScrollOffset,
    registerTargetMeasurer,
    overlayVisible,
    scrollLockActive,
    targetVersion,
  }), [
    currentStep,
    isCoachActive,
    isCoachPending,
    isCoachLoading,
    currentStepConfig,
    nextStep,
    prevStep,
    skipTour,
    targetMeasurements,
    registerTarget,
    registerScrollRef,
    registerTargetScrollOffset,
    registerTargetMeasurer,
    overlayVisible,
    scrollLockActive,
    targetVersion,
  ]);

  return (
    <CoachMarkContext.Provider value={value}>
      {children}
    </CoachMarkContext.Provider>
  );
};

// ── Hook ────────────────────────────────────────────────────────────────────

export function useCoachMarkContext(): CoachMarkContextType {
  const context = useContext(CoachMarkContext);
  if (context === undefined) {
    throw new Error('useCoachMarkContext must be used within a CoachMarkProvider');
  }
  return context;
}
