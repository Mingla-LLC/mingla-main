/** Four-filter control for Discover > Stays. Issue #1423. */

import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
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

import type {
  DiscoverStayFilters,
  StayConfirmationMode,
  StayPropertyKind,
} from "../../services/staysDiscoveryService";
import {
  ANDROID_GLASS_USES_OPAQUE_FALLBACK,
  glass,
} from "../../constants/designSystem";
import { BaseBottomSheet, BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { Icon, type IconName } from "../ui/Icon";

type SheetKind = "destination" | "dates" | "guests" | "filters" | null;
type DateField = "checkIn" | "checkOut" | null;
export type StayFilterField = Exclude<SheetKind, null> | "clear";

interface Props {
  filters: DiscoverStayFilters;
  onChange: (next: DiscoverStayFilters, field: StayFilterField) => void;
}

const PROPERTY_OPTIONS: readonly { value: StayPropertyKind; label: string }[] = [
  { value: "hotel", label: "Hotel" },
  { value: "resort", label: "Resort" },
  { value: "guest_house", label: "Guest house" },
  { value: "lodge", label: "Lodge" },
  { value: "serviced_apartment", label: "Serviced apartment" },
  { value: "short_stay_apartment", label: "Short-stay apartment" },
  { value: "other", label: "Other" },
];
const AMENITY_OPTIONS = ["Wi-Fi", "Pool", "Breakfast", "Parking", "Gym", "Spa"] as const;
const SHEET_SNAP_POINTS = ["72%"];
const SHEET_BACKGROUND = {
  backgroundColor: "#181B20",
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
} as const;

function ymd(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseYmd(value: string | null, fallback: Date): Date {
  if (value === null) return fallback;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return fallback;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function shortDate(value: string | null): string {
  if (value === null) return "Choose";
  return parseYmd(value, new Date()).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

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
    accessibilityState={{ selected: active }}
    style={({ pressed }) => [
      styles.chip,
      active && styles.chipActive,
      pressed && styles.pressed,
    ]}
  >
    <Icon
      name={icon}
      size={14}
      color={active ? glass.chrome.active.iconColor : glass.discover.chip.inactive.labelColor}
    />
    <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
      {label}
    </Text>
  </Pressable>
);

const Choice: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
}> = ({ label, selected, onPress }) => (
  <Pressable
    accessibilityRole="checkbox"
    accessibilityState={{ checked: selected }}
    onPress={onPress}
    style={[styles.choice, selected && styles.choiceSelected]}
  >
    <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
  </Pressable>
);

const Stepper: React.FC<{
  label: string;
  hint: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
}> = ({ label, hint, value, minimum, maximum, onChange }) => (
  <View style={styles.stepperRow}>
    <View style={styles.stepperCopy}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Text style={styles.stepperHint}>{hint}</Text>
    </View>
    <View style={styles.stepperControls}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove one ${label.toLowerCase()}`}
        accessibilityState={{ disabled: value <= minimum }}
        disabled={value <= minimum}
        onPress={() => onChange(value - 1)}
        style={[styles.stepperButton, value <= minimum && styles.disabled]}
      >
        <Icon name="remove" size={18} color="#FFFFFF" />
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add one ${label.toLowerCase()}`}
        accessibilityState={{ disabled: value >= maximum }}
        disabled={value >= maximum}
        onPress={() => onChange(value + 1)}
        style={[styles.stepperButton, value >= maximum && styles.disabled]}
      >
        <Icon name="add" size={18} color="#FFFFFF" />
      </Pressable>
    </View>
  </View>
);

export const StayFilterChips: React.FC<Props> = ({ filters, onChange }) => {
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [draft, setDraft] = useState<DiscoverStayFilters>(filters);
  const [dateField, setDateField] = useState<DateField>(null);

  const open = (next: Exclude<SheetKind, null>): void => {
    setDraft(filters);
    setDateField(null);
    setSheet(next);
  };
  const close = (): void => {
    setDateField(null);
    setSheet(null);
  };
  const apply = (): void => {
    if (sheet === null) return;
    onChange(draft, sheet);
    close();
  };

  const onDateChange = (event: DateTimePickerEvent, selected?: Date): void => {
    if (Platform.OS === "android") setDateField(null);
    if (event.type === "dismissed" || selected === undefined || dateField === null) return;
    const value = ymd(selected);
    if (dateField === "checkIn") {
      setDraft((current) => ({
        ...current,
        checkIn: value,
        checkOut:
          current.checkOut !== null && current.checkOut > value ? current.checkOut : null,
      }));
    } else {
      setDraft((current) => ({ ...current, checkOut: value }));
    }
  };

  const today = new Date();
  const checkInDate = parseYmd(draft.checkIn, today);
  const tomorrow = new Date(checkInDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateLabel = filters.checkIn && filters.checkOut
    ? `${shortDate(filters.checkIn)} – ${shortDate(filters.checkOut)}`
    : "Dates";
  const guestLabel = `${filters.adults + filters.children} guest${
    filters.adults + filters.children === 1 ? "" : "s"
  }, ${filters.rooms} room${filters.rooms === 1 ? "" : "s"}`;
  const extraCount =
    filters.propertyKinds.length + filters.amenities.length +
    (filters.confirmationMode === null ? 0 : 1);

  return (
    <View style={styles.root}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <Chip
          icon="location-outline"
          label={filters.destinationQuery ?? "Destination"}
          active={filters.destinationQuery !== null}
          onPress={() => open("destination")}
        />
        <Chip
          icon="calendar-outline"
          label={dateLabel}
          active={filters.checkIn !== null}
          onPress={() => open("dates")}
        />
        <Chip
          icon="people-outline"
          label={guestLabel}
          active={filters.adults !== 2 || filters.children !== 0 || filters.rooms !== 1}
          onPress={() => open("guests")}
        />
        <Chip
          icon="options-outline"
          label={extraCount > 0 ? `Filters · ${extraCount}` : "Filters"}
          active={extraCount > 0}
          onPress={() => open("filters")}
        />
      </ScrollView>

      <BaseBottomSheet
        visible={sheet !== null}
        onClose={close}
        theme="dark"
        snapPoints={SHEET_SNAP_POINTS}
        wrapInRNModal
        keyboardBehavior="interactive"
        keyboardBlurBehavior="restore"
        android_keyboardInputMode="adjustResize"
        backgroundStyle={SHEET_BACKGROUND}
        accessibilityLabel="Stay filter"
        scrollMode="scroll"
        scrollProps={{
          keyboardShouldPersistTaps: "handled",
          contentContainerStyle: [
            styles.sheetContent,
            { paddingBottom: insets.bottom + 24 },
          ],
        }}
      >
        {sheet === "destination" ? (
          <>
            <Text style={styles.sheetTitle}>Where do you want to stay?</Text>
            <Text style={styles.sheetBody}>Search a property, city, area, or country.</Text>
            <BottomSheetTextInput
              value={draft.destinationQuery ?? ""}
              onChangeText={(value) =>
                setDraft((current) => ({ ...current, destinationQuery: value }))
              }
              placeholder="e.g. Lagos, Ikoyi, Cape Town"
              placeholderTextColor="rgba(255,255,255,0.35)"
              maxLength={120}
              autoCorrect={false}
              returnKeyType="search"
              style={styles.input}
            />
          </>
        ) : null}

        {sheet === "dates" ? (
          <>
            <Text style={styles.sheetTitle}>Choose your dates</Text>
            <Text style={styles.sheetBody}>Availability is checked across every room and night.</Text>
            <View style={styles.dateRow}>
              <Pressable style={styles.dateField} onPress={() => setDateField("checkIn")}>
                <Text style={styles.fieldEyebrow}>CHECK-IN</Text>
                <Text style={styles.fieldValue}>{shortDate(draft.checkIn)}</Text>
              </Pressable>
              <Pressable
                style={styles.dateField}
                onPress={() => setDateField("checkOut")}
                disabled={draft.checkIn === null}
              >
                <Text style={styles.fieldEyebrow}>CHECKOUT</Text>
                <Text style={[styles.fieldValue, draft.checkIn === null && styles.disabledText]}>
                  {shortDate(draft.checkOut)}
                </Text>
              </Pressable>
            </View>
            {dateField !== null ? (
              <DateTimePicker
                value={dateField === "checkIn" ? checkInDate : parseYmd(draft.checkOut, tomorrow)}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                minimumDate={dateField === "checkIn" ? today : tomorrow}
                onChange={onDateChange}
                themeVariant="dark"
              />
            ) : null}
            {draft.checkIn !== null ? (
              <Pressable
                onPress={() => setDraft((current) => ({ ...current, checkIn: null, checkOut: null }))}
                style={styles.clearInline}
              >
                <Text style={styles.clearInlineText}>Clear dates</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {sheet === "guests" ? (
          <>
            <Text style={styles.sheetTitle}>Guests & rooms</Text>
            <Text style={styles.sheetBody}>Book more than one room in the same reservation.</Text>
            <Stepper
              label="Adults"
              hint="Age 18+"
              value={draft.adults}
              minimum={1}
              maximum={20}
              onChange={(adults) => setDraft((current) => ({ ...current, adults }))}
            />
            <Stepper
              label="Children"
              hint="Age 0–17"
              value={draft.children}
              minimum={0}
              maximum={20}
              onChange={(children) => setDraft((current) => ({ ...current, children }))}
            />
            <Stepper
              label="Rooms"
              hint="Up to 10 rooms"
              value={draft.rooms}
              minimum={1}
              maximum={10}
              onChange={(rooms) => setDraft((current) => ({ ...current, rooms }))}
            />
          </>
        ) : null}

        {sheet === "filters" ? (
          <>
            <Text style={styles.sheetTitle}>Stay filters</Text>
            <Text style={styles.sectionTitle}>Property type</Text>
            <View style={styles.choiceWrap}>
              {PROPERTY_OPTIONS.map((option) => (
                <Choice
                  key={option.value}
                  label={option.label}
                  selected={draft.propertyKinds.includes(option.value)}
                  onPress={() => setDraft((current) => ({
                    ...current,
                    propertyKinds: current.propertyKinds.includes(option.value)
                      ? current.propertyKinds.filter((value) => value !== option.value)
                      : [...current.propertyKinds, option.value],
                  }))}
                />
              ))}
            </View>
            <Text style={styles.sectionTitle}>Amenities</Text>
            <View style={styles.choiceWrap}>
              {AMENITY_OPTIONS.map((amenity) => (
                <Choice
                  key={amenity}
                  label={amenity}
                  selected={draft.amenities.includes(amenity)}
                  onPress={() => setDraft((current) => ({
                    ...current,
                    amenities: current.amenities.includes(amenity)
                      ? current.amenities.filter((value) => value !== amenity)
                      : [...current.amenities, amenity],
                  }))}
                />
              ))}
            </View>
            <Text style={styles.sectionTitle}>Confirmation</Text>
            <View style={styles.choiceWrap}>
              {([
                ["instant", "Instant booking"],
                ["request", "Request to book"],
              ] as const).map(([value, label]) => (
                <Choice
                  key={value}
                  label={label}
                  selected={draft.confirmationMode === value}
                  onPress={() => setDraft((current) => ({
                    ...current,
                    confirmationMode:
                      current.confirmationMode === value
                        ? null
                        : (value as StayConfirmationMode),
                  }))}
                />
              ))}
            </View>
          </>
        ) : null}

        <Pressable style={styles.applyButton} onPress={apply}>
          <Text style={styles.applyText}>Show stays</Text>
        </Pressable>
      </BaseBottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { width: "100%" },
  chipRow: { paddingHorizontal: glass.discover.grid.horizontalPadding, gap: 8 },
  chip: {
    minHeight: 38,
    maxWidth: 190,
    paddingHorizontal: 13,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: ANDROID_GLASS_USES_OPAQUE_FALLBACK
      ? "#24272D"
      : "rgba(255,255,255,0.08)",
  },
  chipActive: {
    borderColor: glass.chrome.active.border,
    backgroundColor: ANDROID_GLASS_USES_OPAQUE_FALLBACK
      ? "#7A351D"
      : glass.chrome.active.tint,
  },
  chipText: { color: glass.discover.chip.inactive.labelColor, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: glass.chrome.active.labelColor },
  pressed: { opacity: 0.72 },
  sheetContent: { paddingHorizontal: 20, paddingTop: 10, gap: 14 },
  sheetTitle: { color: "#FFFFFF", fontSize: 22, fontWeight: "800" },
  sheetBody: { color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.07)",
    color: "#FFFFFF",
    paddingHorizontal: 14,
    fontSize: 16,
  },
  dateRow: { flexDirection: "row", gap: 10 },
  dateField: {
    flex: 1,
    minHeight: 64,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.06)",
    gap: 5,
  },
  fieldEyebrow: { color: "rgba(255,255,255,0.48)", fontSize: 11, fontWeight: "700" },
  fieldValue: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  disabledText: { color: "rgba(255,255,255,0.28)" },
  clearInline: { alignSelf: "flex-start", paddingVertical: 6 },
  clearInlineText: { color: "#FF9C78", fontSize: 14, fontWeight: "600" },
  stepperRow: {
    minHeight: 68,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  stepperCopy: { gap: 3 },
  stepperLabel: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  stepperHint: { color: "rgba(255,255,255,0.5)", fontSize: 12 },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: 13 },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: { minWidth: 22, color: "#FFFFFF", fontSize: 16, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.28 },
  sectionTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "700", marginTop: 6 },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  choiceSelected: { borderColor: glass.chrome.active.border, backgroundColor: glass.chrome.active.tint },
  choiceText: { color: "rgba(255,255,255,0.72)", fontSize: 13, fontWeight: "600" },
  choiceTextSelected: { color: "#FFFFFF" },
  applyButton: {
    minHeight: 50,
    borderRadius: 25,
    backgroundColor: "#FF6B35",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  applyText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
});
