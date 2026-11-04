/**
 * Issue #4265 — Saved search field, Filters button and quick chips
 * (SearchFilter.dc.html). Replaces the light-grey CardFilterBar on Saved.
 *
 * Rendered as the Saved grid's memoised ListHeaderComponent; it holds no filter
 * state of its own — SavedTab owns the single SavedFilterState.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { SAVED_QUICK_TYPES, type SavedQuickType } from "./savedFiltersModel";

const L = glass.likes;
const F = glass.likes.filters;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;
// 34pt chips get 5pt of vertical hit slop each side → a 44pt target.
const CHIP_HIT_SLOP = { top: 5, bottom: 5, left: 0, right: 0 } as const;
const CLEAR_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

const QUICK_TYPE_KEY: Record<SavedQuickType, string> = {
  all: "activity:savedFilters.chipAll",
  places: "activity:savedFilters.chipPlaces",
  events: "activity:savedFilters.chipEvents",
  plans: "activity:savedFilters.chipPlans",
};

export interface SavedSearchHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  type: SavedQuickType;
  onTypeChange: (type: SavedQuickType) => void;
  openNow: boolean;
  onToggleOpenNow: () => void;
  /** Sheet filters that are on (the orange badge). */
  activeCount: number;
  onOpenFilters: () => void;
}

function SavedSearchHeaderImpl({
  query,
  onQueryChange,
  type,
  onTypeChange,
  openNow,
  onToggleOpenNow,
  activeCount,
  onOpenFilters,
}: SavedSearchHeaderProps): React.ReactElement {
  const { t } = useTranslation(["activity"]);

  const chip = (key: string, label: string, selected: boolean, onPress: () => void): React.ReactElement => (
    <Pressable
      key={key}
      onPress={() => {
        HapticFeedback.light();
        onPress();
      }}
      hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text
        style={[styles.chipText, selected && styles.chipTextSelected]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.4}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <View style={styles.field}>
          <Icon name="search" size={16} color={F.icon} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={onQueryChange}
            placeholder={t("activity:savedFilters.searchPlaceholder")}
            placeholderTextColor={F.placeholder}
            accessibilityLabel={t("activity:savedFilters.searchPlaceholder")}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="never"
            selectionColor={L.accent}
            maxFontSizeMultiplier={1.4}
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => onQueryChange("")}
              hitSlop={CLEAR_HIT_SLOP}
              style={styles.clearButton}
              accessibilityRole="button"
              accessibilityLabel={t("activity:savedFilters.clearSearch")}
            >
              <Icon name="close" size={14} color={F.fieldText} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => {
            HapticFeedback.light();
            onOpenFilters();
          }}
          style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={
            activeCount > 0
              ? t("activity:savedFilters.a11yFiltersOn", { n: activeCount })
              : t("activity:savedFilters.filters")
          }
        >
          <Icon name="options-outline" size={18} color={F.fieldText} />
          {activeCount > 0 ? (
            <View pointerEvents="none" style={styles.badge}>
              <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
                {activeCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={styles.chipScroll}
        contentContainerStyle={styles.chipRow}
      >
        {SAVED_QUICK_TYPES.map((id) =>
          chip(id, t(QUICK_TYPE_KEY[id]), type === id, () => onTypeChange(id)),
        )}
        {chip("openNow", t("activity:savedFilters.openNow"), openNow, onToggleOpenNow)}
      </ScrollView>
    </View>
  );
}

export const SavedSearchHeader = React.memo(SavedSearchHeaderImpl);

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 4,
    gap: 14,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: F.rowGap,
    paddingHorizontal: L.grid.sidePadding,
  },
  field: {
    flex: 1,
    minHeight: F.fieldHeight,
    borderRadius: F.fieldRadius,
    borderWidth: 1,
    borderColor: F.fieldBorder,
    backgroundColor: OPAQUE ? F.fieldFillOpaque : F.fieldFill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: F.fieldText,
    fontSize: F.fieldFontSize,
    paddingVertical: 10,
  },
  clearButton: {
    width: F.clearSize,
    height: F.clearSize,
    borderRadius: F.clearSize / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OPAQUE ? F.clearFillOpaque : F.clearFill,
  },
  filterButton: {
    width: F.fieldHeight,
    height: F.fieldHeight,
    borderRadius: F.fieldRadius,
    borderWidth: 1,
    borderColor: F.fieldBorder,
    backgroundColor: OPAQUE ? F.fieldFillOpaque : F.fieldFill,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -5,
    right: -5,
    minWidth: F.badgeSize,
    height: F.badgeSize,
    paddingHorizontal: 4,
    borderRadius: F.badgeSize / 2,
    backgroundColor: L.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: L.textPrimary,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
  },
  // ORCH-0861: a horizontal ScrollView must not grow into its parent's space.
  chipScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipRow: {
    gap: 8,
    paddingHorizontal: L.grid.sidePadding,
    paddingVertical: 5,
  },
  chip: {
    minHeight: F.chipHeight,
    paddingHorizontal: F.chipPaddingH,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: F.chipBorder,
    backgroundColor: OPAQUE ? F.chipFillOpaque : F.chipFill,
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: {
    backgroundColor: F.selectedFill,
    borderColor: F.selectedFill,
  },
  chipText: {
    color: L.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextSelected: {
    color: F.selectedText,
  },
  pressed: {
    opacity: 0.8,
  },
});
