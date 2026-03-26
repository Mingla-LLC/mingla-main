import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { PRICE_TIERS } from '../../constants/priceTiers';

const VISIBLE_CATEGORIES = [
  { slug: 'nature', shortLabel: 'Nature', icon: 'leaf-outline', color: '#10B981' },
  { slug: 'drink', shortLabel: 'Drink', icon: 'wine-outline', color: '#8B5CF6' },
  { slug: 'casual_eats', shortLabel: 'Eats', icon: 'fast-food-outline', color: '#F59E0B' },
  { slug: 'fine_dining', shortLabel: 'Dining', icon: 'restaurant-outline', color: '#EF4444' },
  { slug: 'watch', shortLabel: 'Watch', icon: 'film-outline', color: '#3B82F6' },
  { slug: 'play', shortLabel: 'Play', icon: 'game-controller-outline', color: '#EC4899' },
  { slug: 'wellness', shortLabel: 'Wellness', icon: 'fitness-outline', color: '#14B8A6' },
  { slug: 'live_performance', shortLabel: 'Live', icon: 'musical-notes-outline', color: '#6366F1' },
  { slug: 'creative_arts', shortLabel: 'Arts', icon: 'color-palette-outline', color: '#F97316' },
] as const;

const FILTER_TIERS = [
  { slug: 'chill', label: 'Chill' },
  { slug: 'comfy', label: 'Comfy' },
  { slug: 'bougie', label: 'Bougie' },
  { slug: 'lavish', label: 'Lavish' },
];

interface MapFilterBarProps {
  selectedCategories: Set<string>;
  onToggleCategory: (slug: string) => void;
  selectedTier: string;
  onTierChange: (slug: string) => void;
  openNowOnly: boolean;
  onOpenNowToggle: () => void;
}

export function MapFilterBar({
  selectedCategories,
  onToggleCategory,
  selectedTier,
  onTierChange,
  openNowOnly,
  onOpenNowToggle,
}: MapFilterBarProps) {
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        keyboardShouldPersistTaps="handled"
      >
        {VISIBLE_CATEGORIES.map(cat => {
          const active = selectedCategories.has(cat.slug);
          return (
            <TouchableOpacity
              key={cat.slug}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onToggleCategory(cat.slug)}
              activeOpacity={0.7}
            >
              <Icon name={cat.icon} size={12} color={active ? '#FFF' : cat.color} />
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat.shortLabel}</Text>
            </TouchableOpacity>
          );
        })}

        <View style={styles.divider} />

        {FILTER_TIERS.map(tier => {
          const active = selectedTier === tier.slug;
          return (
            <TouchableOpacity
              key={tier.slug}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => onTierChange(active ? 'all' : tier.slug)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{tier.label}</Text>
            </TouchableOpacity>
          );
        })}

        <View style={styles.divider} />

        <TouchableOpacity
          style={[styles.chip, openNowOnly && styles.chipActive]}
          onPress={onOpenNowToggle}
          activeOpacity={0.7}
        >
          <Icon name="time-outline" size={12} color={openNowOnly ? '#FFF' : '#6b7280'} />
          <Text style={[styles.chipText, openNowOnly && styles.chipTextActive]}>Open Now</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    paddingRight: 16,
    paddingVertical: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  chipActive: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#4b5563',
  },
  chipTextActive: {
    color: '#FFF',
    fontWeight: '600',
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: '#e5e7eb',
    alignSelf: 'center',
    marginHorizontal: 2,
  },
});
