import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput } from 'react-native';
import { 
  Heart, Users, Star, DollarSign, MapPin, Clock, Car, 
  Train, Navigation, Calendar, Sun, Moon, TreePine, 
  Coffee, Utensils, Monitor, Palette, Gamepad2, Dumbbell,
  Sparkles, Music, Target, Gift, X
} from 'lucide-react';

interface ExperienceType {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface Category {
  id: string;
  label: string;
  emoji?: string;
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
  { id: 'stroll', label: 'Take a Stroll', description: 'Parks, neighborhoods, scenic walks' },
  { id: 'sipChill', label: 'Sip & Chill', emoji: '🍹☕🍷', description: 'Cafes, bars, lounges' },
  { id: 'casualEats', label: 'Casual Eats', description: 'Food trucks, casual dining, markets' },
  { id: 'screenRelax', label: 'Screen & Relax', description: 'Movies, shows, gaming' },
  { id: 'creative', label: 'Creative & Hands-On', description: 'Art classes, workshops, DIY' },
  { id: 'playMove', label: 'Play & Move', description: 'Sports, games, active fun' },
  { id: 'diningExp', label: 'Dining Experiences', description: 'Fine dining, food tours, tastings' },
  { id: 'wellness', label: 'Wellness Dates', description: 'Spa, yoga, meditation, nature' },
  { id: 'freestyle', label: 'Freestyle', description: 'Unique, spontaneous experiences' }
];

const travelModes = [
  { id: 'walk', label: 'Walk', subtitle: '(~2 miles)', icon: '🚶‍♀️' },
  { id: 'drive', label: 'Drive', subtitle: '(~20 miles)', icon: '🚗' },
  { id: 'transit', label: 'Public transport', subtitle: '(~45 min ride)', icon: '🚌' }
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
}

export default function PreferencesSheet({ onClose, onSave }: PreferencesSheetProps) {
  const [selectedExperiences, setSelectedExperiences] = useState<string[]>([]);
  const [budgetMin, setBudgetMin] = useState<number | ''>('');
  const [budgetMax, setBudgetMax] = useState<number | ''>('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [dateOption, setDateOption] = useState<string>('now');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('');
  const [exactTime, setExactTime] = useState<string>('');
  const [travelMode, setTravelMode] = useState<string>('walk');
  const [constraintType, setConstraintType] = useState<'time' | 'distance'>('time');
  const [timeConstraint, setTimeConstraint] = useState<number | ''>('');
  const [distanceConstraint, setDistanceConstraint] = useState<number | ''>('');
  const [useLocation, setUseLocation] = useState<'gps' | 'search'>('gps');
  const [searchLocation, setSearchLocation] = useState<string>('');

  const handleExperienceToggle = (id: string) => {
    setSelectedExperiences(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleCategoryToggle = (id: string) => {
    setSelectedCategories(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const setBudgetPreset = (min: number, max: number) => {
    setBudgetMin(min);
    setBudgetMax(max);
  };

  const handleApplyPreferences = () => {
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
      searchLocation
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
    <View className="w-full max-w-4xl mx-auto pb-24 pt-8">
      {/* Header */}
      <View className="relative text-center space-y-2 mb-8 px-4">
        {/* Cancel Button */}
        {onClose && (
          <TouchableOpacity
            onClick={onClose}
            className="absolute left-4 top-0 p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-6 h-6 text-gray-600" />
          </TouchableOpacity>
        )}
        <Text className="text-2xl sm:text-3xl font-semibold text-gray-900 text-center font-bold">Narrow your search</Text>

      </View>

      <View className="space-y-6 px-4">
        {/* Section 1: Experience Type */}
        <View className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-sm">
          <View className="mb-4">
            <Text className="text-lg font-semibold text-gray-900 mb-1">Experience Type</Text>
            <Text className="text-sm text-gray-600">Date Idea / Friends / Romantic / Solo Adventure</Text>
          </View>
          <View className="flex flex-wrap gap-2">
            {experienceTypes.map((type) => {
              const Icon = type.icon;
              const isSelected = selectedExperiences.includes(type.id);
              return (
                <TouchableOpacity
                  key={type.id}
                  onClick={() => handleExperienceToggle(type.id)}
                  className={`
                    px-4 py-2 rounded-full transition-all duration-200 flex items-center gap-2 text-sm border
                    ${isSelected 
                      ? 'border-[#eb7825] bg-[#eb7825] text-white shadow-md' 
                      : 'border-gray-300 bg-white text-gray-700 hover:border-orange-300 hover:bg-orange-50'
                    }
                  `}
                >
                  <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-gray-500'}`} />
                  {type.label}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Section 2: Budget per Person */}
        <View className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-sm">
          <View className="mb-4">
            <Text className="text-lg font-semibold text-gray-900">Budget per Person</Text>
          </View>
          
          {/* Min/Max Inputs */}
          <View className="flex gap-3 mb-4">
            <View className="flex-1">
              <Text style={{ color: '#6b7280', fontSize: 14, marginBottom: 8 }}>Min</Text>
              <View className="relative">
                <Text className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</Text>
                <TextInput
                  value={budgetMin?.toString() || ''}
                  onChangeText={(text) => setBudgetMin(text ? Number(text) : '')}
                  keyboardType="numeric"
                  style={{
                    width: '100%',
                    paddingLeft: 28,
                    paddingRight: 12,
                    paddingVertical: 12,
                    borderWidth: 1,
                    borderColor: '#d1d5db',
                    borderRadius: 12,
                    fontSize: 16,
                    backgroundColor: 'white'
                  }}
                  placeholder="0"
                />
              </View>
            </View>
            <View className="flex-1">
              <Text style={{ color: '#6b7280', fontSize: 14, marginBottom: 8 }}>Max</Text>
              <View className="relative">
                <Text className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</Text>
                <TextInput
                  value={budgetMax?.toString() || ''}
                  onChangeText={(text) => setBudgetMax(text ? Number(text) : '')}
                  keyboardType="numeric"
                  style={{
                    width: '100%',
                    paddingLeft: 28,
                    paddingRight: 12,
                    paddingVertical: 12,
                    borderWidth: 1,
                    borderColor: '#d1d5db',
                    borderRadius: 12,
                    fontSize: 16,
                    backgroundColor: 'white'
                  }}
                  placeholder="200"
                />
              </View>
            </View>
          </View>

          {/* Preset Shortcuts */}
          <View className="flex flex-wrap gap-2 mb-3">
            {budgetPresets.map((preset) => (
              <TouchableOpacity
                key={preset.label}
                onClick={() => setBudgetPreset(preset.min, preset.max)}
                className="px-3 py-2 text-sm border border-gray-300 rounded-full hover:border-orange-300 hover:bg-orange-50 transition-colors"
              >
                {preset.label}
              </TouchableOpacity>
            ))}
          </View>



        </View>

        {/* Section 3: Categories */}
        <View className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-sm">
          <View className="mb-4">
            <Text className="text-lg font-semibold text-gray-900">Categories</Text>
          </View>
          <View className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {categories.map((category) => {
              const isSelected = selectedCategories.includes(category.id);
              return (
                <TouchableOpacity
                  key={category.id}
                  onClick={() => handleCategoryToggle(category.id)}
                  className={`
                    p-4 rounded-xl border-2 transition-all duration-200 text-left
                    ${isSelected 
                      ? 'border-[#eb7825] bg-orange-50' 
                      : 'border-gray-200 bg-white hover:border-gray-300'
                    }
                  `}
                >
                  <View className="flex items-center gap-2 mb-2">

                    <Text className={`font-medium ${isSelected ? 'text-orange-700' : 'text-gray-900'}`}>
                      {category.label}
                    </Text>
                  </View>
                  {isSelected && (
                    <Text className="text-sm text-orange-600">{category.description}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Section 4: Date */}
        <View className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-sm">
          <View className="mb-4">
            <Text className="text-lg font-semibold text-gray-900">Date</Text>
          </View>
          <View className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {[
              { id: 'now', label: 'Now' },
              { id: 'today', label: 'Today' },
              { id: 'weekend', label: 'This Weekend' },
              { id: 'pick', label: 'Pick a Date' }
            ].map((option) => (
              <TouchableOpacity
                key={option.id}
                onClick={() => setDateOption(option.id)}
                className={`
                  py-3 px-4 rounded-xl transition-all duration-200 font-medium
                  ${dateOption === option.id 
                    ? 'bg-[#eb7825] text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                {option.label}
              </TouchableOpacity>
            ))}
          </View>
          
          {/* Weekend Info */}
          {dateOption === 'weekend' && (
            <View className="bg-gradient-to-r from-orange-50 to-amber-50 p-4 rounded-xl border border-orange-200">
              <View className="flex items-center gap-2 mb-2">
                <Calendar className="w-5 h-5 text-orange-600" />
                <Text className="text-sm font-medium text-orange-800">This Weekend:</Text>
              </View>
              <Text className="text-sm text-orange-700">Automatically includes Friday, Saturday & Sunday</Text>
            </View>
          )}

          {/* Pick a Date */}
          {dateOption === 'pick' && (
            <View>
              <Text style={{ color: '#6b7280', fontSize: 14, marginBottom: 8 }}>Select Date</Text>
              <View className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <TextInput
                  value={selectedDate}
                  onChangeText={setSelectedDate}
                  style={{
                    width: '100%',
                    paddingLeft: 48,
                    paddingRight: 16,
                    paddingVertical: 12,
                    borderWidth: 1,
                    borderColor: '#d1d5db',
                    borderRadius: 12,
                    fontSize: 16,
                    backgroundColor: '#f9fafb'
                  }}
                  placeholder="YYYY-MM-DD"
                />
              </View>
            </View>
          )}
        </View>

        {/* Section 5: Time */}
        {dateOption !== 'now' && (
          <View className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-sm">
            <View className="mb-4">
              <Text className="text-lg font-semibold text-gray-900">Time</Text>
            </View>
            
            <View className="space-y-4">
              <View>
                <Text style={{ color: '#6b7280', fontSize: 14, marginBottom: 12 }}>Quick Select</Text>
                <View className="grid grid-cols-3 gap-2 mb-3">
                  {(dateOption === 'today' 
                    ? ['09:00', '12:00', '15:00', '18:00', '21:00']
                    : dateOption === 'weekend'
                    ? ['10:00', '14:00', '17:00', '19:00', '22:00']
                    : ['09:00', '12:00', '15:00', '18:00', '21:00']
                  ).map((time) => (
                    <TouchableOpacity
                      key={time}
                      onClick={() => setExactTime(time)}
                      className={`
                        py-3 px-4 rounded-lg border-2 transition-all duration-200 font-medium
                        ${exactTime === time 
                          ? 'border-[#eb7825] bg-orange-50 text-orange-700' 
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                        }
                      `}
                    >
                      {time}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              
              <View>
                <Text style={{ color: '#6b7280', fontSize: 14, marginBottom: 8 }}>Custom Time</Text>
                <View className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <TextInput
                    value={exactTime}
                    onChangeText={setExactTime}
                    style={{
                      width: '100%',
                      paddingLeft: 48,
                      paddingRight: 16,
                      paddingVertical: 12,
                      borderWidth: 1,
                      borderColor: '#d1d5db',
                      borderRadius: 12,
                      fontSize: 16,
                      backgroundColor: '#f9fafb'
                    }}
                    placeholder="Enter custom time"
                  />
                </View>
              </View>

              {dateOption === 'today' && (
                <Text className="text-xs text-gray-500 bg-blue-50 p-2 rounded-lg">💡 Choose any time from now until the end of today</Text>
              )}
            </View>
          </View>
        )}

        {/* Section 6: Travel Mode */}
        <View className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-sm">
          <View className="mb-4">
            <Text className="text-lg font-semibold text-gray-900">Travel Mode</Text>
          </View>
          <View className="space-y-2">
            {travelModes.map((mode) => (
              <TouchableOpacity 
                key={mode.id} 
                onPress={() => setTravelMode(mode.id)}
                style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  padding: 12, 
                  borderRadius: 12, 
                  borderWidth: 1, 
                  borderColor: '#e5e7eb',
                  backgroundColor: travelMode === mode.id ? '#fef3f2' : 'transparent'
                }}
              >
                <View style={{ 
                  width: 20, 
                  height: 20, 
                  borderRadius: 10, 
                  borderWidth: 2, 
                  borderColor: travelMode === mode.id ? '#eb7825' : '#d1d5db',
                  backgroundColor: travelMode === mode.id ? '#eb7825' : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12
                }}>
                  {travelMode === mode.id && (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: 'white' }} />
                  )}
                </View>
                <Text style={{ fontSize: 24, marginRight: 12 }}>{mode.icon}</Text>
                <View>
                  <Text style={{ fontWeight: '500' }}>{mode.label}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Section 7: Travel Constraint */}
        <View className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-sm">
          <View className="mb-4">
            <Text className="text-lg font-semibold text-gray-900">Travel Constraint</Text>
          </View>
          <View className="flex gap-2 mb-4">
            <TouchableOpacity
              onClick={() => setConstraintType('time')}
              className={`
                flex-1 py-3 px-4 rounded-xl transition-all duration-200 font-medium flex items-center justify-center gap-2
                ${constraintType === 'time' 
                  ? 'bg-[#eb7825] text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
            >
              ⏱️ By Time
            </TouchableOpacity>
            <TouchableOpacity
              onClick={() => setConstraintType('distance')}
              className={`
                flex-1 py-3 px-4 rounded-xl transition-all duration-200 font-medium flex items-center justify-center gap-2
                ${constraintType === 'distance' 
                  ? 'bg-[#eb7825] text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
            >
              📍 By Distance
            </TouchableOpacity>
          </View>
          {constraintType === 'time' ? (
            <View>
              <Text style={{ color: '#6b7280', fontSize: 14, marginBottom: 8 }}>Keep it under X minutes</Text>
              <TextInput
                value={timeConstraint?.toString() || ''}
                onChangeText={(text) => setTimeConstraint(text ? Number(text) : '')}
                keyboardType="numeric"
                style={{
                  width: '100%',
                  padding: 12,
                  borderWidth: 1,
                  borderColor: '#d1d5db',
                  borderRadius: 12,
                  fontSize: 16,
                  backgroundColor: 'white'
                }}
                placeholder="20"
              />
            </View>
          ) : (
            <View>
              <Text style={{ color: '#6b7280', fontSize: 14, marginBottom: 8 }}>Keep it within X miles</Text>
              <TextInput
                value={distanceConstraint?.toString() || ''}
                onChangeText={(text) => setDistanceConstraint(text ? Number(text) : '')}
                keyboardType="numeric"
                style={{
                  width: '100%',
                  padding: 12,
                  borderWidth: 1,
                  borderColor: '#d1d5db',
                  borderRadius: 12,
                  fontSize: 16,
                  backgroundColor: 'white'
                }}
                placeholder="5"
              />
            </View>
          )}
        </View>

        {/* Section 8: Starting Location */}
        <View className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 shadow-sm">
          <View className="mb-4">
            <Text className="text-lg font-semibold text-gray-900">Starting Location</Text>
            <Text className="text-sm text-gray-600">Your starting point will shape travel time & distance results.</Text>
          </View>
          <View className="space-y-4">
            <View className="flex gap-2">
              <TouchableOpacity
                onClick={() => setUseLocation('gps')}
                className={`
                  flex-1 py-3 px-4 rounded-xl transition-all duration-200 font-medium
                  ${useLocation === 'gps' 
                    ? 'bg-[#eb7825] text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                Use My Location
              </TouchableOpacity>
              <TouchableOpacity
                onClick={() => setUseLocation('search')}
                className={`
                  flex-1 py-3 px-4 rounded-xl transition-all duration-200 font-medium
                  ${useLocation === 'search' 
                    ? 'bg-[#eb7825] text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                Search for a Place
              </TouchableOpacity>
            </View>
            {useLocation === 'search' && (
              <TextInput
                value={searchLocation}
                onChangeText={setSearchLocation}
                style={{
                  width: '100%',
                  padding: 12,
                  borderWidth: 1,
                  borderColor: '#d1d5db',
                  borderRadius: 12,
                  fontSize: 16,
                  backgroundColor: 'white'
                }}
                placeholder="Enter address or place name..."
              />
            )}

          </View>
        </View>
      </View>

      {/* Sticky Footer */}
      <View className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg">
        <View className="max-w-4xl mx-auto flex gap-3">
          <TouchableOpacity 
            onClick={handleApplyPreferences}
            className="flex-1 bg-[#eb7825] text-white py-4 px-6 rounded-xl font-medium hover:bg-orange-600 transition-all duration-200 shadow-lg"
          >
            Apply Preferences ({totalSelections})
          </TouchableOpacity>
          <TouchableOpacity 
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
            }}
            className="bg-gray-100 text-gray-700 py-4 px-6 rounded-xl font-medium hover:bg-gray-200 transition-all duration-200"
          >
            Reset
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}