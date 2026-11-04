/**
 * Issue #4265 — the Saved "Filters" bottom sheet (SearchFilter.dc.html):
 * Sort by, Category (from the categories actually saved), Budget, Open now,
 * and a pinned "Clear" + "Show N likes" footer.
 *
 * Edits apply live to SavedTab's single SavedFilterState, so the footer count
 * is the real result count; "Show N likes" just closes the sheet.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";
import {
  SAVED_BUDGETS,
  SAVED_SORTS,
  type SavedBudget,
  type SavedSort,
} from "./savedFiltersModel";

const L = glass.likes;
const F = glass.likes.filters;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;
const SNAP_POINTS = ["76%"];
const BACKGROUND_STYLE = {
  backgroundColor: L.sheet.bg,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
} as const;
const CHIP_HIT_SLOP = { top: 4, bottom: 4, left: 0, right: 0 } as const;

const SORT_KEY: Record<SavedSort, string> = {
  recent: "activity:savedFilters.sortRecent",
  nearest: "activity:savedFilters.sortNearest",
  rating: "activity:savedFilters.sortRating",
};

/** $ glyphs are price levels, not a currency; Free is translated. */
export function savedBudgetGlyph(budget: Exclude<SavedBudget, "free">): string {
  return "$".repeat(Number(budget));
}

export interface SavedFiltersSheetProps {
  visible: boolean;
  onClose: () => void;
  sort: SavedSort;
  categories: readonly string[];
  budgets: readonly SavedBudget[];
  openNow: boolean;
  categoryOptions: ReadonlyArray<{ slug: string; label: string }>;
  resultCount: number;
  onSortChange: (sort: SavedSort) => void;
  onToggleCategory: (slug: string) => void;
  onToggleBudget: (budget: SavedBudget) => void;
  onToggleOpenNow: () => void;
  onClear: () => void;
}

export default function SavedFiltersSheet({
  visible,
  onClose,
  sort,
  categories,
  budgets,
  openNow,
  categoryOptions,
  resultCount,
  onSortChange,
  onToggleCategory,
  onToggleBudget,
  onToggleOpenNow,
  onClear,
}: SavedFiltersSheetProps): React.ReactElement {
  const { t } = useTranslation(["activity", "common"]);
  const insets = useSafeAreaInsets();

  const pill = (
    key: string,
    label: string,
    selected: boolean,
    onPress: () => void,
    a11yLabel?: string,
  ): React.ReactElement => (
    <Pressable
      key={key}
      onPress={() => {
        HapticFeedback.light();
        onPress();
      }}
      hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => [styles.pill, selected && styles.selected, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={a11yLabel ?? label}
    >
      <Text style={[styles.pillText, selected && styles.selectedText]} numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </Pressable>
  );

  const header = (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">
        {t("activity:savedFilters.filters")}
      </Text>
    </View>
  );

  const footer = (
    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <Pressable
        onPress={() => {
          HapticFeedback.light();
          onClear();
        }}
        style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.clearText} maxFontSizeMultiplier={1.4}>
          {t("activity:savedFilters.clear")}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => {
          HapticFeedback.light();
          onClose();
        }}
        style={({ pressed }) => [styles.showButton, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.showText} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {t("activity:savedFilters.show", { count: resultCount })}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      theme="dark"
      snapPoints={SNAP_POINTS}
      wrapInRNModal
      backgroundStyle={BACKGROUND_STYLE}
      accessibilityLabel={t("activity:savedFilters.filters")}
      scrollMode="scroll"
      header={header}
      stickyFooter={footer}
      scrollProps={{ contentContainerStyle: styles.body }}
    >
      <View style={styles.section}>
        <Text style={styles.sectionLabel} accessibilityRole="header">
          {t("activity:savedFilters.sortBy")}
        </Text>
        <View style={styles.wrapRow}>
          {SAVED_SORTS.map((id) => pill(id, t(SORT_KEY[id]), sort === id, () => onSortChange(id)))}
        </View>
      </View>

      {categoryOptions.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel} accessibilityRole="header">
            {t("activity:savedFilters.category")}
          </Text>
          <View style={styles.wrapRow}>
            {categoryOptions.map((option) =>
              pill(option.slug, option.label, categories.includes(option.slug), () =>
                onToggleCategory(option.slug),
              ),
            )}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel} accessibilityRole="header">
          {t("activity:savedFilters.budget")}
        </Text>
        <View style={styles.tierRow}>
          {SAVED_BUDGETS.map((budget) => {
            const selected = budgets.includes(budget);
            const label = budget === "free" ? t("activity:savedFilters.budgetFree") : savedBudgetGlyph(budget);
            return (
              <Pressable
                key={budget}
                onPress={() => {
                  HapticFeedback.light();
                  onToggleBudget(budget);
                }}
                style={({ pressed }) => [styles.tier, selected && styles.selected, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={
                  budget === "free"
                    ? label
                    : t("activity:savedFilters.a11yBudgetLevel", { level: budget })
                }
              >
                <Text style={[styles.tierText, selected && styles.selectedText]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        onPress={() => {
          HapticFeedback.light();
          onToggleOpenNow();
        }}
        style={({ pressed }) => [styles.switchRow, pressed && styles.pressed]}
        accessibilityRole="switch"
        accessibilityState={{ checked: openNow }}
        accessibilityLabel={t("activity:savedFilters.openNow")}
      >
        <Text style={styles.switchLabel} maxFontSizeMultiplier={1.4}>
          {t("activity:savedFilters.openNow")}
        </Text>
        <View style={[styles.track, openNow && styles.trackOn]}>
          <View style={[styles.knob, openNow && styles.knobOn]} />
        </View>
      </Pressable>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  title: {
    color: L.textPrimary,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 18,
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    color: L.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  wrapRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    minHeight: F.sheetChipHeight,
    paddingHorizontal: F.chipPaddingH,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: F.chipBorder,
    backgroundColor: OPAQUE ? F.chipFillOpaque : F.chipFill,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: {
    color: L.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  selected: {
    backgroundColor: F.selectedFill,
    borderColor: F.selectedFill,
  },
  selectedText: {
    color: F.selectedText,
  },
  tierRow: {
    flexDirection: "row",
    gap: 8,
  },
  tier: {
    flex: 1,
    minHeight: F.tierHeight,
    borderRadius: F.tierRadius,
    borderWidth: 1,
    borderColor: F.chipBorder,
    backgroundColor: OPAQUE ? F.chipFillOpaque : F.chipFill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  tierText: {
    color: L.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  switchRow: {
    minHeight: F.switchRowHeight,
    borderRadius: F.fieldRadius,
    borderWidth: 1,
    borderColor: F.fieldBorder,
    backgroundColor: OPAQUE ? F.switchRowFillOpaque : F.switchRowFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    gap: 12,
  },
  switchLabel: {
    flexShrink: 1,
    color: L.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  track: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: OPAQUE ? F.switchTrackOffOpaque : F.switchTrackOff,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  trackOn: {
    backgroundColor: L.accent,
  },
  knob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: F.switchKnob,
  },
  knobOn: {
    alignSelf: "flex-end",
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: F.footerBorder,
    backgroundColor: L.sheet.bg,
  },
  clearButton: {
    minHeight: F.footerButtonHeight,
    paddingHorizontal: 18,
    borderRadius: F.footerButtonRadius,
    borderWidth: 1,
    borderColor: F.clearBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  clearText: {
    color: L.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  showButton: {
    flex: 1,
    minHeight: F.footerButtonHeight,
    borderRadius: F.footerButtonRadius,
    backgroundColor: L.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  showText: {
    color: L.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.8,
  },
});
