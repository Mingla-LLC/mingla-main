import type {
  Reservation,
  ReservationStatus,
} from "../../types/venueReservation";

export type ReservationCalendarMode = "agenda" | "week" | "month";
export type ReservationStatusScope =
  | "active"
  | "waitlist"
  | "completed"
  | "no_shows"
  | "canceled";

export interface ReservationCalendarDay {
  key: string;
  inAnchorMonth: boolean;
}

export interface ReservationCalendarRange {
  startKey: string;
  endKey: string;
  days: ReservationCalendarDay[];
}

export interface ResolvedVenueTimeZone {
  timeZone: string;
  degraded: boolean;
}

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const STATUS_SCOPE_MEMBERS: Record<
  ReservationStatusScope,
  readonly ReservationStatus[]
> = {
  active: ["requested", "confirmed", "seated"],
  waitlist: ["waitlisted"],
  completed: ["completed"],
  no_shows: ["no_show"],
  canceled: ["cancelled_by_guest", "cancelled_by_venue"],
};

const parseDayKey = (dayKey: string): Date => {
  const match = DAY_KEY_PATTERN.exec(dayKey);
  if (match === null) throw new Error(`invalid_calendar_day:${dayKey}`);
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12),
  );
};

const keyFromUtcDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const resolveVenueTimeZone = (
  candidate: string | null | undefined,
): ResolvedVenueTimeZone => {
  if (candidate === null || candidate === undefined || candidate.trim() === "") {
    return { timeZone: "UTC", degraded: true };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return { timeZone: candidate, degraded: false };
  } catch {
    return { timeZone: "UTC", degraded: true };
  }
};

export const venueDayKeyForInstant = (
  instantIso: string,
  timeZone: string,
): string => {
  const instant = new Date(instantIso);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error(`invalid_reservation_instant:${instantIso}`);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
};

export const venueTodayKey = (timeZone: string, now: Date = new Date()): string =>
  venueDayKeyForInstant(now.toISOString(), timeZone);

export const addCalendarDays = (dayKey: string, days: number): string => {
  const date = parseDayKey(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return keyFromUtcDate(date);
};

export const startOfCalendarWeek = (dayKey: string): string => {
  const date = parseDayKey(dayKey);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addCalendarDays(dayKey, -mondayOffset);
};

export const calendarWeek = (anchorKey: string): ReservationCalendarRange => {
  const startKey = startOfCalendarWeek(anchorKey);
  const days = Array.from({ length: 7 }, (_, index) => ({
    key: addCalendarDays(startKey, index),
    inAnchorMonth: true,
  }));
  return { startKey, endKey: days[6].key, days };
};

export const calendarMonth = (anchorKey: string): ReservationCalendarRange => {
  const anchor = parseDayKey(anchorKey);
  const firstKey = keyFromUtcDate(
    new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12)),
  );
  const startKey = startOfCalendarWeek(firstKey);
  const anchorMonth = anchor.getUTCMonth();
  const days = Array.from({ length: 42 }, (_, index) => {
    const key = addCalendarDays(startKey, index);
    return { key, inAnchorMonth: parseDayKey(key).getUTCMonth() === anchorMonth };
  });
  return { startKey, endKey: days[41].key, days };
};

export const calendarRange = (
  anchorKey: string,
  mode: ReservationCalendarMode,
): ReservationCalendarRange =>
  mode === "month" ? calendarMonth(anchorKey) : calendarWeek(anchorKey);

export const moveCalendarPeriod = (
  anchorKey: string,
  mode: ReservationCalendarMode,
  direction: -1 | 1,
): string => {
  if (mode !== "month") return addCalendarDays(anchorKey, direction * 7);
  const date = parseDayKey(anchorKey);
  return keyFromUtcDate(
    new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth() + direction,
        Math.min(date.getUTCDate(), 28),
        12,
      ),
    ),
  );
};

export const reservationMatchesScope = (
  reservation: Reservation,
  scope: ReservationStatusScope,
): boolean => STATUS_SCOPE_MEMBERS[scope].includes(reservation.status);

export const stableSortReservations = (
  reservations: readonly Reservation[],
): Reservation[] =>
  [...reservations].sort((left, right) => {
    const timeDelta =
      new Date(left.reservedFor).getTime() - new Date(right.reservedFor).getTime();
    if (timeDelta !== 0) return timeDelta;
    const createdDelta =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return createdDelta !== 0 ? createdDelta : left.id.localeCompare(right.id);
  });

export const projectReservations = (
  reservations: readonly Reservation[],
  range: ReservationCalendarRange,
  scope: ReservationStatusScope,
  timeZone: string,
): Reservation[] =>
  stableSortReservations(
    reservations.filter((reservation) => {
      if (!reservationMatchesScope(reservation, scope)) return false;
      const key = venueDayKeyForInstant(reservation.reservedFor, timeZone);
      return key >= range.startKey && key <= range.endKey;
    }),
  );

export const groupReservationsByVenueDay = (
  reservations: readonly Reservation[],
  timeZone: string,
): ReadonlyMap<string, Reservation[]> => {
  const grouped = new Map<string, Reservation[]>();
  for (const reservation of stableSortReservations(reservations)) {
    const key = venueDayKeyForInstant(reservation.reservedFor, timeZone);
    const existing = grouped.get(key) ?? [];
    grouped.set(key, [...existing, reservation]);
  }
  return grouped;
};

export const reservationScopeCounts = (
  reservations: readonly Reservation[],
  range: ReservationCalendarRange,
  timeZone: string,
): Record<ReservationStatusScope, number> => ({
  active: projectReservations(reservations, range, "active", timeZone).length,
  waitlist: projectReservations(reservations, range, "waitlist", timeZone).length,
  completed: projectReservations(reservations, range, "completed", timeZone).length,
  no_shows: projectReservations(reservations, range, "no_shows", timeZone).length,
  canceled: projectReservations(reservations, range, "canceled", timeZone).length,
});

export const formatCalendarDay = (
  dayKey: string,
  options: Intl.DateTimeFormatOptions,
): string => new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(parseDayKey(dayKey));

export const formatReservationTime = (
  instantIso: string,
  timeZone: string,
): string =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instantIso));

export const formatReservationDateTime = (
  instantIso: string,
  timeZone: string,
): string =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instantIso));

export const formatCalendarPeriod = (
  anchorKey: string,
  mode: ReservationCalendarMode,
): string => {
  if (mode === "month") {
    return formatCalendarDay(anchorKey, { month: "long", year: "numeric" });
  }
  const range = calendarWeek(anchorKey);
  const start = formatCalendarDay(range.startKey, { month: "short", day: "numeric" });
  const end = formatCalendarDay(range.endKey, {
    month:
      parseDayKey(range.startKey).getUTCMonth() ===
      parseDayKey(range.endKey).getUTCMonth()
        ? undefined
        : "short",
    day: "numeric",
    year: "numeric",
  });
  return `${start}–${end}`;
};

export interface MonthDayProjection {
  visible: Reservation[];
  overflowCount: number;
}

export const projectMonthDay = (
  reservations: readonly Reservation[],
  visibleLimit: number,
): MonthDayProjection => {
  const ordered = stableSortReservations(reservations);
  if (ordered.length <= visibleLimit) {
    return { visible: ordered, overflowCount: 0 };
  }
  return { visible: ordered.slice(0, 1), overflowCount: ordered.length - 1 };
};
