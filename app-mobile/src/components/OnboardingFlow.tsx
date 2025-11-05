import React, { useState, useCallback, useEffect } from "react";
import { StyleSheet, SafeAreaView, Alert } from "react-native";
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
  onNavigateToSignUp?: () => void;
  onBackToWelcome?: () => void;
  onNavigateToSignUpForm?: () => void;
  onGoogleSignInComplete?: () => void;
}

const OnboardingFlow = ({
  onComplete,
  onNavigateToSignUp,
  onBackToWelcome,
  onNavigateToSignUpForm,
  onGoogleSignInComplete,
}: OnboardingFlowProps) => {
  const {
    user,
    signUpWithPhone,
    verifyPhoneOTP,
    resendPhoneOTP,
    signInWithGoogle,
  } = useAuthSimple();
  const { profile } = useAppStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [showPhoneSignUp, setShowPhoneSignUp] = useState(false);

  // Helper function to update onboarding_step in profile
  const updateOnboardingStep = useCallback(
    async (step: number): Promise<boolean> => {
      if (!user?.id) {
        console.error("Cannot update onboarding step: No user ID");
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

        console.log(`Onboarding step updated to ${step}`);
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
        console.log(
          "Found saved onboarding_step, letting resume logic handle it"
        );
        return;
      }

      // No saved step - first time user, skip to Step 2
      setCurrentStep((prevStep) => {
        if (prevStep === 1) {
          console.log(
            "User authenticated (first time), skipping AccountSetupStep and going to IntentSelectionStep"
          );
          return 2;
        }
        return prevStep;
      });
    } else if (!user || !profile) {
      // User is not authenticated - ensure we're on Step 1 (AccountSetupStep)
      setCurrentStep((prevStep) => {
        if (prevStep !== 1) {
          console.log("User not authenticated, resetting to AccountSetupStep");
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
    intents: [], // Step 2: Intent Selection
    vibes: [], // Step 3: Vibe/Category Selection
    location: "San Francisco, CA", // Step 4: Location Setup
    travelMode: "walking", // Step 5: Travel Mode
    travelConstraintType: "time", // Step 6: Travel Constraint
    travelConstraintValue: 30, // Step 6: Travel Constraint value
    budgetRange: { min: 0, max: 1000 }, // Step 7: Budget Range { min, max }
    dateTimePref: {
      dateOption: null,
      timeSlot: null,
      selectedDate: null,
      weekendDay: null,
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
          // Load saved preferences into onboardingData
          setOnboardingData((prev: any) => ({
            ...prev,
            intents: preferences.mode ? [preferences.mode] : [],
            vibes: preferences.categories || [],
            location: prev.location || "San Francisco, CA", // Keep default if not set
            travelMode: preferences.travel_mode || "walking",
            travelConstraintType: preferences.travel_constraint_type || "time",
            travelConstraintValue: preferences.travel_constraint_value || 30,
            budgetRange: {
              min: preferences.budget_min || 0,
              max: preferences.budget_max || 1000,
            },
            dateTimePref: (() => {
              // Handle new structure: dateOption, timeSlot, selectedDate, weekendDay
              // If date_option exists, use new structure
              if (preferences.date_option) {
                return {
                  dateOption: preferences.date_option,
                  timeSlot: null, // Time slot not stored separately, will be inferred if needed
                  selectedDate: preferences.datetime_pref || null,
                  weekendDay: null, // Weekend day not stored separately, will be inferred if needed
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
          console.log(
            "onboarding_step is 0 but has_completed_onboarding is false - this is unexpected"
          );
          return;
        }
        if (savedStep >= 2 && savedStep <= 10) {
          // Valid step, resume from here - this takes priority
          console.log(`Resuming onboarding from step ${savedStep}`);
          setCurrentStep(savedStep);
          return;
        }
      }

      // No valid onboarding_step found
      // The other useEffect will handle skipping to step 2 for first-time users
      // But if we're already past step 1, don't change it
      console.log("No onboarding_step found, current step:", currentStep);
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
  });

  const handleNext = async () => {
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
      saveSuccess = await saveStep8Preferences();
    }

    // If save failed, prevent moving to next step
    if (!saveSuccess) {
      alert("Failed to save preferences. Please try again.");
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
      console.log("Requesting location permission...");

      // For now, let's skip the actual location request and just use the default
      // This avoids the Info.plist configuration issue in development
      console.log("Using default location for demo purposes");
      updateOnboardingData("location", "San Francisco, CA");

      // Show a message to the user
      alert(
        "Location services configured! Using San Francisco, CA for demo purposes."
      );

      // TODO: Uncomment this when the app is properly built with Info.plist configuration

      // Request location permissions
      const hasPermission = await locationService.requestPermissions();

      if (hasPermission) {
        console.log("Location permission granted, getting current location...");

        // Try to get current location
        const location = await locationService.getCurrentLocation();

        if (location) {
          console.log("Current location obtained:", location);
          // Update onboarding data with actual location
          updateOnboardingData(
            "location",
            `${location.latitude}, ${location.longitude}`
          );
        } else {
          console.log("Could not get current location, using default");
          updateOnboardingData("location", "San Francisco, CA");
        }
      } else {
        console.log("Location permission denied, using default location");
        updateOnboardingData("location", "San Francisco, CA");
      }
    } catch (error: any) {
      console.error("Error requesting location permission:", error);

      // Check if it's a configuration error
      if (error.message && error.message.includes("NSLocation")) {
        console.log(
          "Location configuration error detected - using default location"
        );
        // Show a more user-friendly message
        alert(
          "Location services are not properly configured. Using default location for demo purposes."
        );
      } else if (error.message && error.message.includes("Info.plist")) {
        console.log(
          "Info.plist configuration missing - using default location"
        );
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
            onBack={handleBack}
            onNavigateToSignUp={onNavigateToSignUpForm || onNavigateToSignUp}
            onNavigateToPhoneSignUp={() => setShowPhoneSignUp(true)}
            onNavigateToGoogleSignIn={handleGoogleSignIn}
            userProfile={onboardingData.userProfile}
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
        userData.username
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

      // Map intents to category names
      const intentCategories =
        onboardingData.intents?.map((intent: any) =>
          typeof intent === "string"
            ? intent
            : intent.name || intent.id || intent.category || intent
        ) || [];

      // Create or update preferences with Step 2 data
      const { data, error } = await supabase
        .from("preferences")
        .upsert(
          {
            profile_id: user.id,
            categories:
              intentCategories.length > 0
                ? intentCategories
                : ["Stroll", "Sip & Chill"], // Default if no intents
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

      console.log("Step 2 preferences saved successfully:", data);
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

      const existingCategories = existingPrefs?.categories || [];

      // Map vibes to category names
      const vibeCategories =
        onboardingData.vibes?.map((vibe: any) =>
          typeof vibe === "string" ? vibe : vibe.name || vibe.id || vibe
        ) || [];

      // Merge existing categories with new vibes and remove duplicates
      const mergedCategories = [
        ...new Set([...existingCategories, ...vibeCategories]),
      ];

      // Update only categories field
      const { data, error } = await supabase
        .from("preferences")
        .update({
          categories:
            mergedCategories.length > 0
              ? mergedCategories
              : ["Stroll", "Sip & Chill"],
          updated_at: new Date().toISOString(),
        })
        .eq("profile_id", user.id)
        .select()
        .single();

      if (error) {
        console.error("Error saving Step 3 preferences:", error);
        return false;
      }

      console.log("Step 3 preferences saved successfully:", data);
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

      console.log("Step 4 preferences saved successfully:", data);
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

      console.log("Step 5 preferences saved successfully:", data);
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

      console.log("Step 6 preferences saved successfully:", data);
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

      console.log("Step 7 preferences saved successfully:", data);
      return true;
    } catch (error) {
      console.error("Error saving Step 7 preferences:", error);
      return false;
    }
  }, [user?.id, onboardingData.budgetRange]);

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
      };

      // Calculate ISO timestamp based on selections
      let calculatedDateTime: string;

      if (dateTimePref.dateOption === "Now") {
        // Current timestamp when Next is clicked
        calculatedDateTime = new Date().toISOString();
      } else if (dateTimePref.dateOption === "Today" && dateTimePref.timeSlot) {
        // Today + selected time slot (start time)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Map time slot to start hour
        const timeSlotHours: { [key: string]: number } = {
          brunch: 11,
          afternoon: 14,
          dinner: 18,
          lateNight: 22,
        };

        const startHour = timeSlotHours[dateTimePref.timeSlot] || 11;
        today.setHours(startHour, 0, 0, 0);
        calculatedDateTime = today.toISOString();
      } else if (
        dateTimePref.dateOption === "This Weekend" &&
        dateTimePref.weekendDay &&
        dateTimePref.timeSlot
      ) {
        // Weekend day (Saturday or Sunday) + selected time slot
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday

        let targetDate = new Date(today);
        if (dateTimePref.weekendDay === "saturday") {
          // Calculate days until Saturday
          const daysUntilSaturday = dayOfWeek === 0 ? 6 : 6 - dayOfWeek;
          targetDate.setDate(today.getDate() + daysUntilSaturday);
        } else {
          // Sunday
          const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
          targetDate.setDate(today.getDate() + daysUntilSunday);
        }

        targetDate.setHours(0, 0, 0, 0);

        // Map time slot to start hour
        const timeSlotHours: { [key: string]: number } = {
          brunch: 11,
          afternoon: 14,
          dinner: 18,
          lateNight: 22,
        };

        const startHour = timeSlotHours[dateTimePref.timeSlot] || 11;
        targetDate.setHours(startHour, 0, 0, 0);
        calculatedDateTime = targetDate.toISOString();
      } else if (
        dateTimePref.dateOption === "Pick a Date" &&
        dateTimePref.selectedDate &&
        dateTimePref.timeSlot
      ) {
        // Selected date + selected time slot
        const selectedDate = new Date(dateTimePref.selectedDate);
        selectedDate.setHours(0, 0, 0, 0);

        // Map time slot to start hour
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
        calculatedDateTime = new Date().toISOString();
      }

      // Determine what to save in date_option:
      // - "Now" → save "Now"
      // - Other options with time slot → save the time slot (e.g., "brunch", "afternoon", "dinner", "lateNight")
      let dateOptionToSave: string | null = null;
      if (dateTimePref.dateOption === "Now") {
        dateOptionToSave = "Now";
      } else if (dateTimePref.timeSlot) {
        // Save the time slot when a time slot is selected
        dateOptionToSave = dateTimePref.timeSlot;
      }

      // Update date_option and datetime_pref fields
      const { data, error } = await supabase
        .from("preferences")
        .update({
          date_option: dateOptionToSave,
          datetime_pref: calculatedDateTime,
          updated_at: new Date().toISOString(),
        })
        .eq("profile_id", user.id)
        .select()
        .single();

      if (error) {
        console.error("Error saving Step 8 preferences:", error);
        return false;
      }

      console.log("Step 8 preferences saved successfully:", data);
      return true;
    } catch (error) {
      console.error("Error saving Step 8 preferences:", error);
      return false;
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
        console.log(
          "Onboarding marked as complete in database (onboarding_step set to 0)"
        );
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
    try {
      const result = await signInWithGoogle();

      if (result.error) {
        // Only show error if it's not a cancellation
        if (result.error.message !== "Sign-in cancelled") {
          console.error("Google sign-in error:", result.error);
          alert(
            result.error.message ||
              "Failed to sign in with Google. Please try again."
          );
        }
        return;
      }

      // Google sign-in successful
      // Check if user has completed onboarding
      // The app/index.tsx will check profile.has_completed_onboarding and redirect accordingly
      // Don't call onGoogleSignInComplete here - let the navigation logic handle it
    } catch (error: any) {
      console.error("Google sign-in error:", error);
      alert(
        error.message || "Failed to sign in with Google. Please try again."
      );
    }
  };

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

  return <SafeAreaView style={styles.container}>{renderStep()}</SafeAreaView>;
};

export default OnboardingFlow;
