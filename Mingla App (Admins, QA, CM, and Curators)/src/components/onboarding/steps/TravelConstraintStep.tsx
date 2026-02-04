import React from 'react';
import { Clock, Navigation } from 'lucide-react';
import { StepProps } from '../types';

export default function TravelConstraintStep({ data, onUpdate }: StepProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center space-y-1 px-4 sm:px-6">
        <h2 className="text-gray-900">How far will you go?</h2>
        <p className="text-xs text-gray-600">
          Set your preferred travel limit
        </p>
      </div>

      {/* Constraint Type Toggle */}
      <div className="px-4 sm:px-6">
        <div className="flex bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => onUpdate({ constraintType: 'time' })}
            className={`flex-1 py-2 rounded-lg transition-all flex items-center justify-center space-x-1.5 ${
              data.constraintType === 'time'
                ? 'bg-white text-[#eb7825] shadow-sm'
                : 'text-gray-600'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span className="text-sm">By Time</span>
          </button>
          <button
            onClick={() => onUpdate({ constraintType: 'distance' })}
            className={`flex-1 py-2 rounded-lg transition-all flex items-center justify-center space-x-1.5 ${
              data.constraintType === 'distance'
                ? 'bg-white text-[#eb7825] shadow-sm'
                : 'text-gray-600'
            }`}
          >
            <Navigation className="w-4 h-4" />
            <span className="text-sm">By Distance</span>
          </button>
        </div>
      </div>

      {/* Constraint Input */}
      <div className="px-4 sm:px-6">
        {data.constraintType === 'time' ? (
          <div>
            <label className="block text-xs text-gray-700 mb-1.5">Maximum travel time (minutes)</label>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="number"
                min="0"
                value={data.timeConstraint}
                onChange={(e) => onUpdate({ timeConstraint: e.target.value ? parseFloat(e.target.value) : '' })}
                placeholder="30"
                className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:border-[#eb7825] focus:outline-none transition-colors text-sm"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1.5">How many minutes are you willing to travel?</p>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-gray-700 mb-1.5">Maximum distance (km)</label>
            <div className="relative">
              <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="number"
                min="0"
                step="0.5"
                value={data.distanceConstraint}
                onChange={(e) => onUpdate({ distanceConstraint: e.target.value ? parseFloat(e.target.value) : '' })}
                placeholder="10"
                className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:border-[#eb7825] focus:outline-none transition-colors text-sm"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1.5">Maximum distance you're willing to travel</p>
          </div>
        )}
      </div>

      {/* Quick Presets */}
      <div className="px-4 sm:px-6">
        <p className="text-xs text-gray-600 mb-2">Quick options:</p>
        <div className="flex flex-wrap gap-2">
          {data.constraintType === 'time' ? (
            <>
              {[15, 30, 45, 60].map((time) => (
                <button
                  key={time}
                  onClick={() => onUpdate({ timeConstraint: time })}
                  className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
                    data.timeConstraint === time
                      ? 'bg-[#eb7825] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {time} min
                </button>
              ))}
            </>
          ) : (
            <>
              {[5, 10, 20, 50].map((distance) => (
                <button
                  key={distance}
                  onClick={() => onUpdate({ distanceConstraint: distance })}
                  className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
                    data.distanceConstraint === distance
                      ? 'bg-[#eb7825] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {distance} km
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}