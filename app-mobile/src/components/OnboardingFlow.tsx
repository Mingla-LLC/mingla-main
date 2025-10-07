import React, { useState, useCallback } from 'react';
import { StyleSheet, SafeAreaView } from 'react-native';
import WelcomeStep from './onboarding/WelcomeStep';
import AccountSetupStep from './onboarding/AccountSetupStep';
import IntentSelectionStep from './onboarding/IntentSelectionStep';
import VibeSelectionStep from './onboarding/VibeSelectionStep';
import LocationSetupStep from './onboarding/LocationSetupStep';
import InviteFriendsStep from './onboarding/InviteFriendsStep';
import MagicStep from './onboarding/MagicStep';

interface OnboardingFlowProps {
  onComplete: (onboardingData: any) => void;
  onNavigateToSignUp?: () => void;
}

const OnboardingFlow = ({ onComplete, onNavigateToSignUp }: OnboardingFlowProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<any>({
    userProfile: {
      name: 'Jordan Smith',
      email: 'jordan.smith@email.com',
      profileImage: null
    },
    intents: [],
    vibes: [],
    location: 'San Francisco, CA',
    invitedFriends: []
  });

  const totalSteps = 7;

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'white',
    },
  });

  const handleNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Complete onboarding
      onComplete(onboardingData);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const updateOnboardingData = useCallback((key: string, value: any) => {
    setOnboardingData((prev: any) => ({
      ...prev,
      [key]: value
    }));
  }, []);

  const handleIntentToggle = useCallback((intent: any) => {
    setOnboardingData((prev: any) => {
      const currentIntents = prev.intents || [];
      let updatedIntents;
      
      if (currentIntents.find((i: any) => i.id === intent.id)) {
        // Remove if already selected
        updatedIntents = currentIntents.filter((i: any) => i.id !== intent.id);
      } else {
        // Add if not selected (no limit)
        updatedIntents = [...currentIntents, intent];
      }
      
      return {
        ...prev,
        intents: updatedIntents
      };
    });
  }, []);

  const handleVibeToggle = useCallback((vibeId: string) => {
    setOnboardingData((prev: any) => {
      const currentVibes = prev.vibes || [];
      let updatedVibes;
      
      if (currentVibes.includes(vibeId)) {
        updatedVibes = currentVibes.filter((id: string) => id !== vibeId);
      } else {
        // Add if not selected (no limit)
        updatedVibes = [...currentVibes, vibeId];
      }
      
      return {
        ...prev,
        vibes: updatedVibes
      };
    });
  }, []);

  const handleFriendInvite = useCallback((friend: any) => {
    setOnboardingData((prev: any) => {
      const currentInvited = prev.invitedFriends || [];
      const isAlreadyInvited = currentInvited.some((f: any) => f.id === friend.id);
      
      if (isAlreadyInvited) {
        return {
          ...prev,
          invitedFriends: currentInvited.filter((f: any) => f.id !== friend.id)
        };
      } else {
        return {
          ...prev,
          invitedFriends: [...currentInvited, friend]
        };
      }
    });
  }, []);

  const requestLocationPermission = useCallback(() => {
    // For demo purposes, always use San Francisco, CA
    updateOnboardingData('location', 'San Francisco, CA');
  }, [updateOnboardingData]);

  const renderStep = () => {
    switch (currentStep) {
      case 0: // Welcome Screen
        return (
          <WelcomeStep 
            onNext={handleNext}
            onBack={handleBack}
          />
        );

      case 1: // Account Setup
        return (
          <AccountSetupStep 
            onNext={handleNext}
            onBack={handleBack}
            onNavigateToSignUp={onNavigateToSignUp}
          />
        );

      case 2: // Intent Selection
        return (
          <IntentSelectionStep 
            onNext={handleNext}
            onBack={handleBack}
            intents={onboardingData.intents}
            onIntentToggle={handleIntentToggle}
          />
        );

      case 3: // Vibe Selection
        return (
          <VibeSelectionStep 
            onNext={handleNext}
            onBack={handleBack}
            vibes={onboardingData.vibes}
            onVibeToggle={handleVibeToggle}
          />
        );

      case 4: // Location Setup
        return (
          <LocationSetupStep 
            onNext={handleNext}
            onBack={handleBack}
            location={onboardingData.location}
            onRequestLocationPermission={requestLocationPermission}
          />
        );

      case 5: // Invite Friends
        return (
          <InviteFriendsStep 
            onNext={handleNext}
            onBack={handleBack}
            invitedFriends={onboardingData.invitedFriends}
            onFriendInvite={handleFriendInvite}
          />
        );

      case 6: // Magic Step
        return (
          <MagicStep 
            onComplete={onComplete}
            onBack={handleBack}
            onboardingData={onboardingData}
          />
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {renderStep()}
    </SafeAreaView>
  );
};

export default OnboardingFlow;