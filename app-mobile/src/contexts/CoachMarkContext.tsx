import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

interface ScrollTargetOffset {
  contentX: number;
  contentY: number;
  width: number;
  height: number;
}

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
  overlayVisible: boolean;
  scrollLockActive: boolean;
}

interface CoachMarkProviderProps {
  children: ReactNode;
  navigateToTab: (tab: string) => void;
}

const CoachMarkContext = createContext<CoachMarkContextType | undefined>(undefined);

// ── Constants ───────────────────────────────────────────────────────────────

const LOADING_SENTINEL = -2;
const TOUR_NOT_STARTED = 0;
const TOUR_COMPLETED = 13;
const TOUR_SKIPPED = -1;
const START_DELAY_MS = 1500;
const TAB_NAVIGATE_DELAY_MS = 400;
const SCROLL_SETTLE_MS = 500;

// Steps that need known-position scrolling (inside a ScrollView on profile tab)
const SCROLL_STEPS = new Set([11, 12]);

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
  // Scroll refs per tab
  const scrollRefsRef = useRef<Map<string, React.RefObject<any>>>(new Map());
  // Scroll target offsets — contentY within ScrollView, captured via onLayout
  const scrollTargetOffsetsRef = useRef<Map<number, ScrollTargetOffset>>(new Map());

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
      }

      // Steps 11-12: known-position scroll approach
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

  // ── Known-position scroll for profile steps ─────────────────────────────
  const scrollToKnownPosition = useCallback((step: number): void => {
    // Unlock scroll so programmatic scrollTo works (scrollEnabled must be true)
    setScrollLockActive(false);

    // Wait for profile tab to mount
    setTimeout(() => {
      const stepConfig = COACH_STEPS.find((s) => s.id === step);
      if (!stepConfig) return;

      const scrollRef = scrollRefsRef.current.get(stepConfig.tab);
      const offset = scrollTargetOffsetsRef.current.get(step);

      if (!scrollRef?.current || !offset) {
        // Fallback: scroll to end and show without cutout
        if (scrollRef?.current) {
          scrollRef.current.scrollToEnd?.({ animated: true });
        }
        setTimeout(() => {
          setScrollLockActive(true);
          setOverlayVisible(true);
        }, SCROLL_SETTLE_MS);
        return;
      }

      // Place the target at 35% from the top of the screen
      const desiredScreenY = screenHeight * 0.35;
      const scrollY = Math.max(0, offset.contentY - desiredScreenY);

      scrollRef.current.scrollTo?.({ y: scrollY, animated: true });

      // After scroll settles, register a SYNTHETIC measurement at the known position
      setTimeout(() => {
        // Profile page extends behind status bar — scroll content starts at y=0.
        // exactScreenY = contentY - scrollY (no insets offset needed)
        const exactScreenY = offset.contentY - scrollY;
        registerTarget(step, {
          x: offset.contentX,
          y: exactScreenY,
          width: offset.width,
          height: offset.height,
          radius: 12,
        });
        setScrollLockActive(true);
        setOverlayVisible(true);
      }, SCROLL_SETTLE_MS);
    }, TAB_NAVIGATE_DELAY_MS);
  }, [screenHeight, screenWidth, registerTarget]);

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

  // ── Register scroll target offset (from onLayout in ProfilePage) ────────
  const registerTargetScrollOffset = useCallback((stepId: number, contentX: number, contentY: number, width: number, height: number): void => {
    scrollTargetOffsetsRef.current.set(stepId, { contentX, contentY, width, height });
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
        // Steps 11-12 handled by useEffect → scrollToKnownPosition
        if (!SCROLL_STEPS.has(newStep)) {
          setOverlayVisible(true);
        }
      }, TAB_NAVIGATE_DELAY_MS);
    } else {
      // Same tab
      if (SCROLL_STEPS.has(newStep)) {
        // Same tab but needs scroll (e.g., step 11 → 12)
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

    const newStep = currentStep + 1;

    if (newStep > COACH_STEP_COUNT) {
      setOverlayVisible(false);
      setScrollLockActive(false);
      setCurrentStep(TOUR_COMPLETED);
      persistStep(TOUR_COMPLETED);
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
    setOverlayVisible(false);
    setScrollLockActive(false);
    setCurrentStep(TOUR_SKIPPED);
    persistStep(TOUR_SKIPPED);
    navigateToTabRef.current('home');
    requestPostTourPermissions().catch((e) =>
      console.warn('[CoachMark] Post-tour permissions failed:', e)
    );
  }, [persistStep]);

  // ── Derived state ───────────────────────────────────────────────────────
  const isCoachActive = currentStep >= 1 && currentStep <= COACH_STEP_COUNT;
  const isCoachPending = currentStep === TOUR_NOT_STARTED;
  const isCoachLoading = currentStep === LOADING_SENTINEL;
  const currentStepConfig = isCoachActive
    ? COACH_STEPS.find((s) => s.id === currentStep) ?? null
    : null;

  const value: CoachMarkContextType = {
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
    overlayVisible,
    scrollLockActive,
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
