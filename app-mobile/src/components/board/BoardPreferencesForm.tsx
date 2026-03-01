import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { categories } from '../../constants/categories';

export interface BoardPreferences {
  categories: string[];
  budgetMin?: number;
  budgetMax?: number;
  groupSize?: number;
  experienceTypes?: string[];
}

interface BoardPreferencesFormProps {
  initialPreferences?: BoardPreferences;
  onPreferencesChange: (preferences: BoardPreferences) => void;
}

const experienceTypes = [
  { id: 'first_date', label: 'First Date', icon: 'heart-outline' },
  { id: 'romantic', label: 'Romantic', icon: 'heart' },
  { id: 'friendly', label: 'Friendly', icon: 'people-outline' },
  { id: 'group_fun', label: 'Group Fun', icon: 'people' },
  { id: 'solo_adventure', label: 'Adventurous', icon: 'compass-outline' },
  { id: 'business', label: 'Business', icon: 'briefcase-outline' },
];

const budgetPresets = [
  { label: '$0-25', min: 0, max: 25 },
  { label: '$25-75', min: 25, max: 75 },
  { label: '$75-150', min: 75, max: 150 },
  { label: '$150+', min: 150, max: 1000 },
];

export const BoardPreferencesForm: React.FC<BoardPreferencesFormProps> = ({
  initialPreferences,
  onPreferencesChange,
}) => {
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initialPreferences?.categories || []
  );
  const [selectedExperienceTypes, setSelectedExperienceTypes] = useState<string[]>(
    initialPreferences?.experienceTypes || []
  );
  const [selectedBudget, setSelectedBudget] = useState<{ min: number; max: number } | null>(
    initialPreferences?.budgetMin !== undefined && initialPreferences?.budgetMax !== undefined
      ? { min: initialPreferences.budgetMin, max: initialPreferences.budgetMax }
      : null
  );
  const [groupSize, setGroupSize] = useState<number>(
    initialPreferences?.groupSize || 2
  );

  const handleCategoryToggle = (categorySlug: string) => {
    const newCategories = selectedCategories.includes(categorySlug)
      ? selectedCategories.filter(c => c !== categorySlug)
      : [...selectedCategories, categorySlug];
    
    setSelectedCategories(newCategories);
    updatePreferences({
      categories: newCategories,
      experienceTypes: selectedExperienceTypes,
      budgetMin: selectedBudget?.min,
      budgetMax: selectedBudget?.max,
      groupSize,
    });
  };

  const handleExperienceTypeToggle = (typeId: string) => {
    const newTypes = selectedExperienceTypes.includes(typeId)
      ? selectedExperienceTypes.filter(t => t !== typeId)
      : [...selectedExperienceTypes, typeId];
    
    setSelectedExperienceTypes(newTypes);
    updatePreferences({
      categories: selectedCategories,
      experienceTypes: newTypes,
      budgetMin: selectedBudget?.min,
      budgetMax: selectedBudget?.max,
      groupSize,
    });
  };

  const handleBudgetSelect = (preset: { min: number; max: number }) => {
    const newBudget = selectedBudget?.min === preset.min && selectedBudget?.max === preset.max
      ? null
      : preset;
    
    setSelectedBudget(newBudget);
    updatePreferences({
      categories: selectedCategories,
      experienceTypes: selectedExperienceTypes,
      budgetMin: newBudget?.min,
      budgetMax: newBudget?.max,
      groupSize,
    });
  };

  const handleGroupSizeChange = (size: number) => {
    setGroupSize(size);
    updatePreferences({
      categories: selectedCategories,
      experienceTypes: selectedExperienceTypes,
      budgetMin: selectedBudget?.min,
      budgetMax: selectedBudget?.max,
      groupSize: size,
    });
  };

  const updatePreferences = (prefs: BoardPreferences) => {
    onPreferencesChange(prefs);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Categories Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Categories</Text>
        <Text style={styles.sectionDescription}>
          Select the types of experiences you want to explore together
        </Text>
        <View style={styles.chipContainer}>
          {categories.map((category) => (
            <TouchableOpacity
              key={category.slug}
              style={[
                styles.chip,
                selectedCategories.includes(category.slug) && styles.chipSelected,
              ]}
              onPress={() => handleCategoryToggle(category.slug)}
            >
              <Text style={styles.chipEmoji}>{category.icon}</Text>
              <Text
                style={[
                  styles.chipText,
                  selectedCategories.includes(category.slug) && styles.chipTextSelected,
                ]}
              >
                {category.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Experience Types Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Experience Types</Text>
        <Text style={styles.sectionDescription}>
          What kind of experience are you planning?
        </Text>
        <View style={styles.chipContainer}>
          {experienceTypes.map((type) => (
            <TouchableOpacity
              key={type.id}
              style={[
                styles.chip,
                selectedExperienceTypes.includes(type.id) && styles.chipSelected,
              ]}
              onPress={() => handleExperienceTypeToggle(type.id)}
            >
              <Ionicons
                name={type.icon as any}
                size={16}
                color={selectedExperienceTypes.includes(type.id) ? '#007AFF' : '#666'}
                style={styles.chipIcon}
              />
              <Text
                style={[
                  styles.chipText,
                  selectedExperienceTypes.includes(type.id) && styles.chipTextSelected,
                ]}
              >
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Budget Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Budget</Text>
        <Text style={styles.sectionDescription}>
          Optional: Set a budget range for experiences
        </Text>
        <View style={styles.chipContainer}>
          {budgetPresets.map((preset) => (
            <TouchableOpacity
              key={preset.label}
              style={[
                styles.chip,
                selectedBudget?.min === preset.min && selectedBudget?.max === preset.max && styles.chipSelected,
              ]}
              onPress={() => handleBudgetSelect(preset)}
            >
              <Text
                style={[
                  styles.chipText,
                  selectedBudget?.min === preset.min && selectedBudget?.max === preset.max && styles.chipTextSelected,
                ]}
              >
                {preset.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Group Size Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Group Size</Text>
        <Text style={styles.sectionDescription}>
          How many people will be participating?
        </Text>
        <View style={styles.groupSizeContainer}>
          {[2, 3, 4, 5, 6, 7, 8].map((size) => (
            <TouchableOpacity
              key={size}
              style={[
                styles.groupSizeButton,
                groupSize === size && styles.groupSizeButtonSelected,
              ]}
              onPress={() => handleGroupSizeChange(size)}
            >
              <Text
                style={[
                  styles.groupSizeText,
                  groupSize === size && styles.groupSizeTextSelected,
                ]}
              >
                {size}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[
              styles.groupSizeButton,
              groupSize > 8 && styles.groupSizeButtonSelected,
            ]}
            onPress={() => handleGroupSizeChange(9)}
          >
            <Text
              style={[
                styles.groupSizeText,
                groupSize > 8 && styles.groupSizeTextSelected,
              ]}
            >
              9+
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  section: {
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e1e5e9',
    marginBottom: 8,
  },
  chipSelected: {
    backgroundColor: '#E3F2FD',
    borderColor: '#007AFF',
  },
  chipEmoji: {
    fontSize: 16,
    marginRight: 6,
  },
  chipIcon: {
    marginRight: 6,
  },
  chipText: {
    fontSize: 14,
    color: '#1a1a1a',
  },
  chipTextSelected: {
    color: '#007AFF',
    fontWeight: '600',
  },
  groupSizeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  groupSizeButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#e1e5e9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupSizeButtonSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  groupSizeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  groupSizeTextSelected: {
    color: 'white',
  },
});

