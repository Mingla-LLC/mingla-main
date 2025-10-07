import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, SafeAreaView } from 'react-native';
import { useAuthSimple } from '../hooks/useAuthSimple';
import { useAppStore } from '../store/appStore';
import { locationService } from '../services/locationService';
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
  onBackToWelcome?: () => void;
  onNavigateToSignUpForm?: () => void;
}

const OnboardingFlow = ({ onComplete, onNavigateToSignUp, onBackToWelcome, onNavigateToSignUpForm }: OnboardingFlowProps) => {
  const { user } = useAuthSimple();
  const { profile } = useAppStore();
  const [currentStep, setCurrentStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<any>({
    userProfile: {
      name: user?.email?.split('@')[0] || 'User',
      email: user?.email || '',
      profileImage: null
    },
    intents: [],
    vibes: [],
    location: 'San Francisco, CA',
    invitedFriends: []
  });

  const totalSteps = 7;

  // Update onboarding data when user/profile changes
  useEffect(() => {
    if (user || profile) {
      const displayName = profile?.display_name || profile?.first_name || user?.email?.split('@')[0] || 'User';
      setOnboardingData((prev: any) => ({
        ...prev,
        userProfile: {
          name: displayName,
          email: user?.email || '',
          profileImage: profile?.avatar_url || null
        }
      }));
    }
  }, [user, profile]);

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

  const handleBackToWelcome = () => {
    if (onBackToWelcome) {
      onBackToWelcome();
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

  const requestLocationPermission = useCallback(async () => {
    try {
      console.log('Requesting location permission...');
      
      // For now, let's skip the actual location request and just use the default
      // This avoids the Info.plist configuration issue in development
      console.log('Using default location for demo purposes');
      updateOnboardingData('location', 'San Francisco, CA');
      
      // Show a message to the user
      alert('Location services configured! Using San Francisco, CA for demo purposes.');
      
      // TODO: Uncomment this when the app is properly built with Info.plist configuration
      
      // Request location permissions
      const hasPermission = await locationService.requestPermissions();
      
      if (hasPermission) {
        console.log('Location permission granted, getting current location...');
        
        // Try to get current location
        const location = await locationService.getCurrentLocation();
        
        if (location) {
          console.log('Current location obtained:', location);
          // Update onboarding data with actual location
          updateOnboardingData('location', `${location.latitude}, ${location.longitude}`);
        } else {
          console.log('Could not get current location, using default');
          updateOnboardingData('location', 'San Francisco, CA');
        }
      } else {
        console.log('Location permission denied, using default location');
        updateOnboardingData('location', 'San Francisco, CA');
      }

    } catch (error: any) {
      console.error('Error requesting location permission:', error);
      
      // Check if it's a configuration error
      if (error.message && error.message.includes('NSLocation')) {
        console.log('Location configuration error detected - using default location');
        // Show a more user-friendly message
        alert('Location services are not properly configured. Using default location for demo purposes.');
      } else if (error.message && error.message.includes('Info.plist')) {
        console.log('Info.plist configuration missing - using default location');
        alert('Location permissions are not configured in the app. Using default location for demo purposes.');
      }
      
      // Fallback to default location
      updateOnboardingData('location', 'San Francisco, CA');
    }
  }, [updateOnboardingData]);

  const renderStep = () => {
    switch (currentStep) {
      case 0: // Welcome Screen
        return (
          <WelcomeStep 
            onNext={handleNext}
            onBack={handleBackToWelcome}
          />
        );

      case 1: // Account Setup
        return (
          <AccountSetupStep 
            onNext={handleNext}
            onBack={handleBack}
            onNavigateToSignUp={onNavigateToSignUpForm || onNavigateToSignUp}
            userProfile={onboardingData.userProfile}
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