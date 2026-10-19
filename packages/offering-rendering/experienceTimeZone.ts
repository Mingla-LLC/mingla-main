/**
 * experienceTimeZone — issue #3281 Round 1 (zone-correct experience open hours).
 *
 * THE single owner for turning an experience occurrence's [startAt, endAt]
 * window into clock minutes and readable time labels **in the experience's
 * IANA zone**, never the viewer's local `Date#getHours()`. Both Host and
 * Explorer reserve pickers import this so a Lagos 10:00–18:00 window stays
 * 10:00–18:00 when the buyer is in New York.
 *
 * Pure + dep-free (I-MOR-0827-PACKAGE-ISOLATION).
 */

export interface ExperienceWindowMinutes {
  /** Minutes from midnight in `timeZone` at startAt (0..1439, or higher when
   * the window wraps past midnight — then `close` is open + duration). */
  open: number;
  close: number;
}

const wallParts = (
  iso: string,
  timeZone: string,
): { hour: number; minute: number } | null => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return { hour, minute };
  } catch {
    return null;
  }
};

/**
 * Bound clock minutes [open, close] of an occurrence window in `timeZone`.
 * Close is shifted +24h when the window wraps past midnight.
 */
export const experienceWindowMinutes = (
  startAt: string,
  endAt: string,
  timeZone: string,
): ExperienceWindowMinutes | null => {
  const s = wallParts(startAt, timeZone);
  const e = wallParts(endAt, timeZone);
  if (s === null || e === null) return null;
  const open = s.hour * 60 + s.minute;
  let close = e.hour * 60 + e.minute;
  if (close <= open) close += 24 * 60;
  return { open, close };
};

/**
 * Minutes to add to `startAt`'s instant for a grid choice built like
 * `experienceTimeChoices` (same end-exclusive loop). null when
 * `selectedMinute` is not on the grid inside the window.
 */
export const experienceMinuteOffsetFromOpen = (
  startAt: string,
  endAt: string,
  timeZone: string,
  selectedMinute: number,
  stepMinutes: number = 30,
): number | null => {
  const w = experienceWindowMinutes(startAt, endAt, timeZone);
  if (w === null) return null;
  const step = stepMinutes > 0 ? stepMinutes : 30;
  const day = 24 * 60;
  for (let m = w.open; m < w.close; m += step) {
    if (m % day === selectedMinute) return m - w.open;
  }
  return null;
};

/**
 * ISO instant for the buyer's open-daily time choice, or null when invalid.
 * Probes real instants from `startAt` so DST transitions keep the selected
 * wall clock (issue #3281) instead of adding wall-minute deltas to UTC.
 */
export const experienceBookedStartIso = (
  startAt: string,
  endAt: string,
  timeZone: string,
  selectedMinute: number,
  stepMinutes: number = 30,
): string | null => {
  if (experienceMinuteOffsetFromOpen(
    startAt,
    endAt,
    timeZone,
    selectedMinute,
    stepMinutes,
  ) === null) {
    return null;
  }
  const base = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(base) || !Number.isFinite(end) || end <= base) {
    return null;
  }
  const step = stepMinutes > 0 ? stepMinutes : 30;
  const stepMs = step * 60_000;
  const want = ((selectedMinute % (24 * 60)) + 24 * 60) % (24 * 60);
  for (let t = base; t < end; t += stepMs) {
    const parts = wallParts(new Date(t).toISOString(), timeZone);
    if (parts === null) continue;
    if (parts.hour * 60 + parts.minute === want) {
      return new Date(t).toISOString();
    }
  }
  return null;
};

/**
 * 30-minute (or `stepMinutes`) grid inside the window, each entry 0..1439.
 * End-exclusive: a 10:00–18:00 window offers through 17:30, matching SQL
 * `booked_start_at < event_dates.end_at` (issue #3281 Copilot).
 *
 * Only offers minutes that resolve to a real instant (spring-forward gaps
 * excluded) and that are still in the future relative to `nowMs`.
 */
export const experienceTimeChoices = (
  startAt: string,
  endAt: string,
  timeZone: string,
  stepMinutes: number = 30,
  nowMs: number = Date.now(),
): number[] => {
  const w = experienceWindowMinutes(startAt, endAt, timeZone);
  if (w === null) return [];
  const step = stepMinutes > 0 ? stepMinutes : 30;
  const out: number[] = [];
  for (let m = w.open; m < w.close; m += step) {
    const minute = m % (24 * 60);
    const iso = experienceBookedStartIso(
      startAt,
      endAt,
      timeZone,
      minute,
      step,
    );
    if (iso === null) continue;
    if (Date.parse(iso) < nowMs) continue;
    out.push(minute);
  }
  return out;
};

/** Format minutes-from-midnight as "10:00 AM" (experience zone, not device). */
export const formatExperienceMinute = (min: number): string => {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
};

/**
 * Short city label for a zone ("Lagos", "New York"). Empty when the zone
 * string is unknown / UTC-only.
 */
export const experienceZoneCityLabel = (timeZone: string): string => {
  const tz = (timeZone || "").trim();
  if (tz.length === 0 || tz === "UTC") return "";
  const slash = tz.lastIndexOf("/");
  const raw = slash >= 0 ? tz.slice(slash + 1) : tz;
  return raw.replace(/_/g, " ");
};

/**
 * True when the viewer's resolved zone differs from the experience zone —
 * the picker then shows e.g. "Lagos time" next to the window.
 */
export const experienceZoneDiffersFromViewer = (
  experienceZone: string,
  viewerZone?: string | null,
): boolean => {
  const exp = (experienceZone || "UTC").trim();
  let viewer = (viewerZone ?? "").trim();
  if (viewer.length === 0) {
    try {
      viewer = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      viewer = "";
    }
  }
  if (viewer.length === 0) return false;
  return exp !== viewer;
};
