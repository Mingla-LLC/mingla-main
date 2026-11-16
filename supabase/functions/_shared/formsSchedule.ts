// formsSchedule.ts — #4452 §5.3: 10:00 in the person's time zone, skip weekends.
//
// The TS twin of public.forms_next_local_time (M3). Pure: no imports. Every
// local↔UTC conversion uses the zone's own rules through Intl (an offset search),
// so DST changes land correctly. Callers clamp a result in the past to now.

/** The wall-clock parts of an instant in a zone. */
function partsIn(ms: number, tz: string): { y: number; m: number; d: number; hh: number; mm: number; ss: number; dow: number } {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const dows: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second, dow: dows[p.weekday] };
}

/** The UTC instant of a local wall-clock time in a zone (DST-safe). */
export function localToUtc(y: number, m: number, d: number, hh: number, mm: number, ss: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(t, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    t = t - (asUtc - guess);
  }
  return t;
}

export function validZoneOrUtc(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function addDays(y: number, m: number, d: number, n: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function isoDow(y: number, m: number, d: number): number {
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function nextLocalTime(
  fromUtcMs: number,
  tzRaw: string | null,
  n: number,
  unit: "hours" | "days" | "weeks",
  at10: boolean,
  skipWeekends: boolean,
): number {
  const tz = validZoneOrUtc(tzRaw);
  let t: number;
  if (unit === "hours") {
    t = fromUtcMs + n * 3_600_000;
    if (at10) {
      const p = partsIn(t, tz);
      let cand = localToUtc(p.y, p.m, p.d, 10, 0, 0, tz);
      if (cand < t) {
        const nx = addDays(p.y, p.m, p.d, 1);
        cand = localToUtc(nx.y, nx.m, nx.d, 10, 0, 0, tz);
      }
      t = cand;
    }
  } else {
    const p = partsIn(fromUtcMs, tz);
    let day = { y: p.y, m: p.m, d: p.d };
    if (unit === "weeks") day = addDays(day.y, day.m, day.d, 7 * n);
    else if (skipWeekends) {
      let left = n;
      while (left > 0) {
        day = addDays(day.y, day.m, day.d, 1);
        if (isoDow(day.y, day.m, day.d) < 6) left -= 1;
      }
    } else day = addDays(day.y, day.m, day.d, n);
    t = at10 ? localToUtc(day.y, day.m, day.d, 10, 0, 0, tz) : localToUtc(day.y, day.m, day.d, p.hh, p.mm, p.ss, tz);
  }
  if (skipWeekends) {
    const p = partsIn(t, tz);
    if (p.dow >= 6) {
      const mon = addDays(p.y, p.m, p.d, 8 - p.dow);
      t = localToUtc(mon.y, mon.m, mon.d, p.hh, p.mm, p.ss, tz);
    }
  }
  return t;
}
