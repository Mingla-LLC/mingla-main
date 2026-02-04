export interface CoachMarkStep {
  id: string;
  title: string;
  description: string;
  icon: string;
  targetRef?: string | string[]; // Reference key(s) for the target element(s) - can be single or multiple
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
  spotlightShape: 'circle' | 'rectangle';
  spotlightPadding?: number; // Extra padding around spotlight (default: 8px)
  page?: string; // Page to navigate to for this step (e.g., 'discover', 'activity', 'connections')
  requiresModal?: 'collaboration' | 'preferences'; // Modal that should be open for this step
  requiresTabSwitch?: 'messages' | 'boards' | 'saved' | 'calendar'; // Tab that should be active for this step
  isLastStep?: boolean; // Indicates this is the final step - shows "Finish" button and navigates to explore page
}

export interface CoachMarkState {
  isActive: boolean;
  currentStep: number;
  hasCompleted: boolean;
  version: string;
}

export interface CoachMarkContextValue {
  state: CoachMarkState;
  startTour: () => void;
  beginTour: () => void;
  nextStep: () => void;
  previousStep: () => void;
  skipTour: () => void;
  finishTour: () => void;
  registerRef: (key: string, element: HTMLElement | null) => void;
}

export interface SpotlightPosition {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: number;
}