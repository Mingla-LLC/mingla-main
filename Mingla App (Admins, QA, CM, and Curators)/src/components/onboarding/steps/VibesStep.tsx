import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { StepProps } from '../types';
import { VIBE_CATEGORIES } from '../constants';

export default function VibesStep({ data, onUpdate }: StepProps) {
  // Filter categories based on selected intents
  const availableCategories = useMemo(() => {
    if (data.intents.length === 0) return VIBE_CATEGORIES;
    
    // Get all allowed categories from selected intents
    const allowedCategoryIds = new Set<string>();
    
    data.intents.forEach(intent => {
      if (!intent.allowedCategories) {
        // If no restrictions, add all categories
        VIBE_CATEGORIES.forEach(cat => allowedCategoryIds.add(cat.id));
      } else {
        // Add allowed categories
        intent.allowedCategories.forEach(catId => allowedCategoryIds.add(catId));
      }
    });
    
    return VIBE_CATEGORIES.filter(cat => allowedCategoryIds.has(cat.id));
  }, [data.intents]);

  const handleVibeToggle = (vibe: typeof VIBE_CATEGORIES[0]) => {
    const isSelected = data.vibes.some(v => v.id === vibe.id);
    
    if (isSelected) {
      onUpdate({
        vibes: data.vibes.filter(v => v.id !== vibe.id)
      });
    } else {
      onUpdate({
        vibes: [...data.vibes, vibe]
      });
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="text-center space-y-1 px-4 sm:px-6">
        <h2 className="text-gray-900">What's your vibe?</h2>
        <p className="text-xs text-gray-600">
          Pick the experience categories you love
        </p>
      </div>

      {/* Vibe Categories Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-4 sm:px-6">
        {availableCategories.map((vibe) => {
          const isSelected = data.vibes.some(v => v.id === vibe.id);
          const IconComponent = vibe.icon;

          return (
            <button
              key={vibe.id}
              onClick={() => handleVibeToggle(vibe)}
              className={`relative p-2.5 rounded-lg border-2 transition-all space-y-1.5 ${
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
              <div className="flex justify-center">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  isSelected ? 'bg-[#eb7825]' : 'bg-gray-100'
                }`}>
                  <IconComponent className={`w-4 h-4 ${
                    isSelected ? 'text-white' : 'text-gray-600'
                  }`} />
                </div>
              </div>

              {/* Name */}
              <div className="text-center">
                <h3 className="text-xs text-gray-900 leading-tight">
                  {vibe.name}
                </h3>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selection Count */}
      {data.vibes.length > 0 && (
        <div className="text-center">
          <p className="text-xs text-gray-600">
            {data.vibes.length} {data.vibes.length === 1 ? 'category' : 'categories'} selected
          </p>
        </div>
      )}
    </div>
  );
}