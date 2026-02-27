import React, { useState } from 'react';
import { 
  Heart, Users, Star, DollarSign, MapPin, Clock, Car, 
  Train, Navigation, Calendar, Sun, Moon, TreePine, 
  Coffee, Utensils, Monitor, Palette, Gamepad2, Dumbbell,
  Sparkles, Music, Target, Gift, X, Eye, CloudSun, 
  PersonStanding, Bike, Bus
} from 'lucide-react';
import GooglePlacesAutocomplete from './GooglePlacesAutocomplete';

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

interface PreferencesSheetProps {
  onClose?: () => void;
  onSave?: (preferences: any) => void;
  accountPreferences?: {
    currency: string;
    measurementSystem: 'Metric' | 'Imperial';
  };
}

export default function PreferencesSheet({ onClose, onSave, accountPreferences }: PreferencesSheetProps) {
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
      soloAdventure: ['stroll', 'sipChill', 'casualEats', 'screenRelax', 'creative', 'picnics', 'playMove', 'diningExp', 'wellness', 'freestyle'], // All
      firstDate: ['stroll', 'sipChill', 'picnics', 'screenRelax', 'creative', 'playMove', 'diningExp'],
      romantic: ['sipChill', 'picnics', 'diningExp', 'wellness'],
      friendly: ['stroll', 'sipChill', 'casualEats', 'screenRelax', 'creative', 'picnics', 'playMove', 'diningExp', 'wellness', 'freestyle'], // All
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
    let targetTime = exactTime || '14:00'; // Default to 2pm if no time specified

    if (dateOption === 'now') {
      // Capture the current moment
      return {
        scheduledDate: now.toISOString(),
        scheduledTime: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        displayText: `Now (${now.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`
      };
    } else if (dateOption === 'today') {
      targetDate = new Date(now);
    } else if (dateOption === 'weekend') {
      // Calculate next Saturday
      const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7;
      targetDate = new Date(now);
      targetDate.setDate(now.getDate() + daysUntilSaturday);
    } else if (dateOption === 'pick' && selectedDate) {
      targetDate = new Date(selectedDate);
    }

    // Set the time on the target date
    if (exactTime) {
      const [hours, minutes] = exactTime.split(':').map(Number);
      targetDate.setHours(hours, minutes, 0, 0);
    } else {
      targetDate.setHours(14, 0, 0, 0); // Default to 2pm
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
      
      // Show feedback based on location source
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
    // Calculate actual date/time if date options are selected
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
      locationCoords, // GPS or searched location coordinates
      // Add actual date/time data
      actualDateTime: dateTimeData,
      // Add measurement system for distance calculations
      measurementSystem: accountPreferences?.measurementSystem || 'Metric'
    };
    
    if (onSave) {
      onSave(preferences);
    }
    if (onClose) {
      onClose();
    }
  };

  const totalSelections = 
    selectedExperiences.length + // Experience Type pills
    selectedCategories.length + // Category pills
    (budgetMin !== '' || budgetMax !== '' ? 1 : 0) + // Budget section
    (dateOption !== '' ? 1 : 0) + // Date section (only if a date is selected)
    (dateOption !== 'now' && dateOption !== '' && exactTime !== '' ? 1 : 0) + // Time section (if time is set)
    (travelMode !== '' ? 1 : 0) + // Travel Mode (only if selected)
    (timeConstraint !== '' || distanceConstraint !== '' ? 1 : 0) + // Travel Constraint (only if set)
    (useLocation !== '' ? 1 : 0); // Starting Location (only if selected)

  return (
    <div className="w-full max-w-4xl mx-auto pb-20 sm:pb-24">
      {/* Header - Sticky */}
      <div className="sticky top-0 z-50 glass-nav pb-3 sm:pb-4 mb-3 sm:mb-4 shadow-lg">
        <div className="relative text-center space-y-1.5 sm:space-y-2 px-3 sm:px-4 pt-3 sm:pt-4">
          <h1 className="text-lg sm:text-2xl md:text-3xl font-semibold text-gray-900 text-center font-bold">Narrow your search</h1>
        </div>
        {/* Shadow separator for visual depth when scrolling */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent"></div>
      </div>

      <div className="space-y-3 sm:space-y-6 px-3 sm:px-4">
        {/* Section 1: Experience Type */}
        <div className="glass-card rounded-xl sm:rounded-2xl p-3 sm:p-4 md:p-6 shadow-lg slide-up">
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
                    px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-full transition-smooth flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm border
                    ${isSelected 
                      ? 'border-[#eb7825] bg-[#eb7825] text-white shadow-md hover:scale-105 active:scale-95' 
                      : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50 hover:scale-105 active:scale-95'
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

        {/* Section 2: Categories */}
        <div className="glass-card rounded-xl sm:rounded-2xl p-3 sm:p-4 md:p-6 shadow-lg slide-up"
          style={{ animationDelay: '0.05s' }}>
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
                      p-3 sm:p-4 rounded-xl border-2 transition-smooth text-left hover:scale-105 active:scale-95 shadow-sm hover:shadow-md group
                      ${isSelected 
                        ? 'border-[#eb7825] bg-gradient-to-br from-orange-50 to-orange-100/50 shadow-md' 
                        : 'border-gray-200 bg-white hover:border-orange-200'
                      }
                    `}
                  >
                    <div className="flex items-center gap-2 mb-1 sm:mb-2">
                      <Icon className={`w-4 h-4 sm:w-5 sm:h-5 transition-smooth group-hover:scale-110 ${isSelected ? 'text-[#eb7825]' : 'text-gray-500'}`} />
                      <span className={`font-medium text-sm sm:text-base ${isSelected ? 'text-orange-700' : 'text-gray-900'}`}>
                        {category.label}
                      </span>
                    </div>
                    {isSelected && (
                      <p className="text-xs sm:text-sm text-orange-600 slide-up">{category.description}</p>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="col-span-full glass-badge bg-blue-50/50 border border-blue-200/50 rounded-xl p-4 text-center bounce-in backdrop-blur-sm">
                <p className="text-sm text-blue-800">
                  👆 Select an Experience Type above to see relevant categories
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Budget per Person */}
        <div className="glass-card rounded-xl sm:rounded-2xl p-3 sm:p-4 md:p-6 shadow-lg slide-up" style={{ animationDelay: '0.1s' }}>
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
                className="px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-gray-300 rounded-full hover:border-orange-300 hover:bg-orange-50 transition-smooth hover:scale-105 active:scale-95 shadow-sm hover:shadow-md"
              >
                {preset.label}
              </button>
            ))}
          </div>



        </div>

        {/* Section 4: Date & Time */}
        <div className="glass-card rounded-xl sm:rounded-2xl p-3 sm:p-4 md:p-6 shadow-lg slide-up" style={{ animationDelay: '0.15s' }}>
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
                    setExactTime(''); // Clear time for "Now" option
                  }
                }}
                className={`
                  py-2 sm:py-3 px-2 sm:px-4 rounded-xl transition-smooth text-xs sm:text-sm hover:scale-105 active:scale-95 shadow-sm hover:shadow-md
                  ${dateOption === option.id 
                    ? 'bg-[#eb7825] text-white shadow-md' 
                    : 'bg-white border border-gray-200 text-gray-700 hover:border-orange-200 hover:bg-orange-50'
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
            <div className="glass-badge bg-gradient-to-r from-blue-50/80 to-indigo-50/80 p-3 sm:p-4 rounded-xl border border-blue-200/50 mb-3 slide-up backdrop-blur-sm">
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

          {/* Time Picker - Show for all options except "Now" */}
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
        <div className="glass-card rounded-xl sm:rounded-2xl p-3 sm:p-4 md:p-6 shadow-lg slide-up" style={{ animationDelay: '0.2s' }}>
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

        {/* Section 6: Travel Constraint (Required) */}
        <div className="glass-card rounded-xl sm:rounded-2xl p-3 sm:p-4 md:p-6 shadow-lg slide-up" style={{ animationDelay: '0.25s' }}>
          <div className="mb-3 sm:mb-4">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900">Travel Limit</h2>
              <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">Required</span>
            </div>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">How far are you willing to travel?</p>
          </div>
          
          {/* Toggle between Time and Distance */}
          <div className="flex gap-1.5 sm:gap-2 mb-3 sm:mb-4">
            <button
              onClick={() => setConstraintType('time')}
              className={`
                flex-1 py-2 sm:py-3 px-3 sm:px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-xs sm:text-sm border
                ${constraintType === 'time' 
                  ? 'border-[#eb7825] bg-[#eb7825] text-white shadow-md' 
                  : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                }
              `}
            >
              <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>By Time</span>
            </button>
            <button
              onClick={() => setConstraintType('distance')}
              className={`
                flex-1 py-2 sm:py-3 px-3 sm:px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-xs sm:text-sm border
                ${constraintType === 'distance' 
                  ? 'border-[#eb7825] bg-[#eb7825] text-white shadow-md' 
                  : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                }
              `}
            >
              <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>By Distance</span>
            </button>
          </div>

          {/* Input based on constraint type */}
          {constraintType === 'time' ? (
            <div>
              <label className="block text-xs sm:text-sm text-gray-700 mb-1.5 sm:mb-2 font-medium">
                Maximum travel time (minutes)
              </label>
              <input
                type="number"
                value={timeConstraint}
                onChange={(e) => setTimeConstraint(e.target.value ? Number(e.target.value) : '')}
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-sm sm:text-base"
                placeholder="e.g. 20"
                min="1"
                required
              />
              <p className="text-xs text-gray-500 mt-1.5">
                {timeConstraint ? `Only show places within ${timeConstraint} min travel time` : 'Enter a time limit'}
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-xs sm:text-sm text-gray-700 mb-1.5 sm:mb-2 font-medium">
                Maximum distance ({accountPreferences?.measurementSystem === 'Metric' ? 'km' : 'miles'})
              </label>
              <input
                type="number"
                value={distanceConstraint}
                onChange={(e) => setDistanceConstraint(e.target.value ? Number(e.target.value) : '')}
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-sm sm:text-base"
                placeholder="e.g. 5"
                min="1"
                step="0.5"
                required
              />
              <p className="text-xs text-gray-500 mt-1.5">
                {distanceConstraint ? `Only show places within ${distanceConstraint} ${accountPreferences?.measurementSystem === 'Metric' ? 'km' : 'mi'}` : 'Enter a distance limit'}
              </p>
            </div>
          )}
        </div>

        {/* Section 7: Starting Location */}
        <div className="glass-card rounded-xl sm:rounded-2xl p-3 sm:p-4 md:p-6 shadow-lg slide-up" style={{ animationDelay: '0.3s' }}>
          <div className="mb-3 sm:mb-4">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">Starting Location</h2>
            <p className="text-xs sm:text-sm text-gray-600">Your starting point will shape travel time & distance results.</p>
          </div>
          <div className="space-y-3 sm:space-y-4">
            <div className="flex gap-1.5 sm:gap-2">
              <button
                onClick={() => {
                  setUseLocation('gps');
                  setSearchLocation('');
                }}
                className={`
                  flex-1 py-2 sm:py-3 px-3 sm:px-4 rounded-xl transition-all duration-200 font-medium text-xs sm:text-sm flex items-center justify-center gap-2
                  ${useLocation === 'gps' 
                    ? 'bg-[#eb7825] text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                <Navigation className="w-4 h-4" />
                Use My Location
              </button>
              <button
                onClick={() => setUseLocation('search')}
                className={`
                  flex-1 py-2 sm:py-3 px-3 sm:px-4 rounded-xl transition-all duration-200 font-medium text-xs sm:text-sm flex items-center justify-center gap-2
                  ${useLocation === 'search' 
                    ? 'bg-[#eb7825] text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                <MapPin className="w-4 h-4" />
                Search for a Place
              </button>
            </div>

            {/* GPS Location Status */}
            {useLocation === 'gps' && (
              <div className="bg-gray-50 rounded-lg p-3">
                {locationStatus === 'loading' && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-orange-500 border-t-transparent"></div>
                    <span>Getting your location...</span>
                  </div>
                )}
                {locationStatus === 'success' && !locationError && (
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span>Using your precise GPS location</span>
                  </div>
                )}
                {locationStatus === 'success' && locationError && (
                  <div className="flex items-center gap-2 text-sm text-orange-700">
                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                    <span>{locationError}</span>
                  </div>
                )}
                {locationStatus === 'error' && (
                  <div className="flex items-center gap-2 text-sm text-red-700">
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                    <span>{locationError || 'Could not get location'}</span>
                  </div>
                )}
              </div>
            )}

            {/* Search Location */}
            {useLocation === 'search' && (
              <div className="space-y-2">
                <GooglePlacesAutocomplete
                  value={searchLocation}
                  onChange={handlePlaceSelected}
                  placeholder="Search for your starting location..."
                />
                {locationStatus === 'success' && searchLocation && (
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg p-2">
                    <MapPin className="w-4 h-4" />
                    <span>Starting from: {searchLocation}</span>
                  </div>
                )}
                {locationStatus === 'error' && (
                  <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 rounded-lg p-2">
                    <span>{locationError}</span>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Sticky Footer */}
      <div className="fixed bottom-0 left-0 right-0 glass-nav p-2.5 sm:p-4 shadow-2xl z-50">
        <div className="max-w-4xl mx-auto flex gap-2 sm:gap-3">
          <button 
            onClick={handleApplyPreferences}
            className="flex-1 bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white py-3 sm:py-4 px-4 sm:px-6 rounded-xl font-medium hover:scale-105 active:scale-95 transition-smooth shadow-lg text-sm sm:text-base"
          >
            <span className="hidden sm:inline">Apply Preferences ({totalSelections})</span>
            <span className="sm:hidden">Apply ({totalSelections})</span>
          </button>
          <button 
            onClick={() => {
              setSelectedExperiences([]);
              setSelectedCategories([]);
              setBudgetMin('');
              setBudgetMax('');
              setDateOption('');
              setSelectedDate('');
              setSelectedTimeSlot('');
              setExactTime('');
              setTravelMode('');
              setConstraintType('time');
              setTimeConstraint('');
              setDistanceConstraint('');
              setUseLocation('');
              setSearchLocation('');
              setLocationCoords(null);
              setLocationStatus('idle');
              setLocationError('');
            }}
            className="glass-button text-gray-700 py-3 sm:py-4 px-4 sm:px-6 rounded-xl font-medium hover:scale-105 active:scale-95 transition-smooth text-sm sm:text-base shadow-md"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}