import React from 'react';
import { ProgressProps } from './types';

export default function OnboardingProgress({ currentStep, totalSteps }: ProgressProps) {
  const progress = ((currentStep + 1) / totalSteps) * 100;

  return (
    <div className="w-full bg-gray-200 h-1.5 sm:h-2 rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-[#eb7825] to-[#d6691f] transition-all duration-300 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
