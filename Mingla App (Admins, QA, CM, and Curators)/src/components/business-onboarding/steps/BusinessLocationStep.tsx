import React from 'react';
import { Clock } from 'lucide-react';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { BusinessOnboardingStepProps } from '../types';

const DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' }
] as const;

export default function BusinessLocationStep({ data, onUpdate }: BusinessOnboardingStepProps) {
  const handleDayToggle = (day: string, isOpen: boolean) => {
    onUpdate({
      operatingHours: {
        ...data.operatingHours,
        [day]: {
          ...data.operatingHours[day as keyof typeof data.operatingHours],
          isOpen
        }
      }
    });
  };

  const handleTimeChange = (day: string, type: 'open' | 'close', value: string) => {
    onUpdate({
      operatingHours: {
        ...data.operatingHours,
        [day]: {
          ...data.operatingHours[day as keyof typeof data.operatingHours],
          [type]: value
        }
      }
    });
  };

  const copyToAll = (sourceDay: string) => {
    const sourceHours = data.operatingHours[sourceDay as keyof typeof data.operatingHours];
    const newOperatingHours = { ...data.operatingHours };
    
    DAYS.forEach(({ key }) => {
      newOperatingHours[key] = { ...sourceHours };
    });

    onUpdate({ operatingHours: newOperatingHours });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-[#eb7825]/10 rounded-full">
          <Clock className="w-7 h-7 text-[#eb7825]" />
        </div>
        <h2 className="text-2xl text-black">
          Operating Hours
        </h2>
        <p className="text-gray-600">
          When are you open for business?
        </p>
      </div>

      {/* Operating Hours */}
      <div className="space-y-3 bg-white rounded-xl p-6 border border-gray-200">
        {DAYS.map(({ key, label }) => {
          const dayHours = data.operatingHours[key];
          
          return (
            <div key={key} className="flex flex-col sm:flex-row sm:items-center gap-3 pb-3 border-b border-gray-100 last:border-0 last:pb-0">
              <div className="flex items-center gap-3 sm:w-32">
                <Switch
                  checked={dayHours.isOpen}
                  onCheckedChange={(checked) => handleDayToggle(key, checked)}
                />
                <Label className="text-sm font-medium cursor-pointer">
                  {label}
                </Label>
              </div>

              {dayHours.isOpen ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 flex-1">
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <input
                      type="time"
                      value={dayHours.open}
                      onChange={(e) => handleTimeChange(key, 'open', e.target.value)}
                      className="flex-1 sm:flex-initial px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#eb7825]"
                    />
                    <span className="text-gray-400">to</span>
                    <input
                      type="time"
                      value={dayHours.close}
                      onChange={(e) => handleTimeChange(key, 'close', e.target.value)}
                      className="flex-1 sm:flex-initial px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#eb7825]"
                    />
                  </div>
                  <button
                    onClick={() => copyToAll(key)}
                    className="sm:ml-auto text-xs text-[#eb7825] hover:underline whitespace-nowrap self-start sm:self-auto"
                  >
                    Copy to all
                  </button>
                </div>
              ) : (
                <span className="text-sm text-gray-400">Closed</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Tips */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          💡 <strong>Tip:</strong> You can update your operating hours anytime from your business settings. Special hours for holidays can be set later.
        </p>
      </div>
    </div>
  );
}