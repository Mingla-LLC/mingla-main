import { useAppStore } from '../store/appStore';

const TOTAL_TOUR_STEPS = 11;

/**
 * Convenience hook for accessing tour state from Zustand.
 * Returns derived properties alongside raw state.
 */
export function useTourMode() {
  const tourMode = useAppStore((s) => s.tourMode);
  const tourStep = useAppStore((s) => s.tourStep);
  const advanceTour = useAppStore((s) => s.advanceTour);
  const skipTour = useAppStore((s) => s.skipTour);
  const completeTour = useAppStore((s) => s.completeTour);

  return {
    tourMode,
    tourStep,
    isLastStep: tourStep === TOTAL_TOUR_STEPS - 1,
    totalSteps: TOTAL_TOUR_STEPS,
    advance: advanceTour,
    skip: skipTour,
    complete: completeTour,
  };
}
