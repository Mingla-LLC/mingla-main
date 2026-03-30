import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';
import { Icon } from '../ui/Icon';
import { PRICE_TIERS } from '../../constants/priceTiers';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// RELIABILITY: These must match app-mobile/src/utils/categoryUtils.ts
// and app-mobile/src/constants/categories.ts. If categories change, update this list.
const FILTER_CATEGORIES = [
  { slug: 'all', label: 'All' },
  { slug: 'nature', label: 'Nature & Views' },
  { slug: 'first_meet', label: 'First Meet' },
  { slug: 'picnic_park', label: 'Picnic Park' },
  { slug: 'drink', label: 'Drink' },
  { slug: 'casual_eats', label: 'Casual Eats' },
  { slug: 'fine_dining', label: 'Fine Dining' },
  { slug: 'watch', label: 'Watch' },
  { slug: 'live_performance', label: 'Live Performance' },
  { slug: 'creative_arts', label: 'Creative & Arts' },
  { slug: 'play', label: 'Play' },
  { slug: 'wellness', label: 'Wellness' },
  { slug: 'flowers', label: 'Flowers' },
] as const;

const FILTER_WHEN = [
  { key: 'all', label: 'All Dates' },
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'upcoming', label: 'Upcoming' },
] as const;

const FILTER_TIERS = [
  { slug: 'all', label: 'Any Price' },
  ...PRICE_TIERS.map(t => ({ slug: t.slug, label: t.label })),
] as const;

export type WhenFilter = 'all' | 'today' | 'this_week' | 'this_month' | 'upcoming';

export interface CardFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedWhen: WhenFilter;
  onWhenChange: (when: WhenFilter) => void;
  selectedCategory: string;
  onCategoryChange: (slug: string) => void;
  selectedTier: string;
  onTierChange: (slug: string) => void;
}

export function CardFilterBar({
  searchQuery, onSearchChange,
  selectedWhen, onWhenChange,
  selectedCategory, onCategoryChange,
  selectedTier, onTierChange,
}: CardFilterBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = () => {
    if (Platform.OS === 'android') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsExpanded(prev => !prev);
  };

  const activeFilterCount =
    (selectedWhen !== 'all' ? 1 : 0) +
    (selectedCategory !== 'all' ? 1 : 0) +
    (selectedTier !== 'all' ? 1 : 0);

  return (
    <View style={styles.filterCard}>
      <View style={styles.filterHeaderRow}>
        <View style={styles.searchInputContainer}>
          <Icon name="search" size={18} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search..."
            placeholderTextColor="#9ca3af"
            value={searchQuery}
            onChangeText={onSearchChange}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => onSearchChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close-circle" size={18} color="#9ca3af" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.filterButton} onPress={toggleExpanded} activeOpacity={0.7}>
          <Icon name="options-outline" size={20} color={activeFilterCount > 0 ? '#f97316' : '#6b7280'} />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {isExpanded && (
        <View style={styles.filterPanel}>
          {activeFilterCount > 0 && (
            <TouchableOpacity
              style={styles.clearAllButton}
              onPress={() => {
                onWhenChange('all');
                onCategoryChange('all');
                onTierChange('all');
              }}
              activeOpacity={0.7}
            >
              <Icon name="close-circle" size={14} color="#f97316" />
              <Text style={styles.clearAllText}>Clear filters</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.filterLabel}>When</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
            {FILTER_WHEN.map(w => (
              <TouchableOpacity
                key={w.key}
                style={[styles.chip, selectedWhen === w.key && styles.chipSelected]}
                onPress={() => onWhenChange(w.key as WhenFilter)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, selectedWhen === w.key && styles.chipTextSelected]}>{w.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.filterLabel}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
            {FILTER_CATEGORIES.map(c => (
              <TouchableOpacity
                key={c.slug}
                style={[styles.chip, selectedCategory === c.slug && styles.chipSelected]}
                onPress={() => onCategoryChange(selectedCategory === c.slug ? 'all' : c.slug)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, selectedCategory === c.slug && styles.chipTextSelected]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.filterLabel}>Budget</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
            {FILTER_TIERS.map(t => (
              <TouchableOpacity
                key={t.slug}
                style={[styles.chip, selectedTier === t.slug && styles.chipSelected]}
                onPress={() => onTierChange(selectedTier === t.slug ? 'all' : t.slug)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, selectedTier === t.slug && styles.chipTextSelected]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filterCard: {
    marginHorizontal: 16,
    marginVertical: 5,
    paddingVertical: 8,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    paddingVertical: 14,
    marginLeft: 8,
  },
  filterButton: {
    marginLeft: 12,
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#f97316',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
  },
  filterPanel: {
    marginTop: 12,
  },
  clearAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f97316',
  },
  filterLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
    marginTop: 10,
    marginLeft: 4,
  },
  chipScroll: {
    flexGrow: 0,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 16,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
  },
  chipSelected: {
    backgroundColor: '#f97316',
  },
  chipText: {
    fontSize: 13,
    color: '#4b5563',
  },
  chipTextSelected: {
    color: '#FFF',
    fontWeight: '600',
  },
});
