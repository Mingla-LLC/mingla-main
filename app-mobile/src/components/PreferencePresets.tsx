import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { Ionicons } from '@expo/vector-icons';
import { spacing, colors, typography, fontWeights, radius, shadows } from '../constants/designSystem';
import { useHapticFeedback } from '../utils/hapticFeedback';
import { ActivePreferences } from '../types';
import { PriceTierSlug } from '../constants/priceTiers';

interface PresetConfig {
  id: string;
  name: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  preferences: Partial<ActivePreferences>;
  color: string;
}

const PRESET_CONFIGS: PresetConfig[] = [
  {
    id: 'quick-date',
    name: 'Quick Date',
    description: 'Romantic evening for two',
    icon: 'heart',
    color: colors.error[500],
    preferences: {
      experienceTypes: ['Romantic', 'First Date'],
      groupSize: 2,
      priceTiers: ['comfy'] as PriceTierSlug[],
      categories: ['dining', 'sip', 'stroll'],
      travelTime: 30,

    },
  },
  {
    id: 'adventure-day',
    name: 'Adventure Day',
    description: 'Active outdoor exploration',
    icon: 'trail-sign',
    color: colors.success[500],
    preferences: {
      experienceTypes: ['Adventure', 'Outdoor'],
      groupSize: 4,
      priceTiers: ['chill', 'comfy'] as PriceTierSlug[],
      categories: ['play_move', 'creative', 'freestyle'],
      travelTime: 60,

    },
  },
  {
    id: 'chill-evening',
    name: 'Chill Evening',
    description: 'Relaxed night in or out',
    icon: 'moon',
    color: colors.primary[500],
    preferences: {
      experienceTypes: ['Relaxed', 'Casual'],
      groupSize: 3,
      priceTiers: ['chill'] as PriceTierSlug[],
      categories: ['screen_relax', 'sip', 'casual_eats'],
      travelTime: 20,

    },
  },
  {
    id: 'foodie-tour',
    name: 'Foodie Tour',
    description: 'Culinary exploration',
    icon: 'restaurant',
    color: colors.warning[500],
    preferences: {
      experienceTypes: ['Food & Drink', 'Cultural'],
      groupSize: 2,
      priceTiers: ['comfy', 'bougie'] as PriceTierSlug[],
      categories: ['dining', 'sip', 'casual_eats'],
      travelTime: 45,

    },
  },
  {
    id: 'family-fun',
    name: 'Family Fun',
    description: 'Kid-friendly activities',
    icon: 'people',
    color: colors.success[600],
    preferences: {
      experienceTypes: ['Family', 'Kid-Friendly'],
      groupSize: 4,
      priceTiers: ['chill', 'comfy'] as PriceTierSlug[],
      categories: ['play_move', 'creative', 'freestyle'],
      travelTime: 30,

    },
  },
  {
    id: 'solo-explore',
    name: 'Solo Explore',
    description: 'Personal discovery time',
    icon: 'person',
    color: colors.gray[600],
    preferences: {
      experienceTypes: ['Solo', 'Self-Care'],
      groupSize: 1,
      priceTiers: ['chill'] as PriceTierSlug[],
      categories: ['stroll', 'screen_relax', 'creative'],
      travelTime: 25,

    },
  },
];

interface PreferencePresetsProps {
  onPresetSelect: (preset: PresetConfig) => void;
  currentPreferences?: ActivePreferences;
}

export const PreferencePresets: React.FC<PreferencePresetsProps> = ({
  onPresetSelect,
  currentPreferences,
}) => {
  const haptic = useHapticFeedback();

  const handlePresetPress = (preset: PresetConfig) => {
    haptic.selection();
    onPresetSelect(preset);
  };

  const getCurrentPresetId = () => {
    if (!currentPreferences) return null;
    
    // Simple matching logic - could be enhanced
    for (const preset of PRESET_CONFIGS) {
      const { preferences } = preset;
      if (
        preferences.groupSize === currentPreferences.groupSize &&
        JSON.stringify([...(preferences.priceTiers ?? [])].sort()) === JSON.stringify([...(currentPreferences.priceTiers ?? [])].sort()) &&
        preferences.travelTime === currentPreferences.travelTime
      ) {
        return preset.id;
      }
    }
    return null;
  };

  const currentPresetId = getCurrentPresetId();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Quick Presets</Text>
      <Text style={styles.subtitle}>Choose a preset to get started quickly</Text>
      
      <View style={styles.presetsGrid}>
        {PRESET_CONFIGS.map((preset) => {
          const isSelected = currentPresetId === preset.id;
          
          return (
            <TrackedTouchableOpacity logComponent="PreferencePresets"
              key={preset.id}
              style={[
                styles.presetCard,
                isSelected && styles.presetCardSelected,
                { borderColor: preset.color },
              ]}
              onPress={() => handlePresetPress(preset)}
              activeOpacity={0.8}
            >
              <View style={[styles.presetIcon, { backgroundColor: preset.color }]}>
                <Ionicons
                  name={preset.icon}
                  size={24}
                  color={colors.text.inverse}
                />
              </View>
              
              <Text style={styles.presetName}>{preset.name}</Text>
              <Text style={styles.presetDescription}>{preset.description}</Text>
              
              {isSelected && (
                <View style={styles.selectedIndicator}>
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={preset.color}
                  />
                </View>
              )}
            </TrackedTouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
  },
  title: {
    ...typography.xl,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.sm,
    color: colors.text.secondary,
    marginBottom: spacing.lg,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  presetCard: {
    width: '48%',
    backgroundColor: colors.background.primary,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.gray[200],
    ...shadows.sm,
    position: 'relative',
  },
  presetCardSelected: {
    borderWidth: 2,
    ...shadows.md,
  },
  presetIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  presetName: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  presetDescription: {
    ...typography.sm,
    color: colors.text.secondary,
    lineHeight: 18,
  },
  selectedIndicator: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
});
