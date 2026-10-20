/**
 * experienceBookingSettings — issue #3281 Round 3 (3c).
 *
 * Pure owner of the experience "booking spacing" + "minimum notice" choices the
 * host authors on the When step and ships as `booking_spacing_minutes` /
 * `min_notice_minutes`. The server constraints (events_booking_spacing_minutes_check,
 * min_notice 0..10080) are the authority; these are the options the host sees.
 */

export const EXPERIENCE_SPACING_OPTIONS = [15, 30, 60, 120] as const;
export type ExperienceSpacingMinutes =
  (typeof EXPERIENCE_SPACING_OPTIONS)[number];

export const EXPERIENCE_DEFAULT_SPACING_MINUTES: ExperienceSpacingMinutes = 30;
export const EXPERIENCE_DEFAULT_MIN_NOTICE_MINUTES = 120;

/** Minimum-notice choices in minutes (0 = guests can book right up to the start). */
export const EXPERIENCE_MIN_NOTICE_OPTIONS = [
  0, 30, 60, 120, 240, 1440,
] as const;

export function normalizeExperienceSpacing(
  raw: unknown,
): ExperienceSpacingMinutes {
  return (EXPERIENCE_SPACING_OPTIONS as ReadonlyArray<number>).includes(
    raw as number,
  )
    ? (raw as ExperienceSpacingMinutes)
    : EXPERIENCE_DEFAULT_SPACING_MINUTES;
}

export function normalizeExperienceMinNotice(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return EXPERIENCE_DEFAULT_MIN_NOTICE_MINUTES;
  }
  const n = Math.round(raw);
  if (n < 0 || n > 10080) return EXPERIENCE_DEFAULT_MIN_NOTICE_MINUTES;
  return n;
}

export function experienceSpacingLabel(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  return `${minutes} min`;
}

export function experienceMinNoticeLabel(minutes: number): string {
  if (minutes <= 0) return "None";
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? "1 day" : `${d} days`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "1 hour" : `${h} hours`;
  }
  return `${minutes} min`;
}

/**
 * Stop offset (minutes after the booked start) → whole minutes, or null when
 * unset / invalid. Negative and non-finite offsets are treated as unset.
 */
export function normalizeStopStartOffset(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  return n >= 0 && n <= 1440 ? n : null;
}
