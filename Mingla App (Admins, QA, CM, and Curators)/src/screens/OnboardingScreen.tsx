/**
 * Onboarding Screen - New user setup
 * Collects preferences and sets up user profile
 */

import React from 'react';
import OnboardingFlow from '../components/OnboardingFlow';
import BusinessOnboardingFlow from '../components/BusinessOnboardingFlow';

interface OnboardingScreenProps {
  onComplete: (data: any) => void;
  onBackToSignIn: () => void;
  userRole?: 'explorer' | 'business';
}

export default function OnboardingScreen({ 
  onComplete, 
  onBackToSignIn,
  userRole = 'explorer' 
}: OnboardingScreenProps) {
  if (userRole === 'business') {
    return (
      <BusinessOnboardingFlow
        onComplete={onComplete}
        onBackToSignIn={onBackToSignIn}
      />
    );
  }

  return (
    <OnboardingFlow
      onComplete={onComplete}
      onBackToSignIn={onBackToSignIn}
    />
  );
}
