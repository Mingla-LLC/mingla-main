/**
 * Wizard Step 2 — When (Cycle 4 expansion).
 *
 * 3-mode segmented control replaces the Cycle 3 "Repeats: Once"
 * placeholder per Constitution #8 (subtract before adding):
 *   - Single        → existing date/doors/ends body
 *   - Recurring     → first-occurrence date + doors/ends + preset + termination
 *   - Multi-date    → list builder (2..24 dates) + per-date overrides
 *
 * Timezone is always shared across modes (rendered once at the bottom).
 *
 * Per-date override editor lives in MultiDateOverrideSheet (also opened
 * from PreviewEventView's accordion per Q-5 user steering).
 *
 * No auto-snap on day-of-week mismatch (D-FOR-CYCLE4-5 user-revised) —
 * validator pushes `recurrence.dayMismatch`; user fixes manually.
 *
 * Per Cycle 4 spec §3.5.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import {
  type DraftEvent,
  type MultiDateEntry,
  type MultiDateOverrides,
  type RecurrencePreset,
  type RecurrenceRule,
  type SetPos,
  type Weekday,
  type WhenMode,
} from "../../store/draftEventStore";
import { generateDraftId } from "../../utils/draftEventId";
import {
  formatRecurrenceLabel,
  formatTermination,
  formatDayOfMonth,
  weekdayOfIso,
} from "../../utils/recurrenceRule";
import { formatLongDate } from "../../utils/eventDateDisplay";
import {
  formatTimezoneLabel,
  formatTimezoneOffset,
  getAllTimezones,
} from "../../utils/timezones";

import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";

import {
  MultiDateOverrideSheet,
  type MultiDateOverrideSavePatch,
} from "./MultiDateOverrideSheet";
import { errorForKey, type StepBodyProps } from "./types";

type PickerMode = "date" | "doorsOpen" | "endsAt" | "untilDate" | null;

// ---- Date/time helpers (component-local, simple) --------------------

// Thin wrapper around the I-14 helper that adds the "Pick a date"
// placeholder path. ISO formatting itself goes through the helper —
// no local duplication.
const formatDateRowLabel = (iso: string | null): string =>
  iso === null ? "Pick a date" : formatLongDate(iso);

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

const dateFromHhmm = (hhmm: string | null, fallback: string): Date => {
  const d = new Date();
  const src = hhmm ?? fallback;
  const parts = src.split(":");
  d.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
  return d;
};

const sortMultiDates = (entries: MultiDateEntry[]): MultiDateEntry[] => {
  return [...entries].sort((a, b) => {
    const aKey = `${a.date}T${a.startTime}`;
    const bKey = `${b.date}T${b.startTime}`;
    return aKey.localeCompare(bKey);
  });
};

const blankOverrides: MultiDateOverrides = {
  title: null,
  description: null,
  venueName: null,
  address: null,
  onlineUrl: null,
};

// Hidden HTML5 inputs for web picker triggering. Positioned absolutely
// with opacity 0 — NOT display:none (display:none breaks showPicker()
// and .click()). Triggered programmatically from row Pressables via
// inputRef.current.showPicker() (with .click() fallback).
const HIDDEN_WEB_INPUT_STYLE = {
  position: "absolute",
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: "none",
} as const;

const WEEKDAY_OPTS: ReadonlyArray<{ id: Weekday; label: string; short: string }> = [
  { id: "MO", label: "Monday", short: "Mon" },
  { id: "TU", label: "Tuesday", short: "Tue" },
  { id: "WE", label: "Wednesday", short: "Wed" },
  { id: "TH", label: "Thursday", short: "Thu" },
  { id: "FR", label: "Friday", short: "Fri" },
  { id: "SA", label: "Saturday", short: "Sat" },
  { id: "SU", label: "Sunday", short: "Sun" },
];

const SETPOS_OPTS: ReadonlyArray<{ id: SetPos; label: string }> = [
  { id: 1, label: "1st" },
  { id: 2, label: "2nd" },
  { id: 3, label: "3rd" },
  { id: 4, label: "4th" },
  { id: -1, label: "Last" },
];

const PRESET_OPTS: ReadonlyArray<{ id: RecurrencePreset; label: string; sub: string }> = [
  { id: "daily", label: "Daily", sub: "Every day" },
  { id: "weekly", label: "Weekly", sub: "Every week on the same day" },
  { id: "biweekly", label: "Every 2 weeks", sub: "Every other week" },
  { id: "monthly_dom", label: "Monthly (by day)", sub: "Same day-of-month every month" },
  { id: "monthly_dow", label: "Monthly (by weekday)", sub: "e.g. 1st Monday of each month" },
];

// ---- Main component -------------------------------------------------

export const CreatorStep2When: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
}) => {
  // ---- Picker state (date + time + termination-until) ----
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [tempPickerValue, setTempPickerValue] = useState<Date | null>(null);

  // ---- Web hidden input refs (one per main picker mode).
  // Tap row → handleOpenPicker(mode) on web triggers refs[mode].showPicker()
  // (with .click() fallback). Browser opens native picker directly — no Sheet,
  // no Done button. Inputs render at component bottom in the JSX. ----
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const doorsOpenInputRef = useRef<HTMLInputElement | null>(null);
  const endsAtInputRef = useRef<HTMLInputElement | null>(null);
  const untilDateInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Web hidden input refs for AddDateSheet inner pickers ----
  const addDateInputRef = useRef<HTMLInputElement | null>(null);
  const addDateStartInputRef = useRef<HTMLInputElement | null>(null);
  const addDateEndInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Sheet visibilities ----
  const [tzSheetVisible, setTzSheetVisible] = useState<boolean>(false);
  const [tzSearchQuery, setTzSearchQuery] = useState<string>("");
  const [presetSheetVisible, setPresetSheetVisible] = useState<boolean>(false);
  const [terminationSheetVisible, setTerminationSheetVisible] = useState<boolean>(false);
  const [addDateSheetVisible, setAddDateSheetVisible] = useState<boolean>(false);
  const [overrideSheetEntryId, setOverrideSheetEntryId] = useState<string | null>(null);

  // ---- AddDateSheet local state ----
  const [addDateValue, setAddDateValue] = useState<string | null>(null);
  const [addDateStartTime, setAddDateStartTime] = useState<string>("21:00");
  const [addDateEndTime, setAddDateEndTime] = useState<string>("03:00");
  const [addDateError, setAddDateError] = useState<string | null>(null);
  const [addDatePickerMode, setAddDatePickerMode] =
    useState<"date" | "start" | "end" | null>(null);
  const [addDateTempValue, setAddDateTempValue] = useState<Date | null>(null);

  // ---- Mode-switch confirm ----
  const [pendingMode, setPendingMode] = useState<WhenMode | null>(null);

  // ---- Multi-date row delete confirm ----
  const [pendingDeleteEntryId, setPendingDeleteEntryId] = useState<string | null>(null);

  // ---- Errors ----
  const dateError = showErrors ? errorForKey(errors, "date") : undefined;
  const doorsError = showErrors ? errorForKey(errors, "doorsOpen") : undefined;
  const endsError = showErrors ? errorForKey(errors, "endsAt") : undefined;
  const recurrenceError = showErrors ? errorForKey(errors, "recurrence") : undefined;
  const recurrenceByDayError = showErrors ? errorForKey(errors, "recurrence.byDay") : undefined;
  const recurrenceByMonthDayError = showErrors ? errorForKey(errors, "recurrence.byMonthDay") : undefined;
  const recurrenceBySetPosError = showErrors ? errorForKey(errors, "recurrence.bySetPos") : undefined;
  const recurrenceCountError = showErrors ? errorForKey(errors, "recurrence.count") : undefined;
  const recurrenceUntilError = showErrors ? errorForKey(errors, "recurrence.until") : undefined;
  const dayMismatchError = showErrors ? errorForKey(errors, "recurrence.dayMismatch") : undefined;
  const multiMinError = showErrors ? errorForKey(errors, "multiDates.minCount") : undefined;
  const multiMaxError = showErrors ? errorForKey(errors, "multiDates.maxCount") : undefined;

  // ---- Timezone list ----
  const allTimezones = useMemo(() => getAllTimezones(), []);
  const filteredTimezones = useMemo<string[]>(() => {
    const q = tzSearchQuery.trim().toLowerCase();
    if (q.length === 0) return allTimezones;
    return allTimezones.filter((tz) => tz.toLowerCase().includes(q));
  }, [allTimezones, tzSearchQuery]);
  const tzLabel = formatTimezoneLabel(draft.timezone);

  // ---- Picker handlers ----

  const commitPickerValue = useCallback(
    (mode: PickerMode, d: Date): void => {
      if (mode === "date") {
        updateDraft({ date: isoFromDate(d) });
      } else if (mode === "doorsOpen") {
        updateDraft({ doorsOpen: hhmmFromDate(d) });
      } else if (mode === "endsAt") {
        updateDraft({ endsAt: hhmmFromDate(d) });
      } else if (mode === "untilDate" && draft.recurrenceRule !== null) {
        updateDraft({
          recurrenceRule: {
            ...draft.recurrenceRule,
            termination: { kind: "until", until: isoFromDate(d) },
          },
        });
      }
    },
    [updateDraft, draft.recurrenceRule],
  );

  const handleOpenPicker = useCallback(
    (mode: PickerMode): void => {
      // Web: trigger the hidden HTML5 input directly. Browser opens its
      // native picker — no Sheet, no Done button. Selection commits via
      // the input's onChange (renders below).
      if (Platform.OS === "web") {
        let ref: React.RefObject<HTMLInputElement | null> | null = null;
        if (mode === "date") ref = dateInputRef;
        else if (mode === "doorsOpen") ref = doorsOpenInputRef;
        else if (mode === "endsAt") ref = endsAtInputRef;
        else if (mode === "untilDate") ref = untilDateInputRef;
        const el = ref?.current;
        if (el !== null && el !== undefined) {
          if (typeof el.showPicker === "function") {
            try {
              el.showPicker();
            } catch {
              el.click();
            }
          } else {
            el.click();
          }
        }
        return;
      }
      // Native (iOS/Android): existing Sheet+spinner / dialog flow.
      let initial: Date;
      if (mode === "date") initial = dateFromIso(draft.date);
      else if (mode === "doorsOpen") initial = dateFromHhmm(draft.doorsOpen, "21:00");
      else if (mode === "endsAt") initial = dateFromHhmm(draft.endsAt, "03:00");
      else if (mode === "untilDate") {
        const untilIso =
          draft.recurrenceRule?.termination.kind === "until"
            ? draft.recurrenceRule.termination.until
            : null;
        initial = untilIso !== null ? dateFromIso(untilIso) : new Date();
      } else initial = new Date();
      setTempPickerValue(initial);
      setPickerMode(mode);
    },
    [draft.date, draft.doorsOpen, draft.endsAt, draft.recurrenceRule],
  );

  const handlePickerChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date): void => {
      if (Platform.OS === "android") {
        setPickerMode(null);
        if (event.type === "dismissed" || selected === undefined) return;
        commitPickerValue(pickerMode, selected);
        return;
      }
      if (selected !== undefined) {
        setTempPickerValue(selected);
      }
    },
    [pickerMode, commitPickerValue],
  );

  const handleClosePicker = useCallback((): void => {
    // Done button commits the Sheet's temp value on iOS + Web (both use
    // a Sheet wrap with explicit Done). Android commits per-tap inline
    // and never reaches this handler with a pending temp value.
    if (
      Platform.OS !== "android" &&
      tempPickerValue !== null &&
      pickerMode !== null
    ) {
      commitPickerValue(pickerMode, tempPickerValue);
    }
    setPickerMode(null);
    setTempPickerValue(null);
  }, [pickerMode, tempPickerValue, commitPickerValue]);

  const pickerMinimumDate = useMemo<Date | undefined>(() => {
    if (pickerMode === null) return undefined;
    if (pickerMode === "date") return new Date();
    if (pickerMode === "untilDate") {
      // until must be > first occurrence
      if (draft.date !== null) {
        const firstDay = dateFromIso(draft.date);
        firstDay.setDate(firstDay.getDate() + 1);
        return firstDay;
      }
      return new Date();
    }
    if (pickerMode === "doorsOpen") {
      if (draft.date !== null && isDateToday(draft.date)) return new Date();
      return undefined;
    }
    if (pickerMode === "endsAt" && draft.doorsOpen !== null) {
      const min = new Date();
      const parts = draft.doorsOpen.split(":");
      const h = Number(parts[0]) || 0;
      const m = Number(parts[1]) || 0;
      min.setHours(h, m + 1, 0, 0);
      return min;
    }
    return undefined;
  }, [pickerMode, draft.date, draft.doorsOpen]);

  const durationLabel = useMemo<string | null>(() => {
    if (draft.doorsOpen === null || draft.endsAt === null) return null;
    const dParts = draft.doorsOpen.split(":");
    const eParts = draft.endsAt.split(":");
    const dMins = (Number(dParts[0]) || 0) * 60 + (Number(dParts[1]) || 0);
    const eMins = (Number(eParts[0]) || 0) * 60 + (Number(eParts[1]) || 0);
    let mins = eMins - dMins;
    if (mins <= 0) mins += 24 * 60;
    if (mins === 0) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m event`;
    if (m === 0) return `${h}h event`;
    return `${h}h ${m}m event`;
  }, [draft.doorsOpen, draft.endsAt]);

  // ---- Mode switching ----
  // applyModeSwitch is the SINGLE entry point that touches whenMode.
  // Never set whenMode directly elsewhere — confirm-on-loss + data
  // preservation logic lives only here.

  const applyModeSwitch = useCallback(
    (from: WhenMode, to: WhenMode): void => {
      if (from === to) return;

      const patch: Partial<DraftEvent> = { whenMode: to };

      if (from === "single" && to === "recurring") {
        const dow: Weekday = draft.date !== null ? weekdayOfIso(draft.date) : "MO";
        patch.recurrenceRule = {
          preset: "weekly",
          byDay: dow,
          termination: { kind: "count", count: 4 },
        };
        patch.multiDates = null;
      } else if (from === "single" && to === "multi_date") {
        if (draft.date !== null) {
          patch.multiDates = [
            {
              id: generateDraftId(),
              date: draft.date,
              startTime: draft.doorsOpen ?? "21:00",
              endTime: draft.endsAt ?? "03:00",
              overrides: { ...blankOverrides },
            },
          ];
        } else {
          patch.multiDates = [];
        }
        patch.recurrenceRule = null;
      } else if (from === "recurring" && to === "single") {
        patch.recurrenceRule = null;
        patch.multiDates = null;
      } else if (from === "recurring" && to === "multi_date") {
        if (draft.date !== null) {
          patch.multiDates = [
            {
              id: generateDraftId(),
              date: draft.date,
              startTime: draft.doorsOpen ?? "21:00",
              endTime: draft.endsAt ?? "03:00",
              overrides: { ...blankOverrides },
            },
          ];
        } else {
          patch.multiDates = [];
        }
        patch.recurrenceRule = null;
      } else if (from === "multi_date" && to === "single") {
        const first = draft.multiDates?.[0];
        if (first !== undefined) {
          patch.date = first.date;
          patch.doorsOpen = first.startTime;
          patch.endsAt = first.endTime;
        }
        patch.recurrenceRule = null;
        patch.multiDates = null;
      } else if (from === "multi_date" && to === "recurring") {
        const first = draft.multiDates?.[0];
        if (first !== undefined) {
          patch.date = first.date;
          patch.doorsOpen = first.startTime;
          patch.endsAt = first.endTime;
          const dow: Weekday = weekdayOfIso(first.date);
          patch.recurrenceRule = {
            preset: "weekly",
            byDay: dow,
            termination: { kind: "count", count: 4 },
          };
        } else {
          patch.recurrenceRule = {
            preset: "weekly",
            byDay: "MO",
            termination: { kind: "count", count: 4 },
          };
        }
        patch.multiDates = null;
      }
      updateDraft(patch);
    },
    [draft, updateDraft],
  );

  const handleModeSwitch = useCallback(
    (target: WhenMode): void => {
      if (target === draft.whenMode) return;

      const isLossy =
        draft.whenMode === "multi_date" &&
        (draft.multiDates?.length ?? 0) > 1 &&
        (target === "single" || target === "recurring");

      if (isLossy) {
        setPendingMode(target);
        return;
      }
      applyModeSwitch(draft.whenMode, target);
    },
    [draft, applyModeSwitch],
  );

  // ---- Recurrence handlers ----

  const handleSelectPreset = useCallback(
    (preset: RecurrencePreset): void => {
      const current = draft.recurrenceRule;
      // Default sensible params per preset
      let byDay: Weekday | undefined =
        current?.byDay ??
        (draft.date !== null ? weekdayOfIso(draft.date) : "MO");
      let byMonthDay: number | undefined = current?.byMonthDay;
      let bySetPos: SetPos | undefined = current?.bySetPos;
      if (preset === "monthly_dom") {
        byDay = undefined;
        byMonthDay = byMonthDay ?? Math.min(28, dateFromIso(draft.date).getDate());
        bySetPos = undefined;
      } else if (preset === "monthly_dow") {
        bySetPos = bySetPos ?? 1;
        byMonthDay = undefined;
      } else if (preset === "daily") {
        byDay = undefined;
        byMonthDay = undefined;
        bySetPos = undefined;
      } else {
        byMonthDay = undefined;
        bySetPos = undefined;
      }
      updateDraft({
        recurrenceRule: {
          preset,
          byDay,
          byMonthDay,
          bySetPos,
          termination: current?.termination ?? { kind: "count", count: 4 },
        },
      });
    },
    [draft.recurrenceRule, draft.date, updateDraft],
  );

  const handleSelectByDay = useCallback(
    (w: Weekday): void => {
      if (draft.recurrenceRule === null) return;
      updateDraft({
        recurrenceRule: { ...draft.recurrenceRule, byDay: w },
      });
    },
    [draft.recurrenceRule, updateDraft],
  );

  const handleSelectByMonthDay = useCallback(
    (n: number): void => {
      if (draft.recurrenceRule === null) return;
      updateDraft({
        recurrenceRule: { ...draft.recurrenceRule, byMonthDay: n },
      });
    },
    [draft.recurrenceRule, updateDraft],
  );

  const handleSelectBySetPos = useCallback(
    (p: SetPos): void => {
      if (draft.recurrenceRule === null) return;
      updateDraft({
        recurrenceRule: { ...draft.recurrenceRule, bySetPos: p },
      });
    },
    [draft.recurrenceRule, updateDraft],
  );

  const handleSetCount = useCallback(
    (n: number): void => {
      if (draft.recurrenceRule === null) return;
      updateDraft({
        recurrenceRule: {
          ...draft.recurrenceRule,
          termination: { kind: "count", count: n },
        },
      });
    },
    [draft.recurrenceRule, updateDraft],
  );

  const handleTerminationKindToggle = useCallback(
    (kind: "count" | "until"): void => {
      if (draft.recurrenceRule === null) return;
      if (draft.recurrenceRule.termination.kind === kind) return;
      const next: RecurrenceRule = { ...draft.recurrenceRule };
      if (kind === "count") {
        next.termination = { kind: "count", count: 4 };
      } else {
        // Default until = first occurrence + 30 days
        const start =
          draft.date !== null ? dateFromIso(draft.date) : new Date();
        const until = new Date(start);
        until.setDate(until.getDate() + 30);
        next.termination = { kind: "until", until: isoFromDate(until) };
      }
      updateDraft({ recurrenceRule: next });
    },
    [draft.recurrenceRule, draft.date, updateDraft],
  );

  // ---- Multi-date handlers ----

  const handleOpenAddDateSheet = useCallback((): void => {
    // Default start/end = first row's, or sensible fallback
    const first = draft.multiDates?.[0];
    setAddDateValue(null);
    setAddDateStartTime(first?.startTime ?? draft.doorsOpen ?? "21:00");
    setAddDateEndTime(first?.endTime ?? draft.endsAt ?? "03:00");
    setAddDateError(null);
    setAddDateSheetVisible(true);
  }, [draft.multiDates, draft.doorsOpen, draft.endsAt]);

  const handleConfirmAddDate = useCallback((): void => {
    if (addDateValue === null) {
      setAddDateError("Pick a date.");
      return;
    }
    // No past dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dateFromIso(addDateValue) < today) {
      setAddDateError("Can't add past dates.");
      return;
    }
    // No duplicate date+startTime
    const existing = draft.multiDates ?? [];
    const dupKey = `${addDateValue}T${addDateStartTime}`;
    if (
      existing.some((e) => `${e.date}T${e.startTime}` === dupKey)
    ) {
      setAddDateError("Already added that date+time.");
      return;
    }
    if (existing.length >= 24) {
      setAddDateError("Maximum is 24 dates.");
      return;
    }
    const newEntry: MultiDateEntry = {
      id: generateDraftId(),
      date: addDateValue,
      startTime: addDateStartTime,
      endTime: addDateEndTime,
      overrides: { ...blankOverrides },
    };
    updateDraft({
      multiDates: sortMultiDates([...existing, newEntry]),
    });
    setAddDateSheetVisible(false);
  }, [addDateValue, addDateStartTime, addDateEndTime, draft.multiDates, updateDraft]);

  const handleDeleteMultiDate = useCallback(
    (entryId: string): void => {
      const existing = draft.multiDates ?? [];
      if (existing.length <= 2) {
        // Will be caught by toast in dispatch — orchestrator UX
        // requires we show a clear message to the user.
        setPendingDeleteEntryId(null);
        return;
      }
      updateDraft({
        multiDates: existing.filter((e) => e.id !== entryId),
      });
      setPendingDeleteEntryId(null);
    },
    [draft.multiDates, updateDraft],
  );

  const handleSaveOverride = useCallback(
    (patch: MultiDateOverrideSavePatch): void => {
      if (overrideSheetEntryId === null) return;
      const existing = draft.multiDates ?? [];
      // Auto-sort after the patch — startTime change can re-order rows.
      const next = existing.map((e) =>
        e.id === overrideSheetEntryId
          ? {
              ...e,
              startTime: patch.startTime,
              endTime: patch.endTime,
              overrides: patch.overrides,
            }
          : e,
      );
      updateDraft({ multiDates: sortMultiDates(next) });
      setOverrideSheetEntryId(null);
    },
    [overrideSheetEntryId, draft.multiDates, updateDraft],
  );

  // ---- AddDateSheet picker handlers (separate from main pickers) ----

  const handleAddDateOpenPicker = useCallback(
    (mode: "date" | "start" | "end"): void => {
      // Web: trigger hidden HTML5 input directly (no Sheet wrap).
      if (Platform.OS === "web") {
        const ref =
          mode === "date"
            ? addDateInputRef
            : mode === "start"
              ? addDateStartInputRef
              : addDateEndInputRef;
        const el = ref.current;
        if (el !== null) {
          if (typeof el.showPicker === "function") {
            try {
              el.showPicker();
            } catch {
              el.click();
            }
          } else {
            el.click();
          }
        }
        return;
      }
      // Native: existing Sheet/dialog flow.
      let initial: Date;
      if (mode === "date") {
        initial = addDateValue !== null ? dateFromIso(addDateValue) : new Date();
      } else if (mode === "start") {
        initial = dateFromHhmm(addDateStartTime, "21:00");
      } else {
        initial = dateFromHhmm(addDateEndTime, "03:00");
      }
      setAddDateTempValue(initial);
      setAddDatePickerMode(mode);
    },
    [addDateValue, addDateStartTime, addDateEndTime],
  );

  const handleAddDatePickerChange = useCallback(
    (event: DateTimePickerEvent, selected?: Date): void => {
      if (Platform.OS === "android") {
        const mode = addDatePickerMode;
        setAddDatePickerMode(null);
        if (event.type === "dismissed" || selected === undefined) return;
        if (mode === "date") setAddDateValue(isoFromDate(selected));
        else if (mode === "start") setAddDateStartTime(hhmmFromDate(selected));
        else if (mode === "end") setAddDateEndTime(hhmmFromDate(selected));
        return;
      }
      if (selected !== undefined) setAddDateTempValue(selected);
    },
    [addDatePickerMode],
  );

  const handleAddDateClosePicker = useCallback((): void => {
    // iOS + Web both Done-commit; Android commits inline via per-change.
    if (
      Platform.OS !== "android" &&
      addDateTempValue !== null &&
      addDatePickerMode !== null
    ) {
      if (addDatePickerMode === "date") {
        setAddDateValue(isoFromDate(addDateTempValue));
      } else if (addDatePickerMode === "start") {
        setAddDateStartTime(hhmmFromDate(addDateTempValue));
      } else if (addDatePickerMode === "end") {
        setAddDateEndTime(hhmmFromDate(addDateTempValue));
      }
    }
    setAddDatePickerMode(null);
    setAddDateTempValue(null);
  }, [addDatePickerMode, addDateTempValue]);

  // ---- Resolve override sheet's entry ----

  const overrideEntry: MultiDateEntry | null =
    overrideSheetEntryId === null
      ? null
      : (draft.multiDates ?? []).find((e) => e.id === overrideSheetEntryId) ?? null;
  const overrideEntryIndex: number =
    overrideSheetEntryId === null
      ? 0
      : (draft.multiDates ?? []).findIndex((e) => e.id === overrideSheetEntryId);

  // ---- Date Pressable label per mode ----
  const dateRowLabel =
    draft.whenMode === "recurring"
      ? "First occurrence"
      : "Date";

  // ---- Render ----

  return (
    <View>
      {/* 3-mode segmented control (replaces Cycle 3 Repeats sheet) */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>How often does this event happen?</Text>
        <View style={styles.segmentRow}>
          <SegmentPill
            label="Single"
            active={draft.whenMode === "single"}
            onPress={() => handleModeSwitch("single")}
          />
          <SegmentPill
            label="Recurring"
            active={draft.whenMode === "recurring"}
            onPress={() => handleModeSwitch("recurring")}
          />
          <SegmentPill
            label="Multi-date"
            active={draft.whenMode === "multi_date"}
            onPress={() => handleModeSwitch("multi_date")}
          />
        </View>
      </View>

      {/* Mode body */}
      {draft.whenMode === "single" || draft.whenMode === "recurring" ? (
        <>
          {/* Date row (= event date OR first occurrence) */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{dateRowLabel}</Text>
            <Pressable
              onPress={() => handleOpenPicker("date")}
              accessibilityRole="button"
              accessibilityLabel={`Pick ${dateRowLabel.toLowerCase()}`}
              style={[
                styles.pickerRow,
                (dateError !== undefined || dayMismatchError !== undefined) &&
                  styles.inputError,
              ]}
            >
              <Text
                style={
                  draft.date !== null
                    ? styles.pickerValue
                    : styles.pickerPlaceholder
                }
              >
                {formatDateRowLabel(draft.date)}
              </Text>
              <Icon name="calendar" size={16} color={textTokens.tertiary} />
            </Pressable>
            {dateError !== undefined ? (
              <Text style={styles.helperError}>{dateError}</Text>
            ) : null}
            {dayMismatchError !== undefined ? (
              <Text style={styles.helperError}>{dayMismatchError}</Text>
            ) : null}
          </View>

          {/* Doors + Ends */}
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

          {durationLabel !== null ? (
            <View style={styles.durationRow}>
              <Icon name="clock" size={14} color={accent.warm} />
              <Text style={styles.durationLabel}>{durationLabel}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {/* Recurring extra rows */}
      {draft.whenMode === "recurring" ? (
        <>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Repeat pattern</Text>
            <Pressable
              onPress={() => setPresetSheetVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Pick repeat pattern"
              style={[
                styles.pickerRow,
                (recurrenceError !== undefined ||
                  recurrenceByDayError !== undefined ||
                  recurrenceByMonthDayError !== undefined ||
                  recurrenceBySetPosError !== undefined) &&
                  styles.inputError,
              ]}
            >
              <Text
                style={
                  draft.recurrenceRule !== null
                    ? styles.pickerValue
                    : styles.pickerPlaceholder
                }
              >
                {draft.recurrenceRule !== null && draft.date !== null
                  ? formatRecurrenceLabel(draft.recurrenceRule, draft.date)
                  : "Pick a pattern"}
              </Text>
              <Icon name="chevD" size={16} color={textTokens.tertiary} />
            </Pressable>
            {recurrenceError !== undefined ? (
              <Text style={styles.helperError}>{recurrenceError}</Text>
            ) : null}
            {recurrenceByDayError !== undefined ? (
              <Text style={styles.helperError}>{recurrenceByDayError}</Text>
            ) : null}
            {recurrenceByMonthDayError !== undefined ? (
              <Text style={styles.helperError}>{recurrenceByMonthDayError}</Text>
            ) : null}
            {recurrenceBySetPosError !== undefined ? (
              <Text style={styles.helperError}>{recurrenceBySetPosError}</Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Ends</Text>
            <Pressable
              onPress={() => setTerminationSheetVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Pick recurrence end"
              style={[
                styles.pickerRow,
                (recurrenceCountError !== undefined ||
                  recurrenceUntilError !== undefined) &&
                  styles.inputError,
              ]}
            >
              <Text style={styles.pickerValue}>
                {draft.recurrenceRule !== null
                  ? formatTermination(draft.recurrenceRule)
                  : "4 occurrences"}
              </Text>
              <Icon name="chevD" size={16} color={textTokens.tertiary} />
            </Pressable>
            {recurrenceCountError !== undefined ? (
              <Text style={styles.helperError}>{recurrenceCountError}</Text>
            ) : null}
            {recurrenceUntilError !== undefined ? (
              <Text style={styles.helperError}>{recurrenceUntilError}</Text>
            ) : null}
            <Text style={styles.helperHint}>
              Recurring events must end. Up to 52 occurrences or 1 year out.
            </Text>
          </View>
        </>
      ) : null}

      {/* Multi-date body */}
      {draft.whenMode === "multi_date" ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Dates</Text>
          {(draft.multiDates ?? []).length === 0 ? (
            <View style={styles.multiDateEmpty}>
              <Text style={styles.multiDateEmptyText}>
                No dates yet. Tap "+ Add date" to start.
              </Text>
            </View>
          ) : (
            <View style={styles.multiDateList}>
              {(draft.multiDates ?? []).map((entry, idx) => (
                <View key={entry.id} style={styles.multiDateRow}>
                  <View style={styles.multiDateTextCol}>
                    <Text style={styles.multiDateRowTitle}>
                      {formatDateRowLabel(entry.date)}
                    </Text>
                    <Text style={styles.multiDateRowSub}>
                      {entry.startTime} → {entry.endTime}
                      {entry.overrides.title !== null
                        ? ` · "${entry.overrides.title}"`
                        : ""}
                    </Text>
                  </View>
                  <View style={styles.multiDateActionsRow}>
                    <Pressable
                      onPress={() => setOverrideSheetEntryId(entry.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit date ${idx + 1}`}
                      hitSlop={8}
                      style={styles.multiDateActionBtn}
                    >
                      <Icon name="edit" size={16} color={textTokens.tertiary} />
                    </Pressable>
                    <Pressable
                      onPress={() => setPendingDeleteEntryId(entry.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete date ${idx + 1}`}
                      hitSlop={8}
                      style={styles.multiDateActionBtn}
                    >
                      <Icon name="trash" size={16} color={semantic.error} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
          <Pressable
            onPress={handleOpenAddDateSheet}
            accessibilityRole="button"
            accessibilityLabel="Add date"
            style={styles.addDateBtn}
          >
            <Icon name="plus" size={16} color={accent.warm} />
            <Text style={styles.addDateLabel}>Add date</Text>
          </Pressable>
          <Text style={styles.helperHint}>
            {(draft.multiDates ?? []).length} of 24 dates · need at least 2 to publish.
          </Text>
          {multiMinError !== undefined ? (
            <Text style={styles.helperError}>{multiMinError}</Text>
          ) : null}
          {multiMaxError !== undefined ? (
            <Text style={styles.helperError}>{multiMaxError}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Timezone (shared across all modes) */}
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

      {/* Date/time picker — iOS Sheet wrap, Android native dialog.
          Web is handled via hidden HTML5 inputs at the bottom of this
          render — handleOpenPicker triggers them on web and returns early
          before reaching this Sheet/dialog flow. */}
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
                  mode={pickerMode === "date" || pickerMode === "untilDate" ? "date" : "time"}
                  display="spinner"
                  onChange={handlePickerChange}
                  minimumDate={pickerMinimumDate}
                  is24Hour
                  textColor="#FFFFFF"
                  themeVariant="dark"
                  style={styles.iosPicker}
                />
              </View>
            ) : null}
          </View>
        </Sheet>
      ) : Platform.OS === "android" && pickerMode !== null ? (
        <DateTimePicker
          value={
            pickerMode === "date"
              ? dateFromIso(draft.date)
              : pickerMode === "untilDate"
                ? draft.recurrenceRule?.termination.kind === "until"
                  ? dateFromIso(draft.recurrenceRule.termination.until)
                  : new Date()
                : pickerMode === "doorsOpen"
                  ? dateFromHhmm(draft.doorsOpen, "21:00")
                  : dateFromHhmm(draft.endsAt, "03:00")
          }
          mode={pickerMode === "date" || pickerMode === "untilDate" ? "date" : "time"}
          display="default"
          onChange={handlePickerChange}
          minimumDate={pickerMinimumDate}
          is24Hour
        />
      ) : null}

      {/* Hidden HTML5 inputs for web direct-tap pickers. Triggered by
          handleOpenPicker via showPicker()/.click() on row tap. The
          inputs render in the DOM with opacity 0 (NOT display:none —
          that would break programmatic triggering). Selection commits
          via onChange directly through commitPickerValue. No Sheet,
          no Done button on web. */}
      {Platform.OS === "web" ? (
        <>
          <input
            ref={dateInputRef}
            type="date"
            value={draft.date ?? ""}
            min={isoFromDate(new Date())}
            onChange={(e) => {
              const v = (e.target as unknown as { value: string }).value;
              if (v.length === 0) return;
              const [y, m, d] = v.split("-").map(Number);
              commitPickerValue("date", new Date(y, m - 1, d, 0, 0, 0, 0));
            }}
            aria-label="Event date"
            style={HIDDEN_WEB_INPUT_STYLE}
          />
          <input
            ref={doorsOpenInputRef}
            type="time"
            value={draft.doorsOpen ?? ""}
            onChange={(e) => {
              const v = (e.target as unknown as { value: string }).value;
              if (v.length === 0) return;
              const [h, mm] = v.split(":").map(Number);
              const next = new Date();
              next.setHours(h, mm, 0, 0);
              commitPickerValue("doorsOpen", next);
            }}
            aria-label="Doors open time"
            style={HIDDEN_WEB_INPUT_STYLE}
          />
          <input
            ref={endsAtInputRef}
            type="time"
            value={draft.endsAt ?? ""}
            onChange={(e) => {
              const v = (e.target as unknown as { value: string }).value;
              if (v.length === 0) return;
              const [h, mm] = v.split(":").map(Number);
              const next = new Date();
              next.setHours(h, mm, 0, 0);
              commitPickerValue("endsAt", next);
            }}
            aria-label="Event end time"
            style={HIDDEN_WEB_INPUT_STYLE}
          />
          <input
            ref={untilDateInputRef}
            type="date"
            value={
              draft.recurrenceRule?.termination.kind === "until"
                ? draft.recurrenceRule.termination.until
                : ""
            }
            min={
              draft.date !== null
                ? (() => {
                    const firstDay = dateFromIso(draft.date);
                    firstDay.setDate(firstDay.getDate() + 1);
                    return isoFromDate(firstDay);
                  })()
                : isoFromDate(new Date())
            }
            onChange={(e) => {
              const v = (e.target as unknown as { value: string }).value;
              if (v.length === 0) return;
              const [y, m, d] = v.split("-").map(Number);
              commitPickerValue("untilDate", new Date(y, m - 1, d, 0, 0, 0, 0));
            }}
            aria-label="Recurrence until date"
            style={HIDDEN_WEB_INPUT_STYLE}
          />
        </>
      ) : null}

      {/* Recurrence preset sheet */}
      <Sheet
        visible={presetSheetVisible}
        onClose={() => setPresetSheetVisible(false)}
        snapPoint="full"
      >
        <ScrollView
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sheetTitle}>Repeat pattern</Text>
          {PRESET_OPTS.map((opt) => {
            const active = draft.recurrenceRule?.preset === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => handleSelectPreset(opt.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={opt.label}
                style={[styles.sheetRow, active && styles.sheetRowActive]}
              >
                <View style={styles.sheetRowTextCol}>
                  <Text
                    style={[
                      styles.sheetRowLabel,
                      active && styles.sheetRowLabelActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text style={styles.sheetRowSub}>{opt.sub}</Text>
                </View>
                {active ? (
                  <Icon name="check" size={18} color={accent.warm} />
                ) : null}
              </Pressable>
            );
          })}

          {/* Sub-pickers per preset */}
          {draft.recurrenceRule !== null &&
          (draft.recurrenceRule.preset === "weekly" ||
            draft.recurrenceRule.preset === "biweekly" ||
            draft.recurrenceRule.preset === "monthly_dow") ? (
            <>
              <Text style={styles.sheetSubsectionLabel}>Day of the week</Text>
              <View style={styles.weekdayGrid}>
                {WEEKDAY_OPTS.map((opt) => {
                  const active = draft.recurrenceRule?.byDay === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => handleSelectByDay(opt.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={opt.label}
                      style={[styles.weekdayPill, active && styles.weekdayPillActive]}
                    >
                      <Text
                        style={[
                          styles.weekdayPillLabel,
                          active && styles.weekdayPillLabelActive,
                        ]}
                      >
                        {opt.short}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {draft.recurrenceRule?.preset === "monthly_dom" ? (
            <>
              <Text style={styles.sheetSubsectionLabel}>Day of the month</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.domRow}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => {
                  const active = draft.recurrenceRule?.byMonthDay === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => handleSelectByMonthDay(n)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Day ${n}`}
                      style={[styles.domPill, active && styles.domPillActive]}
                    >
                      <Text
                        style={[
                          styles.domPillLabel,
                          active && styles.domPillLabelActive,
                        ]}
                      >
                        {formatDayOfMonth(n)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          {draft.recurrenceRule?.preset === "monthly_dow" ? (
            <>
              <Text style={styles.sheetSubsectionLabel}>Which week</Text>
              <View style={styles.setPosRow}>
                {SETPOS_OPTS.map((opt) => {
                  const active = draft.recurrenceRule?.bySetPos === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => handleSelectBySetPos(opt.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={opt.label}
                      style={[styles.setPosPill, active && styles.setPosPillActive]}
                    >
                      <Text
                        style={[
                          styles.setPosPillLabel,
                          active && styles.setPosPillLabelActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          <Pressable
            onPress={() => setPresetSheetVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Done picking pattern"
            style={styles.sheetDoneBtn}
          >
            <Text style={styles.sheetDoneLabel}>Done</Text>
          </Pressable>
        </ScrollView>
      </Sheet>

      {/* Termination sheet */}
      <Sheet
        visible={terminationSheetVisible}
        onClose={() => setTerminationSheetVisible(false)}
        snapPoint="half"
      >
        <ScrollView
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sheetTitle}>End recurrence</Text>
          <View style={styles.terminationToggleRow}>
            <Pressable
              onPress={() => handleTerminationKindToggle("count")}
              accessibilityRole="button"
              accessibilityState={{
                selected: draft.recurrenceRule?.termination.kind === "count",
              }}
              accessibilityLabel="End after N occurrences"
              style={[
                styles.terminationSegment,
                draft.recurrenceRule?.termination.kind === "count" &&
                  styles.terminationSegmentActive,
              ]}
            >
              <Text
                style={[
                  styles.terminationSegmentLabel,
                  draft.recurrenceRule?.termination.kind === "count" &&
                    styles.terminationSegmentLabelActive,
                ]}
              >
                After N occurrences
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleTerminationKindToggle("until")}
              accessibilityRole="button"
              accessibilityState={{
                selected: draft.recurrenceRule?.termination.kind === "until",
              }}
              accessibilityLabel="End on specific date"
              style={[
                styles.terminationSegment,
                draft.recurrenceRule?.termination.kind === "until" &&
                  styles.terminationSegmentActive,
              ]}
            >
              <Text
                style={[
                  styles.terminationSegmentLabel,
                  draft.recurrenceRule?.termination.kind === "until" &&
                    styles.terminationSegmentLabelActive,
                ]}
              >
                On a date
              </Text>
            </Pressable>
          </View>

          {draft.recurrenceRule?.termination.kind === "count" ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Number of occurrences (1–52)</Text>
              <View style={styles.countInputWrap}>
                <TextInput
                  value={String(draft.recurrenceRule.termination.count)}
                  onChangeText={(v: string) => {
                    const parsed = parseInt(v, 10);
                    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 52) {
                      handleSetCount(parsed);
                    } else if (v === "") {
                      handleSetCount(1);
                    }
                  }}
                  keyboardType="number-pad"
                  placeholderTextColor={textTokens.quaternary}
                  style={styles.countInput}
                  accessibilityLabel="Number of occurrences"
                />
              </View>
            </View>
          ) : null}

          {draft.recurrenceRule?.termination.kind === "until" ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>End on</Text>
              <Pressable
                onPress={() => {
                  setTerminationSheetVisible(false);
                  // Slight delay to let sheet close before opening picker
                  setTimeout(() => handleOpenPicker("untilDate"), 200);
                }}
                accessibilityRole="button"
                accessibilityLabel="Pick end date"
                style={styles.pickerRow}
              >
                <Text style={styles.pickerValue}>
                  {formatDateRowLabel(draft.recurrenceRule.termination.until)}
                </Text>
                <Icon name="calendar" size={16} color={textTokens.tertiary} />
              </Pressable>
              <Text style={styles.helperHint}>Up to 1 year out.</Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => setTerminationSheetVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Done"
            style={styles.sheetDoneBtn}
          >
            <Text style={styles.sheetDoneLabel}>Done</Text>
          </Pressable>
        </ScrollView>
      </Sheet>

      {/* AddDateSheet (multi-date mode) */}
      <Sheet
        visible={addDateSheetVisible}
        onClose={() => setAddDateSheetVisible(false)}
        snapPoint="half"
      >
        <ScrollView
          contentContainerStyle={styles.sheetContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sheetTitle}>Add date</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Date</Text>
            <Pressable
              onPress={() => handleAddDateOpenPicker("date")}
              accessibilityRole="button"
              accessibilityLabel="Pick date"
              style={styles.pickerRow}
            >
              <Text
                style={
                  addDateValue !== null
                    ? styles.pickerValue
                    : styles.pickerPlaceholder
                }
              >
                {formatDateRowLabel(addDateValue)}
              </Text>
              <Icon name="calendar" size={16} color={textTokens.tertiary} />
            </Pressable>
          </View>

          <View style={styles.timeRow}>
            <View style={styles.timeCell}>
              <Text style={styles.fieldLabel}>Start</Text>
              <Pressable
                onPress={() => handleAddDateOpenPicker("start")}
                accessibilityRole="button"
                accessibilityLabel="Pick start time"
                style={styles.pickerRow}
              >
                <Text style={styles.pickerValue}>{addDateStartTime}</Text>
              </Pressable>
            </View>
            <View style={styles.timeCell}>
              <Text style={styles.fieldLabel}>End</Text>
              <Pressable
                onPress={() => handleAddDateOpenPicker("end")}
                accessibilityRole="button"
                accessibilityLabel="Pick end time"
                style={styles.pickerRow}
              >
                <Text style={styles.pickerValue}>{addDateEndTime}</Text>
              </Pressable>
            </View>
          </View>

          {addDateError !== null ? (
            <Text style={styles.helperError}>{addDateError}</Text>
          ) : null}

          <View style={styles.addDateActionRow}>
            <View style={styles.actionCell}>
              <Button
                label="Cancel"
                variant="ghost"
                size="md"
                onPress={() => setAddDateSheetVisible(false)}
                fullWidth
              />
            </View>
            <View style={styles.actionCell}>
              <Button
                label="Add date"
                variant="primary"
                size="md"
                onPress={handleConfirmAddDate}
                fullWidth
              />
            </View>
          </View>
        </ScrollView>

        {/* AddDateSheet inner picker — iOS spinner inline / Android dialog.
            Web is handled via hidden inputs at AddDateSheet bottom (below);
            handleAddDateOpenPicker triggers them on web and returns early. */}
        {addDatePickerMode !== null && Platform.OS === "ios" ? (
          <View style={styles.addDateInlinePicker}>
            <View style={styles.iosPickerDoneRow}>
              <Button
                label="Done"
                variant="primary"
                size="md"
                onPress={handleAddDateClosePicker}
              />
            </View>
            {addDateTempValue !== null ? (
              <DateTimePicker
                value={addDateTempValue}
                mode={addDatePickerMode === "date" ? "date" : "time"}
                display="spinner"
                onChange={handleAddDatePickerChange}
                minimumDate={
                  addDatePickerMode === "date" ? new Date() : undefined
                }
                is24Hour
                textColor="#FFFFFF"
                themeVariant="dark"
                style={styles.iosPicker}
              />
            ) : null}
          </View>
        ) : Platform.OS === "android" && addDatePickerMode !== null ? (
          <DateTimePicker
            value={addDateTempValue ?? new Date()}
            mode={addDatePickerMode === "date" ? "date" : "time"}
            display="default"
            onChange={handleAddDatePickerChange}
            minimumDate={addDatePickerMode === "date" ? new Date() : undefined}
            is24Hour
          />
        ) : null}

        {/* Hidden HTML5 inputs for AddDateSheet web direct-tap pickers.
            Triggered by handleAddDateOpenPicker via showPicker()/.click(). */}
        {Platform.OS === "web" ? (
          <>
            <input
              ref={addDateInputRef}
              type="date"
              value={addDateValue ?? ""}
              min={isoFromDate(new Date())}
              onChange={(e) => {
                const v = (e.target as unknown as { value: string }).value;
                if (v.length === 0) return;
                setAddDateValue(v);
              }}
              aria-label="Date for new entry"
              style={HIDDEN_WEB_INPUT_STYLE}
            />
            <input
              ref={addDateStartInputRef}
              type="time"
              value={addDateStartTime}
              onChange={(e) => {
                const v = (e.target as unknown as { value: string }).value;
                if (v.length === 0) return;
                setAddDateStartTime(v);
              }}
              aria-label="Start time"
              style={HIDDEN_WEB_INPUT_STYLE}
            />
            <input
              ref={addDateEndInputRef}
              type="time"
              value={addDateEndTime}
              onChange={(e) => {
                const v = (e.target as unknown as { value: string }).value;
                if (v.length === 0) return;
                setAddDateEndTime(v);
              }}
              aria-label="End time"
              style={HIDDEN_WEB_INPUT_STYLE}
            />
          </>
        ) : null}
      </Sheet>

      {/* Timezone sheet */}
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
                      updateDraft({ timezone: tz });
                      setTzSheetVisible(false);
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

      {/* MultiDateOverrideSheet — shared with Preview accordion */}
      <MultiDateOverrideSheet
        visible={overrideSheetEntryId !== null}
        onClose={() => setOverrideSheetEntryId(null)}
        onSave={handleSaveOverride}
        entry={overrideEntry}
        entryIndex={overrideEntryIndex >= 0 ? overrideEntryIndex : 0}
        parentDraft={draft}
      />

      {/* Mode-switch ConfirmDialog (lossy multi → single/recurring) */}
      <ConfirmDialog
        visible={pendingMode !== null}
        onClose={() => setPendingMode(null)}
        onConfirm={() => {
          if (pendingMode !== null) {
            applyModeSwitch(draft.whenMode, pendingMode);
          }
          setPendingMode(null);
        }}
        title="Switch mode?"
        description={
          pendingMode === "single"
            ? `You'll keep date 1 and lose ${(draft.multiDates?.length ?? 0) - 1} other date(s).`
            : pendingMode === "recurring"
              ? `You'll keep date 1, lose ${(draft.multiDates?.length ?? 0) - 1} other date(s), and convert to a recurring pattern.`
              : "Switch?"
        }
        confirmLabel="Switch"
        cancelLabel="Cancel"
        destructive
      />

      {/* Multi-date row delete ConfirmDialog */}
      <ConfirmDialog
        visible={pendingDeleteEntryId !== null}
        onClose={() => setPendingDeleteEntryId(null)}
        onConfirm={() => {
          if (pendingDeleteEntryId !== null) {
            handleDeleteMultiDate(pendingDeleteEntryId);
          }
        }}
        title={
          (draft.multiDates?.length ?? 0) <= 2
            ? "Can't remove this date"
            : "Remove this date?"
        }
        description={
          (draft.multiDates?.length ?? 0) <= 2
            ? "Multi-date events need at least 2 dates. Add another date first or switch the event to Single."
            : "You'll lose any overrides for this date. This can't be undone."
        }
        confirmLabel={
          (draft.multiDates?.length ?? 0) <= 2 ? "OK" : "Remove"
        }
        cancelLabel="Cancel"
        destructive
      />

    </View>
  );
};

// ---- Sub-components -------------------------------------------------

interface SegmentPillProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

const SegmentPill: React.FC<SegmentPillProps> = ({ label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={label}
    style={[styles.segment, active && styles.segmentActive]}
  >
    <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
      {label}
    </Text>
  </Pressable>
);

// ---- Styles ---------------------------------------------------------

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

  // Segmented control --------------------------------------------------
  segmentRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
  },
  segmentActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  segmentLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  segmentLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },

  // Picker rows --------------------------------------------------------
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

  // Time row -----------------------------------------------------------
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

  // Multi-date list ----------------------------------------------------
  multiDateEmpty: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    marginBottom: spacing.sm,
  },
  multiDateEmptyText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  multiDateList: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  multiDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  multiDateTextCol: {
    flex: 1,
    minWidth: 0,
  },
  multiDateRowTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  multiDateRowSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
  multiDateActionsRow: {
    flexDirection: "row",
    gap: spacing.xs,
    alignItems: "center",
  },
  multiDateActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  addDateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
    marginBottom: spacing.xs,
  },
  addDateLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },

  // Picker iOS sheet ---------------------------------------------------
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

  // Sheet content -----------------------------------------------------
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
  sheetSubsectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    marginBottom: spacing.xs,
  },
  sheetRowActive: {
    backgroundColor: accent.tint,
  },
  sheetRowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  sheetRowLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  sheetRowLabelActive: {
    fontWeight: "600",
  },
  sheetRowSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  sheetDoneBtn: {
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  sheetDoneLabel: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },

  // Weekday grid ------------------------------------------------------
  weekdayGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  weekdayPill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    minWidth: 56,
    alignItems: "center",
  },
  weekdayPillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  weekdayPillLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  weekdayPillLabelActive: {
    fontWeight: "700",
  },

  // Day-of-month row --------------------------------------------------
  domRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  domPill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    minWidth: 56,
    alignItems: "center",
  },
  domPillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  domPillLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  domPillLabelActive: {
    fontWeight: "700",
  },

  // SetPos row --------------------------------------------------------
  setPosRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  setPosPill: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  setPosPillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  setPosPillLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  setPosPillLabelActive: {
    fontWeight: "700",
  },

  // Count input -------------------------------------------------------
  countInputWrap: {
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  countInput: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    padding: 0,
  },

  // Termination toggle ------------------------------------------------
  terminationToggleRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  terminationSegment: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
  },
  terminationSegmentActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  terminationSegmentLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "500",
    color: textTokens.primary,
  },
  terminationSegmentLabelActive: {
    fontWeight: "700",
  },

  // AddDateSheet ------------------------------------------------------
  addDateActionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionCell: {
    flex: 1,
  },
  addDateInlinePicker: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
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
