import React from 'react';
import { DollarSign } from 'lucide-react';
import { StepProps } from '../types';

export default function BudgetStep({ data, onUpdate }: StepProps) {
  const presets = [
    { min: 0, max: 25, label: '$0-25' },
    { min: 25, max: 75, label: '$25-75' },
    { min: 75, max: 150, label: '$75-150' },
    { min: 150, max: 999, label: '$150+' }
  ];

  const handlePresetSelect = (preset: typeof presets[0]) => {
    onUpdate({ 
      budgetMin: preset.min, 
      budgetMax: preset.max === 999 ? '' : preset.max,
      budgetPreset: preset.label
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center space-y-1 px-4 sm:px-6">
        <h2 className="text-gray-900">What's your budget?</h2>
        <p className="text-xs text-gray-600">
          Set your typical spending range per person
        </p>
      </div>

      {/* Budget Presets */}
      <div className="px-4 sm:px-6">
        <p className="text-xs text-gray-600 mb-2">Popular ranges:</p>
        <div className="grid grid-cols-2 gap-2">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => handlePresetSelect(preset)}
              className={`p-3 rounded-lg border-2 transition-colors text-center ${
                data.budgetPreset === preset.label
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="text-sm">{preset.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center px-4 sm:px-6">
        <div className="flex-1 border-t border-gray-200"></div>
        <span className="px-3 text-xs text-gray-500">or custom range</span>
        <div className="flex-1 border-t border-gray-200"></div>
      </div>

      {/* Custom Budget Inputs */}
      <div className="px-4 sm:px-6 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {/* Min Budget */}
          <div>
            <label className="block text-xs text-gray-700 mb-1.5">Min per person</label>
            <div className="relative">
              <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
              <input
                type="number"
                min="0"
                value={data.budgetMin}
                onChange={(e) => onUpdate({ 
                  budgetMin: e.target.value ? parseFloat(e.target.value) : '',
                  budgetPreset: ''
                })}
                placeholder="0"
                className="w-full pl-7 pr-2 py-2.5 border-2 border-gray-200 rounded-lg focus:border-[#eb7825] focus:outline-none transition-colors text-sm"
              />
            </div>
          </div>

          {/* Max Budget */}
          <div>
            <label className="block text-xs text-gray-700 mb-1.5">Max per person</label>
            <div className="relative">
              <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
              <input
                type="number"
                min="0"
                value={data.budgetMax}
                onChange={(e) => onUpdate({ 
                  budgetMax: e.target.value ? parseFloat(e.target.value) : '',
                  budgetPreset: ''
                })}
                placeholder="100"
                className="w-full pl-7 pr-2 py-2.5 border-2 border-gray-200 rounded-lg focus:border-[#eb7825] focus:outline-none transition-colors text-sm"
              />
            </div>
          </div>
        </div>

        {/* Helper Text */}
        <p className="text-xs text-gray-500 text-center">
          Free experiences will always be shown
        </p>
      </div>
    </div>
  );
}