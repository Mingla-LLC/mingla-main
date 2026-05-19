/**
 * Ve2 — map place_pool.opening_hours (Google jsonb) → brand_hours wizard rows.
 */

import type { BrandHourEntry } from "../types/brand";
import { defaultBrandHoursWeek } from "./venueBrandHours";

interface GoogleTimePoint {
  day?: number;
  hour?: number;
  minute?: number;
}

interface GooglePeriod {
  open?: GoogleTimePoint;
  close?: GoogleTimePoint;
}

interface GoogleOpeningHours {
  periods?: GooglePeriod[];
}

/** Google Places day 0=Sunday; brand_hours weekday 0=Monday. */
function googleDayToWeekday(googleDay: number): number {
  if (googleDay === 0) return 6;
  return googleDay - 1;
}

function formatHm(hour: number, minute: number): string {
  const h = String(hour).padStart(2, "0");
  const m = String(minute).padStart(2, "0");
  return `${h}:${m}`;
}

export function mapPoolOpeningHoursToBrandHours(
  openingHours: unknown | null | undefined,
): BrandHourEntry[] {
  if (openingHours === null || openingHours === undefined) {
    return defaultBrandHoursWeek();
  }
  if (typeof openingHours !== "object") {
    return defaultBrandHoursWeek();
  }

  const raw = openingHours as GoogleOpeningHours;
  const periods = raw.periods;
  if (!Array.isArray(periods) || periods.length === 0) {
    return defaultBrandHoursWeek();
  }

  const byWeekday = new Map<number, BrandHourEntry>();
  for (let w = 0; w <= 6; w++) {
    byWeekday.set(w, {
      weekday: w,
      openTime: null,
      closeTime: null,
      isClosed: true,
    });
  }

  for (const period of periods) {
    const open = period.open;
    const close = period.close;
    if (
      open?.day === undefined ||
      open.hour === undefined ||
      open.minute === undefined ||
      close?.hour === undefined ||
      close.minute === undefined
    ) {
      continue;
    }
    const weekday = googleDayToWeekday(open.day);
    if (byWeekday.get(weekday)?.isClosed === false) {
      continue;
    }
    byWeekday.set(weekday, {
      weekday,
      openTime: formatHm(open.hour, open.minute),
      closeTime: formatHm(close.hour, close.minute),
      isClosed: false,
    });
  }

  return Array.from(byWeekday.values()).sort((a, b) => a.weekday - b.weekday);
}
