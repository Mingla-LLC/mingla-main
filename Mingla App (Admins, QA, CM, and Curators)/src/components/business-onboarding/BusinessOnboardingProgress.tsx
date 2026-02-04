import React from 'react';

interface BusinessOnboardingProgressProps {
  currentStep: number;
  totalSteps: number;
}

export default function BusinessOnboardingProgress({ currentStep, totalSteps }: BusinessOnboardingProgressProps) {
  const progress = ((currentStep) / (totalSteps - 1)) * 100;

  const stepLabels = [
    'Welcome',
    'Business Info',
    'Contact',
    'Hours',
    'Media',
    'Terms',
    'Experience',
    'Complete'
  ];

  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4">
      <div className="max-w-2xl mx-auto">
        {/* Progress Bar */}
        <div className="mb-3">
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#eb7825] transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600">
            Step {currentStep} of {totalSteps - 1}
          </span>
          <span className="font-medium text-black">
            {stepLabels[currentStep] || 'Progress'}
          </span>
          <span className="text-gray-400">
            {Math.round(progress)}%
          </span>
        </div>
      </div>
    </div>
  );
}
