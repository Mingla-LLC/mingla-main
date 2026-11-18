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
import { DateField } from "../../ui/DateField";
import { Input } from "../../ui/Input";
import { Sheet } from "../../ui/Sheet";
import { TimeField } from "../../ui/TimeField";
import { longDateLabel, specialDayIssue, type SpecialDayDraft } from "./hoursModel";

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

  useEffect(() => {
    if (!visible) {
      setConfirmClose(false);
      return;
    }
    setDraft(baseline);
    setShowErrors(false);
  }, [baseline, visible]);

  const issue = specialDayIssue(draft, today);
  const patchWindow = (index: number, patch: Partial<HoursWindow>): void =>
    setDraft((prev) => ({
      ...prev,
      windows: prev.windows.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    }));

  const submit = (): void => {
    setShowErrors(true);
    if (issue !== null) return;
    if (draft.isClosed && (day === null || !day.isClosed)) {
      setConfirmClose(true);
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
        <Text style={styles.heading} accessibilityRole="header">{heading}</Text>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {day === null ? (
            <DateField
              label="Date"
              value={draft.localDate}
              onChangeValue={(localDate) => setDraft((prev) => ({ ...prev, localDate }))}
              accessibilityLabel="Special day date"
              min={today}
              placeholder="Pick a date"
              hasError={showErrors && issue === "Pick a date."}
              testID="special-day-date"
            />
          ) : null}
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Closed all day</Text>
              <Text style={styles.hint}>Guests see you as closed and can&apos;t book a table that day.</Text>
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
                  />
                  <TimeField
                    label="Closes"
                    value={w.close}
                    onChangeValue={(close) => patchWindow(index, { close })}
                    accessibilityLabel={`Window ${index + 1} closing time`}
                  />
                  {draft.windows.length > 1 ? (
                    <Pressable
                      onPress={() =>
                        setDraft((prev) => ({ ...prev, windows: prev.windows.filter((_, i) => i !== index) }))
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Remove window ${index + 1}`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.remove}
                    >
                      <Text style={styles.removeText}>Remove</Text>
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
          <Input
            value={draft.label}
            onChangeText={(label) => setDraft((prev) => ({ ...prev, label: label.slice(0, 60) }))}
            placeholder="Name (optional), like Christmas Day"
            accessibilityLabel="Special day name"
            testID="special-day-label"
          />
          {showErrors && issue !== null ? (
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
              loading={saving}
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
            description="Guests see you as closed and can't book a table that day. Table bookings already made stay booked, so contact those guests if you need to."
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
  remove: { minHeight: 48, justifyContent: "center", paddingHorizontal: space[2], borderRadius: radius.sm },
  removeText: { ...type.small, color: color.text2, fontWeight: "600" },
  addBtn: { alignSelf: "flex-start" },
  error: { ...type.caption, color: color.errorText },
  footer: { gap: space[2], paddingTop: space[3], paddingBottom: space[4], borderTopWidth: 1, borderTopColor: color.line },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space[2] },
});
