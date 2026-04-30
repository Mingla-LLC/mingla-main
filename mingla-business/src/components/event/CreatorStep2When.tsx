/**
 * Wizard Step 2 — When.
 *
 * Designer source: screens-creator.jsx lines 106-126 (CreatorStep2).
 * Date + door-open + ends-at + timezone. Recurrence is locked to "Once"
 * in Cycle 3; Sheet shows the muscle-memory affordance with footer
 * caption "More repeat options coming Cycle 4." (TRANS-CYCLE-3-5).
 *
 * DateTimePicker (@react-native-community/datetimepicker 8.4.4) drives
 * date + time fields. On iOS the picker renders inline below the
 * triggering row with a Done button; on Android the picker is a native
 * dialog that auto-dismisses on dismiss/select.
 *
 * Per Cycle 3 spec §3.9 Step 2.
 */

import React, { useCallback, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import {
  formatTimezoneLabel,
  formatTimezoneOffset,
  getAllTimezones,
} from "../../utils/timezones";

import { errorForKey, type StepBodyProps } from "./types";

type PickerMode = "date" | "doorsOpen" | "endsAt" | null;

const formatDateLabel = (iso: string | null): string => {
  if (iso === null) return "Pick a date";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const d = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
  );
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const isoFromDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const hhmmFromDate = (d: Date): string => {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

const dateFromIso = (iso: string | null): Date => {
  if (iso === null) return new Date();
  const parts = iso.split("-");
  if (parts.length !== 3) return new Date();
  return new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
  );
};

const isDateToday = (iso: string): boolean => {
  const parts = iso.split("-");
  if (parts.length !== 3) return false;
  const target = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
  );
  const now = new Date();
  return (
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate()
  );
};

const dateFromHhmm = (hhmm: string | null): Date => {
  const d = new Date();
  if (hhmm === null) {
    d.setHours(21, 0, 0, 0);
    return d;
  }
  const parts = hhmm.split(":");
  d.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
  return d;
};

export const CreatorStep2When: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
}) => {
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  // iOS-only: holds the spinner's currently displayed value so Done
  // can commit it even when the user didn't spin. iOS spinner only
  // fires `onChange` on actual value change — opening the picker and
  // tapping Done without spinning would otherwise leave the draft
  // field null. (Bug surfaced 2026-04-30 smoke retest.)
  const [tempPickerValue, setTempPickerValue] = useState<Date | null>(null);
  const [repeatsSheetVisible, setRepeatsSheetVisible] = useState<boolean>(false);
  const [tzSheetVisible, setTzSheetVisible] = useState<boolean>(false);
  const [tzSearchQuery, setTzSearchQuery] = useState<string>("");

  // Full IANA list — Intl.supportedValuesOf("timeZone") on Hermes; ~400
  // zones globally. Fallback list of ~60 common zones if runtime can't
  // enumerate. Sorted alphabetically. Memoised so cache hit is free.
  const allTimezones = useMemo(() => getAllTimezones(), []);

  const filteredTimezones = useMemo<string[]>(() => {
    const q = tzSearchQuery.trim().toLowerCase();
    if (q.length === 0) return allTimezones;
    return allTimezones.filter((tz) => tz.toLowerCase().includes(q));
  }, [allTimezones, tzSearchQuery]);

  const dateError = showErrors ? errorForKey(errors, "date") : undefined;
  const doorsError = showErrors ? errorForKey(errors, "doorsOpen") : undefined;
  const endsError = showErrors ? errorForKey(errors, "endsAt") : undefined;

  const commitPickerValue = useCallback(
    (mode: PickerMode, d: Date): void => {
      if (mode === "date") {
        updateDraft({ date: isoFromDate(d) });
      } else if (mode === "doorsOpen") {
        updateDraft({ doorsOpen: hhmmFromDate(d) });
      } else if (mode === "endsAt") {
        updateDraft({ endsAt: hhmmFromDate(d) });
      }
    },
    [updateDraft],
  );

  const handleOpenPicker = useCallback(
    (mode: PickerMode): void => {
      // Initialise the temp value from the current draft field (or a
      // sensible default if the field is null) so Done-without-spinning
      // commits something meaningful.
      let initial: Date;
      if (mode === "date") initial = dateFromIso(draft.date);
      else if (mode === "doorsOpen") initial = dateFromHhmm(draft.doorsOpen);
      else if (mode === "endsAt") initial = dateFromHhmm(draft.endsAt);
      else initial = new Date();
      setTempPickerValue(initial);
      setPickerMode(mode);
    },
    [draft.date, draft.doorsOpen, draft.endsAt],
  );

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date): void => {
      if (Platform.OS === "android") {
        // Native dialog auto-dismisses on selection. Commit immediately.
        setPickerMode(null);
        if (event.type === "dismissed" || selected === undefined) return;
        commitPickerValue(pickerMode, selected);
        return;
      }
      // iOS: spinner stays open until Done. Just track the temp value;
      // commit happens in handleClosePicker.
      if (selected !== undefined) {
        setTempPickerValue(selected);
      }
    },
    [pickerMode, commitPickerValue],
  );

  const handleClosePicker = useCallback((): void => {
    // iOS Done: commit whatever the spinner currently shows (the user
    // may have spun it OR may have just tapped Done with the default
    // visible — either way, that value is what they want).
    if (Platform.OS === "ios" && tempPickerValue !== null && pickerMode !== null) {
      commitPickerValue(pickerMode, tempPickerValue);
    }
    setPickerMode(null);
    setTempPickerValue(null);
  }, [pickerMode, tempPickerValue, commitPickerValue]);

  const handleSelectTimezone = useCallback(
    (tz: string): void => {
      updateDraft({ timezone: tz });
      setTzSheetVisible(false);
    },
    [updateDraft],
  );

  const tzLabel = formatTimezoneLabel(draft.timezone);

  // Compute the picker's minimumDate based on context:
  //   - Date mode: today (no past dates)
  //   - Doors mode + event date is today: now (no past times)
  //   - Doors mode + future date: no minimum (any time of day)
  //   - Ends mode: must be after doorsOpen (otherwise duration <= 0).
  //     If doors not yet set, no minimum.
  const pickerMinimumDate = useMemo<Date | undefined>(() => {
    if (pickerMode === null) return undefined;
    if (pickerMode === "date") return new Date();
    if (pickerMode === "doorsOpen") {
      if (draft.date !== null && isDateToday(draft.date)) return new Date();
      return undefined;
    }
    if (pickerMode === "endsAt" && draft.doorsOpen !== null) {
      // Build a Date with today's date + doorsOpen time. The picker
      // only enforces the time-of-day component for mode="time", so
      // this works as the minimum end time.
      const min = new Date();
      const parts = draft.doorsOpen.split(":");
      const h = Number(parts[0]) || 0;
      const m = Number(parts[1]) || 0;
      // Add 1 minute so end strictly after doors.
      min.setHours(h, m + 1, 0, 0);
      return min;
    }
    return undefined;
  }, [pickerMode, draft.date, draft.doorsOpen]);

  // Live duration display — between Doors open and Ends. If Ends rolls
  // over to the next day (e.g. 21:00 → 03:00), add 24h to keep duration
  // positive. Format as "5h" or "5h 30m" or "30m".
  const durationLabel = useMemo<string | null>(() => {
    if (draft.doorsOpen === null || draft.endsAt === null) return null;
    const dParts = draft.doorsOpen.split(":");
    const eParts = draft.endsAt.split(":");
    const dMins = (Number(dParts[0]) || 0) * 60 + (Number(dParts[1]) || 0);
    const eMins = (Number(eParts[0]) || 0) * 60 + (Number(eParts[1]) || 0);
    let mins = eMins - dMins;
    if (mins <= 0) mins += 24 * 60; // overnight rollover
    if (mins === 0) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m event`;
    if (m === 0) return `${h}h event`;
    return `${h}h ${m}m event`;
  }, [draft.doorsOpen, draft.endsAt]);

  return (
    <View>
      {/* Repeats */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Repeats</Text>
        <Pressable
          onPress={() => setRepeatsSheetVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Repeats: Once"
          style={styles.pickerRow}
        >
          <Text style={styles.pickerValue}>Once</Text>
          <Icon name="chevD" size={16} color={textTokens.tertiary} />
        </Pressable>
      </View>

      {/* Date */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Date</Text>
        <Pressable
          onPress={() => handleOpenPicker("date")}
          accessibilityRole="button"
          accessibilityLabel="Pick event date"
          style={[styles.pickerRow, dateError !== undefined && styles.inputError]}
        >
          <Text
            style={
              draft.date !== null ? styles.pickerValue : styles.pickerPlaceholder
            }
          >
            {formatDateLabel(draft.date)}
          </Text>
          <Icon name="calendar" size={16} color={textTokens.tertiary} />
        </Pressable>
        {dateError !== undefined ? (
          <Text style={styles.helperError}>{dateError}</Text>
        ) : null}
      </View>

      {/* Doors open + Ends + live duration */}
      <View style={styles.timeRow}>
        <View style={styles.timeCell}>
          <Text style={styles.fieldLabel}>Doors open</Text>
          <Pressable
            onPress={() => handleOpenPicker("doorsOpen")}
            accessibilityRole="button"
            accessibilityLabel="Pick door-open time"
            style={[
              styles.pickerRow,
              doorsError !== undefined && styles.inputError,
            ]}
          >
            <Text
              style={
                draft.doorsOpen !== null
                  ? styles.pickerValue
                  : styles.pickerPlaceholder
              }
            >
              {draft.doorsOpen ?? "21:00"}
            </Text>
          </Pressable>
          {doorsError !== undefined ? (
            <Text style={styles.helperError}>{doorsError}</Text>
          ) : null}
        </View>
        <View style={styles.timeCell}>
          <Text style={styles.fieldLabel}>Ends</Text>
          <Pressable
            onPress={() => handleOpenPicker("endsAt")}
            accessibilityRole="button"
            accessibilityLabel="Pick end time"
            style={[
              styles.pickerRow,
              endsError !== undefined && styles.inputError,
            ]}
          >
            <Text
              style={
                draft.endsAt !== null
                  ? styles.pickerValue
                  : styles.pickerPlaceholder
              }
            >
              {draft.endsAt ?? "03:00"}
            </Text>
          </Pressable>
          {endsError !== undefined ? (
            <Text style={styles.helperError}>{endsError}</Text>
          ) : null}
        </View>
      </View>

      {/* Live duration display — helps the founder confirm the event
          length matches their intent. Hidden until both times are set. */}
      {durationLabel !== null ? (
        <View style={styles.durationRow}>
          <Icon name="clock" size={14} color={accent.warm} />
          <Text style={styles.durationLabel}>{durationLabel}</Text>
        </View>
      ) : null}

      {/* Timezone */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Timezone</Text>
        <Pressable
          onPress={() => setTzSheetVisible(true)}
          accessibilityRole="button"
          accessibilityLabel={`Timezone: ${tzLabel}`}
          style={styles.pickerRow}
        >
          <Text style={styles.pickerValue}>{tzLabel}</Text>
          <Icon name="chevD" size={16} color={textTokens.tertiary} />
        </Pressable>
        <Text style={styles.helperHint}>
          We'll show this to guests in their local time.
        </Text>
      </View>

      {/* Date/time picker UX — Platform-split.
          iOS: wrap in Sheet (snap=peek) at screen-bottom with Done
               button. Inline rendering breaks because the picker
               appears below the ScrollView contents — off-screen for
               the user (smoke regression v1).
          Android: render the picker bare; it's a native dialog that
                   auto-dismisses on selection (handlePickerChange
                   already calls setPickerMode(null) on Android). */}
      {Platform.OS === "ios" ? (
        <Sheet
          visible={pickerMode !== null}
          onClose={handleClosePicker}
          snapPoint="half"
        >
          <View style={styles.iosPickerSheet}>
            <View style={styles.iosPickerDoneRow}>
              <Button
                label="Done"
                variant="primary"
                size="md"
                onPress={handleClosePicker}
              />
            </View>
            {pickerMode !== null && tempPickerValue !== null ? (
              <View style={styles.iosPickerWrap}>
                <DateTimePicker
                  value={tempPickerValue}
                  mode={pickerMode === "date" ? "date" : "time"}
                  display="spinner"
                  onChange={handlePickerChange}
                  minimumDate={pickerMinimumDate}
                  is24Hour
                  // iOS-only: dark spinner text + theme so it reads on
                  // our glass dark surface (default is light/black text).
                  textColor="#FFFFFF"
                  themeVariant="dark"
                  style={styles.iosPicker}
                />
              </View>
            ) : null}
          </View>
        </Sheet>
      ) : pickerMode !== null ? (
        <DateTimePicker
          value={
            pickerMode === "date"
              ? dateFromIso(draft.date)
              : pickerMode === "doorsOpen"
                ? dateFromHhmm(draft.doorsOpen)
                : dateFromHhmm(draft.endsAt)
          }
          mode={pickerMode === "date" ? "date" : "time"}
          display="default"
          onChange={handlePickerChange}
          minimumDate={pickerMinimumDate}
          is24Hour
        />
      ) : null}

      {/* Repeats sheet */}
      <Sheet
        visible={repeatsSheetVisible}
        onClose={() => setRepeatsSheetVisible(false)}
        snapPoint="peek"
      >
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text style={styles.sheetTitle}>Repeats</Text>
          <Pressable
            onPress={() => setRepeatsSheetVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Once (selected)"
            style={[styles.categoryRow, styles.categoryRowActive]}
          >
            <Text style={[styles.categoryRowLabel, styles.categoryRowLabelActive]}>
              Once
            </Text>
            <Icon name="check" size={18} color={accent.warm} />
          </Pressable>
          <Text style={styles.sheetFooterCaption}>
            More repeat options coming Cycle 4.
          </Text>
        </ScrollView>
      </Sheet>

      {/* Timezone sheet — full IANA list with search.
          Empty search shows all ~400 zones (or ~60 fallback) sorted
          alphabetically. ScrollView render is acceptable for ~400
          Pressable rows on modern devices; if perf becomes an issue,
          virtualize via FlatList. */}
      <Sheet
        visible={tzSheetVisible}
        onClose={() => {
          setTzSheetVisible(false);
          setTzSearchQuery("");
        }}
        snapPoint="full"
      >
        <View style={styles.tzSheetWrap}>
          <Text style={styles.sheetTitle}>Timezone</Text>
          <View style={styles.tzSearchWrap}>
            <Input
              variant="search"
              value={tzSearchQuery}
              onChangeText={setTzSearchQuery}
              placeholder="Search timezones…"
              accessibilityLabel="Search timezones"
              clearable
            />
          </View>
          <ScrollView
            contentContainerStyle={styles.tzListContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {filteredTimezones.length === 0 ? (
              <Text style={styles.tzEmptyHint}>
                No timezones match "{tzSearchQuery}".
              </Text>
            ) : (
              filteredTimezones.map((tz) => {
                const active = draft.timezone === tz;
                const offset = formatTimezoneOffset(tz);
                return (
                  <Pressable
                    key={tz}
                    onPress={() => {
                      handleSelectTimezone(tz);
                      setTzSearchQuery("");
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${tz}${offset.length > 0 ? ` ${offset}` : ""}${active ? " (selected)" : ""}`}
                    style={[styles.tzRow, active && styles.tzRowActive]}
                  >
                    <View style={styles.tzRowTextCol}>
                      <Text
                        style={[
                          styles.tzRowLabel,
                          active && styles.tzRowLabelActive,
                        ]}
                        numberOfLines={1}
                      >
                        {tz}
                      </Text>
                      {offset.length > 0 ? (
                        <Text style={styles.tzRowOffset}>{offset}</Text>
                      ) : null}
                    </View>
                    {active ? (
                      <Icon name="check" size={18} color={accent.warm} />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </Sheet>
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  helperHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  inputError: {
    borderColor: semantic.error,
    borderWidth: 1,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  pickerValue: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  pickerPlaceholder: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.tertiary,
  },
  timeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  timeCell: {
    flex: 1,
  },
  durationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md,
  },
  durationLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: accent.warm,
    fontWeight: "500",
  },
  iosPickerSheet: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  iosPickerDoneRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: spacing.xs,
  },
  iosPickerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iosPicker: {
    width: "100%",
  },

  // Sheet --------------------------------------------------------------
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  sheetTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.md,
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    marginBottom: spacing.xs,
  },
  categoryRowActive: {
    backgroundColor: accent.tint,
  },
  categoryRowLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  categoryRowLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  sheetFooterCaption: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
    marginTop: spacing.md,
  },

  // Timezone full-list sheet ------------------------------------------
  tzSheetWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  tzSearchWrap: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  tzListContent: {
    paddingBottom: spacing.xl,
  },
  tzRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    marginBottom: 2,
  },
  tzRowActive: {
    backgroundColor: accent.tint,
  },
  tzRowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  tzRowLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.primary,
  },
  tzRowLabelActive: {
    fontWeight: "600",
  },
  tzRowOffset: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  tzEmptyHint: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
});
