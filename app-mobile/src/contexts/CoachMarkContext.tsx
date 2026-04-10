import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { supabase } from '../services/supabase';
import { COACH_STEPS, COACH_STEP_COUNT, CoachStep } from '../constants/coachMarkSteps';
import { requestPostTourPermissions } from '../services/permissionOrchestrator';

// ── Types ───────────────────────────────────────────────────────────────────

interface CoachMarkContextType {
  /** 0=not started, 1-10=active, 11=done, -1=skipped, -2=loading */
  currentStep: number;
  /** true when step is 1-10 */
  isCoachActive: boolean;
  /** Config for the current step, or null if not active */
  currentStepConfig: CoachStep | null;
  /** Advance to next step (or complete if on 10) */
  nextStep: () => void;
  /** Skip permanently (set to -1) */
  skipTour: () => void;
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

// ── Provider ────────────────────────────────────────────────────────────────

export const CoachMarkProvider: React.FC<CoachMarkProviderProps> = ({ children, navigateToTab }) => {
  const { user } = useAppStore();
  const [currentStep, setCurrentStep] = useState<number>(LOADING_SENTINEL);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigateToTabRef = useRef(navigateToTab);
  navigateToTabRef.current = navigateToTab;

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
          // On error, assume completed so we don't block the user
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
      setCurrentStep(1);
      persistStep(1);
    }, START_DELAY_MS);

    return () => {
      if (startTimerRef.current) {
        clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    };
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
        if (error) {
          console.warn('[CoachMark] Failed to persist step:', error.message);
        }
      });
  }, [user?.id]);

  // ── Next step ───────────────────────────────────────────────────────────
  const nextStep = useCallback((): void => {
    setCurrentStep((prev) => {
      if (prev < 1 || prev > COACH_STEP_COUNT) return prev;

      const newStep = prev + 1;

      if (newStep > COACH_STEP_COUNT) {
        // Tour complete
        persistStep(TOUR_COMPLETED);
        requestPostTourPermissions().catch((e) =>
          console.warn('[CoachMark] Post-tour permissions failed:', e)
        );
        return TOUR_COMPLETED;
      }

      // Check if we need to navigate to a different tab
      const currentConfig = COACH_STEPS.find((s) => s.id === prev);
      const nextConfig = COACH_STEPS.find((s) => s.id === newStep);

      if (currentConfig && nextConfig && currentConfig.tab !== nextConfig.tab) {
        // Navigate first, then update step after delay
        navigateToTabRef.current(nextConfig.tab);
        setTimeout(() => {
          setCurrentStep(newStep);
          persistStep(newStep);
        }, TAB_NAVIGATE_DELAY_MS);
        // Return prev for now — the setTimeout will update
        return prev;
      }

      persistStep(newStep);
      return newStep;
    });
  }, [persistStep]);

  // ── Skip tour ───────────────────────────────────────────────────────────
  const skipTour = useCallback((): void => {
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
    skipTour,
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
