import { addDays, addMonths, addYears, weekdayOf, type CalendarDate } from "./calendarDate";

export interface KeyInput {
  readonly key: string;
  readonly shiftKey?: boolean;
}

export type KeyAction = "pick" | "dismiss" | null;

export interface KeyResult {
  /** The day that now has focus. Moving it never closes the calendar. */
  readonly focused: CalendarDate;
  /** `pick` = Enter/Space on the focused day, `dismiss` = Escape. */
  readonly action: KeyAction;
  /** True when the key was one the calendar handles (caller may preventDefault). */
  readonly handled: boolean;
}

/** Pure keyboard model for the day grid. */
export function reduceKeyboard(
  focused: CalendarDate,
  input: KeyInput,
  weekStart: 0 | 1,
): KeyResult {
  const move = (next: CalendarDate): KeyResult => ({ focused: next, action: null, handled: true });
  switch (input.key) {
    case "ArrowLeft":
      return move(addDays(focused, -1));
    case "ArrowRight":
      return move(addDays(focused, 1));
    case "ArrowUp":
      return move(addDays(focused, -7));
    case "ArrowDown":
      return move(addDays(focused, 7));
    case "PageUp":
      return move(input.shiftKey === true ? addYears(focused, -1) : addMonths(focused, -1));
    case "PageDown":
      return move(input.shiftKey === true ? addYears(focused, 1) : addMonths(focused, 1));
    case "Home":
      return move(addDays(focused, -((weekdayOf(focused) - weekStart + 7) % 7)));
    case "End":
      return move(addDays(focused, 6 - ((weekdayOf(focused) - weekStart + 7) % 7)));
    case "Enter":
    case " ":
      return { focused, action: "pick", handled: true };
    case "Escape":
      return { focused, action: "dismiss", handled: true };
    default:
      return { focused, action: null, handled: false };
  }
}
