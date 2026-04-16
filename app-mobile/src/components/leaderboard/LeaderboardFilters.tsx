/**
 * ORCH-0437: Leaderboard filter bottom sheet modal.
 * Compact, no-scroll layout. Deep orange selections.
 */

import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../ui/Icon';
import { colors } from '../../constants/designSystem';

export interface LeaderboardFilterState {
  radiusKm: number;
  statuses: string[];
  categories: string[];
  minSeats: number;
}

interface LeaderboardFiltersProps {
  visible: boolean;
  filters: LeaderboardFilterState;
  onFiltersChange: (filters: LeaderboardFilterState) => void;
  onClose: () => void;
}

const RADIUS_OPTIONS = [5, 10, 25, 50, 100];
const STATUS_OPTIONS = ['Exploring', 'Looking for plans', 'Open to meet'];
const CATEGORY_OPTIONS = [
  { slug: 'Nature & Views', label: 'Nature', icon: 'leaf-outline' },
  { slug: 'Icebreakers', label: 'Social', icon: 'sparkles' },
  { slug: 'Drinks & Music', label: 'Drinks', icon: 'wine-outline' },
  { slug: 'Brunch Lunch & Casual', label: 'Casual', icon: 'fast-food-outline' },
  { slug: 'Upscale & Fine Dining', label: 'Dining', icon: 'restaurant-outline' },
  { slug: 'Movies & Theatre', label: 'Movies', icon: 'film-outline' },
  { slug: 'Creative & Arts', label: 'Arts', icon: 'color-palette-outline' },
  { slug: 'Play', label: 'Play', icon: 'game-controller-outline' },
];
const SEATS_OPTIONS = [
  { label: 'Any', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
  { label: '5+', value: 5 },
];

export function LeaderboardFilters({
  visible,
  filters,
  onFiltersChange,
  onClose,
}: LeaderboardFiltersProps): React.ReactElement | null {
  const insets = useSafeAreaInsets();

  const activeCount =
    (filters.radiusKm !== 5 ? 1 : 0) +
    filters.statuses.length +
    filters.categories.length +
    (filters.minSeats > 0 ? 1 : 0);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          {/* Handle bar */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Filter who you see</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Icon name="close" size={18} color={colors.gray[500]} />
            </TouchableOpacity>
          </View>

          {/* Distance */}
          <View style={styles.section}>
            <Text style={styles.label}>Distance</Text>
            <View style={styles.chipRow}>
              {RADIUS_OPTIONS.map((km) => {
                const active = filters.radiusKm === km;
                return (
                  <TouchableOpacity
                    key={km}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => onFiltersChange({ ...filters, radiusKm: km })}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{km} km</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Status */}
          <View style={styles.section}>
            <Text style={styles.label}>Status</Text>
            <View style={styles.chipRow}>
              {STATUS_OPTIONS.map((s) => {
                const active = filters.statuses.includes(s);
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => {
                      const next = active
                        ? filters.statuses.filter((x) => x !== s)
                        : [...filters.statuses, s];
                      onFiltersChange({ ...filters, statuses: next });
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Categories */}
          <View style={styles.section}>
            <Text style={styles.label}>Categories</Text>
            <View style={styles.chipRow}>
              {CATEGORY_OPTIONS.map(({ slug, label, icon }) => {
                const active = filters.categories.includes(slug);
                return (
                  <TouchableOpacity
                    key={slug}
                    style={[styles.catChip, active && styles.chipActive]}
                    onPress={() => {
                      const next = active
                        ? filters.categories.filter((c) => c !== slug)
                        : [...filters.categories, slug];
                      onFiltersChange({ ...filters, categories: next });
                    }}
                    activeOpacity={0.7}
                  >
                    <Icon name={icon} size={13} color={active ? '#fff' : colors.gray[500]} />
                    <Text style={[styles.catChipText, active && styles.catChipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Seats */}
          <View style={styles.sectionLast}>
            <Text style={styles.label}>Open seats</Text>
            <View style={styles.chipRow}>
              {SEATS_OPTIONS.map((opt) => {
                const active = filters.minSeats === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => onFiltersChange({ ...filters, minSeats: opt.value })}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Footer: Reset + Done */}
          <View style={styles.footer}>
            {activeCount > 0 ? (
              <TouchableOpacity
                onPress={() => onFiltersChange({ radiusKm: 5, statuses: [], categories: [], minSeats: 0 })}
                activeOpacity={0.7}
                style={styles.resetBtn}
              >
                <Text style={styles.resetText}>Reset</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}
            <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 6,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray[300],
    alignSelf: 'center',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text.primary,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  sectionLast: {
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.gray[600],
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  catChipText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.gray[600],
  },
  catChipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  resetBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  resetText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.gray[500],
  },
  doneBtn: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  doneText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
