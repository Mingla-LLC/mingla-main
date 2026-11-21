/**
 * CalendarInput (#4523): a button that shows the chosen date (or date and time)
 * and opens the Mingla calendar in a popover under it. It replaces a browser
 * `<input type="date" | "datetime-local">`:
 *
 * - Same value shapes: "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm".
 * - `onChange` receives an input-like event ({ target: { value, name } }) so the
 *   handlers written for the native input keep working unchanged.
 * - `name` writes a hidden `<input type="hidden" name=...>` so a plain GET/POST
 *   form still submits the value.
 * - Escape closes it and focus returns to the button; outside click closes it and
 *   discards the draft. Changing month never closes it.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import { formatLongDate, mergeLabels, type CalendarLabels } from "../core/labels";
import { parseCalendarDate } from "../core/calendarDate";
import { Calendar, type CalendarMode } from "./Calendar";

export interface CalendarChange {
  target: { value: string; name: string | undefined };
  currentTarget: { value: string; name: string | undefined };
}

export interface CalendarInputProps {
  mode: "date" | "datetime";
  /** Controlled value. Omit it and use `defaultValue` for an uncontrolled field. */
  value?: string;
  defaultValue?: string;
  onChange?: (event: CalendarChange) => void;
  /** Writes a hidden input with this name so a plain form submits the value. */
  name?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  required?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
  /** IANA zone. Defaults to the operator's own zone. */
  timeZone?: string;
  /** Optional field: shows Clear, which commits "". */
  clearable?: boolean;
  timeStepMinutes?: 5 | 15 | 30;
  labels?: Partial<CalendarLabels>;
  locale?: string;
  isDateDisabled?: (date: string) => boolean;
}

const deviceZone = (): string => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : "UTC";
  } catch {
    // Intl zone data unavailable: the calendar footer then names UTC plainly.
    return "UTC";
  }
};

function display(value: string, mode: "date" | "datetime", labels: CalendarLabels, locale?: string): string {
  const day = value.slice(0, 10);
  if (parseCalendarDate(day) === null) return "";
  const long = formatLongDate(day, locale);
  return mode === "datetime" && value.length >= 16 ? `${long} ${labels.at} ${value.slice(11, 16)}` : long;
}

export const CalendarInput = React.forwardRef<HTMLButtonElement, CalendarInputProps>(function CalendarInput(props, forwardedRef): React.ReactElement {
  const { mode, name, disabled = false, className, id, timeZone = deviceZone(), locale, clearable = false } = props;
  const labels = mergeLabels(props.labels);
  const reactId = useId();
  const baseId = id ?? `mc-${reactId.replace(/:/g, "")}`;
  const [inner, setInner] = useState<string>(props.defaultValue ?? "");
  const controlled = props.value !== undefined;
  const value = controlled ? (props.value as string) : inner;
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const setButtonRef = useCallback(
    (node: HTMLButtonElement | null): void => {
      buttonRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef !== null) forwardedRef.current = node;
    },
    [forwardedRef],
  );
  const rootRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback((): void => {
    setOpen(false);
    // Focus returns to the trigger on close.
    buttonRef.current?.focus();
  }, []);

  const commit = (next: string): void => {
    if (!controlled) setInner(next);
    props.onChange?.({ target: { value: next, name }, currentTarget: { value: next, name } });
    close();
  };

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const onPointer = (event: MouseEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return (): void => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const text = display(value, mode, labels, locale);
  const calendarMode: CalendarMode = mode;
  const outOfBounds =
    value !== "" &&
    ((props.min !== undefined && value.slice(0, props.min.length) < props.min) || (props.max !== undefined && value.slice(0, props.max.length) > props.max));

  return (
    <div className="mc-input" ref={rootRef}>
      <button
        type="button"
        ref={setButtonRef}
        id={baseId}
        className={`mc-input__button${className !== undefined ? ` ${className}` : ""}${outOfBounds ? " mc-input__button--invalid" : ""}`}
        aria-haspopup="dialog"
        aria-invalid={props["aria-invalid"]}
        aria-describedby={props["aria-describedby"]}
        aria-required={props.required}
        aria-expanded={open}
        aria-label={`${props["aria-label"] ?? ""}${props["aria-label"] !== undefined ? ", " : ""}${text !== "" ? text : labels.not_set}`}
        disabled={disabled}
        onBlur={props.onBlur}
        onFocus={props.onFocus}
        onClick={() => setOpen((cur) => !cur)}
        data-testid={`${baseId}-button`}
      >
        <span className={text === "" ? "mc-input__placeholder" : undefined}>
          {text !== "" ? text : (props.placeholder ?? (mode === "datetime" ? labels.choose_date_time : labels.choose_date))}
        </span>
      </button>
      {name !== undefined ? <input type="hidden" name={name} value={value} /> : null}
      {open ? (
        <div
          className="mc-input__popover"
          onClick={(event) => {
            // Inside a <label>, a click on non-interactive popover content would re-activate the trigger.
            if (!(event.target instanceof HTMLElement) || event.target.closest("button") === null) event.preventDefault();
          }}
        >
          <Calendar
            mode={calendarMode}
            value={value}
            min={props.min}
            max={props.max}
            isDateDisabled={props.isDateDisabled}
            timeZone={timeZone}
            timeStepMinutes={props.timeStepMinutes}
            labels={props.labels}
            locale={locale}
            idPrefix={baseId}
            onCommit={(next) => commit(typeof next === "string" ? next : "")}
            onClear={clearable ? () => commit("") : undefined}
            onCancel={close}
          />
        </div>
      ) : null}
    </div>
  );
});
