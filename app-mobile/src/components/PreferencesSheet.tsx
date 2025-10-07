import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ExperienceType {
  id: string;
  label: string;
  icon: string;
}

interface Category {
  id: string;
  label: string;
  emoji?: string;
  description: string;
}

const experienceTypes: ExperienceType[] = [
  { id: 'soloAdventure', label: 'Solo Adventure', icon: 'star' },
  { id: 'firstDate', label: 'First Date', icon: 'heart' },
  { id: 'romantic', label: 'Romantic', icon: 'heart' },
  { id: 'friendly', label: 'Friendly', icon: 'people' },
  { id: 'groupFun', label: 'Group Fun', icon: 'people' },
  { id: 'business', label: 'Business', icon: 'briefcase' }
];

const budgetPresets = [
  { label: '$0–25', min: 0, max: 25 },
  { label: '$25–75', min: 25, max: 75 },
  { label: '$75–150', min: 75, max: 150 },
  { label: '$150+', min: 150, max: 1000 }
];

const categories: Category[] = [
  { id: 'stroll', label: 'Take a Stroll', emoji: '🚶‍♀️🌳', description: 'Parks, neighborhoods, scenic walks' },
  { id: 'sipChill', label: 'Sip & Chill', emoji: '🍹☕🍷', description: 'Cafes, bars, lounges' },
  { id: 'casualEats', label: 'Casual Eats', emoji: '🍔🌮🍕', description: 'Food trucks, casual dining, markets' },
  { id: 'screenRelax', label: 'Screen & Relax', emoji: '🎬🎮📺', description: 'Movies, shows, gaming' },
  { id: 'creative', label: 'Creative & Hands-On', emoji: '🎨✂️🖌️', description: 'Art classes, workshops, DIY' },
  { id: 'playMove', label: 'Play & Move', emoji: '⚽🏃‍♀️🎾', description: 'Sports, games, active fun' },
  { id: 'diningExp', label: 'Dining Experiences', emoji: '🍽️🍷🥂', description: 'Fine dining, food tours, tastings' },
  { id: 'wellness', label: 'Wellness Dates', emoji: '🧘‍♀️🌸💆‍♀️', description: 'Spa, yoga, meditation, nature' },
  { id: 'freestyle', label: 'Freestyle', emoji: '✨🎲🎪', description: 'Unique, spontaneous experiences' }
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
    (useLocation !== 'gps' ? 1 : 0); // Starting Location (only if selected)

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {/* Cancel Button */}
        {onClose && (
          <TouchableOpacity
            onPress={onClose}
            style={styles.cancelButton}
          >
            <Ionicons name="close" size={24} color="#6b7280" />
          </TouchableOpacity>
        )}
        <Text style={styles.title}>Narrow your search</Text>
      </View>

      <View style={styles.content}>
        {/* Section 1: Experience Type */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Experience Type</Text>
            <Text style={styles.sectionSubtitle}>Date Idea / Friends / Romantic / Solo Adventure</Text>
          </View>
          <View style={styles.experienceTypesContainer}>
            {experienceTypes.map((type) => {
              const isSelected = selectedExperiences.includes(type.id);
              return (
                <TouchableOpacity
                  key={type.id}
                  onPress={() => handleExperienceToggle(type.id)}
                  style={[
                    styles.experienceTypeButton,
                    isSelected ? styles.experienceTypeButtonSelected : styles.experienceTypeButtonDefault
                  ]}
                >
                  <Ionicons 
                    name={type.icon as any} 
                    size={14} 
                    color={isSelected ? 'white' : '#6b7280'} 
                  />
                  <Text style={[
                    styles.experienceTypeText,
                    isSelected ? styles.experienceTypeTextSelected : styles.experienceTypeTextDefault
                  ]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Section 2: Budget per Person */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Budget per Person</Text>
          </View>
          
          {/* Min/Max Inputs */}
          <View style={styles.budgetInputsContainer}>
            <View style={styles.budgetInputWrapper}>
              <Text style={styles.inputLabel}>Min</Text>
              <View style={styles.inputContainer}>
                <Text style={styles.dollarSign}>$</Text>
                <TextInput
                  value={budgetMin?.toString() || ''}
                  onChangeText={(text) => setBudgetMin(text ? Number(text) : '')}
                  keyboardType="numeric"
                  style={styles.budgetInput}
                  placeholder="0"
                />
              </View>
            </View>
            <View style={styles.budgetInputWrapper}>
              <Text style={styles.inputLabel}>Max</Text>
              <View style={styles.inputContainer}>
                <Text style={styles.dollarSign}>$</Text>
                <TextInput
                  value={budgetMax?.toString() || ''}
                  onChangeText={(text) => setBudgetMax(text ? Number(text) : '')}
                  keyboardType="numeric"
                  style={styles.budgetInput}
                  placeholder="200"
                />
              </View>
            </View>
          </View>

          {/* Preset Shortcuts */}
          <View style={styles.budgetPresetsContainer}>
            {budgetPresets.map((preset) => (
              <TouchableOpacity
                key={preset.label}
                onPress={() => setBudgetPreset(preset.min, preset.max)}
                style={styles.budgetPresetButton}
              >
                <Text style={styles.budgetPresetText}>{preset.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Section 3: Categories */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Categories</Text>
          </View>
          <View style={styles.categoriesGrid}>
            {categories.map((category) => {
              const isSelected = selectedCategories.includes(category.id);
              return (
                <TouchableOpacity
                  key={category.id}
                  onPress={() => handleCategoryToggle(category.id)}
                  style={[
                    styles.categoryCard,
                    isSelected ? styles.categoryCardSelected : styles.categoryCardDefault
                  ]}
                >
                  <View style={styles.categoryHeader}>
                    <Text style={styles.categoryEmoji}>{category.emoji}</Text>
                    <Text style={[
                      styles.categoryLabel,
                      isSelected ? styles.categoryLabelSelected : styles.categoryLabelDefault
                    ]}>
                      {category.label}
                    </Text>
                  </View>
                  {isSelected && (
                    <Text style={styles.categoryDescription}>{category.description}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Section 4: Date */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Date</Text>
          </View>
          <View style={styles.dateOptionsGrid}>
            {[
              { id: 'now', label: 'Now', icon: '⚡', description: 'Right away' },
              { id: 'today', label: 'Today', icon: '📅', description: 'This evening' },
              { id: 'weekend', label: 'This Weekend', icon: '🎉', description: 'Fri-Sun' },
              { id: 'pick', label: 'Pick a Date', icon: '📆', description: 'Custom date' }
            ].map((option) => (
              <TouchableOpacity
                key={option.id}
                onPress={() => setDateOption(option.id)}
                style={[
                  styles.dateOptionButton,
                  dateOption === option.id ? styles.dateOptionButtonSelected : styles.dateOptionButtonDefault
                ]}
              >
                <Text style={styles.dateOptionIcon}>{option.icon}</Text>
                <Text style={[
                  styles.dateOptionText,
                  dateOption === option.id ? styles.dateOptionTextSelected : styles.dateOptionTextDefault
                ]}>
                  {option.label}
                </Text>
                <Text style={[
                  styles.dateOptionDescription,
                  dateOption === option.id ? styles.dateOptionDescriptionSelected : styles.dateOptionDescriptionDefault
                ]}>
                  {option.description}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          
          {/* Weekend Info */}
          {dateOption === 'weekend' && (
            <View style={styles.weekendInfo}>
              <View style={styles.weekendInfoHeader}>
                <Ionicons name="calendar" size={20} color="#ea580c" />
                <Text style={styles.weekendInfoTitle}>This Weekend:</Text>
              </View>
              <Text style={styles.weekendInfoText}>Automatically includes Friday, Saturday & Sunday</Text>
            </View>
          )}

          {/* Pick a Date */}
          {dateOption === 'pick' && (
            <View style={styles.customDateContainer}>
              <Text style={styles.inputLabel}>Select Date</Text>
              <View style={styles.dateInputContainer}>
                <Ionicons name="calendar" size={20} color="#9ca3af" style={styles.inputIcon} />
                <TextInput
                  value={selectedDate}
                  onChangeText={setSelectedDate}
                  style={styles.dateInput}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.dateSuggestions}>
                <Text style={styles.suggestionLabel}>Quick suggestions:</Text>
                <View style={styles.suggestionButtons}>
                  {[
                    { label: 'Tomorrow', days: 1 },
                    { label: 'Next Week', days: 7 },
                    { label: 'Next Month', days: 30 }
                  ].map((suggestion) => (
                    <TouchableOpacity
                      key={suggestion.label}
                      onPress={() => {
                        const futureDate = new Date();
                        futureDate.setDate(futureDate.getDate() + suggestion.days);
                        setSelectedDate(futureDate.toISOString().split('T')[0]);
                      }}
                      style={styles.suggestionButton}
                    >
                      <Text style={styles.suggestionButtonText}>{suggestion.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Section 5: Time */}
        {dateOption !== 'now' && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Time</Text>
            </View>
            
            <View style={styles.timeContainer}>
              <View style={styles.customTimeContainer}>
                <Text style={styles.inputLabel}>Custom Time</Text>
                <View style={styles.timeInputContainer}>
                  <Ionicons name="time" size={20} color="#9ca3af" style={styles.inputIcon} />
                  <TextInput
                    value={exactTime}
                    onChangeText={setExactTime}
                    style={styles.timeInput}
                    placeholder="HH:MM"
                    keyboardType="numeric"
                    maxLength={5}
                  />
                </View>
                
                <View style={styles.timeSuggestions}>
                  <Text style={styles.suggestionLabel}>Popular times:</Text>
                  <View style={styles.timeSuggestionButtons}>
                    {[
                      { time: '08:00', label: 'Early Morning' },
                      { time: '11:00', label: 'Late Morning' },
                      { time: '13:00', label: 'Afternoon' },
                      { time: '16:00', label: 'Late Afternoon' },
                      { time: '20:00', label: 'Evening' },
                      { time: '23:00', label: 'Late Night' }
                    ].map((suggestion) => (
                      <TouchableOpacity
                        key={suggestion.time}
                        onPress={() => setExactTime(suggestion.time)}
                        style={[
                          styles.timeSuggestionButton,
                          exactTime === suggestion.time ? styles.timeSuggestionButtonSelected : styles.timeSuggestionButtonDefault
                        ]}
                      >
                        <Text style={[
                          styles.timeSuggestionButtonText,
                          exactTime === suggestion.time ? styles.timeSuggestionButtonTextSelected : styles.timeSuggestionButtonTextDefault
                        ]}>
                          {suggestion.time}
                        </Text>
                        <Text style={[
                          styles.timeSuggestionButtonLabel,
                          exactTime === suggestion.time ? styles.timeSuggestionButtonLabelSelected : styles.timeSuggestionButtonLabelDefault
                        ]}>
                          {suggestion.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              {dateOption === 'today' && (
                <View style={styles.todayTip}>
                  <Text style={styles.todayTipText}>💡 Choose any time from now until the end of today</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Section 6: Travel Mode */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Travel Mode</Text>
          </View>
          <View style={styles.travelModesContainer}>
            {travelModes.map((mode) => (
              <TouchableOpacity 
                key={mode.id} 
                onPress={() => setTravelMode(mode.id)}
                style={[
                  styles.travelModeButton,
                  travelMode === mode.id ? styles.travelModeButtonSelected : styles.travelModeButtonDefault
                ]}
              >
                <View style={[
                  styles.radioButton,
                  travelMode === mode.id ? styles.radioButtonSelected : styles.radioButtonDefault
                ]}>
                  {travelMode === mode.id && (
                    <View style={styles.radioButtonInner} />
                  )}
                </View>
                <Text style={styles.travelModeIcon}>{mode.icon}</Text>
                <Text style={styles.travelModeLabel}>{mode.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Section 7: Travel Constraint */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Travel Constraint</Text>
          </View>
          <View style={styles.constraintTypeContainer}>
            <TouchableOpacity
              onPress={() => setConstraintType('time')}
              style={[
                styles.constraintTypeButton,
                constraintType === 'time' ? styles.constraintTypeButtonSelected : styles.constraintTypeButtonDefault
              ]}
            >
              <Text style={[
                styles.constraintTypeText,
                constraintType === 'time' ? styles.constraintTypeTextSelected : styles.constraintTypeTextDefault
              ]}>
                ⏱️ By Time
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setConstraintType('distance')}
              style={[
                styles.constraintTypeButton,
                constraintType === 'distance' ? styles.constraintTypeButtonSelected : styles.constraintTypeButtonDefault
              ]}
            >
              <Text style={[
                styles.constraintTypeText,
                constraintType === 'distance' ? styles.constraintTypeTextSelected : styles.constraintTypeTextDefault
              ]}>
                📍 By Distance
              </Text>
            </TouchableOpacity>
          </View>
          {constraintType === 'time' ? (
            <View style={styles.constraintInputContainer}>
              <Text style={styles.inputLabel}>Keep it under X minutes</Text>
              <TextInput
                value={timeConstraint?.toString() || ''}
                onChangeText={(text) => setTimeConstraint(text ? Number(text) : '')}
                keyboardType="numeric"
                style={styles.constraintInput}
                placeholder="20"
              />
            </View>
          ) : (
            <View style={styles.constraintInputContainer}>
              <Text style={styles.inputLabel}>Keep it within X miles</Text>
              <TextInput
                value={distanceConstraint?.toString() || ''}
                onChangeText={(text) => setDistanceConstraint(text ? Number(text) : '')}
                keyboardType="numeric"
                style={styles.constraintInput}
                placeholder="5"
              />
            </View>
          )}
        </View>

        {/* Section 8: Starting Location */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Starting Location</Text>
            <Text style={styles.sectionSubtitle}>Your starting point will shape travel time & distance results.</Text>
          </View>
          <View style={styles.locationContainer}>
            <View style={styles.locationOptionsContainer}>
              <TouchableOpacity
                onPress={() => setUseLocation('gps')}
                style={[
                  styles.locationOptionButton,
                  useLocation === 'gps' ? styles.locationOptionButtonSelected : styles.locationOptionButtonDefault
                ]}
              >
                <Text style={[
                  styles.locationOptionText,
                  useLocation === 'gps' ? styles.locationOptionTextSelected : styles.locationOptionTextDefault
                ]}>
                  Use My Location
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setUseLocation('search')}
                style={[
                  styles.locationOptionButton,
                  useLocation === 'search' ? styles.locationOptionButtonSelected : styles.locationOptionButtonDefault
                ]}
              >
                <Text style={[
                  styles.locationOptionText,
                  useLocation === 'search' ? styles.locationOptionTextSelected : styles.locationOptionTextDefault
                ]}>
                  Search for a Place
                </Text>
              </TouchableOpacity>
            </View>
            {useLocation === 'search' && (
              <View style={styles.searchLocationContainer}>
                <TextInput
                  value={searchLocation}
                  onChangeText={setSearchLocation}
                  style={styles.searchLocationInput}
                  placeholder="Enter address or place name..."
                />
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.footerButtonsContainer}>
          <TouchableOpacity 
            onPress={handleApplyPreferences}
            style={styles.applyButton}
          >
            <Text style={styles.applyButtonText}>Apply Preferences ({totalSelections})</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            onPress={() => {
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
              setUseLocation('gps');
              setSearchLocation('');
            }}
            style={styles.resetButton}
          >
            <Text style={styles.resetButtonText}>Reset</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    position: 'relative',
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  cancelButton: {
    position: 'absolute',
    left: 16,
    top: 32,
    padding: 8,
    borderRadius: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: 16,
    gap: 24,
  },
  section: {
    backgroundColor: 'white',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  experienceTypesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  experienceTypeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  experienceTypeButtonSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#eb7825',
  },
  experienceTypeButtonDefault: {
    borderColor: '#d1d5db',
    backgroundColor: 'white',
  },
  experienceTypeText: {
    fontSize: 14,
    fontWeight: '500',
  },
  experienceTypeTextSelected: {
    color: 'white',
  },
  experienceTypeTextDefault: {
    color: '#374151',
  },
  budgetInputsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  budgetInputWrapper: {
    flex: 1,
  },
  inputLabel: {
    color: '#6b7280',
    fontSize: 14,
    marginBottom: 8,
  },
  inputContainer: {
    position: 'relative',
  },
  dollarSign: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: [{ translateY: -10 }],
    color: '#6b7280',
    fontSize: 16,
  },
  budgetInput: {
    width: '100%',
    paddingLeft: 28,
    paddingRight: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: 'white',
  },
  budgetPresetsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  budgetPresetButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 20,
    backgroundColor: 'white',
  },
  budgetPresetText: {
    fontSize: 14,
    color: '#374151',
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  categoryCard: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 12,
  },
  categoryCardSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#fef3e2',
  },
  categoryCardDefault: {
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  categoryEmoji: {
    fontSize: 24,
    marginRight: 8,
  },
  categoryLabel: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    flexWrap: 'wrap',
  },
  categoryLabelSelected: {
    color: '#ea580c',
  },
  categoryLabelDefault: {
    color: '#111827',
  },
  categoryDescription: {
    fontSize: 14,
    color: '#ea580c',
  },
  dateOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  dateOptionButton: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: '22%',
    minHeight: 80,
    justifyContent: 'center',
  },
  dateOptionButtonSelected: {
    backgroundColor: '#eb7825',
  },
  dateOptionButtonDefault: {
    backgroundColor: '#f3f4f6',
  },
  dateOptionText: {
    fontWeight: '500',
  },
  dateOptionTextSelected: {
    color: 'white',
  },
  dateOptionTextDefault: {
    color: '#374151',
  },
  dateOptionIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  dateOptionDescription: {
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  dateOptionDescriptionSelected: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  dateOptionDescriptionDefault: {
    color: '#6b7280',
  },
  customDateContainer: {
    marginTop: 16,
  },
  dateInputContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  dateSuggestions: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  suggestionLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 12,
  },
  suggestionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  suggestionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    alignItems: 'center',
  },
  suggestionButtonText: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
  weekendInfo: {
    backgroundColor: '#fef3e2',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  weekendInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  weekendInfoTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#ea580c',
  },
  weekendInfoText: {
    fontSize: 14,
    color: '#ea580c',
  },
  inputIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: [{ translateY: -10 }],
  },
  dateInput: {
    width: '100%',
    paddingLeft: 48,
    paddingRight: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: '#f9fafb',
  },
  timeContainer: {
    gap: 20,
  },
  customTimeContainer: {
    marginTop: 16,
  },
  timeInputContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  timeSuggestions: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  timeSuggestionButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeSuggestionButton: {
    flex: 1,
    minWidth: '30%',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  timeSuggestionButtonSelected: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
  },
  timeSuggestionButtonDefault: {
    backgroundColor: 'white',
    borderColor: '#d1d5db',
  },
  timeSuggestionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  timeSuggestionButtonTextSelected: {
    color: 'white',
  },
  timeSuggestionButtonTextDefault: {
    color: '#374151',
  },
  timeSuggestionButtonLabel: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
  timeSuggestionButtonLabelSelected: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  timeSuggestionButtonLabelDefault: {
    color: '#6b7280',
  },
  timeInput: {
    width: '100%',
    paddingLeft: 48,
    paddingRight: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: '#f9fafb',
  },
  todayTip: {
    backgroundColor: '#dbeafe',
    padding: 8,
    borderRadius: 8,
  },
  todayTipText: {
    fontSize: 12,
    color: '#6b7280',
  },
  travelModesContainer: {
    gap: 8,
  },
  travelModeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  travelModeButtonSelected: {
    backgroundColor: '#fef3e2',
  },
  travelModeButtonDefault: {
    backgroundColor: 'transparent',
  },
  radioButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  radioButtonSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#eb7825',
  },
  radioButtonDefault: {
    borderColor: '#d1d5db',
    backgroundColor: 'transparent',
  },
  radioButtonInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
  },
  travelModeIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  travelModeLabel: {
    fontWeight: '500',
    color: '#111827',
  },
  constraintTypeContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  constraintTypeButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    gap: 8,
  },
  constraintTypeButtonSelected: {
    backgroundColor: '#eb7825',
  },
  constraintTypeButtonDefault: {
    backgroundColor: '#f3f4f6',
  },
  constraintTypeText: {
    fontWeight: '500',
  },
  constraintTypeTextSelected: {
    color: 'white',
  },
  constraintTypeTextDefault: {
    color: '#374151',
  },
  constraintInputContainer: {
    marginTop: 16,
  },
  constraintInput: {
    width: '100%',
    padding: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: 'white',
  },
  searchLocationContainer: {
    marginTop: 16,
  },
  locationContainer: {
    gap: 16,
  },
  locationOptionsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  locationOptionButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  locationOptionButtonSelected: {
    backgroundColor: '#eb7825',
  },
  locationOptionButtonDefault: {
    backgroundColor: '#f3f4f6',
  },
  locationOptionText: {
    fontWeight: '500',
  },
  locationOptionTextSelected: {
    color: 'white',
  },
  locationOptionTextDefault: {
    color: '#374151',
  },
  searchLocationInput: {
    width: '100%',
    padding: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: 'white',
  },
  footer: {
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  footerButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  applyButton: {
    flex: 1,
    backgroundColor: '#eb7825',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  applyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  resetButton: {
    backgroundColor: '#f3f4f6',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '500',
  },
});