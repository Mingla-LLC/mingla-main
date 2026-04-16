/**
 * ORCH-0437: Leaderboard profile header — expandable settings dashboard.
 * Each row expands inline to let the user edit directly without leaving the page.
 */

import React, { useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import {
  View, Text, Image, TouchableOpacity, Switch, TextInput, StyleSheet,
  LayoutAnimation, UIManager, Platform, Keyboard,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Icon } from '../ui/Icon';
import { colors } from '../../constants/designSystem';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const CATEGORY_OPTIONS: { slug: string; icon: string; label: string }[] = [
  { slug: 'nature', icon: 'leaf-outline', label: 'Nature' },
  { slug: 'play', icon: 'game-controller-outline', label: 'Play' },
  { slug: 'drinks_and_music', icon: 'wine-outline', label: 'Drinks' },
  { slug: 'brunch_lunch_casual', icon: 'fast-food-outline', label: 'Casual' },
  { slug: 'upscale_fine_dining', icon: 'restaurant-outline', label: 'Fine Dining' },
  { slug: 'movies_theatre', icon: 'film-outline', label: 'Movies' },
  { slug: 'creative_arts', icon: 'color-palette-outline', label: 'Arts' },
  { slug: 'icebreakers', icon: 'sparkles', label: 'Icebreakers' },
];

const INTENT_OPTIONS: { slug: string; label: string }[] = [
  { slug: 'adventurous', label: 'Adventurous' },
  { slug: 'first-date', label: 'First Date' },
  { slug: 'romantic', label: 'Romantic' },
  { slug: 'group-fun', label: 'Group Fun' },
  { slug: 'picnic-dates', label: 'Picnic' },
  { slug: 'take-a-stroll', label: 'Stroll' },
];

const CATEGORY_ICON_MAP: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((c) => [c.slug, c.icon])
);
const CATEGORY_LABEL_MAP: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((c) => [c.slug, c.label])
);
const INTENT_LABEL_MAP: Record<string, string> = Object.fromEntries(
  INTENT_OPTIONS.map((i) => [i.slug, i.label])
);

type ExpandedSection = 'visibility' | 'status' | 'intents' | 'categories' | 'seats' | null;

export interface LeaderboardProfileHeaderHandle {
  collapse: () => void;
}

interface LeaderboardProfileHeaderProps {
  avatarUrl: string | null;
  displayName: string;
  level: number;
  // Current values
  status: string | null;
  categories: string[];
  intents: string[];
  availableSeats: number;
  isDiscoverable: boolean;
  activeFilterCount: number;
  // Callbacks — called with new value on change (auto-save)
  onVisibilityChange: (isDiscoverable: boolean) => void;
  onStatusChange: (status: string | null) => void;
  onIntentsChange: (intents: string[]) => void;
  onCategoriesChange: (categories: string[]) => void;
  onSeatsChange: (seats: number) => void;
  onFilterPress: () => void;
}

export const LeaderboardProfileHeader = forwardRef<LeaderboardProfileHeaderHandle, LeaderboardProfileHeaderProps>(({
  avatarUrl,
  displayName,
  level,
  status,
  categories,
  intents,
  availableSeats,
  isDiscoverable,
  activeFilterCount,
  onVisibilityChange,
  onStatusChange,
  onIntentsChange,
  onCategoriesChange,
  onSeatsChange,
  onFilterPress,
}, ref) => {
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [expanded, setExpanded] = useState<ExpandedSection>(null);
  const [customStatus, setCustomStatus] = useState(
    status && status !== 'Open to meet' ? status : ''
  );
  const [isEditingCustom, setIsEditingCustom] = useState(false);

  useImperativeHandle(ref, () => ({
    collapse: () => {
      if (headerExpanded) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        dismissCustomInput();
        setExpanded(null);
        setHeaderExpanded(false);
      }
    },
  }));

  // Dismiss custom input if open — enforce status
  const dismissCustomInput = useCallback((): void => {
    Keyboard.dismiss();
    if (isEditingCustom) {
      setIsEditingCustom(false);
      if (customStatus.trim()) {
        onStatusChange(customStatus.trim());
      } else {
        onStatusChange('Open to meet');
      }
    }
  }, [isEditingCustom, customStatus, onStatusChange]);

  const toggleHeader = useCallback((): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    dismissCustomInput();
    if (headerExpanded) {
      setExpanded(null);
    }
    setHeaderExpanded((prev) => !prev);
  }, [headerExpanded, dismissCustomInput]);

  const toggleSection = useCallback((section: ExpandedSection): void => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    dismissCustomInput();
    setExpanded((prev) => (prev === section ? null : section));
  }, [dismissCustomInput]);

  return (
    <View style={styles.card}>
      {/* Top bar: Avatar + Name + Level + Expand + Filter */}
      <TouchableOpacity style={styles.topBar} onPress={toggleHeader} activeOpacity={0.8}>
        <View style={styles.identityRow}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitials}>{(displayName || 'U').charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.identityText}>
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
            <View style={styles.levelPill}>
              <Icon name="trophy" size={9} color="#ffffff" />
              <Text style={styles.levelText}>Level {level}</Text>
            </View>
          </View>
        </View>
        <View style={styles.topBarRight}>
          <Icon name={headerExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="rgba(255,255,255,0.6)" />
          <TouchableOpacity
            style={styles.filterBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onFilterPress(); }}
            activeOpacity={0.7}
            accessibilityLabel="Open filters"
          >
            <Icon name="options-outline" size={18} color="#ffffff" />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      <View style={styles.divider} />

      {/* ── Row: Visibility ── */}
      <View style={styles.settingRow}>
        <View style={styles.settingMain}>
          <Icon name={isDiscoverable ? 'eye-outline' : 'eye-off-outline'} size={16} color={isDiscoverable ? '#ffffff' : 'rgba(255,255,255,0.5)'} />
          <Text style={styles.settingLabel}>
            {isDiscoverable ? "You're visible to others" : "You're hidden"}
          </Text>
        </View>
        <Switch
          value={isDiscoverable}
          onValueChange={(val) => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (val) {
              // Enforce defaults when toggling on
              if (!status) onStatusChange('Open to meet');
              if (availableSeats < 1) onSeatsChange(1);
            }
            onVisibilityChange(val);
          }}
          trackColor={{ true: '#ffffff', false: 'rgba(255,255,255,0.3)' }}
          thumbColor={isDiscoverable ? colors.accent : '#ffffff'}
          style={styles.switch}
          accessibilityLabel={`Visibility. Currently ${isDiscoverable ? 'on' : 'off'}.`}
        />
      </View>

      {/* ── Expandable rows (hidden when collapsed) ── */}
      {headerExpanded && (<>

      {/* ── Row: Status — toggle row OR chip OR input (mutually exclusive) ── */}
      {customStatus.trim() && !isEditingCustom ? (
        <View style={styles.customStatusChip}>
          <Icon name="chatbubble-ellipses" size={14} color={colors.accent} />
          <Text style={styles.customStatusChipText} numberOfLines={1}>{customStatus}</Text>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setCustomStatus('');
              onStatusChange('Open to meet');
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="close-circle" size={16} color="rgba(235,120,37,0.5)" />
          </TouchableOpacity>
        </View>
      ) : isEditingCustom ? (
        <TextInput
          style={styles.customStatusInput}
          value={customStatus}
          onChangeText={setCustomStatus}
          placeholder="What are you up to?"
          placeholderTextColor={colors.gray[400]}
          maxLength={30}
          returnKeyType="done"
          autoFocus
          onSubmitEditing={() => {
            setIsEditingCustom(false);
            if (customStatus.trim()) {
              onStatusChange(customStatus.trim());
            } else {
              // Nothing typed — revert to Open to meet
              onStatusChange('Open to meet');
            }
          }}
          onBlur={() => {
            setIsEditingCustom(false);
            if (customStatus.trim()) {
              onStatusChange(customStatus.trim());
            } else {
              // Nothing typed — revert to Open to meet
              onStatusChange('Open to meet');
            }
          }}
        />
      ) : (
        <View style={[styles.statusToggleRow, status === 'Open to meet' && styles.statusToggleRowActive]}>
          <Icon
            name={status === 'Open to meet' ? 'hand-right' : 'create-outline'}
            size={16}
            color="#ffffff"
          />
          <Text style={[styles.statusToggleLabel, status === 'Open to meet' && styles.statusToggleLabelActive]}>
            {status === 'Open to meet' ? 'Open to meet' : 'Type a custom status'}
          </Text>
          <Switch
            value={status === 'Open to meet'}
            onValueChange={(val) => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (val) {
                onStatusChange('Open to meet');
                setCustomStatus('');
                setIsEditingCustom(false);
              } else {
                setIsEditingCustom(true);
              }
            }}
            trackColor={{ true: '#ffffff', false: 'rgba(255,255,255,0.3)' }}
            thumbColor={status === 'Open to meet' ? colors.accent : '#ffffff'}
            ios_backgroundColor={status === 'Open to meet' ? '#ffffff' : 'rgba(255,255,255,0.3)'}
            style={styles.switch}
          />
        </View>
      )}

      {/* ── Row: Vibes (Intents) ── */}
      <TouchableOpacity style={styles.settingRow} onPress={() => toggleSection('intents')} activeOpacity={0.7}>
        <View style={styles.settingMain}>
          <Icon name="heart-outline" size={16} color="rgba(255,255,255,0.6)" />
          <Text style={styles.settingLabel}>Curated experiences</Text>
        </View>
        <View style={styles.settingValueRow}>
          {intents.length > 0 ? (
            <Text style={styles.valueCount}>{intents.length} selected</Text>
          ) : (
            <Text style={styles.valueEmpty}>None</Text>
          )}
          <Icon name={expanded === 'intents' ? 'chevron-up' : 'chevron-down'} size={14} color="rgba(255,255,255,0.4)" />
        </View>
      </TouchableOpacity>
      {expanded === 'intents' && (
        <View style={styles.expandedArea}>
          {INTENT_OPTIONS.map((opt) => {
            const isActive = intents.includes(opt.slug);
            return (
              <TouchableOpacity
                key={opt.slug}
                style={[styles.optionChip, isActive && styles.optionChipActive]}
                onPress={() => {
                  // Can't deselect the last one when discoverable
                  if (isActive && intents.length <= 1) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const next = isActive ? intents.filter((i) => i !== opt.slug) : [...intents, opt.slug];
                  onIntentsChange(next);
                }}
                activeOpacity={0.7}
              >
                {isActive && <Icon name="checkmark" size={12} color={colors.accent} />}
                <Text style={[styles.optionChipText, isActive && styles.optionChipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ── Row: Categories ── */}
      <TouchableOpacity style={styles.settingRow} onPress={() => toggleSection('categories')} activeOpacity={0.7}>
        <View style={styles.settingMain}>
          <Icon name="grid-outline" size={16} color="rgba(255,255,255,0.6)" />
          <Text style={styles.settingLabel}>Popular options</Text>
        </View>
        <View style={styles.settingValueRow}>
          {categories.length > 0 ? (
            <View style={styles.miniChipRow}>
              {categories.slice(0, 3).map((c) => (
                <Icon key={c} name={CATEGORY_ICON_MAP[c] || 'ellipse-outline'} size={13} color="rgba(255,255,255,0.7)" />
              ))}
              {categories.length > 3 && <Text style={styles.valueCount}>+{categories.length - 3}</Text>}
            </View>
          ) : (
            <Text style={styles.valueEmpty}>All</Text>
          )}
          <Icon name={expanded === 'categories' ? 'chevron-up' : 'chevron-down'} size={14} color="rgba(255,255,255,0.4)" />
        </View>
      </TouchableOpacity>
      {expanded === 'categories' && (
        <View style={styles.expandedArea}>
          {CATEGORY_OPTIONS.map((opt) => {
            const isActive = categories.includes(opt.slug);
            return (
              <TouchableOpacity
                key={opt.slug}
                style={[styles.categoryChip, isActive && styles.optionChipActive]}
                onPress={() => {
                  // Can't deselect the last one when discoverable
                  if (isActive && categories.length <= 1) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const next = isActive ? categories.filter((c) => c !== opt.slug) : [...categories, opt.slug];
                  onCategoriesChange(next);
                }}
                activeOpacity={0.7}
              >
                <Icon name={opt.icon} size={14} color={isActive ? colors.accent : '#ffffff'} />
                <Text style={[styles.optionChipText, isActive && styles.optionChipTextActive]}>{opt.label}</Text>
                {isActive && <Icon name="checkmark" size={11} color={colors.accent} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ── Row: Seats ── */}
      <TouchableOpacity style={[styles.settingRow, styles.settingRowLast]} onPress={() => toggleSection('seats')} activeOpacity={0.7}>
        <View style={styles.settingMain}>
          <Icon name="people-outline" size={16} color="rgba(255,255,255,0.6)" />
          <Text style={styles.settingLabel}>Seats</Text>
        </View>
        <View style={styles.settingValueRow}>
          <Text style={styles.valueAccent}>{availableSeats >= 99 ? 'No limit' : `${availableSeats} open`}</Text>
          <Icon name={expanded === 'seats' ? 'chevron-up' : 'chevron-down'} size={14} color="rgba(255,255,255,0.4)" />
        </View>
      </TouchableOpacity>
      {expanded === 'seats' && (
        <View style={styles.expandedArea}>
          {[1, 2, 3, 4, 5].map((n) => {
            const active = availableSeats === n;
            return (
              <TouchableOpacity
                key={n}
                style={[styles.optionChip, active && styles.optionChipActive]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSeatsChange(n); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.optionChipText, active && styles.optionChipTextActive]}>{n}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.optionChip, availableSeats >= 99 && styles.optionChipActive]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSeatsChange(99); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.optionChipText, availableSeats === 0 && styles.optionChipTextActive]}>No limit</Text>
          </TouchableOpacity>
        </View>
      )}

      </>)}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    backgroundColor: colors.accent,
    borderRadius: 16,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 5,
    overflow: 'hidden',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  avatarFallback: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  identityText: {
    gap: 3,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  levelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderColor: 'rgba(255,255,255,0.3)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  levelText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#ffffff',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    color: colors.accent,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  settingRowLast: {
    borderBottomWidth: 0,
  },
  settingMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  settingValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  valuePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  valuePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  valueEmpty: {
    fontSize: 12,
    fontWeight: '400',
    color: 'rgba(255,255,255,0.6)',
    fontStyle: 'italic',
  },
  valueCount: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
  },
  valueAccent: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  miniChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  switch: {
    transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
  },
  statusToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 14,
    marginTop: 4,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  statusToggleRowActive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  statusToggleLabel: {
    flex: 1,
    fontSize: 13,
    color: '#ffffff',
    fontWeight: '500',
  },
  statusToggleLabelActive: {
    fontWeight: '600',
  },
  customStatusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 14,
    marginTop: 6,
  },
  customStatusChipText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  customStatusInput: {
    fontSize: 13,
    color: '#111827',
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginHorizontal: 14,
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 0,
  },
  // Expanded editing areas
  expandedArea: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  expandedAreaCentered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  optionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  optionChipActive: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  optionChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#ffffff',
  },
  optionChipTextActive: {
    color: colors.accent,
    fontWeight: '700',
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnPlus: {
    backgroundColor: '#ffffff',
  },
  stepperBtnDisabled: {
    opacity: 0.4,
  },
  stepperValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    minWidth: 30,
    textAlign: 'center',
  },
});
