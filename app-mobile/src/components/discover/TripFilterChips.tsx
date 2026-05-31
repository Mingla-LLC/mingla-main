/**
 * TripFilterChips — horizontal filter-chip row for Discover > Trips (ORCH-1016).
 *
 * DESIGN Item 3: a sibling of the Events filter bar. Chip order = job priority:
 * where → leaving-from → when → how much → how many → sort. NO intent chip (NG-1).
 * Each chip opens a dark sheet; active chips switch label to the chosen value.
 * Clearing all restores the full set (SC-6).
 *
 * Departure is a SEPARATE chip from destination (I-PROPOSED-DEPARTURE-SEPARATE-
 * FROM-DESTINATION).
 */

import React, { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ORCH-1016 REWORK-4 (FIX B) — the trip filter picker sheets had TYPED fields
// ("Where to", "Leaving from", "Price", "Group") inside a raw RN <Modal> pinned
// to the bottom with NO keyboard avoidance, so the soft keyboard covered the
// field on-device. Mirror the CANONICAL pattern the consumer app already uses
// for input-bearing bottom sheets (CityPickerSheet, ReportUserModal, …):
// BaseBottomSheet + BottomSheetTextInput + keyboardBehavior="interactive" +
// keyboardBlurBehavior="restore" + android_keyboardInputMode="adjustResize" +
// wrapInRNModal. gorhom then lifts the focused field above the keyboard. The
// strict-grep gate (I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER) forbids a
// direct @gorhom import, so BottomSheetTextInput comes from the primitive's
// re-export — exactly like CityPickerSheet.
import {
  BaseBottomSheet,
  BottomSheetTextInput,
} from "../ui/BaseBottomSheet";

import { Icon, type IconName } from "../ui/Icon";
import {
  glass,
  ANDROID_GLASS_USES_OPAQUE_FALLBACK,
} from "../../constants/designSystem";
import type {
  DiscoverTripFilters,
  DiscoverTripSort,
} from "../../services/tripsDiscoveryService";

const g = glass.discover;
const chrome = glass.chrome;
const isAndroidOpaque = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

interface TripFilterChipsProps {
  filters: DiscoverTripFilters;
  onChange: (next: DiscoverTripFilters) => void;
}

type SheetKind = "destination" | "departure" | "dates" | "price" | "group" | "sort" | null;

// ── Date presets ───────────────────────────────────────────────
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function thisMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = startOfDay(now);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}
function nextMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

const SORT_OPTIONS: ReadonlyArray<{ value: DiscoverTripSort; label: string }> = [
  { value: "relevance", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "price_asc", label: "Price (low → high)" },
  { value: "price_desc", label: "Price (high → low)" },
];

const SORT_LABEL: Record<DiscoverTripSort, string> = {
  relevance: "Newest",
  oldest: "Oldest",
  price_asc: "Price ↑",
  price_desc: "Price ↓",
};

// ORCH-1016 REWORK-4 (FIX B) — fixed snap (the filter sheets are short forms;
// 60% leaves the focused field high in the viewport so gorhom's keyboard lift
// keeps it visible). Bespoke dark canvas preserved from the prior raw-modal sheet
// (#181B20 + topRadius 24) via backgroundStyle, mirroring CityPickerSheet.
const SHEET_SNAP_POINTS = ["60%"];
const SHEET_BACKGROUND = {
  backgroundColor: "#181B20",
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
} as const;

interface ChipProps {
  icon: IconName;
  label: string;
  active: boolean;
  onPress: () => void;
}
const Chip: React.FC<ChipProps> = ({ icon, label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`${label} filter`}
    hitSlop={{ top: 8, bottom: 8, left: 0, right: 0 }}
    style={({ pressed }) => [
      styles.chip,
      active && (isAndroidOpaque ? styles.chipActiveOpaque : styles.chipActive),
      pressed && styles.chipPressed,
    ]}
  >
    <Icon
      name={icon}
      size={14}
      color={active ? chrome.active.iconColor : g.chip.inactive.labelColor}
    />
    <Text style={[styles.chipLabel, active && styles.chipLabelActive]} numberOfLines={1}>
      {label}
    </Text>
  </Pressable>
);

export const TripFilterChips: React.FC<TripFilterChipsProps> = ({
  filters,
  onChange,
}) => {
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [draftText, setDraftText] = useState("");
  const [draftMin, setDraftMin] = useState("");
  const [draftMax, setDraftMax] = useState("");

  const openTextSheet = (kind: "destination" | "departure"): void => {
    setDraftText(
      kind === "destination"
        ? (filters.destinationQuery ?? "")
        : (filters.departureQuery ?? ""),
    );
    setSheet(kind);
  };

  const openRangeSheet = (kind: "price" | "group"): void => {
    if (kind === "price") {
      setDraftMin(filters.minPriceCents !== null ? String(filters.minPriceCents / 100) : "");
      setDraftMax(filters.maxPriceCents !== null ? String(filters.maxPriceCents / 100) : "");
    } else {
      setDraftMin(filters.groupSizeMin !== null ? String(filters.groupSizeMin) : "");
      setDraftMax(filters.groupSizeMax !== null ? String(filters.groupSizeMax) : "");
    }
    setSheet(kind);
  };

  const closeSheet = (): void => setSheet(null);

  const applyText = (kind: "destination" | "departure"): void => {
    const value = draftText.trim().length === 0 ? null : draftText.trim();
    onChange(
      kind === "destination"
        ? { ...filters, destinationQuery: value }
        : { ...filters, departureQuery: value },
    );
    closeSheet();
  };

  const applyRange = (kind: "price" | "group"): void => {
    const min = draftMin.trim().length === 0 ? null : Math.max(0, Math.round(parseFloat(draftMin)));
    const max = draftMax.trim().length === 0 ? null : Math.max(0, Math.round(parseFloat(draftMax)));
    if (kind === "price") {
      onChange({
        ...filters,
        minPriceCents: min !== null && Number.isFinite(min) ? min * 100 : null,
        maxPriceCents: max !== null && Number.isFinite(max) ? max * 100 : null,
      });
    } else {
      onChange({
        ...filters,
        groupSizeMin: min !== null && Number.isFinite(min) ? min : null,
        groupSizeMax: max !== null && Number.isFinite(max) ? max : null,
      });
    }
    closeSheet();
  };

  const dateLabel =
    filters.dateFrom !== null || filters.dateTo !== null ? "Dates set" : "Dates";
  const priceLabel =
    filters.minPriceCents !== null || filters.maxPriceCents !== null ? "Price set" : "Price";
  const groupLabel =
    filters.groupSizeMin !== null || filters.groupSizeMax !== null ? "Group set" : "Group";

  return (
    <View style={styles.row}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <Chip
          icon="navigate-outline"
          label={filters.destinationQuery ?? "Where to"}
          active={filters.destinationQuery !== null}
          onPress={() => openTextSheet("destination")}
        />
        <Chip
          icon="paper-plane-outline"
          label={filters.departureQuery ?? "Leaving from"}
          active={filters.departureQuery !== null}
          onPress={() => openTextSheet("departure")}
        />
        <Chip
          icon="calendar-outline"
          label={dateLabel}
          active={filters.dateFrom !== null || filters.dateTo !== null}
          onPress={() => setSheet("dates")}
        />
        <Chip
          icon="pricetag-outline"
          label={priceLabel}
          active={filters.minPriceCents !== null || filters.maxPriceCents !== null}
          onPress={() => openRangeSheet("price")}
        />
        <Chip
          icon="people-outline"
          label={groupLabel}
          active={filters.groupSizeMin !== null || filters.groupSizeMax !== null}
          onPress={() => openRangeSheet("group")}
        />
        <Chip
          icon="options-outline"
          label={`Sort: ${SORT_LABEL[filters.sort]}`}
          active={filters.sort !== "relevance"}
          onPress={() => setSheet("sort")}
        />
      </ScrollView>

      {/* ORCH-1016 REWORK-4 (FIX B) — canonical input-bearing bottom sheet.
          BaseBottomSheet (gorhom) + BottomSheetTextInput so the focused field
          rises above the soft keyboard instead of being covered. wrapInRNModal
          z-stacks above the floating GlassBottomNav (same trap CityPickerSheet
          solved). keyboardBehavior/keyboardBlurBehavior/android_keyboardInputMode
          mirror CityPickerSheet exactly. Body scrolls (scrollMode="scroll") so a
          tall option list + keyboard never strand the Apply button. */}
      <BaseBottomSheet
        visible={sheet !== null}
        onClose={closeSheet}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        wrapInRNModal
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        backgroundStyle={SHEET_BACKGROUND}
        accessibilityLabel="Trip filter"
        scrollMode="scroll"
        scrollProps={{
          keyboardShouldPersistTaps: "handled",
          contentContainerStyle: [
            styles.sheetContent,
            { paddingBottom: insets.bottom + 24 },
          ],
        }}
      >
        {(sheet === "destination" || sheet === "departure") && (
          <>
            <Text style={styles.sheetTitle}>
              {sheet === "destination" ? "Where to?" : "Leaving from?"}
            </Text>
            <BottomSheetTextInput
              value={draftText}
              onChangeText={setDraftText}
              placeholder={sheet === "destination" ? "City or country" : "Your city"}
              placeholderTextColor="rgba(255,255,255,0.4)"
              autoFocus
              style={styles.input}
              returnKeyType="search"
              onSubmitEditing={() => applyText(sheet)}
            />
            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => {
                  setDraftText("");
                  onChange(
                    sheet === "destination"
                      ? { ...filters, destinationQuery: null }
                      : { ...filters, departureQuery: null },
                  );
                  closeSheet();
                }}
                style={styles.clearBtn}
              >
                <Text style={styles.clearBtnText}>Clear</Text>
              </Pressable>
              <Pressable onPress={() => applyText(sheet)} style={styles.applyBtn}>
                <Text style={styles.applyBtnText}>Apply</Text>
              </Pressable>
            </View>
          </>
        )}

        {sheet === "dates" && (
          <>
            <Text style={styles.sheetTitle}>When?</Text>
            {[
              { key: "anytime", label: "Anytime" },
              { key: "this", label: "This month" },
              { key: "next", label: "Next month" },
            ].map((opt) => (
              <Pressable
                key={opt.key}
                style={styles.optionRow}
                onPress={() => {
                  if (opt.key === "anytime") {
                    onChange({ ...filters, dateFrom: null, dateTo: null });
                  } else if (opt.key === "this") {
                    const r = thisMonthRange();
                    onChange({ ...filters, dateFrom: r.from, dateTo: r.to });
                  } else {
                    const r = nextMonthRange();
                    onChange({ ...filters, dateFrom: r.from, dateTo: r.to });
                  }
                  closeSheet();
                }}
              >
                <Text style={styles.optionLabel}>{opt.label}</Text>
              </Pressable>
            ))}
          </>
        )}

        {(sheet === "price" || sheet === "group") && (
          <>
            <Text style={styles.sheetTitle}>
              {sheet === "price" ? "Price range" : "Group size"}
            </Text>
            <View style={styles.rangeRow}>
              <BottomSheetTextInput
                value={draftMin}
                onChangeText={setDraftMin}
                placeholder={sheet === "price" ? "Min $" : "Min"}
                placeholderTextColor="rgba(255,255,255,0.4)"
                keyboardType="number-pad"
                style={[styles.input, styles.rangeInput]}
              />
              <Text style={styles.rangeDash}>–</Text>
              <BottomSheetTextInput
                value={draftMax}
                onChangeText={setDraftMax}
                placeholder={sheet === "price" ? "Max $" : "Max"}
                placeholderTextColor="rgba(255,255,255,0.4)"
                keyboardType="number-pad"
                style={[styles.input, styles.rangeInput]}
              />
            </View>
            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => {
                  setDraftMin("");
                  setDraftMax("");
                  onChange(
                    sheet === "price"
                      ? { ...filters, minPriceCents: null, maxPriceCents: null }
                      : { ...filters, groupSizeMin: null, groupSizeMax: null },
                  );
                  closeSheet();
                }}
                style={styles.clearBtn}
              >
                <Text style={styles.clearBtnText}>Clear</Text>
              </Pressable>
              <Pressable onPress={() => applyRange(sheet)} style={styles.applyBtn}>
                <Text style={styles.applyBtnText}>Apply</Text>
              </Pressable>
            </View>
          </>
        )}

        {sheet === "sort" && (
          <>
            <Text style={styles.sheetTitle}>Sort by</Text>
            {SORT_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={styles.optionRow}
                onPress={() => {
                  onChange({ ...filters, sort: opt.value });
                  closeSheet();
                }}
              >
                <Text style={styles.optionLabel}>{opt.label}</Text>
                {filters.sort === opt.value ? (
                  <Icon name="checkmark-circle-outline" size={18} color="#FF6B35" />
                ) : null}
              </Pressable>
            ))}
          </>
        )}
      </BaseBottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    height: g.filterBar.height,
    justifyContent: "center",
  },
  scrollContent: {
    paddingHorizontal: g.filterBar.paddingHorizontal,
    gap: g.filterBar.chipGap,
    alignItems: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: g.chip.iconLabelGap,
    height: g.chip.height,
    borderRadius: g.chip.radius,
    paddingHorizontal: g.chip.paddingHorizontal,
    backgroundColor: isAndroidOpaque
      ? g.chip.inactive.fallbackSolid
      : g.chip.inactive.bg,
    borderWidth: 1,
    borderColor: g.chip.inactive.border,
  },
  chipActive: {
    backgroundColor: chrome.active.tint,
    borderColor: chrome.active.border,
  },
  chipActiveOpaque: {
    backgroundColor: g.chip.active.fallbackSolid,
    borderColor: chrome.active.border,
  },
  chipPressed: {
    opacity: 0.85,
  },
  chipLabel: {
    fontSize: g.chip.labelFontSize,
    fontWeight: g.chip.labelFontWeight,
    color: g.chip.inactive.labelColor,
    maxWidth: 160,
  },
  chipLabelActive: {
    color: chrome.active.labelColor,
  },
  // ORCH-1016 REWORK-4 (FIX B) — scroll content padding for the BaseBottomSheet
  // body (the backdrop, sheet container, and hand-rolled handle are now owned by
  // BaseBottomSheet; the per-kind body renders inside its scroll host).
  sheetContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 12,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 16,
    color: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  rangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rangeInput: {
    flex: 1,
  },
  rangeDash: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 18,
  },
  sheetActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
  },
  clearBtn: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  clearBtnText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 15,
    fontWeight: "500",
  },
  applyBtn: {
    backgroundColor: "#FF6B35",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  applyBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  optionLabel: {
    fontSize: 16,
    color: "#FFFFFF",
  },
});

export default TripFilterChips;
