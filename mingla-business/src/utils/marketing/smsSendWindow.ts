/**
 * ORCH-1270 — SMS send-window helper for the composer.
 *
 * The composer cannot read the edge function's env flags, so this is a
 * point-in-time, audience-agnostic helper. It powers the always-on
 * "How SMS timing works" info note shown for an SMS "Send now" review:
 *   - `nextGlobalSendWindowOpen` → the soonest global sending window, used both
 *     to label the "Schedule for …" secondary CTA and to schedule the whole
 *     blast for that instant instead of firing a blind out-of-hours send.
 *   - `SMS_WINDOWS` → the recipient-local windows shown in the copy.
 *
 * #4273 — the edge sender now has a window for every payout country
 * (supabase/functions/_shared/smsCountries.ts, SMS_COUNTRIES): Nigeria
 * 8 AM–8 PM, France 8 AM–9:30 PM Monday to Saturday, everywhere else
 * 8 AM–9 PM. SMS_WINDOWS MUST equal those rows; the drift test
 * (src/utils/__tests__/smsSendWindow.test.ts) reads the edge file and compares.
 */

/** A recipient-local window in minutes after midnight (days: 0 = Sunday). */
export interface SmsWindow {
  start: number;
  end: number;
  days?: readonly number[];
}

/** Recipient-local sending windows. MUST equal the edge SMS_COUNTRIES rows. */
export const SMS_WINDOWS = {
  NG: { start: 8 * 60, end: 20 * 60 },
  FR: { start: 8 * 60, end: 21 * 60 + 30, days: [1, 2, 3, 4, 5, 6] },
  DEFAULT: { start: 8 * 60, end: 21 * 60 },
} as const satisfies Record<string, SmsWindow>;

export type SmsMarket = keyof typeof SMS_WINDOWS;

/**
 * The IANA zones the edge fn can resolve, tagged with their window. US zones
 * mirror US_AREACODE_TZ; Canada, Europe and Lagos follow SMS_COUNTRIES.
 */
export const SUPPORTED_SMS_ZONES: ReadonlyArray<{ zone: string; market: SmsMarket }> = [
  ...[
    "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
    "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
    "America/Vancouver", "America/Edmonton", "America/Regina", "America/Winnipeg",
    "America/Toronto", "America/Halifax", "America/St_Johns",
    "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Atlantic/Reykjavik",
    "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam",
    "Europe/Brussels", "Europe/Vienna", "Europe/Zurich", "Europe/Warsaw",
    "Europe/Prague", "Europe/Stockholm", "Europe/Oslo", "Europe/Copenhagen",
    "Europe/Helsinki", "Europe/Athens", "Europe/Bucharest", "Europe/Sofia",
  ].map((zone) => ({ zone, market: "DEFAULT" as const })),
  { zone: "Europe/Paris", market: "FR" },
  { zone: "Africa/Lagos", market: "NG" },
];

/** Local minutes after midnight and weekday in a zone, or null. */
function localClock(zone: string, now: Date): { minutes: number; day: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value;
    const hour = Number(get("hour")) % 24;
    const minute = Number(get("minute"));
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday") ?? "");
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || day < 0) return null;
    return { minutes: hour * 60 + minute, day };
  } catch {
    return null;
  }
}

function inWindow(window: SmsWindow, clock: { minutes: number; day: number }): boolean {
  if (window.days !== undefined && !window.days.includes(clock.day)) return false;
  return clock.minutes >= window.start && clock.minutes < window.end;
}

/**
 * The soonest instant at which SOME supported zone is inside its window,
 * found in 15-minute steps (up to a day). Powers the "Schedule for …"
 * affordance. Returns `now` when a zone is already open.
 */
export function nextGlobalSendWindowOpen(now: Date): Date {
  const step = 15 * 60 * 1000;
  for (let delta = 0; delta <= 24 * 60 * 60 * 1000; delta += step) {
    const at = new Date(now.getTime() + delta);
    const open = SUPPORTED_SMS_ZONES.some(({ zone, market }) => {
      const clock = localClock(zone, at);
      return clock !== null && inWindow(SMS_WINDOWS[market], clock);
    });
    if (open) return at;
  }
  return now;
}

/** "8 AM", "9:30 PM" for minutes after midnight. */
function formatTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${twelve} ${suffix}` : `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/**
 * #4273 — the recipient-local sending windows as host copy, built from
 * SMS_WINDOWS (pinned to the edge rows by the drift test), so the composer can
 * never state a window the sender does not use.
 * "8 AM–8 PM in Nigeria, 8 AM–9:30 PM Monday to Saturday in France, 8 AM–9 PM everywhere else".
 */
export function formatSmsSendWindows(): string {
  const range = (window: SmsWindow) => `${formatTime(window.start)}–${formatTime(window.end)}`;
  return [
    `${range(SMS_WINDOWS.NG)} in Nigeria`,
    `${range(SMS_WINDOWS.FR)} Monday to Saturday in France`,
    `${range(SMS_WINDOWS.DEFAULT)} everywhere else`,
  ].join(", ");
}
