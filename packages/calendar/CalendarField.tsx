/**
 * @mingla/calendar field triggers (#4523): CalendarField, DateRangeField,
 * DateTimeField, DobField. Each is a labelled row plus a presenter; the heavy
 * surface (grid, time list, keyboard) loads with the ONE React.lazy below, on
 * first open. This file is the only lazy owner in the package: no module the
 * surface imports may add another `import()` or React.lazy (Metro would hoist
 * the shared modules into the eager chunk).
 */
import React, { Suspense, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { useCalendarConfig } from "./config";
import { parseCalendarDate } from "./core/calendarDate";
import { formatLongDate, formatRangeLong, lengthLabel, mergeLabels } from "./core/labels";
import { nights, daysCovered, type RangeUnit } from "./core/rangeRules";
import type { CalendarSurfaceProps } from "./CalendarSurface";
import { createCalendarStyles, type CalendarStyles } from "./styles";
import type {
  CalendarCommon,
  CalendarConfig,
  CalendarDate,
  CalendarLabels,
  DateTimeValue,
  RangeValue,
  WallTime,
} from "./types";

const LazySurface = React.lazy(() => import("./CalendarSurface"));

/** Fetch the surface chunk ahead of the first open (web pointer-enter / focus). */
export function preloadCalendarSurface(): void {
  import("./CalendarSurface").catch((error: unknown) => {
    // Only a warm-up: opening the calendar loads it again and fails loudly there.
    if (__DEV__) console.warn("[calendar] preload failed", error);
  });
}

type Mode = CalendarSurfaceProps["mode"];

interface ShellProps extends CalendarCommon {
  mode: Mode;
  displayText: string;
  /** Renders the surface for the open presenter. */
  renderSurface: (close: () => void) => React.ReactElement;
  clearButton?: React.ReactElement | null;
}

function Shell(props: ShellProps): React.ReactElement {
  const { label, accessibilityLabel, displayText, disabled = false, error = null, invalid = false, hint, testID, mode } = props;
  const config: CalendarConfig = useCalendarConfig(props.config);
  const styles: CalendarStyles = useMemo(() => createCalendarStyles(config.tokens), [config.tokens]);
  const labels: CalendarLabels = useMemo(() => mergeLabels(props.labels), [props.labels]);
  const [open, setOpen] = useState(false);
  const close = useCallback((): void => setOpen(false), []);
  const { Sheet, renderIcon } = config.primitives;
  const placeholder =
    props.placeholder ??
    (mode === "range" ? labels.choose_dates : mode === "datetime" ? labels.choose_date_time : labels.choose_date);
  const title =
    mode === "range"
      ? labels.dialog_title_dates
      : mode === "datetime"
        ? labels.dialog_title_date_time
        : mode === "dob"
          ? labels.dialog_title_dob
          : labels.dialog_title_date;
  const filled = displayText !== "";
  const spoken = `${accessibilityLabel ?? label}, ${filled ? displayText : labels.not_set}`;

  return (
    <View style={styles.host}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint={labels.opens_calendar}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        onHoverIn={preloadCalendarSurface}
        onFocus={preloadCalendarSurface}
        testID={testID}
        style={[styles.row, (invalid || (error !== null && error !== "")) && styles.rowError, disabled && styles.rowDisabled]}
      >
        <Text style={filled ? styles.rowValue : styles.rowPlaceholder} numberOfLines={1}>
          {filled ? displayText : placeholder}
        </Text>
        {renderIcon !== undefined ? renderIcon("calendar", config.tokens.textMuted, 18) : null}
      </Pressable>
      {error !== null && error !== "" ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {error}
        </Text>
      ) : hint !== undefined ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}
      {props.clearButton ?? null}
      <Sheet
        visible={open}
        onClose={close}
        title={title}
        closeLabel={labels.close}
        testID={testID === undefined ? undefined : `${testID}-sheet`}
      >
        {open ? (
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
            <Suspense
              fallback={
                <View style={styles.loading}>
                  <ActivityIndicator accessibilityLabel={labels.loading} />
                </View>
              }
            >
              {props.renderSurface(close)}
            </Suspense>
          </ScrollView>
        ) : null}
      </Sheet>
    </View>
  );
}

/** The surface's own testID prefix; never the trigger's, so ids stay unique. */
const surfaceId = (testID: string | undefined): string | undefined =>
  testID === undefined ? undefined : `${testID}-calendar`;

type CommonOnly = Omit<CalendarCommon, "label"> & { label: string };

export interface CalendarFieldProps extends CommonOnly {
  value: CalendarDate | "";
  onChange: (date: CalendarDate | "") => void;
  clearable?: boolean;
}

function dateText(value: string, locale: string | undefined): string {
  return value !== "" && parseCalendarDate(value) !== null ? formatLongDate(value, locale) : "";
}

/** Single date. Closes on pick. */
export function CalendarField(props: CalendarFieldProps): React.ReactElement {
  const { value, onChange, clearable, ...common } = props;
  const outOfBounds =
    value !== "" && ((common.min !== undefined && value < common.min) || (common.max !== undefined && value > common.max));
  const labels = mergeLabels(common.labels);
  return (
    <Shell
      {...common}
      error={common.error ?? (outOfBounds ? labels.value_not_allowed : null)}
      mode="single"
      displayText={dateText(value, common.locale)}
      renderSurface={(close) => (
        <LazySurface {...common} testID={surfaceId(common.testID)} mode="single" value={value} onChange={onChange} clearable={clearable} onDone={close} onCancel={close} />
      )}
    />
  );
}

export interface DobFieldProps extends CommonOnly {
  value: CalendarDate | "";
  onChange: (date: CalendarDate | "") => void;
  maxAge?: number;
  minAge?: number;
}

/** Date of birth. Opens on the year grid. */
export function DobField(props: DobFieldProps): React.ReactElement {
  const { value, onChange, maxAge, minAge, ...common } = props;
  return (
    <Shell
      {...common}
      mode="dob"
      displayText={dateText(value, common.locale)}
      renderSurface={(close) => (
        <LazySurface {...common} testID={surfaceId(common.testID)} mode="dob" value={value} onChange={onChange} maxAge={maxAge} minAge={minAge} onDone={close} onCancel={close} />
      )}
    />
  );
}

export interface DateRangeFieldProps extends CommonOnly {
  value: RangeValue;
  onChange: (range: { start: CalendarDate; end: CalendarDate }) => void;
  unit?: RangeUnit;
  minLength?: number;
  maxLength?: number;
  /** Two months side by side (wide web). */
  months?: 1 | 2;
}

/** Range. Stays open until Done; dismissing discards the draft. */
export function DateRangeField(props: DateRangeFieldProps): React.ReactElement {
  const { value, onChange, unit = "nights", minLength, maxLength, months, ...common } = props;
  const labels = mergeLabels(common.labels);
  const complete = value.start !== "" && value.end !== "" && parseCalendarDate(value.start) !== null && parseCalendarDate(value.end) !== null;
  const displayText = complete
    ? formatRangeLong(
        value.start,
        value.end,
        lengthLabel(unit === "nights" ? nights(value.start, value.end) : daysCovered(value.start, value.end), unit, labels),
        common.locale,
      )
    : "";
  return (
    <Shell
      {...common}
      mode="range"
      displayText={displayText}
      renderSurface={(close) => (
        <LazySurface
          {...common}
          testID={surfaceId(common.testID)}
          mode="range"
          value={value}
          onChange={onChange}
          unit={unit}
          minLength={minLength}
          maxLength={maxLength}
          months={months}
          onDone={close}
          onCancel={close}
        />
      )}
    />
  );
}

export interface DateTimeFieldProps extends CommonOnly {
  value: DateTimeValue;
  onChange: (value: { date: CalendarDate; time: WallTime }) => void;
  timeStepMinutes?: 5 | 15 | 30;
  minTime?: WallTime;
  maxTime?: WallTime;
}

/** Date and time. Stays open until Done. */
export function DateTimeField(props: DateTimeFieldProps): React.ReactElement {
  const { value, onChange, timeStepMinutes, minTime, maxTime, ...common } = props;
  const labels = mergeLabels(common.labels);
  const displayText =
    value.date !== "" && value.time !== "" && parseCalendarDate(value.date) !== null
      ? `${formatLongDate(value.date, common.locale)} ${labels.at} ${value.time}`
      : "";
  return (
    <Shell
      {...common}
      mode="datetime"
      displayText={displayText}
      renderSurface={(close) => (
        <LazySurface
          {...common}
          testID={surfaceId(common.testID)}
          mode="datetime"
          value={value}
          onChange={onChange}
          timeStepMinutes={timeStepMinutes}
          minTime={minTime}
          maxTime={maxTime}
          onDone={close}
          onCancel={close}
        />
      )}
    />
  );
}

/**
 * The bare surface for embedding inside a screen's own layout (a plan panel, a
 * "pick a day" step). Same lazy chunk as the fields; the loading state is a
 * spinner, never a blank gap.
 */
export function CalendarEmbed(props: CalendarSurfaceProps): React.ReactElement {
  const config = useCalendarConfig(props.config);
  const styles = useMemo(() => createCalendarStyles(config.tokens), [config.tokens]);
  const labels = useMemo(() => mergeLabels(props.labels), [props.labels]);
  return (
    <Suspense
      fallback={
        <View style={styles.loading}>
          <ActivityIndicator accessibilityLabel={labels.loading} />
        </View>
      }
    >
      <LazySurface {...props} />
    </Suspense>
  );
}
