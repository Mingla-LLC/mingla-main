import React from 'react';
import { Check } from 'lucide-react';
import { StepProps } from '../types';
import { TRAVEL_MODE_OPTIONS } from '../constants';

export default function TravelModeStep({ data, onUpdate }: StepProps) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="text-center space-y-1 px-4 sm:px-6">
        <h2 className="text-gray-900">How do you get around?</h2>
        <p className="text-xs text-gray-600">
          This helps us show realistic travel times
        </p>
      </div>

      {/* Travel Mode Options */}
      <div className="grid grid-cols-2 gap-2 px-4 sm:px-6">
        {TRAVEL_MODE_OPTIONS.map((mode) => {
          const isSelected = data.travelMode === mode.id;
          const IconComponent = mode.icon;

          return (
            <button
              key={mode.id}
              onClick={() => onUpdate({ travelMode: mode.id })}
              className={`relative p-3 rounded-lg border-2 transition-all ${
                isSelected
                  ? 'border-[#eb7825] bg-orange-50 shadow-md'
                  : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
              }`}
            >
              {/* Selected Indicator */}
              {isSelected && (
                <div className="absolute top-1.5 right-1.5 w-4 h-4 bg-[#eb7825] rounded-full flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-white" />
                </div>
              )}

              {/* Content */}
              <div className="space-y-2">
                {/* Icon */}
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  isSelected ? 'bg-[#eb7825]' : 'bg-gray-100'
                }`}>
                  <IconComponent className={`w-5 h-5 ${
                    isSelected ? 'text-white' : 'text-gray-600'
                  }`} />
                </div>

                {/* Text */}
                <div className="space-y-0.5">
                  <h3 className="text-sm text-gray-900">{mode.label}</h3>
                  <p className="text-xs text-gray-600">{mode.speed}</p>
                  <p className="text-xs text-gray-500 leading-tight">{mode.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Helper Text */}
      <div className="text-center px-4 sm:px-6">
        <p className="text-xs text-gray-500">
          You can change this anytime in your preferences
        </p>
      </div>
    </div>
  );
}