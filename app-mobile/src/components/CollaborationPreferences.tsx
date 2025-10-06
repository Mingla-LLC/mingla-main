import React, { useState } from 'react';
import { Text, View, TouchableOpacity, TextInput, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface CollaborationPreferencesProps {
  isOpen: boolean;
  onClose: () => void;
  sessionName: string;
  participants: Array<{ id: string; name: string; avatar?: string }>;
  onSave: (preferences: any) => void;
}

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

// Remove 'soloAdventure' from the experience types for collaboration
const experienceTypes: ExperienceType[] = [
  { id: 'firstDate', label: 'First Date', icon: 'heart' },
  { id: 'romantic', label: 'Romantic', icon: 'heart' },
  { id: 'friendly', label: 'Friendly', icon: 'people' },
  { id: 'groupFun', label: 'Group Fun', icon: 'people' },
  { id: 'business', label: 'Business', icon: 'target' }
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

export default function CollaborationPreferences({ 
  isOpen, 
  onClose, 
  sessionName, 
  participants, 
  onSave 
}: CollaborationPreferencesProps) {
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

  const handleSave = () => {
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
    onSave(preferences);
    onClose();
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

  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <ScrollView style={styles.scrollView}>
            <View style={styles.content}>
              {/* Header */}
            <View style={styles.header}>
              {/* Cancel Button */}
              <TouchableOpacity
                onPress={onClose}
                style={styles.cancelButton}
              >
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Narrow your search</Text>
              <Text style={styles.headerSubtitle}>Collaboration Preferences for "{sessionName}"</Text>
            </View>
            </View>

            <View style={styles.sectionsContainer}>
              {/* Section 1: Experience Type */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Experience Type</Text>
                  <Text style={styles.sectionSubtitle}>Date Idea / Friends / Romantic / Group</Text>
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
                          isSelected && styles.experienceTypeButtonSelected
                        ]}
                      >
                        <Ionicons 
                          name={type.icon as any} 
                          size={14} 
                          color={isSelected ? 'white' : '#6b7280'} 
                        />
                        <Text style={[
                          styles.experienceTypeText,
                          isSelected && styles.experienceTypeTextSelected
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
                    <View style={styles.budgetInputContainer}>
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
                    <View style={styles.budgetInputContainer}>
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
                          isSelected && styles.categoryCardSelected
                        ]}
                      >
                        <View style={styles.categoryHeader}>
                          <Text style={[
                            styles.categoryTitle,
                            isSelected && styles.categoryTitleSelected
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
                    { id: 'now', label: 'Now' },
                    { id: 'today', label: 'Today' },
                    { id: 'weekend', label: 'This Weekend' },
                    { id: 'pick', label: 'Pick a Date' }
                  ].map((option) => (
                    <TouchableOpacity
                      key={option.id}
                      onPress={() => setDateOption(option.id)}
                      style={[
                        styles.dateOptionButton,
                        dateOption === option.id && styles.dateOptionButtonSelected
                      ]}
                    >
                      <Text style={[
                        styles.dateOptionText,
                        dateOption === option.id && styles.dateOptionTextSelected
                      ]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                
                {/* Weekend Info */}
                {dateOption === 'weekend' && (
                  <View style={styles.weekendInfo}>
                    <View style={styles.weekendInfoHeader}>
                      <Ionicons name="calendar" size={20} color="#d97706" />
                      <Text style={styles.weekendInfoTitle}>This Weekend:</Text>
                    </View>
                    <Text style={styles.weekendInfoText}>Automatically includes Friday, Saturday & Sunday</Text>
                  </View>
                )}

                {/* Pick a Date */}
                {dateOption === 'pick' && (
                  <View>
                    <Text style={styles.inputLabel}>Select Date</Text>
                    <View style={styles.dateInputContainer}>
                      <Ionicons name="calendar" size={20} color="#9ca3af" style={styles.dateInputIcon} />
                      <TextInput
                        value={selectedDate}
                        onChangeText={setSelectedDate}
                        style={styles.dateInput}
                        placeholder="YYYY-MM-DD"
                      />
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
                  
                  <View style={styles.timeSection}>
                    <View>
                      <Text style={styles.inputLabel}>Quick Select</Text>
                      <View style={styles.timeOptionsGrid}>
                        {(dateOption === 'today' 
                          ? ['09:00', '12:00', '15:00', '18:00', '21:00']
                          : dateOption === 'weekend'
                          ? ['10:00', '14:00', '17:00', '19:00', '22:00']
                          : ['09:00', '12:00', '15:00', '18:00', '21:00']
                        ).map((time) => (
                          <TouchableOpacity
                            key={time}
                            onPress={() => setExactTime(time)}
                            style={[
                              styles.timeOptionButton,
                              exactTime === time && styles.timeOptionButtonSelected
                            ]}
                          >
                            <Text style={[
                              styles.timeOptionText,
                              exactTime === time && styles.timeOptionTextSelected
                            ]}>
                              {time}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                    
                    <View>
                      <Text style={styles.inputLabel}>Custom Time</Text>
                      <View style={styles.timeInputContainer}>
                        <Ionicons name="time" size={20} color="#9ca3af" style={styles.timeInputIcon} />
                        <TextInput
                          value={exactTime}
                          onChangeText={setExactTime}
                          style={styles.timeInput}
                          placeholder="Enter custom time"
                        />
                      </View>
                    </View>

                    {dateOption === 'today' && (
                      <Text style={styles.todayTip}>💡 Choose any time from now until the end of today</Text>
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
                        travelMode === mode.id && styles.travelModeButtonSelected
                      ]}
                    >
                      <View style={[
                        styles.travelModeRadio,
                        travelMode === mode.id && styles.travelModeRadioSelected
                      ]}>
                        {travelMode === mode.id && (
                          <View style={styles.travelModeRadioInner} />
                        )}
                      </View>
                      <Text style={styles.travelModeIcon}>{mode.icon}</Text>
                      <View>
                        <Text style={styles.travelModeLabel}>{mode.label}</Text>
                      </View>
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
                      constraintType === 'time' && styles.constraintTypeButtonSelected
                    ]}
                  >
                    <Text style={[
                      styles.constraintTypeText,
                      constraintType === 'time' && styles.constraintTypeTextSelected
                    ]}>
                      ⏱️ By Time
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setConstraintType('distance')}
                    style={[
                      styles.constraintTypeButton,
                      constraintType === 'distance' && styles.constraintTypeButtonSelected
                    ]}
                  >
                    <Text style={[
                      styles.constraintTypeText,
                      constraintType === 'distance' && styles.constraintTypeTextSelected
                    ]}>
                      📍 By Distance
                    </Text>
                  </TouchableOpacity>
                </View>
                {constraintType === 'time' ? (
                  <View>
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
                  <View>
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
                <View style={styles.locationSection}>
                  <View style={styles.locationOptionsContainer}>
                    <TouchableOpacity
                      onPress={() => setUseLocation('gps')}
                      style={[
                        styles.locationOptionButton,
                        useLocation === 'gps' && styles.locationOptionButtonSelected
                      ]}
                    >
                      <Text style={[
                        styles.locationOptionText,
                        useLocation === 'gps' && styles.locationOptionTextSelected
                      ]}>
                        Use My Location
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setUseLocation('search')}
                      style={[
                        styles.locationOptionButton,
                        useLocation === 'search' && styles.locationOptionButtonSelected
                      ]}
                    >
                      <Text style={[
                        styles.locationOptionText,
                        useLocation === 'search' && styles.locationOptionTextSelected
                      ]}>
                        Search for a Place
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {useLocation === 'search' && (
                    <TextInput
                      value={searchLocation}
                      onChangeText={setSearchLocation}
                      style={styles.locationSearchInput}
                      placeholder="Enter address or place name..."
                    />
                  )}
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
        
        {/* Footer - Fixed within modal */}
        <View style={styles.footer}>
          <View style={styles.footerButtons}>
            <TouchableOpacity 
              onPress={handleSave}
              style={styles.saveButton}
            >
              <Text style={styles.saveButtonText}>
                Apply Collaboration Preferences ({totalSelections})
              </Text>
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: 'white',
    borderRadius: 24,
    width: '100%',
    maxWidth: 600,
    height: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 16,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
    paddingTop: 32,
  },
  header: {
    position: 'relative',
    alignItems: 'center',
    marginBottom: 32,
    paddingHorizontal: 16,
  },
  cancelButton: {
    position: 'absolute',
    left: 16,
    top: 0,
    padding: 8,
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  sectionsContainer: {
    gap: 24,
    paddingHorizontal: 16,
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
    elevation: 2,
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
    borderColor: '#d1d5db',
    backgroundColor: 'white',
  },
  experienceTypeButtonSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#eb7825',
  },
  experienceTypeText: {
    fontSize: 14,
    color: '#374151',
  },
  experienceTypeTextSelected: {
    color: 'white',
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
  budgetInputContainer: {
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
    width: '48%',
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  categoryCardSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#fef3f2',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  categoryTitleSelected: {
    color: '#d97706',
  },
  categoryDescription: {
    fontSize: 14,
    color: '#d97706',
  },
  dateOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  dateOptionButton: {
    flex: 1,
    minWidth: '45%',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateOptionButtonSelected: {
    backgroundColor: '#eb7825',
  },
  dateOptionText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  dateOptionTextSelected: {
    color: 'white',
  },
  weekendInfo: {
    padding: 16,
    backgroundColor: '#fef3f2',
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
    color: '#d97706',
  },
  weekendInfoText: {
    fontSize: 14,
    color: '#d97706',
  },
  dateInputContainer: {
    position: 'relative',
  },
  dateInputIcon: {
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
  timeSection: {
    gap: 16,
  },
  timeOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  timeOptionButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '30%',
  },
  timeOptionButtonSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#fef3f2',
  },
  timeOptionText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  timeOptionTextSelected: {
    color: '#d97706',
  },
  timeInputContainer: {
    position: 'relative',
  },
  timeInputIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: [{ translateY: -10 }],
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
    fontSize: 12,
    color: '#6b7280',
    backgroundColor: '#dbeafe',
    padding: 8,
    borderRadius: 8,
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
    backgroundColor: 'transparent',
  },
  travelModeButtonSelected: {
    backgroundColor: '#fef3f2',
  },
  travelModeRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#d1d5db',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  travelModeRadioSelected: {
    borderColor: '#eb7825',
    backgroundColor: '#eb7825',
  },
  travelModeRadioInner: {
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
    fontSize: 16,
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
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  constraintTypeButtonSelected: {
    backgroundColor: '#eb7825',
  },
  constraintTypeText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  constraintTypeTextSelected: {
    color: 'white',
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
  locationSection: {
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
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationOptionButtonSelected: {
    backgroundColor: '#eb7825',
  },
  locationOptionText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  locationOptionTextSelected: {
    color: 'white',
  },
  locationSearchInput: {
    width: '100%',
    padding: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    fontSize: 16,
    backgroundColor: 'white',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    padding: 16,
    backgroundColor: 'white',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#eb7825',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: 'white',
  },
  resetButton: {
    backgroundColor: '#f3f4f6',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
});