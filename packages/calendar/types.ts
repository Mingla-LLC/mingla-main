import type { ComponentType, ReactNode } from "react";

import type { CalendarDate } from "./core/calendarDate";
import type { CalendarLabels } from "./core/labels";
import type { RangeUnit } from "./core/rangeRules";

export type { CalendarDate } from "./core/calendarDate";
export type { CalendarLabels } from "./core/labels";
export type { RangeUnit } from "./core/rangeRules";

/** "HH:mm", 24-hour, wall clock in the field's time zone. */
export type WallTime = string;

/** Colours and shape, injected by the host app. No literal lives in the package. */
export interface CalendarTokens {
  surface: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  fieldFill: string;
  /** Selected day fill, and its text colour. */
  selectedFill: string;
  onSelected: string;
  /** In-range band behind the days between the two ends. */
  rangeFill: string;
  /** The small dot under today. */
  todayDot: string;
  error: string;
  radius: number;
  dayRadius: number;
}

export type CalendarIconName = "calendar" | "chevron-left" | "chevron-right" | "close" | "clock";

export interface CalendarSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The dialog title. The host's sheet renders it, with its own close button. */
  title: string;
  /** Accessibility label for the close button. */
  closeLabel: string;
  children: ReactNode;
  testID?: string;
}

/** The host's own presentation pieces. The package never owns a sheet. */
export interface CalendarPrimitives {
  Sheet: ComponentType<CalendarSheetProps>;
  /** Optional icon renderer; text glyphs are used when absent. */
  renderIcon?: (name: CalendarIconName, color: string, size: number) => ReactNode;
}

export interface CalendarConfig {
  tokens: CalendarTokens;
  primitives: CalendarPrimitives;
}

/** Props shared by every field and the bare surface. */
export interface CalendarCommon {
  label: string;
  accessibilityLabel?: string;
  /** IANA zone. Shown in the footer; "today" is computed in it. */
  timeZone: string;
  min?: CalendarDate;
  max?: CalendarDate;
  isDateDisabled?: (date: CalendarDate) => boolean;
  placeholder?: string;
  disabled?: boolean;
  error?: string | null;
  /** Mount with the calendar already open (a tap made while the field was still loading). */
  defaultOpen?: boolean;
  /** Error border without a message (callers that show their own text). */
  invalid?: boolean;
  hint?: string;
  weekStartsOn?: 0 | 1;
  testID?: string;
  labels?: Partial<CalendarLabels>;
  /** Overrides the provider; one of the two must exist. */
  config?: CalendarConfig;
  /** BCP 47 locale for month and day names. */
  locale?: string;
}

export interface RangeValue {
  start: CalendarDate | "";
  end: CalendarDate | "";
}

export interface DateTimeValue {
  date: CalendarDate | "";
  time: WallTime;
}

export type { RangeUnit as CalendarRangeUnit };
