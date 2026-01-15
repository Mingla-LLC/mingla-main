import React, { useState, useCallback, useEffect } from "react";
import { StyleSheet, Alert, View, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthSimple } from "../hooks/useAuthSimple";
import { useAppStore } from "../store/appStore";
import { locationService } from "../services/locationService";
import { PreferencesService } from "../services/preferencesService";
import WelcomeStep from "./onboarding/WelcomeStep";
import AccountSetupStep from "./onboarding/AccountSetupStep";
import IntentSelectionStep from "./onboarding/IntentSelectionStep";
import VibeSelectionStep from "./onboarding/VibeSelectionStep";
import LocationSetupStep from "./onboarding/LocationSetupStep";
import TravelModeStep from "./onboarding/TravelModeStep";
import TravelConstraintStep from "./onboarding/TravelConstraintStep";
import BudgetRangeStep from "./onboarding/BudgetRangeStep";
import DateTimePrefStep from "./onboarding/DateTimePrefStep";
import InviteFriendsStep from "./onboarding/InviteFriendsStep";
import MagicStep from "./onboarding/MagicStep";
import PhoneSignUpForm from "./signIn/PhoneSignUpForm";
import OTPScreen from "./signIn/OTPScreen";

interface OnboardingFlowProps {
  onComplete: (onboardingData: any) => void;
  onNavigateToSignUp?: (accountType?: string) => void;
  onBackToWelcome?: () => void;
  onNavigateToSignUpForm?: (accountType?: string) => void;
  onGoogleSignInComplete?: () => void;
  initialAccountType?: string;
}

const OnboardingFlow = ({
  onComplete,
  onNavigateToSignUp,
  onBackToWelcome,
  onNavigateToSignUpForm,
  onGoogleSignInComplete,
  initialAccountType,
}: OnboardingFlowProps) => {
  const {
    user,
    signUpWithPhone,
    verifyPhoneOTP,
    resendPhoneOTP,
    signInWithGoogle,
    signInWithApple,
    handleOAuthTokens,
  } = useAuthSimple();
  const { profile } = useAppStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [showPhoneSignUp, setShowPhoneSignUp] = useState(false);
  const [
    isSigningInWithCompletedOnboarding,
    setIsSigningInWithCompletedOnboarding,
  ] = useState(false);

  // Helper function to update onboarding_step in profile
  const updateOnboardingStep = useCallback(
    async (step: number): Promise<boolean> => {
      if (!user?.id) {
        return false;
      }

      try {
        const { supabase } = await import("../services/supabase");
        const { error } = await supabase
          .from("profiles")
          .update({ onboarding_step: step })
          .eq("id", user.id);

        if (error) {
          console.error("Error updating onboarding_step:", error);
          return false;
        }

        // Update profile in store to reflect the change
        const { data: updatedProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .single();

        if (updatedProfile) {
          const { useAppStore } = await import("../store/appStore");
          useAppStore.getState().setProfile(updatedProfile);
        }

        return true;
      } catch (error) {
        console.error("Error updating onboarding step:", error);
        return false;
      }
    },
    [user?.id]
  );

  // If user is authenticated AND hasn't completed onboarding, skip AccountSetupStep and go directly to IntentSelectionStep
  // BUT only if there's no saved onboarding_step (first time user, not resuming)
  // This runs when user/profile changes, but only if we're still on step 1
  useEffect(() => {
    // Only skip to Step 2 if:
    // 1. User is authenticated (user and profile exist)
    // 2. User hasn't completed onboarding
    // 3. We're currently on Step 1
    // 4. There's no saved onboarding_step (first time, not resuming)
    if (user && profile && profile.has_completed_onboarding === false) {
      // Check if there's a saved onboarding_step - if so, let the resume logic handle it
      const savedStep = profile.onboarding_step;
      if (
        savedStep !== null &&
        savedStep !== undefined &&
        savedStep >= 2 &&
        savedStep <= 10
      ) {
        // There's a saved step - let the resume logic handle it
        return;
      }

      // No saved step - first time user, skip to Step 2
      setCurrentStep((prevStep) => {
        if (prevStep === 1) {
          return 2;
        }
        return prevStep;
      });
    } else if (!user || !profile) {
      // User is not authenticated - ensure we're on Step 1 (AccountSetupStep)
      setCurrentStep((prevStep) => {
        if (prevStep !== 1) {
          return 1;
        }
        return prevStep;
      });
    }
  }, [user, profile]);
  const [showOTP, setShowOTP] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [onboardingData, setOnboardingData] = useState<any>({
    userProfile: {
      name: user?.email?.split("@")[0] || "User",
      email: user?.email || "",
      profileImage: null,
    },
    account_type: initialAccountType || null, // Account type from SignUpAsStep
    intents: [], // Step 2: Intent Selection
    vibes: [], // Step 3: Vibe/Category Selection
    location: "", // Step 4: Location Setup
    travelMode: "walking", // Step 5: Travel Mode
    travelConstraintType: "time", // Step 6: Travel Constraint
    travelConstraintValue: 30, // Step 6: Travel Constraint value
    budgetRange: { min: 0, max: 1000 }, // Step 7: Budget Range { min, max }
    dateTimePref: {
      dateOption: null,
      timeSlot: null,
      selectedDate: null,
      weekendDay: null,
      exactTime: null,
    }, // Step 8: Date and Time Preferences
    groupSize: 1, // Group size (people_count)
    invitedFriends: [], // Step 9: Invite Friends (optional)
  });

  const totalSteps = 10;

  // Resume logic: Load onboarding_step from profile
  useEffect(() => {
    const resumeFromOnboardingStep = async () => {
      if (!user?.id || !profile) return;

      // If onboarding is completed, onboarding_step should be 0
      if (profile.has_completed_onboarding === true) {
        // If onboarding_step is not 0, update it
        if (profile.onboarding_step !== 0) {
          await updateOnboardingStep(0);
        }
        return;
      }

      // Load saved preferences into onboardingData for display
      try {
        const preferences = await PreferencesService.getUserPreferences(
          user.id
        );

        if (preferences) {
          // Helper function to map intent IDs back to intent objects
          const mapIntentIdsToObjects = (categoryIds: string[]): any[] => {
            const intentOptions = [
              {
                id: "solo-adventure",
                title: "Solo Adventure",
                icon: "globe-outline",
                description: "Explore new things on your own",
                experienceType: "Solo adventure",
              },
              {
                id: "first-dates",
                title: "Plan First Dates",
                icon: "heart-outline",
                description: "Great first impression experiences",
                experienceType: "First Date",
              },
              {
                id: "romantic",
                title: "Find Romantic Activities",
                icon: "heart-outline",
                description: "Intimate and romantic experiences",
                experienceType: "Romantic",
              },
              {
                id: "friendly",
                title: "Find Friendly Activities",
                icon: "people-outline",
                description: "Fun activities with friends",
                experienceType: "Friendly",
              },
              {
                id: "group-fun",
                title: "Find Activities for Groups",
                icon: "people-outline",
                description: "Group activities and celebrations",
                experienceType: "Group fun",
              },
              {
                id: "business",
                title: "Business/Work Meetings",
                icon: "briefcase-outline",
                description: "Professional meeting spaces",
                experienceType: "Business",
              },
            ];

            const intentIds = new Set(intentOptions.map((opt) => opt.id));
            return categoryIds
              .filter((id) => intentIds.has(id))
              .map((id) => intentOptions.find((opt) => opt.id === id))
              .filter((intent) => intent !== undefined) as any[];
          };

          // Extract intent IDs from categories array and map to intent objects
          const categories = preferences.categories || [];
          const loadedIntents = mapIntentIdsToObjects(categories);

          // Filter out intent IDs from categories to get only vibe categories
          const intentIds = new Set([
            "solo-adventure",
            "first-dates",
            "romantic",
            "friendly",
            "group-fun",
            "business",
          ]);
          const vibeCategories = categories.filter(
            (cat: string) => !intentIds.has(cat)
          );

          // Load saved preferences into onboardingData
          setOnboardingData((prev: any) => ({
            ...prev,
            intents: loadedIntents,
            vibes: vibeCategories,
            location: prev.location || "", // Keep empty if not set
            travelMode: preferences.travel_mode || "walking",
            travelConstraintType: preferences.travel_constraint_type || "time",
            travelConstraintValue: preferences.travel_constraint_value || 30,
            budgetRange: {
              min: preferences.budget_min || 0,
              max: preferences.budget_max || 1000,
            },
            dateTimePref: (() => {
              // Handle new structure: dateOption, timeSlot, selectedDate, weekendDay, exactTime
              // If date_option exists, use new structure
              if (preferences.date_option) {
                // Map database values to component values
                let dateOption: string | null = null;
                if (preferences.date_option === "now") {
                  dateOption = "Now";
                } else if (preferences.date_option === "today") {
                  dateOption = "Today";
                } else if (preferences.date_option === "weekend") {
                  dateOption = "This Weekend";
                } else if (preferences.date_option === "custom") {
                  dateOption = "Pick a Date";
                }

                return {
                  dateOption: dateOption,
                  timeSlot: (preferences as any).time_slot || null,
                  selectedDate: preferences.datetime_pref || null,
                  weekendDay: null, // Weekend day not stored separately, will be inferred if needed
                  exactTime: null, // Exact time not stored, user will need to re-enter if needed
                };
              }

              // Legacy format: try to parse as JSON or handle as timestamp
              try {
                if (typeof preferences.datetime_pref === "string") {
                  // Check if it's a timestamp (ISO string) or JSON
                  if (
                    preferences.datetime_pref.includes("T") &&
                    preferences.datetime_pref.includes("Z")
                  ) {
                    // It's a timestamp, treat as "Now" or legacy format
                    return {
                      dateOption: "Now",
                      timeSlot: null,
                      selectedDate: preferences.datetime_pref,
                      weekendDay: null,
                    };
                  }
                  // Try to parse as JSON (legacy format)
                  const parsed = JSON.parse(preferences.datetime_pref);
                  if (
                    parsed &&
                    typeof parsed === "object" &&
                    !Array.isArray(parsed)
                  ) {
                    // Legacy object format - convert to new structure if possible
                    return {
                      dateOption: null,
                      timeSlot: parsed.timeSlots?.[0] || null,
                      selectedDate: null,
                      weekendDay: null,
                    };
                  }
                }
              } catch (parseError) {
                // If parsing fails, return default
                console.warn(
                  "Failed to parse datetime_pref, using default:",
                  parseError
                );
              }

              // Default fallback
              return {
                dateOption: null,
                timeSlot: null,
                selectedDate: null,
                weekendDay: null,
                exactTime: null,
              };
            })(),
            groupSize: preferences.people_count || 1,
          }));
        }
      } catch (error) {
        console.error("Error loading preferences for resume:", error);
      }

      // Resume from saved onboarding_step
      // If onboarding_step exists and is valid (2-10), use it
      // Otherwise, default to step 2 (Intent Selection - first tracked step)
      const savedStep = profile.onboarding_step;
      if (savedStep !== null && savedStep !== undefined) {
        if (savedStep === 0) {
          // Onboarding completed, but has_completed_onboarding might be false
          // This shouldn't happen, but handle it gracefully
          return;
        }
        if (savedStep >= 2 && savedStep <= 10) {
          // Valid step, resume from here - this takes priority
          setCurrentStep(savedStep);
          return;
        }
      }

      // No valid onboarding_step found
      // The other useEffect will handle skipping to step 2 for first-time users
      // But if we're already past step 1, don't change it
    };

    if (user && profile) {
      resumeFromOnboardingStep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, profile]); // updateOnboardingStep is stable (only depends on user?.id)

  // Update onboarding data when user/profile changes
  useEffect(() => {
    if (user || profile) {
      const displayName =
        profile?.display_name ||
        profile?.first_name ||
        user?.email?.split("@")[0] ||
        "User";
      setOnboardingData((prev: any) => ({
        ...prev,
        userProfile: {
          name: displayName,
          email: user?.email || "",
          profileImage: profile?.avatar_url || null,
        },
      }));
    }
  }, [user, profile]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "white",
    },
    loaderContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: "white",
    },
  });

  const handleNext = async () => {
    // Validate step 2: require at least one intent to be selected
    if (currentStep === 2) {
      if (!onboardingData.intents || onboardingData.intents.length === 0) {
        Alert.alert(
          "Selection Required",
          "Please select at least one intent to continue.",
          [{ text: "OK" }]
        );
        return;
      }
    }

    // Validate step 3: require at least one vibe to be selected
    if (currentStep === 3) {
      if (!onboardingData.vibes || onboardingData.vibes.length === 0) {
        Alert.alert(
          "Selection Required",
          "Please select at least one vibe to continue.",
          [{ text: "OK" }]
        );
        return;
      }
    }

    // Validate step 4: require location to be entered
    if (currentStep === 4) {
      if (
        !onboardingData.location ||
        onboardingData.location.trim().length === 0
      ) {
        Alert.alert(
          "Location Required",
          "Please enter your location to continue.",
          [{ text: "OK" }]
        );
        return;
      }
    }

    // Save preferences for current step before moving to next
    let saveSuccess = true;

    if (currentStep === 2) {
      // Step 2: Intent Selection - Create preferences record
      saveSuccess = await saveStep2Preferences();
    } else if (currentStep === 3) {
      // Step 3: Vibe Selection - Merge with existing categories
      saveSuccess = await saveStep3Preferences();
    } else if (currentStep === 4) {
      // Step 4: Location Setup
      saveSuccess = await saveStep4Preferences();
    } else if (currentStep === 5) {
      // Step 5: Travel Mode
      saveSuccess = await saveStep5Preferences();
    } else if (currentStep === 6) {
      // Step 6: Travel Constraint
      saveSuccess = await saveStep6Preferences();
    } else if (currentStep === 7) {
      // Step 7: Budget Range
      saveSuccess = await saveStep7Preferences();
    } else if (currentStep === 8) {
      // Step 8: Date/Time Preferences
      try {
        saveSuccess = await saveStep8Preferences();
      } catch (error: any) {
        console.error("Error in saveStep8Preferences:", error);
        alert(
          error?.message ||
            "Failed to save date/time preferences. Please try again."
        );
        saveSuccess = false;
      }
    }

    // If save failed, prevent moving to next step
    if (!saveSuccess) {
      // Error alert already shown in catch block above
      return;
    }

    // Move to next step or complete
    if (currentStep < totalSteps) {
      const nextStep = currentStep + 1;

      // Update onboarding_step to the next step (only for tracked steps 2-10)
      // Step 1 (Account Setup) is not tracked, so we start tracking from step 2
      // When completing step 2, update to 3; when completing step 3, update to 4, etc.
      if (currentStep >= 2 && currentStep <= 9) {
        // Current step is a tracked step (2-9), update to next step
        await updateOnboardingStep(nextStep);
      } else if (currentStep === 1) {
        // Completing step 1 (Account Setup), next step is 2 (first tracked step)
        await updateOnboardingStep(2);
      }
      // Step 10 (Magic Step) handles its own completion and sets onboarding_step to 0

      setCurrentStep(nextStep);
    } else {
      // Complete onboarding - this shouldn't happen as totalSteps is 10
      // The Magic Step (step 10) handles completion separately
      onComplete(onboardingData);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(Math.max(1, currentStep - 1));
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
      [key]: value,
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
        intents: updatedIntents,
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
        vibes: updatedVibes,
      };
    });
  }, []);

  const handleFriendInvite = useCallback((friend: any) => {
    setOnboardingData((prev: any) => {
      const currentInvited = prev.invitedFriends || [];
      const isAlreadyInvited = currentInvited.some(
        (f: any) => f.id === friend.id
      );

      if (isAlreadyInvited) {
        return {
          ...prev,
          invitedFriends: currentInvited.filter((f: any) => f.id !== friend.id),
        };
      } else {
        return {
          ...prev,
          invitedFriends: [...currentInvited, friend],
        };
      }
    });
  }, []);

  const requestLocationPermission = useCallback(async () => {
    try {
      // Request location permissions
      const hasPermission = await locationService.requestPermissions();

      if (hasPermission) {
        // Try to get current location
        const locationData = await locationService.getCurrentLocation();

        if (locationData) {
          // Reverse geocode to get city name
          const cityName = await locationService.reverseGeocode(
            locationData.latitude,
            locationData.longitude
          );

          if (cityName) {
            // Update onboarding data with city name
            updateOnboardingData("location", cityName);
          } else {
            // Fallback to coordinates if reverse geocode fails
            const locationString = `${locationData.latitude.toFixed(
              4
            )}, ${locationData.longitude.toFixed(4)}`;
            updateOnboardingData("location", locationString);
          }
        } else {
          updateOnboardingData("location", "San Francisco, CA");
        }
      } else {
        updateOnboardingData("location", "San Francisco, CA");
      }
    } catch (error: any) {
      console.error("Error requesting location permission:", error);

      // Check if it's a configuration error
      if (error.message && error.message.includes("NSLocation")) {
        // Show a more user-friendly message
        alert(
          "Location services are not properly configured. Using default location for demo purposes."
        );
      } else if (error.message && error.message.includes("Info.plist")) {
        alert(
          "Location permissions are not configured in the app. Using default location for demo purposes."
        );
      }

      // Fallback to default location
      updateOnboardingData("location", "San Francisco, CA");
    }
  }, [updateOnboardingData]);

  const renderStep = () => {
    switch (currentStep) {
      case 0: // Welcome Screen
        return <WelcomeStep onNext={handleNext} onBack={handleBackToWelcome} />;

      case 1: // Account Setup
        return (
          <AccountSetupStep
            onNext={handleNext}
            onBack={handleBackToWelcome}
            onNavigateToSignUp={onNavigateToSignUpForm || onNavigateToSignUp}
            onNavigateToPhoneSignUp={() => setShowPhoneSignUp(true)}
            onNavigateToGoogleSignIn={handleGoogleSignIn}
            onNavigateToAppleSignIn={handleAppleSignIn}
            userProfile={onboardingData.userProfile}
            accountType={onboardingData.account_type}
          />
        );

      case 2: // Intent Selection
        return (
          <IntentSelectionStep
            onNext={handleNext} // Will save Step 2 preferences before moving
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
            intents={onboardingData.intents}
          />
        );

      case 4: // Location Setup
        return (
          <LocationSetupStep
            onNext={handleNext}
            onBack={handleBack}
            location={onboardingData.location}
            onLocationChange={(location) =>
              updateOnboardingData("location", location)
            }
            onRequestLocationPermission={requestLocationPermission}
          />
        );

      case 5: // Travel Mode
        return (
          <TravelModeStep
            onNext={handleNext}
            onBack={handleBack}
            travelMode={onboardingData.travelMode}
            onTravelModeChange={(mode) =>
              updateOnboardingData("travelMode", mode)
            }
          />
        );

      case 6: // Travel Constraint
        return (
          <TravelConstraintStep
            onNext={handleNext}
            onBack={handleBack}
            constraintType={onboardingData.travelConstraintType}
            constraintValue={onboardingData.travelConstraintValue}
            onConstraintTypeChange={(type: string) =>
              updateOnboardingData("travelConstraintType", type)
            }
            onConstraintValueChange={(value: number) =>
              updateOnboardingData("travelConstraintValue", value)
            }
          />
        );

      case 7: // Budget Range
        return (
          <BudgetRangeStep
            onNext={handleNext}
            onBack={handleBack}
            budgetRange={onboardingData.budgetRange}
            onBudgetRangeChange={(range) =>
              updateOnboardingData("budgetRange", range)
            }
          />
        );

      case 8: // Date/Time Preferences
        return (
          <DateTimePrefStep
            onNext={handleNext}
            onBack={handleBack}
            dateTimePref={onboardingData.dateTimePref}
            onDateTimePrefChange={(pref) => {
              updateOnboardingData("dateTimePref", pref);
            }}
          />
        );

      case 9: // Invite Friends (Optional - can skip)
        return (
          <InviteFriendsStep
            onNext={handleNext}
            onBack={handleBack}
            invitedFriends={onboardingData.invitedFriends}
            onFriendInvite={handleFriendInvite}
          />
        );

      case 10: // Magic Step (Completion)
        return (
          <MagicStep
            onComplete={async (data: any) => {
              // Mark onboarding as complete only at the final step
              await handleMarkOnboardingComplete();
              onComplete(data || onboardingData);
            }}
            onBack={handleBack}
            onboardingData={onboardingData}
            onNavigateToStep={(step: number) => {
              setCurrentStep(step);
            }}
          />
        );

      default:
        return null;
    }
  };

  // Handle phone signup
  const handlePhoneSignUp = async (userData: {
    phone: string;
    password: string;
    username: string;
  }) => {
    try {
      const result = await signUpWithPhone(
        userData.phone,
        userData.password,
        userData.username,
        onboardingData.account_type || undefined // Pass account_type from onboardingData
      );

      if (result.error) {
        throw new Error(result.error.message || "Failed to send OTP");
      }

      // Store phone number and show OTP screen
      setPhoneNumber(userData.phone);
      setShowPhoneSignUp(false);
      setShowOTP(true);
    } catch (error: any) {
      console.error("Phone signup error:", error);
      alert(error.message || "Failed to send OTP. Please try again.");
    }
  };

  // Handle OTP verification
  const handleOTPVerify = async (otp: string) => {
    try {
      const result = await verifyPhoneOTP(phoneNumber, otp);

      if (result.error) {
        throw new Error(result.error.message || "Invalid OTP");
      }

      // OTP verified successfully, continue with onboarding
      setShowOTP(false);
      // User is now authenticated, onboarding will continue
      // The useAuthSimple hook will update the user state
    } catch (error: any) {
      console.error("OTP verification error:", error);
      throw error; // Let OTPScreen handle the error display
    }
  };

  // Handle OTP resend
  const handleOTPResend = async () => {
    try {
      const result = await resendPhoneOTP(phoneNumber);
      if (result.error) {
        throw new Error(result.error.message || "Failed to resend OTP");
      }
    } catch (error: any) {
      console.error("Resend OTP error:", error);
      throw error;
    }
  };

  // Step 2: Save intents to categories (creates preferences record if doesn't exist)
  const saveStep2Preferences = useCallback(async (): Promise<boolean> => {
    if (!user?.id) {
      console.error("Cannot save Step 2 preferences: No user ID");
      return false;
    }

    try {
      const { supabase } = await import("../services/supabase");

      // Validate that at least one intent is selected
      if (!onboardingData.intents || onboardingData.intents.length === 0) {
        console.error("Cannot save Step 2 preferences: No intents selected");
        Alert.alert(
          "Selection Required",
          "Please select at least one intent to continue."
        );
        return false;
      }

      // Map intents to category names (intent IDs)
      const intentCategories =
        onboardingData.intents?.map((intent: any) =>
          typeof intent === "string"
            ? intent
            : intent.name || intent.id || intent.category || intent
        ) || [];

      // Get existing preferences to preserve vibe categories
      const { data: existingPrefs } = await supabase
        .from("preferences")
        .select("categories")
        .eq("profile_id", user.id)
        .single();

      const existingCategories = existingPrefs?.categories || [];

      // Known intent IDs - filter these out to preserve only vibe categories
      const intentIds = new Set([
        "solo-adventure",
        "first-dates",
        "romantic",
        "friendly",
        "group-fun",
        "business",
      ]);

      // Extract existing vibe categories (non-intent IDs)
      const existingVibeCategories = existingCategories.filter(
        (cat: string) => !intentIds.has(cat)
      );

      // Combine new intent IDs with existing vibe categories
      const allCategories = [
        ...new Set([...intentCategories, ...existingVibeCategories]),
      ];

      // Create or update preferences with Step 2 data
      const { data, error } = await supabase
        .from("preferences")
        .upsert(
          {
            profile_id: user.id,
            categories: allCategories,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "profile_id",
          }
        )
        .select()
        .single();

      if (error) {
        console.error("Error saving Step 2 preferences:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error saving Step 2 preferences:", error);
      return false;
    }
  }, [user?.id, onboardingData.intents]);

  // Step 3: Merge vibes with existing categories
  const saveStep3Preferences = useCallback(async (): Promise<boolean> => {
    if (!user?.id) {
      console.error("Cannot save Step 3 preferences: No user ID");
      return false;
    }

    try {
      const { supabase } = await import("../services/supabase");

      // Get existing preferences to merge with
      const { data: existingPrefs } = await supabase
        .from("preferences")
        .select("categories")
        .eq("profile_id", user.id)
        .single();

      // Validate that at least one vibe is selected
      if (!onboardingData.vibes || onboardingData.vibes.length === 0) {
        console.error("Cannot save Step 3 preferences: No vibes selected");
        Alert.alert(
          "Selection Required",
          "Please select at least one vibe to continue."
        );
        return false;
      }

      const existingCategories = existingPrefs?.categories || [];

      // Map vibes to category names (vibe IDs)
      const vibeCategories =
        onboardingData.vibes?.map((vibe: any) =>
          typeof vibe === "string" ? vibe : vibe.name || vibe.id || vibe
        ) || [];

      // Known intent IDs - filter these out to preserve only intent categories
      const intentIds = new Set([
        "solo-adventure",
        "first-dates",
        "romantic",
        "friendly",
        "group-fun",
        "business",
      ]);

      // Extract existing intent categories (preserve intent IDs from step 2)
      const existingIntentCategories = existingCategories.filter(
        (cat: string) => intentIds.has(cat)
      );

      // Combine new vibe categories with existing intent categories and remove duplicates
      const mergedCategories = [
        ...new Set([...existingIntentCategories, ...vibeCategories]),
      ];

      // Update only categories field
      const { data, error } = await supabase
        .from("preferences")
        .update({
          categories: mergedCategories,
          updated_at: new Date().toISOString(),
        })
        .eq("profile_id", user.id)
        .select()
        .single();

      if (error) {
        console.error("Error saving Step 3 preferences:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error saving Step 3 preferences:", error);
      return false;
    }
  }, [user?.id, onboardingData.vibes]);

  // Step 4: Save location to custom_location
  const saveStep4Preferences = useCallback(async (): Promise<boolean> => {
    if (!user?.id) {
      console.error("Cannot save Step 4 preferences: No user ID");
      return false;
    }

    try {
      const { supabase } = await import("../services/supabase");

      // Update only custom_location field
      const { data, error } = await supabase
        .from("preferences")
        .update({
          custom_location: onboardingData.location || null,
          updated_at: new Date().toISOString(),
        })
        .eq("profile_id", user.id)
        .select()
        .single();

      if (error) {
        console.error("Error saving Step 4 preferences:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error saving Step 4 preferences:", error);
      return false;
    }
  }, [user?.id, onboardingData.location]);

  // Step 5: Save travel mode
  const saveStep5Preferences = useCallback(async (): Promise<boolean> => {
    if (!user?.id) {
      console.error("Cannot save Step 5 preferences: No user ID");
      return false;
    }

    try {
      const { supabase } = await import("../services/supabase");

      // Update only travel_mode field
      const { data, error } = await supabase
        .from("preferences")
        .update({
          travel_mode: onboardingData.travelMode || "walking",
          updated_at: new Date().toISOString(),
        })
        .eq("profile_id", user.id)
        .select()
        .single();

      if (error) {
        console.error("Error saving Step 5 preferences:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error saving Step 5 preferences:", error);
      return false;
    }
  }, [user?.id, onboardingData.travelMode]);

  // Step 6: Save travel constraint
  const saveStep6Preferences = useCallback(async (): Promise<boolean> => {
    if (!user?.id) {
      console.error("Cannot save Step 6 preferences: No user ID");
      return false;
    }

    try {
      const { supabase } = await import("../services/supabase");

      // Update only travel constraint fields
      const { data, error } = await supabase
        .from("preferences")
        .update({
          travel_constraint_type: onboardingData.travelConstraintType || "time",
          travel_constraint_value: onboardingData.travelConstraintValue ?? 30,
          updated_at: new Date().toISOString(),
        })
        .eq("profile_id", user.id)
        .select()
        .single();

      if (error) {
        console.error("Error saving Step 6 preferences:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error saving Step 6 preferences:", error);
      return false;
    }
  }, [
    user?.id,
    onboardingData.travelConstraintType,
    onboardingData.travelConstraintValue,
  ]);

  // Step 7: Save budget range
  const saveStep7Preferences = useCallback(async (): Promise<boolean> => {
    if (!user?.id) {
      console.error("Cannot save Step 7 preferences: No user ID");
      return false;
    }

    try {
      const { supabase } = await import("../services/supabase");

      // Update only budget fields
      const budgetRange = onboardingData.budgetRange || { min: 0, max: 1000 };
      const { data, error } = await supabase
        .from("preferences")
        .update({
          budget_min: budgetRange.min ?? 0,
          budget_max: budgetRange.max ?? 1000,
          updated_at: new Date().toISOString(),
        })
        .eq("profile_id", user.id)
        .select()
        .single();

      if (error) {
        console.error("Error saving Step 7 preferences:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error saving Step 7 preferences:", error);
      return false;
    }
  }, [user?.id, onboardingData.budgetRange]);

  // Helper function to parse HH:MM AM/PM time string to hours and minutes
  const parseTimeString = (
    timeStr: string
  ): { hours: number; minutes: number } | null => {
    if (!timeStr || !timeStr.trim()) return null;

    // Remove extra spaces and convert to uppercase for easier parsing
    const cleaned = timeStr.trim().toUpperCase();

    // Match patterns like "11:30 AM", "2:15 PM", "11:30AM", etc.
    const timePattern = /(\d{1,2}):(\d{2})\s*(AM|PM)/i;
    const match = cleaned.match(timePattern);

    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();

    // Convert to 24-hour format
    if (period === "PM" && hours !== 12) {
      hours += 12;
    } else if (period === "AM" && hours === 12) {
      hours = 0;
    }

    // Validate hours and minutes
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }

    return { hours, minutes };
  };

  // Helper function to calculate next weekend day (Saturday or Sunday)
  const getNextWeekendDay = (): Date => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday

    let targetDate = new Date(today);

    if (dayOfWeek === 0) {
      // Today is Sunday, use next Saturday (6 days away)
      targetDate.setDate(today.getDate() + 6);
    } else if (dayOfWeek === 6) {
      // Today is Saturday, use next Sunday (1 day away)
      targetDate.setDate(today.getDate() + 1);
    } else if (dayOfWeek < 6) {
      // Today is Monday-Friday, use next Saturday
      const daysUntilSaturday = 6 - dayOfWeek;
      targetDate.setDate(today.getDate() + daysUntilSaturday);
    }

    targetDate.setHours(0, 0, 0, 0);
    return targetDate;
  };

  // Step 8: Save date/time preferences
  const saveStep8Preferences = useCallback(async (): Promise<boolean> => {
    if (!user?.id) {
      console.error("Cannot save Step 8 preferences: No user ID");
      return false;
    }

    try {
      const { supabase } = await import("../services/supabase");

      const dateTimePref = onboardingData.dateTimePref || {
        dateOption: null,
        timeSlot: null,
        selectedDate: null,
        weekendDay: null,
        exactTime: null,
      };

      // Determine date_option and time_slot values
      let dateOptionToSave: string | null = null;
      let timeSlotToSave: string | null = null;

      if (dateTimePref.dateOption === "Now") {
        dateOptionToSave = "now";
        timeSlotToSave = null;
      } else if (dateTimePref.dateOption === "Today") {
        dateOptionToSave = "today";
        // Save time_slot only if exactTime is not used
        if (
          dateTimePref.exactTime &&
          dateTimePref.exactTime.trim().length > 0
        ) {
          timeSlotToSave = null;
        } else {
          timeSlotToSave = dateTimePref.timeSlot || null;
        }
      } else if (dateTimePref.dateOption === "This Weekend") {
        dateOptionToSave = "weekend";
        // Save time_slot only if exactTime is not used
        if (
          dateTimePref.exactTime &&
          dateTimePref.exactTime.trim().length > 0
        ) {
          timeSlotToSave = null;
        } else {
          timeSlotToSave = dateTimePref.timeSlot || null;
        }
      } else if (dateTimePref.dateOption === "Pick a Date") {
        dateOptionToSave = "custom";
        // Save time_slot only if exactTime is not used
        if (
          dateTimePref.exactTime &&
          dateTimePref.exactTime.trim().length > 0
        ) {
          timeSlotToSave = null;
        } else {
          timeSlotToSave = dateTimePref.timeSlot || null;
        }
      }

      // Calculate ISO timestamp (datetime_pref) based on selections
      let calculatedDateTime: string;
      const now = new Date();

      if (dateTimePref.dateOption === "Now") {
        // Current timestamp within the hour
        calculatedDateTime = now.toISOString();
      } else if (dateTimePref.dateOption === "Today") {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Prefer exact time over time slot
        if (
          dateTimePref.exactTime &&
          dateTimePref.exactTime.trim().length > 0
        ) {
          const parsedTime = parseTimeString(dateTimePref.exactTime);
          if (parsedTime) {
            today.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
            calculatedDateTime = today.toISOString();
          } else {
            // Invalid time format, fallback to current time
            calculatedDateTime = now.toISOString();
          }
        } else if (dateTimePref.timeSlot) {
          // Use time slot
          const timeSlotHours: { [key: string]: number } = {
            brunch: 11,
            afternoon: 14,
            dinner: 18,
            lateNight: 22,
          };
          const startHour = timeSlotHours[dateTimePref.timeSlot] || 11;
          today.setHours(startHour, 0, 0, 0);
          calculatedDateTime = today.toISOString();
        } else {
          // Fallback to current time
          calculatedDateTime = now.toISOString();
        }
      } else if (dateTimePref.dateOption === "This Weekend") {
        // Get next weekend day (Saturday or Sunday)
        const weekendDate = getNextWeekendDay();

        // Prefer exact time over time slot
        if (
          dateTimePref.exactTime &&
          dateTimePref.exactTime.trim().length > 0
        ) {
          const parsedTime = parseTimeString(dateTimePref.exactTime);
          if (parsedTime) {
            weekendDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
            calculatedDateTime = weekendDate.toISOString();
          } else {
            // Invalid time format, fallback to current time
            calculatedDateTime = now.toISOString();
          }
        } else if (dateTimePref.timeSlot) {
          // Use time slot
          const timeSlotHours: { [key: string]: number } = {
            brunch: 11,
            afternoon: 14,
            dinner: 18,
            lateNight: 22,
          };
          const startHour = timeSlotHours[dateTimePref.timeSlot] || 11;
          weekendDate.setHours(startHour, 0, 0, 0);
          calculatedDateTime = weekendDate.toISOString();
        } else {
          // Fallback to current time
          calculatedDateTime = now.toISOString();
        }
      } else if (dateTimePref.dateOption === "Pick a Date") {
        if (!dateTimePref.selectedDate) {
          // No date selected, fallback to current time
          calculatedDateTime = now.toISOString();
        } else {
          const selectedDate = new Date(dateTimePref.selectedDate);
          selectedDate.setHours(0, 0, 0, 0);

          // Prefer exact time over time slot
          if (
            dateTimePref.exactTime &&
            dateTimePref.exactTime.trim().length > 0
          ) {
            const parsedTime = parseTimeString(dateTimePref.exactTime);
            if (parsedTime) {
              selectedDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
              calculatedDateTime = selectedDate.toISOString();
            } else {
              // Invalid time format, fallback to current time
              calculatedDateTime = now.toISOString();
            }
          } else if (dateTimePref.timeSlot) {
            // Use time slot
            const timeSlotHours: { [key: string]: number } = {
              brunch: 11,
              afternoon: 14,
              dinner: 18,
              lateNight: 22,
            };
            const startHour = timeSlotHours[dateTimePref.timeSlot] || 11;
            selectedDate.setHours(startHour, 0, 0, 0);
            calculatedDateTime = selectedDate.toISOString();
          } else {
            // Fallback to current time
            calculatedDateTime = now.toISOString();
          }
        }
      } else {
        // Fallback to current time
        calculatedDateTime = now.toISOString();
      }

      // Update date_option, time_slot, and datetime_pref fields
      // Use upsert to ensure the record exists (in case it wasn't created in previous steps)
      const updateData: any = {
        profile_id: user.id,
        date_option: dateOptionToSave,
        datetime_pref: calculatedDateTime,
        updated_at: new Date().toISOString(),
      };

      // Always include time_slot (even if null) - let the database handle null values
      // If the column doesn't exist, the error handler will retry without it
      updateData.time_slot = timeSlotToSave;

      const { data, error } = await supabase
        .from("preferences")
        .upsert(updateData, {
          onConflict: "profile_id",
        })
        .select()
        .single();

      if (error) {
        console.error("Error saving Step 8 preferences:", error);
        console.error("Error code:", error.code);
        console.error("Error message:", error.message);
        console.error("Error details:", JSON.stringify(error, null, 2));

        // Check if it's a column doesn't exist error (PostgreSQL error code 42703)
        const isColumnError =
          error.code === "42703" ||
          (error.message &&
            error.message.includes("column") &&
            error.message.includes("does not exist")) ||
          error.message.includes("time_slot");

        if (isColumnError) {
          console.warn(
            "time_slot column might not exist in database. Please run migration: 20250127000005_add_time_slot_to_preferences.sql"
          );
          // Retry without time_slot to allow saving other fields
          const retryData: any = {
            profile_id: user.id,
            date_option: dateOptionToSave,
            datetime_pref: calculatedDateTime,
            updated_at: new Date().toISOString(),
          };

          const { data: retryDataResult, error: retryError } = await supabase
            .from("preferences")
            .upsert(retryData, {
              onConflict: "profile_id",
            })
            .select()
            .single();

          if (retryError) {
            console.error(
              "Error saving Step 8 preferences (retry without time_slot):",
              retryError
            );
            throw new Error(
              `Failed to save preferences: ${retryError.message}. Please ensure the database migrations have been run.`
            );
          }

          // Still return true since the main data was saved
          return true;
        }

        // For other errors, throw with more context
        throw new Error(
          `Failed to save preferences: ${
            error.message || "Unknown error"
          }. Error code: ${error.code || "N/A"}`
        );
      }

      return true;
    } catch (error: any) {
      console.error("Error saving Step 8 preferences (catch):", error);
      console.error("Error message:", error?.message);
      console.error("Error stack:", error?.stack);

      // Check for network errors
      if (
        error?.message?.includes("Network request failed") ||
        error?.message?.includes("fetch") ||
        error?.code === "ECONNREFUSED"
      ) {
        console.error(
          "Network request failed - Possible causes:",
          "\n1. Supabase connection configuration issue",
          "\n2. Database migrations not run (especially 20250127000005_add_time_slot_to_preferences.sql)",
          "\n3. Network connectivity problem",
          "\n4. Supabase service unavailable"
        );
        // Re-throw with user-friendly message
        throw new Error(
          "Network error: Unable to connect to the database. Please check your internet connection and ensure the database migrations have been run."
        );
      }

      // Re-throw the error so it can be caught and displayed to the user
      throw error;
    }
  }, [user?.id, onboardingData.dateTimePref]);

  // Mark onboarding as complete in the database (preferences already saved incrementally)
  const handleMarkOnboardingComplete = useCallback(async () => {
    if (!user?.id) {
      console.error("Cannot mark onboarding complete: No user ID");
      return;
    }

    try {
      const { supabase } = await import("../services/supabase");

      // Mark onboarding as complete and set onboarding_step to 0
      // (preferences already saved incrementally at each step)
      const { data, error } = await supabase
        .from("profiles")
        .update({
          has_completed_onboarding: true,
          onboarding_step: 0,
        })
        .eq("id", user.id)
        .select()
        .single();

      if (error) {
        console.error("Error marking onboarding complete:", error);
      } else {
        // Update profile in store to reflect the change
        if (data) {
          const { useAppStore } = await import("../store/appStore");
          useAppStore.getState().setProfile(data);
        }
      }
    } catch (error) {
      console.error("Error updating onboarding status:", error);
    }
  }, [user?.id]);

  const handleGoogleSignIn = async () => {
    // Show loader immediately when sign-in starts
    setIsSigningInWithCompletedOnboarding(true);

    try {
      const result = await signInWithGoogle();

      if (result.error) {
        // Hide loader on error
        setIsSigningInWithCompletedOnboarding(false);

        // Only show error if it's not a cancellation
        if (result.error.message !== "Sign-in cancelled") {
          console.error("Google sign-in error:", result.error);
          Alert.alert(
            "Error",
            result.error.message ||
              "Failed to sign in with Google. Please try again."
          );
        }
        return;
      }

      // Google sign-in successful
      // Wait a moment for profile to be loaded by useAuthSimple
      // Try multiple times to get the updated profile
      let currentProfile = useAppStore.getState().profile;
      let currentUser = useAppStore.getState().user;
      let attempts = 0;

      while ((!currentProfile || !currentUser) && attempts < 5) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        currentProfile = useAppStore.getState().profile;
        currentUser = useAppStore.getState().user;
        attempts++;
      }

      // Check if user has completed onboarding
      if (
        currentUser &&
        currentProfile &&
        currentProfile.has_completed_onboarding === true
      ) {
        // User has completed onboarding - close onboarding flow and let app redirect to home
        if (onBackToWelcome) {
          onBackToWelcome();
        }
        // Also call onComplete to ensure state is updated
        if (onComplete) {
          onComplete(onboardingData || {});
        }

        // Hide loader after a short delay to allow navigation
        setTimeout(() => {
          setIsSigningInWithCompletedOnboarding(false);
        }, 1000);

        return;
      }

      // If user is authenticated and hasn't completed onboarding, hide loader and continue onboarding
      if (
        currentUser &&
        currentProfile &&
        currentProfile.has_completed_onboarding === false
      ) {
        // Hide loader and skip OTP screen, go directly to IntentSelectionStep (step 2)
        setIsSigningInWithCompletedOnboarding(false);
        setCurrentStep(2);
      } else {
        // Profile not loaded yet, keep loader showing
        // It will be hidden when profile loads or after timeout
      }

      // The app/index.tsx will check profile.has_completed_onboarding and redirect accordingly
    } catch (error: any) {
      // Hide loader on error
      setIsSigningInWithCompletedOnboarding(false);
      console.error("Google sign-in error:", error);
      Alert.alert(
        "Error",
        error.message || "Failed to sign in with Google. Please try again."
      );
    }
  };

  const handleAppleSignIn = async () => {
    // Show loader immediately when sign-in starts
    setIsSigningInWithCompletedOnboarding(true);

    try {
      const result = await signInWithApple();

      if (result.error) {
        // Hide loader on error
        setIsSigningInWithCompletedOnboarding(false);

        // Only show error if it's not a cancellation
        if (result.error.message !== "Sign-in cancelled") {
          console.error("Apple sign-in error:", result.error);
          Alert.alert(
            "Error",
            result.error.message ||
              "Failed to sign in with Apple. Please try again."
          );
        }
        return;
      }

      // Apple sign-in successful
      // Wait a moment for profile to be loaded by useAuthSimple
      // Try multiple times to get the updated profile
      let currentProfile = useAppStore.getState().profile;
      let currentUser = useAppStore.getState().user;
      let attempts = 0;

      while ((!currentProfile || !currentUser) && attempts < 5) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        currentProfile = useAppStore.getState().profile;
        currentUser = useAppStore.getState().user;
        attempts++;
      }

      // Check if user has completed onboarding
      if (
        currentUser &&
        currentProfile &&
        currentProfile.has_completed_onboarding === true
      ) {
        // User has completed onboarding - close onboarding flow and let app redirect to home
        if (onBackToWelcome) {
          onBackToWelcome();
        }
        // Also call onComplete to ensure state is updated
        if (onComplete) {
          onComplete(onboardingData || {});
        }

        // Hide loader after a short delay to allow navigation
        setTimeout(() => {
          setIsSigningInWithCompletedOnboarding(false);
        }, 1000);

        return;
      }

      // If user is authenticated and hasn't completed onboarding, hide loader and continue onboarding
      if (
        currentUser &&
        currentProfile &&
        currentProfile.has_completed_onboarding === false
      ) {
        // Hide loader and skip OTP screen, go directly to IntentSelectionStep (step 2)
        setIsSigningInWithCompletedOnboarding(false);
        setCurrentStep(2);
      } else {
        // Profile not loaded yet, keep loader showing
        // It will be hidden when profile loads or after timeout
      }

      // The app/index.tsx will check profile.has_completed_onboarding and redirect accordingly
    } catch (error: any) {
      // Hide loader on error
      setIsSigningInWithCompletedOnboarding(false);
      console.error("Apple sign-in error:", error);
      Alert.alert(
        "Error",
        error.message || "Failed to sign in with Apple. Please try again."
      );
    }
  };

  // Show full-screen loader if signing in with completed onboarding
  if (isSigningInWithCompletedOnboarding) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#eb7825" />
        </View>
      </SafeAreaView>
    );
  }

  // Show phone signup form if active
  if (showPhoneSignUp) {
    return (
      <PhoneSignUpForm
        onSignUp={handlePhoneSignUp}
        onBack={() => setShowPhoneSignUp(false)}
      />
    );
  }

  // Show OTP screen if active
  if (showOTP) {
    return (
      <OTPScreen
        phone={phoneNumber}
        onVerify={handleOTPVerify}
        onResend={handleOTPResend}
        onBack={() => {
          setShowOTP(false);
          setShowPhoneSignUp(true);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {renderStep()}
    </SafeAreaView>
  );
};

export default OnboardingFlow;
