import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '../contexts/NavigationContext';
import { useAppStore } from '../store/appStore';
import { categories } from '../constants/categories';
import { supabase } from '../services/supabase';

export const PreferencesSheet: React.FC = () => {
  const { isPreferencesModalOpen, closePreferencesModal } = useNavigation();
  const { user, preferences, setPreferences } = useAppStore();
  
  const [localPreferences, setLocalPreferences] = useState({
    budgetMin: 0,
    budgetMax: 1000,
    peopleCount: 1,
    categories: ['stroll', 'sip'],
    travelMode: 'walking',
    travelConstraintType: 'time',
    travelConstraintValue: 30,
    shareLocation: true,
    shareBudget: false,
    shareCategories: true,
    shareDateTime: true,
  });
  
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (preferences) {
      setLocalPreferences({
        budgetMin: preferences.budget_min,
        budgetMax: preferences.budget_max,
        peopleCount: preferences.people_count,
        categories: preferences.categories,
        travelMode: preferences.travel_mode,
        travelConstraintType: preferences.travel_constraint_type,
        travelConstraintValue: preferences.travel_constraint_value,
        shareLocation: true, // Default values for sharing preferences
        shareBudget: false,
        shareCategories: true,
        shareDateTime: true,
      });
    }
  }, [preferences]);

  const handleSave = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('preferences')
        .upsert({
          profile_id: user.id,
          budget_min: localPreferences.budgetMin,
          budget_max: localPreferences.budgetMax,
          people_count: localPreferences.peopleCount,
          categories: localPreferences.categories,
          travel_mode: localPreferences.travelMode,
          travel_constraint_type: localPreferences.travelConstraintType,
          travel_constraint_value: localPreferences.travelConstraintValue,
        });

      if (error) throw error;

      // Update profile sharing preferences
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          share_location: localPreferences.shareLocation,
          share_budget: localPreferences.shareBudget,
          share_categories: localPreferences.shareCategories,
          share_date_time: localPreferences.shareDateTime,
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      Alert.alert('Success', 'Preferences saved successfully!');
      closePreferencesModal();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleCategory = (categorySlug: string) => {
    setLocalPreferences(prev => ({
      ...prev,
      categories: prev.categories.includes(categorySlug)
        ? prev.categories.filter(c => c !== categorySlug)
        : [...prev.categories, categorySlug],
    }));
  };

  const handleClose = () => {
    closePreferencesModal();
  };

  return (
    <Modal
      visible={isPreferencesModalOpen}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Preferences</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#666" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content}>
          {/* Budget Range */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Budget Range</Text>
            <View style={styles.budgetContainer}>
              <View style={styles.budgetInput}>
                <Text style={styles.budgetLabel}>Min</Text>
                <Text style={styles.budgetValue}>${localPreferences.budgetMin}</Text>
              </View>
              <View style={styles.budgetInput}>
                <Text style={styles.budgetLabel}>Max</Text>
                <Text style={styles.budgetValue}>${localPreferences.budgetMax}</Text>
              </View>
            </View>
          </View>

          {/* Group Size */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Group Size</Text>
            <View style={styles.groupSizeContainer}>
              {[1, 2, 3, 4, 5, 6].map((size) => (
                <TouchableOpacity
                  key={size}
                  style={[
                    styles.groupSizeButton,
                    localPreferences.peopleCount === size && styles.groupSizeButtonActive,
                  ]}
                  onPress={() => setLocalPreferences(prev => ({ ...prev, peopleCount: size }))}
                >
                  <Text
                    style={[
                      styles.groupSizeText,
                      localPreferences.peopleCount === size && styles.groupSizeTextActive,
                    ]}
                  >
                    {size}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Categories */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Interests</Text>
            <View style={styles.categoriesGrid}>
              {categories.map((category) => (
                <TouchableOpacity
                  key={category.slug}
                  style={[
                    styles.categoryButton,
                    localPreferences.categories.includes(category.slug) && styles.categoryButtonActive,
                  ]}
                  onPress={() => toggleCategory(category.slug)}
                >
                  <Text style={styles.categoryIcon}>{category.icon}</Text>
                  <Text
                    style={[
                      styles.categoryName,
                      localPreferences.categories.includes(category.slug) && styles.categoryNameActive,
                    ]}
                  >
                    {category.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Travel Mode */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Travel Mode</Text>
            <View style={styles.travelModeContainer}>
              {[
                { key: 'walking', label: 'Walking', icon: 'walk' },
                { key: 'driving', label: 'Driving', icon: 'car' },
                { key: 'public', label: 'Public Transit', icon: 'bus' },
              ].map((mode) => (
                <TouchableOpacity
                  key={mode.key}
                  style={[
                    styles.travelModeButton,
                    localPreferences.travelMode === mode.key && styles.travelModeButtonActive,
                  ]}
                  onPress={() => setLocalPreferences(prev => ({ ...prev, travelMode: mode.key }))}
                >
                  <Ionicons
                    name={mode.icon as any}
                    size={20}
                    color={localPreferences.travelMode === mode.key ? 'white' : '#666'}
                  />
                  <Text
                    style={[
                      styles.travelModeText,
                      localPreferences.travelMode === mode.key && styles.travelModeTextActive,
                    ]}
                  >
                    {mode.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Travel Constraint */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Travel Constraint</Text>
            <View style={styles.constraintContainer}>
              <TouchableOpacity
                style={[
                  styles.constraintButton,
                  localPreferences.travelConstraintType === 'time' && styles.constraintButtonActive,
                ]}
                onPress={() => setLocalPreferences(prev => ({ ...prev, travelConstraintType: 'time' }))}
              >
                <Text
                  style={[
                    styles.constraintText,
                    localPreferences.travelConstraintType === 'time' && styles.constraintTextActive,
                  ]}
                >
                  Time: {localPreferences.travelConstraintValue} min
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.constraintButton,
                  localPreferences.travelConstraintType === 'distance' && styles.constraintButtonActive,
                ]}
                onPress={() => setLocalPreferences(prev => ({ ...prev, travelConstraintType: 'distance' }))}
              >
                <Text
                  style={[
                    styles.constraintText,
                    localPreferences.travelConstraintType === 'distance' && styles.constraintTextActive,
                  ]}
                >
                  Distance: {localPreferences.travelConstraintValue} km
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Privacy Settings */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Privacy Settings</Text>
            <View style={styles.privacyContainer}>
              <View style={styles.privacyItem}>
                <Text style={styles.privacyLabel}>Share Location</Text>
                <Switch
                  value={localPreferences.shareLocation}
                  onValueChange={(value) => setLocalPreferences(prev => ({ ...prev, shareLocation: value }))}
                />
              </View>
              <View style={styles.privacyItem}>
                <Text style={styles.privacyLabel}>Share Budget</Text>
                <Switch
                  value={localPreferences.shareBudget}
                  onValueChange={(value) => setLocalPreferences(prev => ({ ...prev, shareBudget: value }))}
                />
              </View>
              <View style={styles.privacyItem}>
                <Text style={styles.privacyLabel}>Share Interests</Text>
                <Switch
                  value={localPreferences.shareCategories}
                  onValueChange={(value) => setLocalPreferences(prev => ({ ...prev, shareCategories: value }))}
                />
              </View>
              <View style={styles.privacyItem}>
                <Text style={styles.privacyLabel}>Share Date & Time</Text>
                <Switch
                  value={localPreferences.shareDateTime}
                  onValueChange={(value) => setLocalPreferences(prev => ({ ...prev, shareDateTime: value }))}
                />
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveButton, loading && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={loading}
          >
            <Text style={styles.saveButtonText}>
              {loading ? 'Saving...' : 'Save Preferences'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e1e5e9',
    backgroundColor: 'white',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 12,
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
    marginBottom: 4,
  },
  budgetValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  groupSizeContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  groupSizeButton: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    minWidth: 50,
    alignItems: 'center',
  },
  groupSizeButtonActive: {
    backgroundColor: '#007AFF',
  },
  groupSizeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  groupSizeTextActive: {
    color: 'white',
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
  constraintText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#666',
  },
  constraintTextActive: {
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
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#e1e5e9',
    backgroundColor: 'white',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: '#ccc',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
