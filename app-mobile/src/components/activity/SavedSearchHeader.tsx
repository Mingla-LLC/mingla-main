/**
 * Issue #4265 — Saved search field and Filters button (SearchFilter.dc.html).
 * Replaces the light-grey CardFilterBar on Saved. Type (All / Places / Events /
 * Plans) and Open now live in the Filters sheet, not in a chip row here.
 *
 * Rendered as the Saved grid's memoised ListHeaderComponent; it holds no filter
 * state of its own — SavedTab owns the single SavedFilterState.
 */
import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";

const L = glass.likes;
const F = glass.likes.filters;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;
const CLEAR_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export interface SavedSearchHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Sheet filters that are on (the orange badge). */
  activeCount: number;
  onOpenFilters: () => void;
}

function SavedSearchHeaderImpl({
  query,
  onQueryChange,
  activeCount,
  onOpenFilters,
}: SavedSearchHeaderProps): React.ReactElement {
  const { t } = useTranslation(["activity"]);

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

    </View>
  );
}

export const SavedSearchHeader = React.memo(SavedSearchHeaderImpl);

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 4,
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
  pressed: {
    opacity: 0.8,
  },
});
