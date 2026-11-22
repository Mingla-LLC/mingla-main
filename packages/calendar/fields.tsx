/**
 * @mingla/calendar field bodies (#4523): the trigger row, the presenter and the
 * four field wrappers. They render whichever surface implementation the
 * variant file provides through SurfaceImplContext: `CalendarField.tsx` gives
 * the lazily loaded one, `CalendarFieldEager.tsx` the static one (for a host
 * that already owns the single lazy boundary). This module imports no surface.
 */
import React, { Suspense, createContext, useCallback, useContext, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { useCalendarConfig } from "./config";
import { parseCalendarDate } from "./core/calendarDate";
import { formatLongDate, formatRangeLong, lengthLabel, mergeLabels } from "./core/labels";
import { nights, daysCovered, type RangeUnit } from "./core/rangeRules";
import type { CalendarSurfaceProps } from "./CalendarSurface";
import type { ComponentType } from "react";
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

export interface SurfaceImpl {
  Surface: ComponentType<CalendarSurfaceProps>;
  /** Fetch the surface ahead of the first open (web pointer-enter / focus). */
  preload?: () => void;
}

export const SurfaceImplContext = createContext<SurfaceImpl | null>(null);

function useSurfaceImpl(): SurfaceImpl {
  const impl = useContext(SurfaceImplContext);
  if (impl === null) throw new Error("@mingla/calendar: fields must come from CalendarField or CalendarFieldEager");
  return impl;
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
  const { preload } = useSurfaceImpl();
  const config: CalendarConfig = useCalendarConfig(props.config);
  const styles: CalendarStyles = useMemo(() => createCalendarStyles(config.tokens), [config.tokens]);
  const labels: CalendarLabels = useMemo(() => mergeLabels(props.labels), [props.labels]);
  const [open, setOpen] = useState(props.defaultOpen === true);
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
      {/* An empty label: the caller draws its own (a form question's shell). */}
      {label !== "" ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityHint={labels.opens_calendar}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        onHoverIn={preload}
        onFocus={preload}
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
export function BaseCalendarField(props: CalendarFieldProps): React.ReactElement {
  const { Surface } = useSurfaceImpl();
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
        <Surface {...common} testID={surfaceId(common.testID)} mode="single" value={value} onChange={onChange} clearable={clearable} onDone={close} onCancel={close} />
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
export function BaseDobField(props: DobFieldProps): React.ReactElement {
  const { Surface } = useSurfaceImpl();
  const { value, onChange, maxAge, minAge, ...common } = props;
  return (
    <Shell
      {...common}
      mode="dob"
      displayText={dateText(value, common.locale)}
      renderSurface={(close) => (
        <Surface {...common} testID={surfaceId(common.testID)} mode="dob" value={value} onChange={onChange} maxAge={maxAge} minAge={minAge} onDone={close} onCancel={close} />
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
  /** Optional field: Clear commits "no value" and closes. */
  onClear?: () => void;
  /** Two months side by side (wide web). */
  months?: 1 | 2;
}

/** Range. Stays open until Done; dismissing discards the draft. */
export function BaseDateRangeField(props: DateRangeFieldProps): React.ReactElement {
  const { Surface } = useSurfaceImpl();
  const { value, onChange, onClear, unit = "nights", minLength, maxLength, months, ...common } = props;
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
        <Surface
          {...common}
          testID={surfaceId(common.testID)}
          mode="range"
          value={value}
          onChange={onChange}
          onClear={onClear}
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
  /** Optional field: Clear commits "no value" and closes. */
  onClear?: () => void;
}

/** Date and time. Stays open until Done. */
export function BaseDateTimeField(props: DateTimeFieldProps): React.ReactElement {
  const { Surface } = useSurfaceImpl();
  const { value, onChange, onClear, timeStepMinutes, minTime, maxTime, ...common } = props;
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
        <Surface
          {...common}
          testID={surfaceId(common.testID)}
          mode="datetime"
          value={value}
          onChange={onChange}
          onClear={onClear}
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
export function BaseCalendarEmbed(props: CalendarSurfaceProps): React.ReactElement {
  const { Surface } = useSurfaceImpl();
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
      <Surface {...props} />
    </Suspense>
  );
}
