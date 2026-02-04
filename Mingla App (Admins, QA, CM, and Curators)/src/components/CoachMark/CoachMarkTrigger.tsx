import React, { useState, useEffect } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { useCoachMark } from './CoachMarkProvider';
import { COACH_MARK_STORAGE_KEY } from './coachMarkSteps';

const TRIGGER_DISMISSED_KEY = 'mingla_coach_mark_trigger_dismissed';

/**
 * CoachMarkTrigger - Manual trigger button for testing or re-showing the tour
 * This component can be placed anywhere in the app for users who want to see the tour again
 * Users can permanently dismiss this button by clicking the X icon
 */
export default function CoachMarkTrigger() {
  const { startTour, state } = useCoachMark();
  const [isDismissed, setIsDismissed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Check if the trigger has been dismissed
  useEffect(() => {
    const dismissed = localStorage.getItem(TRIGGER_DISMISSED_KEY);
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  const handleReset = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Clear the completion flag
    localStorage.removeItem(COACH_MARK_STORAGE_KEY);
    // Start the tour
    startTour();
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Save dismissal to localStorage
    localStorage.setItem(TRIGGER_DISMISSED_KEY, 'true');
    setIsDismissed(true);
  };

  // Don't show the trigger if dismissed or if the tour is already active
  if (isDismissed || state.isActive) {
    return null;
  }

  return (
    <div 
      className="fixed bottom-24 right-6 z-50 md:bottom-6"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        onClick={handleReset}
        className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white p-3 rounded-full shadow-lg hover:shadow-xl transition-all duration-200"
        title="Show tour again"
        aria-label="Show tour again"
      >
        <HelpCircle className="w-6 h-6" />
      </button>
      
      {/* Dismiss button - shows on hover */}
      {isHovered && (
        <button
          onClick={handleDismiss}
          className="absolute -top-1 -right-1 bg-gray-800 text-white p-1 rounded-full shadow-md hover:bg-gray-900 transition-colors duration-200"
          title="Dismiss tour button"
          aria-label="Dismiss tour button"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}