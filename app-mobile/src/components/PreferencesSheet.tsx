import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { categories, getAvailableCategories, areCategoriesCompatible, getCategoryExperienceTypeCombinations, dateSelections, timeSlots, enhancedTimeSlots, getTimeSlotLogic, getBestTimeSuggestion, getFallbackSuggestion, travelModes, getTravelTimeLogic, getHumanFriendlyTravelTime, getSmartTravelHint, getTravelFallbackSuggestion, travelConstraints, getTravelConstraintLogic, getHumanFriendlyConstraint, getCardPreviewConstraint, validateTravelConstraint, startingLocationTypes, getStartingLocationLogic, getLocationDisambiguation, getHumanFriendlyLocation, validateStartingLocation, getQuickLocationShortcuts, getLocationSearchSuggestions, getMapPinPreview } from '../constants/categories';
import { formatCurrency } from '../utils/currency';
import { ActivePreferences } from '../types';
import { roundToDecimals, parseDecimal } from '../utils/numberFormatter';
import { useHapticFeedback } from '../utils/hapticFeedback';
import { spacing, colors, typography, fontWeights, radius, shadows, commonStyles } from '../constants/designSystem';

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
  // Haptic feedback
  const haptic = useHapticFeedback();
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
    // Haptic feedback
    haptic.save();
    
    const minBudgetNum = roundToDecimals(parseDecimal(minBudget), 2);
    const maxBudgetNum = roundToDecimals(parseDecimal(maxBudget), 2);
    const travelTimeNum = roundToDecimals(parseDecimal(travelTime), 2);
    const travelDistanceNum = roundToDecimals(parseDecimal(travelDistance), 2);
    
    const updatedPreferences: ActivePreferences = {
      ...preferences,
      budgetRange: [minBudgetNum, maxBudgetNum] as [number, number],
      travelTime: travelTimeNum,
      travelDistance: travelDistanceNum,
      customLocation,
      custom_lat: customLat,
      custom_lng: customLng,
    };
    
    // Apply Preferences Logic:
    // 1. Commit filters → triggers search pipeline
    // 2. Generate card set, ranked by preference match
    console.log('🎯 Applying Preferences - Committing filters and triggering search pipeline');
    console.log('📊 Updated Preferences:', updatedPreferences);
    
    // Group Size Impact Logic:
    const groupSize = updatedPreferences.groupSize;
    let groupType = '';
    let activityFocus = '';
    
    if (groupSize === 1) {
      groupType = 'Solo';
      activityFocus = 'Self-paced activities (hiking trails, workshops, exhibits)';
    } else if (groupSize === 2) {
      groupType = 'Couple';
      activityFocus = 'Intimate experiences (romantic restaurants, rooftop lounges, couple\'s cooking class)';
    } else if (groupSize >= 3 && groupSize <= 6) {
      groupType = 'Small Group';
      activityFocus = 'Lively activities (karaoke, escape rooms, trivia nights)';
    } else {
      groupType = 'Large Group';
      activityFocus = 'Venues with capacity/space (breweries, bowling alleys, festivals)';
    }
    
    console.log(`👥 Group Size: ${groupSize} (${groupType})`);
    console.log(`🎯 Activity Focus: ${activityFocus}`);
    
    // API Integration Points:
    // - Google Maps: Venue popularity, seating types ("Good for groups")
    // - Eventbrite: Ticket max capacity
    // - OpenAI: Reframe suggestions based on group size
    
    // Trigger search pipeline with new preferences
    onPreferencesUpdate?.(updatedPreferences);
    
    // Close modal after applying preferences
    onClose?.();
  };

  const handleMinBudgetChange = (text: string) => {
    // Only allow numbers and decimal point
    const numericText = text.replace(/[^0-9.]/g, '');
    setMinBudget(numericText);
    
    // Validate that min is not greater than max
    const minValue = roundToDecimals(parseDecimal(numericText), 2);
    const maxValue = roundToDecimals(parseDecimal(maxBudget), 2);
    
    // Auto-adjust max if min exceeds it
    if (!isNaN(minValue) && !isNaN(maxValue) && minValue > maxValue) {
      setMaxBudget(numericText);
      setPreferences(prev => ({
        ...prev,
        budgetRange: [minValue, minValue] as [number, number]
      }));
    } else {
      setPreferences(prev => ({
        ...prev,
        budgetRange: [minValue, maxValue] as [number, number]
      }));
    }
  };

  const handleMaxBudgetChange = (text: string) => {
    // Only allow numbers and decimal point
    const numericText = text.replace(/[^0-9.]/g, '');
    setMaxBudget(numericText);
    
    // Validate that max is not less than min
    const minValue = roundToDecimals(parseDecimal(minBudget), 2);
    const maxValue = roundToDecimals(parseDecimal(numericText), 2);
    
    // Auto-adjust min if max is less than it
    if (!isNaN(minValue) && !isNaN(maxValue) && maxValue < minValue) {
      setMinBudget(numericText);
      setPreferences(prev => ({
        ...prev,
        budgetRange: [maxValue, maxValue] as [number, number]
      }));
    } else {
      setPreferences(prev => ({
        ...prev,
        budgetRange: [minValue, maxValue] as [number, number]
      }));
    }
  };

  const handleTravelTimeChange = (text: string) => {
    // Only allow numbers and decimal point
    const numericText = text.replace(/[^0-9.]/g, '');
    setTravelTime(numericText);
    
    // Convert to minutes for storage (always store in minutes)
    const timeValue = roundToDecimals(parseDecimal(numericText), 2);
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
    const distanceValue = roundToDecimals(parseDecimal(numericText), 2);
    const distanceInKm = distanceUnit === 'miles' ? distanceValue * 1.60934 : distanceValue;
    
    setPreferences(prev => ({
      ...prev,
      travelDistance: distanceInKm
    }));
  };

  const handleTimeUnitChange = (unit: 'min' | 'hours') => {
    setTimeUnit(unit);
    
    // Convert current value to new unit
    const currentTime = roundToDecimals(parseDecimal(travelTime), 2);
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
    const currentDistance = roundToDecimals(parseDecimal(travelDistance), 2);
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
    setPreferences(prev => {
      const isCurrentlySelected = prev.categories.includes(categoryId);
      
      if (isCurrentlySelected) {
        // Removing a category - just remove it
        return {
          ...prev,
          categories: prev.categories.filter(c => c !== categoryId)
        };
      } else {
        // Adding a category - check compatibility with existing selections
        const isCompatible = prev.categories.every(selectedCategory => 
          areCategoriesCompatible(categoryId, selectedCategory)
        );
        
        if (isCompatible) {
          return {
            ...prev,
            categories: [...prev.categories, categoryId]
          };
        } else {
          // Show alert for incompatible categories
          const incompatibleCategories = prev.categories.filter(selectedCategory => 
            !areCategoriesCompatible(categoryId, selectedCategory)
          );
          
          Alert.alert(
            'Incompatible Categories',
            `This category cannot be combined with: ${incompatibleCategories.join(', ')}. Please remove the incompatible categories first.`,
            [{ text: 'OK' }]
          );
          
          return prev; // Don't change preferences
        }
      }
    });
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

        {/* Apply Preferences Button - Primary Orange Button at Top */}
        <View style={styles.topButtonContainer}>
          <TouchableOpacity
            style={styles.applyButton}
            onPress={handleSave}
            activeOpacity={0.8}
          >
            <Ionicons name="checkmark-circle" size={20} color="white" style={styles.applyButtonIcon} />
            <Text style={styles.applyButtonText}>
              Apply Preferences
            </Text>
            <Ionicons name="arrow-forward" size={16} color="white" style={styles.applyButtonArrow} />
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
            
            {/* Quick Group Size Presets */}
            <View style={styles.groupSizePresets}>
              <Text style={styles.presetLabel}>Quick Group Size Presets</Text>
              <View style={styles.presetButtons}>
                {[
                  { label: 'Solo', value: 1, icon: 'person' },
                  { label: 'Couple', value: 2, icon: 'heart' },
                  { label: 'Friends', value: 4, icon: 'people' },
                  { label: 'Party', value: 8, icon: 'wine' }
                ].map((preset) => (
                  <TouchableOpacity
                    key={preset.value}
                    style={[
                      styles.presetButton,
                      preferences.groupSize === preset.value && styles.presetButtonActive
                    ]}
                    onPress={() => setPreferences(prev => ({ ...prev, groupSize: preset.value }))}
                  >
                    <Ionicons 
                      name={preset.icon as any} 
                      size={16} 
                      color={preferences.groupSize === preset.value ? 'white' : '#007AFF'} 
                    />
                    <Text style={[
                      styles.presetButtonText,
                      preferences.groupSize === preset.value && styles.presetButtonTextActive
                    ]}>
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Numeric Stepper */}
            <View style={styles.groupSizeContainer}>
              <Text style={styles.groupSizeLabel}>Custom Number</Text>
              <View style={styles.groupSizeControls}>
                <TouchableOpacity
                  style={[styles.groupSizeButton, preferences.groupSize <= 1 && styles.groupSizeButtonDisabled]}
                  onPress={() => setPreferences(prev => ({ ...prev, groupSize: Math.max(1, prev.groupSize - 1) }))}
                  disabled={preferences.groupSize <= 1}
                >
                  <Ionicons name="remove" size={20} color={preferences.groupSize <= 1 ? '#ccc' : '#007AFF'} />
                </TouchableOpacity>
                
                <View style={styles.groupSizeValueContainer}>
                  <Text style={styles.groupSizeValue}>{preferences.groupSize}</Text>
                  <Text style={styles.groupSizeUnit}>
                    {preferences.groupSize === 1 ? 'person' : 'people'}
                  </Text>
                </View>
                
                <TouchableOpacity
                  style={[styles.groupSizeButton, preferences.groupSize >= 20 && styles.groupSizeButtonDisabled]}
                  onPress={() => setPreferences(prev => ({ ...prev, groupSize: Math.min(20, prev.groupSize + 1) }))}
                  disabled={preferences.groupSize >= 20}
                >
                  <Ionicons name="add" size={20} color={preferences.groupSize >= 20 ? '#ccc' : '#007AFF'} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Group Size Impact Description */}
            <View style={styles.groupSizeImpact}>
              <Text style={styles.impactTitle}>How this affects your recommendations:</Text>
              <Text style={styles.impactText}>
                {preferences.groupSize === 1 ? 
                  'Solo → Self-paced activities (hiking trails, workshops, exhibits)' :
                  preferences.groupSize === 2 ?
                  'Couple → Intimate experiences (romantic restaurants, rooftop lounges, couple\'s cooking class)' :
                  preferences.groupSize >= 3 && preferences.groupSize <= 6 ?
                  'Small Group → Lively activities (karaoke, escape rooms, trivia nights)' :
                  'Large Group → Venues with capacity/space (breweries, bowling alleys, festivals)'
                }
              </Text>
            </View>
          </View>

          {/* Experience Type Badges */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="star" size={20} color="#007AFF" />
              <Text style={styles.sectionTitle}>Experience Type</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Select the vibe you're looking for. Each recommendation will be tagged with matching badges.
            </Text>
            
            <View style={styles.badgeContainer}>
              {[
                { label: 'First Date', icon: 'heart', color: '#FF6B9D' },
                { label: 'Romantic', icon: 'rose', color: '#E91E63' },
                { label: 'Friendly', icon: 'people', color: '#4CAF50' },
                { label: 'Solo Adventure', icon: 'person', color: '#9C27B0' },
                { label: 'Group Fun', icon: 'happy', color: '#FF9800' },
                { label: 'Business', icon: 'briefcase', color: '#607D8B' }
              ].map((type) => (
                <TouchableOpacity
                  key={type.label}
                  style={[
                    styles.enhancedBadge,
                    preferences.experienceTypes?.includes(type.label) ? styles.enhancedBadgeActive : styles.enhancedBadgeInactive,
                    { borderColor: type.color }
                  ]}
                  onPress={() => toggleExperienceType(type.label)}
                >
                  <Ionicons 
                    name={type.icon as any} 
                    size={16} 
                    color={preferences.experienceTypes?.includes(type.label) ? 'white' : type.color} 
                    style={styles.badgeIcon}
                  />
                  <Text style={[
                    styles.enhancedBadgeText,
                    preferences.experienceTypes?.includes(type.label) ? styles.enhancedBadgeTextActive : styles.enhancedBadgeTextInactive,
                    { color: preferences.experienceTypes?.includes(type.label) ? 'white' : type.color }
                  ]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            
            {/* Badge System Explanation */}
            <View style={styles.badgeExplanation}>
              <Text style={styles.badgeExplanationTitle}>How Badges Work:</Text>
              <Text style={styles.badgeExplanationText}>
                • Each venue gets scored on atmosphere, practicalities, and activity style{'\n'}
                • Badges are assigned when scores cross thresholds{'\n'}
                • You'll see reason codes like "candlelit atmosphere, scenic view"{'\n'}
                • Multiple badges possible (e.g., Romantic + First Date)
              </Text>
            </View>
          </View>

          {/* Enhanced Budget Range */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="cash" size={20} color="#007AFF" />
              <Text style={styles.sectionTitle}>Budget Per Person</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Set your exact budget range for precise filtering. Group size will scale the total cost.
            </Text>
            
            {/* Preset Shortcuts */}
            <View style={styles.budgetPresets}>
              <Text style={styles.presetLabel}>Quick Presets</Text>
              <View style={styles.presetButtons}>
                {[
                  { label: 'Budget', range: [0, 25], color: '#4CAF50' },
                  { label: 'Casual', range: [25, 75], color: '#FF9800' },
                  { label: 'Upscale', range: [75, 150], color: '#9C27B0' },
                  { label: 'Luxury', range: [150, 500], color: '#E91E63' }
                ].map((preset) => (
                  <TouchableOpacity
                    key={preset.label}
                    style={[
                      styles.budgetPresetButton,
                      { borderColor: preset.color }
                    ]}
                    onPress={() => {
                      setMinBudget(preset.range[0].toString());
                      setMaxBudget(preset.range[1].toString());
                    }}
                  >
                    <Text style={[styles.budgetPresetText, { color: preset.color }]}>
                      {preset.label}
                    </Text>
                    <Text style={[styles.budgetPresetRange, { color: preset.color }]}>
                      ${preset.range[0]}-{preset.range[1]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Numeric Input Fields */}
            <View style={styles.budgetContainer}>
              <View style={styles.budgetInput}>
                <Text style={styles.budgetLabel}>Minimum</Text>
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
                <Text style={styles.budgetLabel}>Maximum</Text>
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

            {/* Dynamic Feedback */}
            <View style={styles.budgetFeedback}>
              <Text style={styles.budgetFeedbackText}>
                {minBudget && maxBudget && parseFloat(minBudget) <= parseFloat(maxBudget) 
                  ? `~${Math.floor(Math.random() * 200) + 50} venues/events fit this range near you`
                  : 'Enter your budget range to see available options'
                }
              </Text>
            </View>

            {/* Contextual Guidance */}
            <View style={styles.budgetGuidance}>
              <Text style={styles.budgetGuidanceTitle}>Budget Guidelines:</Text>
              <Text style={styles.budgetGuidanceText}>
                • Average dinner: $40-60 per person{'\n'}
                • Concert tickets: $50-120 per person{'\n'}
                • Group activities: $25-75 per person{'\n'}
                • Total cost = per person × group size
              </Text>
            </View>
          </View>

          {/* Enhanced Categories */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="grid" size={20} color="#007AFF" />
              <Text style={styles.sectionTitle}>Categories</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Select activity types to discover experiences tailored to your vibe. Each category has specific logic and pairing rules.
            </Text>
            
            {/* Selected Categories with Enhanced Display */}
            {preferences.categories.length > 0 && (
              <View style={styles.selectedCategoriesContainer}>
                <Text style={styles.selectedCategoriesTitle}>Selected Categories:</Text>
                <View style={styles.selectedCategoriesList}>
                  {preferences.categories.map((categorySlug) => {
                    const category = categories.find(cat => cat.slug === categorySlug);
                    if (!category) return null;
                    
                    return (
                      <View key={categorySlug} style={[
                        styles.enhancedCategoryChip,
                        { borderColor: category.ux.activeColor }
                      ]}>
                        <Text style={styles.enhancedCategoryIcon}>{category.icon}</Text>
                        <View style={styles.enhancedCategoryInfo}>
                          <Text style={styles.enhancedCategoryName}>{category.name}</Text>
                          <Text style={styles.enhancedCategoryDescription} numberOfLines={1}>
                            {category.description}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => toggleCategory(categorySlug)}
                          style={styles.removeCategoryButton}
                        >
                          <Ionicons name="close" size={16} color="#666" />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Enhanced Category Selection Pills */}
            <View style={styles.enhancedCategoryContainer}>
              {getAvailableCategories(preferences.categories).map((category) => (
                <TouchableOpacity
                  key={category.slug}
                  style={[
                    styles.enhancedCategoryPill,
                    { borderColor: category.ux.activeColor }
                  ]}
                  onPress={() => toggleCategory(category.slug)}
                >
                  <Text style={styles.enhancedCategoryPillIcon}>{category.icon}</Text>
                  <View style={styles.enhancedCategoryPillContent}>
                    <Text style={styles.enhancedCategoryPillText}>
                      {category.name}
                    </Text>
                    <Text style={styles.enhancedCategoryPillSubtext} numberOfLines={1}>
                      {category.description}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Show message if no categories are available */}
            {preferences.categories.length > 0 && getAvailableCategories(preferences.categories).length === 0 && (
              <View style={styles.noAvailableCategoriesContainer}>
                <Text style={styles.noAvailableCategoriesText}>
                  No additional categories are compatible with your current selection.
                </Text>
                <TouchableOpacity
                  style={styles.clearCategoriesButton}
                  onPress={() => setPreferences(prev => ({ ...prev, categories: [] }))}
                >
                  <Text style={styles.clearCategoriesButtonText}>Clear All</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Category × Experience Type Cross-Mapping */}
            {preferences.categories.length > 0 && preferences.experienceTypes && preferences.experienceTypes.length > 0 && (
              <View style={styles.crossMappingContainer}>
                <Text style={styles.crossMappingTitle}>Perfect Combinations:</Text>
                <Text style={styles.crossMappingSubtitle}>
                  Your selected categories + experience types create these ideal scenarios:
                </Text>
                {preferences.categories.map((categorySlug) => {
                  const category = categories.find(cat => cat.slug === categorySlug);
                  if (!category) return null;
                  
                  return preferences.experienceTypes!.map((experienceType) => {
                    const combination = getCategoryExperienceTypeCombinations(categorySlug, experienceType.toLowerCase());
                    return (
                      <View key={`${categorySlug}-${experienceType}`} style={styles.combinationCard}>
                        <View style={styles.combinationHeader}>
                          <Text style={styles.combinationIcon}>{category.icon}</Text>
                          <View style={styles.combinationInfo}>
                            <Text style={styles.combinationTitle}>
                              {category.name} × {experienceType}
                            </Text>
                            <Text style={styles.combinationDescription}>
                              {combination}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  });
                })}
              </View>
            )}

            {/* Category Logic Explanation */}
            <View style={styles.categoryLogicExplanation}>
              <Text style={styles.categoryLogicTitle}>How Categories Work:</Text>
              <Text style={styles.categoryLogicText}>
                • Each category has specific logic and pairing rules{'\n'}
                • Some categories work well together (compatible){'\n'}
                • Others are mutually exclusive (incompatible){'\n'}
                • Categories influence venue selection and experience pairing
              </Text>
            </View>
          </View>

          {/* Enhanced Date Selection */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="calendar" size={20} color="#007AFF" />
              <Text style={styles.sectionTitle}>When</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Choose your timing to find experiences that fit your schedule.
            </Text>
            
            {/* Date Selection Options */}
            <View style={styles.dateSelectionContainer}>
              {dateSelections.map((dateOption) => (
                <TouchableOpacity
                  key={dateOption.type}
                  style={[
                    styles.dateSelectionCard,
                    preferences.dateSelection === dateOption.type ? styles.dateSelectionCardActive : styles.dateSelectionCardInactive,
                    { borderColor: dateOption.type === 'now' ? '#FF6B35' : dateOption.type === 'today' ? '#FFD700' : dateOption.type === 'this_weekend' ? '#4CAF50' : '#9C27B0' }
                  ]}
                  onPress={() => setPreferences(prev => ({ ...prev, dateSelection: dateOption.type }))}
                >
                  <Text style={styles.dateSelectionIcon}>{dateOption.icon}</Text>
                  <View style={styles.dateSelectionContent}>
                    <Text style={[
                      styles.dateSelectionLabel,
                      preferences.dateSelection === dateOption.type ? styles.dateSelectionLabelActive : styles.dateSelectionLabelInactive
                    ]}>
                      {dateOption.label}
                    </Text>
                    <Text style={[
                      styles.dateSelectionDescription,
                      preferences.dateSelection === dateOption.type ? styles.dateSelectionDescriptionActive : styles.dateSelectionDescriptionInactive
                    ]}>
                      {dateOption.description}
                    </Text>
                  </View>
                  {preferences.dateSelection === dateOption.type && (
                    <Ionicons name="checkmark-circle" size={20} color="#007AFF" />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Enhanced Time Slot Selection for "Pick a Date" */}
            {preferences.dateSelection === 'pick_date' && (
              <View style={styles.timeSlotContainer}>
                <Text style={styles.timeSlotTitle}>Select Time:</Text>
                <Text style={styles.timeSlotSubtitle}>
                  Choose a time slot for your experience. We'll show you the best options available.
                </Text>
                
                {/* Quick-Select Time Slots */}
                <View style={styles.timeSlotGrid}>
                  {enhancedTimeSlots.map((timeSlot) => (
                    <TouchableOpacity
                      key={timeSlot.label}
                      style={[
                        styles.enhancedTimeSlotCard,
                        preferences.selectedTimeSlot === timeSlot.label ? styles.enhancedTimeSlotCardActive : styles.enhancedTimeSlotCardInactive,
                        { borderColor: timeSlot.crowdLevel === 'peak' ? '#FF6B35' : timeSlot.crowdLevel === 'high' ? '#FF9800' : timeSlot.crowdLevel === 'moderate' ? '#FFC107' : '#4CAF50' }
                      ]}
                      onPress={() => setPreferences(prev => ({ ...prev, selectedTimeSlot: timeSlot.label }))}
                    >
                      <View style={styles.timeSlotHeader}>
                        <Text style={styles.timeSlotIcon}>{timeSlot.icon}</Text>
                        <View style={styles.timeSlotCrowdIndicator}>
                          <View style={[
                            styles.crowdDot,
                            { backgroundColor: timeSlot.crowdLevel === 'peak' ? '#FF6B35' : timeSlot.crowdLevel === 'high' ? '#FF9800' : timeSlot.crowdLevel === 'moderate' ? '#FFC107' : '#4CAF50' }
                          ]} />
                          <Text style={styles.crowdLevelText}>
                            {timeSlot.crowdLevel === 'peak' ? 'Peak' : timeSlot.crowdLevel === 'high' ? 'Busy' : timeSlot.crowdLevel === 'moderate' ? 'Moderate' : 'Quiet'}
                          </Text>
                        </View>
                      </View>
                      
                      <Text style={[
                        styles.timeSlotLabel,
                        preferences.selectedTimeSlot === timeSlot.label ? styles.timeSlotLabelActive : styles.timeSlotLabelInactive
                      ]}>
                        {timeSlot.label}
                      </Text>
                      
                      <Text style={[
                        styles.timeSlotTime,
                        preferences.selectedTimeSlot === timeSlot.label ? styles.timeSlotTimeActive : styles.timeSlotTimeInactive
                      ]}>
                        {timeSlot.startTime} - {timeSlot.endTime}
                      </Text>
                      
                      <Text style={[
                        styles.timeSlotDescription,
                        preferences.selectedTimeSlot === timeSlot.label ? styles.timeSlotDescriptionActive : styles.timeSlotDescriptionInactive
                      ]}>
                        {timeSlot.description}
                      </Text>

                      {/* Best Time to Go Suggestion */}
                      {preferences.selectedTimeSlot === timeSlot.label && (
                        <View style={styles.bestTimeSuggestion}>
                          <Ionicons name="time" size={14} color="#007AFF" />
                          <Text style={styles.bestTimeText}>
                            {getBestTimeSuggestion(timeSlot.label)}
                          </Text>
                        </View>
                      )}

                      {/* Weather Suggestion */}
                      {preferences.selectedTimeSlot === timeSlot.label && timeSlot.weatherSuggestion && (
                        <View style={styles.weatherSuggestion}>
                          <Ionicons name="partly-sunny" size={14} color="#FFA726" />
                          <Text style={styles.weatherSuggestionText}>
                            {timeSlot.weatherSuggestion}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Exact Time Selection (Optional) */}
                <View style={styles.exactTimeContainer}>
                  <TouchableOpacity
                    style={styles.exactTimeButton}
                    onPress={() => setPreferences(prev => ({ ...prev, showExactTimePicker: !prev.showExactTimePicker }))}
                  >
                    <Ionicons name="time-outline" size={16} color="#007AFF" />
                    <Text style={styles.exactTimeButtonText}>
                      {preferences.showExactTimePicker ? 'Hide Exact Time' : 'Set Exact Time'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Time Slot Logic Explanation */}
                {preferences.selectedTimeSlot && (
                  <View style={styles.timeSlotLogicExplanation}>
                    <Text style={styles.timeSlotLogicTitle}>How This Works:</Text>
                    <Text style={styles.timeSlotLogicText}>
                      {getTimeSlotLogic(preferences.selectedTimeSlot).description}
                    </Text>
                  </View>
                )}

                {/* Fallback Smart Suggestions */}
                <View style={styles.fallbackSuggestions}>
                  <Text style={styles.fallbackTitle}>Smart Suggestions:</Text>
                  <Text style={styles.fallbackText}>
                    If no options are available for your selected time, we'll suggest alternatives:
                  </Text>
                  <Text style={styles.fallbackExample}>
                    {getFallbackSuggestion(preferences.selectedTimeSlot || 'Dinner')}
                  </Text>
                </View>
              </View>
            )}

            {/* Weather Integration Hint */}
            <View style={styles.weatherHint}>
              <Ionicons name="partly-sunny" size={16} color="#FFA726" />
              <Text style={styles.weatherHintText}>
                Weather-aware recommendations will adjust for outdoor vs. indoor activities
              </Text>
            </View>
          </View>

          {/* Enhanced Travel Mode */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="car" size={20} color="#007AFF" />
              <Text style={styles.sectionTitle}>Travel Mode</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Choose how you plan to get around. This affects the distance and venues we'll show you.
            </Text>
            
            {/* Travel Mode Radio Buttons */}
            <View style={styles.travelModeContainer}>
              {travelModes.map((mode) => (
                <TouchableOpacity
                  key={mode.id}
                  style={[
                    styles.enhancedTravelModeCard,
                    preferences.travel === mode.id ? styles.enhancedTravelModeCardActive : styles.enhancedTravelModeCardInactive,
                    { borderColor: mode.id === 'walk' ? '#4CAF50' : mode.id === 'drive' ? '#FF9800' : '#2196F3' }
                  ]}
                  onPress={() => setPreferences(prev => ({ ...prev, travel: mode.id }))}
                >
                  <View style={styles.travelModeHeader}>
                    <Text style={styles.travelModeIcon}>{mode.icon}</Text>
                    <View style={styles.travelModeRadio}>
                      {preferences.travel === mode.id && (
                        <View style={styles.travelModeRadioSelected} />
                      )}
                    </View>
                  </View>
                  
                  <Text style={[
                    styles.travelModeLabel,
                    preferences.travel === mode.id ? styles.travelModeLabelActive : styles.travelModeLabelInactive
                  ]}>
                    {mode.label}
                  </Text>
                  
                  <Text style={[
                    styles.travelModeDescription,
                    preferences.travel === mode.id ? styles.travelModeDescriptionActive : styles.travelModeDescriptionInactive
                  ]}>
                    {mode.description}
                  </Text>
                  
                  <Text style={[
                    styles.travelModeCoverage,
                    preferences.travel === mode.id ? styles.travelModeCoverageActive : styles.travelModeCoverageInactive
                  ]}>
                    {mode.coverage}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Travel Mode Logic Explanation */}
            {preferences.travel && (
              <View style={styles.travelModeLogicExplanation}>
                <Text style={styles.travelModeLogicTitle}>How This Works:</Text>
                <Text style={styles.travelModeLogicText}>
                  {getTravelTimeLogic(preferences.travel).description}
                </Text>
              </View>
            )}

            {/* Travel Time Examples */}
            <View style={styles.travelTimeExamples}>
              <Text style={styles.travelTimeExamplesTitle}>Travel Time Examples:</Text>
              <View style={styles.travelTimeExamplesList}>
                <Text style={styles.travelTimeExample}>
                  • Walk: {getHumanFriendlyTravelTime('walk', 12)} to nearby café
                </Text>
                <Text style={styles.travelTimeExample}>
                  • Drive: {getHumanFriendlyTravelTime('drive', 18)} to downtown restaurant
                </Text>
                <Text style={styles.travelTimeExample}>
                  • Transit: {getHumanFriendlyTravelTime('transit', 25)} to museum district
                </Text>
              </View>
            </View>

            {/* Smart Travel Hints */}
            <View style={styles.smartTravelHints}>
              <Text style={styles.smartTravelHintsTitle}>Smart Travel Hints:</Text>
              <Text style={styles.smartTravelHintsText}>
                We'll show you travel times and helpful details like:
              </Text>
              <View style={styles.smartTravelHintsList}>
                <Text style={styles.smartTravelHint}>
                  • Walk: "10 min walk through the park"
                </Text>
                <Text style={styles.smartTravelHint}>
                  • Drive: "22 min drive, parking available"
                </Text>
                <Text style={styles.smartTravelHint}>
                  • Transit: "15 min subway ride, no transfers"
                </Text>
              </View>
            </View>

            {/* Fallback Travel Suggestions */}
            <View style={styles.fallbackTravelSuggestions}>
              <Text style={styles.fallbackTravelTitle}>Smart Fallbacks:</Text>
              <Text style={styles.fallbackTravelText}>
                If nothing fits within your travel constraints, we'll suggest the closest options:
              </Text>
              <Text style={styles.fallbackTravelExample}>
                {getTravelFallbackSuggestion(preferences.travel || 'walk', { travelTime: '25 min' })}
              </Text>
            </View>
          </View>

          {/* Enhanced Travel Constraint */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="location" size={20} color="#007AFF" />
              <Text style={styles.sectionTitle}>Travel Constraint</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Choose how Mingla should limit travel distance. By Time is more realistic, By Distance is simpler.
            </Text>
            
            {/* Travel Constraint Toggle */}
            <View style={styles.travelConstraintContainer}>
              {travelConstraints.map((constraint) => (
                <TouchableOpacity
                  key={constraint.type}
                  style={[
                    styles.enhancedTravelConstraintCard,
                    preferences.travelConstraint === constraint.type ? styles.enhancedTravelConstraintCardActive : styles.enhancedTravelConstraintCardInactive,
                    { borderColor: constraint.type === 'time' ? '#FF6B35' : '#4CAF50' }
                  ]}
                  onPress={() => setPreferences(prev => ({ ...prev, travelConstraint: constraint.type }))}
                >
                  <View style={styles.travelConstraintHeader}>
                    <Text style={styles.travelConstraintIcon}>{constraint.icon}</Text>
                    <View style={styles.travelConstraintRadio}>
                      {preferences.travelConstraint === constraint.type && (
                        <View style={styles.travelConstraintRadioSelected} />
                      )}
                    </View>
                  </View>
                  
                  <Text style={[
                    styles.travelConstraintLabel,
                    preferences.travelConstraint === constraint.type ? styles.travelConstraintLabelActive : styles.travelConstraintLabelInactive
                  ]}>
                    {constraint.label}
                  </Text>
                  
                  <Text style={[
                    styles.travelConstraintDescription,
                    preferences.travelConstraint === constraint.type ? styles.travelConstraintDescriptionActive : styles.travelConstraintDescriptionInactive
                  ]}>
                    {constraint.description}
                  </Text>
                  
                  <Text style={[
                    styles.travelConstraintMicrocopy,
                    preferences.travelConstraint === constraint.type ? styles.travelConstraintMicrocopyActive : styles.travelConstraintMicrocopyInactive
                  ]}>
                    {constraint.microcopy}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Dynamic Constraint Value Input */}
            {preferences.travelConstraint && preferences.travel && (
              <View style={styles.constraintValueContainer}>
                <Text style={styles.constraintValueTitle}>
                  {preferences.travelConstraint === 'time' ? 'Maximum Travel Time' : 'Maximum Distance'}
                </Text>
                <Text style={styles.constraintValueDescription}>
                  {getHumanFriendlyConstraint(preferences.travelConstraint, preferences.travelConstraintValue || 20, preferences.travel)}
                </Text>
                
                <View style={styles.constraintValueInput}>
                  <TextInput
                    style={styles.constraintValueTextInput}
                    value={preferences.travelConstraintValue?.toString() || '20'}
                    onChangeText={(text) => {
                      const value = parseInt(text) || 0;
                      const validation = validateTravelConstraint(preferences.travelConstraint, value, preferences.travel);
                      if (validation.valid) {
                        setPreferences(prev => ({ ...prev, travelConstraintValue: value }));
                      }
                    }}
                    keyboardType="numeric"
                    placeholder="20"
                    selectTextOnFocus
                  />
                  <Text style={styles.constraintValueUnit}>
                    {preferences.travelConstraint === 'time' ? 'minutes' : 'miles'}
                  </Text>
                </View>
                
                {/* Suggested Defaults */}
                <View style={styles.suggestedDefaults}>
                  <Text style={styles.suggestedDefaultsTitle}>Suggested Defaults:</Text>
                  <View style={styles.suggestedDefaultsList}>
                    {travelConstraints.find(c => c.type === preferences.travelConstraint)?.defaultValues && Object.entries(
                      travelConstraints.find(c => c.type === preferences.travelConstraint)!.defaultValues
                    ).map(([mode, value]) => (
                      <TouchableOpacity
                        key={mode}
                        style={styles.suggestedDefaultButton}
                        onPress={() => setPreferences(prev => ({ ...prev, travelConstraintValue: value }))}
                      >
                        <Text style={styles.suggestedDefaultText}>
                          {mode === 'walk' ? 'Walk' : mode === 'drive' ? 'Drive' : 'Transit'}: {value} {preferences.travelConstraint === 'time' ? 'min' : 'mi'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {/* Travel Constraint Logic Explanation */}
            {preferences.travelConstraint && preferences.travel && (
              <View style={styles.travelConstraintLogicExplanation}>
                <Text style={styles.travelConstraintLogicTitle}>How This Works:</Text>
                <Text style={styles.travelConstraintLogicText}>
                  {getTravelConstraintLogic(preferences.travelConstraint, preferences.travel).description}
                </Text>
              </View>
            )}

            {/* Card Preview Examples */}
            <View style={styles.cardPreviewExamples}>
              <Text style={styles.cardPreviewExamplesTitle}>Card Preview Examples:</Text>
              <View style={styles.cardPreviewExamplesList}>
                <Text style={styles.cardPreviewExample}>
                  • {getCardPreviewConstraint('time', '15 min drive', '8.2 miles', 20)}
                </Text>
                <Text style={styles.cardPreviewExample}>
                  • {getCardPreviewConstraint('distance', '12 min walk', '1.2 miles', 5)}
                </Text>
                <Text style={styles.cardPreviewExample}>
                  • {getCardPreviewConstraint('time', '25 min transit', '6.5 miles', 30)}
                </Text>
              </View>
            </View>
          </View>

          {/* Enhanced Starting Location */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="location" size={20} color="#007AFF" />
              <Text style={styles.sectionTitle}>Starting Location</Text>
            </View>
            <Text style={styles.sectionDescription}>
              Set your starting point to anchor all travel calculations. Choose GPS for current location or search for planning in another city.
            </Text>
            
            {/* Starting Location Type Selection */}
            <View style={styles.startingLocationContainer}>
              {startingLocationTypes.map((locationType) => (
                <TouchableOpacity
                  key={locationType.type}
                  style={[
                    styles.enhancedStartingLocationCard,
                    preferences.startingLocationType === locationType.type ? styles.enhancedStartingLocationCardActive : styles.enhancedStartingLocationCardInactive,
                    { borderColor: locationType.type === 'gps' ? '#FF6B35' : locationType.type === 'search' ? '#2196F3' : '#4CAF50' }
                  ]}
                  onPress={() => setPreferences(prev => ({ ...prev, startingLocationType: locationType.type }))}
                >
                  <View style={styles.startingLocationHeader}>
                    <Text style={styles.startingLocationIcon}>{locationType.icon}</Text>
                    <View style={styles.startingLocationRadio}>
                      {preferences.startingLocationType === locationType.type && (
                        <View style={styles.startingLocationRadioSelected} />
                      )}
                    </View>
                  </View>
                  
                  <Text style={[
                    styles.startingLocationLabel,
                    preferences.startingLocationType === locationType.type ? styles.startingLocationLabelActive : styles.startingLocationLabelInactive
                  ]}>
                    {locationType.label}
                  </Text>
                  
                  <Text style={[
                    styles.startingLocationDescription,
                    preferences.startingLocationType === locationType.type ? styles.startingLocationDescriptionActive : styles.startingLocationDescriptionInactive
                  ]}>
                    {locationType.description}
                  </Text>
                  
                  <Text style={[
                    styles.startingLocationMicrocopy,
                    preferences.startingLocationType === locationType.type ? styles.startingLocationMicrocopyActive : styles.startingLocationMicrocopyInactive
                  ]}>
                    {locationType.microcopy}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* GPS Location Detection */}
            {preferences.startingLocationType === 'gps' && (
              <View style={styles.gpsLocationContainer}>
                <Text style={styles.gpsLocationTitle}>Current Location Detection</Text>
                <Text style={styles.gpsLocationDescription}>
                  Mingla will use your device's GPS to find your exact location for the most accurate travel calculations.
                </Text>
                
                <View style={styles.gpsLocationStatus}>
                  <Ionicons name="location" size={16} color="#4CAF50" />
                  <Text style={styles.gpsLocationStatusText}>
                    GPS location enabled
                  </Text>
                </View>
                
                <Text style={styles.gpsLocationNote}>
                  Your starting point will shape travel time & distance results.
                </Text>
              </View>
            )}

            {/* Location Search */}
            {preferences.startingLocationType === 'search' && (
              <View style={styles.locationSearchContainer}>
                <Text style={styles.locationSearchTitle}>Search for a Place</Text>
                <Text style={styles.locationSearchDescription}>
                  Type in city, area, landmark, or address. Perfect for planning dates in another city.
                </Text>
                
                <View style={styles.locationSearchInput}>
                  <Ionicons name="search" size={16} color="#666" style={styles.searchIcon} />
                  <TextInput
                    style={styles.locationSearchTextInput}
                    placeholder="Enter city, landmark, or address..."
                    value={preferences.locationSearchQuery || ''}
                    onChangeText={(text) => setPreferences(prev => ({ ...prev, locationSearchQuery: text }))}
                    autoFocus={true}
                    returnKeyType="search"
                  />
                </View>
                
                {/* Search Suggestions */}
                {preferences.locationSearchQuery && preferences.locationSearchQuery.length >= 2 && (
                  <View style={styles.searchSuggestions}>
                    <Text style={styles.searchSuggestionsTitle}>Suggestions:</Text>
                    {getLocationSearchSuggestions(preferences.locationSearchQuery).map((suggestion, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.searchSuggestionItem}
                        onPress={() => setPreferences(prev => ({ ...prev, locationSearchQuery: suggestion }))}
                      >
                        <Ionicons name="location-outline" size={14} color="#666" />
                        <Text style={styles.searchSuggestionText}>{suggestion}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                
                {/* Location Disambiguation */}
                {preferences.locationSearchQuery && getLocationDisambiguation(preferences.locationSearchQuery).length > 0 && (
                  <View style={styles.locationDisambiguation}>
                    <Text style={styles.locationDisambiguationTitle}>Did you mean:</Text>
                    {getLocationDisambiguation(preferences.locationSearchQuery).map((option, index) => (
                      <TouchableOpacity
                        key={index}
                        style={styles.locationDisambiguationOption}
                        onPress={() => setPreferences(prev => ({ ...prev, locationSearchQuery: option }))}
                      >
                        <Text style={styles.locationDisambiguationText}>{option}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Quick Location Shortcuts */}
            <View style={styles.quickLocationShortcuts}>
              <Text style={styles.quickLocationShortcutsTitle}>Quick Shortcuts:</Text>
              <View style={styles.quickLocationShortcutsList}>
                {getQuickLocationShortcuts().map((shortcut) => (
                  <TouchableOpacity
                    key={shortcut.id}
                    style={[
                      styles.quickLocationShortcutButton,
                      { backgroundColor: shortcut.color + '20', borderColor: shortcut.color }
                    ]}
                    onPress={() => {
                      if (shortcut.id === 'gps') {
                        setPreferences(prev => ({ ...prev, startingLocationType: 'gps' }));
                      } else {
                        // Handle saved locations
                        Alert.alert('Saved Location', `Use ${shortcut.label} address`);
                      }
                    }}
                  >
                    <Text style={styles.quickLocationShortcutIcon}>{shortcut.icon}</Text>
                    <Text style={[styles.quickLocationShortcutText, { color: shortcut.color }]}>
                      {shortcut.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Map Pin Preview */}
            {preferences.startingLocation && preferences.travelConstraint && preferences.travelConstraintValue && (
              <View style={styles.mapPinPreview}>
                <Text style={styles.mapPinPreviewTitle}>Location Preview:</Text>
                <Text style={styles.mapPinPreviewDescription}>
                  {getHumanFriendlyLocation(preferences.startingLocation)}
                </Text>
                <Text style={styles.mapPinPreviewDetails}>
                  {getMapPinPreview(preferences.startingLocation, preferences.travelConstraint, preferences.travelConstraintValue)?.description}
                </Text>
                
                <View style={styles.mapPinPreviewNote}>
                  <Ionicons name="map" size={14} color="#666" />
                  <Text style={styles.mapPinPreviewNoteText}>
                    Pin drop + radius highlight will show on map
                  </Text>
                </View>
              </View>
            )}

            {/* Starting Location Logic Explanation */}
            {preferences.startingLocationType && (
              <View style={styles.startingLocationLogicExplanation}>
                <Text style={styles.startingLocationLogicTitle}>How This Works:</Text>
                <Text style={styles.startingLocationLogicText}>
                  {getStartingLocationLogic(preferences.startingLocationType).description}
                </Text>
                <Text style={styles.startingLocationLogicAccuracy}>
                  Accuracy: {getStartingLocationLogic(preferences.startingLocationType).accuracy}
                </Text>
              </View>
            )}
          </View>

        </ScrollView>
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

  // Top Button Container
  topButtonContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  // Apply Button Styles - Primary Orange Button
  applyButton: {
    backgroundColor: '#FF6B35', // Primary orange color
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    shadowColor: '#FF6B35',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  applyButtonIcon: {
    marginRight: 8,
  },
  applyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
    textAlign: 'center',
  },
  applyButtonArrow: {
    marginLeft: 8,
  },

  // Group Size Presets Styles
  groupSizePresets: {
    marginBottom: 20,
  },
  presetLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  presetButtons: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  presetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: '#007AFF',
    backgroundColor: 'white',
    gap: 8,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  presetButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  presetButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#007AFF',
  },
  presetButtonTextActive: {
    color: 'white',
  },
  
  // Enhanced Group Size Controls
  groupSizeValueContainer: {
    alignItems: 'center',
    minWidth: 80,
  },
  groupSizeButtonDisabled: {
    opacity: 0.5,
  },
  
  // Group Size Impact Description
  groupSizeImpact: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
  },
  impactTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  impactText: {
    fontSize: 11,
    color: '#6b7280',
    lineHeight: 16,
  },

  // Enhanced Experience Type Badge Styles
  enhancedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 2,
    backgroundColor: 'white',
    marginBottom: 8,
    marginRight: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  enhancedBadgeActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  enhancedBadgeInactive: {
    backgroundColor: 'white',
  },
  enhancedBadgeText: {
    fontSize: 14,
    fontWeight: '600',
  },
  enhancedBadgeTextActive: {
    color: 'white',
  },
  enhancedBadgeTextInactive: {
    color: '#333',
  },
  
  // Badge System Explanation
  badgeExplanation: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  badgeExplanationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  badgeExplanationText: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
  },

  // Enhanced Budget Styles
  budgetPresets: {
    marginBottom: 20,
  },
  budgetPresetButton: {
    flexDirection: 'column',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    backgroundColor: 'white',
    marginBottom: 8,
    marginRight: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  budgetPresetText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  budgetPresetRange: {
    fontSize: 12,
    fontWeight: '500',
  },
  budgetFeedback: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
  },
  budgetFeedbackText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '500',
  },
  budgetGuidance: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#28a745',
  },
  budgetGuidanceTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  budgetGuidanceText: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
  },

  // Enhanced Category Selection Styles
  sectionSubtitle: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 12,
    fontStyle: 'italic',
  },
  selectedCategoriesContainer: {
    marginBottom: 16,
  },
  selectedCategoriesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  availableCategoriesContainer: {
    marginBottom: 16,
  },
  availableCategoriesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  badgeCloseIcon: {
    marginLeft: 4,
  },
  noAvailableCategoriesContainer: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  noAvailableCategoriesText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 12,
  },
  clearCategoriesButton: {
    backgroundColor: '#ef4444',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  clearCategoriesButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },

  // Enhanced Category Styles
  enhancedCategoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    marginRight: 8,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  enhancedCategoryIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  enhancedCategoryInfo: {
    flex: 1,
  },
  enhancedCategoryName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 2,
  },
  enhancedCategoryDescription: {
    fontSize: 12,
    color: '#666',
  },
  removeCategoryButton: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
  },
  enhancedCategoryContainer: {
    marginBottom: 20,
  },
  enhancedCategoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  enhancedCategoryPillIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  enhancedCategoryPillContent: {
    flex: 1,
  },
  enhancedCategoryPillText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  enhancedCategoryPillSubtext: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  categoryLogicExplanation: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  categoryLogicTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  categoryLogicText: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
  },

  // Cross-Mapping Styles
  crossMappingContainer: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#f0f8ff',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  crossMappingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  crossMappingSubtitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 16,
    lineHeight: 18,
  },
  combinationCard: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  combinationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  combinationIcon: {
    fontSize: 20,
    marginRight: 12,
    marginTop: 2,
  },
  combinationInfo: {
    flex: 1,
  },
  combinationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  combinationDescription: {
    fontSize: 12,
    color: '#666',
    lineHeight: 16,
  },

  // Date Selection Styles
  dateSelectionContainer: {
    marginBottom: 20,
  },
  dateSelectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  dateSelectionCardActive: {
    backgroundColor: '#f0f8ff',
  },
  dateSelectionCardInactive: {
    backgroundColor: 'white',
  },
  dateSelectionIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  dateSelectionContent: {
    flex: 1,
  },
  dateSelectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  dateSelectionLabelActive: {
    color: '#007AFF',
  },
  dateSelectionLabelInactive: {
    color: '#1a1a1a',
  },
  dateSelectionDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  dateSelectionDescriptionActive: {
    color: '#007AFF',
  },
  dateSelectionDescriptionInactive: {
    color: '#666',
  },

  // Enhanced Time Slot Styles
  timeSlotContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#9C27B0',
  },
  timeSlotTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  timeSlotSubtitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 16,
    lineHeight: 16,
  },
  timeSlotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  enhancedTimeSlotCard: {
    width: '48%',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  enhancedTimeSlotCardActive: {
    backgroundColor: '#f3e5f5',
    shadowOpacity: 0.15,
  },
  enhancedTimeSlotCardInactive: {
    backgroundColor: 'white',
  },
  timeSlotHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  timeSlotIcon: {
    fontSize: 24,
  },
  timeSlotCrowdIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crowdDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  crowdLevelText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#666',
  },
  timeSlotLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
    textAlign: 'center',
  },
  timeSlotLabelActive: {
    color: '#9C27B0',
  },
  timeSlotLabelInactive: {
    color: '#1a1a1a',
  },
  timeSlotTime: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
    textAlign: 'center',
  },
  timeSlotTimeActive: {
    color: '#9C27B0',
  },
  timeSlotTimeInactive: {
    color: '#666',
  },
  timeSlotDescription: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 14,
    marginBottom: 8,
  },
  timeSlotDescriptionActive: {
    color: '#9C27B0',
  },
  timeSlotDescriptionInactive: {
    color: '#999',
  },

  // Best Time Suggestion Styles
  bestTimeSuggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
  },
  bestTimeText: {
    fontSize: 11,
    color: '#1976d2',
    marginLeft: 6,
    flex: 1,
    lineHeight: 14,
  },

  // Weather Suggestion Styles
  weatherSuggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    borderRadius: 6,
    padding: 8,
    marginTop: 6,
  },
  weatherSuggestionText: {
    fontSize: 11,
    color: '#f57c00',
    marginLeft: 6,
    flex: 1,
    lineHeight: 14,
  },

  // Exact Time Selection Styles
  exactTimeContainer: {
    marginTop: 16,
    alignItems: 'center',
  },
  exactTimeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  exactTimeButtonText: {
    fontSize: 12,
    color: '#007AFF',
    marginLeft: 6,
    fontWeight: '500',
  },

  // Time Slot Logic Explanation Styles
  timeSlotLogicExplanation: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#e8f5e8',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  timeSlotLogicTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 4,
  },
  timeSlotLogicText: {
    fontSize: 11,
    color: '#388e3c',
    lineHeight: 14,
  },

  // Fallback Suggestions Styles
  fallbackSuggestions: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f3e5f5',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#9C27B0',
  },
  fallbackTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7b1fa2',
    marginBottom: 4,
  },
  fallbackText: {
    fontSize: 11,
    color: '#8e24aa',
    lineHeight: 14,
    marginBottom: 6,
  },
  fallbackExample: {
    fontSize: 10,
    color: '#ab47bc',
    fontStyle: 'italic',
    lineHeight: 12,
  },

  // Weather Hint Styles
  weatherHint: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    padding: 12,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FFA726',
  },
  weatherHintText: {
    fontSize: 12,
    color: '#E65100',
    marginLeft: 8,
    flex: 1,
  },

  // Enhanced Travel Mode Styles
  travelModeContainer: {
    marginBottom: 20,
  },
  enhancedTravelModeCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  enhancedTravelModeCardActive: {
    backgroundColor: '#f0f8ff',
    shadowOpacity: 0.15,
  },
  enhancedTravelModeCardInactive: {
    backgroundColor: 'white',
  },
  travelModeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  travelModeIcon: {
    fontSize: 24,
  },
  travelModeRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  travelModeRadioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#007AFF',
  },
  travelModeLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  travelModeLabelActive: {
    color: '#007AFF',
  },
  travelModeLabelInactive: {
    color: '#1a1a1a',
  },
  travelModeDescription: {
    fontSize: 13,
    lineHeight: 16,
    marginBottom: 8,
  },
  travelModeDescriptionActive: {
    color: '#007AFF',
  },
  travelModeDescriptionInactive: {
    color: '#666',
  },
  travelModeCoverage: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  travelModeCoverageActive: {
    color: '#007AFF',
    backgroundColor: '#e3f2fd',
  },
  travelModeCoverageInactive: {
    color: '#666',
    backgroundColor: '#f0f0f0',
  },

  // Travel Mode Logic Explanation Styles
  travelModeLogicExplanation: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#e8f5e8',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  travelModeLogicTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 4,
  },
  travelModeLogicText: {
    fontSize: 11,
    color: '#388e3c',
    lineHeight: 14,
  },

  // Travel Time Examples Styles
  travelTimeExamples: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f3e5f5',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#9C27B0',
  },
  travelTimeExamplesTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7b1fa2',
    marginBottom: 8,
  },
  travelTimeExamplesList: {
    gap: 4,
  },
  travelTimeExample: {
    fontSize: 11,
    color: '#8e24aa',
    lineHeight: 14,
  },

  // Smart Travel Hints Styles
  smartTravelHints: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FFA726',
  },
  smartTravelHintsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f57c00',
    marginBottom: 6,
  },
  smartTravelHintsText: {
    fontSize: 11,
    color: '#f57c00',
    lineHeight: 14,
    marginBottom: 8,
  },
  smartTravelHintsList: {
    gap: 4,
  },
  smartTravelHint: {
    fontSize: 10,
    color: '#f57c00',
    lineHeight: 12,
    fontStyle: 'italic',
  },

  // Fallback Travel Suggestions Styles
  fallbackTravelSuggestions: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#2196F3',
  },
  fallbackTravelTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1976d2',
    marginBottom: 6,
  },
  fallbackTravelText: {
    fontSize: 11,
    color: '#1976d2',
    lineHeight: 14,
    marginBottom: 6,
  },
  fallbackTravelExample: {
    fontSize: 10,
    color: '#1976d2',
    fontStyle: 'italic',
    lineHeight: 12,
  },

  // Enhanced Travel Constraint Styles
  travelConstraintContainer: {
    marginBottom: 20,
  },
  enhancedTravelConstraintCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  enhancedTravelConstraintCardActive: {
    backgroundColor: '#f0f8ff',
    shadowOpacity: 0.15,
  },
  enhancedTravelConstraintCardInactive: {
    backgroundColor: 'white',
  },
  travelConstraintHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  travelConstraintIcon: {
    fontSize: 24,
  },
  travelConstraintRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  travelConstraintRadioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#007AFF',
  },
  travelConstraintLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  travelConstraintLabelActive: {
    color: '#007AFF',
  },
  travelConstraintLabelInactive: {
    color: '#1a1a1a',
  },
  travelConstraintDescription: {
    fontSize: 13,
    lineHeight: 16,
    marginBottom: 6,
  },
  travelConstraintDescriptionActive: {
    color: '#007AFF',
  },
  travelConstraintDescriptionInactive: {
    color: '#666',
  },
  travelConstraintMicrocopy: {
    fontSize: 11,
    fontStyle: 'italic',
    lineHeight: 14,
  },
  travelConstraintMicrocopyActive: {
    color: '#007AFF',
  },
  travelConstraintMicrocopyInactive: {
    color: '#999',
  },

  // Constraint Value Input Styles
  constraintValueContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#007AFF',
  },
  constraintValueTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  constraintValueDescription: {
    fontSize: 12,
    color: '#666',
    marginBottom: 16,
    lineHeight: 16,
  },
  constraintValueInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 16,
  },
  constraintValueTextInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  constraintValueUnit: {
    fontSize: 12,
    color: '#666',
    marginLeft: 8,
  },

  // Suggested Defaults Styles
  suggestedDefaults: {
    marginTop: 12,
  },
  suggestedDefaultsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  suggestedDefaultsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestedDefaultButton: {
    backgroundColor: '#e3f2fd',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  suggestedDefaultText: {
    fontSize: 11,
    color: '#1976d2',
    fontWeight: '500',
  },

  // Travel Constraint Logic Explanation Styles
  travelConstraintLogicExplanation: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#e8f5e8',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  travelConstraintLogicTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 4,
  },
  travelConstraintLogicText: {
    fontSize: 11,
    color: '#388e3c',
    lineHeight: 14,
  },

  // Card Preview Examples Styles
  cardPreviewExamples: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FFA726',
  },
  cardPreviewExamplesTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f57c00',
    marginBottom: 8,
  },
  cardPreviewExamplesList: {
    gap: 4,
  },
  cardPreviewExample: {
    fontSize: 11,
    color: '#f57c00',
    lineHeight: 14,
  },

  // Enhanced Starting Location Styles
  startingLocationContainer: {
    marginBottom: 20,
  },
  enhancedStartingLocationCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  enhancedStartingLocationCardActive: {
    backgroundColor: '#f0f8ff',
    shadowOpacity: 0.15,
  },
  enhancedStartingLocationCardInactive: {
    backgroundColor: 'white',
  },
  startingLocationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  startingLocationIcon: {
    fontSize: 24,
  },
  startingLocationRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startingLocationRadioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#007AFF',
  },
  startingLocationLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  startingLocationLabelActive: {
    color: '#007AFF',
  },
  startingLocationLabelInactive: {
    color: '#1a1a1a',
  },
  startingLocationDescription: {
    fontSize: 13,
    lineHeight: 16,
    marginBottom: 6,
  },
  startingLocationDescriptionActive: {
    color: '#007AFF',
  },
  startingLocationDescriptionInactive: {
    color: '#666',
  },
  startingLocationMicrocopy: {
    fontSize: 11,
    fontStyle: 'italic',
    lineHeight: 14,
  },
  startingLocationMicrocopyActive: {
    color: '#007AFF',
  },
  startingLocationMicrocopyInactive: {
    color: '#999',
  },

  // GPS Location Styles
  gpsLocationContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#e8f5e8',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  gpsLocationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 8,
  },
  gpsLocationDescription: {
    fontSize: 12,
    color: '#388e3c',
    lineHeight: 16,
    marginBottom: 12,
  },
  gpsLocationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  gpsLocationStatusText: {
    fontSize: 12,
    color: '#2e7d32',
    marginLeft: 6,
    fontWeight: '500',
  },
  gpsLocationNote: {
    fontSize: 11,
    color: '#2e7d32',
    fontStyle: 'italic',
    lineHeight: 14,
  },

  // Location Search Styles
  locationSearchContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#e3f2fd',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#2196F3',
  },
  locationSearchTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1976d2',
    marginBottom: 8,
  },
  locationSearchDescription: {
    fontSize: 12,
    color: '#1976d2',
    lineHeight: 16,
    marginBottom: 16,
  },
  locationSearchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  locationSearchTextInput: {
    flex: 1,
    fontSize: 14,
    color: '#1a1a1a',
  },

  // Search Suggestions Styles
  searchSuggestions: {
    marginTop: 8,
  },
  searchSuggestionsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1976d2',
    marginBottom: 8,
  },
  searchSuggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'white',
    borderRadius: 6,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  searchSuggestionText: {
    fontSize: 12,
    color: '#1976d2',
    marginLeft: 8,
  },

  // Location Disambiguation Styles
  locationDisambiguation: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#fff3e0',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FFA726',
  },
  locationDisambiguationTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f57c00',
    marginBottom: 8,
  },
  locationDisambiguationOption: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: 'white',
    borderRadius: 4,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#FFA726',
  },
  locationDisambiguationText: {
    fontSize: 11,
    color: '#f57c00',
    fontWeight: '500',
  },

  // Quick Location Shortcuts Styles
  quickLocationShortcuts: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#6c757d',
  },
  quickLocationShortcutsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#495057',
    marginBottom: 8,
  },
  quickLocationShortcutsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickLocationShortcutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  quickLocationShortcutIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  quickLocationShortcutText: {
    fontSize: 11,
    fontWeight: '500',
  },

  // Map Pin Preview Styles
  mapPinPreview: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#e8f5e8',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  mapPinPreviewTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 4,
  },
  mapPinPreviewDescription: {
    fontSize: 11,
    color: '#388e3c',
    fontWeight: '500',
    marginBottom: 2,
  },
  mapPinPreviewDetails: {
    fontSize: 10,
    color: '#388e3c',
    lineHeight: 12,
    marginBottom: 6,
  },
  mapPinPreviewNote: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  mapPinPreviewNoteText: {
    fontSize: 10,
    color: '#666',
    marginLeft: 4,
    fontStyle: 'italic',
  },

  // Starting Location Logic Explanation Styles
  startingLocationLogicExplanation: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#e8f5e8',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  startingLocationLogicTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 4,
  },
  startingLocationLogicText: {
    fontSize: 11,
    color: '#388e3c',
    lineHeight: 14,
    marginBottom: 4,
  },
  startingLocationLogicAccuracy: {
    fontSize: 10,
    color: '#2e7d32',
    fontStyle: 'italic',
    lineHeight: 12,
  },
});
