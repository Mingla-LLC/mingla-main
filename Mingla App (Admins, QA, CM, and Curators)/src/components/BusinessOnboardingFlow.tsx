import React, { useState } from 'react';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';
import {
  BusinessOnboardingProgress,
  BusinessWelcomeStep,
  BusinessInfoStep,
  BusinessContactStep,
  BusinessLocationStep,
  BusinessMediaStep,
  BusinessVerificationStep,
  FirstExperienceStep,
  BusinessCompletionStep,
  BusinessOnboardingFlowProps,
  BusinessOnboardingData
} from './business-onboarding';
import { DEFAULT_BUSINESS_ONBOARDING_DATA, TOTAL_BUSINESS_STEPS } from './business-onboarding/constants';
import { saveBusinessOnboardingData } from './business-onboarding/helpers';

export default function BusinessOnboardingFlow({ onComplete, onBackToSignIn }: BusinessOnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [onboardingData, setOnboardingData] = useState<BusinessOnboardingData>(DEFAULT_BUSINESS_ONBOARDING_DATA);
  const [showFirstExperienceCreator, setShowFirstExperienceCreator] = useState(false);

  // Handle data updates
  const handleUpdate = (updates: Partial<BusinessOnboardingData>) => {
    setOnboardingData(prev => ({ ...prev, ...updates }));
  };

  // Handle editing from completion step
  const handleEditStep = (step: number) => {
    setCurrentStep(step);
  };

  // Navigation handlers
  const handleNext = () => {
    if (currentStep < TOTAL_BUSINESS_STEPS - 1) {
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
      case 0: // Welcome - first name, last name, email required
        return onboardingData.ownerFirstName.trim() && 
               onboardingData.ownerLastName.trim() && 
               onboardingData.email.trim() &&
               onboardingData.email.includes('@');
      case 1: // Business Info - business name, type, category required
        return onboardingData.businessName.trim() && 
               onboardingData.businessType !== '' &&
               onboardingData.businessCategory !== '';
      case 2: // Contact - phone and address required
        return onboardingData.phone.trim() && 
               onboardingData.address.trim();
      case 3: // Location - operating hours required
        return onboardingData.operatingHours.monday.isOpen !== undefined;
      case 4: // Media - at least one image required
        return onboardingData.photos.length >= 1;
      case 5: // Verification - terms accepted
        return onboardingData.termsAccepted;
      case 6: // First Experience - experience created
        return onboardingData.firstExperienceCreated;
      case 7: // Completion
        return true;
      default:
        return true;
    }
  };

  // Save and complete onboarding
  const handleComplete = async () => {
    await saveBusinessOnboardingData(onboardingData);
    onComplete(onboardingData);
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
        return <BusinessWelcomeStep {...stepProps} onBackToSignIn={onBackToSignIn} />;
      case 1:
        return <BusinessInfoStep {...stepProps} />;
      case 2:
        return <BusinessContactStep {...stepProps} />;
      case 3:
        return <BusinessLocationStep {...stepProps} />;
      case 4:
        return <BusinessMediaStep {...stepProps} />;
      case 5:
        return <BusinessVerificationStep {...stepProps} />;
      case 6:
        return <FirstExperienceStep {...stepProps} onShowExperienceCreator={() => setShowFirstExperienceCreator(true)} />;
      case 7:
        return (
          <BusinessCompletionStep 
            {...stepProps} 
            onEditStep={handleEditStep}
            onComplete={handleComplete}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Progress Bar - Only show from step 1 onwards */}
      {currentStep > 0 && currentStep < TOTAL_BUSINESS_STEPS - 1 && (
        <BusinessOnboardingProgress currentStep={currentStep} totalSteps={TOTAL_BUSINESS_STEPS} />
      )}

      {/* Step Content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          {renderStep()}
        </div>
      </div>

      {/* Navigation Buttons */}
      {currentStep > 0 && currentStep < TOTAL_BUSINESS_STEPS - 1 && (
        <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
            <Button
              variant="outline"
              onClick={handleBack}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>

            <Button
              onClick={handleNext}
              disabled={!canProceed()}
              className="flex items-center gap-2 bg-[#eb7825] hover:bg-[#d6691f] text-white"
            >
              {currentStep === TOTAL_BUSINESS_STEPS - 2 ? 'Review' : 'Continue'}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}