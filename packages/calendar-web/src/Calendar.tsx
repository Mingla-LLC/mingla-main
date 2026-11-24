/**
 * The bare Mingla calendar for the DOM (#4523): header (navigation + title), one
 * or two months, an optional time list, and a footer (readout, zone, Clear / Done).
 *
 * THE RULE: changing month or year never commits, never closes and never changes
 * the value or the draft. `onNavigateMonth` only moves the visible month.
 *
 * Values are wall-clock strings in `timeZone`: dates "YYYY-MM-DD", date-times
 * "YYYY-MM-DDTHH:mm". A JS Date never crosses this API.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  compareDates,
  daysInMonth,
  formatCalendarDate,
  parseCalendarDate,
  todayInZone,
  type CalendarDate,
} from "../core/calendarDate";
import { reduceKeyboard } from "../core/keyboard";
import {
  dayA11yLabel,
  formatLongDate,
  formatRangeShort,
  formatTimezoneLabel,
  lengthLabel,
  mergeLabels,
  monthTitle,
  weekdayInitials,
  type CalendarLabels,
} from "../core/labels";
import { isDisabled, monthMatrix } from "../core/monthGrid";
import { clampToBounds, daysCovered, nextRange, nights } from "../core/rangeRules";

export type CalendarMode = "date" | "datetime" | "range";
export interface RangeValue {
  start: CalendarDate | "";
  end: CalendarDate | "";
}

export interface CalendarProps {
  mode: CalendarMode;
  /** date: "YYYY-MM-DD"; datetime: "YYYY-MM-DDTHH:mm"; range: { start, end }. "" = unset. */
  value: string | RangeValue;
  /** Single date: called on a day pick. datetime / range: called on Done. */
  onCommit: (value: string | { start: string; end: string }) => void;
  onCancel: () => void;
  /** When set, a Clear button commits "no value" through it (an optional field). */
  onClear?: () => void;
  /** Inclusive bounds. A datetime bound may carry a time ("YYYY-MM-DDTHH:mm"). */
  min?: string;
  max?: string;
  isDateDisabled?: (date: CalendarDate) => boolean;
  /** Range: a one-day range (start = end) may be picked. */
  allowSameDay?: boolean;
  timeZone: string;
  weekStartsOn?: 0 | 1;
  months?: 1 | 2;
  timeStepMinutes?: 5 | 15 | 30;
  labels?: Partial<CalendarLabels>;
  locale?: string;
  /** Prefix for ids and data-testid values. */
  idPrefix?: string;
}

type YM = { year: number; month: number };
const shiftMonth = (cur: YM, delta: number): YM => {
  const index = cur.year * 12 + (cur.month - 1) + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 + 1 };
};
const monthOf = (date: CalendarDate): YM => {
  const parts = parseCalendarDate(date);
  if (parts === null) throw new RangeError(`calendar-web: not a YYYY-MM-DD date: "${date}"`);
  return { year: parts.y, month: parts.m };
};
const firstOf = (ym: YM): CalendarDate => formatCalendarDate({ y: ym.year, m: ym.month, d: 1 });
const lastOf = (ym: YM): CalendarDate => formatCalendarDate({ y: ym.year, m: ym.month, d: daysInMonth(ym.year, ym.month) });
const datePart = (v: string): string => v.slice(0, 10);
const timePart = (v: string): string => (v.length >= 16 ? v.slice(11, 16) : "");
const validDate = (v: string): boolean => v !== "" && parseCalendarDate(datePart(v)) !== null;

function timeSlots(step: number, min?: string, max?: string): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) {
    const slot = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if (min !== undefined && slot < min) continue;
    if (max !== undefined && slot > max) continue;
    out.push(slot);
  }
  return out;
}

export function Calendar(props: CalendarProps): React.ReactElement {
  const { mode, timeZone, locale, weekStartsOn = 1, idPrefix = "cal" } = props;
  const labels = useMemo(() => mergeLabels(props.labels), [props.labels]);
  const today = useMemo(() => todayInZone(timeZone), [timeZone]);
  const min = props.min !== undefined && validDate(props.min) ? datePart(props.min) : undefined;
  const max = props.max !== undefined && validDate(props.max) ? datePart(props.max) : undefined;
  const minTimeOnMinDay = props.min !== undefined ? timePart(props.min) || undefined : undefined;
  const bounds = useMemo(() => ({ min, max, isDateDisabled: props.isDateDisabled }), [min, max, props.isDateDisabled]);

  const committed = props.value;
  const [rangeDraft, setRangeDraft] = useState<RangeValue>(
    mode === "range" && typeof committed !== "string" ? { start: committed.start, end: committed.end } : { start: "", end: "" },
  );
  const [dtDraft, setDtDraft] = useState<{ date: string; time: string }>(
    mode === "datetime" && typeof committed === "string"
      ? { date: validDate(committed) ? datePart(committed) : "", time: timePart(committed) }
      : { date: "", time: "" },
  );
  const selectedDate: string =
    mode === "range" ? rangeDraft.start : mode === "datetime" ? dtDraft.date : typeof committed === "string" ? datePart(committed) : "";

  const startDate = useMemo(() => {
    const seed = selectedDate !== "" && parseCalendarDate(selectedDate) !== null ? selectedDate : today;
    return clampToBounds(seed, min, max);
    // Read once on open; later draft changes must not recentre the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [visible, setVisible] = useState<YM>(() => monthOf(startDate));
  const [focused, setFocused] = useState<CalendarDate>(startDate);
  const [focusSignal, setFocusSignal] = useState(1);
  const cellRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (focusSignal === 0) return;
    cellRefs.current[focused]?.focus();
    // Only keyboard moves (focusSignal) take DOM focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  // ---- navigation: only moves the view ------------------------------------
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

  // ---- picking -------------------------------------------------------------
  const pickDay = (date: CalendarDate): void => {
    if (isDisabled(date, bounds)) return;
    setFocused(date);
    if (mode === "date") props.onCommit(date);
    else if (mode === "range") setRangeDraft((cur) => nextRange(cur, date, props.allowSameDay === true));
    else setDtDraft((cur) => ({ ...cur, date }));
  };

  const unit = "nights" as const;
  const rangeReady = rangeDraft.start !== "" && rangeDraft.end !== "";
  const doneEnabled = mode === "range" ? rangeReady : dtDraft.date !== "" && dtDraft.time !== "";
  const commit = (): void => {
    if (!doneEnabled) return;
    if (mode === "range") props.onCommit({ start: rangeDraft.start, end: rangeDraft.end });
    else props.onCommit(`${dtDraft.date}T${dtDraft.time}`);
  };
  const clear = (): void => {
    if (props.onClear !== undefined) props.onClear();
    else if (mode === "range") setRangeDraft({ start: "", end: "" });
    else if (mode === "datetime") setDtDraft({ date: "", time: "" });
  };

  // ---- keyboard --------------------------------------------------------------
  const onKeyDown = (event: { key: string; shiftKey?: boolean; preventDefault?: () => void }): void => {
    const result = reduceKeyboard(focused, event, weekStartsOn);
    if (!result.handled) return;
    if (result.action === "dismiss") {
      event.preventDefault?.();
      props.onCancel();
      return;
    }
    // Enter / Space press the focused day's own button; handling it here too would pick twice.
    if (result.action === "pick") return;
    event.preventDefault?.();
    const next = clampToBounds(result.focused, min, max);
    setFocused(next);
    setVisible(monthOf(next));
    setFocusSignal((n) => n + 1);
  };

  // ---- derived -----------------------------------------------------------------
  const monthsShown = mode === "range" && props.months === 2 ? 2 : 1;
  const initials = useMemo(() => weekdayInitials(weekStartsOn, locale), [weekStartsOn, locale]);
  const prevMonth = shiftMonth(visible, -1);
  const nextMonth = shiftMonth(visible, 1);
  const readout = ((): string => {
    if (mode === "range") {
      if (rangeDraft.start === "") return "";
      if (rangeDraft.end === "") return `${formatRangeShort(rangeDraft.start, rangeDraft.start, locale)} · ${labels.pick_last_day}`;
      return [
        formatRangeShort(rangeDraft.start, rangeDraft.end, locale),
        lengthLabel(daysCovered(rangeDraft.start, rangeDraft.end), "days", labels),
        lengthLabel(nights(rangeDraft.start, rangeDraft.end), unit, labels),
      ].join(" · ");
    }
    if (mode === "datetime") {
      if (dtDraft.date === "") return "";
      return dtDraft.time === "" ? formatLongDate(dtDraft.date, locale) : `${formatLongDate(dtDraft.date, locale)} ${labels.at} ${dtDraft.time}`;
    }
    return selectedDate !== "" && parseCalendarDate(selectedDate) !== null ? formatLongDate(selectedDate, locale) : "";
  })();
  const tzDate = selectedDate !== "" && parseCalendarDate(selectedDate) !== null ? selectedDate : firstOf(visible);
  const tzLabel = formatTimezoneLabel(timeZone, tzDate, locale);
  const timeMin = mode === "datetime" && min !== undefined && dtDraft.date === min ? minTimeOnMinDay : undefined;
  const slots = mode === "datetime" ? timeSlots(props.timeStepMinutes ?? 15, timeMin) : [];

  const selection = (date: CalendarDate): { selected: boolean; inRange: boolean; isStart: boolean; isEnd: boolean } => {
    if (mode === "range") {
      const isStart = date === rangeDraft.start;
      const isEnd = date === rangeDraft.end;
      const inRange = rangeReady && compareDates(date, rangeDraft.start) > 0 && compareDates(date, rangeDraft.end) < 0;
      return { selected: isStart || isEnd, inRange, isStart, isEnd };
    }
    return { selected: date === selectedDate, inRange: false, isStart: false, isEnd: false };
  };

  return (
    <div
      className="mc-cal"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "range" ? labels.dialog_title_dates : mode === "datetime" ? labels.dialog_title_date_time : labels.dialog_title_date}
      data-testid={idPrefix}
      onKeyDown={onKeyDown as unknown as React.KeyboardEventHandler<HTMLDivElement>}
    >
      <div className="mc-cal__header">
        <button
          type="button"
          className="mc-cal__nav"
          aria-label={`${labels.previous_month}, ${monthTitle(prevMonth.year, prevMonth.month, locale)}`}
          disabled={!canMoveMonth(-1)}
          onClick={() => onNavigateMonth(-1)}
          data-testid={`${idPrefix}-prev`}
        >
          ‹
        </button>
        <div className="mc-cal__title" aria-live="polite" data-testid={`${idPrefix}-title`}>
          {monthTitle(visible.year, visible.month, locale)}
        </div>
        <button
          type="button"
          className="mc-cal__nav"
          aria-label={`${labels.next_month}, ${monthTitle(nextMonth.year, nextMonth.month, locale)}`}
          disabled={!canMoveMonth(1)}
          onClick={() => onNavigateMonth(1)}
          data-testid={`${idPrefix}-next`}
        >
          ›
        </button>
      </div>

      <div className="mc-cal__months">
        {Array.from({ length: monthsShown }, (_, i) => {
          const ym = shiftMonth(visible, i);
          const rows = monthMatrix(ym.year, ym.month, weekStartsOn);
          return (
            <div key={`${ym.year}-${ym.month}`} className="mc-cal__month">
              {monthsShown === 2 ? <div className="mc-cal__monthlabel">{monthTitle(ym.year, ym.month, locale)}</div> : null}
              <div role="grid" aria-label={monthTitle(ym.year, ym.month, locale)}>
                <div role="row" className="mc-cal__week">
                  {initials.map((initial, idx) => (
                    <div key={idx} role="columnheader" className="mc-cal__weekday" aria-hidden="true">
                      {initial}
                    </div>
                  ))}
                </div>
                {rows.map((row, r) => (
                  <div role="row" className="mc-cal__week" key={r}>
                    {row.map((cell) => {
                      if (!cell.inMonth) return <div key={cell.date} role="gridcell" className="mc-cal__cell mc-cal__cell--empty" />;
                      const disabled = isDisabled(cell.date, bounds);
                      const sel = selection(cell.date);
                      const spoken = [
                        dayA11yLabel(cell.date, locale),
                        cell.date === today ? labels.today : null,
                        disabled ? labels.unavailable : null,
                        mode === "range" && sel.isStart ? labels.range_start : null,
                        mode === "range" && sel.isEnd ? labels.range_end : null,
                        sel.inRange ? labels.in_range : null,
                      ]
                        .filter((p): p is string => p !== null)
                        .join(", ");
                      return (
                        <div role="gridcell" key={cell.date} className={`mc-cal__cell${sel.inRange ? " mc-cal__cell--range" : ""}`}>
                          <button
                            type="button"
                            ref={(node) => {
                              cellRefs.current[cell.date] = node;
                            }}
                            className={`mc-cal__day${sel.selected ? " mc-cal__day--selected" : ""}${cell.date === today ? " mc-cal__day--today" : ""}`}
                            aria-label={spoken}
                            aria-pressed={sel.selected}
                            disabled={disabled}
                            tabIndex={cell.date === focused ? 0 : -1}
                            onClick={() => pickDay(cell.date)}
                            data-testid={`${idPrefix}-day-${cell.date}`}
                          >
                            {Number(cell.date.slice(8, 10))}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {mode === "datetime" ? (
        <div className="mc-cal__times" role="listbox" aria-label={labels.time_heading}>
          {slots.map((slot) => (
            <button
              type="button"
              key={slot}
              role="option"
              aria-selected={slot === dtDraft.time}
              className={`mc-cal__time${slot === dtDraft.time ? " mc-cal__time--selected" : ""}`}
              onClick={() => setDtDraft((cur) => ({ ...cur, time: slot }))}
              data-testid={`${idPrefix}-time-${slot}`}
            >
              {slot}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mc-cal__footer">
        <div className="mc-cal__readout" aria-live="polite" data-testid={`${idPrefix}-readout`}>
          {readout}
        </div>
        <div className="mc-cal__tz" data-testid={`${idPrefix}-tz`}>
          {tzLabel}
        </div>
        {mode !== "date" || props.onClear !== undefined ? (
          <div className="mc-cal__actions">
            {mode !== "date" || props.onClear !== undefined ? (
              <button type="button" className="mc-cal__btn mc-cal__btn--quiet" onClick={clear} data-testid={`${idPrefix}-clear`}>
                {labels.clear}
              </button>
            ) : null}
            {mode !== "date" ? (
              <button type="button" className="mc-cal__btn" disabled={!doneEnabled} onClick={commit} data-testid={`${idPrefix}-done`}>
                {labels.done}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
