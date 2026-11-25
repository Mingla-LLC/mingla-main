/**
 * #4490 fix 3 (N114) — the waitlist seat sheet's days and "Now" (pure; pinned by test).
 */
import { shortDay } from "./features/bookings/bookingModel";

/** The venue's local date of an instant ("2026-11-21"); the device's when the zone is unknown. */
function localIso(at: Date, timeZone: string | undefined): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
  } catch {
    // fall through to the device date
  }
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/**
 * #4490 fix 3 (N114) — the next days, day first like the rest of the
 * workspace ("Today", "Tomorrow", "Sat 21 Nov"), in the venue's time zone.
 */
export function nextDates(count: number, timeZone?: string, now: Date = new Date()): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  const first = localIso(now, timeZone);
  for (let i = 0; i < count; i += 1) {
    const d = new Date(`${first}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ iso, label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : shortDay(iso) });
  }
  return out;
}

/** The "Now" choice: today, while the venue takes tables (its first time has come and its last is not long gone). */
export const NOW_SLOT = "now";
export function venueOpenNow(
  slots: ReadonlyArray<{ slotStartUtc: string }>,
  now: number = Date.now(),
): boolean {
  if (slots.length === 0) return false;
  const starts = slots.map((s) => Date.parse(s.slotStartUtc)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (starts.length === 0) return false;
  return starts[0] <= now + 30 * 60_000 && starts[starts.length - 1] >= now - 2 * 60 * 60_000;
}
