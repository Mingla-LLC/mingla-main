import React, { useState, useEffect } from 'react';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import {
  OnboardingProgress,
  WelcomeStep,
  IntentStep,
  VibesStep,
  LocationStep,
  TravelModeStep,
  TravelConstraintStep,
  BudgetStep,
  DateTimeStep,
  InviteFriendsStep,
  CompletionStep,
  OnboardingFlowProps,
  OnboardingData
} from './onboarding';
import { DEFAULT_ONBOARDING_DATA, TOTAL_STEPS } from './onboarding/constants';
import { saveOnboardingData } from './utils/onboardingToPreferences';

export default function OnboardingFlow({ onComplete, onBackToSignIn }: OnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<OnboardingData>(DEFAULT_ONBOARDING_DATA);

  // Handle data updates
  const handleUpdate = (updates: Partial<OnboardingData>) => {
    setOnboardingData(prev => ({ ...prev, ...updates }));
  };

  // Handle editing from completion step
  const handleEditStep = (step: number) => {
    setCurrentStep(step);
  };

  // Navigation handlers
  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  // Determine if current step can proceed
  const canProceed = () => {
    switch (currentStep) {
      case 0: // Welcome - name and email required
        return onboardingData.userProfile.firstName.trim() && 
               onboardingData.userProfile.lastName.trim() && 
               onboardingData.userProfile.email.trim();
      case 1: // Intent - at least one required
        return onboardingData.intents.length > 0;
      case 2: // Vibes - at least one required
        return onboardingData.vibes.length > 0;
      case 3: // Location - required
        return onboardingData.location.trim().length > 0;
      case 4: // Travel Mode - always has default
        return true;
      case 5: // Travel Constraint - required
        return (onboardingData.constraintType === 'time' && onboardingData.timeConstraint !== '') ||
               (onboardingData.constraintType === 'distance' && onboardingData.distanceConstraint !== '');
      case 6: // Budget - required
        return onboardingData.budgetMin !== '' || onboardingData.budgetMax !== '' || onboardingData.budgetPreset !== '';
      case 7: // Date & Time - required
        if (onboardingData.datePreference === 'now') return true;
        if (onboardingData.datePreference === 'custom') {
          return onboardingData.datePreference !== '' && (onboardingData.timeSlot !== '' || onboardingData.exactTime !== '') && onboardingData.customDate !== '';
        }
        return onboardingData.datePreference !== '' && (onboardingData.timeSlot !== '' || onboardingData.exactTime !== '');
      case 8: // Invite Friends - optional
        return true;
      case 9: // Completion
        return true;
      default:
        return true;
    }
  };

  // Render current step
  const renderStep = () => {
    const stepProps = {
      data: onboardingData,
      onUpdate: handleUpdate,
      onNext: handleNext,
      onBack: handleBack
    };

    switch (currentStep) {
      case 0:
        return <WelcomeStep {...stepProps} onBackToSignIn={onBackToSignIn} />;
      case 1:
        return <IntentStep {...stepProps} />;
      case 2:
        return <VibesStep {...stepProps} />;
      case 3:
        return <LocationStep {...stepProps} />;
      case 4:
        return <TravelModeStep {...stepProps} />;
      case 5:
        return <TravelConstraintStep {...stepProps} />;
      case 6:
        return <BudgetStep {...stepProps} />;
      case 7:
        return <DateTimeStep {...stepProps} />;
      case 8:
        return <InviteFriendsStep {...stepProps} />;
      case 9:
        return <CompletionStep data={onboardingData} onEditStep={handleEditStep} />;
      default:
        return null;
    }
  };

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      {/* Progress Bar */}
      {currentStep > 0 && currentStep < TOTAL_STEPS - 1 && (
        <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-2 flex-shrink-0 mx-[0px] my-[30px]">
          <OnboardingProgress currentStep={currentStep} totalSteps={TOTAL_STEPS} />
          <div className="flex justify-between items-center mt-2 text-xs sm:text-sm text-gray-600">
            <span>Step {currentStep + 1} of {TOTAL_STEPS}</span>
            <span>{Math.round(((currentStep + 1) / TOTAL_STEPS) * 100)}% complete</span>
          </div>
        </div>
      )}

      {/* Step Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="h-full flex items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-3xl">
            {renderStep()}
          </div>
        </div>
      </div>

      {/* Navigation Buttons */}
      {currentStep > 0 && currentStep < TOTAL_STEPS - 1 && (
        <div className="bg-white border-t border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
            {/* Back Button */}
            <button
              onClick={handleBack}
              className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="text-sm sm:text-base">Back</span>
            </button>

            {/* Next Button */}
            <button
              onClick={handleNext}
              disabled={!canProceed()}
              className={`flex items-center space-x-2 px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl transition-all ${
                canProceed()
                  ? 'bg-[#eb7825] text-white hover:bg-[#d6691f] shadow-md hover:shadow-lg'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <span className="text-sm sm:text-base">
                {currentStep === TOTAL_STEPS - 2 ? 'Review' : 'Next'}
              </span>
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Get Started Button on Completion */}
      {currentStep === TOTAL_STEPS - 1 && (
        <div className="bg-white border-t border-gray-100 px-4 sm:px-6 py-4 flex-shrink-0">
          <div className="max-w-3xl mx-auto">
            <button
              onClick={() => {
                // Save onboarding data to localStorage
                saveOnboardingData(onboardingData);
                // Complete onboarding
                onComplete(onboardingData);
              }}
              className="w-full flex items-center justify-center space-x-2 px-8 py-3 bg-[#eb7825] text-white rounded-xl hover:bg-[#d6691f] shadow-md hover:shadow-lg transition-all"
            >
              <span>Get Started</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}