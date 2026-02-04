import React, { useState } from 'react';
import { 
  Heart, Users, Star, DollarSign, MapPin, Clock, Car, 
  Train, Navigation, Calendar, Sun, Moon, TreePine, 
  Coffee, Utensils, Monitor, Palette, Gamepad2, Dumbbell,
  Sparkles, Music, Target, Gift, X, Eye, CloudSun, 
  PersonStanding, Bike, Bus
} from 'lucide-react';
import GooglePlacesAutocomplete from './GooglePlacesAutocomplete';

interface CollaborationPreferencesProps {
  isOpen: boolean;
  onClose: () => void;
  sessionName: string;
  participants: Array<{ id: string; name: string; avatar?: string }>;
  onSave: (preferences: any) => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: 'Metric' | 'Imperial';
  };
}

interface ExperienceType {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface Category {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

// Include all experience types for collaboration
const experienceTypes: ExperienceType[] = [
  { id: 'soloAdventure', label: 'Solo Adventure', icon: Star },
  { id: 'firstDate', label: 'First Date', icon: Heart },
  { id: 'romantic', label: 'Romantic', icon: Heart },
  { id: 'friendly', label: 'Friendly', icon: Users },
  { id: 'groupFun', label: 'Group Fun', icon: Users },
  { id: 'business', label: 'Business', icon: Target }
];

const budgetPresets = [
  { label: '$0–25', min: 0, max: 25 },
  { label: '$25–75', min: 25, max: 75 },
  { label: '$75–150', min: 75, max: 150 },
  { label: '$150+', min: 150, max: 1000 }
];

const categories: Category[] = [
  { id: 'stroll', label: 'Take a Stroll', icon: Eye, description: 'Parks, trails, waterfronts' },
  { id: 'sipChill', label: 'Sip & Chill', icon: Coffee, description: 'Bars, cafés, wine bars, lounges' },
  { id: 'casualEats', label: 'Casual Eats', icon: Utensils, description: 'Casual restaurants, diners, food trucks' },
  { id: 'screenRelax', label: 'Screen & Relax', icon: Monitor, description: 'Movies, theaters, comedy shows' },
  { id: 'creative', label: 'Creative & Hands-On', icon: Palette, description: 'Classes, workshops, arts & crafts' },
  { id: 'picnics', label: 'Picnics', icon: CloudSun, description: 'Outdoor dining, scenic spots, park setups' },
  { id: 'playMove', label: 'Play & Move', icon: Dumbbell, description: 'Bowling, mini golf, sports, kayaking' },
  { id: 'diningExp', label: 'Dining Experiences', icon: Utensils, description: 'Upscale or chef-led restaurants' },
  { id: 'wellness', label: 'Wellness Dates', icon: TreePine, description: 'Yoga, spas, sound baths, healthy dining' },
  { id: 'freestyle', label: 'Freestyle', icon: Sparkles, description: 'Pop-ups, festivals, unique or quirky events' }
];

interface TravelMode {
  id: string;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
}

const travelModes: TravelMode[] = [
  { id: 'walking', label: 'Walking', subtitle: '~5 km/h', icon: PersonStanding, desc: 'Good for short distances' },
  { id: 'biking', label: 'Biking', subtitle: '~15 km/h', icon: Bike, desc: 'Faster than walking' },
  { id: 'transit', label: 'Public Transit', subtitle: '~20 km/h avg', icon: Bus, desc: 'Includes wait time' },
  { id: 'driving', label: 'Driving', subtitle: '~30 km/h city', icon: Car, desc: 'Fastest option' }
];

const timeSlots = [
  { id: 'brunch', label: 'Brunch', emoji: '🍳', time: '11–1' },
  { id: 'afternoon', label: 'Afternoon', emoji: '☀️', time: '2–5' },
  { id: 'dinner', label: 'Dinner', emoji: '🍽️', time: '6–9' },
  { id: 'lateNight', label: 'Late Night', emoji: '🌙', time: '10–12' }
];

export default function CollaborationPreferences({ 
  isOpen, 
  onClose, 
  sessionName, 
  participants, 
  onSave,
  accountPreferences
}: CollaborationPreferencesProps) {
  const [selectedExperiences, setSelectedExperiences] = useState<string[]>([]);
  const [budgetMin, setBudgetMin] = useState<number | ''>('');
  const [budgetMax, setBudgetMax] = useState<number | ''>('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [dateOption, setDateOption] = useState<string>('now');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('');
  const [exactTime, setExactTime] = useState<string>('');
  const [travelMode, setTravelMode] = useState<string>('walking');
  const [constraintType, setConstraintType] = useState<'time' | 'distance'>('time');
  const [timeConstraint, setTimeConstraint] = useState<number | ''>('');
  const [distanceConstraint, setDistanceConstraint] = useState<number | ''>('');
  const [useLocation, setUseLocation] = useState<'gps' | 'search'>('gps');
  const [searchLocation, setSearchLocation] = useState<string>('');
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [locationError, setLocationError] = useState<string>('');

  const handleExperienceToggle = (id: string) => {
    setSelectedExperiences(prev => {
      const newSelection = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      
      // When experience types change, remove any categories that are no longer valid
      if (newSelection.length > 0) {
        const experienceTypeFilters: Record<string, string[]> = {
          soloAdventure: ['stroll', 'sipChill', 'casualEats', 'screenRelax', 'creative', 'picnics', 'playMove', 'diningExp', 'wellness', 'freestyle'],
          firstDate: ['stroll', 'sipChill', 'picnics', 'screenRelax', 'creative', 'playMove', 'diningExp'],
          romantic: ['sipChill', 'picnics', 'diningExp', 'wellness'],
          friendly: ['stroll', 'sipChill', 'casualEats', 'screenRelax', 'creative', 'picnics', 'playMove', 'diningExp', 'wellness', 'freestyle'],
          groupFun: ['playMove', 'creative', 'casualEats', 'screenRelax', 'freestyle'],
          business: ['stroll', 'sipChill', 'diningExp']
        };

        const relevantCategoryIds = new Set<string>();
        newSelection.forEach(expType => {
          const categoryIds = experienceTypeFilters[expType] || [];
          categoryIds.forEach(catId => relevantCategoryIds.add(catId));
        });

        // Remove categories that are no longer relevant
        setSelectedCategories(prevCategories => 
          prevCategories.filter(catId => relevantCategoryIds.has(catId))
        );
      }
      
      return newSelection;
    });
  };

  const handleCategoryToggle = (id: string) => {
    setSelectedCategories(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Get filtered categories based on selected experience types
  const getFilteredCategories = (): Category[] => {
    // If no experience types selected, show all categories
    if (selectedExperiences.length === 0) {
      return categories;
    }

    // Define category IDs for each experience type
    const experienceTypeFilters: Record<string, string[]> = {
      soloAdventure: ['stroll', 'sipChill', 'casualEats', 'screenRelax', 'creative', 'picnics', 'playMove', 'diningExp', 'wellness', 'freestyle'],
      firstDate: ['stroll', 'sipChill', 'picnics', 'screenRelax', 'creative', 'playMove', 'diningExp'],
      romantic: ['sipChill', 'picnics', 'diningExp', 'wellness'],
      friendly: ['stroll', 'sipChill', 'casualEats', 'screenRelax', 'creative', 'picnics', 'playMove', 'diningExp', 'wellness', 'freestyle'],
      groupFun: ['playMove', 'creative', 'casualEats', 'screenRelax', 'freestyle'],
      business: ['stroll', 'sipChill', 'diningExp']
    };

    // Collect all relevant category IDs from selected experience types
    const relevantCategoryIds = new Set<string>();
    selectedExperiences.forEach(expType => {
      const categoryIds = experienceTypeFilters[expType] || [];
      categoryIds.forEach(id => relevantCategoryIds.add(id));
    });

    // Filter categories to only show relevant ones
    return categories.filter(cat => relevantCategoryIds.has(cat.id));
  };

  const setBudgetPreset = (min: number, max: number) => {
    setBudgetMin(min);
    setBudgetMax(max);
  };

  // Convert date/time selections to actual Date objects
  const calculateActualDateTime = () => {
    const now = new Date();
    let targetDate = new Date();
    let targetTime = exactTime || '14:00';

    if (dateOption === 'now') {
      return {
        scheduledDate: now.toISOString(),
        scheduledTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        displayText: `Now (${now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`
      };
    } else if (dateOption === 'today') {
      targetDate = new Date(now);
    } else if (dateOption === 'weekend') {
      const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7;
      targetDate = new Date(now);
      targetDate.setDate(now.getDate() + daysUntilSaturday);
    } else if (dateOption === 'pick' && selectedDate) {
      targetDate = new Date(selectedDate);
    }

    if (exactTime) {
      const [hours, minutes] = exactTime.split(':').map(Number);
      targetDate.setHours(hours, minutes, 0, 0);
    } else {
      targetDate.setHours(14, 0, 0, 0);
    }

    return {
      scheduledDate: targetDate.toISOString(),
      scheduledTime: targetTime,
      displayText: targetDate.toLocaleString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: '2-digit' 
      })
    };
  };

  // Handle GPS location
  const handleUseGPSLocation = async () => {
    setLocationStatus('loading');
    setLocationError('');
    
    try {
      const { getCurrentLocation } = await import('./utils/geolocation');
      const location = await getCurrentLocation();
      
      setLocationCoords({ lat: location.lat, lng: location.lng });
      setLocationStatus('success');
      
      if (location.source === 'gps') {
        console.log('✅ Using precise GPS location');
      } else if (location.source === 'ip') {
        setLocationError('Using approximate location (GPS unavailable)');
      } else if (location.source === 'default') {
        setLocationError('Using default location (San Francisco)');
      }
    } catch (error) {
      console.error('Location error:', error);
      setLocationStatus('error');
      setLocationError('Could not determine location');
    }
  };

  // Handle search location selection
  const handlePlaceSelected = (place: any) => {
    try {
      const { parseLocationFromPlaces } = require('./utils/geolocation');
      const location = parseLocationFromPlaces(place);
      
      setLocationCoords({ lat: location.lat, lng: location.lng });
      setSearchLocation(place.formatted_address || place.name || '');
      setLocationStatus('success');
      setLocationError('');
      
      console.log('✅ Location set:', place.formatted_address || place.name);
    } catch (error) {
      console.error('Error parsing place:', error);
      setLocationError('Error setting location');
      setLocationStatus('error');
    }
  };

  // Trigger GPS fetch when GPS is selected
  React.useEffect(() => {
    if (useLocation === 'gps' && !locationCoords) {
      handleUseGPSLocation();
    }
  }, [useLocation]);

  const handleApplyPreferences = () => {
    const dateTimeData = (dateOption && dateOption !== '') ? calculateActualDateTime() : null;

    const preferences = {
      selectedExperiences,
      budgetMin,
      budgetMax,
      selectedCategories,
      dateOption,
      selectedDate,
      selectedTimeSlot,
      exactTime,
      travelMode,
      constraintType,
      timeConstraint,
      distanceConstraint,
      useLocation,
      searchLocation,
      locationCoords,
      actualDateTime: dateTimeData,
      measurementSystem: accountPreferences?.measurementSystem || 'Metric'
    };
    
    onSave(preferences);
    onClose();
  };

  const totalSelections = 
    selectedExperiences.length +
    selectedCategories.length +
    (budgetMin !== '' || budgetMax !== '' ? 1 : 0) +
    (dateOption !== '' ? 1 : 0) +
    (dateOption !== 'now' && dateOption !== '' && exactTime !== '' ? 1 : 0) +
    (travelMode !== '' ? 1 : 0) +
    (timeConstraint !== '' || distanceConstraint !== '' ? 1 : 0) +
    (useLocation !== '' ? 1 : 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-4xl h-[90vh] flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="w-full mx-auto pb-20 sm:pb-24">
            {/* Header - Sticky */}
            <div className="sticky top-0 z-50 bg-white pb-3 sm:pb-4 mb-3 sm:mb-4">
              <div className="relative text-center space-y-1.5 sm:space-y-2 px-3 sm:px-4 pt-3 sm:pt-4 bg-white">
                {/* Cancel Button */}
                <button
                  onClick={onClose}
                  className="absolute left-2 sm:left-4 top-2 sm:top-4 p-1.5 sm:p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 sm:w-6 sm:h-6 text-gray-600" />
                </button>
                <h1 className="text-lg sm:text-2xl md:text-3xl font-semibold text-gray-900 text-center font-bold">Narrow your search</h1>
                <p className="text-xs sm:text-sm text-gray-600">Collaboration Preferences for "{sessionName}"</p>
              </div>
              {/* Shadow separator */}
              <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent"></div>
            </div>

            <div className="space-y-3 sm:space-y-6 px-3 sm:px-4">
              {/* Section 1: Experience Type */}
              <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 p-3 sm:p-4 md:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Experience Type</h2>
                  <p className="text-xs sm:text-sm text-gray-600">Date Idea / Friends / Romantic / Solo Adventure</p>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {experienceTypes.map((type) => {
                    const Icon = type.icon;
                    const isSelected = selectedExperiences.includes(type.id);
                    return (
                      <button
                        key={type.id}
                        onClick={() => handleExperienceToggle(type.id)}
                        className={`
                          px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full transition-all duration-200 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm border
                          ${isSelected 
                            ? 'border-[#eb7825] bg-[#eb7825] text-white shadow-md' 
                            : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                          }
                        `}
                      >
                        <Icon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${isSelected ? 'text-white' : 'text-gray-500'}`} />
                        <span className="whitespace-nowrap">{type.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Budget per Person */}
              <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 p-3 sm:p-4 md:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900">Budget per Person</h2>
                    {(budgetMin !== '' || budgetMax !== '') && (
                      <span className="text-xs sm:text-sm bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">
                        Filter Active
                      </span>
                    )}
                  </div>
                  {(budgetMin !== '' || budgetMax !== '') && (
                    <p className="text-xs sm:text-sm text-gray-600 mt-1">
                      Only cards within ${budgetMin || 0} - ${budgetMax || '∞'} will be shown
                    </p>
                  )}
                </div>
                
                {/* Min/Max Inputs */}
                <div className="flex gap-2 sm:gap-3 mb-3 sm:mb-4">
                  <div className="flex-1">
                    <label className="block text-xs sm:text-sm text-gray-600 mb-1.5 sm:mb-2">Min</label>
                    <div className="relative">
                      <span className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="number"
                        value={budgetMin}
                        onChange={(e) => setBudgetMin(e.target.value ? Number(e.target.value) : '')}
                        className="w-full pl-6 sm:pl-7 pr-2 sm:pr-3 py-2 sm:py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-sm sm:text-base"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs sm:text-sm text-gray-600 mb-1.5 sm:mb-2">Max</label>
                    <div className="relative">
                      <span className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                      <input
                        type="number"
                        value={budgetMax}
                        onChange={(e) => setBudgetMax(e.target.value ? Number(e.target.value) : '')}
                        className="w-full pl-6 sm:pl-7 pr-2 sm:pr-3 py-2 sm:py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-sm sm:text-base"
                        placeholder="200"
                      />
                    </div>
                  </div>
                </div>

                {/* Preset Shortcuts */}
                <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-2 sm:mb-3">
                  {budgetPresets.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => setBudgetPreset(preset.min, preset.max)}
                      className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-full hover:border-orange-300 hover:bg-orange-50 transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Section 3: Categories */}
              <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 p-3 sm:p-4 md:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900">Categories</h2>
                    <div className="flex items-center gap-2">
                      {selectedCategories.length > 0 && (
                        <span className="text-xs sm:text-sm bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">
                          {selectedCategories.length} Selected
                        </span>
                      )}
                      {selectedExperiences.length > 0 && getFilteredCategories().length < categories.length && (
                        <span className="text-xs sm:text-sm bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full font-medium">
                          {getFilteredCategories().length} of {categories.length}
                        </span>
                      )}
                    </div>
                  </div>
                  {selectedCategories.length > 0 && (
                    <p className="text-xs sm:text-sm text-gray-600 mt-1">
                      Only showing experiences in: {selectedCategories.map(id => categories.find(c => c.id === id)?.label).filter(Boolean).join(', ')}
                    </p>
                  )}
                  {selectedExperiences.length > 0 && (
                    <p className="text-xs sm:text-sm text-gray-600 mt-1">
                      {selectedCategories.length > 0 && '• '}Filtered by your selected experience types
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
                  {getFilteredCategories().length > 0 ? (
                    getFilteredCategories().map((category) => {
                      const Icon = category.icon;
                      const isSelected = selectedCategories.includes(category.id);
                      return (
                        <button
                          key={category.id}
                          onClick={() => handleCategoryToggle(category.id)}
                          className={`
                            p-3 sm:p-4 rounded-xl border-2 transition-all duration-200 text-left
                            ${isSelected 
                              ? 'border-[#eb7825] bg-orange-50' 
                              : 'border-gray-200 bg-white hover:border-gray-300'
                            }
                          `}
                        >
                          <div className="flex items-center gap-2 mb-1 sm:mb-2">
                            <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${isSelected ? 'text-[#eb7825]' : 'text-gray-500'}`} />
                            <span className={`font-medium text-sm sm:text-base ${isSelected ? 'text-orange-700' : 'text-gray-900'}`}>
                              {category.label}
                            </span>
                          </div>
                          {isSelected && (
                            <p className="text-xs sm:text-sm text-orange-600">{category.description}</p>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="col-span-full bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                      <p className="text-sm text-blue-800">
                        👆 Select an Experience Type above to see relevant categories
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 4: Date & Time */}
              <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 p-3 sm:p-4 md:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">Date & Time</h2>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">When do you want to go?</p>
                </div>
                
                {/* Date Selection */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 mb-3 sm:mb-4">
                  {[
                    { id: 'now', label: 'Now', desc: 'Leave immediately' },
                    { id: 'today', label: 'Today', desc: 'Pick a time' },
                    { id: 'weekend', label: 'This Weekend', desc: 'Fri-Sun' },
                    { id: 'pick', label: 'Pick a Date', desc: 'Custom date' }
                  ].map((option) => (
                    <button
                      key={option.id}
                      onClick={() => {
                        setDateOption(option.id);
                        if (option.id === 'now') {
                          setExactTime('');
                        }
                      }}
                      className={`
                        py-2 sm:py-3 px-2 sm:px-4 rounded-xl transition-all duration-200 text-xs sm:text-sm
                        ${dateOption === option.id 
                          ? 'bg-[#eb7825] text-white shadow-md' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }
                      `}
                    >
                      <div className="font-medium">{option.label}</div>
                      <div className={`text-xs mt-0.5 ${dateOption === option.id ? 'text-orange-100' : 'text-gray-500'}`}>
                        {option.desc}
                      </div>
                    </button>
                  ))}
                </div>
                
                {/* Weekend Info */}
                {dateOption === 'weekend' && (
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-3 sm:p-4 rounded-xl border border-blue-200 mb-3">
                    <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
                      <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                      <p className="text-xs sm:text-sm font-medium text-blue-800">This Weekend</p>
                    </div>
                    <p className="text-xs sm:text-sm text-blue-700">Includes Friday, Saturday & Sunday</p>
                  </div>
                )}

                {/* Pick a Date */}
                {dateOption === 'pick' && (
                  <div className="mb-3">
                    <label className="block text-xs sm:text-sm text-gray-600 mb-1.5 sm:mb-2">Select Date</label>
                    <div className="relative">
                      <Calendar className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                      <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        className="w-full pl-9 sm:pl-12 pr-3 sm:pr-4 py-2 sm:py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 bg-gray-50 text-sm sm:text-base"
                      />
                    </div>
                  </div>
                )}

                {/* Time Picker */}
                {dateOption !== 'now' && (
                  <div>
                    <label className="block text-xs sm:text-sm text-gray-600 mb-1.5 sm:mb-2">Select Time</label>
                    <div className="relative">
                      <Clock className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" />
                      <input
                        type="time"
                        value={exactTime}
                        onChange={(e) => setExactTime(e.target.value)}
                        className="w-full pl-9 sm:pl-12 pr-3 sm:pr-4 py-2 sm:py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 bg-gray-50 text-sm sm:text-base"
                        required
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-1.5">
                      {exactTime ? `Arriving around ${exactTime}` : 'Choose when you want to arrive'}
                    </p>
                  </div>
                )}
              </div>

              {/* Section 5: Travel Mode */}
              <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 p-3 sm:p-4 md:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">Travel Mode</h2>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">How will you get there?</p>
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                  {travelModes.map((mode) => {
                    const Icon = mode.icon;
                    const isSelected = travelMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        onClick={() => setTravelMode(mode.id)}
                        className={`
                          px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full transition-all duration-200 flex items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm border
                          ${isSelected 
                            ? 'border-[#eb7825] bg-[#eb7825] text-white shadow-md' 
                            : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                          }
                        `}
                      >
                        <Icon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${isSelected ? 'text-white' : 'text-gray-500'}`} />
                        <span className="whitespace-nowrap">{mode.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 6: Travel Constraint */}
              <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 p-3 sm:p-4 md:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">Travel Constraint</h2>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">Set max travel time or distance</p>
                </div>
                
                {/* Toggle between time and distance */}
                <div className="flex gap-1.5 sm:gap-2 mb-3 sm:mb-4">
                  <button
                    onClick={() => setConstraintType('time')}
                    className={`
                      flex-1 py-2 sm:py-3 px-2 sm:px-4 rounded-xl transition-all duration-200 text-xs sm:text-sm font-medium
                      ${constraintType === 'time' 
                        ? 'bg-[#eb7825] text-white shadow-md' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }
                    `}
                  >
                    By Time
                  </button>
                  <button
                    onClick={() => setConstraintType('distance')}
                    className={`
                      flex-1 py-2 sm:py-3 px-2 sm:px-4 rounded-xl transition-all duration-200 text-xs sm:text-sm font-medium
                      ${constraintType === 'distance' 
                        ? 'bg-[#eb7825] text-white shadow-md' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }
                    `}
                  >
                    By Distance
                  </button>
                </div>

                {constraintType === 'time' ? (
                  <div>
                    <label className="block text-xs sm:text-sm text-gray-600 mb-1.5 sm:mb-2">
                      Maximum travel time (minutes)
                    </label>
                    <input
                      type="number"
                      value={timeConstraint}
                      onChange={(e) => setTimeConstraint(e.target.value ? Number(e.target.value) : '')}
                      className="w-full px-3 sm:px-4 py-2 sm:py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-sm sm:text-base"
                      placeholder="30"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs sm:text-sm text-gray-600 mb-1.5 sm:mb-2">
                      Maximum distance ({accountPreferences?.measurementSystem === 'Imperial' ? 'miles' : 'km'})
                    </label>
                    <input
                      type="number"
                      value={distanceConstraint}
                      onChange={(e) => setDistanceConstraint(e.target.value ? Number(e.target.value) : '')}
                      className="w-full px-3 sm:px-4 py-2 sm:py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-sm sm:text-base"
                      placeholder="10"
                    />
                  </div>
                )}
              </div>

              {/* Section 7: Starting Location */}
              <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 p-3 sm:p-4 md:p-6 shadow-sm">
                <div className="mb-3 sm:mb-4">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">Starting Location</h2>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">Where are you starting from?</p>
                </div>
                
                <div className="flex gap-1.5 sm:gap-2 mb-3">
                  <button
                    onClick={() => setUseLocation('gps')}
                    className={`
                      flex-1 py-2 sm:py-3 px-2 sm:px-4 rounded-xl transition-all duration-200 text-xs sm:text-sm font-medium
                      ${useLocation === 'gps' 
                        ? 'bg-[#eb7825] text-white shadow-md' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }
                    `}
                  >
                    📍 Use GPS
                  </button>
                  <button
                    onClick={() => setUseLocation('search')}
                    className={`
                      flex-1 py-2 sm:py-3 px-2 sm:px-4 rounded-xl transition-all duration-200 text-xs sm:text-sm font-medium
                      ${useLocation === 'search' 
                        ? 'bg-[#eb7825] text-white shadow-md' 
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }
                    `}
                  >
                    🔍 Search
                  </button>
                </div>

                {useLocation === 'gps' && (
                  <div className="space-y-2">
                    {locationStatus === 'loading' && (
                      <p className="text-xs sm:text-sm text-blue-600">Getting your location...</p>
                    )}
                    {locationStatus === 'success' && (
                      <p className="text-xs sm:text-sm text-green-600">✓ Location set</p>
                    )}
                    {locationError && (
                      <p className="text-xs sm:text-sm text-orange-600">{locationError}</p>
                    )}
                  </div>
                )}

                {useLocation === 'search' && (
                  <div>
                    <GooglePlacesAutocomplete
                      onPlaceSelected={handlePlaceSelected}
                      placeholder="Search for a location..."
                    />
                    {searchLocation && (
                      <p className="text-xs sm:text-sm text-green-600 mt-2">✓ Location: {searchLocation}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Footer - Fixed */}
        <div className="border-t border-gray-200 p-3 sm:p-4 bg-white rounded-b-3xl flex-shrink-0">
          <div className="flex gap-2 sm:gap-3">
            <button 
              onClick={handleApplyPreferences}
              className="flex-1 bg-[#eb7825] text-white py-3 sm:py-4 px-4 sm:px-6 rounded-xl font-medium hover:bg-orange-600 transition-all duration-200 shadow-lg text-sm sm:text-base"
            >
              Apply Preferences ({totalSelections})
            </button>
            <button 
              onClick={() => {
                setSelectedExperiences([]);
                setSelectedCategories([]);
                setBudgetMin('');
                setBudgetMax('');
                setDateOption('now');
                setSelectedDate('');
                setSelectedTimeSlot('');
                setExactTime('');
                setTravelMode('walking');
                setConstraintType('time');
                setTimeConstraint('');
                setDistanceConstraint('');
                setUseLocation('gps');
                setSearchLocation('');
                setLocationCoords(null);
              }}
              className="bg-gray-100 text-gray-700 py-3 sm:py-4 px-4 sm:px-6 rounded-xl font-medium hover:bg-gray-200 transition-all duration-200 text-sm sm:text-base"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
