/**
 * #4490 P1-9 — add or edit a special day: one date that differs from the
 * weekly hours (closed, or open on its own windows). Also used by "Close a
 * day" (opens with Closed on). Dates are a date picker, times a time picker.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";
import type { HoursWindow, VenueSpecialDay } from "../../../services/venueFeaturesService";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { BrandSwitch } from "../../ui/BrandSwitch";
import { Button } from "../../ui/Button";
import { DayDateField } from "../../ui/DayDateField";
import { Icon } from "../../ui/Icon";
import { Input } from "../../ui/Input";
import { Sheet } from "../../ui/Sheet";
import { PickerSheetHead } from "../../ui/PickerSheetHead";
import { TimeField } from "../../ui/TimeField";
import { closedDayCopy, longDateLabel, specialDayIssue, type SpecialDayDraft } from "./hoursModel";

const LazyConfirmDialog = React.lazy(async () => {
  const mod = await import("../../ui/ConfirmDialog");
  return { default: mod.ConfirmDialog };
});

export type { SpecialDayDraft } from "./hoursModel";

export interface SpecialDaySheetProps {
  visible: boolean;
  /** Editing an existing day; null for a new one. */
  day: VenueSpecialDay | null;
  /** "close" opens a new day with Closed on and asks before saving. */
  mode: "special" | "close";
  today: string;
  saving: boolean;
  error: string | null;
  onSave: (draft: SpecialDayDraft) => void;
  onClear: () => void;
  onClose: () => void;
  /**
   * #4490 D25 — the venue takes table reservations, so a closed day also
   * stops table bookings. Off: the copy says only "closed".
   */
  tableReservationsOn?: boolean;
  /**
   * #4490 P3 (`av-close`) — who is already booked that day, in words (or null
   * when nobody is). Asked before the close confirm so it can say so.
   */
  bookingsOnDay?: (localDate: string) => Promise<string | null>;
}

export function SpecialDaySheet({
  visible,
  day,
  mode,
  today,
  saving,
  error,
  onSave,
  onClear,
  onClose,
  tableReservationsOn = false,
  bookingsOnDay,
}: SpecialDaySheetProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const baseline = useMemo<SpecialDayDraft>(
    () =>
      day !== null
        ? { localDate: day.localDate, isClosed: day.isClosed, windows: day.windows, label: day.label ?? "" }
        : { localDate: "", isClosed: mode === "close", windows: [{ open: "12:00", close: "18:00" }], label: "" },
    [day, mode],
  );
  const [draft, setDraft] = useState<SpecialDayDraft>(baseline);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeNote, setCloseNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!visible) {
      setConfirmClose(false);
      return;
    }
    setDraft(baseline);
    setShowErrors(false);
  }, [baseline, visible]);

  const issue = specialDayIssue(draft, today);
  const dateIssue = issue === "Pick a date." || issue === "Pick today or a later date.";
  const patchWindow = (index: number, patch: Partial<HoursWindow>): void =>
    setDraft((prev) => ({
      ...prev,
      windows: prev.windows.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    }));

  const submit = (): void => {
    setShowErrors(true);
    if (issue !== null) return;
    if (draft.isClosed && (day === null || !day.isClosed)) {
      if (bookingsOnDay === undefined) {
        setCloseNote(null);
        setConfirmClose(true);
        return;
      }
      setChecking(true);
      bookingsOnDay(draft.localDate)
        .then((note) => setCloseNote(note))
        .catch(() => setCloseNote("We couldn't check who is booked that day. Look in Today before you close it."))
        .finally(() => {
          setChecking(false);
          setConfirmClose(true);
        });
      return;
    }
    onSave(draft);
  };

  const heading = day !== null ? longDateLabel(day.localDate) : mode === "close" ? "Close a day" : "Add a special day";

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        if (!saving) onClose();
      }}
      snapPoint={0.85}
      presentation={isWideDesktop ? "panel" : undefined}
      dismissDisabled={saving}
      testID="special-day-sheet"
    >
      <View style={styles.body}>
        <PickerSheetHead title={heading} onClose={() => { if (!saving) onClose(); }} plain={isWideDesktop} testID="special-day-head" />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {day === null ? (
            <DayDateField
              label="Date"
              value={draft.localDate}
              onChangeValue={(localDate) => setDraft((prev) => ({ ...prev, localDate }))}
              accessibilityLabel="Special day date"
              min={today}
              today={today}
              // #4490 D25 — a date problem shows under the date, nowhere else.
              error={showErrors && dateIssue ? issue : null}
              testID="special-day-date"
            />
          ) : null}
          <View style={styles.labelField}>
            <Text style={styles.label}>Name (optional)</Text>
            <Input
              value={draft.label}
              onChangeText={(label) => setDraft((prev) => ({ ...prev, label: label.slice(0, 60) }))}
              placeholder="Like Christmas Day"
              accessibilityLabel="Special day name, optional"
              error={showErrors && issue === "Keep the name to 60 characters." ? issue : null}
              testID="special-day-label"
            />
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Closed all day</Text>
              <Text style={styles.hint}>{closedDayCopy(tableReservationsOn)}</Text>
            </View>
            <BrandSwitch
              value={draft.isClosed}
              onValueChange={(isClosed) => setDraft((prev) => ({ ...prev, isClosed }))}
              accessibilityLabel="Closed all day"
              testID="special-day-closed"
            />
          </View>
          {!draft.isClosed ? (
            <View style={styles.windows}>
              <Text style={styles.label}>Open on this day</Text>
              {draft.windows.map((w, index) => (
                <View key={index} style={styles.windowRow}>
                  <TimeField
                    label="Opens"
                    value={w.open}
                    onChangeValue={(open) => patchWindow(index, { open })}
                    accessibilityLabel={`Window ${index + 1} opening time`}
                    testID={`special-day-window-${index}-open`}
                  />
                  <TimeField
                    label="Closes"
                    value={w.close}
                    onChangeValue={(close) => patchWindow(index, { close })}
                    accessibilityLabel={`Window ${index + 1} closing time`}
                    testID={`special-day-window-${index}-close`}
                  />
                  {draft.windows.length > 1 ? (
                    <Pressable
                      onPress={() =>
                        setDraft((prev) => ({ ...prev, windows: prev.windows.filter((_, i) => i !== index) }))
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Remove window ${index + 1}`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}
                    >
                      <Icon name="trash" size={16} color={color.text2} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {draft.windows.length < 4 ? (
                <Button
                  label="Add a window"
                  variant="secondary"
                  size="sm"
                  leadingIcon="plus"
                  onPress={() =>
                    setDraft((prev) => ({ ...prev, windows: [...prev.windows, { open: "18:00", close: "22:00" }] }))
                  }
                  style={styles.addBtn}
                  testID="special-day-add-window"
                />
              ) : null}
              <Text style={styles.hint}>A close earlier than the open runs past midnight.</Text>
            </View>
          ) : null}
          {showErrors && issue !== null && !dateIssue && issue !== "Keep the name to 60 characters." ? (
            <Text style={styles.error} testID="special-day-issue">{issue}</Text>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          {error !== null ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
          <View style={styles.footerRow}>
            {day !== null ? (
              <Button label="Back to weekly hours" variant="ghost" size="md" onPress={onClear} disabled={saving} testID="special-day-clear" />
            ) : (
              <Button label="Cancel" variant="ghost" size="md" onPress={onClose} disabled={saving} />
            )}
            <Button
              label={draft.isClosed ? "Close the day" : "Save"}
              variant="primary"
              size="md"
              loading={saving || checking}
              onPress={submit}
              testID="special-day-save"
            />
          </View>
        </View>
      </View>
      {confirmClose ? (
        <React.Suspense fallback={null}>
          <LazyConfirmDialog
            visible
            onClose={() => setConfirmClose(false)}
            title={`Close ${longDateLabel(draft.localDate)}?`}
            description={`${
              tableReservationsOn
                ? `${closedDayCopy(true)} Table bookings already made stay booked, so contact those guests if you need to.`
                : closedDayCopy(false)
            }${closeNote !== null ? ` ${closeNote}` : ""}`}
            confirmLabel="Close the day"
            cancelLabel="Keep it open"
            destructive
            confirmLoading={saving}
            onConfirm={() => {
              setConfirmClose(false);
              onSave(draft);
            }}
            testID="special-day-close-confirm"
          />
        </React.Suspense>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2] },
  heading: { ...type.h1, color: color.text1, marginBottom: space[2] },
  scroll: { flex: 1 },
  content: { gap: space[3], paddingBottom: space[6] },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  switchText: { flex: 1, minWidth: 0, gap: 2 },
  switchTitle: { ...type.row, color: color.text1 },
  hint: { ...type.caption, color: color.text3 },
  label: { ...type.small, color: color.text2 },
  windows: { gap: space[2] },
  windowRow: { flexDirection: "row", alignItems: "flex-end", gap: space[2] },
  remove: {
    width: 40,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  removePressed: { backgroundColor: color.fill.inset },
  labelField: { gap: space[1] },
  addBtn: { alignSelf: "flex-start" },
  error: { ...type.caption, color: color.errorText },
  footer: { gap: space[2], paddingTop: space[3], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.line },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2] },
});
