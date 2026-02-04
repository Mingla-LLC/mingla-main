import React from 'react';
import { Check } from 'lucide-react';
import { StepProps } from '../types';
import { INTENT_OPTIONS } from '../constants';

export default function IntentStep({ data, onUpdate }: StepProps) {
  const handleIntentToggle = (intent: typeof INTENT_OPTIONS[0]) => {
    const isSelected = data.intents.some(i => i.id === intent.id);
    
    if (isSelected) {
      onUpdate({
        intents: data.intents.filter(i => i.id !== intent.id)
      });
    } else {
      onUpdate({
        intents: [...data.intents, intent]
      });
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="text-center space-y-1 px-4 sm:px-6">
        <h2 className="text-gray-900">What brings you here?</h2>
        <p className="text-xs text-gray-600">
          Select all that apply
        </p>
      </div>

      {/* Intent Options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-4 sm:px-6">
        {INTENT_OPTIONS.map((intent) => {
          const isSelected = data.intents.some(i => i.id === intent.id);
          const IconComponent = intent.icon;

          return (
            <button
              key={intent.id}
              onClick={() => handleIntentToggle(intent)}
              className={`relative p-2.5 rounded-lg border-2 transition-all text-left space-y-1 ${
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

              {/* Icon */}
              <div className="flex items-center">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isSelected ? 'bg-[#eb7825]' : 'bg-gray-100'
                }`}>
                  <IconComponent className={`w-4 h-4 ${
                    isSelected ? 'text-white' : 'text-gray-600'
                  }`} />
                </div>
              </div>

              {/* Text */}
              <div>
                <h3 className="text-xs text-gray-900">
                  {intent.title}
                </h3>
                <p className="text-xs text-gray-600 leading-tight">
                  {intent.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selection Count */}
      {data.intents.length > 0 && (
        <div className="text-center">
          <p className="text-xs text-gray-600">
            {data.intents.length} {data.intents.length === 1 ? 'intent' : 'intents'} selected
          </p>
        </div>
      )}
    </div>
  );
}