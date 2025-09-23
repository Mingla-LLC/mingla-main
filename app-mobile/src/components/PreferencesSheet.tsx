import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { categories } from '../constants/categories';
import { formatCurrency } from '../utils/currency';
import { ActivePreferences } from '../types';

interface PreferencesSheetProps {
  isOpen: boolean;
  onClose?: () => void;
  measurementSystem?: string;
  activePreferences?: ActivePreferences;
  onPreferencesUpdate?: (preferences: ActivePreferences) => void;
}

export const PreferencesSheet: React.FC<PreferencesSheetProps> = ({
  isOpen,
  onClose,
  measurementSystem = 'metric',
  activePreferences = {
    budgetRange: [25, 150] as [number, number],
    categories: ['stroll', 'sip', 'casual_eats', 'screen_relax', 'creative', 'play_move', 'dining', 'freestyle'],
    experienceTypes: ['Romantic', 'First Date'],
    time: 'tonight',
    travel: 'drive',
    travelConstraint: 'time' as const,
    travelTime: 15,
    travelDistance: 10,
    location: 'current',
    customLocation: '',
    custom_lat: null,
    custom_lng: null,
    groupSize: 2
  },
  onPreferencesUpdate
}) => {
  const [preferences, setPreferences] = useState<ActivePreferences>(activePreferences);
  const [customLocation, setCustomLocation] = useState(activePreferences?.customLocation || '');
  const [customLat, setCustomLat] = useState<number | null>(activePreferences?.custom_lat || null);
  const [customLng, setCustomLng] = useState<number | null>(activePreferences?.custom_lng || null);
  const [minBudget, setMinBudget] = useState(preferences.budgetRange[0].toString());
  const [maxBudget, setMaxBudget] = useState(preferences.budgetRange[1].toString());
  const [travelTime, setTravelTime] = useState(preferences.travelTime.toString());
  const [travelDistance, setTravelDistance] = useState(preferences.travelDistance.toString());
  const [timeUnit, setTimeUnit] = useState<'min' | 'hours'>('min');
  const [distanceUnit, setDistanceUnit] = useState<'km' | 'miles'>('km');
  

  const handleSave = () => {
    const minBudgetNum = parseFloat(minBudget) || 0;
    const maxBudgetNum = parseFloat(maxBudget) || 0;
    const travelTimeNum = parseFloat(travelTime) || 15;
    const travelDistanceNum = parseFloat(travelDistance) || 10;
    
    const updatedPreferences: ActivePreferences = {
      ...preferences,
      budgetRange: [minBudgetNum, maxBudgetNum] as [number, number],
      travelTime: travelTimeNum,
      travelDistance: travelDistanceNum,
      customLocation,
      custom_lat: customLat,
      custom_lng: customLng,
    };
    
    onPreferencesUpdate?.(updatedPreferences);
    onClose?.();
  };

  const handleMinBudgetChange = (text: string) => {
    // Only allow numbers and decimal point
    const numericText = text.replace(/[^0-9.]/g, '');
    setMinBudget(numericText);
    
    // Update preferences immediately for real-time feedback
    const minValue = parseFloat(numericText) || 0;
    const maxValue = parseFloat(maxBudget) || 0;
    setPreferences(prev => ({
      ...prev,
      budgetRange: [minValue, maxValue] as [number, number]
    }));
  };

  const handleMaxBudgetChange = (text: string) => {
    // Only allow numbers and decimal point
    const numericText = text.replace(/[^0-9.]/g, '');
    setMaxBudget(numericText);
    
    // Update preferences immediately for real-time feedback
    const minValue = parseFloat(minBudget) || 0;
    const maxValue = parseFloat(numericText) || 0;
    setPreferences(prev => ({
      ...prev,
      budgetRange: [minValue, maxValue] as [number, number]
    }));
  };

  const handleTravelTimeChange = (text: string) => {
    // Only allow numbers and decimal point
    const numericText = text.replace(/[^0-9.]/g, '');
    setTravelTime(numericText);
    
    // Convert to minutes for storage (always store in minutes)
    const timeValue = parseFloat(numericText) || 15;
    const timeInMinutes = timeUnit === 'hours' ? timeValue * 60 : timeValue;
    
    setPreferences(prev => ({
      ...prev,
      travelTime: timeInMinutes
    }));
  };

  const handleTravelDistanceChange = (text: string) => {
    // Only allow numbers and decimal point
    const numericText = text.replace(/[^0-9.]/g, '');
    setTravelDistance(numericText);
    
    // Convert to km for storage (always store in km)
    const distanceValue = parseFloat(numericText) || 10;
    const distanceInKm = distanceUnit === 'miles' ? distanceValue * 1.60934 : distanceValue;
    
    setPreferences(prev => ({
      ...prev,
      travelDistance: distanceInKm
    }));
  };

  const handleTimeUnitChange = (unit: 'min' | 'hours') => {
    setTimeUnit(unit);
    
    // Convert current value to new unit
    const currentTime = parseFloat(travelTime) || 15;
    const timeInMinutes = timeUnit === 'hours' ? currentTime * 60 : currentTime;
    const newTimeValue = unit === 'hours' ? timeInMinutes / 60 : timeInMinutes;
    
    setTravelTime(newTimeValue.toString());
    setPreferences(prev => ({
      ...prev,
      travelTime: timeInMinutes
    }));
  };

  const handleDistanceUnitChange = (unit: 'km' | 'miles') => {
    setDistanceUnit(unit);
    
    // Convert current value to new unit
    const currentDistance = parseFloat(travelDistance) || 10;
    const distanceInKm = distanceUnit === 'miles' ? currentDistance * 1.60934 : currentDistance;
    const newDistanceValue = unit === 'miles' ? distanceInKm / 1.60934 : distanceInKm;
    
    setTravelDistance(newDistanceValue.toString());
    setPreferences(prev => ({
      ...prev,
      travelDistance: distanceInKm
    }));
  };

  // Simple Slider Component
  const SimpleSlider = ({ 
    currentValue,
    onValueChange, 
    min = 0, 
    max = 1, 
    step = 0.01,
    width = 280 
  }: {
    currentValue: number;
    onValueChange: (newValue: number) => void;
    min?: number;
    max?: number;
    step?: number;
    width?: number;
  }) => {
    // Convert current value to percentage (0-1)
    const normalizedValue = (currentValue - min) / (max - min);
    const percentage = Math.max(0, Math.min(100, normalizedValue * 100));
    
    const handleTouch = (evt: any) => {
      const touchX = evt.nativeEvent.locationX;
      const newNormalizedValue = Math.max(0, Math.min(1, touchX / width));
      const newValue = min + (newNormalizedValue * (max - min));
      const steppedValue = Math.round(newValue / step) * step;
      onValueChange(steppedValue);
    };

    return (
      <View style={[styles.sliderTrack, { width }]}>
        <View 
          style={[
            styles.sliderFill, 
            { width: `${percentage}%` }
          ]} 
        />
        <TouchableOpacity
          style={[
            styles.sliderThumb,
            { left: `${percentage}%` }
          ]}
          onPress={handleTouch}
          activeOpacity={0.8}
        />
        <TouchableOpacity
          style={[styles.sliderTrack, { width, position: 'absolute', backgroundColor: 'transparent' }]}
          onPress={handleTouch}
          activeOpacity={1}
        />
      </View>
    );
  };

  const handleTimeSliderChange = (newValue: number) => {
    // newValue is already in the correct unit (minutes or hours)
    setTravelTime(newValue.toString());
    setPreferences(prev => ({
      ...prev,
      travelTime: timeUnit === 'hours' ? newValue * 60 : newValue
    }));
  };

  const handleDistanceSliderChange = (newValue: number) => {
    // newValue is already in the correct unit (km or miles)
    setTravelDistance(newValue.toString());
    setPreferences(prev => ({
      ...prev,
      travelDistance: distanceUnit === 'miles' ? newValue * 1.60934 : newValue
    }));
  };

  const toggleCategory = (categoryId: string) => {
    setPreferences(prev => ({
      ...prev,
      categories: prev.categories.includes(categoryId)
        ? prev.categories.filter(c => c !== categoryId)
        : [...prev.categories, categoryId]
    }));
  };

  const toggleExperienceType = (type: string) => {
    setPreferences(prev => ({
      ...prev,
      experienceTypes: prev.experienceTypes?.includes(type)
        ? prev.experienceTypes.filter(t => t !== type)
        : [...(prev.experienceTypes || []), type]
    }));
  };


  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      onRequestClose={onClose || (() => {})}
      transparent={true}
    >
      <View style={styles.modalOverlay}>
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Preferences</Text>
            <TouchableOpacity onPress={onClose || (() => {})} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Group Size */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Ionicons name="people" size={20} color="#007AFF" />
              <Text style={styles.sectionTitle}>Group Size</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Specify how many people will be in your group to get suitable recommendations
            </Text>
            
            <View style={styles.groupSizeContainer}>
              <Text style={styles.groupSizeLabel}>Number of People</Text>
              <View style={styles.groupSizeControls}>
                <TouchableOpacity
                  style={styles.groupSizeButton}
                  onPress={() => setPreferences(prev => ({ ...prev, groupSize: Math.max(1, prev.groupSize - 1) }))}
                >
                  <Text style={styles.groupSizeButtonText}>-</Text>
                </TouchableOpacity>
                <Text style={styles.groupSizeValue}>{preferences.groupSize}</Text>
                <TouchableOpacity
                  style={styles.groupSizeButton}
                  onPress={() => setPreferences(prev => ({ ...prev, groupSize: prev.groupSize + 1 }))}
                >
                  <Text style={styles.groupSizeButtonText}>+</Text>
                </TouchableOpacity>
                <Text style={styles.groupSizeUnit}>
                  {preferences.groupSize === 1 ? 'person' : 'people'}
                </Text>
              </View>
            </View>
          </View>

          {/* Experience Type */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Experience Type</Text>
            <View style={styles.badgeContainer}>
              {['First Date', 'Romantic', 'Friendly', 'Solo Adventure', 'Group Fun', 'Business'].map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.badge,
                    preferences.experienceTypes?.includes(type) ? styles.badgeActive : styles.badgeInactive,
                  ]}
                  onPress={() => toggleExperienceType(type)}
                >
                  <Text style={[
                    styles.badgeText,
                    preferences.experienceTypes?.includes(type) ? styles.badgeTextActive : styles.badgeTextInactive,
                  ]}>
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Budget Range */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Budget (per person)</Text>
            <View style={styles.budgetContainer}>
              <View style={styles.budgetInput}>
                <Text style={styles.budgetLabel}>Min</Text>
                <View style={styles.budgetInputContainer}>
                  <Text style={styles.currencySymbol}>$</Text>
                  <TextInput
                    style={styles.budgetTextInput}
                    value={minBudget}
                    onChangeText={handleMinBudgetChange}
                    placeholder="0"
                    keyboardType="numeric"
                    returnKeyType="next"
                    selectTextOnFocus
                  />
                </View>
              </View>
              <View style={styles.budgetInput}>
                <Text style={styles.budgetLabel}>Max</Text>
                <View style={styles.budgetInputContainer}>
                  <Text style={styles.currencySymbol}>$</Text>
                  <TextInput
                    style={styles.budgetTextInput}
                    value={maxBudget}
                    onChangeText={handleMaxBudgetChange}
                    placeholder="0"
                    keyboardType="numeric"
                    returnKeyType="done"
                    selectTextOnFocus
                  />
                </View>
              </View>
            </View>
          </View>

          {/* Categories */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Categories</Text>
            <View style={styles.badgeContainer}>
              {categories.map((category) => (
                <TouchableOpacity
                  key={category.slug}
                  style={[
                    styles.badge,
                    preferences.categories.includes(category.slug) ? styles.badgeActive : styles.badgeInactive,
                  ]}
                  onPress={() => toggleCategory(category.slug)}
                >
                  <Text style={styles.badgeIcon}>{category.icon}</Text>
                  <Text style={[
                    styles.badgeText,
                    preferences.categories.includes(category.slug) ? styles.badgeTextActive : styles.badgeTextInactive,
                  ]}>
                    {category.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Travel Mode */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Travel Mode</Text>
            <View style={styles.buttonGrid}>
              {[
                { key: 'walk', label: 'Walk', icon: 'walk' },
                { key: 'drive', label: 'Drive', icon: 'car' },
                { key: 'transit', label: 'Public Transport', icon: 'bus' },
              ].map((mode) => (
                <TouchableOpacity
                  key={mode.key}
                  style={[
                    styles.optionButton,
                    preferences.travel === mode.key ? styles.optionButtonActive : styles.optionButtonInactive,
                  ]}
                  onPress={() => setPreferences(prev => ({ ...prev, travel: mode.key }))}
                >
                  <Text style={[
                    styles.optionButtonText,
                    preferences.travel === mode.key ? styles.optionButtonTextActive : styles.optionButtonTextInactive,
                  ]}>
                    {mode.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Travel Constraint */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Travel Constraint</Text>
            <View style={styles.buttonGrid}>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  preferences.travelConstraint === 'time' ? styles.optionButtonActive : styles.optionButtonInactive,
                ]}
                onPress={() => setPreferences(prev => ({ ...prev, travelConstraint: 'time' }))}
              >
                <Text style={[
                  styles.optionButtonText,
                  preferences.travelConstraint === 'time' ? styles.optionButtonTextActive : styles.optionButtonTextInactive,
                ]}>
                  By Time
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.optionButton,
                  preferences.travelConstraint === 'distance' ? styles.optionButtonActive : styles.optionButtonInactive,
                ]}
                onPress={() => setPreferences(prev => ({ ...prev, travelConstraint: 'distance' }))}
              >
                <Text style={[
                  styles.optionButtonText,
                  preferences.travelConstraint === 'distance' ? styles.optionButtonTextActive : styles.optionButtonTextInactive,
                ]}>
                  By Distance
                </Text>
              </TouchableOpacity>
            </View>
            
            {preferences.travelConstraint === 'time' && (
              <View style={styles.constraintCard}>
                <Text style={styles.constraintLabel}>
                  Maximum Travel Time: {travelTime} {timeUnit}
                </Text>
                <View style={styles.sliderContainer}>
                  <SimpleSlider
                    currentValue={parseFloat(travelTime)}
                    onValueChange={handleTimeSliderChange}
                    min={timeUnit === 'min' ? 5 : 0.08}
                    max={timeUnit === 'min' ? 300 : 5}
                    step={timeUnit === 'min' ? 5 : 0.08}
                    width={280}
                  />
                  <View style={styles.sliderLabels}>
                    <Text style={styles.sliderLabel}>{timeUnit === 'min' ? '5 min' : '0.08 hrs'}</Text>
                    <Text style={styles.sliderLabel}>{timeUnit === 'min' ? '300 min' : '5 hrs'}</Text>
                  </View>
                </View>
                <View style={styles.unitSelector}>
                  <TouchableOpacity
                    style={[
                      styles.unitButton,
                      timeUnit === 'min' && styles.unitButtonActive,
                    ]}
                    onPress={() => handleTimeUnitChange('min')}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      timeUnit === 'min' && styles.unitButtonTextActive,
                    ]}>
                      min
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.unitButton,
                      timeUnit === 'hours' && styles.unitButtonActive,
                    ]}
                    onPress={() => handleTimeUnitChange('hours')}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      timeUnit === 'hours' && styles.unitButtonTextActive,
                    ]}>
                      hrs
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            
            {preferences.travelConstraint === 'distance' && (
              <View style={styles.constraintCard}>
                <Text style={styles.constraintLabel}>
                  Maximum Distance: {travelDistance} {distanceUnit}
                </Text>
                <View style={styles.sliderContainer}>
                  <SimpleSlider
                    currentValue={parseFloat(travelDistance)}
                    onValueChange={handleDistanceSliderChange}
                    min={distanceUnit === 'km' ? 1 : 0.6}
                    max={distanceUnit === 'km' ? 50 : 31}
                    step={distanceUnit === 'km' ? 1 : 0.6}
                    width={280}
                  />
                  <View style={styles.sliderLabels}>
                    <Text style={styles.sliderLabel}>{distanceUnit === 'km' ? '1 km' : '0.6 mi'}</Text>
                    <Text style={styles.sliderLabel}>{distanceUnit === 'km' ? '50 km' : '31 mi'}</Text>
                  </View>
                </View>
                <View style={styles.unitSelector}>
                  <TouchableOpacity
                    style={[
                      styles.unitButton,
                      distanceUnit === 'km' && styles.unitButtonActive,
                    ]}
                    onPress={() => handleDistanceUnitChange('km')}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      distanceUnit === 'km' && styles.unitButtonTextActive,
                    ]}>
                      km
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.unitButton,
                      distanceUnit === 'miles' && styles.unitButtonActive,
                    ]}
                    onPress={() => handleDistanceUnitChange('miles')}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      distanceUnit === 'miles' && styles.unitButtonTextActive,
                    ]}>
                      mi
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.applyButton}
            onPress={handleSave}
          >
            <Text style={styles.applyButtonText}>
              Apply Preferences
            </Text>
          </TouchableOpacity>
        </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  section: {
    marginTop: 24,
  },
  sectionCard: {
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 16,
    lineHeight: 20,
  },
  budgetContainer: {
    flexDirection: 'row',
    gap: 16,
  },
  budgetInput: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  budgetLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  budgetInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: '#e1e5e9',
    borderRadius: 8,
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  budgetTextInput: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
    textAlign: 'center',
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  currencySymbol: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginRight: 8,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  categoryButton: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    minWidth: 100,
  },
  categoryButtonActive: {
    backgroundColor: '#007AFF',
  },
  categoryIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  categoryName: {
    fontSize: 12,
    fontWeight: '500',
    color: '#666',
    textAlign: 'center',
  },
  categoryNameActive: {
    color: 'white',
  },
  travelModeContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  travelModeButton: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  travelModeButtonActive: {
    backgroundColor: '#007AFF',
  },
  travelModeText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  travelModeTextActive: {
    color: 'white',
  },
  constraintContainer: {
    gap: 12,
  },
  constraintButton: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  constraintButtonActive: {
    backgroundColor: '#007AFF',
  },
  constraintInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  constraintTextInput: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    textAlign: 'center',
    minWidth: 50,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e1e5e9',
    borderRadius: 6,
    backgroundColor: '#f8f9fa',
  },
  constraintTextInputActive: {
    color: 'white',
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  unitSelector: {
    flexDirection: 'row',
    gap: 4,
  },
  unitButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e1e5e9',
    backgroundColor: '#f8f9fa',
  },
  unitButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  unitButtonActiveState: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  unitButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#666',
  },
  unitButtonTextActive: {
    color: 'white',
  },
  unitButtonTextActiveState: {
    color: 'white',
  },
  privacyContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    gap: 16,
  },
  privacyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  privacyLabel: {
    fontSize: 16,
    color: '#1a1a1a',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#e1e5e9',
    backgroundColor: 'white',
  },
  // Group Size Styles
  groupSizeContainer: {
    marginTop: 12,
  },
  groupSizeLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  groupSizeControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  groupSizeButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupSizeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  groupSizeValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
    minWidth: 32,
    textAlign: 'center',
  },
  groupSizeUnit: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 8,
  },

  // Badge Styles
  badgeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  badgeActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  badgeInactive: {
    backgroundColor: 'transparent',
    borderColor: '#e5e7eb',
  },
  badgeIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  badgeTextActive: {
    color: 'white',
  },
  badgeTextInactive: {
    color: '#6b7280',
  },

  // Button Grid Styles
  buttonGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  optionButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  optionButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  optionButtonInactive: {
    backgroundColor: 'transparent',
    borderColor: '#e5e7eb',
  },
  optionButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  optionButtonTextActive: {
    color: 'white',
  },
  optionButtonTextInactive: {
    color: '#6b7280',
  },

  // Constraint Card Styles
  constraintCard: {
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  constraintLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 12,
  },

  // Slider Styles
  sliderContainer: {
    marginBottom: 12,
  },
  sliderTrack: {
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 2,
    position: 'relative',
  },
  sliderFill: {
    height: 4,
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  sliderThumb: {
    position: 'absolute',
    top: -6,
    width: 16,
    height: 16,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    marginLeft: -8,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sliderLabel: {
    fontSize: 12,
    color: '#6b7280',
  },

  // Apply Button Styles
  applyButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  applyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
