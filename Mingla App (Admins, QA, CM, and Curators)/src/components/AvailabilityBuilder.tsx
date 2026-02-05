import React, { useState } from 'react';
import { Calendar, Clock, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface TimeSlot {
  start: string;
  end: string;
}

interface DaySchedule {
  enabled: boolean;
  timeSlots: TimeSlot[];
}

interface WeeklySchedule {
  Monday: DaySchedule;
  Tuesday: DaySchedule;
  Wednesday: DaySchedule;
  Thursday: DaySchedule;
  Friday: DaySchedule;
  Saturday: DaySchedule;
  Sunday: DaySchedule;
}

interface MonthlySchedule {
  days: number[]; // e.g., [1, 15, 30]
  timeSlots: TimeSlot[];
}

interface OneOffDate {
  date: string;
  timeSlots: TimeSlot[];
}

export interface AvailabilityData {
  type: 'always-available' | 'recurring' | 'one-off' | 'same-as-experience';
  recurring?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    daily?: {
      timeSlots: TimeSlot[];
    };
    weekly?: WeeklySchedule;
    monthly?: MonthlySchedule;
  };
  oneOff?: OneOffDate[];
}

interface AvailabilityBuilderProps {
  value: AvailabilityData;
  onChange: (data: AvailabilityData) => void;
  label?: string;
  description?: string;
  isPackageLevel?: boolean;
  generalAvailability?: AvailabilityData; // For package level to check constraints
  onAutoAdjustGeneral?: (newGeneralAvailability: AvailabilityData) => void;
  experienceAvailability?: AvailabilityData; // For packages to inherit from experience
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const DAYS_ABBREV = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export default function AvailabilityBuilder({
  value,
  onChange,
  label = 'Availability',
  description,
  isPackageLevel = false,
  generalAvailability,
  onAutoAdjustGeneral,
  experienceAvailability
}: AvailabilityBuilderProps) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Initialize weekly schedule if needed
  const getWeeklySchedule = (): WeeklySchedule => {
    if (value.recurring?.weekly) {
      return value.recurring.weekly;
    }
    
    // Default empty schedule
    const defaultSchedule: WeeklySchedule = {} as WeeklySchedule;
    DAYS_OF_WEEK.forEach(day => {
      defaultSchedule[day] = { enabled: false, timeSlots: [] };
    });
    return defaultSchedule;
  };

  const handleTypeChange = (type: 'always-available' | 'recurring' | 'one-off' | 'same-as-experience') => {
    if (type === 'same-as-experience') {
      onChange({ type: 'same-as-experience' });
    } else if (type === 'always-available') {
      onChange({ type: 'always-available' });
    } else if (type === 'recurring') {
      const weeklySchedule: WeeklySchedule = {} as WeeklySchedule;
      DAYS_OF_WEEK.forEach(day => {
        weeklySchedule[day] = { enabled: false, timeSlots: [] };
      });
      
      onChange({
        type: 'recurring',
        recurring: {
          frequency: 'weekly',
          weekly: weeklySchedule
        }
      });
    } else {
      onChange({
        type: 'one-off',
        oneOff: []
      });
    }
  };

  const handleFrequencyChange = (frequency: 'daily' | 'weekly' | 'monthly') => {
    if (frequency === 'daily') {
      onChange({
        type: 'recurring',
        recurring: {
          frequency: 'daily',
          daily: { timeSlots: [] }
        }
      });
    } else if (frequency === 'weekly') {
      const weeklySchedule: WeeklySchedule = {} as WeeklySchedule;
      DAYS_OF_WEEK.forEach(day => {
        weeklySchedule[day] = { enabled: false, timeSlots: [] };
      });
      
      onChange({
        type: 'recurring',
        recurring: {
          frequency: 'weekly',
          weekly: weeklySchedule
        }
      });
    } else {
      onChange({
        type: 'recurring',
        recurring: {
          frequency: 'monthly',
          monthly: { days: [], timeSlots: [] }
        }
      });
    }
  };

  const toggleDay = (day: string) => {
    if (value.recurring?.frequency !== 'weekly' || !value.recurring.weekly) return;
    
    const weeklySchedule = { ...value.recurring.weekly };
    const daySchedule = weeklySchedule[day as keyof WeeklySchedule];
    
    weeklySchedule[day as keyof WeeklySchedule] = {
      ...daySchedule,
      enabled: !daySchedule.enabled,
      timeSlots: !daySchedule.enabled && daySchedule.timeSlots.length === 0 
        ? [{ start: '09:00', end: '17:00' }] 
        : daySchedule.timeSlots
    };
    
    onChange({
      ...value,
      recurring: {
        ...value.recurring,
        weekly: weeklySchedule
      }
    });
  };

  const addTimeSlot = (context: 'daily' | 'monthly' | string) => {
    const newSlot: TimeSlot = { start: '09:00', end: '17:00' };
    
    if (context === 'daily' && value.recurring?.daily) {
      onChange({
        ...value,
        recurring: {
          ...value.recurring,
          daily: {
            timeSlots: [...value.recurring.daily.timeSlots, newSlot]
          }
        }
      });
    } else if (context === 'monthly' && value.recurring?.monthly) {
      onChange({
        ...value,
        recurring: {
          ...value.recurring,
          monthly: {
            ...value.recurring.monthly,
            timeSlots: [...value.recurring.monthly.timeSlots, newSlot]
          }
        }
      });
    } else if (value.recurring?.frequency === 'weekly' && value.recurring.weekly) {
      // Adding to specific day
      const weeklySchedule = { ...value.recurring.weekly };
      const daySchedule = weeklySchedule[context as keyof WeeklySchedule];
      
      weeklySchedule[context as keyof WeeklySchedule] = {
        ...daySchedule,
        timeSlots: [...daySchedule.timeSlots, newSlot]
      };
      
      onChange({
        ...value,
        recurring: {
          ...value.recurring,
          weekly: weeklySchedule
        }
      });
    }
  };

  const updateTimeSlot = (
    context: 'daily' | 'monthly' | string,
    index: number,
    field: 'start' | 'end',
    timeValue: string
  ) => {
    if (context === 'daily' && value.recurring?.daily) {
      const updatedSlots = [...value.recurring.daily.timeSlots];
      updatedSlots[index] = { ...updatedSlots[index], [field]: timeValue };
      
      onChange({
        ...value,
        recurring: {
          ...value.recurring,
          daily: { timeSlots: updatedSlots }
        }
      });
    } else if (context === 'monthly' && value.recurring?.monthly) {
      const updatedSlots = [...value.recurring.monthly.timeSlots];
      updatedSlots[index] = { ...updatedSlots[index], [field]: timeValue };
      
      onChange({
        ...value,
        recurring: {
          ...value.recurring,
          monthly: { ...value.recurring.monthly, timeSlots: updatedSlots }
        }
      });
    } else if (value.recurring?.frequency === 'weekly' && value.recurring.weekly) {
      const weeklySchedule = { ...value.recurring.weekly };
      const daySchedule = weeklySchedule[context as keyof WeeklySchedule];
      const updatedSlots = [...daySchedule.timeSlots];
      updatedSlots[index] = { ...updatedSlots[index], [field]: timeValue };
      
      weeklySchedule[context as keyof WeeklySchedule] = {
        ...daySchedule,
        timeSlots: updatedSlots
      };
      
      onChange({
        ...value,
        recurring: {
          ...value.recurring,
          weekly: weeklySchedule
        }
      });
    }
  };

  const removeTimeSlot = (context: 'daily' | 'monthly' | string, index: number) => {
    if (context === 'daily' && value.recurring?.daily) {
      const updatedSlots = value.recurring.daily.timeSlots.filter((_, i) => i !== index);
      onChange({
        ...value,
        recurring: {
          ...value.recurring,
          daily: { timeSlots: updatedSlots }
        }
      });
    } else if (context === 'monthly' && value.recurring?.monthly) {
      const updatedSlots = value.recurring.monthly.timeSlots.filter((_, i) => i !== index);
      onChange({
        ...value,
        recurring: {
          ...value.recurring,
          monthly: { ...value.recurring.monthly, timeSlots: updatedSlots }
        }
      });
    } else if (value.recurring?.frequency === 'weekly' && value.recurring.weekly) {
      const weeklySchedule = { ...value.recurring.weekly };
      const daySchedule = weeklySchedule[context as keyof WeeklySchedule];
      const updatedSlots = daySchedule.timeSlots.filter((_, i) => i !== index);
      
      weeklySchedule[context as keyof WeeklySchedule] = {
        ...daySchedule,
        timeSlots: updatedSlots
      };
      
      onChange({
        ...value,
        recurring: {
          ...value.recurring,
          weekly: weeklySchedule
        }
      });
    }
  };

  const addOneOffDate = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    
    onChange({
      ...value,
      oneOff: [
        ...(value.oneOff || []),
        { date: dateStr, timeSlots: [{ start: '09:00', end: '17:00' }] }
      ]
    });
  };

  const updateOneOffDate = (index: number, date: string) => {
    if (!value.oneOff) return;
    
    const updated = [...value.oneOff];
    updated[index] = { ...updated[index], date };
    
    onChange({
      ...value,
      oneOff: updated
    });
  };

  const addOneOffTimeSlot = (dateIndex: number) => {
    if (!value.oneOff) return;
    
    const updated = [...value.oneOff];
    updated[dateIndex] = {
      ...updated[dateIndex],
      timeSlots: [...updated[dateIndex].timeSlots, { start: '09:00', end: '17:00' }]
    };
    
    onChange({
      ...value,
      oneOff: updated
    });
  };

  const updateOneOffTimeSlot = (dateIndex: number, slotIndex: number, field: 'start' | 'end', timeValue: string) => {
    if (!value.oneOff) return;
    
    const updated = [...value.oneOff];
    const updatedSlots = [...updated[dateIndex].timeSlots];
    updatedSlots[slotIndex] = { ...updatedSlots[slotIndex], [field]: timeValue };
    updated[dateIndex] = { ...updated[dateIndex], timeSlots: updatedSlots };
    
    onChange({
      ...value,
      oneOff: updated
    });
  };

  const removeOneOffTimeSlot = (dateIndex: number, slotIndex: number) => {
    if (!value.oneOff) return;
    
    const updated = [...value.oneOff];
    updated[dateIndex] = {
      ...updated[dateIndex],
      timeSlots: updated[dateIndex].timeSlots.filter((_, i) => i !== slotIndex)
    };
    
    // If no time slots left, keep at least one
    if (updated[dateIndex].timeSlots.length === 0) {
      updated[dateIndex].timeSlots = [{ start: '09:00', end: '17:00' }];
    }
    
    onChange({
      ...value,
      oneOff: updated
    });
  };

  const removeOneOffDate = (index: number) => {
    if (!value.oneOff) return;
    
    onChange({
      ...value,
      oneOff: value.oneOff.filter((_, i) => i !== index)
    });
  };

  const handleMonthlyDaysChange = (input: string) => {
    const days = input
      .split(',')
      .map(d => parseInt(d.trim()))
      .filter(d => !isNaN(d) && d >= 1 && d <= 31);
    
    onChange({
      ...value,
      recurring: {
        ...value.recurring!,
        monthly: {
          ...value.recurring!.monthly!,
          days
        }
      }
    });
  };

  const weeklySchedule = value?.recurring?.frequency === 'weekly' ? getWeeklySchedule() : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>

        {description && (
          <p className="text-sm text-gray-600">{description}</p>
        )}
      </div>

      {/* Availability Type Selector */}
      <div className={`grid gap-2 ${isPackageLevel ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {isPackageLevel && (
          <button
            type="button"
            onClick={() => handleTypeChange('same-as-experience')}
            className={`py-3 px-2 rounded-xl border-2 transition-all flex items-center justify-center text-xs col-span-2 ${
              value.type === 'same-as-experience'
                ? 'border-[#eb7825] bg-[#eb7825]/5 text-[#eb7825]'
                : 'border-gray-200 text-gray-600 hover:border-[#eb7825]/50 hover:text-[#eb7825]'
            }`}
          >
            Same as Experience
          </button>
        )}
        
        <button
          type="button"
          onClick={() => handleTypeChange('always-available')}
          className={`py-3 px-2 rounded-xl border-2 transition-all flex items-center justify-center text-xs ${
            value.type === 'always-available'
              ? 'border-[#eb7825] bg-[#eb7825]/5 text-[#eb7825]'
              : 'border-gray-200 text-gray-600 hover:border-[#eb7825]/50 hover:text-[#eb7825]'
          }`}
        >
          Always
        </button>

        <button
          type="button"
          onClick={() => handleTypeChange('recurring')}
          className={`py-3 px-2 rounded-xl border-2 transition-all flex items-center justify-center text-xs ${
            value.type === 'recurring'
              ? 'border-[#eb7825] bg-[#eb7825]/5 text-[#eb7825]'
              : 'border-gray-200 text-gray-600 hover:border-[#eb7825]/50 hover:text-[#eb7825]'
          }`}
        >
          Recurring
        </button>

        <button
          type="button"
          onClick={() => handleTypeChange('one-off')}
          className={`py-3 px-2 rounded-xl border-2 transition-all flex items-center justify-center text-xs ${
            value.type === 'one-off'
              ? 'border-[#eb7825] bg-[#eb7825]/5 text-[#eb7825]'
              : 'border-gray-200 text-gray-600 hover:border-[#eb7825]/50 hover:text-[#eb7825]'
          }`}
        >
          One-off
        </button>
      </div>

      {/* Recurring Schedule */}
      {value.type === 'recurring' && (
        <div className="space-y-4 bg-gray-50 rounded-xl p-4">
          {/* Frequency Selector */}
          <div>
            <label className="block text-sm text-gray-700 font-medium mb-2">Frequency</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleFrequencyChange('daily')}
                className={`px-2 py-2.5 min-h-[44px] rounded-lg transition-all font-medium text-xs sm:text-sm touch-manipulation flex items-center justify-center ${
                  value.recurring?.frequency === 'daily'
                    ? 'bg-[#eb7825] text-white shadow-md'
                    : 'bg-white text-gray-700 border border-gray-200 hover:border-[#eb7825] hover:text-[#eb7825]'
                }`}
              >
                Daily
              </button>
              <button
                type="button"
                onClick={() => handleFrequencyChange('weekly')}
                className={`px-2 py-2.5 min-h-[44px] rounded-lg transition-all font-medium text-xs sm:text-sm touch-manipulation flex items-center justify-center ${
                  value.recurring?.frequency === 'weekly'
                    ? 'bg-[#eb7825] text-white shadow-md'
                    : 'bg-white text-gray-700 border border-gray-200 hover:border-[#eb7825] hover:text-[#eb7825]'
                }`}
              >
                Weekly
              </button>
              <button
                type="button"
                onClick={() => handleFrequencyChange('monthly')}
                className={`px-2 py-2.5 min-h-[44px] rounded-lg transition-all font-medium text-xs sm:text-sm touch-manipulation flex items-center justify-center ${
                  value.recurring?.frequency === 'monthly'
                    ? 'bg-[#eb7825] text-white shadow-md'
                    : 'bg-white text-gray-700 border border-gray-200 hover:border-[#eb7825] hover:text-[#eb7825]'
                }`}
              >
                Monthly
              </button>
            </div>
          </div>

          {/* Daily Time Slots */}
          {value.recurring?.frequency === 'daily' && (
            <div className="bg-gradient-to-br from-gray-50 to-white rounded-xl p-4 border border-gray-200 shadow-sm space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-2 h-2 bg-[#eb7825] rounded-full flex-shrink-0"></div>
                  <span className="text-sm sm:text-base text-gray-900 font-medium">Available every day</span>
                </div>
                <Button
                  type="button"
                  onClick={() => addTimeSlot('daily')}
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white transition-colors flex-shrink-0 rounded-lg"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  <span className="hidden sm:inline">Add time</span>
                  <span className="sm:hidden">Add</span>
                </Button>
              </div>

              {/* Time Slots */}
              <div className="space-y-3">
                {value.recurring.daily?.timeSlots.map((slot, index) => (
                  <div key={index} className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                    {/* Mobile: Vertical Stack, Desktop: Horizontal */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      {/* Clock Icon - Hidden on mobile for space */}
                      <div className="hidden sm:flex items-center justify-center w-8 h-8 bg-gray-100 rounded-lg flex-shrink-0">
                        <Clock className="w-4 h-4 text-[#eb7825]" />
                      </div>
                      
                      {/* Time Inputs Container */}
                      <div className="flex-1 space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
                        {/* Start Time */}
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-xs text-gray-500 font-medium w-12 flex-shrink-0 sm:hidden">Start</span>
                          <Input
                            type="time"
                            value={slot.start}
                            onChange={(e) => updateTimeSlot('daily', index, 'start', e.target.value)}
                            className="w-full min-w-[120px] h-11 px-4 rounded-lg border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825] cursor-pointer"
                          />
                        </div>
                        
                        {/* Separator */}
                        <div className="hidden sm:flex items-center justify-center flex-shrink-0">
                          <span className="text-gray-400 font-medium px-1">→</span>
                        </div>
                        
                        {/* End Time */}
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-xs text-gray-500 font-medium w-12 flex-shrink-0 sm:hidden">End</span>
                          <Input
                            type="time"
                            value={slot.end}
                            onChange={(e) => updateTimeSlot('daily', index, 'end', e.target.value)}
                            className="w-full min-w-[120px] h-11 px-4 rounded-lg border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825] cursor-pointer"
                          />
                        </div>
                      </div>
                      
                      {/* Delete Button */}
                      <button
                        type="button"
                        onClick={() => removeTimeSlot('daily', index)}
                        className="flex items-center justify-center w-full sm:w-10 h-10 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors flex-shrink-0 border border-red-200 sm:border-0"
                        aria-label="Remove time slot"
                      >
                        <X className="w-4 h-4" />
                        <span className="ml-2 sm:hidden">Remove</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Empty State */}
              {(!value.recurring.daily?.timeSlots || value.recurring.daily.timeSlots.length === 0) && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <Clock className="w-5 h-5 text-blue-600" />
                    </div>
                    <p className="text-sm text-blue-900 font-medium">
                      No time restrictions
                    </p>
                    <p className="text-xs text-blue-700">
                      Available all day, every day
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Weekly Schedule */}
          {value.recurring?.frequency === 'weekly' && weeklySchedule && (
            <div className="space-y-2">
              <div className="text-sm text-gray-700 font-medium mb-3">Select days and set times</div>
              
              {/* Day Pills */}
              <div className="grid grid-cols-7 gap-2 sm:gap-3 mb-6">
                {DAYS_OF_WEEK.map((day, index) => {
                  const daySchedule = weeklySchedule[day];
                  const isEnabled = daySchedule.enabled;
                  
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className={`px-3 py-5 min-h-[60px] flex items-center justify-center rounded-xl font-medium transition-all touch-manipulation ${
                        isEnabled
                          ? 'bg-[#eb7825] text-white shadow-md'
                          : 'bg-white text-gray-600 border-2 border-gray-200 hover:border-[#eb7825] hover:text-[#eb7825]'
                      }`}
                      aria-label={day}
                    >
                      <span className="text-sm sm:text-base leading-none">{DAYS_ABBREV[index]}</span>
                    </button>
                  );
                })}
              </div>

              {/* Day Details */}
              <div className="space-y-2">
                {DAYS_OF_WEEK.map(day => {
                  const daySchedule = weeklySchedule[day];
                  if (!daySchedule.enabled) return null;
                  
                  const isExpanded = expandedDay === day;
                  
                  return (
                    <div key={day} className="bg-white rounded-lg border border-gray-200">
                      <button
                        type="button"
                        onClick={() => setExpandedDay(isExpanded ? null : day)}
                        className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-[#eb7825]" />
                          <span className="text-sm font-medium text-gray-900">{day}</span>
                          <span className="text-xs text-gray-500">
                            ({daySchedule.timeSlots.length} {daySchedule.timeSlots.length === 1 ? 'slot' : 'slots'})
                          </span>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-3 border-t border-gray-100 mt-2">
                          {daySchedule.timeSlots.map((slot, index) => (
                            <div key={index} className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                              {/* Mobile: Vertical Stack, Desktop: Horizontal */}
                              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                {/* Clock Icon - Hidden on mobile for space */}
                                <div className="hidden sm:flex items-center justify-center w-8 h-8 bg-gray-100 rounded-lg flex-shrink-0">
                                  <Clock className="w-4 h-4 text-[#eb7825]" />
                                </div>
                                
                                {/* Time Inputs Container */}
                                <div className="flex-1 space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
                                  {/* Start Time */}
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="text-xs text-gray-500 font-medium w-12 flex-shrink-0 sm:hidden">Start</span>
                                    <Input
                                      type="time"
                                      value={slot.start}
                                      onChange={(e) => updateTimeSlot(day, index, 'start', e.target.value)}
                                      className="w-full min-w-[120px] h-11 px-4 rounded-lg border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825] cursor-pointer"
                                    />
                                  </div>
                                  
                                  {/* Separator */}
                                  <div className="hidden sm:flex items-center justify-center flex-shrink-0">
                                    <span className="text-gray-400 font-medium px-1">→</span>
                                  </div>
                                  
                                  {/* End Time */}
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="text-xs text-gray-500 font-medium w-12 flex-shrink-0 sm:hidden">End</span>
                                    <Input
                                      type="time"
                                      value={slot.end}
                                      onChange={(e) => updateTimeSlot(day, index, 'end', e.target.value)}
                                      className="w-full min-w-[120px] h-11 px-4 rounded-lg border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825] cursor-pointer"
                                    />
                                  </div>
                                </div>
                                
                                {/* Delete Button */}
                                <button
                                  type="button"
                                  onClick={() => removeTimeSlot(day, index)}
                                  className="flex items-center justify-center w-full sm:w-10 h-10 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors flex-shrink-0 border border-red-200 sm:border-0"
                                  aria-label="Remove time slot"
                                >
                                  <X className="w-4 h-4" />
                                  <span className="ml-2 sm:hidden">Remove</span>
                                </button>
                              </div>
                            </div>
                          ))}
                          
                          <Button
                            type="button"
                            onClick={() => addTimeSlot(day)}
                            size="sm"
                            variant="ghost"
                            className="w-full h-10 text-sm text-[#eb7825] hover:text-white hover:bg-[#eb7825] transition-colors rounded-lg border border-dashed border-[#eb7825]"
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            Add time slot
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {!Object.values(weeklySchedule).some(d => d.enabled) && (
                <p className="text-sm text-gray-500 text-center py-4 bg-white rounded-lg border border-dashed border-gray-300">
                  Select days above to set availability
                </p>
              )}
            </div>
          )}

          {/* Monthly Schedule */}
          {value.recurring?.frequency === 'monthly' && (
            <div className="bg-gradient-to-br from-gray-50 to-white rounded-xl p-4 border border-gray-200 shadow-sm space-y-4">
              <div>
                <label className="block text-sm text-gray-700 font-medium mb-2">Days of Month</label>
                <Input
                  value={value.recurring.monthly?.days.join(', ') || ''}
                  onChange={(e) => handleMonthlyDaysChange(e.target.value)}
                  placeholder="e.g., 1, 15, 30"
                  className="h-11 px-3 rounded-lg border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825]"
                />
                <p className="text-xs text-gray-500 mt-1.5">Enter days separated by commas (1-31)</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3 gap-3">
                  <label className="text-sm text-gray-700 font-medium">Time Slots</label>
                  <Button
                    type="button"
                    onClick={() => addTimeSlot('monthly')}
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white transition-colors flex-shrink-0 rounded-lg"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    <span className="hidden sm:inline">Add time</span>
                    <span className="sm:hidden">Add</span>
                  </Button>
                </div>

                <div className="space-y-3">
                  {value.recurring.monthly?.timeSlots.map((slot, index) => (
                    <div key={index} className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                      {/* Mobile: Vertical Stack, Desktop: Horizontal */}
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        {/* Clock Icon - Hidden on mobile for space */}
                        <div className="hidden sm:flex items-center justify-center w-8 h-8 bg-gray-100 rounded-lg flex-shrink-0">
                          <Clock className="w-4 h-4 text-[#eb7825]" />
                        </div>
                        
                        {/* Time Inputs Container */}
                        <div className="flex-1 space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
                          {/* Start Time */}
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-xs text-gray-500 font-medium w-12 flex-shrink-0 sm:hidden">Start</span>
                            <Input
                              type="time"
                              value={slot.start}
                              onChange={(e) => updateTimeSlot('monthly', index, 'start', e.target.value)}
                              className="w-full min-w-[120px] h-11 px-4 rounded-lg border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825] cursor-pointer"
                            />
                          </div>
                          
                          {/* Separator */}
                          <div className="hidden sm:flex items-center justify-center flex-shrink-0">
                            <span className="text-gray-400 font-medium px-1">→</span>
                          </div>
                          
                          {/* End Time */}
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-xs text-gray-500 font-medium w-12 flex-shrink-0 sm:hidden">End</span>
                            <Input
                              type="time"
                              value={slot.end}
                              onChange={(e) => updateTimeSlot('monthly', index, 'end', e.target.value)}
                              className="w-full min-w-[120px] h-11 px-4 rounded-lg border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825] cursor-pointer"
                            />
                          </div>
                        </div>
                        
                        {/* Delete Button */}
                        <button
                          type="button"
                          onClick={() => removeTimeSlot('monthly', index)}
                          className="flex items-center justify-center w-full sm:w-10 h-10 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors flex-shrink-0 border border-red-200 sm:border-0"
                          aria-label="Remove time slot"
                        >
                          <X className="w-4 h-4" />
                          <span className="ml-2 sm:hidden">Remove</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {(!value.recurring.monthly?.timeSlots || value.recurring.monthly.timeSlots.length === 0) && (
                  <p className="text-xs text-gray-500 text-center py-2">
                    No time restrictions - available all day
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* One-Off Dates */}
      {value.type === 'one-off' && (
        <div className="space-y-3">
          {value.oneOff && value.oneOff.length > 0 && (
            <div className="space-y-2">
              {value.oneOff.map((dateEntry, dateIndex) => (
                <div key={dateIndex} className="bg-gradient-to-br from-gray-50 to-white rounded-xl p-4 border border-gray-200 shadow-sm space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 font-medium mb-1.5 sm:hidden">Event Date</label>
                      <Input
                        type="date"
                        value={dateEntry.date}
                        onChange={(e) => updateOneOffDate(dateIndex, e.target.value)}
                        className="w-full h-11 px-3 rounded-lg border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeOneOffDate(dateIndex)}
                      className="flex items-center justify-center w-10 h-11 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors flex-shrink-0"
                      aria-label="Remove date"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-3 pt-2 sm:pl-4 sm:ml-2 sm:border-l-2 border-gray-200">
                    {dateEntry.timeSlots.map((slot, slotIndex) => (
                      <div key={slotIndex} className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                        {/* Mobile: Vertical Stack, Desktop: Horizontal */}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          {/* Clock Icon - Hidden on mobile for space */}
                          <div className="hidden sm:flex items-center justify-center w-8 h-8 bg-gray-100 rounded-lg flex-shrink-0">
                            <Clock className="w-4 h-4 text-[#eb7825]" />
                          </div>
                          
                          {/* Time Inputs Container */}
                          <div className="flex-1 space-y-2 sm:space-y-0 sm:flex sm:items-center sm:gap-2">
                            {/* Start Time */}
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-xs text-gray-500 font-medium w-12 flex-shrink-0 sm:hidden">Start</span>
                              <Input
                                type="time"
                                value={slot.start}
                                onChange={(e) => updateOneOffTimeSlot(dateIndex, slotIndex, 'start', e.target.value)}
                                className="w-full min-w-[120px] h-11 px-4 rounded-lg border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825] cursor-pointer"
                              />
                            </div>
                            
                            {/* Separator */}
                            <div className="hidden sm:flex items-center justify-center flex-shrink-0">
                              <span className="text-gray-400 font-medium px-1">→</span>
                            </div>
                            
                            {/* End Time */}
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-xs text-gray-500 font-medium w-12 flex-shrink-0 sm:hidden">End</span>
                              <Input
                                type="time"
                                value={slot.end}
                                onChange={(e) => updateOneOffTimeSlot(dateIndex, slotIndex, 'end', e.target.value)}
                                className="w-full min-w-[120px] h-11 px-4 rounded-lg border-gray-300 focus:border-[#eb7825] focus:ring-[#eb7825] cursor-pointer"
                              />
                            </div>
                          </div>
                          
                          {/* Delete Button - Only show if multiple time slots */}
                          {dateEntry.timeSlots.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeOneOffTimeSlot(dateIndex, slotIndex)}
                              className="flex items-center justify-center w-full sm:w-10 h-10 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors flex-shrink-0 border border-red-200 sm:border-0"
                              aria-label="Remove time slot"
                            >
                              <X className="w-4 h-4" />
                              <span className="ml-2 sm:hidden">Remove</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    
                    <Button
                      type="button"
                      onClick={() => addOneOffTimeSlot(dateIndex)}
                      size="sm"
                      variant="ghost"
                      className="w-full h-10 text-sm text-[#eb7825] hover:text-white hover:bg-[#eb7825] transition-colors rounded-lg border border-dashed border-[#eb7825]"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add time slot
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button
            type="button"
            onClick={addOneOffDate}
            variant="outline"
            className="w-full h-12 border-dashed border-2 border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white transition-colors rounded-lg"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add Event Date
          </Button>

          {(!value.oneOff || value.oneOff.length === 0) && (
            <p className="text-sm text-gray-500 text-center py-4 bg-gray-50 rounded-lg">
              Click above to add specific event dates
            </p>
          )}
        </div>
      )}

      {/* Same as Experience Display */}
      {value.type === 'same-as-experience' && null}
    </div>
  );
}