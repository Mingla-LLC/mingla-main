/**
 * @mingla/calendar surface (#4523). Header (navigation + title), one or two
 * months, optional time list, footer (readout, zone, Clear / Done).
 *
 * THE RULE THIS FILE EXISTS TO KEEP: changing month or year never commits,
 * never closes and never changes the value or the draft. Navigation handlers
 * (`onNavigateMonth`, `onNavigateYears`, `onNavigateDecade`) only move the
 * visible month; they never call onChange, onDone or onCancel.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View, type ViewProps } from "react-native";

import { CalendarGrid, type GridSelection } from "./CalendarGrid";
import { useCalendarConfig } from "./config";
import { addYears, compareDates, daysInMonth, formatCalendarDate, parseCalendarDate, todayInZone, type CalendarDate } from "./core/calendarDate";
import { reduceKeyboard } from "./core/keyboard";
import {
  formatLongDate,
  formatRangeShort,
  formatTimezoneLabel,
  lengthLabel,
  mergeLabels,
  monthTitle,
} from "./core/labels";
import { isDisabled, type DayBounds } from "./core/monthGrid";
import { clampToBounds, daysCovered, isRangeComplete, nextRange, nights, type DraftRange } from "./core/rangeRules";
import { createCalendarStyles } from "./styles";
import { TimeList } from "./TimeList";
import type { CalendarCommon, DateTimeValue, RangeUnit, RangeValue, WallTime } from "./types";

type YM = { year: number; month: number };

const shiftMonth = (cur: YM, delta: number): YM => {
  const index = cur.year * 12 + (cur.month - 1) + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 + 1 };
};
const monthOf = (date: CalendarDate): YM => {
  const parts = parseCalendarDate(date);
  if (parts === null) throw new RangeError(`calendar: not a YYYY-MM-DD date: "${date}"`);
  return { year: parts.y, month: parts.m };
};
const firstOf = (ym: YM): CalendarDate => formatCalendarDate({ y: ym.year, m: ym.month, d: 1 });
const lastOf = (ym: YM): CalendarDate => formatCalendarDate({ y: ym.year, m: ym.month, d: daysInMonth(ym.year, ym.month) });

type SurfaceModeProps =
  | { mode: "single"; value: CalendarDate | ""; onChange: (date: CalendarDate | "") => void; clearable?: boolean }
  | { mode: "dob"; value: CalendarDate | ""; onChange: (date: CalendarDate | "") => void; maxAge?: number; minAge?: number }
  | {
      mode: "range";
      value: RangeValue;
      onChange: (range: { start: CalendarDate; end: CalendarDate }) => void;
      /** When set, Clear commits "no value" through this and closes (an optional field). */
      onClear?: () => void;
      unit?: RangeUnit;
      minLength?: number;
      maxLength?: number;
      /** Latest day a range may START on (a later day can still end it). */
      maxStart?: CalendarDate;
      /** A one-day range (start = end) may be picked: tap the start day again. */
      allowSameDay?: boolean;
    }
  | {
      mode: "datetime";
      value: DateTimeValue;
      onChange: (value: { date: CalendarDate; time: WallTime }) => void;
      /** When set, Clear commits "no value" through this and closes (an optional field). */
      onClear?: () => void;
      timeStepMinutes?: 5 | 15 | 30;
      minTime?: WallTime;
      maxTime?: WallTime;
    };

export type CalendarSurfaceProps = CalendarCommon &
  SurfaceModeProps & {
    months?: 1 | 2;
    /** Called after a commit, so the presenter can close. */
    onDone: () => void;
    /** Escape. The presenter's scrim, swipe and close button dismiss on their own. */
    onCancel: () => void;
  };

type DobView = "year" | "month" | "day";
const DECADE = 12;

export function CalendarSurface(props: CalendarSurfaceProps): React.ReactElement {
  const config = useCalendarConfig(props.config);
  const styles = useMemo(() => createCalendarStyles(config.tokens), [config.tokens]);
  const labels = useMemo(() => mergeLabels(props.labels), [props.labels]);
  const { timeZone, locale, weekStartsOn = 1, testID = "calendar" } = props;
  const today = useMemo(() => todayInZone(timeZone), [timeZone]);
  const { renderIcon } = config.primitives;
  const tokens = config.tokens;

  // DOB bounds come from age; every other mode takes min/max as given.
  const dobMin = props.mode === "dob" ? addYears(today, -(props.maxAge ?? 120)) : undefined;
  const dobMax = props.mode === "dob" ? addYears(today, -(props.minAge ?? 0)) : undefined;
  const min = props.mode === "dob" ? dobMin : props.min;
  const max = props.mode === "dob" ? dobMax : props.max;
  // ---- draft -------------------------------------------------------------
  const committedDate: CalendarDate | "" =
    props.mode === "single" || props.mode === "dob"
      ? props.value
      : props.mode === "range"
        ? props.value.start
        : props.value.date;
  const [rangeDraft, setRangeDraft] = useState<DraftRange>(
    props.mode === "range" ? { start: props.value.start, end: props.value.end } : { start: "", end: "" },
  );
  const [dateTimeDraft, setDateTimeDraft] = useState<DateTimeValue>(
    props.mode === "datetime" ? props.value : { date: "", time: "" },
  );

  // A day that would START the range (none chosen yet, or before the chosen
  // start) is unavailable after `maxStart`; the same day can still end it.
  const maxStart = props.mode === "range" ? props.maxStart : undefined;
  const bounds: DayBounds = useMemo(() => {
    const base = props.isDateDisabled;
    if (maxStart === undefined) return { min, max, isDateDisabled: base };
    const startsAfterCut = (date: CalendarDate): boolean =>
      (rangeDraft.start === "" || compareDates(date, rangeDraft.start) < 0) && compareDates(date, maxStart) > 0;
    return { min, max, isDateDisabled: (date: CalendarDate) => startsAfterCut(date) || (base?.(date) ?? false) };
  }, [min, max, props.isDateDisabled, maxStart, rangeDraft.start]);

  const selectedForFocus =
    props.mode === "range" ? rangeDraft.start : props.mode === "datetime" ? dateTimeDraft.date : committedDate;
  const startDate = useMemo(() => {
    const seed = selectedForFocus !== "" && parseCalendarDate(selectedForFocus) !== null ? selectedForFocus : today;
    return clampToBounds(seed, min, max);
    // The opening date is read once; later changes to the draft must not recentre the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [visible, setVisible] = useState<YM>(() => monthOf(startDate));
  const [focusedDate, setFocusedDate] = useState<CalendarDate>(startDate);
  // Web focuses the selected day on open; native never pulls focus.
  const [focusSignal, setFocusSignal] = useState<number>(Platform.OS === "web" ? 1 : 0);
  const [dobView, setDobView] = useState<DobView>(props.mode === "dob" ? "year" : "day");
  const [decadeStart, setDecadeStart] = useState<number>(() => {
    const anchor = committedDate !== "" && parseCalendarDate(committedDate) !== null ? committedDate : addYears(today, -25);
    return monthOf(anchor).year - (monthOf(anchor).year % DECADE);
  });

  // #4523 SC-12 (W-9) — web moves focus into a DOB's year and month grids
  // as they open (the chosen year or month, else the anchor year), as the day
  // grid does for its selected day. Native never pulls focus.
  const pickRefs = useRef<Record<string, { focus?: () => void } | null>>({});
  useEffect(() => {
    if (Platform.OS !== "web" || props.mode !== "dob" || dobView === "day") return;
    const anchorYear = monthOf(
      committedDate !== "" && parseCalendarDate(committedDate) !== null
        ? committedDate
        : addYears(today, -25),
    ).year;
    const yearKey =
      anchorYear >= decadeStart && anchorYear < decadeStart + DECADE
        ? anchorYear
        : Object.keys(pickRefs.current)
            .filter((key) => key.startsWith("y") && pickRefs.current[key] !== null)
            .map((key) => Number(key.slice(1)))
            .sort((a, b) => a - b)[0];
    const key = dobView === "year" ? `y${yearKey}` : `m${visible.month}`;
    pickRefs.current[key]?.focus?.();
    // Only a change of grid (view, decade or year) moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dobView, decadeStart, visible.year]);

  // ---- navigation: only moves the view, never commits or closes ----------
  const canMoveMonth = useCallback(
    (delta: number): boolean => {
      const target = shiftMonth(visible, delta);
      if (delta < 0 && min !== undefined && compareDates(lastOf(target), min) < 0) return false;
      if (delta > 0 && max !== undefined && compareDates(firstOf(target), max) > 0) return false;
      return true;
    },
    [visible, min, max],
  );
  const onNavigateMonth = useCallback(
    (delta: number): void => {
      if (!canMoveMonth(delta)) return;
      setVisible((cur) => shiftMonth(cur, delta));
    },
    [canMoveMonth],
  );
  const onNavigateYears = useCallback((delta: number): void => {
    setVisible((cur) => ({ year: cur.year + delta, month: cur.month }));
  }, []);
  const onNavigateDecade = useCallback((delta: number): void => {
    setDecadeStart((cur) => cur + delta * DECADE);
  }, []);

  const navigate = (delta: 1 | -1): void => {
    if (props.mode === "dob" && dobView === "year") onNavigateDecade(delta);
    else if (props.mode === "dob" && dobView === "month") onNavigateYears(delta);
    else onNavigateMonth(delta);
  };

  // ---- picking -----------------------------------------------------------
  const pickDay = (date: CalendarDate): void => {
    if (isDisabled(date, bounds)) return;
    setFocusedDate(date);
    switch (props.mode) {
      case "single":
      case "dob":
        props.onChange(date);
        props.onDone();
        return;
      case "range":
        setRangeDraft((cur) => nextRange(cur, date, props.allowSameDay === true));
        return;
      case "datetime":
        setDateTimeDraft((cur) => ({ ...cur, date }));
        return;
      default: {
        const unreachable: never = props;
        throw new Error(`calendar: unknown mode ${String(unreachable)}`);
      }
    }
  };

  const commit = (): void => {
    if (props.mode === "range") {
      if (rangeDraft.start === "" || rangeDraft.end === "") return;
      props.onChange({ start: rangeDraft.start, end: rangeDraft.end });
      props.onDone();
    } else if (props.mode === "datetime") {
      if (dateTimeDraft.date === "" || !timeOffered) return;
      props.onChange({ date: dateTimeDraft.date, time: dateTimeDraft.time });
      props.onDone();
    }
  };

  const clear = (): void => {
    if (props.mode === "range" || props.mode === "datetime") {
      if (props.onClear !== undefined) {
        props.onClear();
        props.onDone();
      } else if (props.mode === "range") setRangeDraft({ start: "", end: "" });
      else setDateTimeDraft({ date: "", time: "" });
    } else if (props.mode === "single") {
      props.onChange("");
      props.onDone();
    }
  };

  // ---- keyboard ----------------------------------------------------------
  const onKeyDown = (event: { key: string; shiftKey?: boolean; preventDefault?: () => void }): void => {
    const result = reduceKeyboard(focusedDate, event, weekStartsOn);
    if (!result.handled) return;
    if (result.action === "dismiss") {
      event.preventDefault?.();
      props.onCancel();
      return;
    }
    // Enter / Space on a day press that day's own button; handling it here too
    // would pick twice, so the surface leaves it alone.
    if (result.action === "pick") return;
    event.preventDefault?.();
    const next = clampToBounds(result.focused, min, max);
    setFocusedDate(next);
    setVisible(monthOf(next));
    setFocusSignal((n) => n + 1);
  };
  const keyProps = { onKeyDown } as unknown as ViewProps;

  // ---- derived view ------------------------------------------------------
  const monthsShown = props.mode === "range" && props.months === 2 ? 2 : 1;
  const unit: RangeUnit = props.mode === "range" ? (props.unit ?? "nights") : "nights";
  const selection: GridSelection =
    props.mode === "range"
      ? { start: rangeDraft.start, end: rangeDraft.end, ranged: true }
      : props.mode === "datetime"
        ? { start: dateTimeDraft.date, end: "", ranged: false }
        : { start: committedDate, end: "", ranged: false };

  const canPrev = props.mode === "dob" && dobView !== "day" ? true : canMoveMonth(-1);
  const canNext = props.mode === "dob" && dobView !== "day" ? true : canMoveMonth(1);
  const prevYear = shiftMonth(visible, -1);
  const nextYear = shiftMonth(visible, 1);
  const titleText =
    props.mode === "dob" && dobView === "year"
      ? `${decadeStart} – ${decadeStart + DECADE - 1}`
      : props.mode === "dob" && dobView === "month"
        ? String(visible.year)
        : monthTitle(visible.year, visible.month, locale);
  const prevLabel =
    props.mode === "dob" && dobView === "year"
      ? labels.previous_years
      : props.mode === "dob" && dobView === "month"
        ? labels.previous_year
        : `${labels.previous_month}, ${monthTitle(prevYear.year, prevYear.month, locale)}`;
  const nextLabel =
    props.mode === "dob" && dobView === "year"
      ? labels.next_years
      : props.mode === "dob" && dobView === "month"
        ? labels.next_year
        : `${labels.next_month}, ${monthTitle(nextYear.year, nextYear.month, locale)}`;

  const readout = ((): string => {
    if (props.mode === "range") {
      if (rangeDraft.start === "") return "";
      if (rangeDraft.end === "") return `${formatRangeShort(rangeDraft.start, rangeDraft.start, locale)} · ${labels.pick_last_day}`;
      return [
        formatRangeShort(rangeDraft.start, rangeDraft.end, locale),
        lengthLabel(daysCovered(rangeDraft.start, rangeDraft.end), "days", labels),
        lengthLabel(nights(rangeDraft.start, rangeDraft.end), "nights", labels),
      ].join(" · ");
    }
    if (props.mode === "datetime") {
      if (dateTimeDraft.date === "") return "";
      return dateTimeDraft.time === ""
        ? formatLongDate(dateTimeDraft.date, locale)
        : `${formatLongDate(dateTimeDraft.date, locale)} ${labels.at} ${dateTimeDraft.time}`;
    }
    return committedDate === "" ? "" : formatLongDate(committedDate, locale);
  })();

  const tzDate = selectedForFocus !== "" && parseCalendarDate(selectedForFocus) !== null ? selectedForFocus : firstOf(visible);
  const tzLabel = formatTimezoneLabel(timeZone, tzDate, locale);

  // #4523 S-8 — wide enough to put the time list beside the grid.
  const { width: windowWidth } = useWindowDimensions();
  const dateTimeSideBySide = props.mode === "datetime" && windowWidth >= 720;
  const showClear =
    props.mode === "range" || props.mode === "datetime" || (props.mode === "single" && props.clearable === true);
  const showDone = props.mode === "range" || props.mode === "datetime";

  const timeMin = props.mode === "datetime" && min !== undefined && dateTimeDraft.date === min ? props.minTime : undefined;
  const timeMax = props.mode === "datetime" && max !== undefined && dateTimeDraft.date === max ? props.maxTime : undefined;
  // #4523 S-8 — a time kept from another day that this day does not offer
  // (after the bound) is not a choice: Done stays off until a time that is.
  const timeOffered =
    dateTimeDraft.time !== "" &&
    (timeMin === undefined || dateTimeDraft.time >= timeMin) &&
    (timeMax === undefined || dateTimeDraft.time <= timeMax);
  const doneEnabled =
    props.mode === "range"
      ? isRangeComplete(rangeDraft, unit, props.minLength, props.maxLength)
      : props.mode === "datetime"
        ? dateTimeDraft.date !== "" && timeOffered
        : false;

  const glyph = (name: "chevron-left" | "chevron-right" | "clock", fallback: string): React.ReactNode =>
    renderIcon !== undefined ? renderIcon(name, tokens.text, 18) : <Text style={styles.navGlyph}>{fallback}</Text>;

  const button = (
    key: string,
    text: string,
    onPress: () => void,
    opts: { quiet?: boolean; disabled?: boolean } = {},
  ): React.ReactElement => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled: opts.disabled === true }}
      disabled={opts.disabled}
      onPress={onPress}
      testID={`${testID}-${key}`}
      style={[styles.button, opts.quiet === true ? styles.buttonQuiet : styles.buttonAccent, opts.disabled === true && styles.buttonDisabled]}
    >
      <Text style={[styles.buttonText, opts.quiet === true && styles.buttonTextQuiet]}>{text}</Text>
    </Pressable>
  );

  // ---- DOB year / month grids -------------------------------------------
  const dobGrid = ((): React.ReactElement | null => {
    if (props.mode !== "dob" || dobView === "day") return null;
    if (dobView === "year") {
      const years = Array.from({ length: DECADE }, (_, i) => decadeStart + i);
      return (
        <View style={styles.gridPick}>
          {years.map((year) => {
            const off = (min !== undefined && year < monthOf(min).year) || (max !== undefined && year > monthOf(max).year);
            return (
              <Pressable
                key={year}
                ref={(node) => {
                  pickRefs.current[`y${year}`] = off ? null : (node as { focus?: () => void } | null);
                }}
                accessibilityRole="button"
                accessibilityLabel={String(year)}
                accessibilityState={{ disabled: off }}
                disabled={off}
                onPress={() => {
                  setVisible((cur) => ({ year, month: cur.month }));
                  setDobView("month");
                }}
                testID={`${testID}-year-${year}`}
                style={[styles.gridPickItem, off && styles.cellDisabled]}
              >
                <Text style={styles.gridPickText}>{year}</Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
    return (
      <View style={styles.gridPick}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
          const target = { year: visible.year, month };
          const off = (min !== undefined && compareDates(lastOf(target), min) < 0) || (max !== undefined && compareDates(firstOf(target), max) > 0);
          return (
            <Pressable
              key={month}
              ref={(node) => {
                pickRefs.current[`m${month}`] = off ? null : (node as { focus?: () => void } | null);
              }}
              accessibilityRole="button"
              accessibilityLabel={monthTitle(target.year, month, locale)}
              accessibilityState={{ disabled: off }}
              disabled={off}
              onPress={() => {
                setVisible(target);
                setFocusedDate(clampToBounds(firstOf(target), min, max));
                setDobView("day");
                // The day grid takes focus as it opens (web only).
                if (Platform.OS === "web") setFocusSignal((n) => n + 1);
              }}
              testID={`${testID}-month-${month}`}
              style={[styles.gridPickItem, off && styles.cellDisabled]}
            >
              <Text style={styles.gridPickText}>{monthTitle(target.year, month, locale).split(" ")[0]}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  })();

  const dobTitleTappable = props.mode === "dob" && dobView !== "year";
  const titleProps = {
    accessibilityRole: "adjustable" as const,
    accessibilityLabel: titleText,
    accessibilityActions: [{ name: "increment" }, { name: "decrement" }],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }): void => {
      if (event.nativeEvent.actionName === "increment") navigate(1);
      else if (event.nativeEvent.actionName === "decrement") navigate(-1);
    },
    accessibilityLiveRegion: "polite" as const,
    testID: `${testID}-title`,
    style: styles.titleButton,
  };

  return (
    <View
      style={styles.surface}
      testID={testID}
      accessibilityViewIsModal
      {...keyProps}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={prevLabel}
          accessibilityState={{ disabled: !canPrev }}
          disabled={!canPrev}
          hitSlop={4}
          onPress={() => navigate(-1)}
          testID={`${testID}-prev`}
          style={[styles.navButton, !canPrev && styles.navDisabled]}
        >
          {glyph("chevron-left", "‹")}
        </Pressable>
        {dobTitleTappable ? (
          <Pressable
            {...titleProps}
            onPress={() => setDobView((cur) => (cur === "day" ? "month" : "year"))}
          >
            <Text style={styles.title}>{titleText}</Text>
          </Pressable>
        ) : (
          <View {...titleProps}>
            <Text style={styles.title}>{titleText}</Text>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={nextLabel}
          accessibilityState={{ disabled: !canNext }}
          disabled={!canNext}
          hitSlop={4}
          onPress={() => navigate(1)}
          testID={`${testID}-next`}
          style={[styles.navButton, !canNext && styles.navDisabled]}
        >
          {glyph("chevron-right", "›")}
        </Pressable>
      </View>

      {/* #4523 S-8 — on a wide screen the date grid and the time list sit side
          by side, so Clear and Done stay on screen without scrolling the
          dialog (1280×860). Narrow screens keep the stacked order. */}
      <View style={dateTimeSideBySide ? styles.dateTimeRow : undefined}>
      {dobGrid ?? (
        <View style={[styles.months, dateTimeSideBySide && styles.dateTimeGrid]}>
          {Array.from({ length: monthsShown }, (_, i) => {
            const ym = shiftMonth(visible, i);
            return (
              <View key={`${ym.year}-${ym.month}`} style={styles.month}>
                {monthsShown === 2 ? <Text style={styles.sectionLabel}>{monthTitle(ym.year, ym.month, locale)}</Text> : null}
                <CalendarGrid
                  year={ym.year}
                  month={ym.month}
                  weekStartsOn={weekStartsOn}
                  styles={styles}
                  labels={labels}
                  locale={locale}
                  selection={selection}
                  focusedDate={focusedDate}
                  focusSignal={focusSignal}
                  today={today}
                  bounds={bounds}
                  onPickDay={pickDay}
                  testIDPrefix={testID}
                />
              </View>
            );
          })}
        </View>
      )}

      {props.mode === "datetime" ? (
        <View style={dateTimeSideBySide ? styles.dateTimeTimes : undefined}>
          <Text style={styles.sectionLabel}>{labels.time_heading}</Text>
          <TimeList
            tall={dateTimeSideBySide}
            value={dateTimeDraft.time}
            onChange={(time) => setDateTimeDraft((cur) => ({ ...cur, time }))}
            stepMinutes={props.timeStepMinutes ?? 15}
            min={timeMin}
            max={timeMax}
            styles={styles}
            testIDPrefix={`${testID}-time`}
          />
        </View>
      ) : null}
      </View>

      <View style={styles.footer}>
        <Text accessibilityLiveRegion="polite" style={styles.readout} testID={`${testID}-readout`}>
          {readout}
        </Text>
        <View style={styles.footerButtons}>
          {glyph("clock", "")}
          <Text style={styles.tzLine} testID={`${testID}-tz`}>
            {tzLabel}
          </Text>
        </View>
        {showClear || showDone ? (
          <View style={styles.footerButtons}>
            {showClear ? button("clear", labels.clear, clear, { quiet: true }) : null}
            {showDone ? button("done", labels.done, commit, { disabled: !doneEnabled }) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default CalendarSurface;
