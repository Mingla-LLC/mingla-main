import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { supabase } from '../services/supabase';
import { COACH_STEPS, COACH_STEP_COUNT, CoachStep } from '../constants/coachMarkSteps';
import { requestPostTourPermissions } from '../services/permissionOrchestrator';

// ── Types ───────────────────────────────────────────────────────────────────

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

interface CoachMarkContextType {
  /** 0=not started, 1-10=active, 11=done, -1=skipped, -2=loading */
  currentStep: number;
  /** true when step is 1-10 */
  isCoachActive: boolean;
  /** Config for the current step, or null if not active */
  currentStepConfig: CoachStep | null;
  /** Advance to next step (or complete if on 10) */
  nextStep: () => void;
  /** Go back to previous step */
  prevStep: () => void;
  /** Skip permanently (set to -1) */
  skipTour: () => void;
  /** Stored target measurements per step */
  targetMeasurements: Map<number, TargetRect>;
  /** Register/update a target element's measurement */
  registerTarget: (stepId: number, rect: TargetRect) => void;
  /** Register a scroll ref for a tab (for auto-scroll on steps 9-10) */
  registerScrollRef: (tabName: string, ref: React.RefObject<any>) => void;
  /** Whether the overlay is visible (false during cross-tab transitions) */
  overlayVisible: boolean;
}

interface CoachMarkProviderProps {
  children: ReactNode;
  navigateToTab: (tab: string) => void;
}

const CoachMarkContext = createContext<CoachMarkContextType | undefined>(undefined);

// ── Constants ───────────────────────────────────────────────────────────────

const LOADING_SENTINEL = -2;
const TOUR_NOT_STARTED = 0;
const TOUR_COMPLETED = 11;
const TOUR_SKIPPED = -1;
const START_DELAY_MS = 1500;
const TAB_NAVIGATE_DELAY_MS = 400;
const SCROLL_SETTLE_DELAY_MS = 400;

// ── Provider ────────────────────────────────────────────────────────────────

export const CoachMarkProvider: React.FC<CoachMarkProviderProps> = ({ children, navigateToTab }) => {
  const { user } = useAppStore();
  const [currentStep, setCurrentStep] = useState<number>(LOADING_SENTINEL);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigateToTabRef = useRef(navigateToTab);
  navigateToTabRef.current = navigateToTab;

  // Target measurements map (stepId → rect)
  const [targetMeasurements] = useState(() => new Map<number, TargetRect>());
  // Scroll refs per tab
  const scrollRefsRef = useRef<Map<string, React.RefObject<any>>>(new Map());

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
        const step = data?.coach_mark_step ?? TOUR_NOT_STARTED;
        setCurrentStep(step);
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
      // Ensure user is on the correct tab (step 1 is Home)
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

  // ── Show overlay when step becomes active (e.g. resume from DB) ─────────
  useEffect(() => {
    if (currentStep >= 1 && currentStep <= COACH_STEP_COUNT) {
      // Check if auto-scroll is needed (steps 9-10 on profile tab)
      if (currentStep === 9 || currentStep === 10) {
        const config = COACH_STEPS.find((s) => s.id === currentStep);
        if (config) {
          const scrollRef = scrollRefsRef.current.get(config.tab);
          if (scrollRef?.current) {
            // Scroll to a fixed offset — step 9 (Account Settings) is roughly
            // 400px down, step 10 (feedback) is further. We scroll first so the
            // element becomes visible, then measure, then show overlay.
            const scrollTarget = currentStep === 9 ? 300 : 500;
            scrollRef.current.scrollTo?.({ y: scrollTarget, animated: true });
            // Wait for scroll + layout, then show overlay
            setTimeout(() => setOverlayVisible(true), SCROLL_SETTLE_DELAY_MS + 200);
            return;
          }
        }
      }
      setOverlayVisible(true);
    } else {
      setOverlayVisible(false);
    }
  }, [currentStep]);

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

  // ── Register target measurement ─────────────────────────────────────────
  const registerTarget = useCallback((stepId: number, rect: TargetRect): void => {
    targetMeasurements.set(stepId, rect);
  }, [targetMeasurements]);

  // ── Register scroll ref ─────────────────────────────────────────────────
  const registerScrollRef = useCallback((tabName: string, ref: React.RefObject<any>): void => {
    scrollRefsRef.current.set(tabName, ref);
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
        // Auto-scroll handled by the useEffect watching currentStep
        // Don't set overlayVisible here — the useEffect will handle it
        // (including scroll delay for steps 9-10)
        if (newStep !== 9 && newStep !== 10) {
          setOverlayVisible(true);
        }
        // Steps 9-10 overlay visibility is handled by the useEffect above
      }, TAB_NAVIGATE_DELAY_MS);
    } else {
      // Same tab: just update step
      setCurrentStep(newStep);
      persistStep(newStep);
    }
  }, [currentStep, persistStep, targetMeasurements]);

  // ── Next step ───────────────────────────────────────────────────────────
  const nextStep = useCallback((): void => {
    if (currentStep < 1 || currentStep > COACH_STEP_COUNT) return;

    const newStep = currentStep + 1;

    if (newStep > COACH_STEP_COUNT) {
      // Tour complete
      setOverlayVisible(false);
      setCurrentStep(TOUR_COMPLETED);
      persistStep(TOUR_COMPLETED);
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
    setOverlayVisible(false);
    setCurrentStep(TOUR_SKIPPED);
    persistStep(TOUR_SKIPPED);
    requestPostTourPermissions().catch((e) =>
      console.warn('[CoachMark] Post-tour permissions failed:', e)
    );
  }, [persistStep]);

  // ── Derived state ───────────────────────────────────────────────────────
  const isCoachActive = currentStep >= 1 && currentStep <= COACH_STEP_COUNT;
  const currentStepConfig = isCoachActive
    ? COACH_STEPS.find((s) => s.id === currentStep) ?? null
    : null;

  const value: CoachMarkContextType = {
    currentStep,
    isCoachActive,
    currentStepConfig,
    nextStep,
    prevStep,
    skipTour,
    targetMeasurements,
    registerTarget,
    registerScrollRef,
    overlayVisible,
  };

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
