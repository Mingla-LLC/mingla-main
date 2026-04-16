/**
 * ORCH-0437: Horizontal scrollable filter pills bar for the leaderboard.
 * Radius, Status, Categories, Seats — with glassmorphic dropdowns.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Icon } from '../ui/Icon';
import { colors, glass } from '../../constants/designSystem';

export interface LeaderboardFilterState {
  radiusKm: number;
  statuses: string[];
  categories: string[];
  minSeats: number; // 0 = any, 1+ = filter
}

interface LeaderboardFiltersProps {
  filters: LeaderboardFilterState;
  onFiltersChange: (filters: LeaderboardFilterState) => void;
}

const RADIUS_OPTIONS = [1, 5, 10, 25, 50, 100];
const STATUS_OPTIONS = ['Exploring', 'Looking for plans', 'Open to meet', 'Busy'];
const SEATS_OPTIONS = [
  { label: 'Any', value: 0 },
  { label: 'Has open seats', value: 1 },
  { label: '2+ seats', value: 2 },
  { label: '3+ seats', value: 3 },
];

type ActiveDropdown = 'radius' | 'status' | 'categories' | 'seats' | null;

export function LeaderboardFilters({ filters, onFiltersChange }: LeaderboardFiltersProps): React.ReactElement {
  const [activeDropdown, setActiveDropdown] = useState<ActiveDropdown>(null);

  const toggleDropdown = useCallback((dropdown: ActiveDropdown): void => {
    setActiveDropdown((prev) => (prev === dropdown ? null : dropdown));
  }, []);

  const closeDropdown = useCallback((): void => {
    setActiveDropdown(null);
  }, []);

  const hasActiveFilters = (type: string): boolean => {
    switch (type) {
      case 'radius': return filters.radiusKm !== 5;
      case 'status': return filters.statuses.length > 0;
      case 'categories': return filters.categories.length > 0;
      case 'seats': return filters.minSeats > 0;
      default: return false;
    }
  };

  return (
    <View style={styles.container}>
      {activeDropdown && (
        <Pressable style={StyleSheet.absoluteFillObject} onPress={closeDropdown} />
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Radius pill */}
        <FilterPill
          label={`${filters.radiusKm} km`}
          active={hasActiveFilters('radius')}
          onPress={() => toggleDropdown('radius')}
        />
        {/* Status pill */}
        <FilterPill
          label={filters.statuses.length > 0 ? `${filters.statuses.length} status` : 'Any Status'}
          active={hasActiveFilters('status')}
          onPress={() => toggleDropdown('status')}
          badge={filters.statuses.length > 0 ? filters.statuses.length : undefined}
        />
        {/* Categories pill */}
        <FilterPill
          label={filters.categories.length > 0 ? `${filters.categories.length} categories` : 'All'}
          active={hasActiveFilters('categories')}
          onPress={() => toggleDropdown('categories')}
          badge={filters.categories.length > 0 ? filters.categories.length : undefined}
        />
        {/* Seats pill */}
        <FilterPill
          label={filters.minSeats > 0 ? `${filters.minSeats}+ seats` : 'Seats'}
          active={hasActiveFilters('seats')}
          onPress={() => toggleDropdown('seats')}
        />
      </ScrollView>

      {/* Dropdown overlays */}
      {activeDropdown === 'radius' && (
        <View style={[styles.dropdown, styles.dropdownRadius]}>
          {RADIUS_OPTIONS.map((km) => (
            <TouchableOpacity
              key={km}
              style={[styles.dropdownOption, filters.radiusKm === km && styles.dropdownOptionActive]}
              onPress={() => { onFiltersChange({ ...filters, radiusKm: km }); closeDropdown(); }}
            >
              <Text style={[styles.dropdownOptionText, filters.radiusKm === km && styles.dropdownOptionTextActive]}>
                {km} km
              </Text>
              {filters.radiusKm === km && <Icon name="checkmark" size={10} color={colors.accent} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {activeDropdown === 'status' && (
        <View style={[styles.dropdown, styles.dropdownStatus]}>
          {STATUS_OPTIONS.map((status) => {
            const isSelected = filters.statuses.includes(status);
            return (
              <TouchableOpacity
                key={status}
                style={[styles.dropdownOption, isSelected && styles.dropdownOptionActive]}
                onPress={() => {
                  const next = isSelected
                    ? filters.statuses.filter((s) => s !== status)
                    : [...filters.statuses, status];
                  onFiltersChange({ ...filters, statuses: next });
                }}
              >
                <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                  {isSelected && <Icon name="checkmark" size={10} color="#fff" />}
                </View>
                <Text style={[styles.dropdownOptionText, isSelected && styles.dropdownOptionTextActive]}>
                  {status}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {activeDropdown === 'seats' && (
        <View style={[styles.dropdown, styles.dropdownSeats]}>
          {SEATS_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.dropdownOption, filters.minSeats === opt.value && styles.dropdownOptionActive]}
              onPress={() => { onFiltersChange({ ...filters, minSeats: opt.value }); closeDropdown(); }}
            >
              <Text style={[styles.dropdownOptionText, filters.minSeats === opt.value && styles.dropdownOptionTextActive]}>
                {opt.label}
              </Text>
              {filters.minSeats === opt.value && <Icon name="checkmark" size={10} color={colors.accent} />}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function FilterPill({
  label,
  active,
  onPress,
  badge,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  badge?: number;
}): React.ReactElement {
  return (
    <TouchableOpacity
      style={[styles.pill, active && styles.pillActive]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${label} filter`}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
      {badge !== undefined && badge > 0 && (
        <View style={styles.pillBadge}>
          <Text style={styles.pillBadgeText}>{badge}</Text>
        </View>
      )}
      <Icon name="chevron-down" size={10} color={active ? colors.accent : colors.gray[400]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 44,
    zIndex: 10,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  pill: {
    ...glass.leaderboard.filterPill,
    height: 32,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillActive: {
    ...glass.leaderboard.filterPillActive,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray[600],
  },
  pillTextActive: {
    color: colors.accent,
  },
  pillBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
  },
  dropdown: {
    position: 'absolute',
    top: 40,
    ...glass.leaderboard.dropdown,
    ...glass.shadow,
    zIndex: 100,
  },
  dropdownRadius: {
    left: 16,
    width: 140,
  },
  dropdownStatus: {
    left: 100,
    width: 200,
  },
  dropdownSeats: {
    right: 16,
    width: 160,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 36,
  },
  dropdownOptionActive: {
    backgroundColor: 'rgba(235, 120, 37, 0.06)',
  },
  dropdownOptionText: {
    fontSize: 13,
    color: colors.text.primary,
    flex: 1,
  },
  dropdownOptionTextActive: {
    color: colors.accent,
    fontWeight: '600',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.gray[300],
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
});
