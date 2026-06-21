/**
 * experienceAvailabilityBanner — ORCH-1186 Fix 1 (the ONE adaptive availability
 * banner, computed from the normalized experience data).
 *
 * THE single source of truth for the availability copy on the public EXPERIENCE
 * page, consumed by the shared `ExperienceOfferingBody` so EVERY surface
 * (consumer iOS/Android + business/web /exp/) shows identical, correct copy.
 * Replaces three forked/partial signals:
 *   • the misleading "start" pill (soonest occurrence start — wrong for open-daily),
 *   • the surface-injected open-daily hours strip (rendered only on business/web), and
 *   • the fixed/single-date "dates" meta chip.
 *
 * Pure + dep-free (Intl only — NO react-native import), mirroring
 * experienceOpenDaily.ts, so it's deno-unit-testable and keeps
 * I-MOR-0827-PACKAGE-ISOLATION (no app src/ import).
 *
 * Cases (in order):
 *   • Open-daily (recurring): "Open daily · {open}–{close}" + "Reserve any upcoming day"
 *     (falls back to "Open daily" when no occurrence window is materialized).
 *   • Fixed slots (≥2 dates): "{N} upcoming dates" + "Next {Wed 17 Jun, 7:00 PM}".
 *   • Single date: "{Wed 17 Jun}" + "{7:00 PM}".
 *   • No date but bookable → "Available anytime" (no sub).
 *   • Genuinely no signal AND not bookable → null (render nothing — rule 9).
 */

/** The minimal occurrence shape the banner reads. */
export interface AvailabilityOccurrence {
  startAt: string;
  endAt: string;
}

export interface AvailabilityBannerInput {
  /** events.is_recurring daily/never (the restaurant-style open-daily rule). */
  openDaily: boolean;
  /** Materialized bookable occurrences (event_dates). */
  occurrences: ReadonlyArray<AvailabilityOccurrence>;
  /** IANA timezone for the Intl formats. */
  timezone: string;
  /** false → unbookable; suppresses the "Available anytime" no-date fallback. */
  bookable: boolean;
}

export interface AvailabilityBanner {
  primary: string;
  sub: string | null;
}

export function experienceAvailabilityBanner(
  input: AvailabilityBannerInput,
): AvailabilityBanner | null {
  const tz = input.timezone || "UTC";

  const fmtTime = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        timeZone: tz,
      }).format(d);
    } catch {
      return new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
    }
  };

  const fmtDay = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: tz,
      }).format(d);
    } catch {
      return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(d);
    }
  };

  // Future-first, chronologically sorted occurrences (mirror the adapters).
  const sorted = input.occurrences
    .map((o) => ({ o, ms: new Date(o.startAt).getTime() }))
    .filter((x) => Number.isFinite(x.ms))
    .sort((a, b) => a.ms - b.ms)
    .map((x) => x.o);

  // Open-daily (restaurant-style) — the rule is authoritative regardless of count.
  if (input.openDaily) {
    const first = sorted[0];
    if (first !== undefined) {
      const open = fmtTime(first.startAt);
      const close = fmtTime(first.endAt);
      if (open.length > 0 && close.length > 0) {
        return {
          primary: `Open daily · ${open}–${close}`,
          sub: "Reserve any upcoming day",
        };
      }
    }
    return { primary: "Open daily", sub: "Reserve any upcoming day" };
  }

  // Fixed slots.
  if (sorted.length >= 2) {
    const next = sorted[0];
    const day = fmtDay(next.startAt);
    const time = fmtTime(next.startAt);
    const nextLabel =
      day.length > 0 && time.length > 0
        ? `Next ${day}, ${time}`
        : day.length > 0
          ? `Next ${day}`
          : null;
    return { primary: `${sorted.length} upcoming dates`, sub: nextLabel };
  }

  // Single date.
  if (sorted.length === 1) {
    const only = sorted[0];
    const day = fmtDay(only.startAt);
    const time = fmtTime(only.startAt);
    if (day.length > 0) {
      return { primary: day, sub: time.length > 0 ? time : null };
    }
  }

  // No date signal — always-available when bookable, else render nothing.
  if (input.bookable) {
    return { primary: "Available anytime", sub: null };
  }
  return null;
}
