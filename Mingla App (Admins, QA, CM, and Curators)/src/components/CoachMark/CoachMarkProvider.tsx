import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CoachMarkContextValue, CoachMarkState } from './types';
import { COACH_MARK_VERSION, COACH_MARK_STORAGE_KEY, coachMarkSteps } from './coachMarkSteps';

const CoachMarkContext = createContext<CoachMarkContextValue | null>(null);

export const useCoachMark = () => {
  const context = useContext(CoachMarkContext);
  if (!context) {
    throw new Error('useCoachMark must be used within CoachMarkProvider');
  }
  return context;
};

interface CoachMarkProviderProps {
  children: React.ReactNode;
  autoStart?: boolean;
  onComplete?: () => void;
  onNavigate?: (page: string) => void;
  onOpenModal?: (modalType: 'collaboration' | 'preferences') => void;
  onCloseModal?: (modalType: 'collaboration' | 'preferences') => void;
  onSwitchTab?: (tab: string) => void;
}

export default function CoachMarkProvider({ children, autoStart = false, onComplete, onNavigate, onOpenModal, onCloseModal, onSwitchTab }: CoachMarkProviderProps) {
  const [state, setState] = useState<CoachMarkState>({
    isActive: false,
    currentStep: 0,
    hasCompleted: false,
    version: COACH_MARK_VERSION
  });

  const refs = useRef<Map<string, HTMLElement>>(new Map());

  // Check if user has completed coach mark on mount
  useEffect(() => {
    const hasCompleted = localStorage.getItem(COACH_MARK_STORAGE_KEY) === 'completed';
    if (hasCompleted) {
      setState(prev => ({ ...prev, hasCompleted: true }));
    } else if (autoStart) {
      // Auto-start tour if not completed and autoStart is true
      setTimeout(() => {
        setState(prev => ({ ...prev, isActive: true }));
      }, 1000); // Delay to ensure UI is fully rendered
    }
  }, [autoStart]);

  const startTour = useCallback(() => {
    setState(prev => ({
      ...prev,
      isActive: true,
      currentStep: 0
    }));
    // Don't navigate here - just show the welcome modal
  }, []);

  const beginTour = useCallback(() => {
    // This is called when user clicks "Start Tour" in the welcome modal
    // Navigate to first step's page
    const firstStep = coachMarkSteps[0];
    if (firstStep.page && onNavigate) {
      onNavigate(firstStep.page);
    }
  }, [onNavigate]);

  const nextStep = useCallback(() => {
    setState(prev => {
      const nextStepIndex = prev.currentStep + 1;
      if (nextStepIndex >= coachMarkSteps.length) {
        // Tour complete
        localStorage.setItem(COACH_MARK_STORAGE_KEY, 'completed');
        onComplete?.();
        return {
          ...prev,
          isActive: false,
          hasCompleted: true,
          currentStep: 0
        };
      }
      
      // Get current and next steps
      const currentStep = coachMarkSteps[prev.currentStep];
      const nextStep = coachMarkSteps[nextStepIndex];
      
      // Close modal if current step had a modal but next step doesn't
      if (currentStep.requiresModal && !nextStep.requiresModal && onCloseModal) {
        setTimeout(() => {
          onCloseModal(currentStep.requiresModal!);
        }, 50);
      }
      
      // Open modal if required
      if (nextStep.requiresModal && onOpenModal) {
        setTimeout(() => {
          onOpenModal(nextStep.requiresModal!);
        }, 100);
      }
      
      // Navigate first if needed, then switch tab
      if (nextStep.page && onNavigate) {
        // Small delay to let animation complete
        setTimeout(() => {
          onNavigate(nextStep.page!);
        }, 100);
      }
      
      // Switch tab if required (after navigation completes)
      if (nextStep.requiresTabSwitch && onSwitchTab) {
        setTimeout(() => {
          onSwitchTab(nextStep.requiresTabSwitch);
        }, nextStep.page ? 300 : 100); // Longer delay if we're also navigating
      }
      
      return {
        ...prev,
        currentStep: nextStepIndex
      };
    });
  }, [onComplete, onNavigate, onOpenModal, onCloseModal, onSwitchTab]);

  const previousStep = useCallback(() => {
    setState(prev => {
      const prevStepIndex = Math.max(0, prev.currentStep - 1);
      
      // Get current and previous steps
      const currentStep = coachMarkSteps[prev.currentStep];
      const prevStep = coachMarkSteps[prevStepIndex];
      
      // Close modal if current step had a modal but previous step doesn't
      if (currentStep.requiresModal && !prevStep.requiresModal && onCloseModal) {
        setTimeout(() => {
          onCloseModal(currentStep.requiresModal!);
        }, 50);
      }
      
      // Open modal if required for previous step
      if (prevStep.requiresModal && onOpenModal) {
        // If current step also has a modal, we need to handle transition
        if (currentStep.requiresModal && currentStep.requiresModal !== prevStep.requiresModal) {
          // Close current modal first, then open previous
          if (onCloseModal) {
            onCloseModal(currentStep.requiresModal);
          }
          setTimeout(() => {
            onOpenModal(prevStep.requiresModal!);
          }, 150);
        } else if (!currentStep.requiresModal) {
          // Just open the modal
          setTimeout(() => {
            onOpenModal(prevStep.requiresModal!);
          }, 100);
        }
      }
      
      // Navigate to previous step's page
      if (prevStep.page && onNavigate) {
        setTimeout(() => {
          onNavigate(prevStep.page!);
        }, 100);
      }
      
      // Switch tab if required (after navigation completes)
      if (prevStep.requiresTabSwitch && onSwitchTab) {
        setTimeout(() => {
          onSwitchTab(prevStep.requiresTabSwitch!);
        }, prevStep.page ? 300 : 100); // Longer delay if we're also navigating
      }
      
      return {
        ...prev,
        currentStep: prevStepIndex
      };
    });
  }, [onNavigate, onSwitchTab, onOpenModal, onCloseModal]);

  const skipTour = useCallback(() => {
    localStorage.setItem(COACH_MARK_STORAGE_KEY, 'completed');
    setState(prev => ({
      ...prev,
      isActive: false,
      hasCompleted: true,
      currentStep: 0
    }));
    onComplete?.();
  }, [onComplete]);

  const finishTour = useCallback(() => {
    localStorage.setItem(COACH_MARK_STORAGE_KEY, 'completed');
    setState(prev => ({
      ...prev,
      isActive: false,
      hasCompleted: true,
      currentStep: 0
    }));
    
    // Navigate to home page (explore page) when tour completes
    if (onNavigate) {
      setTimeout(() => {
        onNavigate('home');
      }, 300);
    }
    
    onComplete?.();
  }, [onComplete, onNavigate]);

  const registerRef = useCallback((key: string, element: HTMLElement | null) => {
    if (element) {
      refs.current.set(key, element);
    } else {
      refs.current.delete(key);
    }
  }, []);

  const contextValue: CoachMarkContextValue = {
    state,
    startTour,
    beginTour,
    nextStep,
    previousStep,
    skipTour,
    finishTour,
    registerRef
  };

  return (
    <CoachMarkContext.Provider value={contextValue}>
      {children}
    </CoachMarkContext.Provider>
  );
}

// Hook to register refs easily
export function useCoachMarkRef(key: string) {
  const { registerRef } = useCoachMark();
  
  return useCallback((element: HTMLElement | null) => {
    registerRef(key, element);
  }, [key, registerRef]);
}