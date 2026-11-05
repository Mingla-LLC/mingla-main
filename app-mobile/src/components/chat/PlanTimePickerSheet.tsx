/**
 * Issue #4261 — picking a date and time for a plan.
 *
 * `PlanDateTimeFields` is the date + time pair the plan form, the add-time
 * editor and this dialog share: two 44pt pills that open the native picker
 * (an inline dark spinner with Done on iOS, the system dialog on Android).
 *
 * `PlanTimePickerSheet` is "Lock it in" for a chat plan with no time vote
 * (spec 5.5 #4): a centred dialog (so it also opens over the Matches sheet),
 * the inline "Pick a time in the future." check (Constitution #12: the picked
 * datetime is compared, not today's date), then `plan_lock(p_scheduled_at)`.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import { dateKey, isFutureSlot, slotToDate, timeKey, type PlanFormSlot } from "./planModel";

const PILL_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };

function dateLabel(date: string, locale: string): string | null {
  const at = slotToDate({ date, time: "12:00" });
  if (!at) return null;
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(at);
}

function timeLabel(time: string, locale: string): string {
  const at = slotToDate({ date: "2026-01-01", time });
  return at ? new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(at) : time;
}

export function PlanDateTimeFields({
  value,
  onChange,
  testIDPrefix = "plan-datetime",
}: {
  value: PlanFormSlot;
  onChange: (next: PlanFormSlot) => void;
  testIDPrefix?: string;
}): React.ReactElement {
  const { t, i18n } = useTranslation(["chat", "common"]);
  const [open, setOpen] = useState<"date" | "time" | null>(null);
  const today = useMemo(() => new Date(), []);
  const pickerValue = slotToDate({ date: value.date || dateKey(today), time: value.time || "19:00" }) ?? today;
  const shownDate = value.date ? dateLabel(value.date, i18n.language) : null;

  const apply = (mode: "date" | "time", picked: Date) => {
    onChange(mode === "date" ? { ...value, date: dateKey(picked) } : { ...value, time: timeKey(picked) });
  };
  const onAndroid = (mode: "date" | "time") => (event: DateTimePickerEvent, picked?: Date) => {
    setOpen(null);
    if (event.type === "set" && picked) apply(mode, picked);
  };

  return (
    <View>
      <View style={styles.pills}>
        <TouchableOpacity
          style={[styles.pill, styles.datePill, open === "date" && styles.pillOpen]}
          onPress={() => setOpen((current) => (current === "date" ? null : "date"))}
          hitSlop={PILL_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={shownDate ?? t("chat:plan_when_label")}
          accessibilityState={{ expanded: open === "date" }}
          testID={`${testIDPrefix}-date`}
        >
          <Icon name="calendar-outline" size={16} color={chatTokens.textSecondary} />
          <Text style={[styles.pillText, !shownDate && styles.pillPlaceholder]} numberOfLines={1}>
            {shownDate ?? t("chat:plan_when_label")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pill, styles.timePill, open === "time" && styles.pillOpen]}
          onPress={() => setOpen((current) => (current === "time" ? null : "time"))}
          hitSlop={PILL_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={timeLabel(value.time, i18n.language)}
          accessibilityState={{ expanded: open === "time" }}
          testID={`${testIDPrefix}-time`}
        >
          <Icon name="time-outline" size={16} color={chatTokens.textSecondary} />
          <Text style={styles.pillText} numberOfLines={1}>
            {timeLabel(value.time, i18n.language)}
          </Text>
        </TouchableOpacity>
      </View>
      {open && Platform.OS === "android" ? (
        <DateTimePicker
          value={pickerValue}
          mode={open}
          display="default"
          minimumDate={open === "date" ? today : undefined}
          minuteInterval={open === "time" ? 15 : undefined}
          onChange={onAndroid(open)}
        />
      ) : null}
      {open && Platform.OS !== "android" ? (
        <View style={styles.spinnerWrap}>
          <DateTimePicker
            value={pickerValue}
            mode={open}
            display="spinner"
            themeVariant="dark"
            textColor="#FFFFFF"
            minimumDate={open === "date" ? today : undefined}
            minuteInterval={open === "time" ? 15 : undefined}
            onChange={(_event, picked) => {
              if (picked) apply(open, picked);
            }}
          />
          <TouchableOpacity
            style={styles.spinnerDone}
            onPress={() => {
              if (open === "date" && !value.date) apply("date", pickerValue);
              setOpen(null);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("common:done")}
          >
            <Text style={styles.spinnerDoneText}>{t("common:done")}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

interface PlanTimePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  planTitle: string;
  busy: boolean;
  /** Called with the picked instant (ISO) once it is in the future. */
  onConfirm: (scheduledAtIso: string) => void;
}

export function PlanTimePickerSheet({ visible, onClose, planTitle, busy, onConfirm }: PlanTimePickerSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const [slot, setSlot] = useState<PlanFormSlot>({ date: "", time: "19:00" });
  const [pastError, setPastError] = useState(false);

  useEffect(() => {
    if (visible) {
      setSlot({ date: "", time: "19:00" });
      setPastError(false);
    }
  }, [visible]);

  const confirm = () => {
    if (busy) return;
    if (!slot.date) {
      setPastError(false);
      return;
    }
    if (!isFutureSlot(slot, new Date())) {
      setPastError(true);
      return;
    }
    const at = slotToDate(slot);
    if (at) onConfirm(at.toISOString());
  };

  return (
    <BaseBottomSheet
      variant="center-dialog"
      theme="dark"
      visible={visible}
      onClose={busy ? () => undefined : onClose}
      accessibilityLabel={t("chat:plan_lock_it_in")}
    >
      <View style={styles.dialog} testID="plan-time-picker">
        <Text style={styles.dialogTitle}>{t("chat:plan_lock_it_in")}</Text>
        <Text style={styles.dialogSub} numberOfLines={2}>
          {planTitle}
        </Text>
        <PlanDateTimeFields
          value={slot}
          onChange={(next) => {
            setSlot(next);
            setPastError(false);
          }}
          testIDPrefix="plan-lock"
        />
        {pastError ? <Text style={styles.error}>{t("chat:plan_past_time")}</Text> : null}
        {!slot.date ? <Text style={styles.hint}>{t("chat:plan_pick_date_first")}</Text> : null}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.action, styles.actionGhost]}
            onPress={onClose}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t("chat:plan_form_cancel")}
          >
            <Text style={styles.actionGhostText}>{t("chat:plan_form_cancel")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.action, styles.actionPrimary, (!slot.date || busy) && styles.actionDisabled]}
            onPress={confirm}
            disabled={!slot.date || busy}
            accessibilityRole="button"
            accessibilityLabel={t("chat:plan_lock_it_in")}
            accessibilityState={{ disabled: !slot.date || busy, busy }}
            testID="plan-lock-confirm"
          >
            {busy ? (
              <ActivityIndicator size="small" color={chatTokens.textPrimary} />
            ) : (
              <Text style={styles.actionPrimaryText}>{t("chat:plan_lock_it_in")}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: "row", gap: 8 },
  pill: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: chatTokens.surface,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  datePill: { flex: 1, minWidth: 0 },
  timePill: { minWidth: 108 },
  pillOpen: { borderColor: chatTokens.accent },
  pillText: { color: chatTokens.textPrimary, fontSize: 14, flexShrink: 1 },
  pillPlaceholder: { color: chatTokens.textMuted },
  spinnerWrap: { marginTop: 6, borderRadius: 12, backgroundColor: chatTokens.surface, overflow: "hidden" },
  spinnerDone: { minHeight: 44, alignItems: "center", justifyContent: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: chatTokens.hairline },
  spinnerDoneText: { color: chatTokens.accent, fontSize: 15, fontWeight: "700" },
  dialog: { gap: 12 },
  dialogTitle: { color: chatTokens.textPrimary, fontSize: 17, fontWeight: "700" },
  dialogSub: { color: chatTokens.textSecondary, fontSize: 14 },
  error: { color: chatTokens.danger, fontSize: 13 },
  hint: { color: chatTokens.textSoft, fontSize: 12 },
  actions: { flexDirection: "row", gap: 8 },
  action: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionGhost: { borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.14)" },
  actionGhostText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  actionPrimary: { backgroundColor: chatTokens.accent },
  actionPrimaryText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "700" },
  actionDisabled: { opacity: 0.5 },
});
