import React from 'react';
import { Calendar, Clock, Coffee, Sun, UtensilsCrossed, Moon } from 'lucide-react';
import { StepProps } from '../types';

const dateOptions = [
  { id: 'now', label: 'Now', desc: 'Leave immediately' },
  { id: 'today', label: 'Today', desc: 'Pick a time' },
  { id: 'weekend', label: 'This Weekend', desc: 'Fri-Sun' },
  { id: 'custom', label: 'Pick a Date', desc: 'Custom date' }
];

const timeSlots = [
  { id: 'brunch', label: 'Brunch', time: '11:00 AM - 1:00 PM', icon: Coffee },
  { id: 'afternoon', label: 'Afternoon', time: '2:00 PM - 5:00 PM', icon: Sun },
  { id: 'dinner', label: 'Dinner', time: '6:00 PM - 9:00 PM', icon: UtensilsCrossed },
  { id: 'latenight', label: 'Late Night', time: '10:00 PM - 12:00 AM', icon: Moon }
];

export default function DateTimeStep({ data, onUpdate }: StepProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center space-y-1 px-4 sm:px-6">
        <h2 className="text-gray-900">When do you want to go?</h2>
        <p className="text-xs text-gray-600">
          Choose your preferred date and time
        </p>
      </div>

      {/* Date Selection */}
      <div className="px-4 sm:px-6">
        <label className="block text-xs text-gray-700 mb-2">Select Date</label>
        <div className="grid grid-cols-2 gap-2">
          {dateOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                onUpdate({ datePreference: option.id });
                if (option.id === 'now') {
                  onUpdate({ timeSlot: '', customDate: '', exactTime: '' });
                }
              }}
              className={`py-3 px-4 rounded-xl transition-all ${
                data.datePreference === option.id
                  ? 'bg-[#eb7825] text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <div className="text-sm">{option.label}</div>
              <div className={`text-xs mt-0.5 ${
                data.datePreference === option.id ? 'text-orange-100' : 'text-gray-500'
              }`}>
                {option.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Weekend Info */}
      {data.datePreference === 'weekend' && (
        <div className="px-4 sm:px-6">
          <div className="bg-blue-50 p-3 rounded-xl border border-blue-200">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-blue-600" />
              <p className="text-xs text-blue-800">This Weekend</p>
            </div>
            <p className="text-xs text-blue-700">Includes Friday, Saturday & Sunday</p>
          </div>
        </div>
      )}

      {/* Custom Date Picker */}
      {data.datePreference === 'custom' && (
        <div className="px-4 sm:px-6">
          <label className="block text-xs text-gray-700 mb-1.5">Pick a Date</label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="date"
              value={data.customDate || ''}
              onChange={(e) => onUpdate({ customDate: e.target.value })}
              min={new Date().toISOString().split('T')[0]}
              className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:border-[#eb7825] focus:outline-none transition-colors text-sm"
            />
          </div>
        </div>
      )}

      {/* Time Selection - Show for all options except "Now" */}
      {data.datePreference !== 'now' && data.datePreference !== '' && (
        <div className="px-4 sm:px-6 space-y-3">
          <label className="block text-xs text-gray-700">Select Time</label>
          
          {/* Time Slot Presets */}
          <div>
            <p className="text-xs text-gray-500 mb-2">Quick Presets</p>
            <div className="grid grid-cols-2 gap-2">
              {timeSlots.map((slot) => {
                const Icon = slot.icon;
                return (
                  <button
                    key={slot.id}
                    onClick={() => {
                      onUpdate({ timeSlot: slot.id, exactTime: '' });
                    }}
                    className={`p-3 rounded-xl transition-all ${
                      data.timeSlot === slot.id && !data.exactTime
                        ? 'bg-[#eb7825] text-white shadow-md'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-4 h-4" />
                      <span className="text-sm">{slot.label}</span>
                    </div>
                    <div className={`text-xs ${
                      data.timeSlot === slot.id && !data.exactTime ? 'text-orange-100' : 'text-gray-500'
                    }`}>
                      {slot.time}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Manual Time Picker */}
          <div>
            <p className="text-xs text-gray-500 mb-2">Or Set Exact Time</p>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="time"
                value={data.exactTime || ''}
                onChange={(e) => {
                  onUpdate({ exactTime: e.target.value, timeSlot: '' });
                }}
                className={`w-full pl-10 pr-4 py-3 border-2 rounded-lg focus:outline-none transition-colors text-sm ${
                  data.exactTime
                    ? 'border-[#eb7825] bg-orange-50'
                    : 'border-gray-200 focus:border-[#eb7825]'
                }`}
              />
            </div>
            {data.exactTime && (
              <p className="text-xs text-[#eb7825] mt-1.5">
                Arriving around {data.exactTime}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Helper Text */}
      <div className="text-center px-4 sm:px-6">
        <p className="text-xs text-gray-500">
          {data.datePreference === 'now' 
            ? 'Perfect! We\'ll show you what\'s happening right now'
            : 'You can adjust this preference anytime'}
        </p>
      </div>
    </div>
  );
}